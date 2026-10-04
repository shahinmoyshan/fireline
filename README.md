# FireLine

**FireLine** is a powerful Alpine.js plugin that enhances your web applications with advanced reactivity, seamless integration, and features like server-side rendering of Alpine.js components, form handling, and a robust router.

## Features

- Global reactive state management via `window.FireLine.settings`.
- Intercepts links and forms for dynamic client-side routing.
- Directives:
  - **`x-navigate`**: Enables dynamic routing using the built-in diffAndPatch algorithm.
  - **`x-form`**: Handles form submissions reactively with Alpine state integration (New in v2).
  - **`x-submit`**: Legacy form submission handler (stateless, DOM mutation).
- Server-side rendering integration for updated content.
- Inertia-style unexpected response modal for error debugging.
- Automatic event triggers for lifecycle management.
- Intelligent response parsing and detection.

## Installation

```shell
# Install
npm install fireline

# Setup
import FireLine from 'fireline'
import Alpine from 'alpinejs'

Alpine.plugin(FireLine)

window.Alpine = Alpine

Alpine.start()
```

Or include the plugin via CDN:

```html
<!-- Alpine Plugins -->
<script src="https://cdn.jsdelivr.net/npm/fireline@2.x.x/dist/cdn.min.js"></script>
 
<!-- Alpine Core -->
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
```

## Quick Start

```html 
<div id="app">
    <!-- Element to be replaced from here -->
    <div>
        <a x-navigate href="/about">Go to About</a>
        
        <form x-data="{ form: $form() }" x-form action="/api/submit" method="POST">
            <input type="text" name="email" :class="form.hasError('email') ? 'border-red-500' : ''" />
            <p x-show="form.hasError('email')" x-text="form.firstError('email')"></p>
            <button type="submit" :disabled="form.processing">Submit</button>
        </form>
    </div>
</div>
```

**NOTE:** Every HTML response should have only **one** root element.

## Configuration Reference

FireLine is globally configurable using the `window.FireLine.settings` object.

```js
window.FireLine.settings = {
    targetEl: '#app > div', // The element to replace with loaded content
    timeout: 30, // Timeout for the loading state in seconds
    interceptLinks: false, // Enable link interception globally
    interceptForms: false, // Enable form interception globally
    abortOnNewRequest: true, // Cancel in-flight request when a new one starts
    csrfToken: null, // String: injected as X-CSRF-TOKEN header
    headers: {}, // Additional headers for all requests
    showUnexpectedModal: true, // Show Inertia-style modal on non-JSON responses
    
    // Callbacks
    onUnauthenticated: null, // function(response) | called on 401
    onForbidden: null, // function(response) | called on 403
    onServerError: null, // function(response) | called on 5xx
    onUnexpectedResponse: null, // function(statusCode, html) | overrides modal
};
```

## Directives

### `x-navigate`
Dynamically loads and renders content:
```html
<a x-navigate href="/new-page">Navigate to New Page</a>
```
Uses `diffAndPatch` for DOM updates. Replace Alpine short attributes (e.g., `@click`) with full forms (`x-on:click`) to avoid compatibility issues.

### `x-form` (New)
Wires a form element to a `$form` state automatically. It reacts to server validation errors.
```html
<form x-data="{ form: $form() }" x-form action="/register" method="POST">
    <div x-show="form.message" x-text="form.message"></div>
    <input name="email" :class="form.hasError('email') ? 'border-red-500' : ''">
    <p x-show="form.hasError('email')" x-text="form.firstError('email')"></p>
    <button :disabled="form.processing">Submit</button>
</form>
```

### `x-submit` (Legacy)
Handles form submissions without Alpine reactive state binding. Error display relies on DOM mutation with `status` attributes.
```html
<form x-submit action="/submit-form" method="POST">
    <div status="success" style="color:green"></div>
    <div status="error" style="color:red"></div>
</form>
```

## `$fire` Magic Property

FireLine provides the `$fire` magic property to interact with the router directly from components.

- **`$fire.current`**: The current URL path.
- **`$fire.loading`**: Boolean indicating whether the router is currently loading.
- **`$fire.navigate(url)`**: Navigates to the specified URL.
- **`$fire.reload()`**: Reloads the current URL.
- **`$fire.replaceHtml(html)`**: Replaces the router content with the provided HTML.
- **`$fire.formSubmit(formEl)`**: Submits a form to the server and handles the response.

## Form State (`form()`)

The new form state manager makes it easy to handle loading, messages, and validation errors.

```js
// Usage inside Alpine x-data
x-data="{ ...form({ name: '', email: '' }) }"
```

Available reactive properties:
- **`$data.form.processing`**: boolean — true while submitting.
- **`$data.form.message`**: string — top-level response message.
- **`$data.form.errors`**: object — field-keyed error bag `{ name: ['...'], email: ['...'] }`.
- **`$data.form.status`**: string — 'success' | 'error' | 'validation' | null.
- **`$data.form.reset()`**: resets errors and message.
- **`$data.form.submit(formEl)`**: programmatic submission.
- **`$data.form.hasError(field)`**: boolean.
- **`$data.form.firstError(field)`**: string | null.

## Server Response Protocol

FireLine understands the following server response shapes automatically:

- **Render:** `{ html: '...', title: '...' }` (Replaces DOM content)
- **Redirect:** `{ redirect: '/url' }` (Hard redirect)
- **Navigate:** `{ navigate: '/url' }` (SPA pushState navigation)
- **Success:** `{ status: 'success', message: '...' }`
- **Validation:** `{ message: '...', errors: { email: ['Invalid'] } }` (HTTP 422)
- **Error:** `{ status: 'error', message: '...' }` (HTTP 400/500)

## Unexpected Response Modal

When the server returns a non-JSON body (e.g., a full HTML page for a 500 error, session timeout), FireLine displays an Inertia-style modal. This shows the exact error HTML rendered in an iframe for easy debugging. Disable it with `settings.showUnexpectedModal = false`.

## Events

FireLine emits the following events on `document`:

- `fireStart`: Start of navigation/submission.
- `fireEnd`: After successful navigation/submission.
- `fireError`: On catchable error.
- `fireNavigate`: On route change.
- `fireValidation`: When a 422 validation response is received.
- `fireUnexpected`: When a non-JSON unexpected response is received.

## Backend Integration

FireLine works with any backend that implements the JSON response protocol and checks for the `X-FireLine` header.

For TinyMVC/Spark, use the official adapter:
`composer require tinymvc/fireline-php`

## Migration Guide (v1.x → v2.0)

- The AJAX header sent is now `X-FireLine` (instead of `X-Fireline-Agent`).
- The response parser has been rewritten to be robust and structured. Ensure your backend returns the expected JSON schemas.
- `x-submit` retains legacy behavior, but we encourage migrating to `x-form` and `$data.form` for superior reactivity.