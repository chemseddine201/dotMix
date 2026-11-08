// packages/compiler-semantic/src/resolver.ts — FROZEN per MIX_SPEC_v3.2.2 §5.2
import { MixError } from "@mix/runtime/core";

export interface ResolverOptions {
  /**
   * Optional hook to check if an extensionless specifier resolves to a .tix file on disk.
   */
  isTixTarget?: (specifier: string) => boolean;
}

/**
 * R-RS-01: Imports in source code require an explicit extension (.tix or .mix).
 * Importing a .tix file without an extension throws MIX_RES_TIX_EXTENSION_REQUIRED.
 */
export function validateImportSpecifier(
  specifier: string,
  options?: ResolverOptions
): void {
  // Check if specifier is extensionless but references a .tix file
  if (!specifier.endsWith(".tix") && !specifier.endsWith(".mix") && !specifier.endsWith(".js") && !specifier.endsWith(".ts")) {
    if (options?.isTixTarget && options.isTixTarget(specifier)) {
      throw new MixError(
        "MIX_RES_TIX_EXTENSION_REQUIRED",
        `Import specifier "${specifier}" must include explicit ".tix" extension (e.g. "${specifier}.tix")`
      );
    }
  }
}

/**
 * R-RS-02: Maps a .tix file path to its virtual projection path .tix.ts for typechecking.
 */
export function resolveTixVirtualPath(filePath: string): string {
  if (filePath.endsWith(".tix")) {
    return filePath + ".ts"; // or filePath.replace(/\.tix$/, ".tix.ts")
  }
  return filePath;
}

/**
 * R-RS-03 & R-RS-04: Rewrites .tix imports to .tix.js for emitted ESM code.
 * Preserves native ESM compliance in Node.js and modern browsers.
 */
export function rewriteTixImport(specifier: string): string {
  if (specifier.endsWith(".tix")) {
    return specifier + ".js";
  }
  return specifier;
}

/**
 * Checks an import specifier in a .tix file:
 * If an extensionless relative import is detected and intended for a .tix component,
 * it must be flagged.
 */
export function checkTixImportRule(specifier: string, targetFileExistsAsTix: boolean): void {
  if (targetFileExistsAsTix && !specifier.endsWith(".tix")) {
    throw new MixError(
      "MIX_RES_TIX_EXTENSION_REQUIRED",
      `Import "${specifier}" points to a .tix component but omits the explicit ".tix" extension`
    );
  }
}
