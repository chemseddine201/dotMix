/**
 * @mix/runtime — Platform-neutral reactive core, scheduler, cancellation, and DOM reconciliation.
 */

// --- 1. Lifecycle and State Types (D-102) ---

export type OwnerState = "ACTIVE" | "DISPOSED";
export type ComputationState = "CLEAN" | "CHECK" | "DIRTY" | "RUNNING" | "DISPOSED";

export class ReactiveCycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReactiveCycleError";
  }
}

export class MixSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MixSecurityError";
  }
}

export interface SchedulerOptions {
  maxEffectIterations?: number;
}

export const defaultSchedulerOptions: Required<SchedulerOptions> = {
  maxEffectIterations: 1000 // Configurable iteration ceiling (D-101)
};

// --- 2. Global Reactive Engine Context ---

let activeOwner: Owner | null = null;
let activeComputation: ComputationNode | null = null;
const pendingQueue: ComputationNode[] = [];
let isFlushing = false;
let batchDepth = 0;
let globalGenerationCounter = 0;

export class Owner {
  state: OwnerState = "ACTIVE";
  readonly cleanups: Array<() => void> = [];
  readonly children: Owner[] = [];
  readonly computations: ComputationNode[] = [];
  readonly tokens: CancellationToken[] = [];
  readonly parent: Owner | null;
  readonly isDetached: boolean;

  constructor(parent: Owner | null = activeOwner, isDetached = false) {
    this.parent = parent;
    this.isDetached = isDetached;
    if (parent && parent.state === "ACTIVE" && !isDetached) {
      parent.children.push(this);
    }
  }

  dispose(): void {
    if (this.state === "DISPOSED") return;
    this.state = "DISPOSED";

    // 1. Cancel all active cancellation tokens (D-104)
    for (const token of this.tokens) {
      token.cancel();
    }
    this.tokens.length = 0;

    // 2. Run all cleanups
    for (const cleanup of this.cleanups) {
      try {
        cleanup();
      } catch (err) {
        console.error("Error in onCleanup:", err);
      }
    }
    this.cleanups.length = 0;

    // 3. Dispose all descendant computations (D-102)
    for (const comp of this.computations) {
      comp.dispose();
    }
    this.computations.length = 0;

    // 4. Dispose all child owners
    for (const child of this.children) {
      child.dispose();
    }
    this.children.length = 0;
  }
}

export interface ComputationNode {
  state: ComputationState;
  pendingRerun: boolean; // Decoupled from state (D-101)
  runCount: number;
  run(): void;
  dispose(): void;
}

// --- 3. Reactive Primitives: Signals, Memos, Effects ---

export interface Signal<T> {
  (): T;
  set(nextValue: T | ((prev: T) => T)): T;
}

export function signal<T>(initialValue: T): Signal<T> {
  let value = initialValue;
  const observers = new Set<ComputationNode>();

  const read = function (): T {
    if (activeComputation && activeComputation.state !== "DISPOSED") {
      observers.add(activeComputation);
    }
    return value;
  };

  read.set = function (nextValue: T | ((prev: T) => T)): T {
    const resolvedValue =
      typeof nextValue === "function" ? (nextValue as (prev: T) => T)(value) : nextValue;

    if (!Object.is(value, resolvedValue)) {
      value = resolvedValue;

      // Notify observers (D-101, Pull-Push model)
      for (const observer of Array.from(observers)) {
        if (observer.state === "DISPOSED") {
          observers.delete(observer);
          continue;
        }

        if (observer instanceof ComputedNode) {
          // Push notification marks memo dirty without eager queueing
          observer.markDirty();
        } else if (observer.state === "RUNNING") {
          // Non-nested: Coalesce duplicate rerun requests (D-101)
          observer.pendingRerun = true;
        } else {
          observer.state = "DIRTY";
          scheduleComputation(observer);
        }
      }
    }
    return value;
  };

  return read as Signal<T>;
}

export interface Computed<T> {
  (): T;
}

export class ComputedNode<T> implements ComputationNode {
  state: ComputationState = "DIRTY";
  pendingRerun = false;
  runCount = 0;
  private value!: T;
  private readonly fn: () => T;
  readonly observers = new Set<ComputationNode>();
  private readonly owner: Owner;

