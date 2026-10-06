// Standalone diagnostic: intentionally does not load FireLine or Alpine.
const {webkit}=require('playwright');
const http=require('node:http');
const server=http.createServer((req,res)=>res.end('<!doctype html><html><body><div id="app">Initial</div></body></html>'));
(async()=>{
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await webkit.launch();const page=await browser.newPage();
const base=`http://127.0.0.1:${server.address().port}`;
try{
await page.goto(base);
await page.evaluate(async()=>{
  history.scrollRestoration='manual';
  const render=async()=>{
    const cb=()=>document.querySelector('#app').innerHTML='<h1>'+location.pathname+'</h1><div style="height:2500px"></div>';
    if(document.startViewTransition){const t=document.startViewTransition(cb);t.ready.catch(()=>{});t.finished.catch(()=>{});await t.updateCallbackDone;}else cb();
  };
  window.addEventListener('popstate',render);
  history.pushState({},'', '/a');await render();scrollTo(0,700);
  history.pushState({},'', '/b');await render();scrollTo(0,300);
});
await page.goBack();await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='/a');
await page.goForward();await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='/b');
await page.evaluate(async()=>await Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));
await page.goto(base);
console.log('Native WebKit repro passed');
}finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
