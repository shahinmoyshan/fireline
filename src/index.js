import { navigateTo, formSubmission } from "./page";
import { safeReplaceHtml, canNavigate, canSubmit } from "./helpers";
import { setAlpine } from "./dom";
import { createForm } from "./form";
import { createPartial } from "./partial";
import { ajaxRequest } from "./fetch";
import { trackScroll, scrollPosition } from "./history";
import {
  showUnexpectedResponseModal,
  dismissUnexpectedResponseModal,
} from "./modal";

export default (Alpine) => {
  if (Alpine.fire && window.FireLine?.context === Alpine.fire) return;
  setAlpine(Alpine);

  const FireLine = Alpine.reactive({
    version: "2.1.0",
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
      preloadCacheTime: 30,
      preloadCacheSize: 50,
      viewTransitions: false,
      progressBar: false,
      progressColor: "#29d",
      assetVersion: null,
      focusOnError: false,
    },
    context: {
      current: window.location.href,
      loading: false,
      navigate: (url) => navigateTo(url),
      reload: () =>
        navigateTo(window.location.href, false, 0, { cache: false }),
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

  Alpine.directive(
    "navigate",
    (el, { expression, modifiers }, { evaluate, cleanup }) => {
      const onClick = (event) => {
        if (!canNavigate(event, el)) return;
        event.preventDefault();
        if (expression) evaluate(expression);
        navigateTo(el.href);
      };
      el.addEventListener("click", onClick);
      cleanup(() => el.removeEventListener("click", onClick));

      if (modifiers.includes("hover") || modifiers.includes("mouseover")) {
        const onEnter = () => preload(el);
        el.addEventListener("mouseenter", onEnter);
        cleanup(() => el.removeEventListener("mouseenter", onEnter));
      }
    },
  );

  const preload = (el) => {
    if (canNavigate({ button: 0 }, el))
      return ajaxRequest(el.href, "GET", null, null, { preload: true });
  };
  Alpine.directive("preload", (el, { modifiers }, { cleanup }) => {
    if (modifiers.includes("mouseover") || modifiers.includes("hover")) {
      const onEnter = () => preload(el);
      el.addEventListener("mouseenter", onEnter);
      cleanup(() => el.removeEventListener("mouseenter", onEnter));
    } else preload(el);
  });

  Alpine.directive("poll", (el, { expression }, { cleanup }) => {
    const ms = expression ? Number(expression) : 5000;
    if (!Number.isFinite(ms) || ms <= 0 || ms > 2147483647) return;
    let stopped = false,
      timer;
    const poll = async () => {
      if (stopped || !el.isConnected) return;
      if (
        !document.hidden &&
        navigator.onLine !== false &&
        !FireLine.context.loading
      )
        await navigateTo(window.location.href, false, 0, { cache: false });
      if (!stopped && el.isConnected) timer = setTimeout(poll, ms);
    };
    timer = setTimeout(poll, ms);
    cleanup(() => {
      stopped = true;
      clearTimeout(timer);
    });
  });

  Alpine.directive(
    "partial",
    (el, { expression, modifiers }, { evaluate, cleanup }) => {
      const state = expression ? evaluate(expression) : null;
      if (!state || typeof state.setTarget !== "function") return;
      state.setTarget(el);
      let observer;
      cleanup(() => {
        observer?.disconnect();
        state.dispose();
      });
      if (modifiers.includes("lazy") || modifiers.includes("intersect")) {
        if (typeof IntersectionObserver !== "function") {
          state.load();
          return;
        }
        observer = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            if (el.isConnected) state.load();
          }
        });
        observer.observe(el);
      }
    },
  );

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

  trackScroll();
  window.addEventListener("popstate", (event) =>
    navigateTo(window.location.href, false, 0, {
      cache: false,
      scroll: scrollPosition(event.state),
      restoreScroll: true,
    }),
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
