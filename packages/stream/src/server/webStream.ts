/**
 * @mix/stream — Web Standards / WinterCG Edge Streaming SSR Engine
 *
 * Implements:
 * - Standard W3C / WinterCG `ReadableStream<Uint8Array>`, `Response`, and `Request`
 * - Compatible with Cloudflare Workers, Deno, Bun, Vercel Edge, Fastly, Netlify & Node.js 18+
 * - Mid-stream error-recovery boundaries without stream termination
 * - Per-request cryptographic CSP nonces via Web Crypto API
 */

import { setCspNonce } from "@mix/runtime";
import type {
  WebSsrOptions,
  WebSsrRenderContext,
  WebSsrRenderResult
} from "../types.js";

export function generateWebCspNonce(): string {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b !== undefined) {
        binary += String.fromCharCode(b);
      }
    }
    return btoa(binary);
  }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function escapeAttr(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeSafeJson(state: unknown): string {
  return JSON.stringify(state)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function isAsyncIterable(val: unknown): val is AsyncIterable<string> {
  return val !== null && typeof val === "object" && Symbol.asyncIterator in val;
}

function isSyncIterable(val: unknown): val is Iterable<string> {
  return val !== null && typeof val === "object" && Symbol.iterator in val;
}

/**
 * Creates a standard W3C ReadableStream of HTML byte chunks.
 */
export function renderToWebStream(
  options: WebSsrOptions,
  ctx: WebSsrRenderContext
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller): Promise<void> {
      const title = escapeAttr(options.title ?? "Mix Edge SSR Application");
      const styleTags = (options.styles ?? [])
        .map(
          (s) =>
            `<style data-mix-style="${escapeAttr(s.id)}" nonce="${escapeAttr(ctx.nonce)}">${s.css}</style>`
        )
        .join("\n  ");

      const headHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="csp-nonce-marker" content="active" />
  <meta name="csp-nonce" content="${escapeAttr(ctx.nonce)}" />
  <title>${title}</title>
  ${styleTags}
</head>
<body>
<div id="app">`;

      controller.enqueue(encoder.encode(headHtml));

      setCspNonce(ctx.nonce);
      try {
        const rendered: WebSsrRenderResult = options.render(ctx);
        if (typeof rendered === "string") {
          controller.enqueue(encoder.encode(rendered));
        } else if (isAsyncIterable(rendered)) {
          for await (const chunk of rendered) {
            controller.enqueue(encoder.encode(String(chunk)));
          }
        } else if (isSyncIterable(rendered)) {
          for (const chunk of rendered) {
            controller.enqueue(encoder.encode(String(chunk)));
          }
        } else {
          const awaited = await rendered;
          controller.enqueue(encoder.encode(String(awaited)));
        }
      } catch (err: unknown) {
        if (options.onError) {
          options.onError(err, ctx);
        }
        const fallback = options.errorFallback
          ? options.errorFallback(err, ctx)
          : `<div class="ssr-error-boundary" data-mix-ssr-error="true">SSR Error Boundary: ${escapeAttr(err instanceof Error ? err.message : String(err))}</div>`;
        controller.enqueue(encoder.encode(fallback));
      } finally {
        setCspNonce(null);
      }

      let stateScript = "";
      if (options.state !== undefined) {
        stateScript = `\n<script id="__MIX_SSR_STATE__" type="application/json" nonce="${escapeAttr(ctx.nonce)}">${serializeSafeJson(options.state)}</script>`;
      }

      const tailHtml = `</div>${stateScript}\n</body>\n</html>`;
      controller.enqueue(encoder.encode(tailHtml));
      controller.close();
    }
  });
}

/**
 * Creates a standard HTTP Web Response for Edge Runtimes (Cloudflare Workers, Deno, Bun, Vercel Edge).
 */
export function createWebResponse(
  request: Request,
  options: WebSsrOptions
): Response {
  const nonce = options.getNonce ? options.getNonce(request) : generateWebCspNonce();
  const url = request.url || "/";
  const ctx: WebSsrRenderContext = {
    request,
    url,
    nonce
  };

  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`
  ].join("; ");

  const stream = renderToWebStream(options, ctx);

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": cspHeader,
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-store"
    }
  });
}

/**
 * Creates a fetch request handler for Edge platforms (Cloudflare Workers, Deno, Bun).
 */
export function createEdgeHandler(
  options: WebSsrOptions
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    return createWebResponse(request, options);
  };
}
