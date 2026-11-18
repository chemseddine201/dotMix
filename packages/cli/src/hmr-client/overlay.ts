/**
 * @dotmix/cli/hmr-client/overlay — Dev-only error overlay in an isolated Shadow DOM
 *
 * Implements:
 * - Traps compiler and runtime errors without tearing down app state
 * - Uses Shadow DOM to prevent app CSS interference
 * - Can be dismissed manually or automatically cleared when error resolves
 */

export const OVERLAY_SCRIPT = `
(function() {
  if (typeof window === "undefined" || customElements.get("mix-error-overlay")) return;

  class MixErrorOverlay extends HTMLElement {
    constructor() {
      super();
      const shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = \`
        :host {
          position: fixed;
          top: 0;
          left: 0;
          width: 100vw;
          height: 100vh;
          background: rgba(0, 0, 0, 0.85);
          color: #f87171;
          font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
          z-index: 999999;
          display: flex;
          align-items: center;
          justify-content: center;
          box-sizing: border-box;
          padding: 24px;
        }
        .container {
          background: #18181b;
          border: 1px solid #ef4444;
          border-radius: 8px;
          padding: 24px;
          max-width: 800px;
          width: 100%;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
          position: relative;
        }
        .title {
          font-size: 18px;
          font-weight: bold;
          margin-bottom: 8px;
          color: #fca5a5;
        }
        .file {
          color: #94a3b8;
          font-size: 14px;
          margin-bottom: 16px;
        }
        .message {
          color: #f1f5f9;
          white-space: pre-wrap;
          font-size: 14px;
          line-height: 1.5;
          margin: 0;
        }
        .dismiss {
          position: absolute;
          top: 12px;
          right: 12px;
          background: #27272a;
          border: none;
          color: #a1a1aa;
          cursor: pointer;
          font-size: 16px;
          border-radius: 4px;
          padding: 4px 8px;
        }
      \`;
      const container = document.createElement("div");
      container.className = "container";
      container.innerHTML = \`
        <button class="dismiss">×</button>
        <div class="title">[Mix Compile Error]</div>
        <div class="file"></div>
        <pre class="message"></pre>
      \`;
      const dismissBtn = container.querySelector(".dismiss");
      if (dismissBtn) {
        dismissBtn.onclick = () => this.remove();
      }
      shadow.appendChild(style);
      shadow.appendChild(container);
    }

    setError(err) {
      const shadow = this.shadowRoot;
      if (!shadow) return;
      const fileEl = shadow.querySelector(".file");
      const msgEl = shadow.querySelector(".message");
      if (fileEl) {
        fileEl.textContent = err.file ? (err.file + ":" + (err.line || 1) + ":" + (err.column || 1)) : "";
      }
      if (msgEl) {
        msgEl.textContent = err.frame || err.message || String(err);
      }
    }
  }

  customElements.define("mix-error-overlay", MixErrorOverlay);

  window.__mix_show_error = function(err) {
    let overlay = document.querySelector("mix-error-overlay");
    if (!overlay) {
      overlay = document.createElement("mix-error-overlay");
      overlay.setAttribute("id", "mix-error-overlay");
      (document.body || document.documentElement).appendChild(overlay);
    }
    if (typeof overlay.setError === "function") {
      overlay.setError(err);
    }
  };

  window.__mix_clear_error = function() {
    const overlay = document.querySelector("mix-error-overlay");
    if (overlay) overlay.remove();
  };
})();
`;

