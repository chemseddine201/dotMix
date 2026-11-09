/**
 * @mix/runtime/forms — Signal-backed reactive form controller & validation engine
 *
 * Implements Phase Gate 21 / Decision D-124.
 */

import {
  signal,
  createMemo,
  createCancellationSource,
  onCleanup,
  getCurrentOwner,
  type CancellationToken,
  type CancellationSource
} from "../core/index.js";

export type ValidatorFn<T = unknown> = (value: T) => string | null | undefined;
export type AsyncValidatorFn<T = unknown> = (
  value: T,
  token: CancellationToken
) => Promise<string | null | undefined>;

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

export const validators = {
  required(message = "This field is required"): ValidatorFn<unknown> {
    return (val) => {
      if (
        val === null ||
        val === undefined ||
        val === "" ||
        (Array.isArray(val) && val.length === 0)
      ) {
        return message;
      }
      return null;
    };
  },

  minLength(min: number, message?: string): ValidatorFn<unknown> {
    return (val) => {
      if (val && typeof (val as { length?: number }).length === "number") {
        if ((val as { length: number }).length < min) {
          return message || `Must be at least ${min} characters`;
        }
      }
      return null;
    };
  },

  maxLength(max: number, message?: string): ValidatorFn<unknown> {
    return (val) => {
      if (val && typeof (val as { length?: number }).length === "number") {
        if ((val as { length: number }).length > max) {
          return message || `Must be at most ${max} characters`;
        }
      }
      return null;
    };
  },

  pattern(regex: RegExp, message = "Invalid format"): ValidatorFn<unknown> {
    return (val) => {
      if (val !== null && val !== undefined && val !== "" && !regex.test(String(val))) {
        return message;
      }
      return null;
    };
  },

  email(message = "Invalid email address"): ValidatorFn<unknown> {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return (val) => {
      if (val !== null && val !== undefined && val !== "" && !emailRegex.test(String(val))) {
        return message;
      }
      return null;
    };
  }
};

