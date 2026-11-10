/**
 * @mix/runtime/forms/types — Types and interfaces for reactive form controllers and validation (D-124).
 */

import type { CancellationToken } from "../core/index.js";

export type ValidatorFn<T = unknown> = (value: T) => string | null | undefined;
export type SyncValidator<T = unknown> = ValidatorFn<T>;

export type AsyncValidatorFn<T = unknown> = (
  value: T,
  token: CancellationToken
) => Promise<string | null | undefined>;
export type AsyncValidator<T = unknown> = AsyncValidatorFn<T>;

export interface FieldConfig<T = unknown> {
  initialValue: T;
  validators?: ValidatorFn<T> | Array<ValidatorFn<T>>;
  asyncValidators?: AsyncValidatorFn<T> | Array<AsyncValidatorFn<T>>;
}

export interface FieldController<T = unknown> {
  readonly value: () => T;
  readonly error: () => string | null;
  readonly touched: () => boolean;
  readonly dirty: () => boolean;
  readonly validating: () => boolean;
  setValue(val: T | ((prev: T) => T)): void;
  blur(): void;
  reset(): void;
}

export type FieldState<T = unknown> = FieldController<T>;

export interface FormConfig<T extends object = Record<string, unknown>> {
  initialValues: T;
  validators?: {
    [K in keyof T]?: ValidatorFn<T[K]> | Array<ValidatorFn<T[K]>>;
  };
  asyncValidators?: {
    [K in keyof T]?: AsyncValidatorFn<T[K]> | Array<AsyncValidatorFn<T[K]>>;
  };
  onSubmit?: (values: T) => Promise<void> | void;
}

export interface FormController<T extends object = Record<string, unknown>> {
  field<K extends keyof T>(name: K): FieldController<T[K]>;
  readonly fields: { readonly [K in keyof T]: FieldController<T[K]> };
  readonly values: () => T;
  readonly errors: () => Record<keyof T, string | null>;
  readonly isValid: () => boolean;
  readonly isDirty: () => boolean;
  readonly isSubmitting: () => boolean;
  setValues(values: Partial<T>): void;
  reset(): void;
  handleSubmit(e?: { preventDefault?: () => void }): Promise<boolean>;
}

export type FormState<T extends object = Record<string, unknown>> = FormController<T>;
