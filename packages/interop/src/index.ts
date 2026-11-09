/**
 * @mix/interop — Universal Polyglot Component ABI (Gate 17 / D-120)
 *
 * Bridges Mix/Tix compiler-native components and reactive signals directly into:
 * - TC39 Signals Standard
 * - React 19 / Next.js trees without Virtual DOM diffing overhead
 * - Vue 3.5+ components and refs
 * - Angular 18+ components and signals
 * - Zero-barrier Light-DOM Custom Elements with complex prop reflection
 */

export * from "./types.js";
export * from "./signals/tc39.js";
export * from "./elements/customElement.js";
export * from "./adapters/react.js";
export * from "./adapters/vue.js";
export * from "./adapters/angular.js";
