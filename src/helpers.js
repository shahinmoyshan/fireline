import { replaceHtml } from "./dom";

export function triggerError(error) {
  console.error("FireLine failed:", error);
  document.dispatchEvent(window.FireLine.events.error);
  window.FireLine.context.loading = false;
}

export function safeReplaceHtml(html) {
  try {
    replaceRouterHtml(html);
  } catch (error) {
    triggerError(error);
  }
}

export function replaceRouterHtml(html) {
  const targetEl = document.querySelector(window.FireLine.settings.targetEl);
  if (!targetEl) throw new Error("Router target element not found.");
  replaceHtml(targetEl, html);
}
