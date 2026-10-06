const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const browsers = require('playwright');
const browserType = process.env.FIRELINE_BROWSER || 'chromium';
const { buildSync } = require('esbuild');
const domBundle = buildSync({ entryPoints: ['src/dom.js'], bundle: true, format: 'iife', globalName: 'DOM', write: false }).outputFiles[0].text;
const alpine = fs.readFileSync('node_modules/alpinejs/dist/cdn.min.js');
const plugin = fs.readFileSync('dist/cdn.min.js');
const serve = http.createServer((req, res) => {
  if(process.env.FIRELINE_DEBUG) console.log('SERVER', req.url);
  if (req.url === '/alpine.js' || req.url === '/fireline.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(req.url === '/alpine.js' ? alpine : plugin); }
  else if (req.url === '/module.js') { res.setHeader('Content-Type','text/javascript'); res.end(fs.readFileSync('dist/module.esm.js')); }
  else if (req.url === '/alpine-module.js') { res.setHeader('Content-Type','text/javascript'); res.end(fs.readFileSync('node_modules/alpinejs/dist/module.esm.js')); }
  else if (req.url === '/esm') { res.end(`<html><body><div id="app"><div x-data="{count:0}"><button @click="count++" x-text="count"></button><a id="next" x-navigate href="/next">Next</a></div></div><script type="module">import Alpine from '/alpine-module.js'; import FireLine from '/module.js'; Alpine.plugin(FireLine); Alpine.start();</script></body></html>`); }
  else if (req.url === '/ordered-module.js') { res.setHeader('Content-Type','text/javascript'); res.end('window.order.push("external-module")'); }
  else if (req.url === '/ordered.js') { res.setHeader('Content-Type', 'text/javascript'); setTimeout(() => res.end('window.order.push("external");'), 25); }
  else if (req.url === '/http-redirect') { res.writeHead(302, {Location:'/next'}); res.end(); }
  else if (req.url === '/next') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({html:'<div><h1>Next</h1><a x-navigate href="/">Home</a></div>',title:'Next'})); }
  else if (req.url.startsWith('/fragment')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({html:`<button x-data="{n: 0}" x-init="window.partialInits=(window.partialInits||0)+1" @click="n++" x-text="n"></button><script>window.partialScripts=(window.partialScripts||0)+1</script><svg><script>window.svgScripts=(window.svgScripts||0)+1</script></svg><p>${req.headers['x-fireline-partial'] || 'page'}</p>`}));
  }
  else if (req.url === '/scroll-a' || req.url === '/scroll-b') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({html:`<div><h1>${req.url}</h1><div style="height:2500px"></div><p id="hello world">Anchor</p></div>`}));
  }
  else if (req.url === '/versioned') {
    res.setHeader('X-FireLine-Asset-Version','build-new');
    if (req.headers['x-fireline']) { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({html:'<div>New</div>'})); }
    else res.end('<!doctype html><html><body><h1 id="fresh-assets">Fresh document</h1></body></html>');
  }
  else if (req.headers['x-fireline']) { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({html:'<div><h1>Home</h1></div>',title:'Home'})); }
  else res.end('<!doctype html><html><head><script defer src="/fireline.js"></script><script defer src="/alpine.js"></script></head><body><div id="app"><div x-data="{value: \'client\'}"><h1>Home</h1><a id="next" x-navigate href="/next">Next</a><input key="input" x-model="value"><p key="other">other</p></div></div></body></html>');
});
(async () => {
  let browser, php;
  try {
    await new Promise(resolve => serve.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${serve.address().port}`;
    browser = await browsers[browserType].launch({ headless: true, ...(process.env.FIRELINE_BROWSER_CHANNEL ? {channel:process.env.FIRELINE_BROWSER_CHANNEL} : {}) });
    const context = await browser.newContext();
    let page = await context.newPage();
    page.setDefaultTimeout(10000);
    const watchdog = setTimeout(() => { console.error('Browser test timed out'); process.exit(1); }, 60000);
    watchdog.unref();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.on('console', msg => { if(process.env.FIRELINE_DEBUG) console.log('BROWSER',msg.text()); });
    page.on('request', req => { if(process.env.FIRELINE_DEBUG) console.log('REQUEST',req.url()); });
    await page.goto(base); await page.waitForFunction(() => window.Alpine?.fire); await page.addScriptTag({content:domBundle});
    await page.evaluate(async () => {
      const root = document.querySelector('#app > div'), input = root.querySelector('input'); input.focus(); input.setSelectionRange(2,4);
      window.savedInput = input;
      await DOM.replaceHtml(root, `<div x-data="{value: 'client'}"><p key="other">moved</p><input key="input" x-model="value"></div>`);
    });
    assert.deepEqual(await page.evaluate(() => [document.activeElement === savedInput, savedInput.selectionStart,savedInput.selectionEnd,savedInput.value]), [true,2,4,'client']);
    console.log('PASS browser preserves keyed input focus, selection and Alpine state');
    await page.evaluate(async () => {
      FireLine.settings.timeout = 2;
      window.order=[];
      await DOM.replaceHtml(document.querySelector('#app > div'), `<div id="patched"><script>window.order.push(document.querySelector('#patched') ? 'inline' : 'early')<\/script><script src="/ordered.js"><\/script><script type="module" src="/ordered-module.js"><\/script><script type="module">window.order.push('module')<\/script><script type="application/json">{"a":1}<\/script></div>`);
    });
    await page.waitForFunction(() => window.order?.includes('module'));
    assert.deepEqual(await page.evaluate(() => order),['inline','external','external-module','module']);
    console.log('PASS browser executes scripts once, after patch, in order');
    await page.evaluate(async () => {
      FireLine.settings.executeScripts=false;
      await DOM.replaceHtml(document.querySelector('#app > div'), '<div><script>window.order.push("disabled")<\/script></div>');
    });
    assert.deepEqual(await page.evaluate(() => order),['inline','external','external-module','module']);
    console.log('PASS browser can disable fragment scripts');
    await page.evaluate(() => FireLine.modal.show(500, '<script>parent.modalExecuted=true<\/script><p>Error</p>'));
    assert.equal(await page.locator('#fireline-unexpected-modal iframe').getAttribute('sandbox'), '');
    assert.equal(await page.evaluate(() => window.modalExecuted), undefined);
    await page.evaluate(() => FireLine.modal.dismiss());
    console.log('PASS unexpected response iframe is sandboxed');
    await page.goto(base); await page.locator('#next').click(); await page.waitForURL('**/next');
    assert.equal(await page.locator('h1').textContent(),'Next'); await page.goBack(); await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'Home');
    await page.evaluate(() => Alpine.fire.navigate('/http-redirect'));
    assert.equal(new URL(page.url()).pathname, '/next');
    assert.equal(await page.locator('h1').textContent(), 'Next');
    console.log('PASS built CDN navigation, browser back and real HTTP redirects');
    await page.goto(base + '/esm');
    await page.waitForFunction(() => window.FireLine);
    assert.equal(await page.evaluate(() => typeof window.Alpine), 'undefined');
    await page.locator('button').click(); assert.equal(await page.locator('button').textContent(),'1');
    await page.locator('#next').click(); await page.waitForURL('**/next');
    assert.equal(await page.locator('h1').textContent(),'Next');
    console.log('PASS built ES module works without window.Alpine');
    await require('./v21-browser.cjs')(page, base);
    await page.close();
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    // Measure keyed reversal and verify identity for every node.

    await page.goto(base); await page.waitForFunction(() => window.Alpine?.fire);
    await page.addScriptTag({content:domBundle});
    const timings = await page.evaluate(() => {
      FireLine.settings.executeScripts=false;
      const times=[];
      for(const size of [100,1000,5000]) {
        const root=document.createElement('ul'); document.body.append(root);
        root.innerHTML=Array.from({length:size},(_,i)=>`<li key="${i}">${i}</li>`).join('');
        const old=Array.from(root.children), template=document.createElement('template');
        template.innerHTML='<ul>'+old.toReversed().map(n=>n.outerHTML).join('')+'</ul>';
        const start=performance.now(); DOM.diffAndPatch(document.body,root,template.content.firstChild); const elapsed=performance.now()-start;
        if(!Array.from(root.children).every((node,i)=>node===old[size-1-i])) throw Error('Keyed identity lost');
        times.push({nodes:size,ms:Math.round(elapsed*100)/100}); root.remove();
      } return times;
    });
    console.log('PASS keyed reversal benchmark (one local run):',JSON.stringify(timings));
    if (process.argv.includes('--php')) {
      const adapter=path.resolve('../fireline-php');
      if(!fs.existsSync(path.join(adapter,'vendor/autoload.php'))) throw Error('Run composer install in fireline-php first');
      const port=Number(process.env.FIRELINE_PHP_PORT || 18994);
      php=spawn('php',['-S',`127.0.0.1:${port}`,'tests/server.php'],{cwd:adapter,stdio:'pipe'});
      let log=''; php.stderr.on('data',chunk=>log+=chunk);
      const phpBase=`http://127.0.0.1:${port}`;
      let ready=false;
      for(let i=0;i<50;i++) { try { const r=await fetch(phpBase); if(r.ok){ready=true;break;} } catch {} await new Promise(r=>setTimeout(r,100)); }
      if(!ready) throw Error('PHP fixture server failed: '+log);
      await page.goto(phpBase); await page.locator('#count').click(); assert.equal(await page.locator('#count').textContent(),'1');
      await page.locator('#next').click(); await page.waitForURL('**/next'); assert.equal(await page.locator('h1').textContent(),'Next page');
      assert.equal(await page.locator('#count').textContent(),'1');
      await page.locator('form button').click(); await page.waitForFunction(()=>document.querySelector('#error')?.textContent==='Enter a valid email.');
      await page.locator('input[name=email]').fill('valid@example.test'); await page.locator('form button').click();
      await page.waitForFunction(()=>document.querySelector('#message')?.textContent==='Saved: save');
      await page.evaluate(()=>Alpine.fire.navigate('/navigate')); assert.equal(new URL(page.url()).pathname,'/next');
      await page.evaluate(() => {
        document.querySelector('#app > div').insertAdjacentHTML('beforeend', '<section id="partial" x-data="{p: $partial(\'/partial\')}" x-init="window.phpPartial=p" x-partial="p"></section>');
      });
      await page.waitForFunction(() => window.phpPartial);
      await page.evaluate(() => phpPartial.load());
      assert.equal(await page.locator('#partial p').textContent(), 'Partial via JSON');
      assert.equal(await page.locator('#partial').getAttribute('x-partial'), 'p');
      const preloadResponse = await page.request.get(phpBase + '/partial', {headers:{'X-FireLine':'1','X-FireLine-Preload':'1','X-FireLine-Partial':'1'}});
      assert.equal(preloadResponse.headers()['x-fireline-asset-version'], 'fixture-2.1');
      assert.match(preloadResponse.headers().vary, /X-FireLine-Partial/);
      assert.equal((await preloadResponse.json()).html.trim(), '<p>Partial via JSON</p>');
      console.log('PASS real PHP adapter: initial layout, fragment navigation, preserved state, validation, submitter, success and JSON navigation');
    }
    assert.deepEqual(errors,[]);
    console.log(`Browser checks passed (${await browser.version()}).`);
  } finally { php?.kill(); await browser?.close(); await new Promise(r=>serve.close(r)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
