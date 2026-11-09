/**
 * @mix/interop — Type definitions for Universal Polyglot Component ABI (Gate 17 / D-120)
 */

export interface TC39Signal<T> {
  get(): T;
  set?(value: T): void;
  subscribe?(callback: () => void): () => void;
  readonly [Symbol.toStringTag]?: string;
}

export interface SignalRef<T> {
  value: T;
  peek(): T;
  subscribe(fn: (val: T) => void): () => void;
}

export type MixComponent<P = Record<string, unknown>> = (
  props?: P,
  children?: unknown
) => Node | readonly Node[] | DocumentFragment;

export interface CustomElementOptions {
  observedProps?: string[];
  contextForwarding?: boolean;
  shadow?: boolean; // Defaults to false (Light-DOM for CSS and theme inheritance)
}

export interface ReactComponentAdapterOptions {
  asContainer?: string;
  className?: string;
  forwardContext?: boolean;
}
