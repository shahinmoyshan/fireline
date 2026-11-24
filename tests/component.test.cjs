const { test } = require("node:test");
const assert = require("node:assert/strict");
const { setup, tick, json } = require("./runtime.cjs");

test("reactive initializes state and exposes $fire proxy", async () => {
  const html = `
    <div id="app">
      <div id="c-1" data-fire-id="c-1" x-data="reactive({
        id: 'c-1',
        component: 'App\\\\Components\\\\Counter',
        checksum: 'test-checksum',
        state: { count: 10, title: 'hello' }
      })">
        <div data-fire-content>
          <span id="counter" x-text="state.count"></span>
          <span id="title" x-text="$fire.title"></span>
        </div>
      </div>
    </div>
  `;

  const { w, errors, close } = await setup(html);
  const counter = w.document.querySelector("#counter");
  const title = w.document.querySelector("#title");

  assert.equal(counter.textContent, "10");
  assert.equal(title.textContent, "hello");

  // Test $fire proxy writes
  const root = w.document.querySelector("#c-1");
  const comp = w.Alpine.$data(root);
  comp.$fire.count = 25;
  await tick(w);
  assert.equal(counter.textContent, "25");

  assert.deepEqual(errors, []);
  close();
});

test("fire:model performs two-way binding with debounced sync request", async () => {
  let capturedBody = null;

  const html = `
    <div id="app">
      <div id="c-1" data-fire-id="c-1" x-data="reactive({
        id: 'c-1',
        component: 'App\\\\Components\\\\Search',
        checksum: 'sig',
        state: { query: 'boots' }
      })">
        <div data-fire-content>
          <input fire:model="query" id="search-input" value="boots">
          <span id="display" x-text="state.query"></span>
        </div>
      </div>
    </div>
  `;

  const { w, close } = await setup(html);

  // Mock fetch
  w.fetch = async (url, options) => {
    capturedBody = JSON.parse(options.body);
    return json({
      id: "c-1",
      state: { query: capturedBody.updates.query },
      html: `<input fire:model="query" id="search-input" value="${capturedBody.updates.query}"><span id="display" x-text="state.query"></span>`,
      events: [],
    });
  };

  const input = w.document.querySelector("#search-input");
  const display = w.document.querySelector("#display");

  assert.equal(display.textContent, "boots");

  // Change input value and dispatch input event
  input.value = "sneakers";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  await tick(w);

  assert.equal(display.textContent, "sneakers");

  // Wait for debounce timer (250ms) to trigger sync request
  await new Promise((r) => setTimeout(r, 300));
  await tick(w);

  assert.ok(capturedBody !== null);
  assert.equal(capturedBody.component, "App\\Components\\Search");
  assert.equal(capturedBody.method, "__sync");
  assert.equal(capturedBody.updates.query, "sneakers");

  close();
});

test("fire:click calls component action and updates DOM via diffAndPatch", async () => {
  let requestSent = null;

  const html = `
    <div id="app">
      <div id="c-1" data-fire-id="c-1" x-data="reactive({
        id: 'c-1',
        component: 'App\\\\Components\\\\Counter',
        checksum: 'sig',
        state: { count: 5 }
      })">
        <div data-fire-content>
          <p id="count-val" x-text="state.count">5</p>
          <button id="inc-btn" fire:click="increment">+</button>
        </div>
      </div>
    </div>
  `;

  const { w, close } = await setup(html);

  w.fetch = async (url, options) => {
    requestSent = JSON.parse(options.body);
    return json({
      id: "c-1",
      state: { count: 6 },
      html: `<p id="count-val" x-text="state.count">6</p><button id="inc-btn" fire:click="increment">+</button>`,
      events: [],
    });
  };

  const btn = w.document.querySelector("#inc-btn");
  btn.click();
  await tick(w);
  await new Promise((r) => setTimeout(r, 50));
  await tick(w);

  assert.ok(requestSent !== null);
  assert.equal(requestSent.method, "increment");
  assert.equal(requestSent.id, "c-1");

  const countVal = w.document.querySelector("#count-val");
  assert.equal(countVal.textContent, "6");

  close();
});

