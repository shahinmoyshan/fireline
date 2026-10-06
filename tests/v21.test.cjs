const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, tick, json } = require('./runtime.cjs');
const wait = ms => new Promise(r => setTimeout(r, ms));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const preload = (w,url) => w.TestFire.ajaxRequest(url,'GET',null,null,{preload:true});
async function partial(w, attr='') {
  w.document.querySelector('#app > div').innerHTML = `<section id="host" x-data="{ p: $partial('/fragment') }" x-partial${attr}="p"></section>`;
  await tick(w);
  const host=w.document.querySelector('#host');
  return {host,p:w.Alpine.$data(host).p};
}

test('cache hit cancels earlier navigation, emits lifecycle and catches consumer failures', async t => {
  const {w,close}=await setup();t.after(close);
  const slow=deferred();let signal;const events=[];
  w.fetch=async(url,opts)=>{ if(url.endsWith('/slow')) {signal=opts.signal;return slow.promise;} return json({html:'<div>cached</div>'}); };
  await preload(w,'/cached');
  const old=w.Alpine.fire.navigate('/slow');
  w.document.addEventListener('fireStart',()=>events.push('start'));
  w.document.addEventListener('fireEnd',()=>events.push('end'));
  await w.Alpine.fire.navigate('/cached');
  assert.equal(signal.aborted,true);assert.deepEqual(events,['start','end']);
  slow.resolve(json({html:'<div>stale</div>'}));await old;
  assert.equal(w.document.querySelector('#app').textContent,'cached');
  await preload(w,'/broken');let errors=0;w.document.addEventListener('fireError',()=>errors++);
  assert.equal(await w.TestFire.ajaxRequest('/broken','GET',null,()=>{throw Error('consumer');}),null);
  assert.equal(errors,1);assert.equal(w.FireLine.context.loading,false);
});

test('preloads deduplicate, ignore fragments, respect TTL zero, and bound cache size', async t => {
  const {w,close}=await setup();t.after(close);let calls=0;const gate=deferred();
  w.fetch=async()=>{calls++;await gate.promise;return json({html:'<div>ok</div>'});};
  const a=preload(w,'/same#a'),b=preload(w,'/same#b');gate.resolve();await Promise.all([a,b]);
  assert.equal(calls,1);await w.Alpine.fire.navigate('/same');assert.equal(calls,1);
  w.FireLine.settings.preloadCacheTime=0;await preload(w,'/off');await w.Alpine.fire.navigate('/off');assert.equal(calls,3);
  w.FireLine.settings.preloadCacheTime=30;w.FireLine.settings.preloadCacheSize=1;
  await preload(w,'/a');await preload(w,'/b');await w.Alpine.fire.navigate('/a');assert.equal(calls,6);
});

test('cache separates partials and headers and reload bypasses cache', async t => {
  const {w,close}=await setup();t.after(close);let calls=0;const headers=[];
  w.fetch=async(_,o)=>{calls++;headers.push(o.headers);return json({html:'<div>ok</div>'});};
  await preload(w,'/start');
  await w.TestFire.ajaxRequest('/start','GET',null,null,{partial:true});assert.equal(calls,2);
  assert.equal(headers[1].get('X-FireLine-Partial'),'1');assert.equal(headers[1].has('X-FireLine-Preload'),false);
  await w.Alpine.fire.reload();assert.equal(calls,3);
  w.FireLine.settings.headers={'X-Locale':'fr'};
  await w.Alpine.fire.navigate('/start');assert.equal(calls,4);
});

test('writes invalidate cached and in-flight preloads', async t => {
  const {w,close}=await setup();t.after(close);let calls=0;const slow=deferred();
  w.fetch=async(url,o)=>{calls++;if(url.endsWith('/late')&&o.headers.has('X-FireLine-Preload'))return slow.promise;return json({html:'<div>fresh</div>'});};
  await preload(w,'/cached');const pending=preload(w,'/late');
  await w.TestFire.ajaxRequest('/save','POST',new w.FormData());
  slow.resolve(json({html:'<div>stale</div>'}));await pending;
  await w.Alpine.fire.navigate('/cached');await w.Alpine.fire.navigate('/late');
  assert.equal(calls,5);assert.equal(w.document.querySelector('#app').textContent,'fresh');
});

