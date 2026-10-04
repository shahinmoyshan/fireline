import { navigateTo, formSubmission } from "./page";
import { safeReplaceHtml } from "./helpers";
import { createForm } from "./form";
import {
  showUnexpectedResponseModal,
  dismissUnexpectedResponseModal,
} from "./modal";

export default (Alpine) => {
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
    },
    context: {
      current: window.location.href,
      loading: false,
      redirectedUrl: undefined,
      navigate: (url) => navigateTo(url),
      reload: () => navigateTo(window.location.href),
      replaceHtml: (html) => safeReplaceHtml(html),
      formSubmit: (formEl) => formSubmission(formEl),
    },
  });

  window.FireLine = FireLine;
  window.FireLine.form = createForm;
  window.FireLine.modal = {
    show: showUnexpectedResponseModal,
    dismiss: dismissUnexpectedResponseModal,
  };

  Alpine.fire = FireLine.context;
  Alpine.magic("fire", () => FireLine.context);
  Alpine.magic("form", () => createForm);

  Alpine.directive("navigate", (el, { expression }, { evaluate, cleanup }) => {
    const onClick = (event) => {
      event.preventDefault();
      const url = el.getAttribute("href");
      if (!url) return;
      if (expression) evaluate(expression);
      navigateTo(url);
    };
    el.addEventListener("click", onClick);
    cleanup(() => el.removeEventListener("click", onClick));
  });

  Alpine.directive("form", (el, { expression }, { evaluate, cleanup }) => {
    const onSubmit = (event) => {
      event.preventDefault();

      let formState = null;
      if (expression) {
        formState = evaluate(expression);
      } else {
        const data = el._x_dataStack
          ? Object.assign({}, ...el._x_dataStack.reverse())
          : {};
        formState = data.form;
      }

      if (formState && typeof formState.reset === "function") {
        formSubmission(el, formState);
      } else {
        formSubmission(el, null);
      }
    };
    el.addEventListener("submit", onSubmit);
    cleanup(() => el.removeEventListener("submit", onSubmit));
  });

  window.addEventListener("popstate", () =>
    navigateTo(window.location.href, false),
  );
  window.addEventListener(
    "pageshow",
    (e) => e.persisted && window.location.reload(),
  );

  window.document.body.addEventListener("click", (event) => {
    if (window.FireLine.settings.interceptLinks === false) return;
    const anchor = event.target.closest("a");
    if (
      anchor &&
      !anchor.hasAttribute("native") &&
      !anchor.hasAttribute("x-navigate") &&
      anchor.target !== "_blank" &&
      anchor.hostname === window.location.hostname
    ) {
      event.preventDefault();
      const url = anchor.getAttribute("href");
      if (!url) return;
      navigateTo(url);
    }
  });

  window.document.body.addEventListener("submit", (event) => {
    if (window.FireLine.settings.interceptForms === false) return;
    const formEl = event.target.closest("form");
    if (
      formEl &&
      !formEl.hasAttribute("native") &&
      !formEl.hasAttribute("x-form") &&
      formEl.action.startsWith(window.location.origin)
    ) {
      event.preventDefault();
      
      // Attempt to extract form state if bound without x-form directive
      const data = formEl._x_dataStack
        ? Object.assign({}, ...formEl._x_dataStack.reverse())
        : {};
      const formState =
        data.form && typeof data.form.reset === "function" ? data.form : null;

      formSubmission(formEl, formState);
    }
  });
};
