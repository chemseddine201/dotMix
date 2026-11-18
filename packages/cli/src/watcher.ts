/**
 * @dotmix/cli — Event-Driven File Watcher with 15ms Coalescing & Zero Idle Reads
 *
 * Implements &:
 * - Native recursive fs.watch on root directory, ignoring excluded directories (node_modules, dist, .git, etc.)
 * - 15ms coalescing buffer so rapid editor burst saves emit exactly one event per file
 * - Change-only hashing: only reads and hashes the specific file that triggered the OS event
 * - Distinguishes "add", "change", and "delete"
 * - Zero content reads while the server is idle
 * - Stat-based fallback polling (checking mtimeMs and size) if fs.watch fails
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { normalizeDriveLetter } from "./normalize-path.js";

export type WatchEventType = "add" | "change" | "delete";

export interface WatchEvent {
  readonly type: WatchEventType;
  readonly path: string;
  readonly content?: string;
}

export interface WatcherOptions {
  readonly rootDir: string;
  readonly coalesceMs?: number;
  readonly maxCoalesceMs?: number;
  readonly fallbackPollMs?: number;
  readonly ignored?: (relativePath: string) => boolean;
}

export interface WatcherHandle {
  readonly rootDir: string;
  close(): void;
}

const DEFAULT_IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  ".git",
  ".turbo",
  ".vscode",
  ".idea",
  ".mix"
]);

function isIgnored(relPath: string, customIgnored?: (rel: string) => boolean): boolean {
  if (customIgnored && customIgnored(relPath)) {
    return true;
  }
  const parts = relPath.split(/[/\\]/);
  for (const part of parts) {
    if (DEFAULT_IGNORED_DIRS.has(part)) {
      return true;
    }
  }
  const basename = parts[parts.length - 1] ?? "";
  if (basename.startsWith(".") && basename !== ".mix") {
    return true;
  }
  if (basename.endsWith("~") || basename.endsWith(".swp") || basename.endsWith(".tmp")) {
    return true;
  }
  return false;
}

function quickHash(content: string): string {
  return crypto.createHash("sha1").update(content).digest("hex");
}

function scanInitialFiles(dir: string, customIgnored?: (rel: string) => boolean): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(dir)) return map;

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = path.relative(dir, fullPath);
      if (isIgnored(relPath, customIgnored)) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = fs.readFileSync(fullPath, "utf-8");
          map.set(normalizeDriveLetter(path.normalize(fullPath)), quickHash(content));
        } catch {
          // Ignore unreadable files
        }
      }
    }
  }

  walk(dir);
  return map;
}

export function createFileWatcher(
  rootDirInput: string,
  onEvent: (event: WatchEvent) => void,
  options: Partial<WatcherOptions> = {}
): WatcherHandle {
  const rootDir = normalizeDriveLetter(path.resolve(rootDirInput));
  const coalesceMs = options.coalesceMs ?? 15;
  const maxCoalesceMs = options.maxCoalesceMs ?? 300;
  const fallbackPollMs = options.fallbackPollMs ?? 250;
  const customIgnored = options.ignored;

  const knownHashes = scanInitialFiles(rootDir, customIgnored);
  const knownStats = new Map<string, { mtimeMs: number; size: number }>();

  let isClosed = false;
  let fsWatcher: fs.FSWatcher | null = null;
  let fallbackTimer: NodeJS.Timeout | null = null;
  let coalesceTimer: NodeJS.Timeout | null = null;
  let firstPendingTime = 0;
  const pendingPaths = new Set<string>();

  function flushPending(): void {
    if (isClosed) return;
    if (coalesceTimer !== null) {
      clearTimeout(coalesceTimer);
      coalesceTimer = null;
    }
    firstPendingTime = 0;

    const pathsToProcess = Array.from(pendingPaths);
    pendingPaths.clear();

    for (const absPath of pathsToProcess) {
      let exists = false;
      let isFile = false;
      try {
        const stat = fs.statSync(absPath);
        exists = true;
        isFile = stat.isFile();
      } catch {
        exists = false;
      }

      const prevHash = knownHashes.get(absPath);

      if (!exists) {
        if (prevHash !== undefined) {
          knownHashes.delete(absPath);
          knownStats.delete(absPath);
          onEvent({ type: "delete", path: absPath });
        }
      } else if (isFile) {
        try {
          const content = fs.readFileSync(absPath, "utf-8");
          const hash = quickHash(content);
          if (prevHash === undefined) {
            knownHashes.set(absPath, hash);
            onEvent({ type: "add", path: absPath, content });
          } else if (prevHash !== hash) {
            knownHashes.set(absPath, hash);
            onEvent({ type: "change", path: absPath, content });
          }
        } catch {
          // Ignore transient read locks
        }
      }
    }
  }

  function schedulePath(absPath: string): void {
    if (isClosed) return;
    pendingPaths.add(absPath);

    const now = Date.now();
    if (firstPendingTime === 0) {
      firstPendingTime = now;
    }

    if (now - firstPendingTime >= maxCoalesceMs) {
      flushPending();
      return;
    }

    if (coalesceTimer !== null) {
      clearTimeout(coalesceTimer);
    }
    coalesceTimer = setTimeout(() => {
      flushPending();
    }, coalesceMs);
  }

  function handleWatchEvent(eventType: string, filename: string | Buffer | null): void {
    if (isClosed || !filename) return;
    const rel = filename.toString();
    if (isIgnored(rel, customIgnored)) return;
    const absPath = normalizeDriveLetter(path.normalize(path.resolve(rootDir, rel)));
    schedulePath(absPath);
  }

  function startFallbackPolling(): void {
    if (isClosed || fallbackTimer !== null) return;

    fallbackTimer = setInterval(() => {
      if (isClosed) return;
      // Walk rootDir checking statSync only (zero content reads)
      function checkDir(current: string): void {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
          return;
        }

        for (const entry of entries) {
          const fullPath = path.join(current, entry.name);
          const rel = path.relative(rootDir, fullPath);
          if (isIgnored(rel, customIgnored)) continue;

          if (entry.isDirectory()) {
            checkDir(fullPath);
          } else if (entry.isFile()) {
            const normalized = normalizeDriveLetter(path.normalize(fullPath));
            try {
              const stat = fs.statSync(normalized);
              const prev = knownStats.get(normalized);
              if (!prev || prev.mtimeMs !== stat.mtimeMs || prev.size !== stat.size) {
                knownStats.set(normalized, { mtimeMs: stat.mtimeMs, size: stat.size });
                schedulePath(normalized);
              }
            } catch {
              // File might have been deleted between readdir and stat
            }
          }
        }
      }

      checkDir(rootDir);

      // Check for deleted files
      for (const knownPath of knownHashes.keys()) {
        if (!fs.existsSync(knownPath)) {
          schedulePath(knownPath);
        }
      }
    }, fallbackPollMs);

    fallbackTimer.unref();
  }

  // Attempt native recursive fs.watch
  if (fs.existsSync(rootDir)) {
    try {
      fsWatcher = fs.watch(rootDir, { recursive: true }, handleWatchEvent);
      fsWatcher.on("error", () => {
        if (fsWatcher) {
          try { fsWatcher.close(); } catch { /* ignore close error */ }
          fsWatcher = null;
        }
        startFallbackPolling();
      });
    } catch {
      startFallbackPolling();
    }
  } else {
    startFallbackPolling();
  }

  return {
    rootDir,
    close(): void {
      isClosed = true;
      if (coalesceTimer !== null) {
        clearTimeout(coalesceTimer);
        coalesceTimer = null;
      }
      if (fallbackTimer !== null) {
        clearInterval(fallbackTimer);
        fallbackTimer = null;
      }
      if (fsWatcher !== null) {
        try {
          fsWatcher.close();
        } catch { /* ignore close error */ }
        fsWatcher = null;
      }
      pendingPaths.clear();
    }
  };
}
