# FireLine 2.1

FireLine is an Alpine.js plugin for navigation and form submissions over server-rendered HTML. Your backend returns JSON envelopes; FireLine patches a page fragment while retaining matching Alpine components.

Requires Alpine **3.15+ (3.x)** and a modern browser with Fetch, AbortController, FormData and ES2020 support. FireLine does not bundle Alpine.

## Install

```sh
npm install fireline alpinejs
```

With a bundler:

```js
import Alpine from 'alpinejs';
import FireLine from 'fireline';

Alpine.plugin(FireLine);
Object.assign(window.FireLine.settings, {
    targetEl: '#app > div',
    csrfToken: document.querySelector('meta[name="csrf-token"]')?.content,
});
Alpine.start();
```

Assigning `window.Alpine` is optional with the module build. For CDN use, load FireLine before Alpine:

```html
<script defer src="https://cdn.jsdelivr.net/npm/fireline@2.1.0/dist/cdn.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.15.0/dist/cdn.min.js"></script>
```

Pin an exact FireLine version for reproducible production deployments. With CDN loading, configure settings in an `alpine:init` listener registered after the plugin script, before Alpine starts.

## Page and response structure

The initial request returns a complete HTML document containing the target:

```html
<div id="app">
    <div x-data="{ count: 0 }">
        <button @click="count++" x-text="count"></button>
        <a x-navigate href="/about">About</a>
    </div>
</div>
```

An intercepted request to `/about` must return `Content-Type: application/json`:

```json
{"html":"<div><h1>About</h1><a x-navigate href=\"/\">Home</a></div>","title":"About"}
```

`html` replaces the **target element itself**, not just its contents. It must contain exactly one element root that continues to match `targetEl`. Empty markup, multiple roots and full documents are rejected. Surrounding comments and whitespace are allowed. Return only trusted, properly escaped application markup.

## Navigation

```html
<a x-navigate href="/posts">Posts</a>
<a x-navigate="menuOpen = false" href="/settings">Settings</a>
```

### Preloading and polling

```html
<a href="/posts" x-navigate x-preload>Preload on mount</a>
<a href="/posts" x-navigate x-preload.hover>Preload on hover</a>
<a href="/posts" x-navigate.hover>Navigate and preload on hover</a>
<div x-poll="10000"></div>
```

`.mouseover` is an alias for `.hover`. Preloading uses same-origin GET requests with `X-FireLine-Preload: 1`. Native links, downloads, external destinations and same-page anchors are ignored. Hover reads the current `href` and can retry after expiry. Duplicate in-flight preloads share transport; a navigation never waits for an unfinished preload.

Successful render envelopes are cached for `preloadCacheTime` seconds (default 30), up to `preloadCacheSize` entries (default 50, oldest evicted first). Either setting at `0` disables cache reuse. A completed preload is consumed once by navigation, including its normal loading/events lifecycle. Cache keys include the URL without its fragment, request headers and configured asset version. Partials bypass this cache; reload, polling and back/forward navigation always fetch. FireLine writes invalidate the cache before and after transport/response handling, and older speculative requests cannot repopulate it.

**A preload must return the same complete page as an ordinary FireLine navigation.** Do not omit required queries or markup based on the preload header. Only preload safe GET routes; use the header to omit analytics or similar optional work. Failures stay silent and do not invoke status callbacks, error events, modals or asset reloads. Browser/proxy caching is separate from this short-lived application cache.

`x-poll="10000"` refreshes the current page after each 10-second interval; the default is 5000 milliseconds. The value must be a positive finite number no greater than 2147483647; invalid values disable the directive. Polling pauses while the document is hidden, the browser reports offline, or a foreground request is active. It does not overlap its own requests and stops when its element is removed.

### Partial loading

`$partial(url, initialData = {})` creates state for a fragment request. Mount it with `x-partial="state"`; `FireLine.partial()` is the JavaScript equivalent. Keep controls and loading indicators outside the partial host:

```html
<div x-data="{ comments: $partial('/comments?page=1') }">
    <span x-show="comments.loading">Loading...</span>
    <p x-text="comments.error"></p>
    <section x-partial="comments" x-init="comments.load()"></section>
    <button :disabled="comments.loading"
            @click="comments.loadMore('/comments?page=2')">Load more</button>
</div>
```

