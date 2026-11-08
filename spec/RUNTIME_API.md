# Runtime API Specification — Mix & Tix

**Status:** Canonical Runtime API Specification (Reconciled Phase 1)  
**Package:** `@mix/runtime`

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

`@mix/runtime` defines cancellation without leaking browser DOM types (`AbortSignal`) into core:

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
- The DOM adapter provides a bridge: `createAbortSignal(token: CancellationToken): AbortSignal`.

---

## 4. Trusted HTML Sanitizer Contract (D-109)

```ts
export interface SanitizerContext {
  element?: string;
  attribute?: string;
}

export interface SanitizerProvider {
  sanitizeHtml(raw: string, context?: SanitizerContext): string;
}

export function setSanitizerProvider(provider: SanitizerProvider): void;
export function getSanitizerProvider(): SanitizerProvider | null;
```

- Invoking an unescaped HTML sink (`mix-html`) without an active `SanitizerProvider` throws a runtime `MixSecurityError`.

---

## 5. Renderer Adapter Contract

To ensure `@mix/runtime` is platform-neutral and supports both browser DOM and future adapters (such as SSR):

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
