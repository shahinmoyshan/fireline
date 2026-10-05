import { emit, httpUrl, triggerError } from "./helpers";
import { parseResponse, ResponseType } from "./response";
import { showUnexpectedResponseModal } from "./modal";

let currentGetRequestController = null;
let activeRequests = 0;

// consume keeps loading/fireEnd scoped to response handling as well as transport.
export async function ajaxRequest(
  path,
  method = "GET",
  body = null,
  consume = null,
) {
  method = method.toUpperCase();
  const isGet = method === "GET";
  const settings = window.FireLine.settings;
  if (isGet && settings.abortOnNewRequest) currentGetRequestController?.abort();
  const controller = new AbortController();
  if (isGet) currentGetRequestController = controller;
  let timer;
  let timedOut = false;
  activeRequests++;
  window.FireLine.context.loading = true;
  emit("start", { url: String(path), method });
  try {
    const url = httpUrl(path);
    if (url.origin !== location.origin)
      throw new Error("FireLine AJAX requests must be same-origin.");
    const headers = new Headers(settings.headers);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    headers.set("X-Requested-With", "XMLHttpRequest");
    headers.set("X-FireLine", "1");
    if (settings.csrfToken) headers.set("X-CSRF-TOKEN", settings.csrfToken);
    const options = {
      method,
      headers,
      signal: controller.signal,
      credentials: "same-origin",
      mode: "same-origin",
    };
    if (body !== null && method !== "GET" && method !== "HEAD")
      options.body = body;
    if (settings.timeout > 0)
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, settings.timeout * 1000);
    const response = await fetch(url.href, options);
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
      emit("unexpected", { response, envelope });
      if (typeof handler !== "function") {
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
      emit("validation", { envelope });
    }
    if (controller.signal.aborted) return null;
    if (consume) await consume(envelope);
    return envelope;
  } catch (error) {
    if (timedOut) triggerError(new Error("FireLine request timed out."));
    else if (!controller.signal.aborted) triggerError(error);
    return null;
  } finally {
    clearTimeout(timer);
    if (currentGetRequestController === controller)
      currentGetRequestController = null;
    activeRequests--;
    window.FireLine.context.loading = activeRequests > 0;
    emit("end", {
      url: String(path),
      method,
      aborted: controller.signal.aborted,
    });
  }
}
