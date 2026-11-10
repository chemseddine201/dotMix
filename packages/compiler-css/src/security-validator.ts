/**
 * @mix/compiler-css/security-validator — Static CSS AST security validator (D-108, R-URL-01, R-CSS-05).
 */

import type { CssPlainNode } from "css-tree";
import { MixDiagnosticError, DiagnosticCodes } from "@mix/diagnostics";
import { toMixSpan, type CssCompileOptions } from "./types.js";

export function isSafeStaticCssUrl(rawUrl: string): boolean {
  // Strip control characters and whitespace before checking protocol (R-URL-01, R-CSS-05)
  const unquoted = rawUrl.replace(/^['"]|['"]$/g, "");
  let cleaned = "";
  for (let i = 0; i < unquoted.length; i++) {
    const code = unquoted.charCodeAt(i);
    if (code > 0x20 && code !== 0x7f) {
      cleaned += unquoted[i]!;
    }
  }
  cleaned = cleaned.toLowerCase();

  if (
    cleaned.startsWith("javascript:") ||
    cleaned.startsWith("vbscript:") ||
    cleaned.startsWith("data:text/html") ||
    cleaned.startsWith("data:image/svg+xml")
  ) {
    return false;
  }

  if (cleaned.startsWith("data:")) {
    return /^data:image\/(?:png|jpeg|jpg|gif|webp|avif);/i.test(cleaned);
  }

  return true;
}

export function validateCssCharsetHeader(cssSource: string, options?: CssCompileOptions): void {
  const charsetMatch = /@charset\b/i.exec(cssSource);
  if (charsetMatch) {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_CSS_FORBIDDEN_CHARSET,
      message: "'@charset' is forbidden in component <style> blocks (D-108).",
      severity: "error",
      span: toMixSpan(
        {
          start: { line: 1, column: charsetMatch.index + 1, offset: charsetMatch.index },
          end: {
            line: 1,
            column: charsetMatch.index + charsetMatch[0].length + 1,
            offset: charsetMatch.index + charsetMatch[0].length
          }
        },
        options
      )
    });
  }
}

export function validateAtruleSecurity(atName: string, node: CssPlainNode, options?: CssCompileOptions): void {
  if (atName === "import") {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_CSS_FORBIDDEN_IMPORT,
      message: "'@import' is forbidden in component <style> blocks (D-108).",
      severity: "error",
      span: toMixSpan(node.loc, options)
    });
  }
  if (atName === "charset") {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_ERR_CSS_FORBIDDEN_CHARSET,
      message: "'@charset' is forbidden in component <style> blocks (D-108).",
      severity: "error",
      span: toMixSpan(node.loc, options)
    });
  }
}

export function validateCssUrlNode(node: CssPlainNode, options?: CssCompileOptions): void {
  const rawVal =
    typeof node.value === "string"
      ? node.value
      : typeof (node.value as { value?: unknown } | null)?.value === "string"
        ? ((node.value as { value: string }).value)
        : "";
  if (!isSafeStaticCssUrl(rawVal)) {
    throw new MixDiagnosticError({
      code: DiagnosticCodes.MIX_SEC_UNSAFE_URL,
      message: `Unsafe URL protocol in static CSS url('${rawVal}') (R-CSS-05).`,
      severity: "error",
      span: toMixSpan(node.loc, options)
    });
  }
}
