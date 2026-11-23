/**
 * @dotmix/runtime/dom/head-collector — SSR/SSG HeadCollector, types, and safe JSON-LD serializer.
 */

import type { HeadCollector, HeadTagRecord } from "./directives/contract-types.js";

export type MaybeGetter<T> = T | (() => T);

export interface HeadHtmlAttrs {
  lang?: string | undefined;
  dir?: "ltr" | "rtl" | "auto" | undefined;
  class?: string | undefined;
  [attr: string]: string | undefined;
}

export interface HeadMetaEntry {
  key?: string | undefined;
  name?: string | undefined;
  property?: string | undefined;
  "http-equiv"?: string | undefined;
  charset?: string | undefined;
  content?: string | undefined;
}

export interface HeadLinkEntry {
  key?: string | undefined;
  rel: string;
  href?: string | undefined;
  hreflang?: string | undefined;
  as?: string | undefined;
  type?: string | undefined;
  media?: string | undefined;
  sizes?: string | undefined;
  crossorigin?: "anonymous" | "use-credentials" | "" | undefined;
  fetchpriority?: "high" | "low" | "auto" | undefined;
}

export interface HeadJsonLdEntry {
  key?: string | undefined;
  data: Record<string, unknown> | readonly Record<string, unknown>[];
}

export interface HeadInput {
  title?: string | undefined;
  titleTemplate?: string | ((title: string) => string) | undefined;
  htmlAttrs?: HeadHtmlAttrs | undefined;
  bodyAttrs?: Readonly<Record<string, string | undefined>> | undefined;
  meta?: readonly HeadMetaEntry[] | undefined;
  link?: readonly HeadLinkEntry[] | undefined;
  jsonLd?:
    | Record<string, unknown>
    | readonly (Record<string, unknown> | HeadJsonLdEntry)[]
    | undefined;
}

export interface UniversalHeadCollector extends HeadCollector {
  setTitleTemplate(template: string | ((title: string) => string)): void;
  addHtmlAttrs(attrs: Readonly<Record<string, string | undefined>>): void;
  addBodyAttrs(attrs: Readonly<Record<string, string | undefined>>): void;
  addKeyedMeta(attrs: Readonly<Record<string, string>>, key?: string): void;
  addKeyedLink(attrs: Readonly<Record<string, string>>, key?: string): void;
  addJsonLd(data: unknown, key?: string): void;
  getHtmlAttrs(): Readonly<Record<string, string>>;
  getBodyAttrs(): Readonly<Record<string, string>>;
  renderJsonLdHtml(): string;
}

export function escapeHeadHtmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeHeadHtmlAttr(text: string): string {
  return escapeHeadHtmlText(text).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/**
 * Safely serializes JSON-LD payloads for embedding inside `<script type="application/ld+json">`.
 * Escapes `<`, `>`, `&`, U+2028, and U+2029 so `</script>` or HTML comments cannot break out.
 */
export function serializeSafeJsonLd(value: unknown): string {
  const raw = JSON.stringify(value);
  const json = raw === undefined ? "null" : raw;
  let out = "";
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (ch === "<") out += "\\u003c";
    else if (ch === ">") out += "\\u003e";
    else if (ch === "&") out += "\\u0026";
    else if (ch === "\u2028") out += "\\u2028";
    else if (ch === "\u2029") out += "\\u2029";
    else out += ch;
  }
  return out;
}

export function computeMetaKey(attrs: Readonly<Record<string, string>>, explicitKey?: string): string | null {
  if (explicitKey) return `key:${explicitKey}`;
  if (attrs.name !== undefined && attrs.name !== "") return `name:${attrs.name}`;
  if (attrs.property !== undefined && attrs.property !== "") return `property:${attrs.property}`;
  if (attrs["http-equiv"] !== undefined && attrs["http-equiv"] !== "") return `http-equiv:${attrs["http-equiv"]}`;
  if (attrs.charset !== undefined) return "charset";
  return null;
}

export function computeLinkKey(attrs: Readonly<Record<string, string>>, explicitKey?: string): string | null {
  if (explicitKey) return `key:${explicitKey}`;
  const rel = attrs.rel ?? "";
  const href = attrs.href ?? "";
  if (rel === "canonical") return "rel:canonical";
  if (rel === "alternate" && attrs.hreflang) {
    return `rel:alternate:${attrs.hreflang}:${attrs.type ?? ""}`;
  }
  if (rel === "" && href === "") return null;
  return `rel:${rel}\0${href}`;
}

