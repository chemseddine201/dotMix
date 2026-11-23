/**
 * @dotmix/runtime/dom/head-api — Universal Head API (`useHead`) for SSR, Static Generation, and Client DOM.
 */

import {
  createEffect,
  getCurrentOwner,
  onCleanup
} from "../core/index.js";
import type { HeadCollector } from "./directives/contract-types.js";
import {
  computeLinkKey,
  computeMetaKey,
  getActiveHeadCollector,
  serializeSafeJsonLd,
  type HeadInput,
  type HeadJsonLdEntry,
  type HeadLinkEntry,
  type HeadMetaEntry,
  type MaybeGetter,
  type UniversalHeadCollector
} from "./head-collector.js";

export * from "./head-collector.js";

interface DomEntry<V> {
  readonly id: symbol;
  value: V;
}

interface DomTagBucket {
  readonly initialEl: Element | null;
  readonly initialAttrs: Readonly<Record<string, string>> | null;
  el: Element | null;
  readonly entries: DomEntry<Readonly<Record<string, string>>>[];
}

interface DomAttrBucket {
  readonly initialValue: string | null;
  readonly entries: DomEntry<string | undefined>[];
}

interface DomScriptBucket {
  readonly initialEl: Element | null;
  readonly initialText: string | null;
  el: Element | null;
  readonly entries: DomEntry<string>[];
}

interface UniversalHeadDomState {
  initialTitle: string | null;
  titleTemplate: string | ((title: string) => string) | undefined;
  readonly titleEntries: DomEntry<string>[];
  readonly htmlAttrs: Map<string, DomAttrBucket>;
  readonly bodyAttrs: Map<string, DomAttrBucket>;
  readonly metaBuckets: Map<string, DomTagBucket>;
  readonly linkBuckets: Map<string, DomTagBucket>;
  readonly jsonLdBuckets: Map<string, DomScriptBucket>;
}

const domStateByDoc = new WeakMap<Document, UniversalHeadDomState>();

function getDomState(doc: Document): UniversalHeadDomState {
  let st = domStateByDoc.get(doc);
  if (!st) {
    st = {
      initialTitle: null,
      titleTemplate: undefined,
      titleEntries: [],
      htmlAttrs: new Map(),
      bodyAttrs: new Map(),
      metaBuckets: new Map(),
      linkBuckets: new Map(),
      jsonLdBuckets: new Map()
    };
    domStateByDoc.set(doc, st);
  }
  return st;
}

function snapshotAttrs(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const a = el.attributes[i]!;
    out[a.name] = a.value;
  }
  return out;
}

function syncElAttrs(el: Element, attrs: Readonly<Record<string, string>>, key: string): void {
  const toRemove: string[] = [];
  for (let i = 0; i < el.attributes.length; i++) {
    const name = el.attributes[i]!.name;
    if (name !== "data-mix-head" && !Object.prototype.hasOwnProperty.call(attrs, name)) {
      toRemove.push(name);
    }
  }
  for (const name of toRemove) el.removeAttribute(name);
  for (const [k, v] of Object.entries(attrs)) {
    if (el.getAttribute(k) !== v) el.setAttribute(k, v);
  }
  if (el.getAttribute("data-mix-head") !== key) {
    el.setAttribute("data-mix-head", key);
  }
}

function findDomTag(doc: Document, tagName: "meta" | "link", key: string): Element | null {
  const tags = doc.head.getElementsByTagName(tagName);
  for (let i = 0; i < tags.length; i++) {
    const el = tags[i]!;
    if (el.getAttribute("data-mix-head") === key) return el;
    const attrs = snapshotAttrs(el);
    const derived = tagName === "meta" ? computeMetaKey(attrs) : computeLinkKey(attrs);
    if (derived === key) return el;
  }
  return null;
}

function findDomJsonLd(doc: Document, key: string): Element | null {
  const scripts = doc.head.getElementsByTagName("script");
  for (let i = 0; i < scripts.length; i++) {
    const el = scripts[i]!;
    if (el.getAttribute("type") === "application/ld+json" && el.getAttribute("data-mix-head") === key) {
      return el;
    }
  }
  return null;
}

