/**
 * @mix/cli — `mix build` (AOT compiler & production bundler with lazy route code-splitting, hashed assets, minification & gzip report)
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { parse } from "@mix/compiler-frontend";
import { analyze, projectTypeScript, transpileSourceModule } from "@mix/compiler-semantic";
import { generate } from "@mix/compiler-codegen";
import { compileCss, preprocessCss } from "@mix/compiler-css";
import {
  STYLE_FILE_REGEX,
  scanInputDirectory,
  shortHash,
} from "./scanner.js";
import {
  type BundleChunkInfo,
  type BundleAssetInfo,
  type BundleSizeReport,
  minifyCss,
  resolveRelativeDistModule,
  buildModuleGraphBundle,
  createBundleReport,
} from "./minifier.js";

export type {
  BundleChunkInfo,
  BundleAssetInfo,
  BundleSizeReport,
};
export {
  minifyJs,
  minifyCss,
  resolveRelativeDistModule,
  createBundleReport,
} from "./minifier.js";
export {
  STYLE_FILE_REGEX,
  type ScannedSources,
  scanInputDirectory,
  shortHash,
} from "./scanner.js";

export interface BuildOptions {
  inDir?: string | undefined;
  outDir?: string | undefined;
  minify?: boolean | undefined;
  silent?: boolean | undefined;
}

export interface BuildResult {
  success: boolean;
  compiledFiles: string[];
  watchedFiles: string[];
  bundleReport: BundleSizeReport;
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

  const bundleReport = createBundleReport(chunks, assets);

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
