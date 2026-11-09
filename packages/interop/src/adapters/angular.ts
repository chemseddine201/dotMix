/**
 * @mix/interop — Angular 18+ Signal Adapter & Component Bridge
 */

import { mountMixInContainer } from "./react.js";
import type { MixComponent } from "../types.js";

/**
 * Creates an Angular-compatible Component class wrapper for Mix / Tix components.
 */
export function asAngularComponent<P extends Record<string, unknown>>(
  Component: MixComponent<P>
): new (elementRef: { nativeElement: HTMLElement }) => {
  ngOnInit(): void;
  ngOnChanges(changes: Record<string, { currentValue: unknown }>): void;
  ngOnDestroy(): void;
} {
  return class MixAngularBridge {
    private bridge: { update: (p: P) => void; unmount: () => void } | null = null;
    private elementRef: { nativeElement: HTMLElement };
    public props: P = {} as P;

    constructor(elementRef: { nativeElement: HTMLElement }) {
      this.elementRef = elementRef;
    }

    ngOnInit(): void {
      this.bridge = mountMixInContainer(this.elementRef.nativeElement, Component, this.props);
    }

    ngOnChanges(changes: Record<string, { currentValue: unknown }>): void {
      for (const [key, change] of Object.entries(changes)) {
        this.props[key as keyof P] = change.currentValue as P[keyof P];
      }
      if (this.bridge) {
        this.bridge.update(this.props);
      }
    }

    ngOnDestroy(): void {
      if (this.bridge) {
        this.bridge.unmount();
        this.bridge = null;
      }
    }
  };
}

