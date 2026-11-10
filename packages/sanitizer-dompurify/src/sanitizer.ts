/**
 * @mix/sanitizer-dompurify/sanitizer — Production HTML SanitizerProvider implementation (D-109 / HAA-03).
 */

import {
  parseSrcsetCandidates,
  formatSrcsetCandidates,
  type SanitizerProvider,
  type SanitizerContext
} from "@mix/runtime";
import {
  DEFAULT_ALLOWED_TAGS,
  DROP_SUBTREE_TAGS,
  DEFAULT_ALLOWED_ATTRS,
  URL_ATTRS,
  decodeHtmlEntitiesForUrlCheck,
  isSafeSanitizedUrl,
  sanitizeStyleAttribute
} from "./allowlists.js";

export interface DomPurifyLike {
  sanitize(
    dirty: string,
    config?: Record<string, unknown>
  ): string | { toString(): string };
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

export type DomPurifyOptions = DomPurifySanitizerOptions;

export function sanitizeDomTree(
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
      const attrNames = el.getAttributeNames
        ? el.getAttributeNames()
        : Array.from(el.attributes).map((a) => a.name);
      for (const rawAttrName of attrNames) {
        const attrName = rawAttrName.toLowerCase();
        const attrVal = el.getAttribute(rawAttrName) ?? "";

        // Unconditionally strip all event handler attributes (`on*`)
        if (attrName.startsWith("on") || attrName === "srcdoc") {
          el.removeAttribute(rawAttrName);
          continue;
        }

        const isDataOrAria =
          attrName.startsWith("data-") || attrName.startsWith("aria-");
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
            const candidates = parseSrcsetCandidates(
              decodeHtmlEntitiesForUrlCheck(attrVal)
            ).filter((c) => isSafeSanitizedUrl(c.url));
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
export function createDomPurifySanitizer(
  options: DomPurifySanitizerOptions = {}
): SanitizerProvider {
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
        (globalThis as { DOMPurify?: DomPurifyLike }).DOMPurify;
      if (purifier && typeof purifier.sanitize === "function") {
        current = String(purifier.sanitize(current, { RETURN_TRUSTED_TYPE: false }));
      }

      // 2. Parse into an inert <template> container and enforce strict DOM-tree + URL/CSS allowlists
      if (
        typeof document !== "undefined" &&
        typeof document.createElement === "function"
      ) {
        const template = document.createElement("template") as HTMLTemplateElement;
        template.innerHTML = current;
        const rootNode: Node = template.content ?? template;
        sanitizeDomTree(rootNode, allowedTags, allowedAttrs);
        return template.innerHTML;
      }

      // 3. Fallback when running in a pure non-DOM environment: strip dangerous blocks & attributes
      return current
        .replace(
          /<(script|style|iframe|object|embed|applet|template|svg|math)[\s\S]*?>[\s\S]*?<\/\1>/gi,
          ""
        )
        .replace(
          /<(script|style|iframe|object|embed|applet|template|svg|math)[^>]*\/?>/gi,
          ""
        )
        .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(
          /\s+(?:href|src|action|formaction|xlink:href)\s*=\s*(?:"\s*(?:javascript|vbscript|data):[^"]*"|'\s*(?:javascript|vbscript|data):[^']*')/gi,
          ""
        );
    }
  });
}

export const domPurifySanitizer: SanitizerProvider = createDomPurifySanitizer();

export function sanitizeHtml(raw: string, context?: SanitizerContext): string {
  return domPurifySanitizer.sanitizeHtml(raw, context);
}