  constructor(fn: () => T, owner: Owner) {
    this.fn = fn;
    this.owner = owner;
    owner.computations.push(this);
  }

  markDirty(): void {
    if (this.state === "DIRTY" || this.state === "DISPOSED") return;
    this.state = "DIRTY";
    for (const obs of Array.from(this.observers)) {
      if (obs instanceof ComputedNode) {
        obs.markDirty();
      } else {
        obs.state = "DIRTY";
        scheduleComputation(obs);
      }
    }
  }

  read(): T {
    if (this.state === "DISPOSED") {
      return this.value;
    }

    if (activeComputation && activeComputation.state !== "DISPOSED") {
      this.observers.add(activeComputation);
    }

    if (this.state === "DIRTY") {
      this.run();
    }

    return this.value;
  }

  run(): void {
    if (this.state === "DISPOSED") return;

    const prevComputation = activeComputation;
    const prevOwner = activeOwner;
    activeComputation = this;
    activeOwner = this.owner;
    this.state = "RUNNING";

    try {
      this.value = this.fn();
    } finally {
      this.state = "CLEAN";
      activeComputation = prevComputation;
      activeOwner = prevOwner;
    }
  }

  dispose(): void {
    if (this.state === "DISPOSED") return;
    this.state = "DISPOSED";
    this.observers.clear();
  }
}

export function computed<T>(fn: () => T): Computed<T> {
  const currentOwner = activeOwner ?? new Owner(null);
  const memo = new ComputedNode(fn, currentOwner);
  return () => memo.read();
}

export class EffectComputation implements ComputationNode {
  state: ComputationState = "CLEAN";
  pendingRerun = false; // Separate from state (D-101)
  runCount = 0;
  private readonly fn: () => void | (() => void);
  private cleanup: (() => void) | void = undefined;
  private readonly owner: Owner;

  constructor(fn: () => void | (() => void), owner: Owner) {
    this.fn = fn;
    this.owner = owner;
    owner.computations.push(this);
  }

  run(): void {
    if (this.state === "DISPOSED") return;

    // Cycle detection check (D-101)
    this.runCount++;
    if (this.runCount > defaultSchedulerOptions.maxEffectIterations) {
      this.state = "CLEAN";
      this.pendingRerun = false;
      throw new ReactiveCycleError(
        `Exceeded maximum effect iterations (${defaultSchedulerOptions.maxEffectIterations}). Infinite reactive loop detected.`
      );
    }

    if (typeof this.cleanup === "function") {
      try {
        this.cleanup();
      } catch (err) {
        console.error("Error in effect cleanup:", err);
      }
      this.cleanup = undefined;
    }

    const prevComputation = activeComputation;
    const prevOwner = activeOwner;
    activeComputation = this;
    activeOwner = this.owner;
    this.state = "RUNNING";

    try {
      this.cleanup = this.fn();
    } finally {
      this.state = "CLEAN";
      activeComputation = prevComputation;
      activeOwner = prevOwner;

      // Non-nested deferred rerun (D-101): check if writes occurred during run
      if (this.pendingRerun) {
        this.pendingRerun = false;
        scheduleComputation(this);
      }
    }
  }

  dispose(): void {
    if (this.state === "DISPOSED") return;
    this.state = "DISPOSED";
    this.pendingRerun = false;

    if (typeof this.cleanup === "function") {
      try {
        this.cleanup();
      } catch (err) {
        console.error("Error in effect cleanup on dispose:", err);
      }
      this.cleanup = undefined;
    }
  }
}

export function createEffect(fn: () => void | (() => void)): void {
  const currentOwner = activeOwner ?? new Owner(null);
  const effect = new EffectComputation(fn, currentOwner);
  // Initial run
  effect.run();
}

export function batch<T>(fn: () => T): T {
  batchDepth++;
  try {
    return fn();
  } finally {
    batchDepth--;
    if (batchDepth === 0) {
      flushQueue();
    }
  }
}

function scheduleComputation(comp: ComputationNode): void {
  if (comp.state === "DISPOSED") return;
  if (!pendingQueue.includes(comp)) {
    pendingQueue.push(comp);
  }
  if (batchDepth === 0) {
    flushQueue();
  }
}

