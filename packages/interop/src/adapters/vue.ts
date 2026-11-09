/**
 * @mix/interop — Vue 3.5+ Component Adapter & Ref Bridge
 */

import { mountMixInContainer } from "./react.js";
import type { MixComponent } from "../types.js";

/**
 * Creates a Vue 3 component definition object wrapping a Mix / Tix component.
 */
export function asVueComponent<P extends Record<string, unknown>>(
  Component: MixComponent<P>
): {
  name: string;
  props?: string[];
  mounted(this: { $el: HTMLElement; $props: P; _mixBridge?: { update: (p: P) => void; unmount: () => void } | undefined }): void;
  updated(this: { $props: P; _mixBridge?: { update: (p: P) => void } | undefined }): void;
  unmounted(this: { _mixBridge?: { unmount: () => void } | undefined }): void;
  render(h: unknown): unknown;
} {
  return {
    name: "MixVueBridge",
    mounted() {
      this._mixBridge = mountMixInContainer(this.$el, Component, this.$props);
    },
    updated() {
      if (this._mixBridge) {
        this._mixBridge.update(this.$props);
      }
    },
    unmounted() {
      if (this._mixBridge) {
        this._mixBridge.unmount();
        this._mixBridge = undefined;
      }
    },
    render(h: unknown) {
      if (typeof h === "function") {
        return (h as (tag: string) => unknown)("div");
      }
      return null;
    }
  };
}