The server returns JSON, for example `{"html":"<article key=\"comment-1\">Hello</article>"}`. It must not return raw HTML or a full document. Partial HTML may contain multiple roots or be empty. The **host stays mounted; `load()` reconciles its contents** using the same keyed patcher as page navigation. `load(true)` appends instead. Keep the host free of competing `x-html`, `x-text` and `x-ignore` directives. Mount one state object per host.

| Partial API | Behavior |
| --- | --- |
| `url` | Current endpoint; changing it discards an older in-flight result |
| `loading`, `error` | Local processing flag and error message (or `null`) |
| `await load(append = false)` | Fetch and patch/append; duplicate loads are ignored |
| `await loadMore(nextUrl)` | Append from the next URL; retain the previous URL on failure |
| `startInterval(ms = 5000)` | Poll after each completed load; requires positive finite milliseconds up to 2147483647 |
| `stopInterval()` | Stop polling |
| `dispose()` | Stop polling and abort the current request; called automatically on host removal |

Partials send `X-FireLine-Partial: 1`, run independently of navigation, and do not change history, title, global loading or request events. Transport, timeout, invalid HTML and non-render envelope failures set `error`. Configured HTTP status callbacks still apply. Redirect/navigation envelopes are not followed by a partial. Fragment scripts obey `executeScripts`, including append mode. Methods resolve to the envelope on success or `null` on failure/cancellation/ignored loads. State becomes reactive through Alpine `x-data`.

Use `x-partial.lazy="comments"` (alias `.intersect`) to load once when visible. Without IntersectionObserver support it loads immediately. Removal disconnects the observer, aborts pending work and stops polling. Partial intervals pause while hidden or offline.

### Navigation effects and deployment versions

- Set `viewTransitions = true` to wrap page replacement in the browser's View Transitions API. Unsupported browsers patch normally. Styling transitions is your application's responsibility; FireLine does not supply a slide animation. Navigation waits for the DOM update, not the animation's end.
- Set `progressBar = true` and optionally `progressColor = '#29d'` for a top-edge indicator covering foreground requests and response handling.
- FireLine saves scroll coordinates in `history.state.scroll` while preserving other state fields, restores them on back/forward, and decodes hash IDs when jumping to a new page's anchor. Scroll-event history writes are coalesced; the latest 100 entry positions stay in memory for immediate traversal. `history.state.__fireline` is reserved for entry identity. It sets `history.scrollRestoration = 'manual'`; avoid installing a second scroll manager.
- Set `assetVersion` from the build identifier embedded in the initial HTML. When a successful render's `X-FireLine-Asset-Version` differs, navigation makes a full request to the destination; partials and non-redirected write renders reload the current document. A preload merely retains the version for checking on use. Keep the initial HTML version and server header consistent across deployments.
- Set `focusOnError = true` to focus the first available invalid form control after Alpine updates. Literal names and PHP-style bracket names mapped from dotted error paths are supported; hidden and disabled controls are skipped.

`x-navigate` handles ordinary same-origin HTTP(S) clicks. Modified clicks, downloads, other browsing targets, `native` links, non-HTTP links and same-page hash links keep browser behavior. Global interception is opt-in:

```js
FireLine.settings.interceptLinks = true;
FireLine.settings.interceptForms = true;
```

Add `native` to opt out. Links/forms with explicit FireLine directives are not submitted twice when global interception is enabled.

Inside Alpine, use `$fire`; outside, use `Alpine.fire` or `FireLine.context`:

| API | Behavior |
| --- | --- |
| `$fire.current` | Current absolute page URL |
| `$fire.loading` | True while any foreground request or its response handling is active |
| `await $fire.navigate(url)` | Fetch, render and update history; external HTTP(S) URLs use full navigation |
| `await $fire.reload()` | Refetch the current page without adding a history entry |
| `await $fire.replaceHtml(html)` | Patch the target without fetching or changing history |
| `await $fire.formSubmit(formEl, state?, submitter?)` | Submit a form programmatically |

Request methods resolve to the parsed envelope, or `null` on transport/render failure or cancellation. `replaceHtml` resolves to the resulting element or `null` on failure. Errors emit `fireError`. Back/forward navigation refetches the page; restoring a page from the browser's back/forward cache reloads it. History and title are updated only after a successful render. Use JSON `navigate`/`redirect` envelopes for predictable action redirects; same-origin HTTP redirects ending in a render also use the final response URL.

