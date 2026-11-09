/**
 * @mix/interop — React 19 / Next.js Adapter Bridge
 */

import { mount, signal, type Signal } from "@mix/runtime";
import type { MixComponent, ReactComponentAdapterOptions } from "../types.js";

export interface ReactRefObject<T> {
  current: T | null;
}

/**
 * Low-level React hook logic implemented without hard runtime dependencies on react.js.
 * Duck-types React's ref and lifecycle hooks if React is in scope, or provides direct DOM mounting.
 */
export function mountMixInContainer<P extends Record<string, unknown>>(
  container: HTMLElement,
  Component: MixComponent<P>,
  props: P
): { update: (newProps: P) => void; unmount: () => void } {
  const propSignals = new Map<string, Signal<unknown>>();
  const rawProps = { ...props };

  for (const [k, v] of Object.entries(props)) {
    propSignals.set(k, signal(v));
  }

  const reactiveProps = new Proxy({} as P, {
    get: (_target, propKey: string | symbol) => {
      if (typeof propKey === "string") {
        const sig = propSignals.get(propKey);
        if (sig) return sig();
        return rawProps[propKey as keyof P];
      }
      return undefined;
    }
  });

  const handle = mount(
    () => Component(reactiveProps) as unknown as Node | readonly Node[],
    container
  );

  return {
    update(newProps: P) {
      for (const [k, v] of Object.entries(newProps)) {
        rawProps[k as keyof P] = v as P[keyof P];
        let sig = propSignals.get(k);
        if (!sig) {
          sig = signal(v);
          propSignals.set(k, sig);
        } else {
          sig.set(v);
        }
      }
    },
    unmount() {
      handle.unmount();
    }
  };
}

/**
 * Exports a standard React component that renders a surgical Mix component.
 *
 * Compatible with React 18, React 19, and Next.js client component trees.
 */
export function asReactComponent<P extends Record<string, unknown>>(
  Component: MixComponent<P>,
  adapterOptions: ReactComponentAdapterOptions = {}
): (props: P & { className?: string; style?: Record<string, unknown> }) => unknown {
  const containerTag = adapterOptions.asContainer ?? "div";

  return function MixReactBridge(props: P & { className?: string; style?: Record<string, unknown> }) {
    // If React is present on global scope or caller
    const React = (globalThis as unknown as { React?: {
      createElement: (type: unknown, props: unknown) => unknown;
      useRef: <T>(init: T) => ReactRefObject<T>;
      useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
    } }).React;

    if (React && typeof React.useRef === "function" && typeof React.useEffect === "function") {
      const containerRef = React.useRef<HTMLElement | null>(null);
      const bridgeRef = React.useRef<{ update: (p: P) => void; unmount: () => void } | null>(null);

      React.useEffect(() => {
        if (containerRef.current && !bridgeRef.current) {
          bridgeRef.current = mountMixInContainer(containerRef.current, Component, props);
        }
        return () => {
          if (bridgeRef.current) {
            bridgeRef.current.unmount();
            bridgeRef.current = null;
          }
        };
      }, []);

      React.useEffect(() => {
        if (bridgeRef.current) {
          bridgeRef.current.update(props);
        }
      }, [props]);

      return React.createElement(containerTag, {
        ref: containerRef,
        className: props.className ?? adapterOptions.className,
        style: props.style
      });
    }

    // Direct DOM element creation if run outside a full React JSX runtime
    const el = typeof document !== "undefined" ? document.createElement(containerTag) : null;
    if (el) {
      mountMixInContainer(el, Component, props);
    }
    return el;
  };
}
