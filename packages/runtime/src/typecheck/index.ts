/**
 * @mix/runtime/typecheck — Type helper contracts for virtual .tix TypeScript projection (D-106, R-TC-01..03).
 */

export interface RefTarget<T> {
  current: T | null;
}

export type ComponentFactory<P = Record<string, unknown>, R = unknown> = (
  props: P,
  children?: unknown
) => R;

export type ComponentTypeContract<T> = T;

/**
 * Verifies that an element assigned to a ref is assignable to RefTarget<T>.
 * Uses NoInfer<T> (R-TC-01, R-TC-03) so T is inferred strictly from the ref declaration.
 */
export function VerifyRef<T>(_ref: RefTarget<T>, _element: NoInfer<T>): void {
  // Compile-time type verification helper only
}

/**
 * Verifies that props passed to a component match its contract P.
 * Uses NoInfer<P> (R-TC-02, R-TC-03) so excess/misspelled property checks fire on fresh object literals.
 */
export function VerifyProps<P>(
  _comp: ComponentFactory<P, unknown> | ((props: P) => unknown),
  _props: NoInfer<P>
): void {
  // Compile-time type verification helper only
}

export function ElementOf<K extends keyof HTMLElementTagNameMap>(
  _tag: K
): HTMLElementTagNameMap[K] {
  return undefined as unknown as HTMLElementTagNameMap[K];
}

export function SvgElementOf<K extends keyof SVGElementTagNameMap>(
  _tag: K
): SVGElementTagNameMap[K] {
  return undefined as unknown as SVGElementTagNameMap[K];
}

export function AnyElement(): Element {
  return undefined as unknown as Element;
}