export function createForm<T extends object = Record<string, unknown>>(
  config: FormConfig<T>
): FormController<T> {
  const initialValues = { ...config.initialValues };
  const fieldNames = Object.keys(initialValues) as Array<keyof T>;

  interface InternalFieldState<V> {
    valueSig: ReturnType<typeof signal<V>>;
    errorSig: ReturnType<typeof signal<string | null>>;
    touchedSig: ReturnType<typeof signal<boolean>>;
    validatingSig: ReturnType<typeof signal<boolean>>;
    activeCancellation: CancellationSource | null;
    generation: number;
    initialVal: V;
  }

  const fields = new Map<keyof T, InternalFieldState<unknown>>();

  for (const name of fieldNames) {
    const initVal = initialValues[name];
    fields.set(name, {
      valueSig: signal<unknown>(initVal),
      errorSig: signal<string | null>(null),
      touchedSig: signal<boolean>(false),
      validatingSig: signal<boolean>(false),
      activeCancellation: null,
      generation: 0,
      initialVal: initVal
    });
  }

  const isSubmittingSig = signal<boolean>(false);

  function runValidationForField<K extends keyof T>(name: K): void {
    const state = fields.get(name);
    if (!state) return;

    const val = state.valueSig() as T[K];

    // 1. Synchronous validators
    const syncValList = config.validators?.[name];
    if (syncValList) {
      const list = Array.isArray(syncValList) ? syncValList : [syncValList];
      for (const fn of list) {
        const err = fn(val);
        if (err) {
          state.errorSig.set(err);
          return;
        }
      }
    }

    // 2. Asynchronous validators
    const asyncValList = config.asyncValidators?.[name];
    if (asyncValList) {
      if (state.activeCancellation) {
        state.activeCancellation.cancel("MIX_FORM_SUPERSEDED");
        state.activeCancellation = null;
      }

      const myGen = ++state.generation;
      const cancelSource = createCancellationSource(null);
      state.activeCancellation = cancelSource;
      state.validatingSig.set(true);

      const list = Array.isArray(asyncValList) ? asyncValList : [asyncValList];

      void (async () => {
        try {
          for (const fn of list) {
            const err = await fn(val, cancelSource.token);
            if (cancelSource.token.isCancelled || state.generation !== myGen) {
              return;
            }
            if (err) {
              state.errorSig.set(err);
              state.validatingSig.set(false);
              return;
            }
          }
          if (!cancelSource.token.isCancelled && state.generation === myGen) {
            state.errorSig.set(null);
            state.validatingSig.set(false);
          }
        } catch (e) {
          if (!cancelSource.token.isCancelled && state.generation === myGen) {
            state.errorSig.set(String(e));
            state.validatingSig.set(false);
          }
        }
      })();
      return;
    }

    state.errorSig.set(null);
  }

  const fieldControllers = new Map<keyof T, FieldController<unknown>>();

  function getField<K extends keyof T>(name: K): FieldController<T[K]> {
    let ctrl = fieldControllers.get(name);
    if (!ctrl) {
      const state = fields.get(name);
      if (!state) {
        throw new Error(`[@mix/runtime/forms] Unknown field "${String(name)}"`);
      }

      ctrl = {
        value: () => state.valueSig() as T[K],
        error: () => state.errorSig(),
        touched: () => state.touchedSig(),
        dirty: () => state.valueSig() !== state.initialVal,
        validating: () => state.validatingSig(),
        setValue(valOrFn: unknown) {
          const next =
            typeof valOrFn === "function"
              ? (valOrFn as (prev: unknown) => unknown)(state.valueSig())
              : valOrFn;
          state.valueSig.set(next);
          runValidationForField(name);
        },
        blur() {
          state.touchedSig.set(true);
          runValidationForField(name);
        },
        reset() {
          if (state.activeCancellation) {
            state.activeCancellation.cancel("MIX_FORM_RESET");
            state.activeCancellation = null;
          }
          state.valueSig.set(state.initialVal);
          state.errorSig.set(null);
          state.touchedSig.set(false);
          state.validatingSig.set(false);
        }
      };
      fieldControllers.set(name, ctrl);
    }
    return ctrl as FieldController<T[K]>;
  }

  const valuesMemo = createMemo(() => {
    const res: Record<string, unknown> = {};
    for (const name of fieldNames) {
      res[name as string] = fields.get(name)!.valueSig();
    }
    return res as T;
  });

  const errorsMemo = createMemo(() => {
    const res: Record<string, string | null> = {};
    for (const name of fieldNames) {
      res[name as string] = fields.get(name)!.errorSig();
    }
    return res as Record<keyof T, string | null>;
  });

  const isValidMemo = createMemo(() => {
    for (const name of fieldNames) {
      const state = fields.get(name)!;
      if (state.errorSig() !== null || state.validatingSig()) {
        return false;
      }
    }
    return true;
  });

  const isDirtyMemo = createMemo(() => {
    for (const name of fieldNames) {
      const state = fields.get(name)!;
      if (state.valueSig() !== state.initialVal) {
        return true;
      }
    }
    return false;
  });

  if (getCurrentOwner()) {
    onCleanup(() => {
      for (const state of fields.values()) {
        if (state.activeCancellation) {
          state.activeCancellation.cancel("MIX_FORM_DISPOSED");
          state.activeCancellation = null;
        }
      }
    });
  }

  const fieldsProxy = new Proxy({} as { [K in keyof T]: FieldController<T[K]> }, {
    get(_target, prop: string | symbol) {
      if (typeof prop === "string") {
        return getField(prop as keyof T);
      }
      return undefined;
    }
  });

  return {
    field<K extends keyof T>(name: K): FieldController<T[K]> {
      return getField(name);
    },
    get fields(): { readonly [K in keyof T]: FieldController<T[K]> } {
      return fieldsProxy;
    },
    get values(): () => T {
      return valuesMemo;
    },
    get errors(): () => Record<keyof T, string | null> {
      return errorsMemo;
    },
    get isValid(): () => boolean {
      return isValidMemo;
    },
    get isDirty(): () => boolean {
      return isDirtyMemo;
    },
    get isSubmitting(): () => boolean {
      return isSubmittingSig;
    },
    setValues(newVals: Partial<T>): void {
      for (const [k, v] of Object.entries(newVals)) {
        const state = fields.get(k as keyof T);
        if (state) {
          state.valueSig.set(v);
          runValidationForField(k as keyof T);
        }
      }
    },
    reset(): void {
      for (const name of fieldNames) {
        getField(name).reset();
      }
      isSubmittingSig.set(false);
    },
    async handleSubmit(e?: { preventDefault?: () => void }): Promise<boolean> {
      if (e?.preventDefault) {
        e.preventDefault();
      }

      // Mark all fields touched and validate
      for (const name of fieldNames) {
        fields.get(name)!.touchedSig.set(true);
        runValidationForField(name);
      }

      // If any field is validating, wait for async validation
      const pending: Promise<void>[] = [];
      for (const name of fieldNames) {
        const state = fields.get(name)!;
        if (state.validatingSig()) {
          // Poll until validating is false
          pending.push(
            new Promise<void>((resolve) => {
              const check = () => {
                if (!state.validatingSig()) resolve();
                else if (typeof globalThis.setTimeout === "function") {
                  globalThis.setTimeout(check, 10);
                } else {
                  resolve();
                }
              };
              check();
            })
          );
        }
      }
      if (pending.length > 0) {
        await Promise.all(pending);
      }

      if (!isValidMemo()) {
        return false;
      }

      if (config.onSubmit) {
        isSubmittingSig.set(true);
        try {
          await config.onSubmit(valuesMemo());
          return true;
        } finally {
          isSubmittingSig.set(false);
        }
      }

      return true;
    }
  };
}