test('speculation never invokes failure handlers, emits errors or reloads assets', async t => {
  const {w,errors,close}=await setup();t.after(close);let handlers=0;
  w.FireLine.settings.onUnauthenticated=()=>handlers++;w.FireLine.settings.assetVersion='old';
  w.fetch=async()=>json({message:'login'},401);await preload(w,'/auth');
  w.fetch=async()=>{throw Error('offline');};await preload(w,'/offline');
  w.fetch=async()=>new Response(JSON.stringify({html:'<div>new</div>'}),{headers:{'Content-Type':'application/json','X-FireLine-Asset-Version':'new'}});
  await preload(w,'/versioned');assert.equal(handlers,0);assert.equal(errors.length,0);
});

test('partial requests do not abort navigation or one another', async t => {
  const {w,close}=await setup();t.after(close);const pending=[];
  w.fetch=(_,o)=>{const d=deferred();pending.push({...d,signal:o.signal});return d.promise;};
  const nav=w.Alpine.fire.navigate('/page');const a=w.TestFire.ajaxRequest('/a','GET',null,null,{partial:true});const b=w.TestFire.ajaxRequest('/b','GET',null,null,{partial:true});
  assert.ok(pending.every(r=>!r.signal.aborted));
  pending.forEach(r=>r.resolve(json({html:'<div>ok</div>'})));await Promise.all([nav,a,b]);
});

test('hover reads current href, retries after expiry and ignores native/external links', async t => {
  const {w,close}=await setup();t.after(close);const urls=[];
  w.fetch=async u=>{urls.push(u);return json({html:'<div>ok</div>'});};
  w.FireLine.settings.preloadCacheTime=0;
  w.document.querySelector('#app > div').innerHTML='<a x-preload.hover href="/a">a</a><a x-preload href="https://example.org/">external</a><a x-preload native href="/native">native</a>';
  await tick(w);assert.equal(urls.length,0);const link=w.document.querySelector('a');
  link.href='/b';link.dispatchEvent(new w.MouseEvent('mouseenter'));await tick(w);
  link.dispatchEvent(new w.MouseEvent('mouseenter'));await tick(w);
  assert.deepEqual(urls,['http://localhost/b','http://localhost/b']);
});

test('partials keep their host, state and keyed identity across repeated loads', async t => {
  const {w,close}=await setup();t.after(close);const {host,p}=await partial(w);let count=0;
  w.fetch=async()=>json({html:`<button key="counter" x-data="{ n: 0 }" @click="n++" x-text="n"></button><p>${++count}</p>`});
  await p.load();const button=host.querySelector('button');button.click();await tick(w);await p.load();await tick(w);
  assert.equal(w.document.querySelector('#host'),host);assert.equal(w.Alpine.$data(host).p,p);
  assert.equal(host.querySelector('button'),button);assert.equal(button.textContent,'1');assert.equal(host.querySelector('p').textContent,'2');
});

test('partial failures reach local error state and loadMore can retry without losing its URL', async t => {
  const {w,errors,close}=await setup();t.after(close);const {p,host}=await partial(w);
  w.fetch=async()=>{throw Error('offline');};await p.load();assert.equal(p.error,'offline');assert.equal(p.loading,false);
  w.fetch=async()=>json({message:'Forbidden'},403);await p.loadMore('/next');assert.equal(p.error,'Forbidden');assert.equal(p.url,'/fragment');
  w.fetch=async()=>json({html:'<!doctype html><html><body>bad</body></html>'});await p.load();assert.match(p.error,/fragment/);assert.equal(host.textContent,'');
  w.fetch=async()=>json({html:''});await p.load();assert.equal(p.error,null);assert.equal(errors.length,0);
});

