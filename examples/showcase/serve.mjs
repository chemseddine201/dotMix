import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { buildShowcase } from "./build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeDistDir = path.resolve(__dirname, "../../packages/runtime/dist");
const routerDistDir = path.resolve(__dirname, "../../packages/router/dist");
const syncDistDir = path.resolve(__dirname, "../../packages/sync/dist");
const sanitizerDistDir = path.resolve(__dirname, "../../packages/sanitizer-dompurify/dist");
const webOutDir = path.join(__dirname, "dist-web");
const indexHtmlPath = path.join(__dirname, "index.html");

const PORT = Number(globalThis.process?.env?.PORT ?? 4173);

// Compile all .mix and .tix components in examples/showcase/src/ for browser ES module serving
const artifacts = buildShowcase({
  outDir: webOutDir,
  runtimeImportPath: "/runtime/index.js"
});

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function rewriteBareMixImports(jsSource) {
  return jsSource
    .replace(
      /((?:import|export)\s+(?:[^"']*?\s+from\s+)?["'])@mix\/([^"']+)(["'])/g,
      (_, prefix, pkgSubpath, suffix) => {
        const clean = pkgSubpath.endsWith(".js") ? pkgSubpath : `${pkgSubpath}/index.js`;
        return `${prefix}/${clean}${suffix}`;
      }
    );
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
    return;
  }
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  if (ext === ".js" || ext === ".mjs") {
    const raw = fs.readFileSync(filePath, "utf-8");
    res.end(rewriteBareMixImports(raw));
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

function resolveTarget(baseDir, rel) {
  let target = path.resolve(baseDir, rel);
  if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    if (fs.existsSync(target + ".js")) {
      target = target + ".js";
    } else if (fs.existsSync(path.join(target, "index.js"))) {
      target = path.join(target, "index.js");
    }
  }
  return target;
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  if (pathname === "/" || pathname === "/index.html") {
    // Re-compile on page reload so edits to .mix/.tix files appear live!
    buildShowcase({
      outDir: webOutDir,
      runtimeImportPath: "/runtime/index.js"
    });
    sendFile(res, indexHtmlPath);
    return;
  }

  if (pathname.startsWith("/dist/")) {
    const rel = pathname.slice("/dist/".length);
    const target = resolveTarget(webOutDir, rel);
    if (target.startsWith(webOutDir)) {
      sendFile(res, target);
      return;
    }
  }

  if (pathname.startsWith("/runtime/")) {
    const rel = pathname.slice("/runtime/".length);
    const target = resolveTarget(runtimeDistDir, rel);
    if (target.startsWith(runtimeDistDir)) {
      sendFile(res, target);
      return;
    }
  }

  if (pathname.startsWith("/router/")) {
    const rel = pathname.slice("/router/".length);
    const target = resolveTarget(routerDistDir, rel);
    if (target.startsWith(routerDistDir)) {
      sendFile(res, target);
      return;
    }
  }

  if (pathname.startsWith("/sync/")) {
    const rel = pathname.slice("/sync/".length);
    const target = resolveTarget(syncDistDir, rel);
    if (target.startsWith(syncDistDir)) {
      sendFile(res, target);
      return;
    }
  }

  if (pathname.startsWith("/sanitizer-dompurify/")) {
    const rel = pathname.slice("/sanitizer-dompurify/".length);
    const target = resolveTarget(sanitizerDistDir, rel);
    if (target.startsWith(sanitizerDistDir)) {
      sendFile(res, target);
      return;
    }
  }


  // SPA fallback: Route HTML requests to index.html so direct URL navigation / refresh works
  if (!pathname.includes(".")) {
    buildShowcase({
      outDir: webOutDir,
      runtimeImportPath: "/runtime/index.js"
    });
    sendFile(res, indexHtmlPath);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 Not Found");
});

server.listen(PORT, () => {
  globalThis.console.log(
    `⚡ Mix/Tix Showcase Server running at http://localhost:${PORT} (http://127.0.0.1:${PORT}) (${artifacts.size} components compiled)`
  );
});
