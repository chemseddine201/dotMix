// packages/runtime/src/typecheck/index.d.ts — FROZEN per MIX_SPEC_v3.2.2 §5.1
import type { RefTarget, ComponentFactory } from "../types.js";

export type ComponentTypeContract<T> = T;

/** Checks that the element can be assigned to the ref target. T inferred from ref alone. */
export declare function VerifyRef<T>(ref: RefTarget<T>, element: NoInfer<T>): void;
export declare function ElementOf<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K];
export declare function SvgElementOf<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K];
export declare function AnyElement(): Element;

/** Infers P from comp alone, enabling excess property checks on fresh literal. */
export declare function VerifyProps<P>(comp: ComponentFactory<P, any, any>, props: NoInfer<P>): void;
