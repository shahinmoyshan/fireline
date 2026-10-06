// Keep scroll events cheap and avoid writing browser history on every frame.
const positions = new Map();
let timer,
  sequence = 0;
const session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
export const historyEntry = () => ({ __fireline: `${session}-${++sequence}` });

function entryKey() {
  if (typeof history.state?.__fireline !== "string")
    history.replaceState(
      { ...history.state, ...historyEntry() },
      "",
      location.href,
    );
  return history.state.__fireline;
}

function record(key) {
  const position = { x: window.scrollX, y: window.scrollY };
  positions.delete(key);
  positions.set(key, position);
  if (positions.size > 100) positions.delete(positions.keys().next().value);
  return position;
}

function commit(key, scroll) {
  if (history.state?.__fireline !== key) return;
  if (
    history.state.scroll?.x === scroll.x &&
    history.state.scroll?.y === scroll.y
  )
    return;
  history.replaceState({ ...history.state, scroll }, "", location.href);
}

export function saveScroll() {
  clearTimeout(timer);
  timer = null;
  const key = entryKey();
  commit(key, record(key));
}

export function scrollPosition(state) {
  clearTimeout(timer);
  timer = null;
  return positions.get(state?.__fireline) ?? state?.scroll;
}

export function trackScroll() {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  entryKey();
  window.addEventListener(
    "scroll",
    () => {
      if (window.FireLine.context.loading) return;
      const key = entryKey();
      record(key);
      if (timer == null)
        timer = setTimeout(() => {
          timer = null;
          const scroll = positions.get(key);
          if (scroll) commit(key, scroll);
        }, 1000);
    },
    { passive: true },
  );
  window.addEventListener("pagehide", saveScroll);
}