test('removal aborts partial work and stops polling even if transport ignores abort', async t => {
  const {w,close}=await setup();t.after(close);const {p,host}=await partial(w);const gate=deferred();let signal,calls=0;
  w.fetch=(_,o)=>{calls++;signal=o.signal;return gate.promise;};
  const pending=p.load();await tick(w);p.startInterval(5);host.remove();await tick(w);
  assert.equal(signal.aborted,true);assert.equal(p.intervalTimer,null);assert.equal(p.loading,false);
  gate.resolve(json({html:'<p x-init="window.stale=true">stale</p>'}));await pending;await wait(20);
  assert.equal(calls,1);assert.equal(w.stale,undefined);
});

test('busy partial loadMore does not change URL; polling never overlaps and validates interval', async t => {
  const {w,close}=await setup();t.after(close);const {p}=await partial(w);const gate=deferred();let calls=0;
  w.fetch=()=>{calls++;return gate.promise;};
  const pending=p.load();await tick(w);await p.loadMore('/next');assert.equal(p.url,'/fragment');
  for(const value of [0,-1,NaN,Infinity,2147483648,'bad'])assert.throws(()=>p.startInterval(value),/positive/);
  p.startInterval(5);await wait(25);assert.equal(calls,1);p.stopInterval();gate.resolve(json({html:'<p>ok</p>'}));await pending;
});

test('partial append initializes Alpine once with ESM-style registration and obeys script opt-out', async t => {
  const {w,close}=await setup();t.after(close);const {p,host}=await partial(w);const Alpine=w.Alpine;delete w.Alpine;
  w.count=0;w.FireLine.settings.executeScripts=false;
  w.fetch=async()=>json({html:'<p x-data="{n: 7}" x-init="window.count++" x-text="n"></p><script>window.scriptRan=true</script>'});
  await p.load(true);await tick(w);assert.equal(w.count,1);assert.equal(host.querySelector('p').textContent,'7');assert.equal(w.scriptRan,undefined);
  w.Alpine=Alpine;
});

test('lazy observers disconnect on removal and unsupported browsers load immediately', async t => {
  const {w,close}=await setup();t.after(close);let disconnected=0,callback,calls=0;
  w.fetch=async()=>{calls++;return json({html:'<p>ok</p>'});};
  w.IntersectionObserver=class{constructor(cb){callback=cb;}observe(){}disconnect(){disconnected++;}};
  const {host}=await partial(w,'.lazy');assert.equal(calls,0);host.remove();await tick(w);callback([{isIntersecting:true}]);assert.equal(calls,0);assert.ok(disconnected>0);
  delete w.IntersectionObserver;await partial(w,'.lazy');assert.equal(calls,1);
});

function transitions(w) {
  const updates=[];
  w.FireLine.settings.viewTransitions=true;
  w.document.startViewTransition=cb=>{
    const done=deferred();updates.push(()=>{try{done.resolve(cb());}catch(e){done.reject(e);}});
    return {updateCallbackDone:done.promise,ready:done.promise,finished:done.promise};
  };
  return updates;
}
test('deferred transitions cannot patch stale navigation and update failures propagate', async t => {
  const {w,close}=await setup();t.after(close);const updates=transitions(w);
  w.fetch=async u=>json({html:`<div>${new URL(u).pathname}</div>`});
  const first=w.Alpine.fire.navigate('/first');await tick(w);const second=w.Alpine.fire.navigate('/second');await tick(w);
  updates[1]();await second;updates[0]();await first;
  assert.equal(w.document.querySelector('#app').textContent,'/second');assert.equal(w.location.pathname,'/second');
  const target=w.document.querySelector('#app > div');const failure=w.TestFire.replaceHtml(target,'<div>new</div>');target.remove();updates[2]();
  await assert.rejects(failure,/detached/);
});

test('skipped transition animation still commits its successful DOM update', async t => {
  const {w,close}=await setup();t.after(close);w.FireLine.settings.viewTransitions=true;
  w.document.startViewTransition=cb=>({updateCallbackDone:Promise.resolve().then(cb),ready:Promise.reject(Error('skip')),finished:Promise.reject(Error('skip'))});
  w.fetch=async()=>json({html:'<div>updated</div>'});await w.Alpine.fire.navigate('/updated');assert.equal(w.location.pathname,'/updated');
});

