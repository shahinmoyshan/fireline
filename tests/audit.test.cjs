const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, json } = require('./runtime.cjs');

test('new page visits reset scroll while reloads retain it and history restores coordinates', async t => {
  const { w, close } = await setup(); t.after(close);
  const positions = [];
  w.scrollTo = (x, y) => { positions.push([x, y]); w.scrollX = x; w.scrollY = y; };
  w.fetch = async () => json({ html: '<div>page</div>' });
  w.scrollY = 700;
  await w.Alpine.fire.navigate('/next');
  assert.deepEqual(positions, [[0, 0]]);
  positions.length = 0;
  await w.Alpine.fire.reload();
  assert.deepEqual(positions, []);
  await w.TestFire.navigateTo('/previous', false, 0, { restoreScroll: true, scroll: { x: 0, y: 300 } });
  assert.deepEqual(positions, [[0, 300]]);
  positions.length = 0;
  await w.Alpine.fire.navigate('/missing#anchor');
  assert.deepEqual(positions, [[0, 0]]);
});

test('unexpected response previews are sandboxed and preserve the original overflow style', async t => {
  const { w, close } = await setup(); t.after(close);
  w.document.body.style.setProperty('overflow', 'clip', 'important');
  w.FireLine.modal.dismiss();
  assert.equal(w.document.body.style.overflow, 'clip');
  w.FireLine.modal.show(500, '<script>parent.previewExecuted=true</script>');
  assert.equal(w.document.querySelector('iframe').getAttribute('sandbox'), '');
  assert.equal(w.document.body.style.overflow, 'hidden');
  w.FireLine.modal.show(500, '<p>Another error</p>');
  assert.equal(w.document.querySelectorAll('#fireline-unexpected-modal').length, 1);
  w.FireLine.modal.dismiss();
  assert.equal(w.document.body.style.overflow, 'clip');
  assert.equal(w.document.body.style.getPropertyPriority('overflow'), 'important');
});