New foreground GET requests cancel the preceding foreground GET by default. Preloads and partials do not participate in this cancellation. Writes are not canceled by this setting. A submission from a page you have since left can finish on the server, but its result will not replace the newer page. Independently, a superseded navigation cannot commit an older response over the newer navigation. JSON navigation chains are limited to 10 redirects.

## Reactive forms

```html
<form x-data="{ form: $form() }" x-form action="/register" method="post">
    <!-- Include your framework's CSRF hidden field here. -->
    <input name="email" type="email">
    <p x-show="form.hasError('email')" x-text="form.firstError('email')"></p>
    <p x-text="form.message"></p>
    <button name="intent" value="register" :disabled="form.processing">Register</button>
</form>
```

`x-form` finds `form` in the Alpine scope, including parent scopes. Use `x-form="accountForm"` for another state property. `$form(initialData = {})` creates:

| Property/method | Meaning |
| --- | --- |
| `processing` | Submission in progress; duplicate submissions are ignored |
| `message` | Response message or `null` |
| `errors` | Object of field names to message arrays |
| `status` | `success`, `error`, `validation`, or `null` |
| `reset()` | Clear message, errors and status; does not reset data or inputs |
| `hasError(field)` | Whether a field has messages |
| `firstError(field)` | First message or `null` |
| `await submit(formEl, submitter?)` | Submit using this state |

`FireLine.form()` is also available in JavaScript. Its result becomes reactive when placed in Alpine `x-data` (or wrapped with `Alpine.reactive`). Extra `initialData` fields are ordinary state: **requests serialize the actual form controls**, not the state object. Use named inputs and `x-model` when binding data.

Forms send `FormData`, including files and the clicked submit button. Submitter `formaction` and `formmethod` overrides are honored. GET forms encode fields into the query string, replacing the action's existing query. Relative actions resolve against `document.baseURI`. `native`, external actions, non-self targets and dialog forms keep native behavior when submitted through event interception.

A `success` envelope resets native controls to their default values; Alpine's form-reset handling updates `x-model`. Validation and error envelopes retain entered values. A render response patches the page; GET form renders update history. A `navigate` response fetches the destination. Network failures emit `fireError` and clear processing; they do not invent a validation message.

### Legacy `x-submit`

`x-submit` remains available without reactive form state:

```html
<form x-submit action="/save" method="post">
    <input name="name">
    <p status="success"></p>
    <p status="error"></p>
    <button>Save</button>
</form>
```

An optional expression runs before submission. Success/error messages are written as **text**, including validation's top-level message. Use `x-form` for field errors.

## JSON response protocol

Requests default to `Accept: application/json` (customizable with `headers`), and include `X-Requested-With: XMLHttpRequest`, and `X-FireLine: 1`. Cookies use same-origin credentials. AJAX requests are restricted to the current origin. A configured CSRF token is sent as `X-CSRF-TOKEN`; hidden form fields are included only when your markup provides them.

| Response | HTTP status | JSON body |
| --- | --- | --- |
| Render | 2xx | `{"html":"<div>...</div>","title":"Page title"}` |
| Full navigation | 2xx | `{"redirect":"/login"}` |
| FireLine navigation | 2xx | `{"navigate":"/posts"}` |
| Form success | 2xx | `{"status":"success","message":"Saved","data":{}}` |
| Validation | 422 | `{"message":"Check the fields","errors":{"email":["Invalid"]}}` |
| Error | 4xx/5xx, or 2xx | `{"status":"error","message":"Failed"}` |
| Message | 2xx | `{"message":"Notice"}` |

`title` is optional; an empty string clears the title. Error HTTP statuses never trigger success, render or navigation, even if the body contains those fields. A message on an error status is treated as an error. For 422, `errors` must be an object; string field messages are normalized to arrays. The parser also accepts `application/*+json` content types. Null/array/scalar JSON, unknown shapes, malformed JSON, HTML and empty responses (including 204) are unexpected responses. Navigation consumes render/redirect/navigate envelopes; form submissions additionally consume status/messages/validation.

