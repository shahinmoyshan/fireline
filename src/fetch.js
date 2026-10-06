import { emit, httpUrl, triggerError } from "./helpers";
import { parseResponse, ResponseType } from "./response";
import { showUnexpectedResponseModal } from "./modal";
import { startProgress, stopProgress } from "./progress";

let currentGetRequestController = null;
let activeRequests = 0;
let cacheGeneration = 0;
const preloadCache = new Map();
const pendingPreloads = new Map();
const invalidateCache = () => {
  cacheGeneration++;
  preloadCache.clear();
};

// The consumer is part of the request lifecycle, including for cache hits.
export async function ajaxRequest(
  path,
  method = "GET",
  body = null,
  consume = null,
  options = {},
) {
  const {
    preload = false,
    partial = false,
    signal,
    throwOnError = false,
  } = options;
  const silent = preload || options.silent === true;
  const settings = window.FireLine.settings;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  let url,
    timer,
    timedOut = false,
    started = false,
    write = false,
    pendingKey;
  try {
    method = method.toUpperCase();
    const isGet = method === "GET";
    url = httpUrl(path);
    if (url.origin !== location.origin)
      throw new Error("FireLine AJAX requests must be same-origin.");
    if (preload && !isGet)
      throw new Error("Only GET requests can be preloaded.");
    if (controller.signal.aborted || options.current?.() === false) return null;
    const foregroundGet = isGet && !preload && !partial;
    if (foregroundGet) {
      if (settings.abortOnNewRequest) currentGetRequestController?.abort();
      currentGetRequestController = controller;
    }
    write = !["GET", "HEAD"].includes(method);
    if (write) invalidateCache();
    const generation = cacheGeneration;
    const headers = new Headers(settings.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    headers.set("X-Requested-With", "XMLHttpRequest");
    headers.set("X-FireLine", "1");
    headers.delete("X-FireLine-Preload");
    headers.delete("X-FireLine-Partial");
    if (partial) headers.set("X-FireLine-Partial", "1");
    if (settings.csrfToken) headers.set("X-CSRF-TOKEN", settings.csrfToken);
    const cacheUrl = new URL(url.href);
    cacheUrl.hash = "";
    const key = JSON.stringify([
      cacheUrl.href,
      [...headers],
      settings.assetVersion,
    ]);
    const ttl = Number(settings.preloadCacheTime ?? 30);
    const limit = Math.max(
      0,
      Math.floor(Number(settings.preloadCacheSize ?? 50)),
    );
    const useCache =
      isGet &&
      !partial &&
      options.cache !== false &&
      ttl > 0 &&
      Number.isFinite(ttl) &&
      limit > 0 &&
      Number.isFinite(limit);
    for (const [key, value] of preloadCache)
      if (value.expires <= Date.now()) preloadCache.delete(key);
    if (options.cache === false) preloadCache.delete(key);
    const cached = useCache ? preloadCache.get(key) : null;
    // A fresh foreground read must not be followed by an older hover result.
    if (isGet && !preload && !partial && !cached) cacheGeneration++;
    if (preload && cached) return cached.envelope;
    // Only speculative requests share transport. A click must not wait on a slow hover.
    pendingKey = preload ? JSON.stringify([generation, key]) : null;
    if (pendingKey && pendingPreloads.has(pendingKey)) {
      pendingKey = null;
      return await pendingPreloads.get(JSON.stringify([generation, key]));
    }
    if (!silent) {
      started = true;
      activeRequests++;
      window.FireLine.context.loading = true;
      if (activeRequests === 1) startProgress();
      emit("start", { url: url.href, method });
    }
    let response, envelope;
    if (cached) {
      preloadCache.delete(key);
      envelope = cached.envelope;
    } else {
      if (preload) headers.set("X-FireLine-Preload", "1");
      if (settings.timeout > 0)
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, settings.timeout * 1000);
      const transport = (async () => {
        response = await fetch(url.href, {
          method,
          headers,
          signal: controller.signal,
          credentials: "same-origin",
          mode: "same-origin",
          ...(body !== null && !["GET", "HEAD"].includes(method)
            ? { body }
            : {}),
        });
        const parsed = await parseResponse(response);
        parsed.url = response.url || url.href;
        parsed.redirected = response.redirected;
        parsed.assetVersion = response.headers.get("X-FireLine-Asset-Version");
        return parsed;
      })();
      if (pendingKey) pendingPreloads.set(pendingKey, transport);
      envelope = await transport;
      clearTimeout(timer);
    }
    if (timedOut) throw new Error("FireLine request timed out.");
    if (controller.signal.aborted || options.current?.() === false) return null;
    if (
      !preload &&
      envelope.type === ResponseType.RENDER &&
      settings.assetVersion != null &&
      envelope.assetVersion != null &&
      String(settings.assetVersion) !== envelope.assetVersion
    ) {
      invalidateCache();
      if (partial || (!isGet && !envelope.redirected)) location.reload();
      else location.assign(envelope.redirected ? envelope.url : url.href);
      return null;
    }
    const handler =
      !preload &&
      response &&
      (response.status === 401
        ? settings.onUnauthenticated
        : response.status === 403
          ? settings.onForbidden
          : response.status >= 500
            ? settings.onServerError
            : null);
    if (typeof handler === "function") await handler(response, envelope);
    if (controller.signal.aborted || options.current?.() === false) return null;
    if (!silent && envelope.type === ResponseType.UNEXPECTED) {
      emit("unexpected", { response, envelope });
      if (typeof handler !== "function") {
        if (typeof settings.onUnexpectedResponse === "function")
          await settings.onUnexpectedResponse(
            envelope.status,
            envelope.rawHtml,
          );
        else if (settings.showUnexpectedModal)
          showUnexpectedResponseModal(envelope.status, envelope.rawHtml);
      }
    } else if (!silent && envelope.type === ResponseType.VALIDATION)
      emit("validation", { envelope });
    if (controller.signal.aborted || options.current?.() === false) return null;
    if (preload) {
      if (
        useCache &&
        generation === cacheGeneration &&
        envelope.type === ResponseType.RENDER
      ) {
        while (preloadCache.size >= limit)
          preloadCache.delete(preloadCache.keys().next().value);
        preloadCache.set(key, { envelope, expires: Date.now() + ttl * 1000 });
      }
    } else if (consume)
      await consume(
        envelope,
        () => !controller.signal.aborted && options.current?.() !== false,
      );
    return envelope;
  } catch (error) {
    if (options.current?.() === false) return null;
    const failure = timedOut ? new Error("FireLine request timed out.") : error;
    if (timedOut || !controller.signal.aborted) {
      if (throwOnError) throw failure;
      if (!silent) triggerError(failure);
    }
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    if (pendingKey) pendingPreloads.delete(pendingKey);
    if (write) invalidateCache();
    if (currentGetRequestController === controller)
      currentGetRequestController = null;
    if (started) {
      activeRequests--;
      if (activeRequests === 0) stopProgress();
      window.FireLine.context.loading = activeRequests > 0;
      emit("end", {
        url: url.href,
        method,
        aborted: controller.signal.aborted,
      });
    }
  }
}
