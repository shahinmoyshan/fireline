const { JSDOM, VirtualConsole } = require('jsdom');
const { buildSync } = require('esbuild');
const fs = require('node:fs');
const bundle = buildSync({ stdin: { contents: `export {default as plugin} from './src/index.js'; export * from './src/dom.js'; export * from './src/fetch.js'; export * from './src/response.js'; export * from './src/page.js'; export * from './src/helpers.js';`, resolveDir: process.cwd() }, bundle: true, format: 'iife', globalName: 'TestFire', write: false }).outputFiles[0].text;
const alpineCode = fs.readFileSync(require.resolve('alpinejs').replace('module.cjs.js', 'cdn.js'), 'utf8');
async function setup(html = '<div id="app"><div>old</div></div>') {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(e));
  vc.on('error', (...e) => errors.push(e));
  const dom = new JSDOM(`<body>${html}</body>`, { runScripts: 'dangerously', url: 'http://localhost/start', pretendToBeVisual: true, virtualConsole: vc });
  const w = dom.window;
  w.Headers = Headers; w.Response = Response; w.AbortController = AbortController;
  w.eval(bundle);
  w.document.addEventListener('alpine:init', () => w.Alpine.plugin(w.TestFire.plugin));
  w.eval(alpineCode);
  await tick(w);
  w.FireLine.settings.showUnexpectedModal = false;
  return { w, errors, close: () => dom.window.close() };
}
const tick = w => new Promise(resolve => w.setTimeout(resolve, 15));
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
module.exports = { setup, tick, json, bundle, alpineCode };
