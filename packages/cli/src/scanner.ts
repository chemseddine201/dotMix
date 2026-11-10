/**
 * @mix/cli — Directory Scanning & Content Hashing Utilities
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const STYLE_FILE_REGEX = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)$/i;

export interface ScannedSources {
  mixFiles: string[];
  scriptFiles: string[];
  styleFiles: string[];
}

const IGNORED_DIRS = new Set(["node_modules", "dist", ".git"]);

function walkDirectory(dir: string, onFile: (fullPath: string, name: string) => void): void {
  if (!fs.existsSync(dir)) return;

  function walk(current: string): void {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        onFile(fullPath, entry.name);
      }
    }
  }

  walk(dir);
}

export function scanInputDirectory(dir: string): ScannedSources {
  const mixFiles: string[] = [];
  const scriptFiles: string[] = [];
  const styleFiles: string[] = [];

  walkDirectory(dir, (fullPath, name) => {
    if (name.endsWith(".mix") || name.endsWith(".tix")) {
      mixFiles.push(fullPath);
    } else if (
      (name.endsWith(".ts") || name.endsWith(".js")) &&
      !name.endsWith(".d.ts")
    ) {
      scriptFiles.push(fullPath);
    } else if (STYLE_FILE_REGEX.test(name)) {
      styleFiles.push(fullPath);
    }
  });

  return { mixFiles, scriptFiles, styleFiles };
}

export function shortHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 8);
}

export function hashContent(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

export function collectWatchedFiles(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  walkDirectory(dir, (fullPath) => {
    const normalized = path.normalize(fullPath);
    try {
      const content = fs.readFileSync(normalized, "utf-8");
      map.set(normalized, hashContent(content));
    } catch {
      // Ignore unreadable transient files
    }
  });
  return map;
}
