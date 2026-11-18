/**
 * @dotmix/cli — production module output for `mix build`.
 *
 * Every compiled module is written once, as its own ES module, to dist/assets/<path>-<hash>.js
 * (same folder structure as src/). Relative specifiers stay as written; the import map of
 * index.html maps each unhashed URL (/assets/<path>.js) to its hashed file, so static and
 * dynamic imports share one instance of every module.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import {
  listDynamicImportSpecifiers,
  listStaticImportSpecifiers,
  removeJavaScriptComments,
  removeSideEffectImports,
  computeRemoveSideEffectImportsEdits,
  computeRemoveCommentsEdits,
  shiftMapThroughEdits,
  applyTextEdits,
  type SourceMapV3
} from "@dotmix/compiler-semantic";
import { shortHash, STYLE_FILE_REGEX } from "./scanner.js";
import type { BundleChunkInfo } from "./minifier.js";

export interface EmittedModules {
  /** Unhashed module URL (with base) to hashed module URL (with base). */
  readonly importMapEntries: Record<string, string>;
  /** Hashed URLs of the entry and its static imports, in dependency order. */
  readonly modulePreloadUrls: readonly string[];
  readonly entryUrl: string | undefined;
  readonly chunks: readonly BundleChunkInfo[];
  readonly writtenFiles: readonly string[];
}

export interface EmitModulesOptions {
  /** Compiled modules keyed by their path relative to src/, with a .js extension and "/" separators. */
  readonly modules: ReadonlyMap<string, string>;
  readonly sourceMaps?: ReadonlyMap<string, SourceMapV3> | undefined;
  readonly sourcemap?: boolean | undefined;
  readonly outputDirectory: string;
  readonly basePath: string;
  readonly removeComments: boolean;
}

const ASSETS_DIRECTORY_NAME = "assets";

function isRelativeSpecifier(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/** Resolves a relative specifier against the module path (both relative to src/, "/" separators). */
export function resolveModulePath(fromModulePath: string, specifier: string): string {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromModulePath), specifier));
}

function isStylesheetSpecifier(specifier: string): boolean {
  return STYLE_FILE_REGEX.test(specifier);
}

function chooseEntryModule(modules: ReadonlyMap<string, string>): string | undefined {
  if (modules.has("main.js")) return "main.js";
  return [...modules.keys()][0];
}

function collectStaticGraph(
  entryModulePath: string,
  staticImports: ReadonlyMap<string, readonly string[]>
): string[] {
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visit = (modulePath: string): void => {
    if (visited.has(modulePath) || !staticImports.has(modulePath)) return;
    visited.add(modulePath);
    for (const importedPath of staticImports.get(modulePath) ?? []) visit(importedPath);
    ordered.push(modulePath);
  };
  visit(entryModulePath);
  return ordered;
}

export function emitProductionModules(options: EmitModulesOptions): EmittedModules {
  const assetsDirectory = path.join(options.outputDirectory, ASSETS_DIRECTORY_NAME);
  const importMapEntries: Record<string, string> = {};
  const hashedPaths = new Map<string, string>();
  const staticImports = new Map<string, string[]>();
  const dynamicTargets = new Set<string>();
  const writtenFiles: string[] = [];
  const emittedCode = new Map<string, string>();

  for (const [modulePath, compiledCode] of options.modules) {
    const withoutStylesheets = removeSideEffectImports(compiledCode, isStylesheetSpecifier);
    const finalCode = options.removeComments ? removeJavaScriptComments(withoutStylesheets) : withoutStylesheets;
    const hashedPath = `${modulePath.slice(0, -".js".length)}-${shortHash(finalCode)}.js`;
    const absolutePath = path.join(assetsDirectory, ...hashedPath.split("/"));
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });

    let codeToWrite = finalCode;

    if (options.sourcemap) {
      const baseMap = options.sourceMaps?.get(modulePath);
      if (baseMap) {
        const styleEdits = computeRemoveSideEffectImportsEdits(compiledCode, isStylesheetSpecifier);
        let map = shiftMapThroughEdits(baseMap, compiledCode, styleEdits);
        let current = applyTextEdits(compiledCode, styleEdits);

        if (options.removeComments) {
          const commentEdits = computeRemoveCommentsEdits(current);
          map = shiftMapThroughEdits(map, current, commentEdits);
          current = applyTextEdits(current, commentEdits);
        }

        const mapFileName = `${path.basename(hashedPath)}.map`;
        const mapAbsolutePath = `${absolutePath}.map`;

        const serializedMap = JSON.stringify({
          version: 3,
          file: path.basename(hashedPath),
          sources: map.sources,
          ...(map.sourcesContent ? { sourcesContent: map.sourcesContent } : {}),
          names: map.names ?? [],
          mappings: map.mappings
        });
        fs.writeFileSync(mapAbsolutePath, serializedMap, "utf-8");
        writtenFiles.push(mapAbsolutePath);

        codeToWrite = `${finalCode}\n//# sourceMappingURL=${mapFileName}\n`;
      }
    }

    fs.writeFileSync(absolutePath, codeToWrite, "utf-8");
    writtenFiles.push(absolutePath);
    hashedPaths.set(modulePath, hashedPath);
    emittedCode.set(modulePath, finalCode);
    importMapEntries[`${options.basePath}${ASSETS_DIRECTORY_NAME}/${modulePath}`] =
      `${options.basePath}${ASSETS_DIRECTORY_NAME}/${hashedPath}`;

    staticImports.set(
      modulePath,
      listStaticImportSpecifiers(finalCode)
        .filter(isRelativeSpecifier)
        .map((specifier) => resolveModulePath(modulePath, specifier))
        .filter((importedPath) => options.modules.has(importedPath))
    );
    for (const specifier of listDynamicImportSpecifiers(finalCode)) {
      if (isRelativeSpecifier(specifier)) dynamicTargets.add(resolveModulePath(modulePath, specifier));
    }
  }

  const entryModulePath = chooseEntryModule(options.modules);
  const preloadedModules = entryModulePath ? collectStaticGraph(entryModulePath, staticImports) : [];
  const toHashedUrl = (modulePath: string): string =>
    `${options.basePath}${ASSETS_DIRECTORY_NAME}/${hashedPaths.get(modulePath)!}`;

  const chunks: BundleChunkInfo[] = [];
  for (const [modulePath, finalCode] of emittedCode) {
    const chunk: BundleChunkInfo = {
      file: `${ASSETS_DIRECTORY_NAME}/${hashedPaths.get(modulePath)!}`,
      name: modulePath.slice(0, -".js".length),
      sizeBytes: Buffer.byteLength(finalCode, "utf-8"),
      gzipBytes: zlib.gzipSync(Buffer.from(finalCode, "utf-8")).byteLength,
      isEntry: modulePath === entryModulePath,
      isDynamicEntry: dynamicTargets.has(modulePath),
      ...(options.sourcemap ? { map: `${ASSETS_DIRECTORY_NAME}/${hashedPaths.get(modulePath)!}.map` } : {})
    };
    if (chunk.isEntry) chunks.unshift(chunk);
    else chunks.push(chunk);
  }

  return {
    importMapEntries,
    modulePreloadUrls: preloadedModules.map(toHashedUrl),
    entryUrl: entryModulePath ? toHashedUrl(entryModulePath) : undefined,
    chunks,
    writtenFiles
  };
}
