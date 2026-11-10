/**
 * @mix/cli — `mix build` (AOT compiler & production bundler with lazy route code-splitting, hashed assets, minification & gzip report)
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { parse } from "@mix/compiler-frontend";
import { analyze, projectTypeScript, transpileSourceModule } from "@mix/compiler-semantic";
import { generate } from "@mix/compiler-codegen";
import { compileCss, preprocessCss } from "@mix/compiler-css";

export interface BuildOptions {
  inDir?: string | undefined;
  outDir?: string | undefined;
  minify?: boolean | undefined;
  silent?: boolean | undefined;
}

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

export interface BuildResult {
  success: boolean;
  compiledFiles: string[];
  watchedFiles: string[];
  bundleReport: BundleSizeReport;
}

interface ScannedSources {
  mixFiles: string[];
  scriptFiles: string[];
  styleFiles: string[];
}

const STYLE_FILE_REGEX = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)$/i;

function scanInputDirectory(dir: string): ScannedSources {
  const mixFiles: string[] = [];
  const scriptFiles: string[] = [];
  const styleFiles: string[] = [];

  if (!fs.existsSync(dir)) {
    return { mixFiles, scriptFiles, styleFiles };
  }

  function walk(current: string): void {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".mix") || entry.name.endsWith(".tix")) {
          mixFiles.push(fullPath);
        } else if (
          (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) &&
          !entry.name.endsWith(".d.ts")
        ) {
          scriptFiles.push(fullPath);
        } else if (STYLE_FILE_REGEX.test(entry.name)) {
          styleFiles.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return { mixFiles, scriptFiles, styleFiles };
}

function shortHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 8);
}

function minifyJs(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .join("\n");
}

function minifyCss(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}:;,])\s*/g, "$1")
    .replace(/;}/g, "}")
    .trim();
}

