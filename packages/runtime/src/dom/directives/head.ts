/**
 * @dotmix/runtime/dom/directives/head — SSR & client DOM head manager.
 */

import {
  createEffect,
  getCurrentOwner,
  onCleanup
} from "../../core/index.js";
import { removeNode } from "../nodes.js";
import type {
  HeadCollector,
  HeadTagRecord,
  HeadTagSpec
} from "./contract-types.js";

function escapeHtmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttr(text: string): string {
  return escapeHtmlText(text).replaceAll('"', "&quot;");
}

function getMetaKey(attrs: Readonly<Record<string, string>>): string | null {
  if (attrs.name !== undefined) {
    return `name:${attrs.name}`;
  }
  if (attrs.property !== undefined) {
    return `property:${attrs.property}`;
  }
  if (attrs["http-equiv"] !== undefined) {
    return `http-equiv:${attrs["http-equiv"]}`;
  }
  if (attrs.charset !== undefined) {
    return "charset";
  }
  return null;
}

function getLinkKey(attrs: Readonly<Record<string, string>>): string | null {
  const rel = attrs.rel ?? "";
  const href = attrs.href ?? "";
  if (rel === "" && href === "") {
    return null;
  }
  return `${rel}\0${href}`;
}

export function __mixCreateHeadCollector(): HeadCollector {
  let titleText: string | null = null;
  const metaMap = new Map<string, Readonly<Record<string, string>>>();
  const linkMap = new Map<string, Readonly<Record<string, string>>>();
  let unkeyedCounter = 0;

  const getTags = (): readonly HeadTagRecord[] => {
    const out: HeadTagRecord[] = [];
    if (titleText !== null) {
      out.push({ kind: "title", text: titleText });
    }
    for (const attrs of metaMap.values()) {
      out.push({ kind: "meta", attrs });
    }
    for (const attrs of linkMap.values()) {
      out.push({ kind: "link", attrs });
    }
    return out;
  };

  const renderHtml = (): string => {
    const parts: string[] = [];
    if (titleText !== null) {
      parts.push(`<title>${escapeHtmlText(titleText)}</title>`);
    }
    for (const attrs of metaMap.values()) {
      const attrStr = Object.entries(attrs)
        .map(([attrName, attrValue]) => `${attrName}="${escapeHtmlAttr(attrValue)}"`)
        .join(" ");
      parts.push(attrStr ? `<meta ${attrStr}>` : "<meta>");
    }
    for (const attrs of linkMap.values()) {
      const attrStr = Object.entries(attrs)
        .map(([attrName, attrValue]) => `${attrName}="${escapeHtmlAttr(attrValue)}"`)
        .join(" ");
      parts.push(attrStr ? `<link ${attrStr}>` : "<link>");
    }
    return parts.join("");
  };

  return {
    addTitle(text: string): void {
      titleText = text;
    },
    addMeta(attrs: Readonly<Record<string, string>>): void {
      const key = getMetaKey(attrs) ?? `unkeyed:${++unkeyedCounter}`;
      metaMap.set(key, { ...attrs });
    },
    addLink(attrs: Readonly<Record<string, string>>): void {
      const key = getLinkKey(attrs) ?? `unkeyed:${++unkeyedCounter}`;
      linkMap.set(key, { ...attrs });
    },
    getTags,
    renderHtml,
    renderToHeadHtml: renderHtml
  };
}

interface HeadElementEntry {
  readonly id: symbol;
  attrs: Readonly<Record<string, string>>;
}

interface HeadKeyBucket {
  readonly initialEl: Element | null;
  readonly initialAttrs: Readonly<Record<string, string>> | null;
  el: Element | null;
  readonly entries: HeadElementEntry[];
}

interface HeadDomState {
  initialTitle: string | null;
  readonly titleEntries: Array<{ readonly id: symbol; value: string }>;
  readonly metaBuckets: Map<string, HeadKeyBucket>;
  readonly linkBuckets: Map<string, HeadKeyBucket>;
}

const headStateByDocument = new WeakMap<Document, HeadDomState>();

function getHeadDomState(doc: Document): HeadDomState {
  let state = headStateByDocument.get(doc);
  if (!state) {
    state = {
      initialTitle: null,
      titleEntries: [],
      metaBuckets: new Map(),
      linkBuckets: new Map()
    };
    headStateByDocument.set(doc, state);
  }
  return state;
}

function snapshotElementAttrs(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!;
    attrs[attr.name] = attr.value;
  }
  return attrs;
}

function applyElementAttrs(el: Element, attrs: Readonly<Record<string, string>>): void {
  const existingNames: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    existingNames.push(el.attributes[i]!.name);
  }
  for (const name of existingNames) {
    if (!Object.prototype.hasOwnProperty.call(attrs, name)) {
      el.removeAttribute(name);
    }
  }
  for (const [attrName, attrValue] of Object.entries(attrs)) {
    if (el.getAttribute(attrName) !== attrValue) {
      el.setAttribute(attrName, attrValue);
    }
  }
}

