/**
 * @dotmix/server-node/directives/head-stacks — SSR StackCollector, HeadCollector, and HTML/stream injection (F9, T-38.6).
 */

import type { HeadCollector, HeadTagRecord, StackCollector } from "@dotmix/runtime";

export type { HeadCollector, HeadTagRecord, StackCollector };

const STACK_MARKER_PREFIX = "<!--mix:stack:";
const HEAD_MARKER = "<!--mix:head-->";
const HEAD_CLOSE_TAG = "</head>";

function escapeHtmlText(rawText: string): string {
  let escaped = "";
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i]!;
    if (ch === "&") escaped += "&amp;";
    else if (ch === "<") escaped += "&lt;";
    else if (ch === ">") escaped += "&gt;";
    else escaped += ch;
  }
  return escaped;
}

function escapeHtmlAttr(attributeValue: string): string {
  let escaped = "";
  for (let i = 0; i < attributeValue.length; i++) {
    const ch = attributeValue[i]!;
    if (ch === "&") escaped += "&amp;";
    else if (ch === "\"") escaped += "&quot;";
    else if (ch === "<") escaped += "&lt;";
    else if (ch === ">") escaped += "&gt;";
    else if (ch === "'") escaped += "&#39;";
    else escaped += ch;
  }
  return escaped;
}

function formatAttributes(attrs: Readonly<Record<string, string>>): string {
  const parts: string[] = [];
  for (const [attrName, attrValue] of Object.entries(attrs)) {
    parts.push(`${attrName}="${escapeHtmlAttr(attrValue)}"`);
  }
  return parts.join(" ");
}

interface StackBucket {
  readonly prepends: string[];
  readonly pushes: string[];
  readonly seenOnce: Set<string>;
}

export function createSsrStackCollector(): StackCollector {
  const buckets = new Map<string, StackBucket>();

  function getOrCreateBucket(stackName: string): StackBucket {
    let bucket = buckets.get(stackName);
    if (!bucket) {
      bucket = { prepends: [], pushes: [], seenOnce: new Set<string>() };
      buckets.set(stackName, bucket);
    }
    return bucket;
  }

  return {
    push(stackName: string, content: string, onceId?: string): void {
      const bucket = getOrCreateBucket(stackName);
      if (onceId !== undefined) {
        if (bucket.seenOnce.has(onceId)) return;
        bucket.seenOnce.add(onceId);
      }
      bucket.pushes.push(content);
    },

    prepend(stackName: string, content: string, onceId?: string): void {
      const bucket = getOrCreateBucket(stackName);
      if (onceId !== undefined) {
        if (bucket.seenOnce.has(onceId)) return;
        bucket.seenOnce.add(onceId);
      }
      bucket.prepends.push(content);
    },

    render(stackName: string): string {
      const bucket = buckets.get(stackName);
      if (!bucket) return "";
      return bucket.prepends.join("") + bucket.pushes.join("");
    },

    has(stackName: string): boolean {
      const bucket = buckets.get(stackName);
      if (!bucket) return false;
      return bucket.prepends.length > 0 || bucket.pushes.length > 0;
    },

    getEntries(stackName: string): readonly string[] {
      const bucket = buckets.get(stackName);
      if (!bucket) return [];
      return [...bucket.prepends, ...bucket.pushes];
    }
  };
}

export function createSsrHeadCollector(): HeadCollector {
  let title: string | undefined;
  let anonymousCounter = 0;
  const metaMap = new Map<string, Readonly<Record<string, string>>>();
  const linkMap = new Map<string, Readonly<Record<string, string>>>();

  function getMetaKey(attrs: Readonly<Record<string, string>>): string {
    if (typeof attrs.name === "string" && attrs.name.length > 0) {
      return `name:${attrs.name}`;
    }
    if (typeof attrs.property === "string" && attrs.property.length > 0) {
      return `property:${attrs.property}`;
    }
    if (typeof attrs["http-equiv"] === "string" && attrs["http-equiv"].length > 0) {
      return `http-equiv:${attrs["http-equiv"]}`;
    }
    if (typeof attrs.charset === "string") {
      return "charset";
    }
    anonymousCounter += 1;
    return `anon:${anonymousCounter}`;
  }

  function getLinkKey(attrs: Readonly<Record<string, string>>): string {
    const rel = attrs.rel ?? "";
    const href = attrs.href ?? "";
    if (rel.length > 0 || href.length > 0) {
      return `link:${rel}\0${href}`;
    }
    anonymousCounter += 1;
    return `anon:${anonymousCounter}`;
  }

  return {
    addTitle(text: string): void {
      title = text;
    },

    addMeta(attrs: Readonly<Record<string, string>>): void {
      metaMap.set(getMetaKey(attrs), { ...attrs });
    },

    addLink(attrs: Readonly<Record<string, string>>): void {
      linkMap.set(getLinkKey(attrs), { ...attrs });
    },

    getTags(): readonly HeadTagRecord[] {
      const records: HeadTagRecord[] = [];
      if (title !== undefined) {
        records.push({ kind: "title", text: title });
      }
      for (const attrs of metaMap.values()) {
        records.push({ kind: "meta", attrs });
      }
      for (const attrs of linkMap.values()) {
        records.push({ kind: "link", attrs });
      }
      return records;
    },

    renderHtml(): string {
      const tags: string[] = [];
      if (title !== undefined) {
        tags.push(`<title>${escapeHtmlText(title)}</title>`);
      }
      for (const attrs of metaMap.values()) {
        const attrStr = formatAttributes(attrs);
        tags.push(attrStr.length > 0 ? `<meta ${attrStr} />` : "<meta />");
      }
      for (const attrs of linkMap.values()) {
        const attrStr = formatAttributes(attrs);
        tags.push(attrStr.length > 0 ? `<link ${attrStr} />` : "<link />");
      }
      return tags.join("\n");
    },

    renderToHeadHtml(): string {
      return this.renderHtml();
    }
  };
}

