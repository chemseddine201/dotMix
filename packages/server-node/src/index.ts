/**
 * @mix/server-node — Node.js HTTP Streaming SSR Server Adapter (Gate 29 / T-29.4)
 *
 * Provides:
 * - Streaming HTML response pipeline (`renderToStream` / async iterables / strings)
 * - Error-recovery boundaries catching mid-stream component failures without dropping the HTTP connection
 * - Per-request cryptographic CSP nonces (`Content-Security-Policy` header + `<meta name="csp-nonce">` + `<style nonce="...">`)
 */

import http from "node:http";
import crypto from "node:crypto";
import { setCspNonce } from "@mix/runtime";

export interface SsrStyleSheet {
  readonly id: string;
  readonly css: string;
}

export type SsrRenderResult =
  | string
  | Promise<string>
  | AsyncIterable<string>
  | Iterable<string>;

export interface SsrRenderContext {
  readonly req: http.IncomingMessage;
  readonly res: http.ServerResponse;
  readonly url: string;
  readonly nonce: string;
}

export interface SsrServerOptions {
  port?: number | undefined;
  host?: string | undefined;
  title?: string | undefined;
  styles?: readonly SsrStyleSheet[] | undefined;
  state?: unknown;
  getNonce?: ((req: http.IncomingMessage) => string) | undefined;
  render: (ctx: SsrRenderContext) => SsrRenderResult;
  errorFallback?: ((error: unknown, ctx: SsrRenderContext) => string) | undefined;
  onError?: ((error: unknown, ctx: SsrRenderContext) => void) | undefined;
}

export interface SsrServerHandle {
  readonly server: http.Server;
  readonly port: number;
  readonly host: string;
  readonly url: string;
  close(): Promise<void>;
}

export function generateCspNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

function escapeAttr(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function serializeSafeJsonState(state: unknown): string {
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
  return (
    val !== null &&
    typeof val === "object" &&
    Symbol.iterator in val
  );
}

export function createSsrHandler(options: SsrServerOptions): http.RequestListener {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const nonce = options.getNonce ? options.getNonce(req) : generateCspNonce();
    const ctx: SsrRenderContext = {
      req,
      res,
      url: req.url ?? "/",
      nonce
    };

    const cspHeader = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}'`,
      `style-src 'self' 'nonce-${nonce}'`
    ].join("; ");

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", cspHeader);
    res.setHeader("Transfer-Encoding", "chunked");
    res.setHeader("Cache-Control", "no-store");

    const title = escapeAttr(options.title ?? "Mix SSR Application");
    const styleTags = (options.styles ?? [])
      .map(
        (s) =>
          `<style data-mix-style="${escapeAttr(s.id)}" nonce="${escapeAttr(nonce)}">${s.css}</style>`
      )
      .join("\n  ");

    const headHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name=" csp-nonce-marker" content="active" />
  <meta name="csp-nonce" content="${escapeAttr(nonce)}" />
  <title>${title}</title>
  ${styleTags}
</head>
<body>
<div id="app">`;

    res.write(headHtml);

    setCspNonce(nonce);
    try {
      const rendered = options.render(ctx);
      if (typeof rendered === "string") {
        res.write(rendered);
      } else if (isAsyncIterable(rendered)) {
        for await (const chunk of rendered) {
          res.write(String(chunk));
        }
      } else if (isSyncIterable(rendered)) {
        for (const chunk of rendered) {
          res.write(String(chunk));
        }
      } else {
        const awaited = await rendered;
        res.write(String(awaited));
      }
    } catch (err: unknown) {
      if (options.onError) {
        options.onError(err, ctx);
      }
      const fallbackHtml = options.errorFallback
        ? options.errorFallback(err, ctx)
        : `<div class="ssr-error-boundary" data-mix-ssr-error="true">SSR Error Boundary: ${escapeAttr(err instanceof Error ? err.message : String(err))}</div>`;
      res.write(fallbackHtml);
    } finally {
      setCspNonce(null);
    }

    let stateScript = "";
    if (options.state !== undefined) {
      stateScript = `\n<script id="__MIX_SSR_STATE__" type="application/json" nonce="${escapeAttr(nonce)}">${serializeSafeJsonState(options.state)}</script>`;
    }

    res.end(`</div>${stateScript}\n</body>\n</html>`);
  };
}

export async function createSsrServer(options: SsrServerOptions): Promise<SsrServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 0;
  const handler = createSsrHandler(options);
  const server = http.createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => resolve());
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;

  return {
    server,
    port: actualPort,
    host,
    url: `http://${host}:${actualPort}`,
    async close(): Promise<void> {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}