function resolveRelativeDistModule(fromFile: string, relSpec: string): string | null {
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
function buildModuleGraphBundle(
  entryFile: string,
  dynamicChunkLookup: ReadonlyMap<string, string>,
  shouldMinify: boolean
): string {
  const visited = new Set<string>();
  const orderedModules: Array<{ file: string; body: string }> = [];
  const externalImports = new Map<string, Set<string>>();
  const sideEffectExternalImports = new Set<string>();

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
            if (!isRootEntry || !dynamicChunkLookup.has(target)) {
              if (dynamicChunkLookup.has(target)) {
                const chunkFile = `./${dynamicChunkLookup.get(target)!}`;
                if (clause) {
                  let set = externalImports.get(chunkFile);
                  if (!set) {
                    set = new Set<string>();
                    externalImports.set(chunkFile, set);
                  }
                  set.add(clause.trim());
                } else {
                  sideEffectExternalImports.add(chunkFile);
                }
                return "";
              }
            } else if (dynamicChunkLookup.has(target)) {
              const chunkFile = `./${dynamicChunkLookup.get(target)!}`;
              if (clause) {
                let set = externalImports.get(chunkFile);
                if (!set) {
                  set = new Set<string>();
                  externalImports.set(chunkFile, set);
                }
                set.add(clause.trim());
              } else {
                sideEffectExternalImports.add(chunkFile);
              }
              return "";
            }
            staticDeps.push(target);
          }
          return "";
        }
        if (spec.startsWith("@mix/")) {
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
              let set = externalImports.get(spec);
              if (!set) {
                set = new Set<string>();
                externalImports.set(spec, set);
              }
              for (const n of names) {
                set.add(n);
              }
            } else {
              let set = externalImports.get(spec);
              if (!set) {
                set = new Set<string>();
                externalImports.set(spec, set);
              }
              set.add(trimmedClause);
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

export function build(options: BuildOptions = {}): BuildResult {
  const inDir = path.resolve(options.inDir ?? "src");
  const outDir = path.resolve(options.outDir ?? "dist");
  const shouldMinify = options.minify !== false;
  const { mixFiles, scriptFiles, styleFiles } = scanInputDirectory(inDir);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const compiledFiles: string[] = [];
  const watchedFilesSet = new Set<string>();
  const emittedCssPaths = new Set<string>();
  const allCompiledCssChunks: string[] = [];

  for (const file of mixFiles) {
    watchedFilesSet.add(file);
    const filename = path.basename(file);
    const relPath = path.relative(inDir, file);
    const relBase = relPath.replace(/\.(mix|tix)$/i, "");
    const source = fs.readFileSync(file, "utf-8");
    const readExternalStyle = (relStylePath: string, fromFile?: string): string => {
      const baseDir = fromFile && path.isAbsolute(fromFile)
        ? path.dirname(fromFile)
        : fromFile
          ? path.dirname(path.resolve(path.dirname(file), fromFile))
          : path.dirname(file);
      const resolved = path.resolve(baseDir, relStylePath);
      if (fs.existsSync(resolved)) {
        watchedFilesSet.add(resolved);
        return fs.readFileSync(resolved, "utf-8");
      }
      return "";
    };
    const ast = parse(source, { filename, readFile: (rel) => readExternalStyle(rel) });
    const desc = analyze(ast, { filename, source });
    const codegen = generate(desc, {
      filename,
      resolveStyle: (src: string, fromFile: string) => readExternalStyle(src, fromFile),
    });
    if (codegen.styleDependencies) {
      for (const dep of codegen.styleDependencies) {
        watchedFilesSet.add(dep);
      }
    }

    // Normalize relative .tix.js / .mix.js specifiers to .js so output matches <relBase>.js
    const normalizedJs = codegen.js.replace(/\.(tix|mix)\.js(["'])/g, ".js$2");

    const jsPath = path.join(outDir, `${relBase}.js`);
    fs.mkdirSync(path.dirname(jsPath), { recursive: true });
    fs.writeFileSync(jsPath, normalizedJs, "utf-8");
    compiledFiles.push(jsPath);

    if (codegen.css) {
      const cssPath = path.join(outDir, `${relBase}.css`);
      fs.mkdirSync(path.dirname(cssPath), { recursive: true });
      fs.writeFileSync(cssPath, codegen.css, "utf-8");
      compiledFiles.push(cssPath);
      emittedCssPaths.add(path.resolve(cssPath));
      allCompiledCssChunks.push(codegen.css);
    }

    if (filename.endsWith(".tix")) {
      const proj = projectTypeScript(desc.ast, source, filename);
      const dtsPath = path.join(outDir, `${relBase}.d.ts`);
      fs.mkdirSync(path.dirname(dtsPath), { recursive: true });
      fs.writeFileSync(dtsPath, proj.code, "utf-8");
      compiledFiles.push(dtsPath);
    }
  }

  for (const scriptFile of scriptFiles) {
    watchedFilesSet.add(scriptFile);
    const relPath = path.relative(inDir, scriptFile);
    const relBase = relPath.replace(/\.(ts|js)$/i, "");
    const source = fs.readFileSync(scriptFile, "utf-8");
    const rawJsCode = transpileSourceModule(source, scriptFile.endsWith(".ts"));
    // Normalize relative .tix / .mix / .ts imports to .js in emitted dist modules
    const jsCode = rawJsCode.replace(
      /(from\s+["'](?:\.\.?\/[^"']+?))\.(tix|mix|ts)(["'])/g,
      "$1.js$3"
    ).replace(
      /(import\s*\(\s*["'](?:\.\.?\/[^"']+?))\.(tix|mix|ts)(["']\s*\))/g,
      "$1.js$3"
    );
    const jsPath = path.join(outDir, `${relBase}.js`);
    fs.mkdirSync(path.dirname(jsPath), { recursive: true });
    fs.writeFileSync(jsPath, jsCode, "utf-8");
    compiledFiles.push(jsPath);
  }

  for (const styleFile of styleFiles) {
    watchedFilesSet.add(styleFile);
    const relPath = path.relative(inDir, styleFile);
    const relBase = relPath.replace(STYLE_FILE_REGEX, "");
    const cssPath = path.resolve(outDir, `${relBase}.css`);
    if (emittedCssPaths.has(cssPath)) {
      continue;
    }
    const rawCss = fs.readFileSync(styleFile, "utf-8");
    if (rawCss.trim().length > 0) {
      const pre = preprocessCss(rawCss, {
        filename: styleFile
      });
      for (const dep of pre.dependencies) {
        watchedFilesSet.add(dep);
      }
      const compiled = compileCss(pre.code, {
        filename: path.basename(styleFile),
        scoped: false
      });
      fs.mkdirSync(path.dirname(cssPath), { recursive: true });
      fs.writeFileSync(cssPath, compiled.code, "utf-8");
      compiledFiles.push(cssPath);
      emittedCssPaths.add(cssPath);
      allCompiledCssChunks.push(compiled.code);
    }
  }

  // ============================================================================
  // Production Bundling, Lazy Route Code-Splitting, Hashed Assets & Size Report (T-29.2)
  // ============================================================================
  const assetsDir = path.join(outDir, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const chunks: BundleChunkInfo[] = [];
  const assets: BundleAssetInfo[] = [];

  // 1. Discover dynamic imports (`import("./...")`) and route page modules across emitted dist .js files
  const emittedJsFiles = compiledFiles.filter((f) => f.endsWith(".js"));
  const dynamicTargets = new Set<string>();
  for (const jsFile of emittedJsFiles) {
    const content = fs.readFileSync(jsFile, "utf-8");
    const dynRe = /import\s*\(\s*["']([^"']+)["']\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = dynRe.exec(content)) !== null) {
      const spec = match[1]!;
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const resolved = resolveRelativeDistModule(jsFile, spec);
        if (resolved) {
          dynamicTargets.add(resolved);
        }
      }
    }
    const relFromOut = path.relative(outDir, jsFile).split(path.sep).join("/");
    if (relFromOut.startsWith("pages/") && path.basename(jsFile) !== "HomePage.js") {
      dynamicTargets.add(path.normalize(jsFile));
    }
  }

  // 2. Emit content-hashed chunks for each dynamically imported route/module
  const dynamicChunkLookup = new Map<string, string>();
  for (const targetFile of dynamicTargets) {
    const baseName = path.basename(targetFile, ".js");
    const chunkCode = buildModuleGraphBundle(targetFile, new Map(), shouldMinify);
    const hash = shortHash(chunkCode);
    const chunkFileName = `${baseName}-${hash}.js`;
    const chunkAbsPath = path.join(assetsDir, chunkFileName);
    fs.writeFileSync(chunkAbsPath, chunkCode, "utf-8");
    compiledFiles.push(chunkAbsPath);
    dynamicChunkLookup.set(targetFile, chunkFileName);

    const sizeBytes = Buffer.byteLength(chunkCode, "utf-8");
    const gzipBytes = zlib.gzipSync(Buffer.from(chunkCode, "utf-8")).byteLength;
    chunks.push({
      file: `assets/${chunkFileName}`,
      name: baseName,
      sizeBytes,
      gzipBytes,
      isEntry: false,
      isDynamicEntry: true
    });
  }

  // 3. Emit content-hashed entry bundle (from dist/main.js if present, or first emitted .js file)
  const mainEntryCandidate = path.join(outDir, "main.js");
  const rootEntry = fs.existsSync(mainEntryCandidate)
    ? mainEntryCandidate
    : emittedJsFiles[0];

  if (rootEntry && fs.existsSync(rootEntry)) {
    const entryName = path.basename(rootEntry, ".js");
    const mainBundleCode = buildModuleGraphBundle(rootEntry, dynamicChunkLookup, shouldMinify);
    const mainHash = shortHash(mainBundleCode);
    const mainFileName = `${entryName}-${mainHash}.js`;
    const mainAbsPath = path.join(assetsDir, mainFileName);
    fs.writeFileSync(mainAbsPath, mainBundleCode, "utf-8");
    compiledFiles.push(mainAbsPath);

    const sizeBytes = Buffer.byteLength(mainBundleCode, "utf-8");
    const gzipBytes = zlib.gzipSync(Buffer.from(mainBundleCode, "utf-8")).byteLength;
    chunks.unshift({
      file: `assets/${mainFileName}`,
      name: entryName,
      sizeBytes,
      gzipBytes,
      isEntry: true,
      isDynamicEntry: false
    });
  }

  // 4. Emit content-hashed minified CSS bundle
  if (allCompiledCssChunks.length > 0) {
    const mergedCss = shouldMinify
      ? minifyCss(allCompiledCssChunks.join("\n"))
      : allCompiledCssChunks.join("\n");
    if (mergedCss.length > 0) {
      const cssHash = shortHash(mergedCss);
      const cssFileName = `styles-${cssHash}.css`;
      const cssAbsPath = path.join(assetsDir, cssFileName);
      fs.writeFileSync(cssAbsPath, mergedCss, "utf-8");
      compiledFiles.push(cssAbsPath);

      const sizeBytes = Buffer.byteLength(mergedCss, "utf-8");
      const gzipBytes = zlib.gzipSync(Buffer.from(mergedCss, "utf-8")).byteLength;
      assets.push({
        file: `assets/${cssFileName}`,
        sizeBytes,
        gzipBytes
      });
    }
  }

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

  const bundleReport: BundleSizeReport = {
    chunks,
    assets,
    totalBytes,
    totalGzipBytes,
    reportText: reportLines.join("\n")
  };

  fs.writeFileSync(
    path.join(outDir, "bundle-report.json"),
    JSON.stringify(bundleReport, null, 2),
    "utf-8"
  );

  return {
    success: true,
    compiledFiles,
    watchedFiles: [...watchedFilesSet],
    bundleReport
  };
}