export function flushQueue(): void {
  if (isFlushing || batchDepth > 0) return;
  isFlushing = true;

  try {
    while (pendingQueue.length > 0) {
      const comp = pendingQueue.shift();
      if (comp && comp.state !== "DISPOSED") {
        comp.run();
      }
    }
  } finally {
    isFlushing = false;
    for (const comp of pendingQueue) {
      comp.runCount = 0;
    }
  }
}

// --- 4. Root Creation & Lifecycle (D-103) ---

export function createRoot<T>(
  fn: (dispose: () => void) => T,
  detachedParent?: Owner | null
): T {
  // Preserves detachedParent per D-103: detached from parent's automatic child disposal
  const rootOwner = new Owner(detachedParent ?? null, true);
  const prevOwner = activeOwner;
  activeOwner = rootOwner;

  const dispose = () => {
    rootOwner.dispose();
  };

  try {
    return fn(dispose);
  } finally {
    activeOwner = prevOwner;
  }
}

export function onCleanup(fn: () => void): void {
  if (activeOwner && activeOwner.state === "ACTIVE") {
    activeOwner.cleanups.push(fn);
  }
}

// --- 5. Platform-Neutral Resource Cancellation & Generation Tokens (D-104) ---

export class CancellationToken {
  private _isCancelled = false;
  readonly generation: number;
  private readonly callbacks: Array<() => void> = [];

  constructor(generation: number) {
    this.generation = generation;
  }

  get isCancelled(): boolean {
    return this._isCancelled;
  }

  cancel(): void {
    if (this._isCancelled) return;
    this._isCancelled = true;
    for (const cb of this.callbacks) {
      try {
        cb();
      } catch (err) {
        console.error("Error in cancellation callback:", err);
      }
    }
    this.callbacks.length = 0;
  }

  onCancelled(cb: () => void): void {
    if (this._isCancelled) {
      cb();
    } else {
      this.callbacks.push(cb);
    }
  }
}

export function createCancellationToken(): CancellationToken {
  const token = new CancellationToken(++globalGenerationCounter);
  if (activeOwner && activeOwner.state === "ACTIVE") {
    activeOwner.tokens.push(token);
  }
  return token;
}

export interface Resource<T> {
  data: Signal<T | undefined>;
  loading: Signal<boolean>;
  error: Signal<unknown>;
  refetch: () => void;
}

export function createResource<T>(fetcher: (token: CancellationToken) => Promise<T>): Resource<T> {
  const data = signal<T | undefined>(undefined);
  const loading = signal<boolean>(true);
  const error = signal<unknown>(undefined);

  let currentToken: CancellationToken | null = null;

  function load() {
    if (currentToken) {
      currentToken.cancel();
    }
    const token = createCancellationToken();
    currentToken = token;

    loading.set(true);
    error.set(undefined);

    fetcher(token)
      .then((res) => {
        // Reject stale generations (D-104)
        if (!token.isCancelled) {
          data.set(() => res);
          loading.set(false);
        }
      })
      .catch((err) => {
        if (!token.isCancelled) {
          error.set(() => err);
          loading.set(false);
        }
      });
  }

  load();

  return {
    data,
    loading,
    error,
    refetch: load
  };
}

// --- 6. Trusted HTML Boundary & Sanitizer Provider (D-109) ---

export interface SanitizerContext {
  element?: string;
  attribute?: string;
}

export interface SanitizerProvider {
  sanitizeHtml(raw: string, context?: SanitizerContext): string;
}

let activeSanitizerProvider: SanitizerProvider | null = null;
let trustedTypesPolicy: { createHTML: (raw: string) => unknown } | null = null;

export function setSanitizerProvider(provider: SanitizerProvider | null): void {
  activeSanitizerProvider = provider;
}

export function getSanitizerProvider(): SanitizerProvider | null {
  return activeSanitizerProvider;
}

export function resetTrustedTypesPolicy(): void {
  trustedTypesPolicy = null;
}

