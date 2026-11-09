/**
 * @mix/cli — Comprehensive Project Template Generator (`mix create` / `mix init`)
 *
 * Implements the approved Mix Framework project architecture (D-129, T-27.2):
 * - Externalized templates under `packages/cli/templates/{shared,ts,js,styles}/`
 * - layouts/, pages/, components/ (common/ & domain/), stores/, permissions/, styles/
 * - Automatic stylesheet preprocessor scoping (.scss, .sass, .less, .pcss, .css)
 * - Isomorphic RBAC/ABAC capability engine (@mix/runtime/permissions)
 * - Offline-First CRDT distributed state (@mix/sync)
 * - Reactive typed forms with cancellation (@mix/runtime/forms)
 * - Declarative client routing with pre-loader guards (@mix/router)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface CreateOptions {
  projectName: string;
  targetDir?: string | undefined;
  typescript?: boolean | undefined;
  styleFormat?: ("scss" | "sass" | "less" | "pcss" | "css") | undefined;
  features?: {
    permissions?: boolean | undefined;
    sync?: boolean | undefined;
    forms?: boolean | undefined;
  } | undefined;
}

export interface CreateResult {
  readonly success: boolean;
  readonly targetDir: string;
  readonly createdFiles: readonly string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = path.resolve(__dirname, "../templates");

function walkTemplateDir(dir: string, baseRel = ""): Array<{ absPath: string; relPath: string }> {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: Array<{ absPath: string; relPath: string }> = [];

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...walkTemplateDir(absPath, relPath));
    } else if (entry.isFile()) {
      results.push({ absPath, relPath });
    }
  }
  return results;
}

function applyTemplateTokens(
  content: string,
  tokens: { projectName: string; styleExt: string; compExt: string }
): string {
  return content
    .replaceAll("{{projectName}}", tokens.projectName)
    .replaceAll("{{styleExt}}", tokens.styleExt)
    .replaceAll("{{compExt}}", tokens.compExt);
}

export function create(options: CreateOptions): CreateResult {
  const targetDir = path.resolve(options.targetDir || options.projectName);
  const styleExt = options.styleFormat ?? "scss";
  const isTs = options.typescript !== false; // TypeScript by default
  const compExt = isTs ? "tix" : "mix";

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const tokens = {
    projectName: options.projectName,
    styleExt,
    compExt
  };

  const sources: Array<{ dir: string; mapRelPath: (rel: string) => string }> = [
    {
      dir: path.join(TEMPLATES_ROOT, "shared"),
      mapRelPath: (rel) => rel.replace(/\.tpl$/, "")
    },
    {
      dir: path.join(TEMPLATES_ROOT, isTs ? "ts" : "js"),
      mapRelPath: (rel) => rel
    },
    {
      dir: path.join(TEMPLATES_ROOT, "styles", styleExt === "css" ? "css" : "preproc"),
      mapRelPath: (rel) => rel.replace(/\.style$/, `.${styleExt}`)
    }
  ];

  const createdFiles: string[] = [];

  for (const sourceGroup of sources) {
    const templateFiles = walkTemplateDir(sourceGroup.dir);
    for (const tpl of templateFiles) {
      const destRel = applyTemplateTokens(sourceGroup.mapRelPath(tpl.relPath), tokens);
      const rawContent = fs.readFileSync(tpl.absPath, "utf-8");
      const rendered = applyTemplateTokens(rawContent, tokens);
      const fullPath = path.join(targetDir, destRel);
      const outDir = path.dirname(fullPath);
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(fullPath, rendered, "utf-8");
      createdFiles.push(fullPath);
    }
  }

  return {
    success: true,
    targetDir,
    createdFiles
  };
}
