/**
 * @dotmix/cli — Public environment file loader (`.env*` + `process.env`) for `import.meta.env`.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import type { ImportMetaEnvValues } from "@dotmix/compiler-semantic";

const PUBLIC_ENV_PREFIX = "MIX_PUBLIC_";
const ENV_LINE_PATTERN = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function parseEnvLineValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) return "";
  const firstChar = trimmed[0];
  if (firstChar === '"' || firstChar === "'") {
    for (let index = 1; index < trimmed.length; index++) {
      if (firstChar === '"' && trimmed[index] === "\\" && index + 1 < trimmed.length) {
        index++;
        continue;
      }
      if (trimmed[index] === firstChar) {
        const trailing = trimmed.slice(index + 1).trim();
        if (trailing === "" || trailing.startsWith("#")) {
          return trimmed.slice(1, index);
        }
        break;
      }
    }
  }
  const commentOffset = trimmed.indexOf(" #");
  return (commentOffset !== -1 ? trimmed.slice(0, commentOffset) : trimmed).trim();
}

function readPublicEnvFile(filePath: string, target: Record<string, string>): void {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return;
  }
  const rawContents = fs.readFileSync(filePath, "utf-8");
  for (const rawLine of rawContents.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#")) {
      continue;
    }
    const matched = ENV_LINE_PATTERN.exec(rawLine);
    if (!matched) {
      continue;
    }
    const key = matched[1]!;
    if (!key.startsWith(PUBLIC_ENV_PREFIX)) {
      continue;
    }
    target[key] = parseEnvLineValue(matched[2]!);
  }
}

/**
 * Loads `MIX_PUBLIC_*` environment values from `.env`, `.env.local`, `.env.<mode>`, `.env.<mode>.local`
 * in `projectDirectory`, with `process.env` winning over all files. Never exposes non-prefixed keys.
 */
export function loadPublicEnv(
  projectDirectory: string,
  mode: string
): Readonly<Record<string, string>> {
  const resolvedDirectory = path.resolve(projectDirectory);
  const publicEnv: Record<string, string> = {};
  const candidateFiles = [".env", ".env.local"];
  if (mode) {
    candidateFiles.push(`.env.${mode}`, `.env.${mode}.local`);
  }

  for (const filename of candidateFiles) {
    readPublicEnvFile(path.join(resolvedDirectory, filename), publicEnv);
  }

  for (const [envKey, envValue] of Object.entries(process.env)) {
    if (envKey.startsWith(PUBLIC_ENV_PREFIX) && typeof envValue === "string") {
      publicEnv[envKey] = envValue;
    }
  }

  return Object.freeze(publicEnv);
}

/** Builds the complete `ImportMetaEnvValues` structure for the given project and mode. */
export function buildImportMetaEnvValues(
  projectDirectory: string,
  mode: string
): ImportMetaEnvValues {
  const prod = mode === "production";
  return {
    mode,
    dev: !prod,
    prod,
    publicEnv: loadPublicEnv(projectDirectory, mode)
  };
}