test("fire:loading toggles visibility during action execution", async () => {
  let resolveRequest;
  const html = `
    <div id="app">
      <div id="c-1" data-fire-id="c-1" x-data="reactive({
        id: 'c-1',
        component: 'App\\\\Components\\\\Test',
        checksum: 'sig',
        state: { loading: false }
      })">
        <div data-fire-content>
          <button id="save-btn" fire:click="save">Save</button>
          <span id="spinner" fire:loading>Processing...</span>
          <span id="target-spinner" fire:loading fire:target="save">Saving...</span>
        </div>
      </div>
    </div>
  `;

  const { w, close } = await setup(html);

  w.fetch = () =>
    new Promise((resolve) => {
      resolveRequest = () =>
        resolve(
          json({
            id: "c-1",
            state: {},
            html: `<button id="save-btn" fire:click="save">Save</button><span id="spinner" fire:loading>Processing...</span><span id="target-spinner" fire:loading fire:target="save">Saving...</span>`,
            events: [],
          }),
        );
    });

  const spinner = w.document.querySelector("#spinner");
  const targetSpinner = w.document.querySelector("#target-spinner");
  const btn = w.document.querySelector("#save-btn");

  // Initially hidden
  assert.equal(spinner.style.display, "none");
  assert.equal(targetSpinner.style.display, "none");

  // Trigger click -> loading begins
  btn.click();
  await tick(w);

  // Both spinners should be visible while request is pending
  assert.equal(spinner.style.display, "");
  assert.equal(targetSpinner.style.display, "");

  // Finish request
  resolveRequest();
  await tick(w);
  await new Promise((r) => setTimeout(r, 50));
  await tick(w);

  // Hidden again
  assert.equal(w.document.querySelector("#spinner").style.display, "none");
  assert.equal(
    w.document.querySelector("#target-spinner").style.display,
    "none",
  );

  close();
});

test("server events are dispatched and caught by component listeners", async () => {
  let secondComponentCalled = false;

  const html = `
    <div id="app">
      <!-- Component A -->
      <div id="comp-a" data-fire-id="comp-a" x-data="reactive({
        id: 'comp-a',
        component: 'App\\\\Components\\\\Sender',
        checksum: 'sig',
        state: {}
      })">
        <div data-fire-content>
          <button id="send-btn" fire:click="triggerEvent">Dispatch</button>
        </div>
      </div>

      <!-- Component B -->
      <div id="comp-b" data-fire-id="comp-b" x-data="reactive({
        id: 'comp-b',
        component: 'App\\\\Components\\\\Receiver',
        checksum: 'sig',
        state: { received: 0 },
        listeners: { 'item-added': 'refresh' }
      })">
        <div data-fire-content>
          <span id="status" x-text="state.received"></span>
        </div>
      </div>
    </div>
  `;

  const { w, close } = await setup(html);

  w.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.id === "comp-a") {
      return json({
        id: "comp-a",
        state: {},
        html: `<button id="send-btn" fire:click="triggerEvent">Dispatch</button>`,
        events: [{ name: "item-added", params: [42] }],
      });
    }

    if (body.id === "comp-b" && body.method === "refresh") {
      secondComponentCalled = true;
      return json({
        id: "comp-b",
        state: { received: body.params[0] },
        html: `<span id="status" x-text="state.received"></span>`,
        events: [],
      });
    }

    return json({ id: body.id, state: {}, html: "", events: [] });
  };

  const sendBtn = w.document.querySelector("#send-btn");
  sendBtn.click();
  await tick(w);
  await new Promise((r) => setTimeout(r, 80));
  await tick(w);

  assert.equal(secondComponentCalled, true);
  const statusEl = w.document.querySelector("#status");
  assert.equal(statusEl.textContent, "42");

  close();
});

test("consecutive actions use the preceding server state", async () => {
  const html = `
    <div id="app">
      <div id="c-1" data-fire-id="c-1" x-data="reactive({
        id: 'c-1',
        component: 'App\\\\Components\\\\Counter',
        checksum: 'sig',
        state: { count: 0 }
      })">
        <div data-fire-content>
          <span id="val" x-text="state.count"></span>
        </div>
      </div>
    </div>
  `;

  const { w, close } = await setup(html);
  const root = w.document.querySelector("#c-1");
  const comp = w.Alpine.$data(root);

  let resolveFirst;
  let resolveSecond;

  let callCount = 0;
  w.fetch = (url, options) => {
    const body = JSON.parse(options.body);
    callCount++;
    assert.equal(body.state.count, callCount - 1);
    if (callCount === 1) {
      return new Promise((r) => {
        resolveFirst = () =>
          r(
            json({
              id: "c-1",
              state: { count: 1 },
              html: `<span id="val" x-text="state.count">1</span>`,
            }),
          );
      });
    } else {
      return new Promise((r) => {
        resolveSecond = () =>
          r(
            json({
              id: "c-1",
              state: { count: 2 },
              html: `<span id="val" x-text="state.count">2</span>`,
            }),
          );
      });
    }
  };

  const p1 = comp.send("action1");
  const p2 = comp.send("action2");
  await tick(w);
  assert.equal(callCount, 1);

  resolveFirst();
  await p1;
  await tick(w);
  assert.equal(callCount, 2);
  assert.equal(w.document.querySelector("#val").textContent, "1");

  resolveSecond();
  await p2;
  await tick(w);
  assert.equal(w.document.querySelector("#val").textContent, "2");

  close();
});
