// packages/runtime/src/dom/html.ts — FROZEN per MIX_SPEC_v3.2.2 §6.4
import { MixError } from "../core/errors.js";
import { isTrustedHtml, type TrustedHtmlValue } from "../security/trusted-html.js";

const FORBIDDEN_HTML_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
  "NOSCRIPT",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "FRAME",
  "FRAMESET"
]);

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

let trustedTypePolicy: { createHTML: (s: string) => unknown } | null | undefined = undefined;

function getTrustedTypesPolicy(): { createHTML: (s: string) => unknown } | null {
  if (trustedTypePolicy !== undefined) return trustedTypePolicy;

  const tt = (globalThis as unknown as { trustedTypes?: { createPolicy: (name: string, rules: unknown) => { createHTML: (s: string) => unknown } } }).trustedTypes;
  if (tt && typeof tt.createPolicy === "function") {
    try {
      trustedTypePolicy = tt.createPolicy("mix-html#trusted", {
        createHTML: (html: string) => html
      });
    } catch {
      // Policy may already exist or creation blocked
      trustedTypePolicy = null;
    }
  } else {
    trustedTypePolicy = null;
  }

  return trustedTypePolicy;
}

/**
 * Inserts a TrustedHtmlValue into an element's innerHTML safely (R-HTML-04, R-HTML-05).
 * Validates namespace and tag boundaries; throws MIX_SEC_HTML_CONTEXT on forbidden contexts.
 */
export function insertTrustedHtml(
  el: { namespaceURI?: string | null; tagName?: string; innerHTML: unknown },
  value: unknown
): void {
  // 1. Verify that the value is an authentic TrustedHtmlValue from our registry (R-HTML-01)
  if (!isTrustedHtml(value)) {
    throw new MixError(
      "MIX_SEC_FOREIGN_TRUSTED_HTML",
      "Attempted to insert untrusted or foreign HTML value"
    );
  }

  // 2. Validate insertion context (R-HTML-04)
  if (el.namespaceURI && el.namespaceURI !== HTML_NAMESPACE) {
    throw new MixError(
      "MIX_SEC_HTML_CONTEXT",
      `Cannot insert trusted HTML into non-HTML namespace: "${el.namespaceURI}"`
    );
  }

  const tagName = (el.tagName ?? "").toUpperCase();
  if (FORBIDDEN_HTML_TAGS.has(tagName)) {
    throw new MixError(
      "MIX_SEC_HTML_CONTEXT",
      `Cannot insert trusted HTML into forbidden element <${tagName.toLowerCase()}>`
    );
  }

  // 3. Integrate with Trusted Types if available (R-HTML-05)
  const policy = getTrustedTypesPolicy();
  const htmlToSet = policy ? policy.createHTML(value.html) : value.html;

  // 4. Assign innerHTML
  el.innerHTML = htmlToSet;
}
