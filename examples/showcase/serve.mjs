import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { buildShowcase } from "./build.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeDistDir = path.resolve(__dirname, "../../packages/runtime/dist");
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
  fs.createReadStream(filePath).pipe(res);
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
    const target = path.resolve(webOutDir, rel);
    if (target.startsWith(webOutDir)) {
      sendFile(res, target);
      return;
    }
  }

  if (pathname.startsWith("/runtime/")) {
    const rel = pathname.slice("/runtime/".length);
    const target = path.resolve(runtimeDistDir, rel);
    if (target.startsWith(runtimeDistDir)) {
      sendFile(res, target);
      return;
    }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 Not Found");
});

server.listen(PORT, "127.0.0.1", () => {
  globalThis.console.log(
    `⚡ Mix/Tix Showcase Server running at http://localhost:${PORT} (${artifacts.size} components compiled)`
  );
});
