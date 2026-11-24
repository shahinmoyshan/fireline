import { replaceContents } from "./dom";
import { httpUrl, triggerError } from "./helpers";

const proxyMap = new WeakMap();
const owns = (object, property) =>
  Object.prototype.hasOwnProperty.call(object, property);

export function getComponentProxy(target) {
  if (proxyMap.has(target)) return proxyMap.get(target);

  const proxy = new Proxy(target, {
    get(component, property) {
      if (property === "$fire" || property === "$proxy") return proxy;
      if (owns(component.state, property)) return component.state[property];
      if (property in component) {
        const value = component[property];
        return typeof value === "function" ? value.bind(component) : value;
      }
      // Alpine and Promise resolution inspect these without calling an action.
      if (typeof property === "symbol" || property === "then") return undefined;
      return (...params) => component.call(property, ...params);
    },
    set(component, property, value) {
      if (owns(component.state, property)) component.set(property, value);
      else component[property] = value;
      return true;
    },
  });

  proxyMap.set(target, proxy);
  return proxy;
}

function changedProperties(state, previous) {
  return Object.fromEntries(
    Object.entries(state).filter(
      ([key, value]) => JSON.stringify(value) !== JSON.stringify(previous[key]),
    ),
  );
}

/** State and actions for one server-rendered component. */
export function createReactiveComponent(initial = {}) {
  let syncTimer;
  let controller;
  let disposed = false;
  let pending = Promise.resolve();
  let serverState = JSON.stringify(initial.state || {});
  let syncDelay = 250;
  const handlers = [];

  return {
    id: initial.id,
    component: initial.component,
    checksum: initial.checksum,
    state: initial.state || {},
    errors: {},
    loading: false,
    loadingTarget: null,

    get $proxy() {
      return getComponentProxy(this);
    },

    get $fire() {
      return getComponentProxy(this);
    },

    init() {
      this.$watch("state", () => {
        if (JSON.stringify(this.state) !== serverState)
          this.queueSync(syncDelay);
        syncDelay = 250;
      });

      const win = this.$el.ownerDocument.defaultView;
      for (const [event, method] of Object.entries(initial.listeners || {})) {
        const handler = (event) => {
          const params =
            event.detail?.params ??
            (event.detail === undefined ? [] : [event.detail]);
          this.send(method, Array.isArray(params) ? params : [params]);
        };
        win.addEventListener(event, handler);
        handlers.push([event, handler, win]);
      }
    },

    destroy() {
      disposed = true;
      clearTimeout(syncTimer);
      controller?.abort();
      for (const [event, handler, win] of handlers)
        win.removeEventListener(event, handler);
      handlers.length = 0;
    },

    call(method, ...params) {
      return this.send(method, params);
    },

    get(property) {
      return this.state[property];
    },

    set(property, value, wait = 250) {
      if (!owns(this.state, property)) return;
      this.state[property] = value;
      syncDelay = wait;
      this.queueSync(wait);
    },

    queueSync(wait = 250) {
      clearTimeout(syncTimer);
      if (disposed) return;
      syncTimer = setTimeout(() => {
        if (JSON.stringify(this.state) !== serverState) this.send();
      }, wait);
    },

    send(method = "__sync", params = [], updates = {}) {
      clearTimeout(syncTimer);
      Object.assign(this.state, updates);
      // Actions share the latest server state and execute in invocation order.
      const request = pending.then(() => this.request(method, params));
      pending = request.catch(() => {});
      return request;
    },

    async request(method, params) {
      if (disposed) return null;
      clearTimeout(syncTimer);
      const state = JSON.parse(serverState);
      const sent = JSON.parse(JSON.stringify(this.state));
      const updates = changedProperties(sent, state);

      const settings = window.FireLine.settings;
      const current = () => !disposed && this.$el.isConnected;
      controller = new AbortController();
      let timeout;
      this.loading = true;
      this.loadingTarget = method === "__sync" ? null : method;

      try {
        const endpoint = httpUrl(
          settings.componentEndpoint || "/_fire/component",
        );
        if (endpoint.origin !== window.location.origin) {
          throw new Error("Component requests must use the current origin.");
        }
        const csrfToken =
          settings.csrfToken ||
          document.querySelector('meta[name="csrf-token"]')?.content;
        if (settings.timeout > 0) {
          timeout = setTimeout(
            () => controller.abort(),
            settings.timeout * 1000,
          );
        }
        const response = await fetch(endpoint.href, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
            "X-FireLine": "1",
            "X-FireLine-Component": "1",
            ...(csrfToken ? { "X-CSRF-TOKEN": csrfToken } : {}),
            ...settings.headers,
          },
          body: JSON.stringify({
            id: this.id,
            component: this.component,
            checksum: this.checksum,
            state,
            method,
            params,
            updates,
          }),
        });

        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(
            data?.error || `Component request failed (HTTP ${response.status})`,
          );
        }
        const data = await response.json();
        if (!current()) return null;

        if (data.redirect || data.navigate) {
          const url = httpUrl(data.redirect || data.navigate).href;
          if (data.redirect) window.location.href = url;
          else await window.FireLine.context.navigate(url);
          return data;
        }

        if (data.state) {
          // Preserve input entered while the server was processing this request.
          const edits = changedProperties(this.state, sent);
          serverState = JSON.stringify(data.state);
          this.state = { ...data.state, ...edits };
        }
        this.errors = data.errors || {};

        const content = this.$el.querySelector("[data-fire-content]");
        if (typeof data.html === "string" && content) {
          await replaceContents(
            content,
            data.html,
            false,
            endpoint.href,
            current,
          );
        }

        if (current()) {
          const win = this.$el.ownerDocument.defaultView;
          for (const { name, params } of data.events || []) {
            win.dispatchEvent(
              new win.CustomEvent(name, { detail: { params } }),
            );
          }
        }
        return data;
      } catch (error) {
        if (!disposed) triggerError(error);
        return null;
      } finally {
        clearTimeout(timeout);
        this.loading = false;
        this.loadingTarget = null;
        controller = null;
      }
    },
  };
}
