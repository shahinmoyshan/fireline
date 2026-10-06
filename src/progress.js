let hideTimer, resetTimer, interval;
let value = 0;

export function startProgress() {
  clearTimeout(hideTimer);
  clearTimeout(resetTimer);
  clearInterval(interval);
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
  clearInterval(interval);
  clearTimeout(hideTimer);
  clearTimeout(resetTimer);
  const el = document.getElementById("fireline-progress");
  if (!el) return;
  if (!window.FireLine?.settings.progressBar) {
    el.remove();
    return;
  }
  el.style.width = "100%";
  hideTimer = setTimeout(() => {
    el.style.opacity = "0";
    resetTimer = setTimeout(() => {
      el.style.width = "0%";
    }, 200);
  }, 300);
}