function findExistingHeadTag(
  doc: Document,
  tagName: "meta" | "link",
  key: string
): Element | null {
  const tags = doc.head.getElementsByTagName(tagName);
  for (let i = 0; i < tags.length; i++) {
    const el = tags[i]!;
    const attrs = snapshotElementAttrs(el);
    const elKey = tagName === "meta" ? getMetaKey(attrs) : getLinkKey(attrs);
    if (elKey === key) {
      return el;
    }
  }
  return null;
}

function syncHeadBucket(
  doc: Document,
  buckets: Map<string, HeadKeyBucket>,
  tagName: "meta" | "link",
  key: string
): void {
  const bucket = buckets.get(key);
  if (!bucket) {
    return;
  }
  const top = bucket.entries[bucket.entries.length - 1];
  if (top) {
    if (!bucket.el) {
      bucket.el = doc.createElement(tagName);
    }
    applyElementAttrs(bucket.el, top.attrs);
    if (bucket.el.parentNode !== doc.head) {
      doc.head.appendChild(bucket.el);
    }
    return;
  }

  if (bucket.initialEl && bucket.initialAttrs) {
    applyElementAttrs(bucket.initialEl, bucket.initialAttrs);
    if (bucket.initialEl.parentNode !== doc.head) {
      doc.head.appendChild(bucket.initialEl);
    }
  } else if (bucket.el) {
    removeNode(bucket.el);
  }
  buckets.delete(key);
}

function getOrCreateHeadBucket(
  doc: Document,
  buckets: Map<string, HeadKeyBucket>,
  tagName: "meta" | "link",
  key: string
): HeadKeyBucket {
  let bucket = buckets.get(key);
  if (!bucket) {
    const existing = findExistingHeadTag(doc, tagName, key);
    bucket = {
      initialEl: existing,
      initialAttrs: existing ? snapshotElementAttrs(existing) : null,
      el: existing,
      entries: []
    };
    buckets.set(key, bucket);
  }
  return bucket;
}

export function __mixHead(entries: readonly HeadTagSpec[]): void {
  if (typeof document === "undefined" || !document.head) {
    return;
  }
  const doc = document;
  const state = getHeadDomState(doc);
  const owner = getCurrentOwner();
  let unkeyedCounter = 0;

  for (let i = 0; i < entries.length; i++) {
    const spec = entries[i]!;
    if (spec.kind === "title") {
      if (state.titleEntries.length === 0 && state.initialTitle === null) {
        state.initialTitle = doc.title;
      }
      const entryId = Symbol("mix.head.title");
      const record = { id: entryId, value: "" };
      state.titleEntries.push(record);

      createEffect(() => {
        record.value = spec.text();
        const top = state.titleEntries[state.titleEntries.length - 1];
        if (top) {
          doc.title = top.value;
        }
      });

      if (owner) {
        onCleanup(() => {
          const idx = state.titleEntries.findIndex((entry) => entry.id === entryId);
          if (idx !== -1) {
            state.titleEntries.splice(idx, 1);
          }
          const top = state.titleEntries[state.titleEntries.length - 1];
          if (top) {
            doc.title = top.value;
          } else if (state.initialTitle !== null) {
            doc.title = state.initialTitle;
            state.initialTitle = null;
          }
        });
      }
      continue;
    }

    const tagName = spec.kind;
    const buckets = tagName === "meta" ? state.metaBuckets : state.linkBuckets;
    const entryId = Symbol(`mix.head.${tagName}`);
    const fallbackUnkeyed = `unkeyed:${++unkeyedCounter}:${String(Math.random())}`;
    let currentKey: string | null = null;

    createEffect(() => {
      const attrs = spec.attrs();
      const nextKey =
        (tagName === "meta" ? getMetaKey(attrs) : getLinkKey(attrs)) ?? fallbackUnkeyed;

      if (currentKey !== null && currentKey !== nextKey) {
        const prevBucket = buckets.get(currentKey);
        if (prevBucket) {
          const idx = prevBucket.entries.findIndex((entry) => entry.id === entryId);
          if (idx !== -1) {
            prevBucket.entries.splice(idx, 1);
          }
          syncHeadBucket(doc, buckets, tagName, currentKey);
        }
      }

      const bucket = getOrCreateHeadBucket(doc, buckets, tagName, nextKey);
      const existing = bucket.entries.find((entry) => entry.id === entryId);
      if (existing) {
        existing.attrs = { ...attrs };
      } else {
        bucket.entries.push({ id: entryId, attrs: { ...attrs } });
      }
      currentKey = nextKey;
      syncHeadBucket(doc, buckets, tagName, nextKey);
    });

    if (owner) {
      onCleanup(() => {
        if (currentKey === null) {
          return;
        }
        const bucket = buckets.get(currentKey);
        if (bucket) {
          const idx = bucket.entries.findIndex((entry) => entry.id === entryId);
          if (idx !== -1) {
            bucket.entries.splice(idx, 1);
          }
          syncHeadBucket(doc, buckets, tagName, currentKey);
        }
        currentKey = null;
      });
    }
  }
}
