const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setup, tick, json } = require('./runtime.cjs');

test('x-preload fetches and caches response instantly, then navigate uses cache', async () => {
    const { w, errors, close } = await setup(`<div id="app"><div id="container"></div></div>`);
    let calls = 0;
    w.fetch = async (url) => {
        calls++;
        return json({ html: '<div>Cached Content</div>', title: 'Cached' });
    };

    w.document.getElementById('container').innerHTML = `<a x-preload href="/cache-me">Link</a>`;
    await tick(w);

    await new Promise(r => setTimeout(r, 20)); // wait for fetch
    assert.equal(calls, 1);
    assert.equal(w.document.querySelector('#app').textContent.trim(), 'Link');

    await w.Alpine.fire.navigate('/cache-me');
    await tick(w);
    
    assert.equal(calls, 1, 'Should use cache, fetch not called again');
    assert.equal(w.document.querySelector('#app').textContent.trim(), 'Cached Content');
    close();
});

test('x-preload.mouseover triggers only after mouseenter', async () => {
    const { w, close } = await setup(`<div id="app"><div id="container"></div></div>`);
    let calls = 0;
    w.fetch = async () => {
        calls++;
        return json({ html: '<div>Hovered</div>' });
    };

    w.document.getElementById('container').innerHTML = `<a x-preload.mouseover href="/cache-hover">Link</a>`;
    await tick(w);
    
    await new Promise(r => setTimeout(r, 20));
    assert.equal(calls, 0, 'Should not prefetch before hover');

    const link = w.document.querySelector('a');
    link.dispatchEvent(new w.MouseEvent('mouseenter'));
    
    await new Promise(r => setTimeout(r, 20));
    assert.equal(calls, 1, 'Prefetched after hover');
    
    await w.Alpine.fire.navigate('/cache-hover');
    await tick(w);
    assert.equal(calls, 1, 'Used cache on navigation');
    close();
});

test('x-preload cache expires if time has passed', async () => {
    const { w, close } = await setup(`<div id="app"><div id="container"></div></div>`);
    w.FireLine.settings.preloadCacheTime = 0.05; // 50ms expiration

    let calls = 0;
    w.fetch = async () => {
        calls++;
        return json({ html: '<div>Expired Content</div>' });
    };

    w.document.getElementById('container').innerHTML = `<a x-preload href="/expire">Link</a>`;
    await tick(w);
    
    await new Promise(r => setTimeout(r, 20));
    assert.equal(calls, 1);
    
    // Wait for cache to expire
    await new Promise(r => setTimeout(r, 60));
    
    await w.Alpine.fire.navigate('/expire');
    await tick(w);
    
    assert.equal(calls, 2, 'Fetched again because cache expired');
    close();
});

test('x-partial loads content, patches DOM, and retains reactivity', async () => {
    const { w, close } = await setup(`<div id="app"><div id="container"></div></div>`);
    let calls = 0;
    w.fetch = async (url) => {
        calls++;
        return json({ html: '<div class="loaded" x-data="{ num: 5 }"><span x-text="num"></span></div>' });
    };

    w.document.getElementById('container').innerHTML = `<div x-data="{ comments: $partial('/api/comments') }" x-partial="comments" x-init="comments.load()"></div>`;
    await tick(w);
    await new Promise(r => setTimeout(r, 50));
    
    assert.equal(calls, 1);
    const loaded = w.document.querySelector('.loaded');
    assert.ok(loaded);
    assert.equal(loaded.textContent.trim(), '5', 'Alpine bindings in partial should be initialized');
    assert.equal(w.location.pathname, '/start'); // Path didn't change
    close();
});

test('x-partial appending creates nodes without destroying target', async () => {
    const { w, close } = await setup(`<div id="app"><div id="container"></div></div>`);
    w.fetch = async (url) => {
        return json({ html: '<p>New Data</p>' });
    };

    w.document.getElementById('container').innerHTML = `<div x-data="{ p: $partial('/api/data') }" x-partial="p">
        <span>Old Data</span>
    </div>`;
    await tick(w);
    
    const div = w.document.querySelector('[x-partial]');
    const partialState = w.Alpine.$data(div).p;
    
    // Test append = true
    await partialState.load(true);
    await tick(w);
    
    assert.equal(div.children.length, 2);
    assert.equal(div.children[0].tagName, 'SPAN');
    assert.equal(div.children[1].tagName, 'P');
    assert.equal(div.children[1].textContent, 'New Data');
    close();
});

test('x-partial loadMore updates url and appends', async () => {
    const { w, close } = await setup(`<div id="app"><div id="container"></div></div>`);
    let requestedUrl;
    w.fetch = async (url) => {
        requestedUrl = url;
        return json({ html: '<p>Next Page</p>' });
    };

    w.document.getElementById('container').innerHTML = `<div id="target" x-data="{ p: $partial('/api/data?page=1') }" x-partial="p"></div>`;
    await tick(w);
    
    const partialState = w.Alpine.$data(w.document.getElementById('target')).p;
    await partialState.loadMore('/api/data?page=2');
    await tick(w);
    
    assert.ok(requestedUrl.includes('page=2'), 'Url updated');
    const target = w.document.getElementById('target');
    assert.ok(target.querySelector('p'));
    assert.equal(target.textContent.trim(), 'Next Page');
    close();
});

test('x-partial interval polling starts and stops properly', async () => {
    const { w, close } = await setup(`<div id="app"><div id="container"></div></div>`);
    let calls = 0;
    w.fetch = async () => { calls++; return json({ html: '<div>Polled</div>' }); };

    w.document.getElementById('container').innerHTML = `<div id="target" x-data="{ p: $partial('/api/poll') }" x-partial="p"></div>`;
    await tick(w);
    
    const partialState = w.Alpine.$data(w.document.getElementById('target')).p;
    partialState.startInterval(10); // 10ms
    
    await new Promise(r => setTimeout(r, 35));
    assert.ok(calls >= 2, 'Polled multiple times');
    
    partialState.stopInterval();
    const beforeStop = calls;
    await new Promise(r => setTimeout(r, 20));
    assert.equal(calls, beforeStop, 'Polling stopped');
    close();
});

test('x-poll reloads the page at intervals and stops when detached', async () => {
    const { w, errors, close } = await setup(`<div id="app"><div id="container"></div></div>`);
    let calls = 0;
    w.fetch = async () => { calls++; return json({ html: '<div><div id="poller" x-poll="15"></div></div>' }); };

    w.document.getElementById('container').innerHTML = `<div id="poller" x-poll="15"></div>`;
    await tick(w);

    await new Promise(r => setTimeout(r, 80));
    assert.ok(calls >= 2, 'Should have polled');
    
    const beforeRemove = calls;
    w.document.getElementById('poller').remove();
    
    await new Promise(r => setTimeout(r, 30));
    assert.equal(calls, beforeRemove, 'Polling should stop after element is detached');
    close();
});