function replaceStackPlaceholders(html: string, stacks: StackCollector): string {
  let out = "";
  let pos = 0;

  while (pos < html.length) {
    const startIdx = html.indexOf(STACK_MARKER_PREFIX, pos);
    if (startIdx === -1) {
      out += html.slice(pos);
      break;
    }

    const endMarkerIdx = html.indexOf("-->", startIdx + STACK_MARKER_PREFIX.length);
    if (endMarkerIdx === -1) {
      out += html.slice(pos);
      break;
    }

    const stackName = html.slice(startIdx + STACK_MARKER_PREFIX.length, endMarkerIdx);
    out += html.slice(pos, startIdx);
    out += stacks.render(stackName);

    let nextPos = endMarkerIdx + 3;
    const closingMarker = `<!--/mix:stack:${stackName}-->`;
    if (html.startsWith(closingMarker, nextPos)) {
      nextPos += closingMarker.length;
    }
    pos = nextPos;
  }

  return out;
}

function injectHeadHtml(html: string, headHtml: string): string {
  const markerIdx = html.indexOf(HEAD_MARKER);
  if (markerIdx !== -1) {
    return html.slice(0, markerIdx) + headHtml + html.slice(markerIdx + HEAD_MARKER.length);
  }

  if (headHtml.length === 0) {
    return html;
  }

  const lower = html.toLowerCase();
  const closeHeadIdx = lower.indexOf(HEAD_CLOSE_TAG);
  if (closeHeadIdx !== -1) {
    return html.slice(0, closeHeadIdx) + headHtml + "\n" + html.slice(closeHeadIdx);
  }

  return html;
}

export function injectHeadAndStacks(
  html: string,
  head: HeadCollector,
  stacks: StackCollector
): string {
  const withStacks = replaceStackPlaceholders(html, stacks);
  return injectHeadHtml(withStacks, head.renderToHeadHtml());
}

function findHoldStartIndex(buffer: string): number {
  const headMarkerIdx = buffer.indexOf(HEAD_MARKER);
  const stackMarkerIdx = buffer.indexOf(STACK_MARKER_PREFIX);
  const closeHeadIdx = buffer.toLowerCase().indexOf(HEAD_CLOSE_TAG);

  let earliest = -1;
  for (const idx of [headMarkerIdx, stackMarkerIdx, closeHeadIdx]) {
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
    }
  }
  return earliest;
}

/**
 * Streams SSR chunks while guaranteeing accurate head & stack injection even if
 * `<Head>` or `{push}` directives appear later in the component tree than `<head>` or `{stack}`.
 */
export async function* streamWithHeadAndStacks(
  chunks: AsyncIterable<string> | Iterable<string>,
  head: HeadCollector,
  stacks: StackCollector
): AsyncIterable<string> {
  const trailingHold = Math.max(HEAD_MARKER.length, STACK_MARKER_PREFIX.length, HEAD_CLOSE_TAG.length) - 1;
  let pending = "";
  let holdingForInjection = false;

  for await (const chunk of chunks) {
    pending += String(chunk);
    if (!holdingForInjection) {
      const holdIdx = findHoldStartIndex(pending);
      if (holdIdx !== -1) {
        if (holdIdx > 0) {
          yield pending.slice(0, holdIdx);
          pending = pending.slice(holdIdx);
        }
        holdingForInjection = true;
      } else if (pending.length > trailingHold) {
        const flushEnd = pending.length - trailingHold;
        yield pending.slice(0, flushEnd);
        pending = pending.slice(flushEnd);
      }
    }
  }

  if (pending.length > 0) {
    yield injectHeadAndStacks(pending, head, stacks);
  }
}
