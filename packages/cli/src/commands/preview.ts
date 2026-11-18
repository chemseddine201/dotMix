/**
 * @dotmix/cli — `mix preview` Command
 * Zero-dependency static HTTP server for production dist/ verification.
 * Implements SPA routing fallback, MIME typing, and gzip/brotli compression.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import os from "node:os";
import { exec } from "node:child_process";
import type { ParsedCliArgs } from "../args.js";
import { resolveCommandOptions } from "../config.js";
import { colors, banner } from "../terminal.js";

const MIME_MAP: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export interface PreviewOptions {
  dir?: string;
  port?: number;
  host?: string;
  open?: boolean;
  silent?: boolean;
}

function getLocalIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const ifaceList = interfaces[name];
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "win32" ? `start "" "${url}"` : platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {
    // Ignore browser open errors
  });
}

export function createPreviewServer(options: PreviewOptions = {}): Promise<http.Server> {
  const rootDir = path.resolve(options.dir ?? "dist");
  const port = options.port ?? 4173;
  const host = options.host ?? "localhost";

  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) {
    throw new Error(`Directory '${options.dir ?? "dist"}' not found. Run 'mix build' before running 'mix preview'.`);
  }

  const server = http.createServer((req, res) => {
    const rawUrl = req.url || "/";
    const parsedPath = decodeURIComponent(rawUrl.split("?")[0] || "/");
    let relativePath = parsedPath.startsWith("/") ? parsedPath.slice(1) : parsedPath;
    if (relativePath === "") relativePath = "index.html";

    let targetFile = path.resolve(rootDir, relativePath);

    // Prevent path traversal
    if (!targetFile.startsWith(rootDir)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("403 Forbidden");
      return;
    }

    // Serve directory index.html for pre-rendered routes (e.g. /about/index.html) before SPA fallback.
    const directoryIndexFile = path.join(targetFile, "index.html");
    const hasExtension = path.extname(targetFile) !== "";
    if (
      fs.existsSync(targetFile) &&
      fs.statSync(targetFile).isDirectory() &&
      fs.existsSync(directoryIndexFile) &&
      fs.statSync(directoryIndexFile).isFile()
    ) {
      targetFile = directoryIndexFile;
    } else if (!fs.existsSync(targetFile) || !fs.statSync(targetFile).isFile()) {
      if (!hasExtension) {
        targetFile = path.resolve(rootDir, "index.html");
      } else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("404 Not Found");
        return;
      }
    }

    if (!fs.existsSync(targetFile)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("404 Not Found: index.html not found");
      return;
    }

    const ext = path.extname(targetFile).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    const isCompressible =
      contentType.startsWith("text/") ||
      contentType.includes("json") ||
      contentType.includes("javascript") ||
      contentType.includes("svg");

    const content = fs.readFileSync(targetFile);
    const headers: Record<string, string> = {
      "Content-Type": contentType,
    };

    // Cache control
    if (targetFile.includes("assets") && !targetFile.endsWith("index.html")) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    } else {
      headers["Cache-Control"] = "no-cache";
    }

    // Compression negotiation
    const acceptEncoding = (req.headers["accept-encoding"] as string) || "";
    if (isCompressible && acceptEncoding.includes("br")) {
      headers["Content-Encoding"] = "br";
      res.writeHead(200, headers);
      res.end(zlib.brotliCompressSync(content));
    } else if (isCompressible && acceptEncoding.includes("gzip")) {
      headers["Content-Encoding"] = "gzip";
      res.writeHead(200, headers);
      res.end(zlib.gzipSync(content));
    } else {
      headers["Content-Length"] = String(content.length);
      res.writeHead(200, headers);
      res.end(content);
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host === "localhost" ? "127.0.0.1" : host, () => {
      resolve(server);
    });
  });
}

export async function previewCommand(parsed: ParsedCliArgs): Promise<number> {
  const options = await resolveCommandOptions(parsed, process.cwd());
  const dir = options.preview.dir;
  const port = options.preview.port;
  const host = options.preview.host;
  const open = options.preview.open;
  const silent = parsed.values.silent ?? false;

  try {
    const server = await createPreviewServer({ dir, port, host, open, silent });
    const localUrl = `http://${host}:${port}/`;
    const localIp = getLocalIp();

    if (parsed.values.json) {
      console.log(JSON.stringify({ status: "running", localUrl, port, host, dir }));
    } else if (!silent) {
      console.log(banner("Preview Server", `Serving production build from ${colors.cyan(dir)}`));
      console.log(`  ${colors.bold("Local:")}   ${colors.cyan(localUrl)}`);
      if (localIp) {
        console.log(`  ${colors.bold("Network:")} ${colors.cyan(`http://${localIp}:${port}/`)}`);
      }
      console.log(`\n  ${colors.dim("Press Ctrl+C to stop.")}\n`);
    }

    if (open) {
      openBrowser(localUrl);
    }

    // Keep server running in CLI process unless signaled
    return new Promise((resolve) => {
      const shutdown = (): void => {
        server.close(() => {
          resolve(0);
        });
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(colors.red(`[ERROR] ${msg}`));
    return 1;
  }
}
