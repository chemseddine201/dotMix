#!/usr/bin/env node

/**
 * Lightweight Zero-Dependency Showcase Dev Server
 * Built with native Node.js HTTP modules.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { execSync } from "node:child_process";

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const REPO_ROOT = resolve(".");
const SHOWCASE_ROOT = resolve("examples/showcase");

// 1. Pre-build components
console.log("Triggering showcase build...");
try {
  execSync("node examples/showcase/build.mjs", { stdio: "inherit" });
} catch (err) {
  console.error("Build failed:", err);
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

const server = createServer((req, res) => {
  let urlPath = (req.url || "/").split("?")[0];

  // Default route
  if (urlPath === "/" || urlPath === "/index.html") {
    const indexPath = join(SHOWCASE_ROOT, "index.html");
    const content = readFileSync(indexPath, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content);
    return;
  }

  // Resolve requested file relative to either showcase or repo root
  let candidatePath = null;
  if (urlPath.startsWith("/packages/")) {
    candidatePath = join(REPO_ROOT, urlPath);
  } else if (urlPath.startsWith("/dist/")) {
    candidatePath = join(SHOWCASE_ROOT, urlPath);
  } else {
    candidatePath = join(SHOWCASE_ROOT, urlPath);
  }

  if (existsSync(candidatePath) && statSync(candidatePath).isFile()) {
    const ext = extname(candidatePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const data = readFileSync(candidatePath);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Access-Control-Allow-Origin": "*"
    });
    res.end(data);
    return;
  }

  // Fallback to index.html for SPA client-side routing
  const indexPath = join(SHOWCASE_ROOT, "index.html");
  if (existsSync(indexPath)) {
    const content = readFileSync(indexPath, "utf8");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(content);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end(`404 Not Found: ${urlPath}`);
});

server.listen(PORT, () => {
  console.log(`\n================================================================`);
  console.log(` Mix / Tix Showcase Dev Server Running!`);
  console.log(` URL: http://localhost:${PORT}/`);
  console.log(` Open this URL in any browser to interact with the application.`);
  console.log(` Press Ctrl+C to terminate the server.`);
  console.log(`================================================================\n`);
});