Return one action per envelope. If a successful response contains several action fields, precedence is `redirect`, `navigate`, then `html`. The original payload is available as `envelope.raw`; additional success `data` is not copied into form state.

## DOM reconciliation

The internal function is named **`diffAndPatch()`**. It matches keyed children by `key` within each parent and unkeyed children in their relative order:

```html
<ul>
    <li key="post-17">First post</li>
    <li key="post-42">Second post</li>
</ul>
```

Use unique, stable keys for reorderable server-rendered lists. `key` is separate from Alpine's `:key` on `x-for`. Keyed moves preserve the DOM node, its listeners, Alpine state, and focus/selection where the control survives. Duplicate keys are matched by occurrence but do not give stable semantic identity; avoid them. Moving a node between different parents creates a new node.

Sibling matching uses maps and cursors rather than repeated list scans. Text, comments, namespaces, attributes and unbound form properties are reconciled. File-input values are not assigned. Bound values and `x-model` remain client-owned. `@click` and `:class` shorthand are supported.

Unchanged directives retain their existing state. A changed/added/removed directive (including `x-data`) replaces and reinitializes that element. Changing a component's `key` also resets it. `x-cloak` is not reintroduced on initialized elements. `x-ignore` preserves a matched subtree; it does not keep the element alive when its parent or keyed position is removed; `x-text` and `x-html` own their children. Structural `x-if`/`x-for` templates retain their generated siblings; changing template content recreates those instances. Teleported content is left to Alpine and cleaned up with its template. Third-party DOM widgets should live inside `x-ignore` with appropriate component cleanup.

### Fragment scripts

With `executeScripts: true`, scripts from the incoming fragment run after the DOM patch. Classic inline scripts run immediately; external scripts are loaded sequentially and awaited. Inline modules use native asynchronous module scheduling and are not awaited by `fireEnd`; use an external module when completion ordering matters. Non-JavaScript data scripts are not executed. Script attributes such as nonce, integrity and crossorigin are copied. External `src` URLs resolve against the response URL for navigations, or the current document base for direct replacement.

Keep Alpine and shared application bundles in the initial layout, outside the replaced fragment. Classic fragment scripts run on each render; external module evaluation follows the browser's module cache. Normal CSP rules apply. External load failures/timeouts emit `fireError`, but cannot roll back an already patched DOM or scripts already executed. Runtime exceptions in scripts use the browser's error reporting. Executable scripts are excluded from the live fragment and executed through this explicit path, once per render. Scripts inside structural template contents are not executed by FireLine. Disabling `executeScripts` disables fragment script execution; it does not sanitize HTML or Alpine expressions.

## Settings

Change individual fields or use `Object.assign(FireLine.settings, {...})` to retain defaults.

| Setting | Default | Meaning |
| --- | --- | --- |
| `targetEl` | `'#app > div'` | Selector for the element to reconcile |
| `timeout` | `30` | Seconds through response-body reading, and per external script load; `0` disables timeout |
| `interceptLinks` | `false` | Automatically handle eligible anchors |
| `interceptForms` | `false` | Automatically handle eligible forms |
| `abortOnNewRequest` | `true` | Abort the previous foreground GET |
| `preloadCacheTime` | `30` | Cached preload lifetime in seconds; `0` disables reuse |
| `preloadCacheSize` | `50` | Maximum cached envelopes; `0` disables reuse |
| `csrfToken` | `null` | Token for `X-CSRF-TOKEN` |
| `headers` | `{}` | Additional Fetch headers; FireLine identification headers are enforced |
| `executeScripts` | `true` | Execute scripts in trusted fragments |
| `showUnexpectedModal` | `true` | Display unexpected responses in a sandboxed iframe |
| `viewTransitions` | `false` | Use `document.startViewTransition()` on page replacement |
| `progressBar` | `false` | Show built-in top-edge loading bar |
| `progressColor` | `'#29d'` | Color for the top-edge progress bar |
| `assetVersion` | `null` | Hard-reload on mismatch with `X-FireLine-Asset-Version` header |
| `focusOnError` | `false` | Focus an available invalid control after reactive updates |
| `onUnauthenticated` | `null` | `(response, envelope) => {}` for HTTP 401 |
| `onForbidden` | `null` | `(response, envelope) => {}` for HTTP 403 |
| `onServerError` | `null` | `(response, envelope) => {}` for HTTP 5xx |
| `onUnexpectedResponse` | `null` | `(status, body) => {}` instead of the fallback modal |

