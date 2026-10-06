import { ajaxRequest } from "./fetch";
import { replaceContents } from "./dom";
import { ResponseType } from "./response";

export function createPartial(url, initialData = {}) {
  // Keep transport objects out of Alpine's reactive state.
  let controller,
    generation = 0,
    disposed = false,
    intervalGeneration = 0;

  return {
    ...initialData,
    url,
    loading: false,
    error: null,
    intervalTimer: null,
    _target: null,
    setTarget(el) {
      this._target = el;
      disposed = false;
    },
    async load(append = false) {
      if (this.loading || !this.url || disposed) return null;
      const requestUrl = this.url;
      const id = ++generation;
      controller = new AbortController();
      const signal = controller.signal;
      this.loading = true;
      this.error = null;
      const current = () =>
        !disposed &&
        id === generation &&
        !signal.aborted &&
        this.url === requestUrl &&
        this._target?.isConnected;
      try {
        // x-init runs before x-partial mounts the target.
        await Promise.resolve();
        if (!current()) return null;
        return await ajaxRequest(
          requestUrl,
          "GET",
          null,
          async (envelope) => {
            if (!current()) return;
            if (envelope.type !== ResponseType.RENDER)
              throw new Error(
                envelope.message ||
                  `FireLine partial expected an HTML envelope (HTTP ${envelope.status}).`,
              );
            await replaceContents(
              this._target,
              envelope.html,
              append,
              envelope.url,
              current,
            );
          },
          {
            silent: true,
            partial: true,
            cache: false,
            signal,
            current,
            throwOnError: true,
          },
        );
      } catch (error) {
        if (current()) this.error = error.message;
        return null;
      } finally {
        if (id === generation) {
          this.loading = false;
          controller = null;
        }
      }
    },
    startInterval(ms = 5000) {
      ms = Number(ms);
      if (!Number.isFinite(ms) || ms <= 0 || ms > 2147483647)
        throw new RangeError(
          "Partial polling interval must be positive milliseconds, at most 2147483647.",
        );
      this.stopInterval();
      const id = intervalGeneration;
      const poll = async () => {
        if (disposed || id !== intervalGeneration) return;
        if (!this._target?.isConnected) {
          this.stopInterval();
          return;
        }
        if (!document.hidden && navigator.onLine !== false) await this.load();
        if (!disposed && id === intervalGeneration)
          this.intervalTimer = setTimeout(poll, ms);
      };
      this.intervalTimer = setTimeout(poll, ms);
    },
    stopInterval() {
      intervalGeneration++;
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    },
    dispose() {
      disposed = true;
      generation++;
      controller?.abort();
      controller = null;
      this.loading = false;
      this.stopInterval();
      this._target = null;
    },
    async loadMore(nextUrl) {
      if (this.loading || disposed) return null;
      const previous = this.url;
      this.url = nextUrl;
      const result = await this.load(true);
      if (!result && this.url === nextUrl) this.url = previous;
      return result;
    },
  };
}
