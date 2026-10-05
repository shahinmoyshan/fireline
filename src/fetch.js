import { emit, httpUrl, triggerError } from "./helpers";
import { parseResponse, ResponseType } from "./response";
import { showUnexpectedResponseModal } from "./modal";
import { startProgress, stopProgress } from "./progress";

let currentGetRequestController = null;
let activeRequests = 0;
const preloadCache = new Map();

// consume keeps loading/fireEnd scoped to response handling as well as transport.
export async function ajaxRequest(
  path,
  method = "GET",
  body = null,
  consume = null,
  options = {},
) {
  method = method.toUpperCase();
  const isGet = method === "GET";
  const { silent = false, preload = false, partial = false } = options;
  const settings = window.FireLine.settings;
  const url = httpUrl(path);

  if (isGet && !preload) {
    const cached = preloadCache.get(url.href);
    if (cached && cached.expires > Date.now()) {
      preloadCache.delete(url.href);
      if (consume) await consume(cached.envelope);
      return cached.envelope;
    }
    preloadCache.delete(url.href);
  }

  if (isGet && !preload && settings.abortOnNewRequest)
    currentGetRequestController?.abort();
  const controller = new AbortController();
  if (isGet && !preload) currentGetRequestController = controller;
  let timer;
  let timedOut = false;

  if (!silent) {
    activeRequests++;
    window.FireLine.context.loading = true;
    if (activeRequests === 1) startProgress();
    emit("start", { url: url.href, method });
  }

  try {
    if (url.origin !== location.origin)
      throw new Error("FireLine AJAX requests must be same-origin.");
    const headers = new Headers(settings.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    headers.set("X-Requested-With", "XMLHttpRequest");
    headers.set("X-FireLine", "1");
    if (preload) headers.set("X-FireLine-Preload", "1");
    if (partial) headers.set("X-FireLine-Partial", "1");
    if (settings.csrfToken) headers.set("X-CSRF-TOKEN", settings.csrfToken);

    const fetchOptions = {
      method,
      headers,
      signal: controller.signal,
      credentials: "same-origin",
      mode: "same-origin",
    };

    if (body !== null && method !== "GET" && method !== "HEAD")
      fetchOptions.body = body;

    if (settings.timeout > 0)
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, settings.timeout * 1000);

    const response = await fetch(url.href, fetchOptions);

    if (response.headers.has('X-FireLine-Asset-Version')) {
      const serverVersion = response.headers.get('X-FireLine-Asset-Version');
      if (settings.assetVersion && settings.assetVersion !== serverVersion) {
        window.location.reload();
        return null;
      }
    }

    const envelope = await parseResponse(response);
    clearTimeout(timer);

    if (controller.signal.aborted) {
      if (timedOut) throw new Error("FireLine request timed out.");
      return null;
    }

    envelope.url = response.url || url.href;
    envelope.redirected = response.redirected;

    const handler =
      response.status === 401
        ? settings.onUnauthenticated
        : response.status === 403
          ? settings.onForbidden
          : response.status >= 500
            ? settings.onServerError
            : null;

    if (typeof handler === "function") await handler(response, envelope);
    if (controller.signal.aborted) return null;

    if (envelope.type === ResponseType.UNEXPECTED) {
      if (!silent) emit("unexpected", { response, envelope });
      if (typeof handler !== "function" && !silent) {
        if (typeof settings.onUnexpectedResponse === "function") {
          await settings.onUnexpectedResponse(
            response.status,
            envelope.rawHtml,
          );
        } else if (settings.showUnexpectedModal) {
          showUnexpectedResponseModal(response.status, envelope.rawHtml);
        }
      }
    } else if (envelope.type === ResponseType.VALIDATION) {
      if (!silent) emit("validation", { envelope });
    }

    if (controller.signal.aborted) return null;

    if (preload && isGet && envelope.type === ResponseType.RENDER) {
      preloadCache.set(url.href, {
        envelope,
        expires: Date.now() + 1000 * (settings.preloadCacheTime || 30),
      });
    } else if (consume) {
      await consume(envelope);
    }

    return envelope;
  } catch (error) {
    if (timedOut) triggerError(new Error("FireLine request timed out."));
    else if (!controller.signal.aborted) triggerError(error);
    return null;
  } finally {
    clearTimeout(timer);
    if (currentGetRequestController === controller)
      currentGetRequestController = null;
    if (!silent) {
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