test('history snapshots precede patching, preserve application state and decode hash IDs', async t => {
  const {w,close}=await setup();t.after(close);const states=[];const replace=w.history.replaceState.bind(w.history);
  w.history.replaceState=(s,...args)=>{states.push({s,html:w.document.querySelector('#app').textContent});replace(s,...args);};
  replace({app:42},'',w.location.href);w.scrollX=10;w.scrollY=100;let scrolled;
  w.HTMLElement.prototype.scrollIntoView=function(){scrolled=this.id;};
  w.fetch=async()=>json({html:'<div><p id="hello world">new</p></div>'});await w.Alpine.fire.navigate('/next#hello%20world');
  assert.equal(states.at(-1).s.app,42);assert.equal(states.at(-1).s.scroll.y,100);assert.equal(states.at(-1).html,'old');assert.equal(scrolled,'hello world');
});

test('validation focus handles literal special names, bracket paths and disabled fields', async t => {
  const {w,close}=await setup('<form method="post" action="/save"><input type="hidden" name="hidden"><input disabled name="disabled"><input name="users[0][email]"><input name="a&quot;]b"></form>');t.after(close);
  w.FireLine.settings.focusOnError=true;const form=w.document.querySelector('form');
  w.fetch=async()=>json({errors:{hidden:['bad'],disabled:['bad'],'users.0.email':['bad']}},422);
  await w.TestFire.formSubmission(form);assert.equal(w.document.activeElement.name,'users[0][email]');
  w.fetch=async()=>json({errors:{'a"]b':['bad']}},422);await w.TestFire.formSubmission(form);assert.equal(w.document.activeElement.name,'a"]b');
});

test('progress from a completed request never hides the following request', async t => {
  const {w,close}=await setup();t.after(close);w.FireLine.settings.progressBar=true;
  w.fetch=async()=>json({message:'ok'});await w.TestFire.ajaxRequest('/first');
  await wait(200);const gate=deferred();w.fetch=()=>gate.promise;const pending=w.TestFire.ajaxRequest('/second');
  await wait(350);const bar=w.document.querySelector('#fireline-progress');assert.equal(bar.style.opacity,'1');assert.notEqual(bar.style.width,'0%');
  w.FireLine.settings.progressBar=false;gate.resolve(json({message:'ok'}));await pending;assert.equal(w.document.querySelector('#fireline-progress'),null);
});

test('invalid polling intervals cannot create request storms and active navigation is not polled over', async t => {
  const {w,close}=await setup();t.after(close);let calls=0;const gate=deferred();
  w.fetch=()=>{calls++;return gate.promise;};
  w.document.querySelector('#app > div').innerHTML='<i x-poll="0"></i><i x-poll="bad"></i><i x-poll="2147483648"></i><i x-poll="-2"></i><i x-poll="5"></i>';
  const pending=w.Alpine.fire.navigate('/manual');await wait(40);assert.equal(calls,1);
  gate.resolve(json({html:'<div>done</div>'}));await pending;
});

test('stale navigation cannot trigger asset reload when abortOnNewRequest is disabled', async t => {
  const {w,errors,close}=await setup();t.after(close);const gate=deferred();
  w.FireLine.settings.abortOnNewRequest=false;w.FireLine.settings.assetVersion='current';
  w.fetch=async u=>u.endsWith('/stale')?gate.promise:json({html:'<div>latest</div>'});
  const stale=w.Alpine.fire.navigate('/stale');await w.Alpine.fire.navigate('/latest');
  gate.resolve(new Response(JSON.stringify({html:'<div>stale</div>'}),{headers:{'Content-Type':'application/json','X-FireLine-Asset-Version':'old'}}));await stale;
  assert.equal(errors.length,0);assert.equal(w.location.pathname,'/latest');
});

