const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, tick } = require('./runtime.cjs');
test('keeps reactive state, x-cloak identity, bindings, shorthand and model modifiers', async () => {
  const html = `<div id="app"><div x-data="{count: 1, name: 'client', show: false}" x-cloak><button @click="count++" x-text="count"></button><input x-model.trim="name" value="server"><p x-show.important="show" :class="'client'">hello</p></div></div>`;
  const { w, errors, close } = await setup(html);
  const root = w.document.querySelector('#app > div');
  root.querySelector('button').click(); await tick(w);
  await w.TestFire.replaceHtml(root, html.match(/<div id="app">([\s\S]*)<\/div>/)[1].replace('hello', 'updated').replace('value="server"', 'value="changed"'));
  await tick(w);
  assert.equal(w.document.querySelector('#app > div'), root);
  assert.equal(root.querySelector('button').textContent, '2');
  assert.equal(root.querySelector('input').value, 'client');
  assert.equal(root.querySelector('p').className, 'client');
  assert.equal(root.querySelector('p').style.getPropertyPriority('display'), 'important');
  assert.equal(root.hasAttribute('x-cloak'), false);
  assert.deepEqual(errors, []); close();
});
test('structural templates keep generated siblings, can move, update and clean up', async () => {
  const fragment = `<div x-data="{items: [1,2], show:true}"><template key="loop" x-for="item in items" :key="item"><b x-text="item"></b></template><template key="if" x-if="show"><i>visible</i></template><p key="tail">tail</p></div>`;
  const { w, errors, close } = await setup(`<div id="app">${fragment}</div>`);
  const root = w.document.querySelector('#app > div');
  const first = root.querySelector('b');
  await w.TestFire.replaceHtml(root, fragment.replace('<p key="tail">tail</p>', '').replace('<template key="loop"', '<p key="tail">new</p><template key="loop"'));
  await tick(w);
  assert.equal(root.textContent, 'new12visible'); assert.equal(root.querySelector('b'), first);
  await w.TestFire.replaceHtml(root, fragment.replace('<b x-text="item"></b>', '<strong x-text="item"></strong>'));
  await tick(w);
  assert.equal(root.querySelectorAll('strong').length, 2); assert.equal(root.querySelectorAll('b').length, 0);
  await w.TestFire.replaceHtml(root, '<div x-data="{items: [1,2], show:true}"><p>done</p></div>');
  await tick(w); assert.equal(root.textContent, 'done'); assert.deepEqual(errors, []); close();
});
test('changed directives reinitialize and removed trees destroy once', async () => {
  const { w, errors, close } = await setup(`<div id="app"><div x-data="{ count: 0 }"><button @click="count++" x-text="count"></button><div key="remove" x-data="{ destroy() { window.destroyed = (window.destroyed || 0) + 1 } }"></div></div></div>`);
  const root = w.document.querySelector('#app > div');
  await w.TestFire.replaceHtml(root, `<div x-data="{ count: 0 }"><button @click="count += 2" x-text="count"></button></div>`);
  root.querySelector('button').click(); await tick(w);
  assert.equal(root.querySelector('button').textContent, '2'); assert.equal(w.destroyed, 1); assert.deepEqual(errors, []); close();
});
test('modeled selects retain client selection when server options change', async () => {
  const fragment = `<div x-data="{choice:'b'}"><select x-model="choice"><option value="a" selected>A</option><option value="b">B</option></select></div>`;
  const { w, errors, close } = await setup(`<div id="app">${fragment}</div>`);
  const root = w.document.querySelector('#app > div');
  await w.TestFire.replaceHtml(root, fragment.replace('>B</option>', '>B2</option>').replace('value="a" selected', 'value="a"'));
  assert.equal(root.querySelector('select').value, 'b'); assert.deepEqual(errors, []); close();
});
test('x-for with nested x-if retains generated nodes on repeated patches', async () => {
  const fragment = `<div x-data="{items:[1,2]}"><template x-for="item in items" :key="item"><template x-if="item > 0"><b x-text="item"></b></template></template><p>end</p></div>`;
  const { w, errors, close } = await setup(`<div id="app">${fragment}</div>`);
  const root = w.document.querySelector('#app > div');
  const nodes = Array.from(root.querySelectorAll('b'));
  for (let i=0;i<5;i++) await w.TestFire.replaceHtml(root, fragment.replace('end', `end${i}`));
  await tick(w);
  assert.deepEqual(Array.from(root.querySelectorAll('b')), nodes); assert.equal(root.textContent, '12end4'); assert.deepEqual(errors, []); close();
});
test('teleport contents remain owned by Alpine and are cleaned on removal', async () => {
  const fragment = `<div x-data><section id="tele-target"></section><template x-teleport="#tele-target"><b>teleported</b></template><p>end</p></div>`;
  const { w, errors, close } = await setup(`<div id="app">${fragment}</div>`);
  const root=w.document.querySelector('#app > div'), tele=root.querySelector('b');
  await w.TestFire.replaceHtml(root, fragment.replace('end','new'));
  assert.equal(root.querySelector('b'),tele);
  await w.TestFire.replaceHtml(root, '<div x-data><section id="tele-target"></section></div>');
  assert.equal(root.querySelector('b'),null); assert.deepEqual(errors, []); close();
});
test('x-ignore and client text/html remain untouched', async () => {
  const fragment=`<div x-data="{text:'client'}"><section x-ignore><b>old</b></section><p x-text="text">server</p><article x-html="text">server</article></div>`;
  const { w, errors, close } = await setup(`<div id="app">${fragment}</div>`);
  const root=w.document.querySelector('#app > div');
  await w.TestFire.replaceHtml(root,fragment.replace('old','new').replaceAll('server','new'));
  assert.equal(root.querySelector('section').textContent,'old'); assert.equal(root.querySelector('p').textContent,'client'); assert.equal(root.querySelector('article').textContent,'client'); assert.deepEqual(errors, []); close();
});
test('binding checked does not prevent server input value updates', async () => {
  const fragment=`<div x-data="{checked:true}"><input type="checkbox" :checked="checked" value="old"></div>`;
  const { w, errors, close } = await setup(`<div id="app">${fragment}</div>`);
  const root=w.document.querySelector('#app > div');
  await w.TestFire.replaceHtml(root,fragment.replace('value="old"','value="new"'));
  assert.equal(root.querySelector('input').value,'new'); assert.equal(root.querySelector('input').checked,true); assert.deepEqual(errors, []); close();
});
test('bound select value survives new server options', async () => {
  const fragment=`<div x-data="{value:'b'}"><select :value="value"><option value="a">A</option><option value="b">B</option></select></div>`;
  const { w, errors, close } = await setup(`<div id="app">${fragment}</div>`);
  const root=w.document.querySelector('#app > div');
  await w.TestFire.replaceHtml(root,fragment.replace('</select>', '<option value="c" selected>C</option></select>'));
  assert.equal(root.querySelector('select').value,'b'); assert.deepEqual(errors, []); close();
});
test('camel-case SVG bindings survive server patches', async () => {
  const fragment=`<div x-data="{box:'0 0 20 20'}"><svg :view-box.camel="box"><circle r="1"></circle></svg></div>`;
  const {w,errors,close}=await setup(`<div id="app">${fragment}</div>`);
  const root=w.document.querySelector('#app > div');
  assert.equal(root.querySelector('svg').getAttribute('viewBox'),'0 0 20 20');
  await w.TestFire.replaceHtml(root,fragment.replace('r="1"','r="2"'));
  assert.equal(root.querySelector('svg').getAttribute('viewBox'),'0 0 20 20'); assert.deepEqual(errors,[]);close();
});
