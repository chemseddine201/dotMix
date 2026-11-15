/**
 * @dotmix/cli — canonical path keys for the CLI's own maps and comparisons (watcher, module graph,
 * dev server). Windows drive letters are case-insensitive ("g:\app" and "G:\app" are one folder),
 * so keys use one casing.
 *
 * These keys are for comparing paths inside the CLI only. Never turn them into a module URL for
 * Node's loader: Node identifies a module by the exact URL its resolver returns
 * (`import.meta.resolve`), which keeps the casing of the path it was given.
 */

import path from "node:path";

/** Upper-cases the drive letter of a Windows path or file URL; other paths are returned unchanged. */
export function normalizeDriveLetter(p: string): string {
  if (typeof p !== "string" || p.length < 2) return p;
  if (/^[a-zA-Z]:[/\\]/.test(p)) {
    return p[0]!.toUpperCase() + p.slice(1);
  }
  if (/^file:\/\/\/[a-zA-Z]:\//i.test(p)) {
    return "file:///" + p[8]!.toUpperCase() + p.slice(9);
  }
  return p;
}

/**
 * Normalizes a file path and guarantees consistent drive-letter casing.
 */
export function normalizeNativePath(p: string): string {
  return normalizeDriveLetter(path.normalize(p));
}

/**
 * Resolves a file path and guarantees consistent drive-letter casing.
 */
export function resolveNormalizedPath(...segments: string[]): string {
  return normalizeDriveLetter(path.resolve(...segments));
}
