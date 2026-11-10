/**
 * @mix/compiler-semantic/typechecker — TypeScript 6.0.3 Compiler API verification adapter (D-106, D-131, R-TC-01..03).
 */

import * as ts from "typescript";
import { deepFreeze } from "@mix/ast";
import type { ComponentNode } from "@mix/ast";
import { MixDiagnosticError, DiagnosticCodes } from "@mix/diagnostics";
import type { Diagnostic } from "@mix/diagnostics";
import { STYLE_EXTENSION_REGEX } from "./constants.js";
import { analyze } from "./scope-analyzer.js";
import { mapProjectedSpanToSource } from "./sourcemap.js";
import { projectTypeScript, extractTixModuleSurface } from "./projection.js";
import {
  posixDirname,
  IMMUTABLE_DTS_SOURCE_FILE_CACHE,
  resolveMixPackageDts,
  VIRTUAL_AMBIENT_RUNTIME_DTS
} from "./dts-resolver.js";
import type {
  ComponentDescriptor,
  TypecheckOptions,
  TypecheckResult
} from "./types.js";

/**
 * Verifies a `.tix` ComponentNode or ComponentDescriptor using the official TypeScript 6.0.3 Compiler API (D-106, D-131).
 */
export function typecheckTix(
  astOrDesc: ComponentNode | ComponentDescriptor,
  originalSource: string,
  options?: TypecheckOptions
): TypecheckResult {
  const ast: ComponentNode = "ast" in astOrDesc ? astOrDesc.ast : astOrDesc;
  const filename =
    options?.filename ??
    ("filename" in astOrDesc ? astOrDesc.filename : undefined) ??
    ast.span.file ??
    "Component.tix";
  const baseDir =
    options?.baseDir ??
    (filename.includes("/") || filename.includes("\\")
      ? posixDirname(ts.sys.resolvePath(filename))
      : ts.sys.getCurrentDirectory().replace(/\\/g, "/"));

  const semanticDesc = analyze(ast, {
    filename,
    source: originalSource,
    throwOnError: false
  });

  const projection = projectTypeScript(ast, originalSource, filename);
  const diagnostics: Diagnostic[] = [...semanticDesc.diagnostics];

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true
  };

  const defaultHost = ts.createCompilerHost(compilerOptions, true);
  const defaultLibPath = defaultHost.getDefaultLibFileName(compilerOptions).replace(/\\/g, "/");
  const normalizedVirtualFilename = projection.virtualFilename.replace(/\\/g, "/");

  const virtualFileMap = new Map<string, string>();
  virtualFileMap.set(projection.virtualFilename, projection.code);
  virtualFileMap.set(normalizedVirtualFilename, projection.code);
  virtualFileMap.set("/__mix_ambient.d.ts", VIRTUAL_AMBIENT_RUNTIME_DTS);

  if (options?.virtualFiles) {
    for (const [vPath, vContent] of Object.entries(options.virtualFiles)) {
      const normVPath = vPath.replace(/\\/g, "/");
      virtualFileMap.set(vPath, vContent);
      virtualFileMap.set(normVPath, vContent);
      if (normVPath.endsWith(".tix") || normVPath.endsWith(".mix")) {
        virtualFileMap.set(`${normVPath}.ts`, vContent);
      }
    }
  }

  const customHost: ts.CompilerHost = {
    ...defaultHost,
    fileExists(fileName: string): boolean {
      const normalized = fileName.replace(/\\/g, "/");
      if (virtualFileMap.has(fileName) || virtualFileMap.has(normalized)) return true;
      for (const key of virtualFileMap.keys()) {
        if (normalized.endsWith(`/${key.replace(/^\.\//, "")}`) || key === normalized) return true;
      }
      return defaultHost.fileExists(fileName);
    },
    readFile(fileName: string): string | undefined {
      const normalized = fileName.replace(/\\/g, "/");
      if (virtualFileMap.has(fileName)) return virtualFileMap.get(fileName);
      if (virtualFileMap.has(normalized)) return virtualFileMap.get(normalized);
      for (const [key, val] of virtualFileMap.entries()) {
        if (normalized.endsWith(`/${key.replace(/^\.\//, "")}`)) return val;
      }
      return defaultHost.readFile(fileName);
    },
    getSourceFile(fileName: string, languageVersion: ts.ScriptTarget, onError?: (message: string) => void) {
      const normalized = fileName.replace(/\\/g, "/");
      if (virtualFileMap.has(fileName) || virtualFileMap.has(normalized)) {
        const content = virtualFileMap.get(normalized) ?? virtualFileMap.get(fileName)!;
        return ts.createSourceFile(fileName, content, languageVersion, true);
      }
      for (const [key, val] of virtualFileMap.entries()) {
        if (normalized.endsWith(`/${key.replace(/^\.\//, "")}`)) {
          return ts.createSourceFile(fileName, val, languageVersion, true);
        }
      }
      if (normalized.endsWith(".d.ts")) {
        const cachedSf = IMMUTABLE_DTS_SOURCE_FILE_CACHE.get(normalized);
        if (cachedSf) {
          return cachedSf;
        }
        const sf = defaultHost.getSourceFile(fileName, languageVersion, onError);
        if (sf) {
          IMMUTABLE_DTS_SOURCE_FILE_CACHE.set(normalized, sf);
        }
        return sf;
      }
      return defaultHost.getSourceFile(fileName, languageVersion, onError);
    },
    resolveModuleNames(moduleNames: string[], containingFile: string): (ts.ResolvedModule | undefined)[] {
      const normContaining = containingFile.replace(/\\/g, "/");
      const containingDir =
        normContaining === normalizedVirtualFilename ||
        normContaining.endsWith(`/${normalizedVirtualFilename}`)
          ? baseDir.replace(/\\/g, "/")
          : posixDirname(normContaining);

      return moduleNames.map((modName) => {
        if (STYLE_EXTENSION_REGEX.test(modName)) {
          return {
            resolvedFileName: "/__mix_ambient.d.ts",
            extension: ts.Extension.Dts,
            isExternalLibraryImport: true
          };
        }

        // 1. Check virtualFiles first (for unit tests supplying virtual files)
        const vCandidates = [
          modName,
          `${modName}.ts`,
          modName.replace(/^\.\//, ""),
          `${modName.replace(/^\.\//, "")}.ts`
        ];
        for (const cand of vCandidates) {
          if (virtualFileMap.has(cand)) {
            return {
              resolvedFileName: cand,
              extension: ts.Extension.Ts
            };
          }
        }

        // 2. Resolve @mix/* and mix-helpers packages to their real emitted .d.ts files on disk (D-131)
        if (modName.startsWith("@mix/") || modName.startsWith("mix-helpers")) {
          const dtsPath = resolveMixPackageDts(modName, normContaining, baseDir);
          if (dtsPath) {
            return {
              resolvedFileName: dtsPath,
              extension: ts.Extension.Dts,
              isExternalLibraryImport: true
            };
          }
        }

        // 3. Resolve relative imports (.tix, .mix, .js -> .d.ts/.ts, .ts) on disk
        if (modName.startsWith("./") || modName.startsWith("../")) {
          const absTarget = ts.sys.resolvePath(`${containingDir}/${modName}`).replace(/\\/g, "/");

          if (modName.endsWith(".tix") || modName.endsWith(".mix")) {
            const vKey = `${absTarget}.ts`;
            if (virtualFileMap.has(vKey)) {
              return {
                resolvedFileName: vKey,
                extension: ts.Extension.Ts
              };
            }
            if (ts.sys.fileExists(absTarget)) {
              const rawComp = ts.sys.readFile(absTarget) ?? "";
              const surfaceTs = extractTixModuleSurface(rawComp);
              virtualFileMap.set(vKey, surfaceTs);
              return {
                resolvedFileName: vKey,
                extension: ts.Extension.Ts
              };
            }
          } else if (modName.endsWith(".js") || modName.endsWith(".mjs")) {
            const dtsCand = absTarget.replace(/\.(m)?js$/, ".d.ts");
            if (ts.sys.fileExists(dtsCand)) {
              return {
                resolvedFileName: dtsCand,
                extension: ts.Extension.Dts
              };
            }
            const tsCand = absTarget.replace(/\.(m)?js$/, ".ts");
            if (ts.sys.fileExists(tsCand)) {
              return {
                resolvedFileName: tsCand,
                extension: ts.Extension.Ts
              };
            }
            if (ts.sys.fileExists(absTarget)) {
              return {
                resolvedFileName: absTarget,
                extension: ts.Extension.Js
              };
            }
          } else if (modName.endsWith(".ts")) {
            if (ts.sys.fileExists(absTarget)) {
              return {
                resolvedFileName: absTarget,
                extension: ts.Extension.Ts
              };
            }
          } else if (modName.endsWith(".d.ts")) {
            if (ts.sys.fileExists(absTarget)) {
              return {
                resolvedFileName: absTarget,
                extension: ts.Extension.Dts
              };
            }
          }
        }

        const resolved = ts.resolveModuleName(modName, containingFile, compilerOptions, defaultHost);
        return resolved.resolvedModule;
      });
    }
  };

  const rootNames = [defaultLibPath, "/__mix_ambient.d.ts", normalizedVirtualFilename];
  const program = ts.createProgram(rootNames, compilerOptions, customHost);
  const projectedSf =
    program.getSourceFile(normalizedVirtualFilename) ??
    program.getSourceFile(projection.virtualFilename);
  const tsDiagnostics = projectedSf ? program.getSemanticDiagnostics(projectedSf) : [];

  for (const tsDiag of tsDiagnostics) {
    const msg = ts.flattenDiagnosticMessageText(tsDiag.messageText, "\n");
    const genStart = tsDiag.start ?? 0;
    const genLen = tsDiag.length ?? 1;
    const mapped = mapProjectedSpanToSource(
      projection.spanTable,
      genStart,
      genLen,
      originalSource,
      filename
    );

    if (mapped.isInternal) {
      diagnostics.push({
        code: DiagnosticCodes.MIX_INTERNAL_TYPECHECK,
        message: `Internal TypeScript projection diagnostic: ${msg}`,
        severity: "error",
        span: mapped.span
      });
    } else {
      diagnostics.push({
        code: DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE,
        message: msg,
        severity: "error",
        span: mapped.span
      });
    }
  }

  if ((options?.throwOnError ?? false) && diagnostics.length > 0) {
    throw new MixDiagnosticError(diagnostics[0]!);
  }

  return deepFreeze({
    projection,
    diagnostics
  });
}
