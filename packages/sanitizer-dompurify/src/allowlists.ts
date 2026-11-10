/**
 * @mix/sanitizer-dompurify/allowlists — Tag/attribute allowlists, forbidden tags/attrs,
 * CSS property safety patterns, and HTML entity decoding helpers (D-109 / HAA-03).
 */

import { isSafeUrl } from "@mix/runtime";

export const DEFAULT_ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "address",
  "article",
  "aside",
  "b",
  "bdi",
  "bdo",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "data",
  "dd",
  "del",
  "details",
  "dfn",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hgroup",
  "hr",
  "i",
  "img",
  "ins",
  "kbd",
  "li",
  "main",
  "mark",
  "nav",
  "ol",
  "p",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "u",
  "ul",
  "var",
  "wbr",
  "svg",
  "circle",
  "ellipse",
  "g",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "defs",
  "lineargradient",
  "radialgradient",
  "stop"
]);

/**
 * Tags whose entire subtree (including text children) must be dropped immediately.
 */
export const DROP_SUBTREE_TAGS = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "applet",
  "noscript",
  "noembed",
  "noframes",
  "frame",
  "frameset",
  "template",
  "textarea",
  "title",
  "xmp",
  "foreignobject",
  "animate",
  "animatetransform",
  "animatemotion",
  "set"
]);

export const DEFAULT_ALLOWED_ATTRS = new Set([
  "accept",
  "align",
  "alt",
  "aria-controls",
  "aria-current",
  "aria-describedby",
  "aria-expanded",
  "aria-hidden",
  "aria-label",
  "aria-labelledby",
  "aria-live",
  "aria-pressed",
  "aria-role",
  "aria-selected",
  "border",
  "cellpadding",
  "cellspacing",
  "cite",
  "class",
  "colspan",
  "cols",
  "coords",
  "cx",
  "cy",
  "d",
  "datetime",
  "dir",
  "download",
  "fill",
  "fill-opacity",
  "fill-rule",
  " focusable",
  "headers",
  "height",
  "hidden",
  "high",
  "href",
  "hreflang",
  "id",
  "inert",
  "ismap",
  " itemid",
  "itemprop",
  "itemref",
  "itemscope",
  "itemtype",
  "label",
  "lang",
  "loading",
  "low",
  "max",
  "min",
  "name",
  "open",
  "optimum",
  "points",
  "poster",
  "preload",
  "r",
  "rel",
  "reversed",
  "role",
  "rows",
  "rowspan",
  "rx",
  "ry",
  "scope",
  "shape",
  "sizes",
  "span",
  "spellcheck",
  "src",
  "srcset",
  "start",
  "step",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "style",
  "summary",
  "tabindex",
  "target",
  "title",
  "transform",
  "translate",
  "type",
  "usemap",
  "valign",
  "value",
  "viewbox",
  "width",
  "x",
  "x1",
  "x2",
  "xmlns",
  "y",
  "y1",
  "y2"
]);

export const URL_ATTRS = new Set([
  "href",
  "src",
  "action",
  "formaction",
  "xlink:href",
  "poster",
  "cite",
  "data",
  "background"
]);

export const UNSAFE_CSS_VALUE_RE =
  /expression\s*\(|url\s*\(\s*['"]?\s*(?:javascript|vbscript|data):|-moz-binding|behavior\s*:|@import/i;

export function decodeHtmlEntitiesForUrlCheck(val: string): string {
  return val
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#([0-9]+);?/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n");
}

export function isSafeSanitizedUrl(rawUrl: string): boolean {
  const decoded = decodeHtmlEntitiesForUrlCheck(rawUrl);
  return isSafeUrl(decoded);
}

export function sanitizeStyleAttribute(rawStyle: string): string | null {
  const decoded = decodeHtmlEntitiesForUrlCheck(rawStyle).replace(
    /\/\*[\s\S]*?\*\//g,
    ""
  );
  if (UNSAFE_CSS_VALUE_RE.test(decoded)) {
    // Keep only declarations that do not match unsafe CSS patterns
    const safeDecls: string[] = [];
    for (const part of rawStyle.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const decPart = decodeHtmlEntitiesForUrlCheck(trimmed).replace(
        /\/\*[\s\S]*?\*\//g,
        ""
      );
      if (!UNSAFE_CSS_VALUE_RE.test(decPart)) {
        safeDecls.push(trimmed);
      }
    }
    return safeDecls.length > 0 ? safeDecls.join("; ") : null;
  }
  return rawStyle;
}