function syncTagBucket(
  doc: Document,
  buckets: Map<string, DomTagBucket>,
  tagName: "meta" | "link",
  key: string
): void {
  const bucket = buckets.get(key);
  if (!bucket) return;
  const top = bucket.entries[bucket.entries.length - 1];
  if (top) {
    if (!bucket.el) {
      bucket.el = doc.createElement(tagName);
    }
    syncElAttrs(bucket.el, top.value, key);
    if (bucket.el.parentNode !== doc.head) {
      doc.head.appendChild(bucket.el);
    }
    return;
  }
  if (bucket.initialEl && bucket.initialAttrs) {
    syncElAttrs(bucket.initialEl, bucket.initialAttrs, key);
    if (bucket.initialEl.parentNode !== doc.head) {
      doc.head.appendChild(bucket.initialEl);
    }
  } else if (bucket.el && bucket.el.parentNode) {
    bucket.el.parentNode.removeChild(bucket.el);
  }
  buckets.delete(key);
}

function syncAttrMap(
  target: Element | null,
  map: Map<string, DomAttrBucket>,
  attrName: string
): void {
  if (!target) return;
  const bucket = map.get(attrName);
  if (!bucket) return;
  const top = bucket.entries[bucket.entries.length - 1];
  if (top && top.value !== undefined) {
    if (target.getAttribute(attrName) !== top.value) {
      target.setAttribute(attrName, top.value);
    }
    return;
  }
  if (bucket.initialValue !== null) {
    target.setAttribute(attrName, bucket.initialValue);
  } else {
    target.removeAttribute(attrName);
  }
  if (bucket.entries.length === 0) {
    map.delete(attrName);
  }
}

function syncJsonLdBucket(doc: Document, buckets: Map<string, DomScriptBucket>, key: string): void {
  const bucket = buckets.get(key);
  if (!bucket) return;
  const top = bucket.entries[bucket.entries.length - 1];
  if (top) {
    if (!bucket.el) {
      bucket.el = doc.createElement("script");
      bucket.el.setAttribute("type", "application/ld+json");
      bucket.el.setAttribute("data-mix-head", key);
    }
    if (bucket.el.textContent !== top.value) {
      bucket.el.textContent = top.value;
    }
    if (bucket.el.parentNode !== doc.head) {
      doc.head.appendChild(bucket.el);
    }
    return;
  }
  if (bucket.initialEl && bucket.initialText !== null) {
    bucket.initialEl.textContent = bucket.initialText;
  } else if (bucket.el && bucket.el.parentNode) {
    bucket.el.parentNode.removeChild(bucket.el);
  }
  buckets.delete(key);
}

function normalizeEntryAttrs(raw: HeadMetaEntry | HeadLinkEntry): { key?: string; attrs: Record<string, string> } {
  const attrs: Record<string, string> = {};
  let explicitKey: string | undefined;
  for (const [k, v] of Object.entries(raw)) {
    if (k === "key") {
      if (typeof v === "string") explicitKey = v;
      continue;
    }
    if (v !== undefined) attrs[k] = String(v);
  }
  return explicitKey ? { key: explicitKey, attrs } : { attrs };
}

function isUniversalCollector(c: HeadCollector): c is UniversalHeadCollector {
  return typeof (c as UniversalHeadCollector).addKeyedMeta === "function";
}

function applyToServerCollector(collector: HeadCollector, data: HeadInput): void {
  if (data.titleTemplate !== undefined && isUniversalCollector(collector)) {
    collector.setTitleTemplate(data.titleTemplate);
  }
  if (data.title !== undefined) {
    collector.addTitle(data.title);
  }
  if (data.htmlAttrs && isUniversalCollector(collector)) {
    collector.addHtmlAttrs(data.htmlAttrs);
  }
  if (data.bodyAttrs && isUniversalCollector(collector)) {
    collector.addBodyAttrs(data.bodyAttrs);
  }
  if (data.meta) {
    for (const item of data.meta) {
      const { key, attrs } = normalizeEntryAttrs(item);
      if (isUniversalCollector(collector)) collector.addKeyedMeta(attrs, key);
      else collector.addMeta(attrs);
    }
  }
  if (data.link) {
    for (const item of data.link) {
      const { key, attrs } = normalizeEntryAttrs(item);
      if (isUniversalCollector(collector)) collector.addKeyedLink(attrs, key);
      else collector.addLink(attrs);
    }
  }
  if (data.jsonLd !== undefined && isUniversalCollector(collector)) {
    const items = Array.isArray(data.jsonLd) ? data.jsonLd : [data.jsonLd];
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as Record<string, unknown> | HeadJsonLdEntry;
      if (item && typeof item === "object" && "data" in item && ("key" in item || Object.keys(item).length <= 2)) {
        const entry = item as HeadJsonLdEntry;
        collector.addJsonLd(entry.data, entry.key);
      } else {
        collector.addJsonLd(item);
      }
    }
  }
}

