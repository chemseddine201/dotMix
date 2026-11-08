/**
 * @mix/runtime/typecheck — Type helper contracts for virtual .tix TypeScript projection.
 */

export type RefTarget<T> = {
  current: T | null;
};

export type VerifyProps<P, Input extends P> = Input;

export type VerifyRef<T, Target extends T> = Target;
