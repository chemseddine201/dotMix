/**
 * @mix/interop — Light-DOM Custom Element Generator with Complex Prop Reflection
 */

import { mount, signal, type Signal } from "@mix/runtime";
import type { CustomElementOptions, MixComponent } from "../types.js";

/**
 * Registers a standard Custom Element that mounts a Mix / Tix component.
 *
 * Defaults to Light-DOM (shadow: false) to ensure full style, typography,
 * and design system (Tailwind, Bootstrap) inheritance without Shadow DOM barriers.
 */
export function defineMixCustomElement<P extends Record<string, unknown> = Record<string, unknown>>(
  tagName: string,
  Component: MixComponent<P>,
  options: CustomElementOptions = {}
): typeof HTMLElement {
  if (typeof customElements === "undefined") {
    // SSR or Node environment fallback
    return class {} as unknown as typeof HTMLElement;
  }

  if (customElements.get(tagName)) {
    return customElements.get(tagName) as typeof HTMLElement;
  }

  const observedProps = options.observedProps ?? [];

  class MixCustomElement extends HTMLElement {
    private mountHandle: { unmount: () => void } | null = null;
    private propSignals = new Map<string, Signal<unknown>>();
    private rawProps: Record<string, unknown> = {};

    static get observedAttributes(): string[] {
      return observedProps.map((p) => p.toLowerCase());
    }

    constructor() {
      super();
      // Initialize dynamic getter/setters on this element instance for observed props
      for (const propName of observedProps) {
        let sig = this.propSignals.get(propName);
        if (!sig) {
          sig = signal<unknown>(undefined);
          this.propSignals.set(propName, sig);
        }
        Object.defineProperty(this, propName, {
          get: () => {
            const currentSig = this.propSignals.get(propName);
            return currentSig ? currentSig() : this.rawProps[propName];
          },
          set: (val: unknown) => {
            this.rawProps[propName] = val;
            const currentSig = this.propSignals.get(propName);
            if (currentSig) {
              currentSig.set(val);
            }
          },
          configurable: true,
          enumerable: true
        });
      }
    }

    connectedCallback(): void {
      if (this.mountHandle) return;

      const targetRoot: Node = options.shadow ? this.attachShadow({ mode: "open" }) : this;

      // Build reactive proxy props object for Mix component
      const reactiveProps = new Proxy({} as P, {
        get: (_target, propKey: string | symbol) => {
          if (typeof propKey === "string") {
            const sig = this.propSignals.get(propKey);
            if (sig) return sig();
            return this.rawProps[propKey];
          }
          return undefined;
        },
        set: (_target, propKey: string | symbol, value: unknown) => {
          if (typeof propKey === "string") {
            this.rawProps[propKey] = value;
            const sig = this.propSignals.get(propKey);
            if (sig) sig.set(value);
            return true;
          }
          return false;
        }
      });

      this.mountHandle = mount(
        () => Component(reactiveProps) as unknown as Node | readonly Node[],
        targetRoot as HTMLElement
      );
    }

    disconnectedCallback(): void {
      if (this.mountHandle) {
        this.mountHandle.unmount();
        this.mountHandle = null;
      }
    }

    attributeChangedCallback(name: string, _oldVal: string | null, newVal: string | null): void {
      // Find matching prop name case-insensitively
      const matchingProp = observedProps.find((p) => p.toLowerCase() === name.toLowerCase()) ?? name;
      let parsedValue: unknown = newVal;
      if (newVal === "true") parsedValue = true;
      else if (newVal === "false") parsedValue = false;
      else if (newVal !== null && !isNaN(Number(newVal)) && newVal.trim() !== "") parsedValue = Number(newVal);

      this.rawProps[matchingProp] = parsedValue;
      const sig = this.propSignals.get(matchingProp);
      if (sig) {
        sig.set(parsedValue);
      }
    }
  }

  customElements.define(tagName, MixCustomElement);
  return MixCustomElement;
}
