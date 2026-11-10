/**
 * @mix/sanitizer-dompurify — Official Production HTML Sanitizer Adapter for Mix & Tix (D-109 / HAA-03).
 *
 * Bridges DOMPurify (or an inert DOM-tree allowlist sanitizer when running in DOM environments)
 * into `@mix/runtime`'s `SanitizerProvider` authority without adding any dependencies to `@mix/runtime`.
 */

import {
  isSafeUrl,
  parseSrcsetCandidates,
  formatSrcsetCandidates,
  type SanitizerProvider,
  type SanitizerContext
} from "@mix/runtime";

export interface DomPurifyLike {
  sanitize(dirty: string, config?: Record<string, unknown>): string | { toString(): string };
}

export interface DomPurifySanitizerOptions {
  /**
   * Optional explicit DOMPurify instance (defaults to `globalThis.DOMPurify` when available).
   */
  dompurify?: DomPurifyLike | undefined;
  /**
   * Optional additional tags to permit beyond the default safe HTML allowlist.
   */
  allowedTags?: readonly string[] | undefined;
  /**
   * Optional additional attributes to permit beyond the default safe attribute allowlist.
   */
  allowedAttributes?: readonly string[] | undefined;
}

const DEFAULT_ALLOWED_TAGS = new Set([
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
const DROP_SUBTREE_TAGS = new Set([
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

const DEFAULT_ALLOWED_ATTRS = new Set([
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

const URL_ATTRS = new Set([
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

const UNSAFE_CSS_VALUE_RE =
  /expression\s*\(|url\s*\(\s*['"]?\s*(?:javascript|vbscript|data):|-moz-binding|behavior\s*:|@import/i;

function decodeHtmlEntitiesForUrlCheck(val: string): string {
  return val
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;/gi, "\t")
    .replace(/&newline;/gi, "\n");
}

function isSafeSanitizedUrl(rawUrl: string): boolean {
  const decoded = decodeHtmlEntitiesForUrlCheck(rawUrl);
  return isSafeUrl(decoded);
}

function sanitizeStyleAttribute(rawStyle: string): string | null {
  const decoded = decodeHtmlEntitiesForUrlCheck(rawStyle).replace(/\/\*[\s\S]*?\*\//g, "");
  if (UNSAFE_CSS_VALUE_RE.test(decoded)) {
    // Keep only declarations that do not match unsafe CSS patterns
    const safeDecls: string[] = [];
    for (const part of rawStyle.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const decPart = decodeHtmlEntitiesForUrlCheck(trimmed).replace(/\/\*[\s\S]*?\*\//g, "");
      if (!UNSAFE_CSS_VALUE_RE.test(decPart)) {
        safeDecls.push(trimmed);
      }
    }
    return safeDecls.length > 0 ? safeDecls.join("; ") : null;
  }
  return rawStyle;
}

function sanitizeDomTree(
  root: Node,
  allowedTags: ReadonlySet<string>,
  allowedAttrs: ReadonlySet<string>
): void {
  const children = Array.from(root.childNodes);
  for (const child of children) {
    if (child.nodeType === 8 /* Comment */) {
      root.removeChild(child);
      continue;
    }

    if (child.nodeType === 1 /* Element */) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (DROP_SUBTREE_TAGS.has(tag)) {
        root.removeChild(el);
        continue;
      }

      if (!allowedTags.has(tag)) {
        // Unwrap disallowed non-active container tags after sanitizing their children
        sanitizeDomTree(el, allowedTags, allowedAttrs);
        while (el.firstChild) {
          root.insertBefore(el.firstChild, el);
        }
        root.removeChild(el);
        continue;
      }

      // Sanitize attributes on allowed element
      const attrNames = el.getAttributeNames ? el.getAttributeNames() : Array.from(el.attributes).map((a) => a.name);
      for (const rawAttrName of attrNames) {
        const attrName = rawAttrName.toLowerCase();
        const attrVal = el.getAttribute(rawAttrName) ?? "";

        // Unconditionally strip all event handler attributes (`on*`)
        if (attrName.startsWith("on") || attrName === "srcdoc") {
          el.removeAttribute(rawAttrName);
          continue;
        }

        const isDataOrAria = attrName.startsWith("data-") || attrName.startsWith("aria-");
        if (!isDataOrAria && !allowedAttrs.has(attrName)) {
          el.removeAttribute(rawAttrName);
          continue;
        }

        if (URL_ATTRS.has(attrName)) {
          if (!isSafeSanitizedUrl(attrVal)) {
            el.removeAttribute(rawAttrName);
            continue;
          }
        } else if (attrName === "srcset") {
          try {
            const candidates = parseSrcsetCandidates(decodeHtmlEntitiesForUrlCheck(attrVal)).filter((c) =>
              isSafeSanitizedUrl(c.url)
            );
            if (candidates.length === 0) {
              el.removeAttribute(rawAttrName);
            } else {
              el.setAttribute(rawAttrName, formatSrcsetCandidates(candidates));
            }
          } catch {
            el.removeAttribute(rawAttrName);
          }
          continue;
        } else if (attrName === "style") {
          const cleanStyle = sanitizeStyleAttribute(attrVal);
          if (cleanStyle === null) {
            el.removeAttribute(rawAttrName);
          } else {
            el.setAttribute(rawAttrName, cleanStyle);
          }
          continue;
        }
      }

      sanitizeDomTree(el, allowedTags, allowedAttrs);
    }
  }
}

/**
 * Creates a production `SanitizerProvider` backed by DOMPurify (when present) and
 * an inert DOM-tree structural allowlist sanitizer.
 */
export function createDomPurifySanitizer(options: DomPurifySanitizerOptions = {}): SanitizerProvider {
  const allowedTags = new Set(DEFAULT_ALLOWED_TAGS);
  if (options.allowedTags) {
    for (const t of options.allowedTags) allowedTags.add(t.toLowerCase());
  }

  const allowedAttrs = new Set(DEFAULT_ALLOWED_ATTRS);
  if (options.allowedAttributes) {
    for (const a of options.allowedAttributes) allowedAttrs.add(a.toLowerCase());
  }

  return Object.freeze({
    sanitizeHtml(raw: string, _context?: SanitizerContext): string {
      if (typeof raw !== "string" || raw.length === 0) {
        return "";
      }

      let current = raw;

      // 1. Delegate to DOMPurify instance if provided or available on globalThis
      const purifier =
        options.dompurify ??
        ((globalThis as { DOMPurify?: DomPurifyLike }).DOMPurify);
      if (purifier && typeof purifier.sanitize === "function") {
        current = String(purifier.sanitize(current, { RETURN_TRUSTED_TYPE: false }));
      }

      // 2. Parse into an inert <template> container and enforce strict DOM-tree + URL/CSS allowlists
      if (typeof document !== "undefined" && typeof document.createElement === "function") {
        const template = document.createElement("template") as HTMLTemplateElement;
        template.innerHTML = current;
        const rootNode: Node = template.content ?? template;
        sanitizeDomTree(rootNode, allowedTags, allowedAttrs);
        return template.innerHTML;
      }

      // 3. Fallback when running in a pure non-DOM environment: strip dangerous blocks & attributes
      return current
        .replace(/<(script|style|iframe|object|embed|applet|template|svg|math)[\s\S]*?>[\s\S]*?<\/\1>/gi, "")
        .replace(/<(script|style|iframe|object|embed|applet|template|svg|math)[^>]*\/?>/gi, "")
        .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/\s+(?:href|src|action|formaction|xlink:href)\s*=\s*(?:"\s*(?:javascript|vbscript|data):[^"]*"|'\s*(?:javascript|vbscript|data):[^']*')/gi, "");
    }
  });
}

export const domPurifySanitizer: SanitizerProvider = createDomPurifySanitizer();
