/**
 * @mix/compiler-css — Build-Time Stylesheet Preprocessor Stage (Gate 27 / T-27.3 / D-130)
 *
 * Compiles `.scss`, `.sass`, `.less`, and `.pcss` / `.postcss` stylesheets into standard,
 * flat CSS prior to `compileCss` scoping and security validation:
 * - Resolves build-time `@import` and `@use` partials and records resolved paths in `dependencies`.
 * - Evaluates SCSS (`$var`) and Less (`@var`) variables.
 * - Expands SCSS `@mixin` / `@include` and Less parametric mixins.
 * - Flattens nested rules and parent selector `&` concatenation (`&-primary`, `&:hover`, `&.active`).
 * - Fails with `MIX_ERR_PREPROCESSOR_MISSING` and an install hint when an unsupported external
 *   preprocessor is requested.
 * - Preserves D-108 strictly for plain `.css` and post-preprocessed output.
 */

import * as path from "node:path";
import { DiagnosticCodes, MixDiagnosticError } from "@mix/diagnostics";
import {
  makeDefaultSpan,
  stripComments,
  convertIndentedSassToScss,
  inlinePartials
} from "./import-resolver.js";
import { preprocessScss } from "./preprocessors/scss.js";
import { preprocessLess } from "./preprocessors/less.js";
import { preprocessPostcss } from "./preprocessors/postcss.js";

export type PreprocessorLang =
  | "css"
  | "scss"
  | "sass"
  | "less"
  | "pcss"
  | "postcss"
  | "styl"
  | "stylus"
  | string;

export interface PreprocessCssOptions {
  readonly lang?: PreprocessorLang | undefined;
  readonly filename?: string | undefined;
  readonly loadPaths?: readonly string[] | undefined;
  readonly readFile?: ((resolvedPath: string, fromFile: string) => string | null | undefined) | undefined;
}

export interface PreprocessCssResult {
  readonly code: string;
  readonly dependencies: readonly string[];
  readonly map?: {
    readonly version: 3;
    readonly file: string;
    readonly sources: readonly string[];
    readonly mappings: string;
  } | undefined;
}

export function detectPreprocessorLang(filename?: string, explicitLang?: string): PreprocessorLang {
  if (explicitLang) {
    return explicitLang.toLowerCase().replace(/^\./, "");
  }
  if (!filename) return "css";
  const ext = path.extname(filename).toLowerCase().replace(/^\./, "");
  if (ext === "scss" || ext === "sass" || ext === "less" || ext === "pcss" || ext === "postcss" || ext === "styl" || ext === "stylus") {
    return ext;
  }
  return "css";
}

export function preprocessCss(
  source: string,
  options?: PreprocessCssOptions
): PreprocessCssResult {
  const filename = options?.filename ?? "style.css";
  const lang = detectPreprocessorLang(filename, options?.lang);

  if (lang === "css") {
    return Object.freeze({
      code: source,
      dependencies: Object.freeze([])
    });
  }

  if (lang !== "scss" && lang !== "sass" && lang !== "less" && lang !== "pcss" && lang !== "postcss") {
    const pkgMap: Record<string, string> = {
      styl: "stylus",
      stylus: "stylus"
    };
    const pkgName = pkgMap[lang] ?? lang;
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_PREPROCESSOR_MISSING,
      message: `CSS preprocessor for '${lang}' is not installed. Run 'npm install -D ${pkgName}' to compile '${filename}' (D-130).`,
      severity: "error",
      span: makeDefaultSpan(filename)
    });
  }

  const dependencies: string[] = [];
  const visited = new Set<string>([filename]);

  let working = lang === "sass" ? convertIndentedSassToScss(source) : source;
  working = stripComments(working);
  working = inlinePartials(working, filename, lang, dependencies, visited, options);

  let flattened: string;
  if (lang === "scss" || lang === "sass") {
    flattened = preprocessScss(working);
  } else if (lang === "less") {
    flattened = preprocessLess(working);
  } else {
    flattened = preprocessPostcss(working);
  }

  return Object.freeze({
    code: flattened,
    dependencies: Object.freeze(dependencies),
    map: Object.freeze({
      version: 3 as const,
      file: `${filename}.css`,
      sources: Object.freeze([filename, ...dependencies]),
      mappings: "AAAA"
    })
  });
}
