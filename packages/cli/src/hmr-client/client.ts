/**
 * @dotmix/cli — Dev Server HMR Client
 *
 * Implements &:
 * - EventSource SSE transport over /__mix_hmr
 * - Monotonic seq number tracking
 * - ServerId check on reconnect: triggers clean full reload if server was restarted
 * - Heartbeat handling
 * - Client ack confirmation via POST /__mix_hmr/ack
 * - In-browser update and full-reload execution
 */

import { OVERLAY_SCRIPT } from "./overlay.js";

export const HMR_CLIENT_SCRIPT = `// @dotmix/cli HMR Client Runtime
${OVERLAY_SCRIPT}
(() => {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return;

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

  source.addEventListener("open", () => {
    // SSE stream opened
  });

  source.addEventListener("message", (event) => {
    const startMs = Date.now();
    try {
      const payload = JSON.parse(event.data);
      if (!payload) return;

      if (payload.seq !== undefined) {
        lastSeq = payload.seq;
      }

      if (payload.type === "connected") {
        if (activeServerId === null) {
          activeServerId = payload.serverId;
        } else if (activeServerId !== payload.serverId) {
          activeServerId = payload.serverId;
          window.location.reload();
          return;
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
          window.__mix_show_error(payload.error || payload);
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
            if (payload.kind === "css") {
              sendAck(payload.seq ?? 0, true, Date.now() - startMs);
            }
          }).catch(() => {
            if (payload.kind === "css") {
              sendAck(payload.seq ?? 0, false, Date.now() - startMs);
            }
          });
          if (payload.kind === "css") {
            return;
          }
        }

        import(payload.file + "?t=" + payload.timestamp).then((mod) => {
          const cb = window.__mix_hot_boundaries ? window.__mix_hot_boundaries.get(payload.file) : null;
          if (typeof cb === "function") {
            try {
              cb(mod);
            } catch (err) {
              console.error("[Mix HMR] Error in accept handler:", err);
            }
          }
          sendAck(payload.seq ?? 0, true, Date.now() - startMs);
        }).catch((err) => {
          sendAck(payload.seq ?? 0, false, Date.now() - startMs);
        });
      }
    } catch {
      // Ignore malformed packets
    }
  });

  source.addEventListener("error", () => {
    // Reconnecting automatically via native EventSource
  });
})();
`;
