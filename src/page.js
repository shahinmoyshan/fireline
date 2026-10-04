import { ajaxRequest } from "./fetch";
import { safeReplaceHtml } from "./helpers";
import { ResponseType } from "./response";

export function navigateTo(url, pushState = true) {
  ajaxRequest(url).then((envelope) => {
    if (!envelope) return;

    if (envelope.type === ResponseType.RENDER) {
      if (envelope.title) document.title = envelope.title;
      safeReplaceHtml(envelope.html);

      const completeNavigation = () => {
        if (pushState && window.FireLine.redirectedUrl === undefined)
          window.history.pushState({}, "", url);

        window.FireLine.context.current = window.location.href;

        if (window.FireLine.redirectedUrl === undefined)
          document.dispatchEvent(window.FireLine.events.navigate);
      };

      if (window.Alpine) {
        window.Alpine.nextTick(completeNavigation);
      } else {
        completeNavigation();
      }
    } else if (envelope.type === ResponseType.REDIRECT) {
      window.location.href = envelope.redirect;
    } else if (envelope.type === ResponseType.NAVIGATE) {
      navigateTo(envelope.navigate);
    }
  });
}

export function formSubmission(formEl, formState = null) {
  if (formState) {
    if (formState.processing) return; // Prevent double submission
    formState.processing = true;
    formState.reset();
  }

  const method = (formEl.getAttribute("method") || "GET").toUpperCase();
  let action = formEl.getAttribute("action") || window.location.href;
  const formData = new FormData(formEl);
  let body = formData;

  if (method === "GET") {
    const params = new URLSearchParams(formData);
    const urlObj = new URL(action, window.location.origin);
    urlObj.search = params.toString();
    action = urlObj.toString();
    body = null; // GET requests cannot have body
  }

  ajaxRequest(action, method, body)
    .then((envelope) => {
      if (!envelope) return;

      if (envelope.type === ResponseType.VALIDATION) {
        if (formState) {
          formState.errors = envelope.errors || {};
          formState.message = envelope.message;
          formState.status = "validation";
        } else {
          console.warn("FireLine: Validation response received but no form state was provided. Use x-form and Alpine form() to handle validation errors.");
        }
        return;
      }

      if (envelope.type === ResponseType.SUCCESS) {
        formEl.reset();
        if (formState) {
          formState.message = envelope.message;
          formState.status = "success";
        }
        return;
      }

      if (envelope.type === ResponseType.REDIRECT) {
        window.location.href = envelope.redirect;
        return;
      }

      if (envelope.type === ResponseType.NAVIGATE) {
        navigateTo(envelope.navigate);
        return;
      }

      if (
        envelope.type === ResponseType.ERROR ||
        envelope.type === ResponseType.MESSAGE
      ) {
        if (formState) {
          formState.message = envelope.message;
          formState.status = envelope.type === ResponseType.ERROR ? "error" : "success";
        }
        return;
      }

      if (envelope.type === ResponseType.RENDER) {
        if (envelope.title) document.title = envelope.title;
        formEl.reset();
        safeReplaceHtml(envelope.html);
      }
    })
    .finally(() => {
      if (formState) {
        formState.processing = false;
      }
    });
}