export function useHead(input: MaybeGetter<HeadInput>): void {
  const activeCollector = getActiveHeadCollector();
  if (activeCollector) {
    const resolved = typeof input === "function" ? input() : input;
    applyToServerCollector(activeCollector, resolved);
    return;
  }

  if (typeof document === "undefined" || !document.head) {
    return;
  }

  const doc = document;
  const state = getDomState(doc);
  const owner = getCurrentOwner();
  const entryId = Symbol("mix.useHead");
  let localKeysMeta: string[] = [];
  let localKeysLink: string[] = [];
  let localKeysJsonLd: string[] = [];
  let localHtmlKeys: string[] = [];
  let localBodyKeys: string[] = [];
  let hasTitleEntry = false;

  const applyTitle = (): void => {
    const top = state.titleEntries[state.titleEntries.length - 1];
    if (!top) {
      if (state.initialTitle !== null) {
        doc.title = state.initialTitle;
        state.initialTitle = null;
      }
      return;
    }
    let next = top.value;
    if (typeof state.titleTemplate === "function") next = state.titleTemplate(next);
    else if (typeof state.titleTemplate === "string" && state.titleTemplate.includes("%s")) {
      next = state.titleTemplate.replace("%s", next);
    }
    doc.title = next;
  };

  const cleanupEntry = (): void => {
    if (hasTitleEntry) {
      const idx = state.titleEntries.findIndex((e) => e.id === entryId);
      if (idx !== -1) state.titleEntries.splice(idx, 1);
      applyTitle();
      hasTitleEntry = false;
    }
    for (const k of localHtmlKeys) {
      const b = state.htmlAttrs.get(k);
      if (b) {
        const idx = b.entries.findIndex((e) => e.id === entryId);
        if (idx !== -1) b.entries.splice(idx, 1);
        syncAttrMap(doc.documentElement, state.htmlAttrs, k);
      }
    }
    for (const k of localBodyKeys) {
      const b = state.bodyAttrs.get(k);
      if (b) {
        const idx = b.entries.findIndex((e) => e.id === entryId);
        if (idx !== -1) b.entries.splice(idx, 1);
        syncAttrMap(doc.body, state.bodyAttrs, k);
      }
    }
    for (const k of localKeysMeta) {
      const b = state.metaBuckets.get(k);
      if (b) {
        const idx = b.entries.findIndex((e) => e.id === entryId);
        if (idx !== -1) b.entries.splice(idx, 1);
        syncTagBucket(doc, state.metaBuckets, "meta", k);
      }
    }
    for (const k of localKeysLink) {
      const b = state.linkBuckets.get(k);
      if (b) {
        const idx = b.entries.findIndex((e) => e.id === entryId);
        if (idx !== -1) b.entries.splice(idx, 1);
        syncTagBucket(doc, state.linkBuckets, "link", k);
      }
    }
    for (const k of localKeysJsonLd) {
      const b = state.jsonLdBuckets.get(k);
      if (b) {
        const idx = b.entries.findIndex((e) => e.id === entryId);
        if (idx !== -1) b.entries.splice(idx, 1);
        syncJsonLdBucket(doc, state.jsonLdBuckets, k);
      }
    }
    localKeysMeta = [];
    localKeysLink = [];
    localKeysJsonLd = [];
    localHtmlKeys = [];
    localBodyKeys = [];
  };

  const applyHeadData = (data: HeadInput): void => {
    cleanupEntry();
    if (data.titleTemplate !== undefined) {
      state.titleTemplate = data.titleTemplate;
    }
    if (data.title !== undefined) {
      if (state.titleEntries.length === 0 && state.initialTitle === null) {
        state.initialTitle = doc.title;
      }
      state.titleEntries.push({ id: entryId, value: data.title });
      hasTitleEntry = true;
      applyTitle();
    }
    if (data.htmlAttrs && doc.documentElement) {
      for (const [k, v] of Object.entries(data.htmlAttrs)) {
        let b = state.htmlAttrs.get(k);
        if (!b) {
          b = { initialValue: doc.documentElement.getAttribute(k), entries: [] };
          state.htmlAttrs.set(k, b);
        }
        b.entries.push({ id: entryId, value: v });
        localHtmlKeys.push(k);
        syncAttrMap(doc.documentElement, state.htmlAttrs, k);
      }
    }
    if (data.bodyAttrs && doc.body) {
      for (const [k, v] of Object.entries(data.bodyAttrs)) {
        let b = state.bodyAttrs.get(k);
        if (!b) {
          b = { initialValue: doc.body.getAttribute(k), entries: [] };
          state.bodyAttrs.set(k, b);
        }
        b.entries.push({ id: entryId, value: v });
        localBodyKeys.push(k);
        syncAttrMap(doc.body, state.bodyAttrs, k);
      }
    }
    if (data.meta) {
      let anonIdx = 0;
      for (const item of data.meta) {
        const { key: explicitKey, attrs } = normalizeEntryAttrs(item);
        const key = computeMetaKey(attrs, explicitKey) ?? `anon:${entryId.description ?? "m"}:${anonIdx++}`;
        let b = state.metaBuckets.get(key);
        if (!b) {
          const existing = findDomTag(doc, "meta", key);
          b = { initialEl: existing, initialAttrs: existing ? snapshotAttrs(existing) : null, el: existing, entries: [] };
          state.metaBuckets.set(key, b);
        }
        b.entries.push({ id: entryId, value: attrs });
        localKeysMeta.push(key);
        syncTagBucket(doc, state.metaBuckets, "meta", key);
      }
    }
    if (data.link) {
      let anonIdx = 0;
      for (const item of data.link) {
        const { key: explicitKey, attrs } = normalizeEntryAttrs(item);
        const key = computeLinkKey(attrs, explicitKey) ?? `anon:${entryId.description ?? "l"}:${anonIdx++}`;
        let b = state.linkBuckets.get(key);
        if (!b) {
          const existing = findDomTag(doc, "link", key);
          b = { initialEl: existing, initialAttrs: existing ? snapshotAttrs(existing) : null, el: existing, entries: [] };
          state.linkBuckets.set(key, b);
        }
        b.entries.push({ id: entryId, value: attrs });
        localKeysLink.push(key);
        syncTagBucket(doc, state.linkBuckets, "link", key);
      }
    }
    if (data.jsonLd !== undefined) {
      const items = Array.isArray(data.jsonLd) ? data.jsonLd : [data.jsonLd];
      for (let i = 0; i < items.length; i++) {
        const rawItem = items[i] as Record<string, unknown> | HeadJsonLdEntry;
        const isWrapper = rawItem && typeof rawItem === "object" && "data" in rawItem && ("key" in rawItem || Object.keys(rawItem).length <= 2);
        const key = isWrapper && (rawItem as HeadJsonLdEntry).key ? (rawItem as HeadJsonLdEntry).key! : `jsonld:${i}`;
        const payload = isWrapper ? (rawItem as HeadJsonLdEntry).data : rawItem;
        const serialized = serializeSafeJsonLd(payload);
        let b = state.jsonLdBuckets.get(key);
        if (!b) {
          const existing = findDomJsonLd(doc, key);
          b = { initialEl: existing, initialText: existing ? existing.textContent : null, el: existing, entries: [] };
          state.jsonLdBuckets.set(key, b);
        }
        b.entries.push({ id: entryId, value: serialized });
        localKeysJsonLd.push(key);
        syncJsonLdBucket(doc, state.jsonLdBuckets, key);
      }
    }
  };

  if (typeof input === "function" && owner) {
    createEffect(() => {
      applyHeadData(input());
    });
  } else {
    applyHeadData(typeof input === "function" ? input() : input);
  }

  if (owner) {
    onCleanup(cleanupEntry);
  }
}
