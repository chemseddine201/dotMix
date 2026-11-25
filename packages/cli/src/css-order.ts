/**
 * @dotmix/cli/css-order — Depth-first global stylesheet import ordering (D-190 B1).
 */

import fs from "node:fs";
import path from "node:path";
import { isComponentStylesheet } from "@dotmix/compiler-codegen";
import { normalizeDriveLetter } from "./normalize-path.js";
import { STYLE_FILE_REGEX } from "./scanner.js";

export interface ModuleImportRecord {
  readonly absFile: string;
  readonly isComponent: boolean;
  readonly orderedSpecifiers: readonly string[];
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

function resolveRelativeModuleKey(
  inDir: string,
  fromAbsFile: string,
  specifier: string,
  knownModules: ReadonlyMap<string, ModuleImportRecord>
): string | null {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return null;
  }
  const candidateAbs = normalizeDriveLetter(path.resolve(path.dirname(fromAbsFile), specifier));
  let relPosix = toPosixPath(path.relative(inDir, candidateAbs));
  for (const suffix of [".tix.js", ".mix.js", ".tix", ".mix", ".ts", ".js"]) {
    if (relPosix.endsWith(suffix)) {
      relPosix = `${relPosix.slice(0, -suffix.length)}.js`;
      break;
    }
  }
  if (!relPosix.endsWith(".js")) {
    relPosix = `${relPosix}.js`;
  }
  if (knownModules.has(relPosix)) {
    return relPosix;
  }
  const indexKey = `${relPosix.slice(0, -".js".length)}/index.js`;
  if (knownModules.has(indexKey)) {
    return indexKey;
  }
  return null;
}

/**
 * Computes global stylesheet emission order via a depth-first walk of the module graph
 * starting from entry modules (`main.js`, `routes.js`, `App.js`). Duplicate imports
 * retain their first position; any unimported stylesheets on disk follow at the end.
 */
export function computeGlobalStyleImportOrder(options: {
  readonly inDir: string;
  readonly moduleImports: ReadonlyMap<string, ModuleImportRecord>;
  readonly allStyleFiles: readonly string[];
  readonly componentOwnStylePaths: ReadonlySet<string>;
}): string[] {
  const { inDir, moduleImports, allStyleFiles, componentOwnStylePaths } = options;
  const visitedModules = new Set<string>();
  const seenGlobalStyles = new Set<string>();
  const orderedGlobalStyles: string[] = [];

  const visitModule = (moduleKey: string): void => {
    if (visitedModules.has(moduleKey)) return;
    const record = moduleImports.get(moduleKey);
    if (!record) return;
    visitedModules.add(moduleKey);

    for (const spec of record.orderedSpecifiers) {
      if (STYLE_FILE_REGEX.test(spec)) {
        if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
        if (record.isComponent && isComponentStylesheet(spec)) continue;
        const resolvedAbs = normalizeDriveLetter(path.resolve(path.dirname(record.absFile), spec));
        if (componentOwnStylePaths.has(resolvedAbs) || seenGlobalStyles.has(resolvedAbs)) {
          continue;
        }
        if (fs.existsSync(resolvedAbs)) {
          seenGlobalStyles.add(resolvedAbs);
          orderedGlobalStyles.push(resolvedAbs);
        }
      } else {
        const targetKey = resolveRelativeModuleKey(inDir, record.absFile, spec, moduleImports);
        if (targetKey !== null) {
          visitModule(targetKey);
        }
      }
    }
  };

  for (const preferredEntry of ["main.js", "routes.js", "App.js"]) {
    if (moduleImports.has(preferredEntry)) {
      visitModule(preferredEntry);
    }
  }
  for (const moduleKey of [...moduleImports.keys()].sort()) {
    visitModule(moduleKey);
  }
  for (const styleFile of allStyleFiles) {
    const normalized = normalizeDriveLetter(path.resolve(styleFile));
    if (!componentOwnStylePaths.has(normalized) && !seenGlobalStyles.has(normalized)) {
      seenGlobalStyles.add(normalized);
      orderedGlobalStyles.push(normalized);
    }
  }

  return orderedGlobalStyles;
}

