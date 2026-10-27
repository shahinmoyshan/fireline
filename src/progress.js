let showTimer, hideTimer, resetTimer, interval;
let value = 0;

export function startProgress() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  clearTimeout(resetTimer);
  clearInterval(interval);
  const el = document.getElementById("fireline-progress");
  if (!window.FireLine?.settings.progressBar) {
    el?.remove();
    return;
  }
  const configuredDelay = Number(window.FireLine.settings.progressDelay ?? 200);
  const delay =
    Number.isFinite(configuredDelay) &&
    configuredDelay >= 0 &&
    configuredDelay <= 2147483647
      ? configuredDelay
      : 200;
  // Reuse a visible bar across consecutive requests without a hide/show flash.
  if (delay === 0 || el?.style.opacity === "1") showProgress();
  else showTimer = setTimeout(showProgress, delay);
}

function showProgress() {
  showTimer = null;
  let el = document.getElementById("fireline-progress");
  if (!window.FireLine?.settings.progressBar) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "fireline-progress";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText =
      "position:fixed;top:0;left:0;width:0%;height:3px;transition:width 200ms ease-out,opacity 200ms ease-out;z-index:999999;pointer-events:none";
    document.body.appendChild(el);
  }
  el.style.backgroundColor = window.FireLine.settings.progressColor || "#29d";
  el.style.opacity = "1";
  el.style.width = "5%";
  value = 5;
  interval = setInterval(() => {
    value = Math.min(90, value + Math.random() * 5);
    el.style.width = `${value}%`;
    if (value >= 90) clearInterval(interval);
  }, 200);
}

export function stopProgress() {
  clearTimeout(showTimer);
  clearInterval(interval);
  clearTimeout(hideTimer);
  clearTimeout(resetTimer);
  const el = document.getElementById("fireline-progress");
  if (!el) return;
  if (!window.FireLine?.settings.progressBar) {
    el.remove();
    return;
  }
  // A fast request must not reveal an existing, hidden bar on completion.
  if (el.style.opacity !== "1") return;
  el.style.width = "100%";
  hideTimer = setTimeout(() => {
    el.style.opacity = "0";
    resetTimer = setTimeout(() => {
      el.style.width = "0%";
    }, 200);
  }, 300);
}
