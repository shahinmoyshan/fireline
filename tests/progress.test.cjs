const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, json } = require('./runtime.cjs');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };

// Drive browser timers explicitly so delay boundaries never depend on CPU load.
function clock(w) {
  let now = 0, id = 0;
  const jobs = new Map();
  const schedule = (callback, delay, interval) => {
    const key = ++id;
    jobs.set(key, { callback, at: now + Number(delay || 0), interval });
    return key;
  };
  w.setTimeout = (callback, delay) => schedule(callback, delay, 0);
  w.setInterval = (callback, delay) => schedule(callback, delay, delay);
  w.clearTimeout = w.clearInterval = key => jobs.delete(key);
  return ms => {
    const until = now + ms;
    while (true) {
      const next = [...jobs].filter(([, job]) => job.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [key, job] = next;
      now = job.at;
      if (job.interval) job.at += job.interval;
      else jobs.delete(key);
      job.callback();
    }
    now = until;
  };
}
async function fixture(t) {
  const result = await setup(); t.after(result.close);
  result.w.FireLine.settings.progressBar = true;
  return { ...result, advance: clock(result.w), bar: () => result.w.document.getElementById('fireline-progress') };
}

test('fast requests and preloaded visits never reveal progress', async t => {
  const { w, advance, bar } = await fixture(t);
  w.fetch = async () => json({ html: '<div>cached</div>' });
  await w.TestFire.ajaxRequest('/fast');
  advance(1000); assert.equal(bar(), null);
  await w.TestFire.ajaxRequest('/cached', 'GET', null, null, { preload: true });
  w.fetch = () => { throw Error('Unexpected cache miss'); };
  await w.TestFire.ajaxRequest('/cached');
  advance(1000); assert.equal(bar(), null);
});

test('slow requests reveal at the default delay and finish without revealing a later fast request', async t => {
  const { w, advance, bar } = await fixture(t);
  const gate = deferred(); w.fetch = () => gate.promise;
  const request = w.TestFire.ajaxRequest('/slow');
  advance(199); assert.equal(bar(), null);
  advance(1); assert.equal(bar().style.opacity, '1');
  gate.resolve(json({ message: 'done' })); await request;
  assert.equal(bar().style.width, '100%');
  advance(500); assert.equal(bar().style.opacity, '0');
  w.fetch = async () => json({ message: 'fast' });
  await w.TestFire.ajaxRequest('/fast');
  advance(1000); assert.equal(bar().style.opacity, '0');
  assert.equal(bar().style.width, '0%');
});

test('response handling and overlapping requests retain delayed progress until all work finishes', async t => {
  const { w, advance, bar } = await fixture(t);
  const handling = deferred(), entered = deferred(), transport = deferred();
  w.fetch = async () => json({ message: 'done' });
  const first = w.TestFire.ajaxRequest('/write', 'POST', null, async () => { entered.resolve(); await handling.promise; });
  await entered.promise;
  w.fetch = () => transport.promise;
  const second = w.TestFire.ajaxRequest('/next');
  advance(200); assert.equal(bar().style.opacity, '1');
  handling.resolve(); await first;
  assert.notEqual(bar().style.width, '100%');
  transport.resolve(json({ message: 'done' })); await second;
  assert.equal(bar().style.width, '100%');
});

test('cancellation, failures and timeouts before the delay never leave a pending bar', async t => {
  const { w, advance, bar } = await fixture(t);
  w.fetch = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted'))));
  const first = w.TestFire.ajaxRequest('/cancel');
  w.fetch = async () => json({ message: 'fast' });
  await w.TestFire.ajaxRequest('/replacement'); await first;
  advance(1000); assert.equal(bar(), null);
  w.fetch = async () => { throw Error('offline'); };
  await w.TestFire.ajaxRequest('/error');
  advance(1000); assert.equal(bar(), null);
  w.FireLine.settings.timeout = .05;
  w.fetch = (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted'))));
  const timed = w.TestFire.ajaxRequest('/timeout'); advance(50); await timed;
  advance(1000); assert.equal(bar(), null);
});

test('progress delay is configurable and disabling during the wait prevents display', async t => {
  const { w, advance, bar } = await fixture(t);
  w.FireLine.settings.progressDelay = 75;
  const first = deferred(); w.fetch = () => first.promise;
  const request = w.TestFire.ajaxRequest('/custom');
  advance(74); assert.equal(bar(), null);
  w.FireLine.settings.progressBar = false;
  advance(1); assert.equal(bar(), null);
  first.resolve(json({ message: 'done' })); await request;
  w.FireLine.settings.progressBar = true;
  w.FireLine.settings.progressDelay = 0;
  const second = deferred(); w.fetch = () => second.promise;
  const immediate = w.TestFire.ajaxRequest('/immediate');
  assert.equal(bar().style.opacity, '1');
  second.resolve(json({ message: 'done' })); await immediate;
});
