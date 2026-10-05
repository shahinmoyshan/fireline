import { navigateTo, formSubmission } from "./page";
import { safeReplaceHtml, canNavigate, canSubmit } from "./helpers";
import { setAlpine } from "./dom";
import { createForm } from "./form";
import { createPartial } from "./partial";
import { ajaxRequest } from "./fetch";
import {
  showUnexpectedResponseModal,
  dismissUnexpectedResponseModal,
} from "./modal";

export default (Alpine) => {
  if (Alpine.fire && window.FireLine?.context === Alpine.fire) return;
  setAlpine(Alpine);

  const FireLine = Alpine.reactive({
    version: "2.0.0",
    name: "fireline",
    events: {
      start: new Event("fireStart"),
      end: new Event("fireEnd"),
      error: new Event("fireError"),
      navigate: new Event("fireNavigate"),
      validation: new Event("fireValidation"),
      unexpected: new Event("fireUnexpected"),
    },
    settings: {
      targetEl: "#app > div",
      timeout: 30,
      interceptLinks: false,
      interceptForms: false,
      abortOnNewRequest: true,
      csrfToken: null,
      headers: {},
      onUnauthenticated: null,
      onForbidden: null,
      onServerError: null,
      onUnexpectedResponse: null,
      showUnexpectedModal: true,
      executeScripts: true,
    },
    context: {
      current: window.location.href,
      loading: false,
      navigate: (url) => navigateTo(url),
      reload: () => navigateTo(window.location.href, false),
      replaceHtml: (html) => safeReplaceHtml(html),
      formSubmit: (formEl, formState = null, submitter = null) =>
        formSubmission(formEl, formState, submitter),
    },
  });

  window.FireLine = FireLine;
  window.FireLine.form = createForm;
  window.FireLine.partial = createPartial;
  window.FireLine.modal = {
    show: showUnexpectedResponseModal,
    dismiss: dismissUnexpectedResponseModal,
  };

  Alpine.fire = FireLine.context;
  Alpine.magic("fire", () => FireLine.context);
  Alpine.magic("form", () => createForm);
  Alpine.magic("partial", () => createPartial);

  Alpine.directive("navigate", (el, { expression }, { evaluate, cleanup }) => {
    const onClick = (event) => {
      if (!canNavigate(event, el)) return;
      event.preventDefault();
      if (expression) evaluate(expression);
      navigateTo(el.href);
    };
    el.addEventListener("click", onClick);
    cleanup(() => el.removeEventListener("click", onClick));
  });

  Alpine.directive("preload", (el, { modifiers }, { cleanup }) => {
    const url = el.getAttribute("href");
    if (!url) return;

    const doPreload = () =>
      ajaxRequest(url, "GET", null, null, { silent: true, preload: true });

    if (modifiers.includes("mouseover") || modifiers.includes("hover")) {
      const onEnter = () => doPreload();
      el.addEventListener("mouseenter", onEnter, { once: true });
      cleanup(() => el.removeEventListener("mouseenter", onEnter));
    } else {
      doPreload();
    }
  });

  Alpine.directive("poll", (el, { expression }, { cleanup }) => {
    const ms = expression ? parseInt(expression, 10) : 5000;
    const timer = setInterval(() => {
      if (el.isConnected) {
        navigateTo(window.location.href, false);
      } else {
        clearInterval(timer);
      }
    }, ms);
    cleanup(() => clearInterval(timer));
  });

  Alpine.directive("partial", (el, { expression }, { evaluate }) => {
    const partialState = expression ? evaluate(expression) : null;
    if (partialState && typeof partialState.setTarget === "function") {
      partialState.setTarget(el);
    }
  });

  const formStateFor = (el) => {
    const form = Alpine.$data(el).form;
    return form && typeof form.reset === "function" ? form : null;
  };
  const registerForm = (name, legacy = false) =>
    Alpine.directive(name, (el, { expression }, { evaluate, cleanup }) => {
      const onSubmit = (event) => {
        if (event.defaultPrevented || !canSubmit(el, event.submitter)) return;
        event.preventDefault();
        const result = expression ? evaluate(expression) : null;
        const state = legacy ? null : expression ? result : formStateFor(el);
        formSubmission(
          el,
          state && typeof state.reset === "function" ? state : null,
          event.submitter,
        );
      };
      el.addEventListener("submit", onSubmit);
      cleanup(() => el.removeEventListener("submit", onSubmit));
    });
  registerForm("form");
  registerForm("submit", true);

  window.addEventListener("popstate", () =>
    navigateTo(window.location.href, false),
  );
  window.addEventListener(
    "pageshow",
    (e) => e.persisted && window.location.reload(),
  );

  document.addEventListener("click", (event) => {
    if (!window.FireLine.settings.interceptLinks) return;
    const anchor = event.target.closest?.("a");
    if (
      !anchor ||
      anchor.hasAttribute("x-navigate") ||
      !canNavigate(event, anchor)
    )
      return;
    event.preventDefault();
    navigateTo(anchor.href);
  });

  document.addEventListener("submit", (event) => {
    if (!window.FireLine.settings.interceptForms || event.defaultPrevented)
      return;
    const form = event.target.closest?.("form");
    if (
      !form ||
      form.hasAttribute("x-form") ||
      form.hasAttribute("x-submit") ||
      !canSubmit(form, event.submitter)
    )
      return;
    event.preventDefault();
    formSubmission(form, formStateFor(form), event.submitter);
  });
};