export function getOrCreateTrustedTypesPolicy(): { createHTML: (raw: string) => unknown } | null {
  if (trustedTypesPolicy) return trustedTypesPolicy;
  const globalObj = typeof globalThis !== "undefined"
    ? (globalThis as unknown as { window?: { trustedTypes?: { createPolicy: (name: string, rules: { createHTML: (s: string) => string }) => { createHTML: (raw: string) => unknown } } }; trustedTypes?: { createPolicy: (name: string, rules: { createHTML: (s: string) => string }) => { createHTML: (raw: string) => unknown } } })
    : undefined;

  const tt = globalObj?.window?.trustedTypes ?? globalObj?.trustedTypes;
  if (tt && typeof tt.createPolicy === "function") {
    try {
      trustedTypesPolicy = tt.createPolicy("mix-framework#html", {
        createHTML: (raw: string) => {
          if (activeSanitizerProvider) {
            return activeSanitizerProvider.sanitizeHtml(raw);
          }
          return raw;
        }
      });
    } catch {
      // Policy already created or disabled
    }
  }
  return trustedTypesPolicy;
}

export function renderTrustedHtml(rawHtml: string, context?: SanitizerContext): string {
  if (!activeSanitizerProvider) {
    throw new MixSecurityError("Refusing to evaluate raw HTML without a registered SanitizerProvider.");
  }
  return activeSanitizerProvider.sanitizeHtml(rawHtml, context);
}

export function setTrustedHtml(el: Element, rawHtml: string, context?: SanitizerContext): void {
  if (typeof rawHtml === "object" && rawHtml !== null && (rawHtml as { constructor?: { name?: string } }).constructor?.name === "TrustedHTML") {
    (el as unknown as { innerHTML: unknown }).innerHTML = rawHtml;
    return;
  }

  const sanitized = renderTrustedHtml(rawHtml, context);
  const policy = getOrCreateTrustedTypesPolicy();
  if (policy) {
    (el as unknown as { innerHTML: unknown }).innerHTML = policy.createHTML(sanitized);
  } else {
    el.innerHTML = sanitized;
  }
}

// --- 7. Security, Protocol, and Style Validation (D-107, D-108) ---

/**
 * Validates URLs against safe protocol schemes (D-107, D-108).
 * Permits http, https, relative paths, and safe image data URIs.
 * Disallows javascript:, vbscript:, arbitrary data payloads, and control characters.
 */
export function isSafeUrl(rawUrl: string): boolean {
  if (typeof rawUrl !== "string") return false;
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return false;

  // Normalize by removing control characters, tabs, and newlines that attempt scheme smuggling
  const sanitized = trimmed.replace(/[\u0000-\u001F\u007F-\u009F\s]/g, "");

  const colonIndex = sanitized.indexOf(":");
  if (colonIndex === -1) {
    // Relative URL (e.g., "/img.jpg", "./img.jpg", "img.jpg", "?q=1")
    return true;
  }

  const scheme = sanitized.slice(0, colonIndex).toLowerCase();
  if (scheme === "http" || scheme === "https") {
    return true;
  }

  if (scheme === "data") {
    // Only safe image formats permitted
    return /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml|avif)(?:;[a-zA-Z0-9=+_-]+)*,/i.test(trimmed);
  }

  return false;
}

export interface SrcsetCandidate {
  readonly url: string;
  readonly width?: number | undefined;
  readonly density?: number | undefined;
}

function isAsciiWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f";
}

/**
 * WHATWG HTML §4.8.4.3.7 / §4.8.4.3.10 conforming srcset parser (D-107).
 * Extracts candidates, handles data URLs and query params with commas,
 * parses width and density descriptors, recovers from malformed candidates,
 * and validates URL safety.
 */
