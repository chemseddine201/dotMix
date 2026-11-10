/**
 * @mix/ast/html-constants — Canonical HTML void element and SVG element sets.
 * Shared across @mix/compiler-frontend, @mix/compiler-semantic, @mix/compiler-codegen, and @mix/compiler-ssr.
 */

export const HTML_VOID_ELEMENTS: ReadonlySet<string> = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
]);

export const SVG_ELEMENTS: ReadonlySet<string> = new Set([
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "g",
  "defs",
  "use",
  "text",
  "tspan",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  "symbol"
]);

export const SVG_TAGS = SVG_ELEMENTS;