Except during preloading, status callbacks run for both JSON and non-JSON errors and may be asynchronous. The response body has already been consumed; inspect `envelope.raw` or `envelope.rawHtml`. For unexpected responses, a matching status callback takes precedence over the generic callback/modal. Recognized JSON errors are still returned to form handling after the callback.

Disable the debug modal in production if desired. `FireLine.modal.show(status, body)` and `.dismiss()` control it manually. Response scripts cannot run in its sandbox.

## Events

Listen on `document`. Each dispatch is a fresh `CustomEvent`:

| Event | Timing / `event.detail` |
| --- | --- |
| `fireStart` | Request starts; `{url, method}` |
| `fireEnd` | Request and awaited response handling finish, including failures/cancellation; `{url, method, aborted}` |
| `fireError` | Transport, timeout or response-handling failure; `{error}` |
| `fireNavigate` | Successful page navigation, after Alpine's next tick; `{url}` |
| `fireValidation` | Parsed 422 validation response; `{envelope}` |
| `fireUnexpected` | Unrecognized response; `{response, envelope}` |

`fireEnd` is not a success signal. With overlapping foreground requests, `$fire.loading` remains true until all finish. Preloads and partials do not emit these request events; partial failures are available in their local `error` state. Expected cancellation does not emit `fireError`; timeouts do. JSON application errors are handled as envelopes and do not emit `fireError` automatically.

## TinyMVC / Spark

Install `tinymvc/fireline-php` and register its provider and middleware. See the [adapter README](https://github.com/tinymvc/fireline-php#readme) for conditional layouts, validation, CSRF and route examples. Other backends can implement the protocol above directly.

## Migrating from v1

- Update request detection from `X-Fireline-Agent` to `X-FireLine: 1`.
- Return JSON envelopes and a single-root page fragment for AJAX requests; serve the full layout on initial loads.
- `x-submit` remains supported; move to `x-form` and `$form()` for field-level validation and processing state.
- Send validation with HTTP 422 and an object of error arrays. Use HTTP errors for failures.
- Link/form interception remains opt-in. Shorthand Alpine attributes no longer need rewriting.
- Await navigation/submission methods when sequencing work. `fireEnd` also fires on errors and cancellation.
- Give stateful, reorderable elements stable `key` attributes. Changed directives intentionally reset their element.

## Upgrading the v2.1 preview

See [the changelog](CHANGELOG.md) for the release fixes.

The new partial API now retains its host and reconciles the host's children. If you used the early preview's outer-element replacement, return the content to place **inside** the host and move persistent controls outside it. Preloads no longer cancel navigation or run authentication/error callbacks. Invalid polling intervals are disabled, and partial polling rejects them explicitly.

## Development and release checks

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm pack --dry-run
```

For the real PHP adapter test, install Composer dependencies in the sibling `fireline-php` checkout, then run `npm run test:integration`. To use an installed Chrome instead of Playwright Chromium: `FIRELINE_BROWSER_CHANNEL=chrome npm run test:integration`.

The suite includes randomized keyed and mixed-tree reconciliation, real Alpine lifecycle tests, cache/request races, partial cleanup, transition failures, form validation, progress timing, browser scroll/asset-version checks and a keyed-reversal benchmark. To run another installed Playwright engine, set `FIRELINE_BROWSER=firefox` or `FIRELINE_BROWSER=webkit` (omit `FIRELINE_BROWSER_CHANNEL`). Browser timings depend on hardware and DOM complexity; no test suite establishes correctness for every possible DOM or third-party plugin. `prepack` rebuilds the CDN and ES module artifacts. Publishing is a separate maintainer action.

### Browser-runtime diagnostic

The local Playwright WebKit 26.0 runtime (build 2215) crashed on a full document navigation after same-document back/forward traversal. This also reproduced in `tests/webkit-history-repro.cjs`, which loads neither FireLine nor Alpine. The integration suite isolates browser scenarios in separate pages so the remaining checks can run. To reproduce the runtime issue separately, install Playwright WebKit and run `node tests/webkit-history-repro.cjs`. This is a browser-runtime validation limitation, not evidence that every Safari release is affected.
