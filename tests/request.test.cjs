const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, tick, json } = require('./runtime.cjs');
test('navigation is awaitable; end observes patched DOM, title and URL; reload does not duplicate history', async () => {
  const { w, errors, close } = await setup();
  w.fetch = async () => json({ html: '<div>new</div>', title: '' });
  const ends = [];
  w.document.addEventListener('fireEnd', () => ends.push([w.document.querySelector('#app').textContent, w.location.pathname, w.FireLine.context.loading]));
  await w.Alpine.fire.navigate('/next');
  assert.deepEqual(ends, [['new', '/next', false]]); assert.equal(w.document.title, '');
  const length = w.history.length; await w.Alpine.fire.reload(); assert.equal(w.history.length, length);
  assert.deepEqual(errors, []); close();
});
test('three rapid GETs abort predecessors and retain correct loading ownership', async () => {
  const { w, errors, close } = await setup();
  const pending = [];
  w.fetch = (url, opts) => new Promise((resolve, reject) => {
    pending.push({ url, opts, resolve });
    opts.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
  const a = w.Alpine.fire.navigate('/a'); const b = w.Alpine.fire.navigate('/b');
  await tick(w);
  assert.equal(w.FireLine.context.loading, true);
  const c = w.Alpine.fire.navigate('/c');
  assert.equal(pending[1].opts.signal.aborted, true);
  pending[2].resolve(json({ html: '<div>C</div>' }));
  await Promise.all([a,b,c]); assert.equal(w.location.pathname, '/c'); assert.equal(w.FireLine.context.loading, false);
  assert.deepEqual(errors, []); close();
});
test('out-of-order GET responses never overwrite newer navigation with cancellation disabled', async () => {
  const { w, close } = await setup(); w.FireLine.settings.abortOnNewRequest = false;
  const pending = []; w.fetch = () => new Promise(resolve => pending.push(resolve));
  const a = w.Alpine.fire.navigate('/a'), b = w.Alpine.fire.navigate('/b');
  pending[1](json({ html: '<div>B</div>' })); await b;
  assert.equal(w.FireLine.context.loading, true);
  pending[0](json({ html: '<div>A</div>' })); await a;
  assert.equal(w.location.pathname, '/b'); assert.equal(w.document.querySelector('#app').textContent, 'B'); close();
});
test('timeout covers body reads and reports one error without an unexpected modal', async () => {
  const { w, errors, close } = await setup(); w.FireLine.settings.timeout = .01;
  let unexpected = 0; w.document.addEventListener('fireUnexpected', () => unexpected++);
  w.fetch = async (url, { signal }) => ({ text: () => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) });
  await w.Alpine.fire.navigate('/timeout');
  assert.equal(errors.length, 1); assert.equal(unexpected, 0); assert.equal(w.FireLine.context.loading, false); close();
});
test('invalid rendering does not commit history and asynchronous errors are caught', async () => {
  const { w, errors, close } = await setup(); w.fetch = async () => json({ html: '<div>A</div><div>B</div>' });
  await w.Alpine.fire.navigate('/invalid'); assert.equal(w.location.pathname, '/start'); assert.equal(errors.length, 1); close();
});
test('HTTP redirects commit only after successful render, with final URL', async () => {
  const { w, errors, close } = await setup();
  w.fetch = async () => { const r = json({ html: '<div>final</div>' }); Object.defineProperties(r, { redirected: { value: true }, url: { value: 'http://localhost/final' } }); return r; };
  await w.Alpine.fire.navigate('/old'); assert.equal(w.location.pathname, '/final'); assert.deepEqual(errors, []); close();
});
test('form validation uses inherited state without reversing Alpine scopes; includes submitter', async () => {
  const { w, errors, close } = await setup(`<div x-data="{form:$form()}"><form x-data="{local:1}" x-form action="/submit" method="post"><input name="email" value="bad"><button name="intent" value="save">Save</button></form></div>`);
  const form = w.document.querySelector('form'), button = form.querySelector('button');
  const scope = form._x_dataStack.slice(); let sent;
  w.fetch = async (url, options) => { sent = options; return json({message:'Invalid',errors:{email:'Bad email'}},422); };
  form.dispatchEvent(new w.SubmitEvent('submit', {bubbles:true,cancelable:true,submitter:button})); await tick(w);
  assert.equal(sent.body.get('intent'), 'save'); assert.deepEqual(form._x_dataStack, scope);
  const state = w.Alpine.$data(form).form; assert.equal(state.firstError('email'),'Bad email'); assert.equal(state.processing,false); assert.deepEqual(errors, []); close();
});
test('legacy x-submit displays text safely and prevents duplicate submits', async () => {
  const { w, errors, close } = await setup(`<div x-data><form x-submit action="/submit" method="post"><input name="reset"><p status="success"></p></form></div>`);
  let resolve, calls = 0; w.fetch = () => { calls++; return new Promise(r => resolve = r); };
  const form = w.document.querySelector('form');
  form.dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true}));
  form.dispatchEvent(new w.Event('submit', {bubbles:true,cancelable:true}));
  resolve(json({status:'success',message:'<b>Saved</b>'})); await tick(w);
  assert.equal(calls,1); assert.equal(form.querySelector('p').textContent,'<b>Saved</b>'); assert.equal(form.querySelector('b'),null); assert.deepEqual(errors, []); close();
});
test('status callbacks run for JSON errors and parser rejects malformed schemas', async () => {
  const { w, close } = await setup(); let called = 0;
  w.FireLine.settings.onUnauthenticated = () => called++;
  w.fetch = async () => json({message:'Log in'},401); const result = await w.TestFire.ajaxRequest('/private');
  assert.equal(called,1); assert.equal(result.type,'error');
  for (const data of [null, [], 5, {html:42}, {redirect:[]}]) assert.equal((await w.TestFire.parseResponse(json(data))).type,'unexpected');
  assert.equal((await w.TestFire.parseResponse(json({status:'success',message:'failed'},500))).type,'error'); close();
});
test('native link gestures, targets, downloads and cross-origin URLs are not intercepted', async () => {
  const {w, close}=await setup();
  const anchor=w.document.createElement('a'); anchor.href='/next';
  for (const init of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]) assert.equal(w.TestFire.canNavigate(new w.MouseEvent('click',init),anchor),false);
  for (const href of ['#section','mailto:test@example.test','https://elsewhere.test/','http://localhost:9999/']) {
    anchor.href=href; assert.equal(w.TestFire.canNavigate(new w.MouseEvent('click'),anchor),false);
  }
  anchor.href='/next'; anchor.download='file'; assert.equal(w.TestFire.canNavigate(new w.MouseEvent('click'),anchor),false);
  anchor.removeAttribute('download'); anchor.target='frame'; assert.equal(w.TestFire.canNavigate(new w.MouseEvent('click'),anchor),false);
  anchor.target=''; assert.equal(w.TestFire.canNavigate(new w.MouseEvent('click'),anchor),true); close();
});
test('GET form action overrides and query encoding match submitted controls', async () => {
  const {w, errors, close}=await setup('<div id="app"><div><form action="relative?old=1" method="post"><input name="q" value="a b"><input name="q" value="two"><button name="intent" value="find" formmethod="get" formaction="/search?old=1">Find</button></form></div></div>');
  let sent; w.fetch=async (url,options)=>{sent={url,options};return json({html:'<div>Results</div>'});};
  const form=w.document.querySelector('form'); await w.TestFire.formSubmission(form,null,form.querySelector('button'));
  assert.equal(new URL(sent.url).search,'?q=a+b&q=two&intent=find'); assert.equal(sent.options.body,undefined); assert.equal(w.location.pathname,'/search'); assert.deepEqual(errors,[]); close();
});
test('JSON redirect loops stop and GET navigation errors settle loading', async () => {
  const {w,errors,close}=await setup(); let calls=0;
  w.fetch=async()=>{calls++;return json({navigate:'/loop'});};
  await w.Alpine.fire.navigate('/loop'); assert.equal(calls,11); assert.equal(errors.length,1); assert.equal(w.FireLine.context.loading,false); close();
});
test('unsafe URL schemes and cross-origin AJAX never reach fetch', async () => {
  const {w,errors,close}=await setup(); let calls=0;w.fetch=async()=>{calls++;return json({});};
  await w.Alpine.fire.navigate('javascript:window.bad=true');
  await w.TestFire.ajaxRequest('https://elsewhere.test/private');
  assert.equal(calls,0);assert.equal(errors.length,2);assert.equal(w.bad,undefined);close();
});
test('JSON suffix content types parse and malformed body remains available', async () => {
  const {w,close}=await setup();
  const envelope=await w.TestFire.parseResponse(new Response('{"message":"Bad"}',{status:400,headers:{'Content-Type':'application/problem+json'}}));
  assert.equal(envelope.type,'error');
  const bad=await w.TestFire.parseResponse(new Response('{broken',{headers:{'Content-Type':'application/json'}}));
  assert.equal(bad.rawHtml,'{broken');assert.equal(bad.type,'unexpected');close();
});
test('POST render scripts resolve against the document base without changing history', async () => {
  const {w,errors,close}=await setup('<div id="app"><div><form action="/save" method="post"></form></div></div>');
  let source;const append=w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild=node=>{if(node.tagName==='SCRIPT' && node.src){source=node.src;w.setTimeout(()=>node.onload(),0);return node;} return append(node);};
  w.fetch=async()=>json({html:'<div><script src="relative.js"></script></div>'});
  await w.TestFire.formSubmission(w.document.querySelector('form'));
  assert.equal(source,'http://localhost/relative.js');assert.equal(w.location.pathname,'/start');assert.deepEqual(errors,[]);close();
});
test('a slow POST render cannot overwrite a newer navigation', async () => {
  const {w,errors,close}=await setup('<div id="app"><div><form action="/save" method="post"></form></div></div>');
  let post; w.fetch=async(url,options)=>options.method==='POST' ? new Promise(resolve=>post=resolve) : json({html:'<div>New page</div>'});
  const submission=w.TestFire.formSubmission(w.document.querySelector('form'));
  await w.Alpine.fire.navigate('/new');
  post(json({html:'<div>Old form result</div>'}));await submission;
  assert.equal(w.document.querySelector('#app').textContent,'New page');assert.equal(w.location.pathname,'/new');assert.deepEqual(errors,[]);close();
});
test('GET form navigation supersedes earlier navigation even without abort', async () => {
  const {w,errors,close}=await setup('<div id="app"><div><form action="/search" method="get"><input name="q" value="new"></form></div></div>');
  w.FireLine.settings.abortOnNewRequest=false;
  let old; w.fetch=async url=>url.includes('/old') ? new Promise(resolve=>old=resolve) : json({html:'<div>Results</div>'});
  const navigation=w.Alpine.fire.navigate('/old');
  await w.TestFire.formSubmission(w.document.querySelector('form'));
  old(json({html:'<div>Old</div>'}));await navigation;
  assert.equal(w.document.querySelector('#app').textContent,'Results');assert.equal(w.location.pathname,'/search');assert.deepEqual(errors,[]);close();
});
