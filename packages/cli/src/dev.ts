/**
 * @mix/cli — `mix dev` Development Server with @mix/vite-plugin Pipeline, HMR, Bare-Specifier Resolution & SPA Fallback (Gate 29 / T-29.1)
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath, URL } from "node:url";
import { mix } from "@mix/vite-plugin";
import { transpileSourceModule } from "@mix/compiler-semantic";
import { compileCss, preprocessCss } from "@mix/compiler-css";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_PACKAGES_DIR = path.resolve(__dirname, "../..");
const STYLE_EXT_RE = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)$/i;

const HMR_CLIENT_SOURCE = `// @mix/cli HMR Client
(() => {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return;
  const source = new EventSource("/__mix_hmr");
  source.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload && payload.type === "update") {
        window.dispatchEvent(new CustomEvent("mix:hmr-update", { detail: payload }));
        if (payload.cssUpdated) {
          import(payload.file + "?mix-css=1&t=" + payload.timestamp).catch(() => {});
        }
        import(payload.file + "?t=" + payload.timestamp).catch(() => {
          window.location.reload();
        });
      }
    } catch {
      // Ignore malformed HMR packets
    }
  });
})();
`;

function hashContent(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

function collectWatchedFiles(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(dir)) return map;

  function walk(curr: string): void {
    const entries = fs.readdirSync(curr, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      const fullPath = path.normalize(path.join(curr, entry.name));
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          map.set(fullPath, hashContent(content));
        } catch {
          // Ignore unreadable transient files
        }
      }
    }
  }

  walk(dir);
  return map;
}

/**
 * Rewrites bare `@mix/*` specifiers and relative imports in served JS modules for direct browser ES module execution.
 */
export function rewriteModuleImportsForDev(
  code: string,
  fromFileAbs: string | null,
  rootDir: string
): string {
  const rewriteSpec = (spec: string): string => {
    // 1. Virtual ?mix-css module emitted by @mix/vite-plugin with an absolute path
    if (spec.includes("?mix-css")) {
      const [filePart, queryPart] = spec.split("?");
      if (filePart && path.isAbsolute(filePart)) {
        const rel = path.relative(rootDir, filePart).split(path.sep).join("/");
        return `/${rel}?${queryPart ?? "mix-css=1"}`;
      }
      return spec;
    }

    // 2. Bare @mix/<pkg> or @mix/<pkg>/<subpath> specifier
    if (spec.startsWith("@mix/")) {
      const sub = spec.slice("@mix/".length);
      if (sub.endsWith(".js")) {
        return `/@modules/@mix/${sub}`;
      }
      return `/@modules/@mix/${sub}/index.js`;
    }

    // 3. Relative imports inside project source files
    if ((spec.startsWith("./") || spec.startsWith("../")) && fromFileAbs) {
      // Normalize compiled .tix.js / .mix.js back to source .tix / .mix in dev server
      const cleanSpec = spec.replace(/\.(tix|mix)\.js$/i, ".$1");
      const baseDir = path.dirname(fromFileAbs);
      const candidateBase = path.resolve(baseDir, cleanSpec);

      if (STYLE_EXT_RE.test(cleanSpec)) {
        const rel = path.relative(rootDir, candidateBase).split(path.sep).join("/");
        return `/${rel}?import`;
      }

      const candidates = [
        candidateBase,
        `${candidateBase}.ts`,
        `${candidateBase}.js`,
        `${candidateBase}.tix`,
        `${candidateBase}.mix`,
        path.join(candidateBase, "index.ts"),
        path.join(candidateBase, "index.js")
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          if (cand.startsWith(rootDir)) {
            const rel = path.relative(rootDir, cand).split(path.sep).join("/");
            return `/${rel}`;
          }
        }
      }
    }

    return spec;
  };

  return code
    .replace(
      /((?:import|export)\s+(?:[^"']*?\s+from\s+)?["'])([^"']+)(["'])/g,
      (_, prefix: string, spec: string, suffix: string) => `${prefix}${rewriteSpec(spec)}${suffix}`
    )
    .replace(
      /(import\s*\(\s*["'])([^"']+)(["']\s*\))/g,
      (_, prefix: string, spec: string, suffix: string) => `${prefix}${rewriteSpec(spec)}${suffix}`
    );
}

/**
 * Resolves a `/@modules/@mix/<pkg>/<rest>` request path to the real emitted `.js` file on disk.
 */
export function resolveMixModuleFile(moduleSubpath: string, rootDir: string): string | null {
  const parts = moduleSubpath.replace(/^\/+/, "").split("/");
  if (parts[0] === "@mix") {
    parts.shift();
  }
  const pkgFolder = parts.shift();
  if (!pkgFolder) return null;
  const rest = parts.join("/") || "index.js";

  const candidatePkgDirs = [
    path.join(rootDir, "node_modules", "@mix", pkgFolder),
    path.join(MONOREPO_PACKAGES_DIR, pkgFolder)
  ];

  for (const pkgDir of candidatePkgDirs) {
    const distCandidate = path.resolve(pkgDir, "dist", rest);
    if (fs.existsSync(distCandidate) && fs.statSync(distCandidate).isFile()) {
      return distCandidate;
    }
    if (fs.existsSync(`${distCandidate}.js`) && fs.statSync(`${distCandidate}.js`).isFile()) {
      return `${distCandidate}.js`;
    }
    const indexCandidate = path.join(distCandidate, "index.js");
    if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
      return indexCandidate;
    }
  }

  return null;
}

function getOrSynthesizeIndexHtml(rootDir: string): string {
  const indexHtmlPath = path.join(rootDir, "index.html");
  let html: string;
  if (fs.existsSync(indexHtmlPath)) {
    html = fs.readFileSync(indexHtmlPath, "utf-8");
  } else {
    html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mix App</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.mix"></script>
</body>
</html>`;
  }

  if (!html.includes("/@mix/hmr-client.js")) {
    if (html.includes("</head>")) {
      html = html.replace("</head>", `  <script type="module" src="/@mix/hmr-client.js"></script>\n</head>`);
    } else {
      html = `<script type="module" src="/@mix/hmr-client.js"></script>\n` + html;
    }
  }

  return html;
}

function createStyleInjectorJs(id: string, cssCode: string): string {
  return `const __id = ${JSON.stringify(id)};
const __css = ${JSON.stringify(cssCode)};
if (typeof document !== "undefined" && document.head) {
  let el = document.head.querySelector('style[data-mix-dev-id="' + __id + '"]');
  if (!el) {
    el = document.createElement("style");
    el.setAttribute("data-mix-dev-id", __id);
    document.head.appendChild(el);
  }
  el.textContent = __css;
}
export default __css;
`;
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
      cssUpdated: STYLE_EXT_RE.test(absPath) || absPath.endsWith(".mix") || absPath.endsWith(".tix")
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

            if (STYLE_EXT_RE.test(resolvedFile)) {
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

    // 6. SPA Fallback: Serve index.html for root or any client route
    const acceptHeader = req.headers.accept ?? "";
    if (pathname === "/" || pathname === "/index.html" || !pathname.includes(".") || acceptHeader.includes("text/html")) {
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

