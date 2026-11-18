/**
 * @dotmix/cli — `mix dev` Development Server with @dotmix/vite-plugin Pipeline, HMR, Bare-Specifier Resolution & SPA Fallback
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { URL } from "node:url";
import { mix } from "@dotmix/vite-plugin";
import { replaceImportMetaEnv, transpileSourceModule } from "@dotmix/compiler-semantic";
import { compileCss, preprocessCss } from "@dotmix/compiler-css";
import { STYLE_FILE_REGEX } from "./scanner.js";
import { createFileWatcher } from "./watcher.js";
import { ModuleGraph } from "./module-graph.js";
import {
  HMR_CLIENT_SOURCE, rewriteModuleImportsForDev, resolveDevSourceFile,
  resolveMixModuleFile, resolveMixPackageRequest, getOrSynthesizeIndexHtml, createStyleInjectorJs
} from "./specifier-rewriter.js";
import { servePublicFile } from "./public-files.js";
import { normalizeDriveLetter } from "./normalize-path.js";
import { buildImportMetaEnvValues } from "./env-files.js";

export { HMR_CLIENT_SOURCE, rewriteModuleImportsForDev, resolveMixModuleFile, resolveMixPackageRequest };

export interface DevServerOptions {
  rootDir?: string;
  port?: number;
  host?: string;
  silent?: boolean;
  mode?: string;
  cors?: boolean;
}

export interface HmrUpdatePayload {
  readonly type: "update";
  readonly file: string;
  readonly timestamp: number;
  readonly cssUpdated: boolean;
  readonly kind?: "js" | "css";
  readonly cssContent?: string;
  readonly seq?: number;
}

interface DiagnosticLike {
  code?: string;
  message?: string;
  span?: { start?: { line?: number; column?: number } };
  frame?: string;
}

export interface DevServerHandle {
  readonly port: number;
  readonly host: string;
  readonly url: string;
  readonly hmrUpdates: HmrUpdatePayload[];
  notifyFileChange(filePath: string): HmrUpdatePayload;
  waitForHmrUpdate(timeoutMs?: number): Promise<HmrUpdatePayload>;
  waitForClientAck(timeoutMs?: number): Promise<{ seq: number; ok: boolean; durationMs: number }>;
  close(): Promise<void>;
}

export async function createDevServer(options: DevServerOptions = {}): Promise<DevServerHandle> {
  const rootDir = normalizeDriveLetter(path.resolve(options.rootDir ?? process.cwd()));
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 3000;

  const devMode = options.mode ?? "development";
  const plugin = mix({ hmr: true, mode: devMode });
  const envValues = buildImportMetaEnvValues(rootDir, devMode);
  const compileComponentModule = (filePath: string, sourceText: string): string => {
    const transformed = plugin.transform(sourceText, filePath);
    const withEnv = replaceImportMetaEnv(transformed ? transformed.code : "", envValues);
    return rewriteModuleImportsForDev(withEnv, filePath, rootDir, moduleGraph);
  };
  const compileScriptModule = (filePath: string, sourceText: string): string => {
    const transpiled = transpileSourceModule(sourceText, filePath.endsWith(".ts"));
    return rewriteModuleImportsForDev(replaceImportMetaEnv(transpiled, envValues), filePath, rootDir, moduleGraph);
  };
  const moduleCache = new Map<string, string>();
  const moduleGraph = new ModuleGraph(rootDir);
  const serverId = crypto.randomUUID();
  let serverSeq = 0;
  const hmrUpdates: HmrUpdatePayload[] = [];
  const sseClients = new Set<http.ServerResponse>();
  const hmrWaiters = new Set<(payload: HmrUpdatePayload) => void>();
  const ackWaiters = new Set<(ack: { seq: number; ok: boolean; durationMs: number }) => void>();
  const lastJsHashes = new Map<string, string>();
  const lastCssHashes = new Map<string, string>();
  const activeErrors = new Set<string>();

  const heartbeatTimer = setInterval(() => {
    for (const client of sseClients) {
      try { client.write(": heartbeat\n\n"); } catch { sseClients.delete(client); }
    }
  }, 15000);
  heartbeatTimer.unref();

  const notifyFileChange = (filePath: string, fileContent?: string): HmrUpdatePayload => {
    const absPath = normalizeDriveLetter(path.normalize(path.resolve(rootDir, filePath)));
    moduleCache.delete(absPath);
    plugin.invalidate(absPath);

    serverSeq++;
    moduleGraph.incrementVersion(absPath);
    moduleCache.clear();
    const decision = moduleGraph.computePropagation(absPath);

    if (decision.type === "full-reload") {
      const relWebPath = "/" + path.relative(rootDir, absPath).split(path.sep).join("/");
      const payload: HmrUpdatePayload = {
        type: "update",
        file: relWebPath,
        timestamp: Date.now(),
        cssUpdated: false,
        seq: serverSeq
      };
      const reloadPayload = {
        type: "full-reload",
        reason: decision.reason ?? "Module propagation requires full reload",
        timestamp: Date.now(),
        seq: serverSeq
      };
      const serialized = `data: ${JSON.stringify(reloadPayload)}\n\n`;
      for (const client of sseClients) {
        try { client.write(serialized); } catch { sseClients.delete(client); }
      }
      return payload;
    }

    let lastPayload: HmrUpdatePayload | null = null;
    for (const boundaryId of decision.boundaries) {
      const boundaryAbs = moduleGraph.toAbsolutePath(boundaryId);
      moduleCache.delete(boundaryAbs);
      plugin.invalidate(boundaryAbs);

      let updateKind: "js" | "css" | undefined;
      let currentCss = "";
      if (fs.existsSync(boundaryAbs)) {
        try {
          if (boundaryAbs.endsWith(".mix") || boundaryAbs.endsWith(".tix")) {
            const rawSource = (fileContent !== undefined && absPath === boundaryAbs)
              ? fileContent
              : fs.readFileSync(boundaryAbs, "utf-8");
            const jsCode = compileComponentModule(boundaryAbs, rawSource);
            moduleCache.set(boundaryAbs, jsCode);

            const resolvedCssId = plugin.resolveId(`${boundaryAbs}?mix-css=1`);
            currentCss = resolvedCssId ? (plugin.load(resolvedCssId) ?? "") : "";
            const prevJs = lastJsHashes.get(boundaryAbs);
            const prevCss = lastCssHashes.get(boundaryAbs);

            lastJsHashes.set(boundaryAbs, jsCode);
            lastCssHashes.set(boundaryAbs, currentCss);

            if (prevJs !== undefined && prevJs === jsCode && prevCss !== currentCss) {
              updateKind = "css";
            }

            if (activeErrors.has(boundaryAbs)) {
              activeErrors.delete(boundaryAbs);
              const clearPayload = {
                type: "error-cleared",
                file: boundaryId,
                seq: serverSeq
              };
              const clearSerialized = `data: ${JSON.stringify(clearPayload)}\n\n`;
              for (const client of sseClients) {
                try { client.write(clearSerialized); } catch { sseClients.delete(client); }
              }
            }
          } else if (boundaryAbs.endsWith(".ts") || boundaryAbs.endsWith(".js")) {
            const rawSource = (fileContent !== undefined && absPath === boundaryAbs)
              ? fileContent
              : fs.readFileSync(boundaryAbs, "utf-8");
            moduleCache.set(boundaryAbs, compileScriptModule(boundaryAbs, rawSource));
          }
        } catch (err: unknown) {
          activeErrors.add(boundaryAbs);
          const diag = err as DiagnosticLike;
          const errorPayload = {
            type: "error",
            error: {
              code: diag.code || "MIX_COMPILE_ERROR",
              message: diag.message || String(err),
              file: boundaryId,
              line: diag.span?.start?.line ?? 1,
              column: diag.span?.start?.column ?? 1,
              frame: diag.frame || diag.message || String(err)
            },
            seq: serverSeq
          };
          const errSerialized = `data: ${JSON.stringify(errorPayload)}\n\n`;
          for (const client of sseClients) {
            try { client.write(errSerialized); } catch { sseClients.delete(client); }
          }
          continue;
        }
      }

      const relWebPath = boundaryId;
      const payload: HmrUpdatePayload = {
        type: "update",
        file: relWebPath,
        timestamp: Date.now(),
        cssUpdated: STYLE_FILE_REGEX.test(boundaryAbs) || boundaryAbs.endsWith(".mix") || boundaryAbs.endsWith(".tix"),
        ...(updateKind ? { kind: updateKind } : {}),
        ...(updateKind === "css" ? { cssContent: currentCss } : {}),
        seq: serverSeq
      };
      hmrUpdates.push(payload);
      lastPayload = payload;

      const serialized = `data: ${JSON.stringify(payload)}\n\n`;
      for (const client of sseClients) {
        try { client.write(serialized); } catch { sseClients.delete(client); }
      }

      for (const waiter of hmrWaiters) {
        hmrWaiters.delete(waiter);
        waiter(payload);
      }
    }

    if (lastPayload) {
      return lastPayload;
    }

    const fallbackRel = "/" + path.relative(rootDir, absPath).split(path.sep).join("/");
    const fallbackPayload: HmrUpdatePayload = {
      type: "update",
      file: fallbackRel,
      timestamp: Date.now(),
      cssUpdated: false
    };
    return fallbackPayload;
  };

  // Set up event-driven coalescing watcher with zero idle reads
  const watcher = createFileWatcher(rootDir, (event) => {
    if (event.type === "delete") {
      moduleCache.delete(event.path);
      plugin.invalidate(event.path);
      moduleGraph.removeNode(event.path);
    } else {
      notifyFileChange(event.path, event.content);
    }
  }, { coalesceMs: 15, maxCoalesceMs: 300 });

  const server = http.createServer((req, res) => {
    if (options.cors) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
    }

    const urlObj = new URL(req.url ?? "/", `http://${host}`);
    const pathname = decodeURIComponent(urlObj.pathname);

    // 1. SSE HMR stream
    if (pathname === "/__mix_hmr") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      const initialPayload = JSON.stringify({ type: "connected", serverId, seq: serverSeq });
      res.write(`: connected\ndata: ${initialPayload}\n\n`);
      sseClients.add(res);
      req.on("close", () => { sseClients.delete(res); });
      return;
    }

    // 1b. HMR confirmation ack (POST /__mix_hmr/ack)
    if (pathname === "/__mix_hmr/ack" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
      req.on("end", () => {
        try {
          const parsed = JSON.parse(body) as { seq: number; ok: boolean; durationMs: number };
          for (const waiter of Array.from(ackWaiters)) {
            ackWaiters.delete(waiter);
            waiter(parsed);
          }
        } catch { /* ignore malformed ack */ }
        res.writeHead(204);
        res.end();
      });
      return;
    }

    // 2. HMR client runtime script
    if (pathname === "/@dotmix/hmr-client.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      res.end(HMR_CLIENT_SOURCE);
      return;
    }

    // 3. Bare @dotmix/* module resolution (/@modules/@dotmix/...)
    if (pathname.startsWith("/@modules/")) {
      const sub = pathname.slice("/@modules/".length);
      const resolvedFile = resolveMixModuleFile(sub, rootDir);
      if (resolvedFile && fs.existsSync(resolvedFile)) {
        const rawJs = fs.readFileSync(resolvedFile, "utf-8");
        const rewrittenJs = rewriteModuleImportsForDev(rawJs, null, rootDir, moduleGraph);
        res.writeHead(200, {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store"
        });
        res.end(rewrittenJs);
        return;
      }
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Module not found: ${pathname}`);
      return;
    }

    // 4. Virtual CSS modules (?mix-css=1) loaded via @dotmix/vite-plugin
    if (urlObj.searchParams.has("mix-css")) {
      const targetAbs = normalizeDriveLetter(path.normalize(path.resolve(rootDir, pathname.replace(/^\/+/, ""))));
      const resolvedId = plugin.resolveId(`${targetAbs}?mix-css=1`);
      let css = resolvedId ? plugin.load(resolvedId) : null;
      if (!css && fs.existsSync(targetAbs)) {
        try {
          const src = fs.readFileSync(targetAbs, "utf-8");
          plugin.transform(src, targetAbs);
          css = resolvedId ? plugin.load(resolvedId) : "";
        } catch {
          css = "";
        }
      }
      const jsPayload = createStyleInjectorJs(pathname, css ?? "");
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(jsPayload);
      return;
    }

    // 5. Project source / static files
    if (pathname !== "/" && pathname !== "/index.html") {
      const candidateBase = normalizeDriveLetter(path.normalize(path.resolve(rootDir, pathname.replace(/^\/+/, ""))));
      if (candidateBase.startsWith(rootDir)) {
        const resolvedFile = resolveDevSourceFile(candidateBase);

        if (resolvedFile && resolvedFile.startsWith(rootDir)) {
          try {
            if (resolvedFile.endsWith(".mix") || resolvedFile.endsWith(".tix")) {
              let jsCode = moduleCache.get(resolvedFile);
              if (jsCode === undefined) {
                jsCode = compileComponentModule(resolvedFile, fs.readFileSync(resolvedFile, "utf-8"));
                moduleCache.set(resolvedFile, jsCode);
                lastJsHashes.set(resolvedFile, jsCode);
                const resolvedCssId = plugin.resolveId(`${resolvedFile}?mix-css=1`);
                const initialCss = resolvedCssId ? (plugin.load(resolvedCssId) ?? "") : "";
                lastCssHashes.set(resolvedFile, initialCss);
              }
              res.writeHead(200, {
                "Content-Type": "application/javascript; charset=utf-8",
                "Cache-Control": "no-store"
              });
              res.end(jsCode);
              return;
            }

            if (resolvedFile.endsWith(".ts") || resolvedFile.endsWith(".js")) {
              let jsCode = moduleCache.get(resolvedFile);
              if (jsCode === undefined) {
                jsCode = compileScriptModule(resolvedFile, fs.readFileSync(resolvedFile, "utf-8"));
                moduleCache.set(resolvedFile, jsCode);
              }
              res.writeHead(200, {
                "Content-Type": "application/javascript; charset=utf-8",
                "Cache-Control": "no-store"
              });
              res.end(jsCode);
              return;
            }

            if (STYLE_FILE_REGEX.test(resolvedFile)) {
              const rawStyle = fs.readFileSync(resolvedFile, "utf-8");
              const pre = preprocessCss(rawStyle, { filename: resolvedFile });
              const compiled = compileCss(pre.code, {
                filename: path.basename(resolvedFile),
                scoped: false
              });
              if (urlObj.searchParams.has("import")) {
                res.writeHead(200, {
                  "Content-Type": "application/javascript; charset=utf-8",
                  "Cache-Control": "no-store"
                });
                res.end(createStyleInjectorJs(pathname, compiled.code));
              } else {
                res.writeHead(200, {
                  "Content-Type": "text/css; charset=utf-8",
                  "Cache-Control": "no-store"
                });
                res.end(compiled.code);
              }
              return;
            }
          } catch (err: unknown) {
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            res.end(err instanceof Error ? err.message : String(err));
            return;
          }
        }
      }
    }
    if (servePublicFile(res, rootDir, pathname)) return; // 5b. public/ files are served at the site root, as in mix build
    // 6. SPA Fallback: Serve index.html for root or any client route (including splat/param routes with dots like /reports/2026/perf.log or .json/.md)
    const acceptHeader = req.headers.accept ?? "";
    const isBrowserHtmlRefresh = acceptHeader.includes("text/html");
    const isDirectAssetExt = /\.(js|mjs|cjs|css|map|ico|png|jpg|jpeg|gif|webp|svg|woff|woff2|ttf|eot|wasm)$/i.test(pathname);
    if (pathname === "/" || pathname === "/index.html" || isBrowserHtmlRefresh || !isDirectAssetExt) {
      const html = getOrSynthesizeIndexHtml(rootDir);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(html);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
  });

  let actualPort = requestedPort;
  await new Promise<void>((resolve, reject) => {
    function tryBind(p: number, tries: number): void {
      server.once("error", (e: NodeJS.ErrnoException) => {
        if (e.code === "EADDRINUSE" && tries > 0 && requestedPort !== 0) tryBind(p + 1, tries - 1);
        else reject(e);
      });
      actualPort = p;
      server.listen(p, host, () => resolve());
    }
    tryBind(requestedPort, 10);
  });

  const addr = server.address();
  if (typeof addr === "object" && addr) actualPort = addr.port;
  const serverUrl = `http://${host}:${actualPort}`;

  if (!options.silent) {
    console.log(`\n⚡ dotMix Dev Server running at ${serverUrl} (HMR enabled via @dotmix/vite-plugin)`);
  }

  return {
    port: actualPort,
    host,
    url: serverUrl,
    hmrUpdates,
    notifyFileChange,
    waitForHmrUpdate(timeoutMs = 5000): Promise<HmrUpdatePayload> {
      return new Promise<HmrUpdatePayload>((resolve, reject) => {
        const timer = setTimeout(() => {
          hmrWaiters.delete(onUpdate);
          reject(new Error(`Timed out waiting for HMR update after ${timeoutMs}ms`));
        }, timeoutMs);
        function onUpdate(payload: HmrUpdatePayload): void {
          clearTimeout(timer);
          resolve(payload);
        }
        hmrWaiters.add(onUpdate);
      });
    },
    waitForClientAck(timeoutMs = 5000): Promise<{ seq: number; ok: boolean; durationMs: number }> {
      return new Promise<{ seq: number; ok: boolean; durationMs: number }>((resolve, reject) => {
        const timer = setTimeout(() => {
          ackWaiters.delete(onAck);
          reject(new Error(`Timed out waiting for client ACK after ${timeoutMs}ms`));
        }, timeoutMs);
        function onAck(ack: { seq: number; ok: boolean; durationMs: number }): void {
          clearTimeout(timer);
          ackWaiters.delete(onAck);
          resolve(ack);
        }
        ackWaiters.add(onAck);
      });
    },
    async close(): Promise<void> {
      clearInterval(heartbeatTimer);
      watcher.close();
      for (const client of sseClients) {
        try { client.end(); } catch { /* ignore */ }
      }
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

export const startDevServer = createDevServer;
