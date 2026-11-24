/**
 * @dotmix/cli/hmr-client/overlay — Dev-only error overlay & warning badge in Shadow DOM (D-189 E1).
 */

import { OVERLAY_CSS } from "./overlay-styles.js";

export const OVERLAY_SCRIPT = `
(function() {
  if (typeof window === "undefined" || customElements.get("mix-error-overlay")) return;

  const CSS_TEXT = ${JSON.stringify(OVERLAY_CSS)};

  const CODE_TITLES = {
    MIX_ERR_INVALID_KEY: "Invalid List Key",
    MIX_ERR_DUPLICATE_KEY: "Duplicate List Key",
    MIX_ERR_PARSE_SYNTAX: "Template Syntax Error",
    MIX_ERR_UNCLOSED_TAG: "Unclosed Template Tag",
    MIX_ERR_REACTIVE_CYCLE: "Reactive Cycle Detected",
    MIX_ERR_UNRESOLVED_IDENTIFIER: "Unresolved Identifier",
    MIX_ERR_INVALID_PROP_TYPE: "Type Check Error",
    MIX_WARN_IMPLICIT_DUPLICATE_KEY: "Duplicate Implicit Key",
    MIX_RUNTIME_ERROR: "Runtime Error",
    MIX_UNHANDLED_REJECTION: "Unhandled Promise Rejection",
    MIX_COMPILE_ERROR: "Compile Error"
  };

  function detectTheme() {
    const dt = document.documentElement.getAttribute("data-theme");
    if (dt === "light" || dt === "dark") return dt;
    if (document.documentElement.classList.contains("dark")) return "dark";
    if (document.documentElement.classList.contains("light")) return "light";
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    } catch {}
    return "dark";
  }

  function detectDir() {
    const d = document.documentElement.getAttribute("dir");
    if (d === "rtl" || d === "ltr") return d;
    try {
      return getComputedStyle(document.documentElement).direction || "ltr";
    } catch {
      return "ltr";
    }
  }

  function makeEl(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  class MixErrorOverlay extends HTMLElement {
    constructor() {
      super();
      this._errors = [];
      this._index = 0;
      this._prevFocus = null;
      this._onKeyDown = (ev) => this._handleKeyDown(ev);
      const shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CSS_TEXT;
      this._root = makeEl("div", "backdrop");
      shadow.append(style, this._root);
    }

    connectedCallback() {
      this._prevFocus = document.activeElement;
      this.setAttribute("data-theme", detectTheme());
      window.addEventListener("keydown", this._onKeyDown, true);
      this._render();
      requestAnimationFrame(() => {
        const dlg = this.shadowRoot && this.shadowRoot.querySelector(".dialog");
        if (dlg && typeof dlg.focus === "function") dlg.focus();
      });
    }

    disconnectedCallback() {
      window.removeEventListener("keydown", this._onKeyDown, true);
      if (this._prevFocus && typeof this._prevFocus.focus === "function") {
        try { this._prevFocus.focus(); } catch {}
      }
    }

    _handleKeyDown(ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        this.remove();
        return;
      }
      if (ev.key === "Tab" && this.shadowRoot) {
        const focusables = Array.from(this.shadowRoot.querySelectorAll("button, a[href], [tabindex]:not([tabindex='-1'])"))
          .filter((el) => !el.disabled);
        if (focusables.length === 0) return;
        const active = this.shadowRoot.activeElement;
        const idx = focusables.indexOf(active);
        ev.preventDefault();
        const nextIdx = ev.shiftKey
          ? (idx <= 0 ? focusables.length - 1 : idx - 1)
          : (idx === -1 || idx >= focusables.length - 1 ? 0 : idx + 1);
        focusables[nextIdx].focus();
      }
    }

    pushError(err) {
      const normalized = {
        code: err.code || "MIX_RUNTIME_ERROR",
        title: err.title || CODE_TITLES[err.code] || "Runtime Error",
        message: err.message || String(err),
        file: err.file || "",
        line: err.line || 0,
        column: err.column || 0,
        frame: err.frame || "",
        frameLines: err.frameLines || null,
        componentStack: Array.isArray(err.componentStack) ? err.componentStack : [],
        source: err.source || ""
      };
      this._errors.push(normalized);
      this._index = this._errors.length - 1;
      this.setAttribute("data-theme", detectTheme());
      this._render();
      return normalized;
    }

    updateFrame(targetErr, frameData) {
      if (!frameData) return;
      if (frameData.unavailable) {
        targetErr.file = frameData.file || targetErr.file;
        targetErr.line = frameData.line || targetErr.line;
        targetErr.column = frameData.column || targetErr.column;
        targetErr.frameLines = null;
        targetErr.frame = "";
        targetErr.unavailable = true;
        this._render();
        return;
      }
      if (!Array.isArray(frameData.lines)) return;
      targetErr.file = frameData.file || targetErr.file;
      targetErr.line = frameData.line || targetErr.line;
      targetErr.column = frameData.column || targetErr.column;
      targetErr.frameLines = frameData.lines;
      targetErr.unavailable = false;
      this._render();
    }

    setError(err) {
      this._errors = [];
      this._index = 0;
      return this.pushError(err);
    }

    _render() {
      const err = this._errors[this._index];
      if (!err) return;
      this._root.textContent = "";

      const dialog = makeEl("div", "dialog");
      dialog.setAttribute("role", "alertdialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-labelledby", "mix-err-title");
      dialog.setAttribute("tabindex", "-1");
      dialog.setAttribute("dir", detectDir());

      const header = makeEl("div", "header");
      const titleWrap = makeEl("div", "title-wrap");
      titleWrap.appendChild(makeEl("span", "badge", err.code));
      const h2 = makeEl("h2", "title", err.title);
      h2.id = "mix-err-title";
      titleWrap.appendChild(h2);
      header.appendChild(titleWrap);

      if (this._errors.length > 1) {
        const pager = makeEl("div", "pager");
        const prevBtn = makeEl("button", "btn", "←");
        prevBtn.type = "button";
        prevBtn.setAttribute("aria-label", "Previous error");
        prevBtn.disabled = this._index === 0;
        prevBtn.onclick = () => { if (this._index > 0) { this._index--; this._render(); } };
        const counter = makeEl("span", "pager-count", (this._index + 1) + " / " + this._errors.length);
        const nextBtn = makeEl("button", "btn", "→");
        nextBtn.type = "button";
        nextBtn.setAttribute("aria-label", "Next error");
        nextBtn.disabled = this._index >= this._errors.length - 1;
        nextBtn.onclick = () => { if (this._index < this._errors.length - 1) { this._index++; this._render(); } };
        pager.append(prevBtn, counter, nextBtn);
        header.appendChild(pager);
      }

      dialog.appendChild(header);

      if (err.file) {
        const locStr = err.file + (err.line ? (":" + err.line + (err.column ? (":" + err.column) : "")) : "");
        const fileRow = makeEl("div", "file-row");
        fileRow.appendChild(makeEl("span", "file", err.unavailable ? ("original position unavailable — " + locStr) : locStr));
        dialog.appendChild(fileRow);
      }

      dialog.appendChild(makeEl("pre", "message", err.message));

      if (!err.unavailable && err.frameLines && err.frameLines.length > 0) {
        const frameEl = makeEl("div", "frame");
        for (const row of err.frameLines) {
          const lineEl = makeEl("div", "frame-line" + (row.active ? " active" : ""));
          lineEl.appendChild(makeEl("span", "ln", String(row.num)));
          lineEl.appendChild(makeEl("span", "code", row.text));
          frameEl.appendChild(lineEl);
          if (row.active && err.column > 0) {
            const caretLine = makeEl("div", "frame-line caret-row");
            caretLine.appendChild(makeEl("span", "ln", ""));
            caretLine.appendChild(makeEl("span", "code", " ".repeat(Math.max(0, err.column - 1)) + "^"));
            frameEl.appendChild(caretLine);
          }
        }
        dialog.appendChild(frameEl);
      } else if (!err.unavailable && err.frame && err.frame !== err.message) {
        const frameEl = makeEl("pre", "frame");
        frameEl.style.padding = "10px 14px";
        frameEl.textContent = err.frame;
        dialog.appendChild(frameEl);
      }

      if (err.componentStack.length > 0) {
        const stackBox = makeEl("div", "stack-box");
        stackBox.appendChild(makeEl("div", "stack-label", "Component Stack"));
        for (const item of err.componentStack) {
          stackBox.appendChild(makeEl("div", "stack-item", "in " + item));
        }
        dialog.appendChild(stackBox);
      }

      const actions = makeEl("div", "actions");
      const btnGroup = makeEl("div", "btn-group");

      const copyBtn = makeEl("button", "btn btn-copy", "Copy");
      copyBtn.type = "button";
      copyBtn.onclick = () => {
        const text = [
          "[" + err.code + "] " + err.title,
          err.file ? (err.file + ":" + (err.line || 1) + ":" + (err.column || 1)) : "",
          err.message,
          err.frameLines ? err.frameLines.map((l) => (l.active ? "> " : "  ") + l.num + " | " + l.text).join("\\n") : err.frame,
          err.componentStack.length ? "Component stack:\\n" + err.componentStack.map((s) => "  in " + s).join("\\n") : ""
        ].filter(Boolean).join("\\n\\n");
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(() => { copyBtn.textContent = "Copied"; }).catch(() => {});
        }
      };
      btnGroup.appendChild(copyBtn);

      if (err.file) {
        const openBtn = makeEl("button", "btn btn-open", "Open in editor");
        openBtn.type = "button";
        openBtn.onclick = () => {
          fetch("/__mix/open-in-editor", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ file: err.file, line: err.line || 1, column: err.column || 1 })
          }).catch(() => {});
        };
        btnGroup.appendChild(openBtn);
      }

      const dismissBtn = makeEl("button", "btn dismiss", "Dismiss");
      dismissBtn.type = "button";
      dismissBtn.onclick = () => this.remove();
      btnGroup.appendChild(dismissBtn);

      actions.appendChild(btnGroup);

      const docs = makeEl("a", "docs-link", "Docs: " + err.code);
      docs.href = "https://dotmix.dev/docs/errors#" + encodeURIComponent(err.code);
      docs.target = "_blank";
      docs.rel = "noopener noreferrer";
      actions.appendChild(docs);

      dialog.appendChild(actions);
      this._root.appendChild(dialog);
    }
  }

  class MixWarningBadge extends HTMLElement {
    constructor() {
      super();
      this._warnings = [];
      this._open = false;
      const shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CSS_TEXT;
      this._wrap = makeEl("div", "warn-wrap");
      shadow.append(style, this._wrap);
    }

    addWarning(w) {
      this._warnings.push(w);
      this.setAttribute("data-theme", detectTheme());
      this._render();
    }

    _render() {
      this._wrap.textContent = "";
      this._wrap.setAttribute("dir", detectDir());
      if (this._warnings.length === 0) { this.remove(); return; }
      if (this._open) {
        const panel = makeEl("div", "warn-panel");
        panel.setAttribute("role", "status");
        for (const w of this._warnings) {
          panel.appendChild(makeEl("div", "warn-item", "[" + (w.code || "MIX_WARN") + "] " + (w.message || "")));
        }
        const clearBtn = makeEl("button", "btn", "Dismiss");
        clearBtn.type = "button";
        clearBtn.style.marginTop = "8px";
        clearBtn.onclick = () => { this._warnings = []; this.remove(); };
        panel.appendChild(clearBtn);
        this._wrap.appendChild(panel);
      }
      const pill = makeEl("button", "warn-pill", "⚠ " + this._warnings.length + (this._warnings.length === 1 ? " warning" : " warnings"));
      pill.type = "button";
      pill.onclick = () => { this._open = !this._open; this._render(); };
      this._wrap.appendChild(pill);
    }
  }

  customElements.define("mix-error-overlay", MixErrorOverlay);
  customElements.define("mix-warning-badge", MixWarningBadge);

  window.__mix_show_error = function(err) {
    let overlay = document.querySelector("mix-error-overlay");
    if (!overlay) {
      overlay = document.createElement("mix-error-overlay");
      overlay.setAttribute("id", "mix-error-overlay");
      (document.body || document.documentElement).appendChild(overlay);
    }
    const entry = overlay.pushError(err);
    if (entry.file && entry.line && !entry.frameLines) {
      const gen = err._generated ? "1" : "0";
      fetch("/__mix/frame?file=" + encodeURIComponent(entry.file) + "&line=" + entry.line + "&col=" + (entry.column || 1) + "&generated=" + gen)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => { if (data) overlay.updateFrame(entry, data); })
        .catch(() => {});
    }
  };

  window.__mix_show_warning = function(w) {
    let badge = document.querySelector("mix-warning-badge");
    if (!badge) {
      badge = document.createElement("mix-warning-badge");
      (document.body || document.documentElement).appendChild(badge);
    }
    badge.addWarning(w);
  };

  window.__mix_clear_error = function() {
    const overlay = document.querySelector("mix-error-overlay");
    if (overlay) overlay.remove();
  };
})();
`;
