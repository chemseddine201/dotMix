# Runtime API Specification — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Runtime API Specification (Reconciled Phase Gate 1)  
**Package:** `@mix/runtime`  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Reactive Core Primitives

```ts
// Signals
export interface Signal<T> {
  (): T;
  set(nextValue: T | ((prev: T) => T)): T;
}
export function signal<T>(initialValue: T): Signal<T>;

// Computed (Memos)
export interface Computed<T> {
  (): T;
}
export function computed<T>(fn: () => T): Computed<T>;

// Effects
export function createEffect(fn: () => void | (() => void)): void;

// Batching
export function batch<T>(fn: () => T): T;

// Lifecycle & Cleanups
export function onCleanup(fn: () => void): void;
```

---

## 2. Root Creation & `detachedParent` (D-103)

```ts
export function createRoot<T>(
  fn: (dispose: () => void) => T,
  detachedParent?: Owner | null
): T;
```

- **Teardown Contract:** `createRoot` provides an explicit teardown callback `dispose: () => void` to the factory function.
- **`detachedParent` Contract:**
  - When `detachedParent` is supplied, the new root inherits context lookup and diagnostics linkage from `detachedParent`.
  - The new root's lifecycle is **not** tied to `detachedParent`'s automatic child disposal. The root must be disposed explicitly via its `dispose()` callback.

---

## 3. Platform-Neutral Cancellation & Generation Tokens (D-104)

`@mix/runtime/core` defines cancellation without leaking browser DOM types (`AbortSignal`, `AbortController`) into core:

```ts
export interface CancellationToken {
  readonly isCancelled: boolean;
  readonly generation: number;
  onCancelled(callback: () => void): void;
}

export interface ResourceRequest<T> {
  token: CancellationToken;
  promise: Promise<T>;
}
```

- When an owner is disposed, its active `CancellationToken` instances are marked `isCancelled = true`.
- Async resources compare their initial `generation` against the current generation upon resolution, discarding stale responses.
- The platform adapter module (`@mix/runtime/platform`) bridges pure cancellation tokens to DOM APIs: `toAbortSignal(token: CancellationToken): AbortSignal`.

---

## 4. Trusted HTML Security Boundary & Sanitizer Provider (D-109 / HAA-03)

To prevent arbitrary script injection via `mix-html` directives:

```ts
export interface SanitizerContext {
  element?: string;
  attribute?: string;
}

export interface SanitizerProvider {
  sanitizeHtml(raw: string, context?: SanitizerContext): string;
}

export function setSanitizerProvider(provider: SanitizerProvider | null): void;
export function getSanitizerProvider(): SanitizerProvider | null;

export function createTrustedHtml(dirtyHtml: string): object;
```

### Security Rules (HAA-03):
1. **Application Authority:** The security authority is configured at application startup via `setSanitizerProvider(provider)`.
2. **No Caller Sanitizers:** The function `createTrustedHtml(dirtyHtml)` does **not** accept an arbitrary caller-supplied sanitizer callback. It strictly invokes the configured `SanitizerProvider` (or native W3C `window.trustedTypes` policy).
3. **Private Registry:** Authentic instances returned by `createTrustedHtml` are recorded in a module-private `WeakSet<object>`.
4. **Sink Verification:** DOM `innerHTML` insertion sinks accept only instances verified to exist within the private `WeakSet`. Raw strings or unverified objects throw `MixError` (`MIX_SEC_FOREIGN_TRUSTED_HTML`).

---

## 5. Renderer Adapter Contract

To ensure `@mix/runtime` is platform-neutral:

```ts
export interface RendererAdapter<TNode = unknown, TElement = TNode> {
  createElement(tag: string): TElement;
  createTextNode(text: string): TNode;
  setTextContent(node: TNode, text: string): void;
  setAttribute(el: TElement, name: string, value: string): void;
  removeAttribute(el: TElement, name: string): void;
  setStyleProperty(el: TElement, name: string, value: string): void;
  appendChild(parent: TElement, child: TNode): void;
  insertBefore(parent: TElement, child: TNode, before: TNode | null): void;
  removeChild(parent: TElement, child: TNode): void;
  addEventListener(el: TElement, event: string, handler: (e: unknown) => void): () => void;
}
```

---

## 6. Zero-Dependency Boundary (HAA-04)

`@mix/runtime` declares `"dependencies": {}`. Diagnostic error types are referenced via `import type` only from `@mix/diagnostics`, completely erased by `tsc -b` at compile time via `"verbatimModuleSyntax": true`. `@mix/runtime` defines its own self-contained runtime `MixError` and diagnostic code constants, requiring **zero bundler** and zero external npm packages.
