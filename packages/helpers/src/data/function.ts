/**
 * mix-helpers/data — Function Control-Flow, Memoization, Currying & Composition
 */

export interface DebouncedFunction<F extends (...args: never[]) => unknown> {
  (...args: Parameters<F>): void;
  cancel(): void;
  flush(): void;
  pending(): boolean;
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => unknown,
  waitMs: number,
  options: { leading?: boolean; trailing?: boolean; maxWait?: number } = {}
): DebouncedFunction<(...args: Args) => unknown> {
  const leading = options.leading ?? false;
  const trailing = options.trailing ?? true;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Args | null = null;
  let lastCallTime: number | null = null;

  function invoke(): void {
    if (lastArgs) {
      fn(...lastArgs);
      lastArgs = null;
    }
    timerId = null;
  }

  const debounced = function (...args: Args): void {
    lastArgs = args;
    const now = Date.now();
    const isFirstCall = lastCallTime === null;
    lastCallTime = now;

    if (isFirstCall && leading) {
      invoke();
      return;
    }

    if (timerId !== null) {
      clearTimeout(timerId);
    }

    timerId = setTimeout(() => {
      if (trailing) {
        invoke();
      } else {
        lastArgs = null;
        timerId = null;
      }
    }, waitMs);
  };

  debounced.cancel = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
    lastArgs = null;
    lastCallTime = null;
  };

  debounced.flush = (): void => {
    if (timerId !== null) {
      clearTimeout(timerId);
      invoke();
    }
  };

  debounced.pending = (): boolean => timerId !== null;

  return debounced;
}

export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => unknown,
  waitMs: number,
  options: { leading?: boolean; trailing?: boolean } = {}
): DebouncedFunction<(...args: Args) => unknown> {
  return debounce(fn, waitMs, {
    leading: options.leading ?? true,
    trailing: options.trailing ?? true,
    maxWait: waitMs,
  });
}

export function once<Args extends unknown[], R>(
  fn: (...args: Args) => R
): (...args: Args) => R {
  let called = false;
  let result: R;
  return function (...args: Args): R {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}

export function memoize<Args extends unknown[], R>(
  fn: (...args: Args) => R,
  resolver?: (...args: Args) => unknown
): ((...args: Args) => R) & { cache: Map<unknown, R> } {
  const cache = new Map<unknown, R>();
  const memoized = function (...args: Args): R {
    const key = resolver ? resolver(...args) : args[0];
    if (cache.has(key)) {
      return cache.get(key)!;
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
  memoized.cache = cache;
  return memoized;
}

export function curry(
  fn: (...args: unknown[]) => unknown,
  arity = fn.length
): (...args: unknown[]) => unknown {
  function curried(...collected: unknown[]): unknown {
    if (collected.length >= arity) {
      return fn(...collected);
    }
    return (...more: unknown[]) => curried(...collected, ...more);
  }
  return curried;
}

export function pipe<T = unknown>(...fns: Array<(arg: T) => unknown>): (input: T) => unknown {
  return (input: T) => fns.reduce<unknown>((acc, fn) => fn(acc as T), input);
}

export function compose<T = unknown>(...fns: Array<(arg: T) => unknown>): (input: T) => unknown {
  return (input: T) => fns.reduceRight<unknown>((acc, fn) => fn(acc as T), input);
}