test('partial timeout is local and a changed URL discards an old response', async t => {
  const {w,errors,close}=await setup();t.after(close);const {p,host}=await partial(w);
  w.FireLine.settings.timeout=.01;
  w.fetch=(_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted'))));
  await p.load();assert.match(p.error,/timed out/);assert.equal(p.loading,false);assert.equal(errors.length,0);
  w.FireLine.settings.timeout=0;const gate=deferred();w.fetch=()=>gate.promise;
  const pending=p.load();await tick(w);p.url='/different';gate.resolve(json({html:'<p>stale</p>'}));await pending;
  assert.equal(host.textContent,'');assert.equal(p.loading,false);
});

test('partial polling pauses while hidden or offline and resumes without overlap', async t => {
  const {w,close}=await setup();t.after(close);const {p}=await partial(w);let calls=0;
  w.fetch=async()=>{calls++;return json({html:'<p>ok</p>'});};
  Object.defineProperty(w.document,'hidden',{value:true,configurable:true});p.startInterval(5);await wait(25);assert.equal(calls,0);
  Object.defineProperty(w.document,'hidden',{value:false});Object.defineProperty(w.navigator,'onLine',{value:false,configurable:true});await wait(25);assert.equal(calls,0);
  Object.defineProperty(w.navigator,'onLine',{value:true});await wait(25);p.stopInterval();assert.ok(calls>0);
});

test('partial scripts run exactly once including legacy JS MIME types; data scripts remain accessible', async t => {
  const {w,close}=await setup();t.after(close);const {p,host}=await partial(w);w.runs=0;
  w.fetch=async()=>json({html:'<script type="application/x-javascript">window.runs++</script><p>ok</p><script type="application/json">{"data":1}</script>'});
  await p.load(true);assert.equal(w.runs,1);assert.equal(host.querySelector('script[type="application/json"]').textContent,'{"data":1}');
  w.FireLine.settings.executeScripts=false;await p.load(true);assert.equal(w.runs,1);
});

test('fresh navigation and explicit reload prevent older preloads from being reused', async t => {
  const {w,close}=await setup();t.after(close);const gate=deferred();let calls=0;
  w.fetch=async(u,o)=>{calls++;return o.headers.has('X-FireLine-Preload')?gate.promise:json({html:'<div>fresh</div>'});};
  const pending=preload(w,'/next');await w.Alpine.fire.navigate('/next');
  gate.resolve(json({html:'<div>old hover</div>'}));await pending;await w.Alpine.fire.navigate('/next');assert.equal(calls,3);
  await preload(w,'/next');await w.Alpine.fire.reload();await w.Alpine.fire.navigate('/next');assert.equal(calls,6);
  assert.equal(w.document.querySelector('#app').textContent,'fresh');
});

test('scroll bursts avoid history writes and immediate back/forward restores the latest position', async t => {
  const {w,close}=await setup();t.after(close);w.scrollTo=(x,y)=>{w.scrollX=x;w.scrollY=y;};
  w.fetch=async()=>json({html:'<div>page</div>'});
  w.scrollY=111;await w.Alpine.fire.navigate('/second');
  let writes=0;const replace=w.history.replaceState.bind(w.history);w.history.replaceState=(...args)=>{writes++;return replace(...args);};
  for(let y=0;y<250;y++){w.scrollY=y;w.dispatchEvent(new w.Event('scroll'));}
  assert.equal(writes,0,'Scroll events only update an in-memory snapshot');
  w.history.back();await tick(w);await tick(w);assert.equal(w.scrollY,111);
  w.history.forward();await tick(w);await tick(w);assert.equal(w.scrollY,249);
});

test('a superseded navigation failure is silent when transport cancellation is disabled', async t => {
  const {w,errors,close}=await setup();t.after(close);const gate=deferred();
  w.FireLine.settings.abortOnNewRequest=false;
  w.fetch=async url=>url.endsWith('/old')?gate.promise:json({html:'<div>new</div>'});
  const old=w.Alpine.fire.navigate('/old');await w.Alpine.fire.navigate('/new');gate.reject(Error('old network failure'));await old;
  assert.equal(errors.length,0);assert.equal(w.FireLine.context.loading,false);
});

test('SVG scripts use the same explicit execution policy as HTML scripts', async t => {
  const {w,close}=await setup();t.after(close);const {p}=await partial(w);w.svgRuns=0;
  w.fetch=async()=>json({html:'<svg><script>window.svgRuns++</script></svg>'});
  await p.load();assert.equal(w.svgRuns,1);
  w.FireLine.settings.executeScripts=false;await p.load(true);assert.equal(w.svgRuns,1);
});
