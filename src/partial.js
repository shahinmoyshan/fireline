import { ajaxRequest } from "./fetch";
import { replaceHtml } from "./dom";

export function createPartial(url, initialData = {}) {
  return {
    ...initialData,
    url,
    loading: false,
    error: null,
    intervalTimer: null,
    _target: null,

    setTarget(el) {
      this._target = el;
    },

    async load(append = false) {
      if (this.loading || !this.url) return;
      this.loading = true;
      this.error = null;

      try {
        await ajaxRequest(
          this.url,
          "GET",
          null,
          async (envelope) => {
            if (envelope && envelope.html) {
              if (append) {
                // Append HTML and init new nodes
                const template = document.createElement("template");
                template.innerHTML = envelope.html.trim();
                const frag = template.content;
                const newNodes = Array.from(frag.childNodes);
                this._target.appendChild(frag);
                if (window.Alpine) {
                  newNodes.forEach((node) => {
                    if (node.nodeType === 1) window.Alpine.initTree(node);
                  });
                }
              } else {
                this._target = await replaceHtml(this._target, envelope.html);
              }
            }
          },
          { silent: true, partial: true },
        );
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    },

    startInterval(ms) {
      this.stopInterval();
      this.intervalTimer = setInterval(() => this.load(), ms);
    },

    stopInterval() {
      if (this.intervalTimer) {
        clearInterval(this.intervalTimer);
        this.intervalTimer = null;
      }
    },

    async loadMore(nextUrl) {
      this.url = nextUrl;
      await this.load(true);
    },
  };
}