export function parseSrcset(input: string): SrcsetCandidate[] {
  if (typeof input !== "string") return [];
  const length = input.length;
  let position = 0;
  const candidates: SrcsetCandidate[] = [];

  while (position < length) {
    // 1. Skip leading ASCII whitespace and commas
    while (position < length && (isAsciiWhitespace(input[position]!) || input[position] === ",")) {
      position++;
    }
    if (position >= length) break;

    // 2. Collect candidate URL
    let url = "";
    if (input.slice(position, position + 5).toLowerCase() === "data:") {
      const dataStart = position;
      position += 5;
      while (position < length) {
        if (input[position] === ",") {
          const nextPos = position + 1;
          if (nextPos >= length || isAsciiWhitespace(input[nextPos]!)) {
            break;
          }
        } else if (isAsciiWhitespace(input[position]!)) {
          const rest = input.slice(position).trimStart();
          if (/^(?:[1-9]\d*w|\d+(?:\.\d+)?x)(?:\s*,|\s*$)/i.test(rest) || rest.startsWith(",")) {
            break;
          }
        }
        position++;
      }
      url = input.slice(dataStart, position).trim();
    } else {
      const urlStart = position;
      while (position < length && !isAsciiWhitespace(input[position]!)) {
        if (input[position] === ",") {
          const next = position + 1;
          if (next >= length || isAsciiWhitespace(input[next]!)) {
            position++; // consume comma
            url = input.slice(urlStart, position - 1);
            if (url.length > 0 && isSafeUrl(url)) {
              candidates.push({ url, density: 1 });
            }
            url = "";
            break;
          }
        }
        position++;
      }
      if (url.length === 0 && position > urlStart) {
        url = input.slice(urlStart, position);
        if (url.endsWith(",")) {
          url = url.slice(0, -1);
          if (url.length > 0 && isSafeUrl(url)) {
            candidates.push({ url, density: 1 });
          }
          continue;
        }
      }
    }

    if (url.length === 0) continue;

    // 3. Collect descriptors
    const descriptors: string[] = [];
    while (position < length) {
      while (position < length && isAsciiWhitespace(input[position]!)) {
        position++;
      }
      if (position >= length) break;
      if (input[position] === ",") {
        position++;
        break;
      }

      let descriptor = "";
      let inParens = false;
      while (position < length) {
        const c = input[position]!;
        if (inParens) {
          if (c === ")") inParens = false;
          descriptor += c;
          position++;
        } else {
          if (isAsciiWhitespace(c)) {
            break;
          } else if (c === ",") {
            position++;
            if (descriptor.length > 0) descriptors.push(descriptor);
            descriptor = "";
            break;
          } else if (c === "(") {
            inParens = true;
            descriptor += c;
            position++;
          } else {
            descriptor += c;
            position++;
          }
        }
      }
      if (descriptor.length > 0) {
        descriptors.push(descriptor);
      }
      if (position > 0 && input[position - 1] === ",") {
        break;
      }
    }

    // 4. Validate descriptors (error recovery: discard malformed candidates)
    let width: number | undefined = undefined;
    let density: number | undefined = undefined;
    let isValid = true;

    for (const desc of descriptors) {
      if (/^[1-9]\d*w$/.test(desc)) {
        if (width !== undefined || density !== undefined) {
          isValid = false;
          break;
        }
        width = parseInt(desc.slice(0, -1), 10);
      } else if (/^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)x$/i.test(desc)) {
        const d = parseFloat(desc.slice(0, -1));
        if (isNaN(d) || d <= 0 || width !== undefined || density !== undefined) {
          isValid = false;
          break;
        }
        density = d;
      } else {
        isValid = false;
        break;
      }
    }

    if (!isValid) {
      continue;
    }

    if (width === undefined && density === undefined) {
      density = 1;
    }

    if (isSafeUrl(url)) {
      candidates.push({
        url,
        ...(width !== undefined ? { width } : {}),
        ...(density !== undefined ? { density } : {})
      });
    }
  }

  return candidates;
}

export function serializeSrcset(candidates: readonly SrcsetCandidate[]): string {
  return candidates
    .map((c) => {
      if (c.width !== undefined) {
        return `${c.url} ${c.width}w`;
      }
      if (c.density !== undefined && c.density !== 1) {
        return `${c.url} ${c.density}x`;
      }
      if (c.density === 1) {
        return `${c.url} 1x`;
      }
      return c.url;
    })
    .join(", ");
}

export function setSafeSrcset(el: Element, rawSrcset: string): void {
  const candidates = parseSrcset(rawSrcset);
  if (candidates.length === 0) {
    el.removeAttribute("srcset");
    return;
  }
  el.setAttribute("srcset", serializeSrcset(candidates));
}

/**
 * Decodes CSS escape sequences (\3b -> ;, \7d -> }, \22 -> ", etc.) per CSS Syntax Level 3 §4.3.8.
 */
export function decodeCssEscapes(value: string): string {
  if (typeof value !== "string") return "";
  return value.replace(/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?|([^\r\n\f0-9a-fA-F]))/g, (_, hex, char) => {
    if (hex !== undefined) {
      const codePoint = parseInt(hex, 16);
      if (codePoint === 0 || (codePoint >= 0xd800 && codePoint <= 0xdfff) || codePoint > 0x10ffff) {
        return "\uFFFD";
      }
      return String.fromCodePoint(codePoint);
    }
    return char ?? "";
  });
}

