import { ajaxRequest } from "./fetch";
import { emit, httpUrl, replaceRouterHtml, triggerError } from "./helpers";
import { alpine } from "./dom";
import { ResponseType } from "./response";

let navigationId = 0;
const submitting = new WeakSet();

async function render(envelope, url, pushState, current = () => true) {
  if (!current()) return;

  await replaceRouterHtml(envelope.html, url ?? document.baseURI);

  if (!current()) return;
  if (envelope.title !== null) document.title = envelope.title;
  if (url) {
    const destination = httpUrl(url);
    if (pushState && destination.href !== location.href)
      history.pushState({}, "", destination.href);
    else if (!pushState && destination.href !== location.href)
      history.replaceState(history.state, "", destination.href);
    window.FireLine.context.current = location.href;
  }

  await alpine()?.nextTick();
  if (url && current()) emit("navigate", { url: location.href });
}

export async function navigateTo(url, pushState = true, depth = 0) {
  const id = ++navigationId;
  let destination;
  try {
    if (depth > 10)
      throw new Error("FireLine navigation redirect limit exceeded.");
    destination = httpUrl(url);
    if (destination.origin !== location.origin) {
      location.assign(destination.href);
      return null;
    }
  } catch (error) {
    triggerError(error);
    return null;
  }
  return ajaxRequest(destination.href, "GET", null, async (envelope) => {
    if (id !== navigationId) return;
    if (envelope.type === ResponseType.RENDER) {
      await render(
        envelope,
        envelope.redirected ? envelope.url : destination.href,
        pushState,
        () => id === navigationId,
      );
    } else if (envelope.type === ResponseType.REDIRECT) {
      location.assign(httpUrl(envelope.redirect).href);
    } else if (envelope.type === ResponseType.NAVIGATE) {
      await navigateTo(envelope.navigate, pushState, depth + 1);
    }
  });
}

function setFormResult(form, state, envelope) {
  const status =
    envelope.type === ResponseType.VALIDATION
      ? "validation"
      : envelope.type === ResponseType.ERROR
        ? "error"
        : "success";
  if (state) {
    state.message = envelope.message;
    state.status = status;
    if (status === "validation") state.errors = envelope.errors;
  } else {
    for (const el of form.querySelectorAll(
      '[status="success"], [status="error"]',
    )) {
      const visible =
        el.getAttribute("status") ===
        (status === "validation" ? "error" : status);
      el.textContent = visible ? (envelope.message ?? "") : "";
      el.style.display = visible ? "block" : "none";
    }
  }
}

export async function formSubmission(
  formEl,
  formState = null,
  submitter = null,
) {
  if (submitting.has(formEl) || formState?.processing) return null;
  submitting.add(formEl);
  try {
    if (formState) {
      formState.reset();
      formState.processing = true;
    }
    const method = (
      submitter?.getAttribute("formmethod") ??
      formEl.getAttribute("method") ??
      "GET"
    ).toUpperCase();
    if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method))
      throw new Error("Unsupported form method.");
    const actionAttribute =
      submitter?.getAttribute("formaction") ?? formEl.getAttribute("action");
    const action = httpUrl(actionAttribute || location.href);
    const data = submitter
      ? new FormData(formEl, submitter)
      : new FormData(formEl);
    let body = data;
    if (method === "GET") {
      const params = new URLSearchParams();
      for (const [key, value] of data)
        params.append(key, typeof value === "string" ? value : value.name);
      action.search = params.toString();
      body = null;
    }
    const id = method === "GET" ? ++navigationId : navigationId;
    const wasConnected = formEl.isConnected;
    const current = () => id === navigationId;
    return await ajaxRequest(action.href, method, body, async (envelope) => {
      // A completed write must not take over a page opened after submission.
      if (!current() || (wasConnected && !formEl.isConnected)) return;
      if (
        [
          ResponseType.SUCCESS,
          ResponseType.ERROR,
          ResponseType.MESSAGE,
          ResponseType.VALIDATION,
        ].includes(envelope.type)
      ) {
        if (envelope.type === ResponseType.SUCCESS)
          HTMLFormElement.prototype.reset.call(formEl);
        setFormResult(formEl, formState, envelope);
      } else if (envelope.type === ResponseType.REDIRECT) {
        location.assign(httpUrl(envelope.redirect).href);
      } else if (envelope.type === ResponseType.NAVIGATE) {
        await navigateTo(envelope.navigate);
      } else if (envelope.type === ResponseType.RENDER) {
        await render(
          envelope,
          envelope.redirected
            ? envelope.url
            : method === "GET"
              ? action.href
              : null,
          true,
          current,
        );
      }
    });
  } catch (error) {
    triggerError(error);
    return null;
  } finally {
    submitting.delete(formEl);
    if (formState) formState.processing = false;
  }
}