export function createUniversalHeadCollector(): UniversalHeadCollector {
  let rawTitle: string | undefined;
  let titleTemplate: string | ((title: string) => string) | undefined;
  const htmlAttrs: Record<string, string> = {};
  const bodyAttrs: Record<string, string> = {};
  const metaMap = new Map<string, { key: string; attrs: Readonly<Record<string, string>> }>();
  const linkMap = new Map<string, { key: string; attrs: Readonly<Record<string, string>> }>();
  const jsonLdMap = new Map<string, string>();
  let anonCounter = 0;

  const resolveTitle = (): string | undefined => {
    if (rawTitle === undefined) return undefined;
    if (typeof titleTemplate === "function") return titleTemplate(rawTitle);
    if (typeof titleTemplate === "string" && titleTemplate.includes("%s")) {
      return titleTemplate.replace("%s", rawTitle);
    }
    return rawTitle;
  };

  const addKeyedMeta = (attrs: Readonly<Record<string, string>>, explicitKey?: string): void => {
    const key = computeMetaKey(attrs, explicitKey) ?? `anon:${++anonCounter}`;
    metaMap.set(key, { key, attrs: { ...attrs } });
  };

  const addKeyedLink = (attrs: Readonly<Record<string, string>>, explicitKey?: string): void => {
    const key = computeLinkKey(attrs, explicitKey) ?? `anon:${++anonCounter}`;
    linkMap.set(key, { key, attrs: { ...attrs } });
  };

  return {
    addTitle(text: string): void {
      rawTitle = text;
    },
    setTitleTemplate(template: string | ((title: string) => string)): void {
      titleTemplate = template;
    },
    addHtmlAttrs(attrs: Readonly<Record<string, string | undefined>>): void {
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== undefined) htmlAttrs[k] = v;
      }
    },
    addBodyAttrs(attrs: Readonly<Record<string, string | undefined>>): void {
      for (const [k, v] of Object.entries(attrs)) {
        if (v !== undefined) bodyAttrs[k] = v;
      }
    },
    addMeta(attrs: Readonly<Record<string, string>>): void {
      addKeyedMeta(attrs);
    },
    addLink(attrs: Readonly<Record<string, string>>): void {
      addKeyedLink(attrs);
    },
    addKeyedMeta,
    addKeyedLink,
    addJsonLd(data: unknown, explicitKey?: string): void {
      const key = explicitKey ?? `jsonld:${jsonLdMap.size}`;
      jsonLdMap.set(key, serializeSafeJsonLd(data));
    },
    getHtmlAttrs(): Readonly<Record<string, string>> {
      return { ...htmlAttrs };
    },
    getBodyAttrs(): Readonly<Record<string, string>> {
      return { ...bodyAttrs };
    },
    getTags(): readonly HeadTagRecord[] {
      const out: HeadTagRecord[] = [];
      const resolved = resolveTitle();
      if (resolved !== undefined) {
        out.push({ kind: "title", text: resolved });
      }
      for (const item of metaMap.values()) {
        out.push({ kind: "meta", attrs: item.attrs });
      }
      for (const item of linkMap.values()) {
        out.push({ kind: "link", attrs: item.attrs });
      }
      return out;
    },
    renderJsonLdHtml(): string {
      const tags: string[] = [];
      for (const [key, serialized] of jsonLdMap.entries()) {
        tags.push(
          `<script type="application/ld+json" data-mix-head="${escapeHeadHtmlAttr(key)}">${serialized}</script>`
        );
      }
      return tags.join("\n");
    },
    renderHtml(): string {
      const parts: string[] = [];
      const resolved = resolveTitle();
      if (resolved !== undefined) {
        parts.push(`<title>${escapeHeadHtmlText(resolved)}</title>`);
      }
      for (const item of metaMap.values()) {
        const attrStr = Object.entries(item.attrs)
          .map(([k, v]) => `${k}="${escapeHeadHtmlAttr(v)}"`)
          .join(" ");
        parts.push(
          attrStr
            ? `<meta ${attrStr} data-mix-head="${escapeHeadHtmlAttr(item.key)}" />`
            : `<meta data-mix-head="${escapeHeadHtmlAttr(item.key)}" />`
        );
      }
      for (const item of linkMap.values()) {
        const attrStr = Object.entries(item.attrs)
          .map(([k, v]) => `${k}="${escapeHeadHtmlAttr(v)}"`)
          .join(" ");
        parts.push(
          attrStr
            ? `<link ${attrStr} data-mix-head="${escapeHeadHtmlAttr(item.key)}" />`
            : `<link data-mix-head="${escapeHeadHtmlAttr(item.key)}" />`
        );
      }
      for (const [key, serialized] of jsonLdMap.entries()) {
        parts.push(
          `<script type="application/ld+json" data-mix-head="${escapeHeadHtmlAttr(key)}">${serialized}</script>`
        );
      }
      return parts.join("\n");
    },
    renderToHeadHtml(): string {
      return this.renderHtml();
    }
  };
}

const headCollectorStack: HeadCollector[] = [];

export function getActiveHeadCollector(): HeadCollector | null {
  return headCollectorStack.length > 0 ? headCollectorStack[headCollectorStack.length - 1]! : null;
}

export function runWithHeadCollector<T>(collector: HeadCollector, fn: () => T): T {
  headCollectorStack.push(collector);
  try {
    return fn();
  } finally {
    headCollectorStack.pop();
  }
}

