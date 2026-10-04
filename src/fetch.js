import { triggerError } from "./helpers";
import { parseResponse, ResponseType } from "./response";
import { showUnexpectedResponseModal } from "./modal";

let currentGetRequestController = null;

export async function ajaxRequest(path, method = "get", body = null) {
  const isGet = method.toUpperCase() === "GET";

  if (isGet && window.FireLine.settings.abortOnNewRequest && currentGetRequestController) {
    currentGetRequestController.abort();
  }
  
  const abortController = new AbortController();
  if (isGet) {
    currentGetRequestController = abortController;
  }

  // Fire the 'start' event
  document.dispatchEvent(window.FireLine.events.start);

  // Reset the redirected URL
  window.FireLine.redirectedUrl = undefined;

  // Set the loading state to true
  window.FireLine.context.loading = true;

  try {
    const headers = {
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      "X-FireLine": "1",
      ...window.FireLine.settings.headers,
    };

    if (window.FireLine.settings.csrfToken) {
      headers["X-CSRF-TOKEN"] = window.FireLine.settings.csrfToken;
    }

    const fetchOptions = {
      method: method,
      headers: headers,
      signal: abortController.signal,
    };

    if (body) {
      fetchOptions.body = body;
    }

    let timeoutId;
    if (window.FireLine.settings.timeout > 0) {
      timeoutId = setTimeout(
        () => abortController.abort("timeout"),
        1000 * window.FireLine.settings.timeout,
      );
    }

    const response = await fetch(path, fetchOptions);

    if (timeoutId) clearTimeout(timeoutId);

    if (response.redirected && response.url && !response.url.endsWith(path)) {
      const redirectedUrl = new URL(response.url);
      if (window.location.origin === redirectedUrl.origin) {
        if (window.FireLine.redirectedUrl === undefined) {
          window.history.pushState({}, "", redirectedUrl);
          window.FireLine.redirectedUrl = redirectedUrl;
          document.dispatchEvent(window.FireLine.events.navigate);
        }
      }
    }

    const envelope = await parseResponse(response);

    if (envelope.type === ResponseType.UNEXPECTED) {
      document.dispatchEvent(window.FireLine.events.unexpected);
      if (
        response.status === 401 &&
        typeof window.FireLine.settings.onUnauthenticated === "function"
      ) {
        window.FireLine.settings.onUnauthenticated(response);
      } else if (
        response.status === 403 &&
        typeof window.FireLine.settings.onForbidden === "function"
      ) {
        window.FireLine.settings.onForbidden(response);
      } else if (
        response.status >= 500 &&
        typeof window.FireLine.settings.onServerError === "function"
      ) {
        window.FireLine.settings.onServerError(response);
      } else if (
        typeof window.FireLine.settings.onUnexpectedResponse === "function"
      ) {
        window.FireLine.settings.onUnexpectedResponse(
          response.status,
          envelope.rawHtml,
        );
      } else if (window.FireLine.settings.showUnexpectedModal) {
        showUnexpectedResponseModal(response.status, envelope.rawHtml);
      }
    } else if (envelope.type === ResponseType.VALIDATION) {
      document.dispatchEvent(window.FireLine.events.validation);
    }

    return envelope;
  } catch (error) {
    if (error.name === "AbortError") {
      return null;
    }
    triggerError(error);
    return null;
  } finally {
    window.FireLine.context.loading = false;
    document.dispatchEvent(window.FireLine.events.end);
    if (isGet) {
        currentGetRequestController = null;
    }
  }
}
