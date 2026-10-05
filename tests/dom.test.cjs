const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { buildSync } = require('esbuild');
const bundle = buildSync({ entryPoints: ['src/dom.js'], bundle: true, format: 'iife', globalName: 'DOM', write: false }).outputFiles[0].text;
function setup(html) {
  const dom = new JSDOM(`<body>${html}</body>`, { runScripts: 'dangerously', url: 'http://localhost/' });
  dom.window.eval(bundle);
  return dom;
}
function patch(w, html) {
  const t = w.document.createElement('template'); t.innerHTML = html;
  return w.DOM.diffAndPatch(w.document.body, w.document.body.firstChild, t.content.firstChild);
}
test('replacing current child does not use a detached cursor', () => {
  const { window: w } = setup('<div><p>old</p><span>tail</span></div>');
  patch(w, '<div><section>new</section><span>tail</span></div>');
  assert.equal(w.document.body.innerHTML, '<div><section>new</section><span>tail</span></div>');
});
test('mixed keyed/unkeyed insertions, deletions and reorders retain identity', () => {
  const { window: w } = setup('<div><b key="a">A</b><i>old</i><b key="b">B</b><b key="gone">X</b></div>');
  const a = w.document.querySelector('[key=a]'), b = w.document.querySelector('[key=b]');
  patch(w, '<div><b key="b">B2</b><span>new</span><b key="c">C</b><b key="a">A</b></div>');
  assert.equal(w.document.querySelector('[key=a]'), a);
  assert.equal(w.document.querySelector('[key=b]'), b);
  assert.equal(w.document.body.textContent, 'B2newCA');
});
test('comments, SVG namespaces, templates and controls update', () => {
  const { window: w } = setup('<div><!--old--><svg><use href="#a"/></svg><template><p>old</p></template><input value="old"><textarea>old</textarea><select multiple><option selected>A</option><option>B</option></select></div>');
  patch(w, '<div><!--new--><svg><use href="#b"/></svg><template><b>new</b></template><input value="new"><textarea>new</textarea><select multiple><option>A</option><option selected>B</option></select></div>');
  assert.equal(w.document.querySelector('input').value, 'new');
  assert.equal(w.document.querySelector('textarea').value, 'new');
  assert.deepEqual(Array.from(w.document.querySelector('select').selectedOptions, o => o.text), ['B']);
  assert.equal(w.document.querySelector('template').innerHTML, '<b>new</b>');
});
test('invalid fragments reject without changing DOM', async () => {
  const { window: w } = setup('<div>old</div>');
  for (const html of ['', 'text', '<div>A</div><div>B</div>', '<html><body><div>A</div></body></html>']) {
    await assert.rejects(w.DOM.replaceHtml(w.document.body.firstChild, html));
    assert.equal(w.document.body.innerHTML, '<div>old</div>');
  }
});
test('seeded random keyed reconciliation matches target and keeps surviving nodes', () => {
  const { window: w } = setup('<div></div>');
  let seed = 12345;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2**32);
  for (let n = 0; n < 500; n++) {
    const before = new Map(Array.from(w.document.querySelectorAll('[key]'), el => [el.getAttribute('key'), el]));
    const keys = Array.from({ length: 15 }, (_, i) => String(i)).filter(() => random() > .3);
    for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
    const html = `<div>${keys.map(k => `<p key="${k}">${n}:${k}</p>`).join('')}</div>`;
    patch(w, html);
    assert.equal(w.document.body.innerHTML, html);
    for (const el of w.document.querySelectorAll('[key]')) if (before.has(el.getAttribute('key'))) assert.equal(el, before.get(el.getAttribute('key')));
  }
});
test('duplicate and empty keys never reuse the same node twice', () => {
  const { window:w } = setup('<div><p key="">one</p><p key="">two</p><b key="x">three</b></div>');
  const first=w.document.querySelector('p');
  patch(w,'<div><p key="">ONE</p><b key="x">THREE</b><p key="">TWO</p><p key="">FOUR</p></div>');
  assert.equal(w.document.querySelector('p'),first); assert.equal(w.document.body.textContent,'ONETHREETWOFOUR');
});
test('file inputs preserve selected files and SVG namespaced attributes update', () => {
  const { window:w } = setup('<div><input type="file"><svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#old"></use></svg></div>');
  const input=w.document.querySelector('input');
  patch(w,'<div><input type="file" value="not-assignable"><svg xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="#new"></use></svg></div>');
  assert.equal(w.document.querySelector('input'),input); assert.equal(input.value,'');
  assert.equal(w.document.querySelector('use').getAttributeNS('http://www.w3.org/1999/xlink','href'),'#new');
});