/**
 * Validates dynamic CSS property names against valid CSS identifier grammar (D-108).
 * Rejects property injection, colons, semicolons, braces, quotes, and control chars.
 */
export function validateCssPropertyName(name: string): boolean {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  if (trimmed.length === 0) return false;
  if (/^--[a-zA-Z0-9-_]+$/.test(trimmed)) return true;
  return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(trimmed);
}

/**
 * Validates dynamic CSS property values (D-108).
 * Decodes escape sequences to check for delimiter injection (; or {}),
 * legacy script execution (expression/moz-binding), and dangerous url() schemes.
 */
export function validateCssPropertyValue(value: string): boolean {
  if (typeof value !== "string") return false;
  const decoded = decodeCssEscapes(value);

  // 1. Check for braces
  if (/[{}]/.test(decoded)) return false;

  // 2. Check for dangerous script execution functions
  if (/expression\s*\(/i.test(decoded) || /-moz-binding\s*:/i.test(decoded)) {
    return false;
  }

  // 3. Validate all url(...) declarations
  const urlRegex = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")]+))\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(decoded)) !== null) {
    const rawUrl = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!isSafeUrl(rawUrl)) {
      return false;
    }
  }

  // 4. Check for unquoted semicolons outside of quotes and url(...)
  const strippedUrls = decoded.replace(/url\(\s*(?:'[^']*'|"[^"]*"|[^'")]+)\s*\)/gi, "url(__safe__)");

  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < strippedUrls.length; i++) {
    const ch = strippedUrls[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (ch === ";" && !inSingleQuote && !inDoubleQuote) {
      return false;
    }
  }

  return true;
}

/**
 * Safely sets a style property on an element, throwing MixSecurityError on violations (D-108).
 */
export function setSafeStyleProperty(el: HTMLElement, property: string, value: string): void {
  if (!validateCssPropertyName(property)) {
    throw new MixSecurityError(`Invalid or unsafe CSS property name: "${property}"`);
  }
  if (!validateCssPropertyValue(value)) {
    throw new MixSecurityError(`Unsafe CSS property value detected for property "${property}": "${value}"`);
  }
  el.style.setProperty(property, value);
}

// --- 7. Keyed List Reconciliation Algorithm (D-110) ---

export interface KeyedEntry<T> {
  key: unknown;
  owner: Owner;
  element: Node;
  itemSignal: Signal<T>;
  indexSignal: Signal<number>;
}

/**
 * Reconciles dynamic list items with deterministic duplicate-key handling (D-110):
 * - First key wins; duplicates emit warning and are cleanly disposed.
 * - Atomic batching: DOM commits happen together without partial reactive leaks.
 */
export function reconcileKeyed<T>(
  parentElement: Element,
  anchor: Node,
  items: T[],
  keyFn: (item: T, index: number) => unknown,
  renderFn: (itemSignal: Signal<T>, indexSignal: Signal<number>, owner: Owner) => Node
): void {
  batch(() => {
    const oldEntries: Map<unknown, KeyedEntry<T>> =
      (parentElement as unknown as { __mix_keyed_map?: Map<unknown, KeyedEntry<T>> }).__mix_keyed_map ?? new Map();
    const newEntries = new Map<unknown, KeyedEntry<T>>();
    const seenKeys = new Set<unknown>();

    for (let index = 0; index < items.length; index++) {
      const item = items[index]!;
      const key = keyFn(item, index);

      // Duplicate-key detection (D-110)
      if (seenKeys.has(key)) {
        console.warn(`[MIX_ERR_DUPLICATE_KEY] Duplicate key encountered during reconciliation: "${String(key)}"`);
        continue; // First occurrence wins; duplicate is omitted and not rendered
      }
      seenKeys.add(key);

      const existing = oldEntries.get(key);
      if (existing) {
        // Reuse existing entry
        existing.itemSignal.set(() => item);
        existing.indexSignal.set(index);
        newEntries.set(key, existing);
        oldEntries.delete(key);
      } else {
        // Create new child owner and entry
        const itemSignal: Signal<T> = signal<T>(item);
        const indexSignal = signal(index);
        let domNode!: Node;

        const entryOwner = new Owner(activeOwner);
        const prevOwner = activeOwner;
        activeOwner = entryOwner;

        try {
          domNode = renderFn(itemSignal, indexSignal, entryOwner);
        } finally {
          activeOwner = prevOwner;
        }

        newEntries.set(key, {
          key,
          owner: entryOwner,
          element: domNode,
          itemSignal,
          indexSignal
        });
      }
    }

    // Fast path: clear all items
    if (newEntries.size === 0) {
      for (const [_, removed] of oldEntries) {
        removed.owner.dispose();
      }
      while (parentElement.firstChild && parentElement.firstChild !== anchor) {
        parentElement.removeChild(parentElement.firstChild);
      }
      (parentElement as unknown as { __mix_keyed_map: Map<unknown, KeyedEntry<T>> }).__mix_keyed_map = newEntries;
      return;
    }

    // Clean up removed items (D-110: recursive owner disposal)
    for (const [_, removed] of oldEntries) {
      removed.owner.dispose();
      if (removed.element.parentNode === parentElement) {
        parentElement.removeChild(removed.element);
      }
    }

    // Position new entries in order with minimal DOM mutations
    let cursor: Node | null = parentElement.firstChild;
    for (const [_, entry] of newEntries) {
      if (entry.element !== cursor) {
        if (cursor && cursor.nextSibling === entry.element) {
          cursor = entry.element;
        } else {
          parentElement.insertBefore(entry.element, cursor);
        }
      }
      cursor = cursor ? cursor.nextSibling : null;
    }

    (parentElement as unknown as { __mix_keyed_map: Map<unknown, KeyedEntry<T>> }).__mix_keyed_map = newEntries;
  });
}

// --- 8. Direct DOM Adapter ---

export function createElement(tagName: string): HTMLElement {
  return document.createElement(tagName);
}

export function createTextNode(text: string): Text {
  return document.createTextNode(text);
}

export function setTextContent(node: Node, text: string): void {
  node.textContent = text;
}

export function setAttribute(el: Element, name: string, value: string): void {
  el.setAttribute(name, value);
}

export function removeAttribute(el: Element, name: string): void {
  el.removeAttribute(name);
}

export function setStyleProperty(el: HTMLElement, name: string, value: string): void {
  setSafeStyleProperty(el, name, value);
}

export function appendChild(parent: Element, child: Node): void {
  parent.appendChild(child);
}

export function insertBefore(parent: Element, child: Node, before: Node | null): void {
  parent.insertBefore(child, before);
}

export function removeChild(parent: Element, child: Node): void {
  parent.removeChild(child);
}

export function addEventListener(
  el: Element,
  event: string,
  handler: (e: Event) => void
): () => void {
  el.addEventListener(event, handler);
  return () => el.removeEventListener(event, handler);
}

// --- 9. HMR Stable Scope Method Replacement (D-111) ---

export interface ComponentInstance {
  readonly __scope: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Applies an HMR update to an active component instance by updating methods
 * on the instance's stable __scope without unmounting DOM elements or resetting
 * live reactive signal state (D-111).
 */
export function applyHmrUpdate(
  instance: ComponentInstance,
  updatedFactoryOrMethods: ((...args: unknown[]) => ComponentInstance) | Record<string, unknown>
): void {
  if (!instance || !instance.__scope) return;

  const methodsToApply: Record<string, unknown> = {};

  if (typeof updatedFactoryOrMethods === "function") {
    const dummyInstance = updatedFactoryOrMethods({}, null);
    if (dummyInstance && dummyInstance.__scope) {
      for (const key of Object.keys(dummyInstance.__scope)) {
        const val = dummyInstance.__scope[key];
        // Only swap methods; preserve reactive signals and state (D-111)
        if (typeof val === "function" && !("set" in val)) {
          methodsToApply[key] = val;
        }
      }
    }
  } else if (typeof updatedFactoryOrMethods === "object" && updatedFactoryOrMethods !== null) {
    Object.assign(methodsToApply, updatedFactoryOrMethods);
  }

  for (const [name, fn] of Object.entries(methodsToApply)) {
    if (typeof fn === "function" && !("set" in fn)) {
      instance.__scope[name] = fn;
      (instance as Record<string, unknown>)[name] = fn;
    }
  }
}
