import { replaceHtml } from "./dom";

export function emit(name, detail = {}) {
  const event = window.FireLine.events[name];
  document.dispatchEvent(new CustomEvent(event.type, { detail }));
}

export function triggerError(error) {
  console.error("FireLine failed:", error);
  emit("error", { error });
}

export async function safeReplaceHtml(html) {
  try {
    return await replaceRouterHtml(html);
  } catch (error) {
    triggerError(error);
    return null;
  }
}

export function replaceRouterHtml(html, baseUrl, current) {
  const targetEl = document.querySelector(window.FireLine.settings.targetEl);
  if (!targetEl) throw new Error("Router target element not found.");
  return replaceHtml(targetEl, html, baseUrl, current);
}

export function httpUrl(value) {
  const url = new URL(value, document.baseURI);
  if (!["http:", "https:"].includes(url.protocol))
    throw new Error("FireLine requires an HTTP(S) URL.");
  return url;
}

export function canNavigate(event, anchor) {
  if (
    !anchor ||
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    anchor.hasAttribute("native") ||
    anchor.hasAttribute("download") ||
    (anchor.target && anchor.target !== "_self") ||
    !anchor.getAttribute("href")
  )
    return false;
  let url;
  try {
    url = httpUrl(anchor.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  // Let the browser handle same-page fragment links (including href="#").
  return !(
    url.pathname === location.pathname &&
    url.search === location.search &&
    anchor.href.includes("#")
  );
}

export function canSubmit(form, submitter) {
  const target =
    submitter?.getAttribute("formtarget") ?? form.getAttribute("target");
  const method =
    submitter?.getAttribute("formmethod") ??
    form.getAttribute("method") ??
    "get";
  if (
    form.hasAttribute("native") ||
    (target && target !== "_self") ||
    method.toLowerCase() === "dialog"
  )
    return false;
  try {
    return (
      httpUrl(
        submitter?.getAttribute("formaction") ??
          (form.getAttribute("action") || location.href),
      ).origin === location.origin
    );
  } catch {
    return false;
  }
}
