/**
 * @dotmix/cli — the project's public/ directory: static files served at the site root by `mix dev`
 * and copied to the root of dist/ by `mix build`.
 */

import fs from "node:fs";
import path from "node:path";
import type http from "node:http";

export const PUBLIC_DIRECTORY_NAME = "public";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".tix": "text/plain; charset=utf-8",
  ".mix": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

export function contentTypeForPath(filePath: string): string {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function copyPublicDirectory(projectDirectory: string, outputDirectory: string): string[] {
  const publicDirectory = path.join(projectDirectory, PUBLIC_DIRECTORY_NAME);
  if (!fs.existsSync(publicDirectory) || !fs.statSync(publicDirectory).isDirectory()) return [];
  fs.cpSync(publicDirectory, outputDirectory, { recursive: true });
  return listFilesRecursively(publicDirectory).map((publicFile) =>
    path.join(outputDirectory, path.relative(publicDirectory, publicFile))
  );
}

/** Serves `<projectDirectory>/public<urlPath>` when that file exists. Returns false otherwise. */
export function servePublicFile(response: http.ServerResponse, projectDirectory: string, urlPath: string): boolean {
  const publicDirectory = path.resolve(projectDirectory, PUBLIC_DIRECTORY_NAME);
  const requestedFile = path.resolve(publicDirectory, `.${urlPath}`);
  const isInsidePublicDirectory = requestedFile.startsWith(publicDirectory + path.sep);
  if (!isInsidePublicDirectory || !fs.existsSync(requestedFile) || !fs.statSync(requestedFile).isFile()) {
    return false;
  }
  response.writeHead(200, { "Content-Type": contentTypeForPath(requestedFile), "Cache-Control": "no-store" });
  fs.createReadStream(requestedFile).pipe(response);
  return true;
}

export function listFilesRecursively(directory: string): string[] {
  const foundFiles: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) foundFiles.push(...listFilesRecursively(entryPath));
    else if (entry.isFile()) foundFiles.push(entryPath);
  }
  return foundFiles;
}
