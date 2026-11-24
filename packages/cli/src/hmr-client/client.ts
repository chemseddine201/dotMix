/**
 * @dotmix/cli — Dev Server HMR & Runtime Error Client (D-153, D-189 E1)
 */

import { OVERLAY_SCRIPT } from "./overlay.js";

export const HMR_CLIENT_SCRIPT = `// @dotmix/cli HMR Client Runtime
import { setErrorReporter as __mixSetErrorReporter } from "/@modules/@dotmix/runtime/index.js";
${OVERLAY_SCRIPT}
(() => {
  if (typeof window === "undefined") return;

  const seenErrors = new WeakSet();
  let lastMsgSig = "";
  let lastMsgTs = 0;

  function markSeen(err, msg) {
    if (err && typeof err === "object") {
      if (seenErrors.has(err)) return true;
      seenErrors.add(err);
    }
    const now = Date.now();
    if (msg && msg === lastMsgSig && now - lastMsgTs < 250) return true;
    lastMsgSig = msg || "";
    lastMsgTs = now;
    return false;
  }

  function parseStackLocation(stack) {
    if (typeof stack !== "string") return null;
    const lines = stack.split("\\n");
    for (const line of lines) {
      const m = /(?:https?:\\/\\/[^\\s)]+)?(\\/src\\/[^\\s):?]+)(?:\\?[^:\\s)]*)?:(\\d+):(\\d+)/.exec(line);
      if (m) {
        return { file: m[1].replace(/^\\/+/, ""), line: parseInt(m[2], 10), column: parseInt(m[3], 10), _generated: true };
      }
    }
    return null;
  }

  function dispatchRuntimeError(err, info) {
    const isWarn = info && info.source === "warning";
    const msg = err instanceof Error ? err.message : String(err);
    const code = (info && info.code) || (err && typeof err === "object" && typeof err.code === "string" ? err.code : (info && info.source === "unhandledrejection" ? "MIX_UNHANDLED_REJECTION" : "MIX_RUNTIME_ERROR"));
    if (isWarn) {
      if (typeof window.__mix_show_warning === "function") {
        window.__mix_show_warning({ code, message: msg, file: info.file, line: info.line, column: info.column });
      }
      return;
    }
    if (markSeen(err, msg)) return;

    let file = (info && info.file) || "";
    let line = (info && info.line) || 0;
    let column = (info && info.column) || 0;
    let _generated = false;

    if (!file && err && typeof err === "object" && err.details && err.details.loc) {
      const l = err.details.loc;
      if (l.file) file = l.file;
      if (l.line) line = l.line;
      if (l.column) column = l.column;
    }
    if (!file && err instanceof Error && err.stack) {
      const parsed = parseStackLocation(err.stack);
      if (parsed) {
        file = parsed.file;
        line = parsed.line;
        column = parsed.column;
        _generated = true;
      }
    }

    if (typeof window.__mix_show_error === "function") {
      window.__mix_show_error({
        code,
        message: msg,
        file,
        line,
        column,
        _generated,
        componentStack: (info && info.componentStack) || [],
        source: (info && info.source) || "runtime"
      });
    }
  }

  // Hook into @dotmix/runtime error reporter synchronously before app mounts
  if (typeof __mixSetErrorReporter === "function") {
    __mixSetErrorReporter((err, info) => dispatchRuntimeError(err, info));
  }

  window.addEventListener("error", (ev) => {
    const err = ev.error || new Error(ev.message || "Uncaught error");
    const stackLoc = parseStackLocation(err && err.stack);
    const file = stackLoc ? stackLoc.file : (ev.filename ? ev.filename.replace(/^https?:\\/\\/[^/]+\\/?/, "").split("?")[0] : "");
    dispatchRuntimeError(err, {
      source: "window",
      file: file && file.startsWith("src/") ? file : (stackLoc ? stackLoc.file : ""),
      line: stackLoc ? stackLoc.line : (ev.lineno || 0),
      column: stackLoc ? stackLoc.column : (ev.colno || 0)
    });
  });

  window.addEventListener("unhandledrejection", (ev) => {
    const reason = ev.reason instanceof Error ? ev.reason : new Error(String(ev.reason ?? "Unhandled promise rejection"));
    dispatchRuntimeError(reason, { source: "unhandledrejection", code: "MIX_UNHANDLED_REJECTION" });
  });

  if (typeof EventSource === "undefined") return;

  let activeServerId = null;
  let lastSeq = 0;

  function sendAck(seq, ok, durationMs) {
    try {
      fetch("/__mix_hmr/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seq, ok, durationMs })
      }).catch(() => {});
    } catch {}
  }

  const source = new EventSource("/__mix_hmr");

  source.addEventListener("message", (event) => {
    const startMs = Date.now();
    try {
      const payload = JSON.parse(event.data);
      if (!payload) return;
      if (payload.seq !== undefined) lastSeq = payload.seq;

      if (payload.type === "connected") {
        if (activeServerId === null) {
          activeServerId = payload.serverId;
        } else if (activeServerId !== payload.serverId) {
          activeServerId = payload.serverId;
          window.location.reload();
        }
        return;
      }

      if (payload.type === "full-reload") {
        sendAck(payload.seq ?? 0, true, Date.now() - startMs);
        window.location.reload();
        return;
      }

      if (payload.type === "error") {
        if (typeof window.__mix_show_error === "function") {
          const e = payload.error || payload;
          window.__mix_show_error({ ...e, _generated: false });
        }
        sendAck(payload.seq ?? 0, true, Date.now() - startMs);
        return;
      }

      if (payload.type === "error-cleared") {
        if (typeof window.__mix_clear_error === "function") {
          window.__mix_clear_error();
        }
        return;
      }

      if (payload.type === "update") {
        if (typeof window.__mix_clear_error === "function") {
          window.__mix_clear_error();
        }
        try {
          const prev = parseInt(sessionStorage.getItem("__mix_update_count") || "0", 10);
          sessionStorage.setItem("__mix_update_count", String(prev + 1));
        } catch {}

        window.dispatchEvent(new CustomEvent("mix:hmr-update", { detail: payload }));

        if (payload.kind === "css" && typeof payload.cssContent === "string") {
          let el = document.head.querySelector('style[data-mix-file="' + payload.file + '"]') ||
                   document.head.querySelector('style[data-mix-dev-id="' + payload.file + '"]');
          if (!el) {
            el = document.createElement("style");
            el.setAttribute("data-mix-file", payload.file);
            el.setAttribute("data-mix-dev-id", payload.file);
            document.head.appendChild(el);
          }
          el.textContent = payload.cssContent;
          sendAck(payload.seq ?? 0, true, Date.now() - startMs);
          return;
        }

        if (payload.cssUpdated || payload.kind === "css") {
          import(payload.file + "?mix-css=1&t=" + payload.timestamp).then(() => {
            if (payload.kind === "css") sendAck(payload.seq ?? 0, true, Date.now() - startMs);
          }).catch(() => {
            if (payload.kind === "css") sendAck(payload.seq ?? 0, false, Date.now() - startMs);
          });
          if (payload.kind === "css") return;
        }

        import(payload.file + "?t=" + payload.timestamp).then((mod) => {
          const cb = window.__mix_hot_boundaries ? window.__mix_hot_boundaries.get(payload.file) : null;
          if (typeof cb === "function") {
            try { cb(mod); } catch (err) { dispatchRuntimeError(err, { source: "hmr" }); }
          }
          sendAck(payload.seq ?? 0, true, Date.now() - startMs);
        }).catch((err) => {
          dispatchRuntimeError(err, { source: "hmr" });
          sendAck(payload.seq ?? 0, false, Date.now() - startMs);
        });
      }
    } catch {}
  });
})();
`;
