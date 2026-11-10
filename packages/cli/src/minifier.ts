/**
 * @mix/cli — JS/CSS Minification, Module Graph Bundler & Bundle Size Reporter
 */

import fs from "node:fs";
import path from "node:path";

export interface BundleChunkInfo {
  readonly file: string;
  readonly name: string;
  readonly sizeBytes: number;
  readonly gzipBytes: number;
  readonly isEntry: boolean;
  readonly isDynamicEntry: boolean;
}

export interface BundleAssetInfo {
  readonly file: string;
  readonly sizeBytes: number;
  readonly gzipBytes: number;
}

export interface BundleSizeReport {
  readonly chunks: readonly BundleChunkInfo[];
  readonly assets: readonly BundleAssetInfo[];
  readonly totalBytes: number;
  readonly totalGzipBytes: number;
  readonly reportText: string;
}

export function minifyJs(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .join("\n");
}

export function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

export function resolveRelativeDistModule(fromFile: string, relSpec: string): string | null {
  const base = path.resolve(path.dirname(fromFile), relSpec);
  for (const cand of [base, `${base}.js`, path.join(base, "index.js")]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return path.normalize(cand);
    }
  }
  return null;
}

/**
 * Bundles an entry module and its static relative dependencies into a single ES module chunk,
 * preserving external `@mix/*` imports and rewriting dynamic `import("./...")` calls to split chunk filenames.
 */
export function buildModuleGraphBundle(
  entryFile: string,
  dynamicChunkLookup: ReadonlyMap<string, string>,
  shouldMinify: boolean
): string {
  const visited = new Set<string>();
  const orderedModules: Array<{ file: string; body: string }> = [];
  const externalImports = new Map<string, Set<string>>();
  const sideEffectExternalImports = new Set<string>();

  function addExternalBinding(spec: string, binding: string): void {
    let set = externalImports.get(spec);
    if (!set) {
      set = new Set<string>();
      externalImports.set(spec, set);
    }
    set.add(binding);
  }

  function visit(modFile: string, isRootEntry: boolean): void {
    const norm = path.normalize(modFile);
    if (visited.has(norm) || !fs.existsSync(norm)) return;
    visited.add(norm);

    const raw = fs.readFileSync(norm, "utf-8");
    const staticDeps: string[] = [];

    // Strip static import statements and collect dependencies
    let body = raw.replace(
      /^\s*import\s+(?:([^"';]+?)\s+from\s+)?["']([^"']+)["'];?\s*$/gm,
      (_, clause: string | undefined, spec: string) => {
        if (spec.startsWith("./") || spec.startsWith("../")) {
          const target = resolveRelativeDistModule(norm, spec);
          if (target) {
            if (dynamicChunkLookup.has(target)) {
              const chunkFile = `./${dynamicChunkLookup.get(target)!}`;
              if (clause) {
                addExternalBinding(chunkFile, clause.trim());
              } else {
                sideEffectExternalImports.add(chunkFile);
              }
              return "";
            }
            staticDeps.push(target);
          }
          return "";
        }
        if (spec.startsWith("@mix/") || spec.startsWith("mix-helpers") || spec === "mix-helpers") {
          if (!clause) {
            sideEffectExternalImports.add(spec);
          } else {
            const trimmedClause = clause.trim();
            if (trimmedClause.startsWith("{") && trimmedClause.endsWith("}")) {
              const names = trimmedClause
                .slice(1, -1)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              for (const n of names) {
                addExternalBinding(spec, n);
              }
            } else {
              addExternalBinding(spec, trimmedClause);
            }
          }
          return "";
        }
        return "";
      }
    );

    for (const dep of staticDeps) {
      visit(dep, false);
    }

    // Rewrite dynamic import("./...") to point to split hashed chunk in ./<chunkFile>
    body = body.replace(
      /import\s*\(\s*["']([^"']+)["']\s*\)/g,
      (fullMatch, dynSpec: string) => {
        if (dynSpec.startsWith("./") || dynSpec.startsWith("../")) {
          const target = resolveRelativeDistModule(norm, dynSpec);
          if (target && dynamicChunkLookup.has(target)) {
            return `import("./${dynamicChunkLookup.get(target)!}")`;
          }
        }
        return fullMatch;
      }
    );

    // For non-entry modules, strip `export default` and convert `export function/const/let` to local declarations
    if (!isRootEntry) {
      body = body
        .replace(/^\s*export\s+default\s+[A-Za-z0-9_$]+;?\s*$/gm, "")
        .replace(/^\s*export\s+(function|const|let|var|class)\s+/gm, "$1 ");
    }

    orderedModules.push({ file: norm, body });
  }

  visit(entryFile, true);

  const headerLines: string[] = [];
  for (const [spec, bindings] of externalImports.entries()) {
    const namedBindings: string[] = [];
    const defaultBindings: string[] = [];
    for (const b of bindings) {
      if (spec.startsWith("./")) {
        defaultBindings.push(b);
      } else if (b.includes(" as ") || !b.startsWith("*")) {
        namedBindings.push(b);
      } else {
        defaultBindings.push(b);
      }
    }
    if (namedBindings.length > 0) {
      headerLines.push(`import { ${namedBindings.join(", ")} } from "${spec}";`);
    }
    for (const def of defaultBindings) {
      headerLines.push(`import ${def} from "${spec}";`);
    }
  }
  for (const spec of sideEffectExternalImports) {
    if (!externalImports.has(spec)) {
      headerLines.push(`import "${spec}";`);
    }
  }

  const combined = [
    ...headerLines,
    ...orderedModules.map((m) => m.body)
  ].join("\n");

  return shouldMinify ? minifyJs(combined) : combined;
}

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} kB`;
}

export function createBundleReport(
  chunks: readonly BundleChunkInfo[],
  assets: readonly BundleAssetInfo[]
): BundleSizeReport {
  let totalBytes = 0;
  let totalGzipBytes = 0;
  const reportLines: string[] = [
    "Bundle Size Report:",
    "----------------------------------------------------------------------",
    `${"Asset / Chunk".padEnd(38)} ${"Size".padStart(12)} ${"Gzip".padStart(14)}`,
    "----------------------------------------------------------------------"
  ];

  for (const chunk of chunks) {
    totalBytes += chunk.sizeBytes;
    totalGzipBytes += chunk.gzipBytes;
    const tag = chunk.isEntry ? " [entry]" : chunk.isDynamicEntry ? " [lazy]" : "";
    reportLines.push(
      `${(chunk.file + tag).padEnd(38)} ${formatKb(chunk.sizeBytes).padStart(12)} ${`gzip: ${formatKb(chunk.gzipBytes)}`.padStart(14)}`
    );
  }
  for (const asset of assets) {
    totalBytes += asset.sizeBytes;
    totalGzipBytes += asset.gzipBytes;
    reportLines.push(
      `${asset.file.padEnd(38)} ${formatKb(asset.sizeBytes).padStart(12)} ${`gzip: ${formatKb(asset.gzipBytes)}`.padStart(14)}`
    );
  }
  reportLines.push("----------------------------------------------------------------------");
  reportLines.push(
    `${"Total".padEnd(38)} ${formatKb(totalBytes).padStart(12)} ${`gzip: ${formatKb(totalGzipBytes)}`.padStart(14)}`
  );

  return {
    chunks,
    assets,
    totalBytes,
    totalGzipBytes,
    reportText: reportLines.join("\n")
  };
}
