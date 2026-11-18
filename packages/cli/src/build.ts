/**
 * @dotmix/cli — `mix build`: compiles the sources ahead of time, then writes either one hashed ES
 * module per source module with an import map and HTML shell (client), or plain per-file modules (ssr).
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { normalizeDriveLetter } from "./normalize-path.js";
import { parse } from "@dotmix/compiler-frontend";
import {
  analyze,
  projectTypeScript,
  replaceImportMetaEnv,
  rewriteJsModuleSpecifiers,
  transpileSourceModule,
  computeImportMetaEnvEdits,
  computeJsModuleSpecifierEdits,
  shiftMapThroughEdits,
  applyTextEdits,
  type SourceMapV3
} from "@dotmix/compiler-semantic";
import { generate, type CodegenOptions } from "@dotmix/compiler-codegen";
import { compileCss, minifyStylesheet, preprocessCss } from "@dotmix/compiler-css";
import {
  STYLE_FILE_REGEX,
  scanInputDirectory,
  shortHash,
} from "./scanner.js";
import {
  type BundleChunkInfo,
  type BundleAssetInfo,
  type BundleSizeReport,
  createBundleReport,
} from "./minifier.js";
import { normalizeBasePath, writeProductionShell } from "./production-shell.js";
import { emitProductionModules } from "./production-modules.js";
import { buildImportMetaEnvValues } from "./env-files.js";

export type {
  BundleChunkInfo,
  BundleAssetInfo,
  BundleSizeReport,
};
export { createBundleReport } from "./minifier.js";
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
  target?: ("client" | "ssr") | undefined;
  sourcemap?: boolean | undefined;
  clean?: boolean | undefined;
  analyze?: boolean | undefined;
  mode?: string | undefined;
  base?: string | undefined;
}

export interface BuildResult {
  success: boolean;
  compiledFiles: string[];
  watchedFiles: string[];
  bundleReport: BundleSizeReport;
  manifestPath?: string | undefined;
}

export function build(options: BuildOptions = {}): BuildResult {
  const inDir = normalizeDriveLetter(path.resolve(options.inDir ?? "src"));
  const outDir = normalizeDriveLetter(path.resolve(options.outDir ?? "dist"));
  const shouldMinify = options.minify !== false;
  const mode = options.mode ?? "production";
  const envValues = buildImportMetaEnvValues(path.dirname(inDir), mode);

  if (options.clean && fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  const { mixFiles, scriptFiles, styleFiles } = scanInputDirectory(inDir);
  fs.mkdirSync(outDir, { recursive: true });

  const compiledFiles: string[] = [];
  const watchedFilesSet = new Set<string>();
  /** Compiled JavaScript modules keyed by their path relative to src/ ("components/Card.js"). */
  const compiledModules = new Map<string, string>();
  /** Source maps for compiled JavaScript modules, keyed like compiledModules. */
  const compiledSourceMaps = new Map<string, SourceMapV3>();
  /** Per-file stylesheets (server output only), keyed like compiledModules. */
  const compiledStylesheets = new Map<string, string>();
  /** Type projections of .tix components (server output only). */
  const projectedDeclarations = new Map<string, string>();
  const allCompiledCssChunks: string[] = [];
  const globalCssChunks: string[] = [];
  const toModuleKey = (absolutePath: string, extension: string): string =>
    `${toPosixPath(path.relative(inDir, absolutePath)).slice(0, -path.extname(absolutePath).length)}${extension}`;

  for (const file of mixFiles) {
    watchedFilesSet.add(file);
    const filename = path.basename(file);
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
    const codegenOptions: CodegenOptions & { mode?: string; source?: string } = {
      filename,
      source,
      mode,
      sourceMap: Boolean(options.sourcemap),
      resolveStyle: (src: string, fromFile: string) => readExternalStyle(src, fromFile),
    };
    const codegen = generate(desc, codegenOptions);
    for (const dependency of codegen.styleDependencies ?? []) {
      watchedFilesSet.add(dependency);
    }

    const moduleKey = toModuleKey(file, ".js");
    let currentJs = codegen.js;
    let currentMap = codegen.map;

    if (options.sourcemap && currentMap) {
      const envEdits = computeImportMetaEnvEdits(currentJs, envValues);
      currentMap = shiftMapThroughEdits(currentMap, currentJs, envEdits);
      currentJs = applyTextEdits(currentJs, envEdits);

      const specifierEdits = computeJsModuleSpecifierEdits(currentJs, toEmittedModuleSpecifier);
      currentMap = shiftMapThroughEdits(currentMap, currentJs, specifierEdits);
      currentJs = applyTextEdits(currentJs, specifierEdits);

      compiledSourceMaps.set(moduleKey, currentMap);
    } else {
      const compiledWithEnv = replaceImportMetaEnv(currentJs, envValues);
      currentJs = rewriteJsModuleSpecifiers(compiledWithEnv, toEmittedModuleSpecifier);
    }
    compiledModules.set(moduleKey, currentJs);
    // Global stylesheets a component imports (`./styles/global.scss`) are project files too; the
    // stylesheet loop below adds them to the merged stylesheet once, so keep only the component's own CSS.
    const componentCss = codegen.css !== undefined && codegen.globalCss !== undefined
      ? codegen.css.slice(codegen.globalCss.length).trim()
      : codegen.css;
    if (componentCss) {
      compiledStylesheets.set(toModuleKey(file, ".css"), componentCss);
      allCompiledCssChunks.push(componentCss);
    }
    if (filename.endsWith(".tix")) {
      projectedDeclarations.set(toModuleKey(file, ".d.ts"), projectTypeScript(desc.ast, source, filename).code);
    }
  }

  for (const scriptFile of scriptFiles) {
    watchedFilesSet.add(scriptFile);
    const source = fs.readFileSync(scriptFile, "utf-8");
    const moduleKey = toModuleKey(scriptFile, ".js");

    if (options.sourcemap) {
      const transpiled = transpileSourceModule(source, scriptFile.endsWith(".ts"), {
        sourceMap: true,
        filename: path.relative(inDir, scriptFile).replace(/\\/g, "/")
      });
      let currentJs = transpiled.code;
      let currentMap = transpiled.map;

      if (currentMap) {
        const envEdits = computeImportMetaEnvEdits(currentJs, envValues);
        currentMap = shiftMapThroughEdits(currentMap, currentJs, envEdits);
        currentJs = applyTextEdits(currentJs, envEdits);

        const specifierEdits = computeJsModuleSpecifierEdits(currentJs, toEmittedModuleSpecifier);
        currentMap = shiftMapThroughEdits(currentMap, currentJs, specifierEdits);
        currentJs = applyTextEdits(currentJs, specifierEdits);

        compiledSourceMaps.set(moduleKey, currentMap);
      }
      compiledModules.set(moduleKey, currentJs);
    } else {
      const transpiledCode = replaceImportMetaEnv(
        transpileSourceModule(source, scriptFile.endsWith(".ts")),
        envValues
      );
      compiledModules.set(moduleKey, rewriteJsModuleSpecifiers(transpiledCode, toEmittedModuleSpecifier));
    }
  }

  for (const styleFile of styleFiles) {
    watchedFilesSet.add(styleFile);
    const stylesheetKey = `${toPosixPath(path.relative(inDir, styleFile)).replace(STYLE_FILE_REGEX, "")}.css`;
    if (compiledStylesheets.has(stylesheetKey)) {
      continue;
    }
    const rawCss = fs.readFileSync(styleFile, "utf-8");
    if (rawCss.trim().length > 0) {
      const preprocessed = preprocessCss(rawCss, { filename: styleFile });
      for (const dependency of preprocessed.dependencies) {
        watchedFilesSet.add(dependency);
      }
      const compiled = compileCss(preprocessed.code, {
        filename: path.basename(styleFile),
        scoped: false
      });
      compiledStylesheets.set(stylesheetKey, compiled.code);
      globalCssChunks.push(compiled.code);
    }
  }

  allCompiledCssChunks.unshift(...globalCssChunks);
  const isServerTarget = (options.target ?? "client") === "ssr";
  const chunks: BundleChunkInfo[] = [];
  const assets: BundleAssetInfo[] = [];

  if (isServerTarget) {
    // Server output: one plain module per source module, no hashing and no HTML shell.
    for (const [modulePath, moduleCode] of compiledModules) {
      const modulePathOnDisk = path.join(outDir, ...modulePath.split("/"));
      let codeToWrite = moduleCode;
      if (options.sourcemap) {
        const map = compiledSourceMaps.get(modulePath);
        if (map) {
          const mapPathOnDisk = `${modulePathOnDisk}.map`;
          const mapFileName = `${path.basename(modulePathOnDisk)}.map`;
          const serializedMap = JSON.stringify({
            version: 3,
            file: path.basename(modulePathOnDisk),
            sources: map.sources,
            ...(map.sourcesContent ? { sourcesContent: map.sourcesContent } : {}),
            names: map.names ?? [],
            mappings: map.mappings
          });
          writeOutputFile(mapPathOnDisk, serializedMap);
          codeToWrite = `${moduleCode}\n//# sourceMappingURL=${mapFileName}\n`;
        }
      }
      writeOutputFile(modulePathOnDisk, codeToWrite);
      chunks.push(describeFile(path.relative(outDir, modulePathOnDisk), moduleCode, modulePath === "main.js"));
    }
    for (const [stylesheetPath, stylesheetCode] of compiledStylesheets) {
      const stylesheetPathOnDisk = path.join(outDir, ...stylesheetPath.split("/"));
      writeOutputFile(stylesheetPathOnDisk, stylesheetCode);
      assets.push(describeAsset(path.relative(outDir, stylesheetPathOnDisk), stylesheetCode));
    }
    for (const [declarationPath, declarationCode] of projectedDeclarations) {
      writeOutputFile(path.join(outDir, ...declarationPath.split("/")), declarationCode);
    }
  } else {
    const basePath = normalizeBasePath(options.base);
    const emitted = emitProductionModules({
      modules: compiledModules,
      sourceMaps: compiledSourceMaps,
      sourcemap: options.sourcemap,
      outputDirectory: outDir,
      basePath,
      removeComments: shouldMinify
    });
    compiledFiles.push(...emitted.writtenFiles);
    chunks.push(...emitted.chunks);

    let stylesheetFile: string | undefined;
    if (allCompiledCssChunks.length > 0) {
      const joinedCss = allCompiledCssChunks.join("\n");
      const mergedCss = shouldMinify ? minifyStylesheet(joinedCss) : joinedCss;
      if (mergedCss.length > 0) {
        stylesheetFile = `assets/styles-${shortHash(mergedCss)}.css`;
        writeOutputFile(path.join(outDir, stylesheetFile), mergedCss);
        assets.push(describeAsset(stylesheetFile, mergedCss));
      }
    }

    const shell = writeProductionShell({
      projectDirectory: path.dirname(inDir),
      outputDirectory: outDir,
      basePath,
      entryModuleUrl: emitted.entryUrl,
      modulePreloadUrls: emitted.modulePreloadUrls,
      moduleImportMap: emitted.importMapEntries,
      stylesheetFile,
      moduleFilePaths: emitted.writtenFiles,
    });
    compiledFiles.push(...shell.writtenFiles);
  }

  const bundleReport = createBundleReport(chunks, assets);
  writeOutputFile(path.join(outDir, "bundle-report.json"), JSON.stringify(bundleReport, null, 2));

  const manifestPath = path.join(outDir, "mix-manifest.json");
  const manifest = {
    version: "1.0",
    target: options.target ?? "client",
    entry: chunks.find((chunk) => chunk.isEntry)?.file ?? null,
    chunks: chunks.map((chunk) => ({
      name: chunk.name,
      file: chunk.file,
      ...(chunk.map ? { map: chunk.map } : {}),
      isEntry: chunk.isEntry,
      size: chunk.sizeBytes
    })),
    assets: assets.map((asset) => ({ file: asset.file, size: asset.sizeBytes }))
  };
  writeOutputFile(manifestPath, JSON.stringify(manifest, null, 2));

  return {
    success: true,
    compiledFiles,
    watchedFiles: [...watchedFilesSet],
    bundleReport,
    manifestPath
  };

  function writeOutputFile(filePath: string, contents: string): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents, "utf-8");
    compiledFiles.push(filePath);
  }
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function describeFile(file: string, code: string, isEntry: boolean): BundleChunkInfo {
  return {
    file: toPosixPath(file),
    name: toPosixPath(file).slice(0, -path.extname(file).length),
    sizeBytes: Buffer.byteLength(code, "utf-8"),
    gzipBytes: zlib.gzipSync(Buffer.from(code, "utf-8")).byteLength,
    isEntry,
    isDynamicEntry: false
  };
}

function describeAsset(file: string, code: string): BundleAssetInfo {
  return {
    file: toPosixPath(file),
    sizeBytes: Buffer.byteLength(code, "utf-8"),
    gzipBytes: zlib.gzipSync(Buffer.from(code, "utf-8")).byteLength
  };
}

/** Rewrites relative .tix/.mix/.ts (and .tix.js/.mix.js) specifiers to the emitted .js modules. */
function toEmittedModuleSpecifier(specifier: string): string {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return specifier;
  for (const compiledSuffix of [".tix.js", ".mix.js", ".tix", ".mix", ".ts"]) {
    if (specifier.endsWith(compiledSuffix) && !specifier.endsWith(".d.ts")) {
      return `${specifier.slice(0, -compiledSuffix.length)}.js`;
    }
  }
  return specifier;
}
