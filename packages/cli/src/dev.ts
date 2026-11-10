/**
 * @mix/cli — `mix dev` Development Server with @mix/vite-plugin Pipeline, HMR, Bare-Specifier Resolution & SPA Fallback (Gate 29 / T-29.1)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import { mix } from "@mix/vite-plugin";
import { transpileSourceModule } from "@mix/compiler-semantic";
import { compileCss, preprocessCss } from "@mix/compiler-css";
import { STYLE_FILE_REGEX, collectWatchedFiles } from "./scanner.js";
import {
  HMR_CLIENT_SOURCE,
  rewriteModuleImportsForDev,
  resolveMixModuleFile,
  resolveMixPackageRequest,
  getOrSynthesizeIndexHtml,
  createStyleInjectorJs,
} from "./specifier-rewriter.js";

export {
  HMR_CLIENT_SOURCE,
  rewriteModuleImportsForDev,
  resolveMixModuleFile,
  resolveMixPackageRequest,
};

export interface DevServerOptions {
  rootDir?: string | undefined;
  port?: number | undefined;
  host?: string | undefined;
  silent?: boolean | undefined;
}

export interface HmrUpdatePayload {
  readonly type: "update";
  readonly file: string;
  readonly timestamp: number;
  readonly cssUpdated: boolean;
}

export interface DevServerHandle {
  readonly port: number;
  readonly host: string;
  readonly url: string;
  readonly hmrUpdates: HmrUpdatePayload[];
  notifyFileChange(filePath: string): HmrUpdatePayload;
  waitForHmrUpdate(timeoutMs?: number): Promise<HmrUpdatePayload>;
  close(): Promise<void>;
}

export async function createDevServer(options: DevServerOptions = {}): Promise<DevServerHandle> {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 3000;

  const plugin = mix({ hmr: true });
  const moduleCache = new Map<string, string>();
  const hmrUpdates: HmrUpdatePayload[] = [];
  const sseClients = new Set<http.ServerResponse>();
  const hmrWaiters = new Set<(payload: HmrUpdatePayload) => void>();

  const notifyFileChange = (filePath: string): HmrUpdatePayload => {
    const absPath = path.normalize(path.resolve(rootDir, filePath));
    moduleCache.delete(absPath);
    plugin.invalidate(absPath);

    const relWebPath = "/" + path.relative(rootDir, absPath).split(path.sep).join("/");
    const payload: HmrUpdatePayload = {
      type: "update",
      file: relWebPath,
      timestamp: Date.now(),
      cssUpdated: STYLE_FILE_REGEX.test(absPath) || absPath.endsWith(".mix") || absPath.endsWith(".tix")
    };
    hmrUpdates.push(payload);

    const serialized = `data: ${JSON.stringify(payload)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(serialized);
      } catch {
        sseClients.delete(client);
      }
    }

    for (const waiter of hmrWaiters) {
      hmrWaiters.delete(waiter);
      waiter(payload);
    }

    return payload;
  };

  // Set up file watching on src/
  const srcDir = path.join(rootDir, "src");
  const fileHashes = collectWatchedFiles(srcDir);
  let fsWatcher: fs.FSWatcher | null = null;

  const checkFileChanges = (): void => {
    const nextHashes = collectWatchedFiles(srcDir);
    for (const [absFile, nextHash] of nextHashes.entries()) {
      const prevHash = fileHashes.get(absFile);
      if (prevHash !== undefined && prevHash !== nextHash) {
        fileHashes.set(absFile, nextHash);
        notifyFileChange(absFile);
      } else if (prevHash === undefined) {
        fileHashes.set(absFile, nextHash);
        notifyFileChange(absFile);
      }
    }
  };

  if (fs.existsSync(srcDir)) {
    try {
      fsWatcher = fs.watch(srcDir, { recursive: true }, () => {
        checkFileChanges();
      });
    } catch {
      // Fallback to polling interval below
    }
  }

  const pollTimer = setInterval(checkFileChanges, 50);
  pollTimer.unref();

  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url ?? "/", `http://${host}`);
    const pathname = decodeURIComponent(urlObj.pathname);

    // 1. SSE HMR stream
    if (pathname === "/__mix_hmr") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      res.write(": connected\n\n");
      sseClients.add(res);
      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }

    // 2. HMR client runtime script
    if (pathname === "/@mix/hmr-client.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(HMR_CLIENT_SOURCE);
      return;
    }

    // 3. Bare @mix/* module resolution (/@modules/@mix/...)
    if (pathname.startsWith("/@modules/")) {
      const sub = pathname.slice("/@modules/".length);
      const resolvedFile = resolveMixModuleFile(sub, rootDir);
      if (resolvedFile && fs.existsSync(resolvedFile)) {
        const rawJs = fs.readFileSync(resolvedFile, "utf-8");
        const rewrittenJs = rewriteModuleImportsForDev(rawJs, null, rootDir);
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

    // 4. Virtual CSS modules (?mix-css=1) loaded via @mix/vite-plugin
    if (urlObj.searchParams.has("mix-css")) {
      const targetAbs = path.normalize(path.resolve(rootDir, pathname.replace(/^\/+/, "")));
      const resolvedId = plugin.resolveId(`${targetAbs}?mix-css=1`);
      let css = resolvedId ? plugin.load(resolvedId) : null;
      if (!css && fs.existsSync(targetAbs)) {
        const src = fs.readFileSync(targetAbs, "utf-8");
        plugin.transform(src, targetAbs);
        css = resolvedId ? plugin.load(resolvedId) : "";
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
      const candidateBase = path.normalize(path.resolve(rootDir, pathname.replace(/^\/+/, "")));
      if (candidateBase.startsWith(rootDir)) {
        let resolvedFile: string | null = null;
        for (const cand of [
          candidateBase,
          `${candidateBase}.ts`,
          `${candidateBase}.js`,
          `${candidateBase}.tix`,
          `${candidateBase}.mix`
        ]) {
          if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
            resolvedFile = cand;
            break;
          }
        }

        if (resolvedFile) {
          try {
            if (resolvedFile.endsWith(".mix") || resolvedFile.endsWith(".tix")) {
              let jsCode = moduleCache.get(resolvedFile);
              if (jsCode === undefined) {
                const rawSource = fs.readFileSync(resolvedFile, "utf-8");
                const transformed = plugin.transform(rawSource, resolvedFile);
                const rawCompiled = transformed ? transformed.code : "";
                jsCode = rewriteModuleImportsForDev(rawCompiled, resolvedFile, rootDir);
                moduleCache.set(resolvedFile, jsCode);
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
                const rawSource = fs.readFileSync(resolvedFile, "utf-8");
                const transpiled = transpileSourceModule(rawSource, resolvedFile.endsWith(".ts"));
                jsCode = rewriteModuleImportsForDev(transpiled, resolvedFile, rootDir);
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

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => resolve());
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
  const serverUrl = `http://${host}:${actualPort}`;

  if (!options.silent) {
    console.log(`\n⚡ dotMix Dev Server running at ${serverUrl} (HMR enabled via @mix/vite-plugin)`);
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
    async close(): Promise<void> {
      clearInterval(pollTimer);
      if (fsWatcher) {
        fsWatcher.close();
        fsWatcher = null;
      }
      for (const client of sseClients) {
        try {
          client.end();
        } catch {
          // Ignore
        }
      }
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

export const startDevServer = createDevServer;
