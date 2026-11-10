/**
 * mix-helpers/async — Async Control-Flow, Concurrency Limiting & Retry Primitives
 *
 * 100% zero external dependencies. Integrated with CancellationToken.
 */

import type { CancellationToken } from "@mix/runtime";

export function sleep(ms: number, cancelToken?: CancellationToken): Promise<void> {
  return new Promise((resolve, reject) => {
    if (cancelToken?.isCancelled) {
      return reject(new Error("Operation cancelled"));
    }
    let unbind = (): void => {};
    const timer = setTimeout(() => {
      if (cancelToken) unbind();
      resolve();
    }, ms);

    if (cancelToken) {
      unbind = cancelToken.onCancelled(() => {
        clearTimeout(timer);
        reject(new Error("Operation cancelled"));
      });
    }
  });
}

export async function timeout<T>(
  promiseOrFn: Promise<T> | (() => Promise<T>),
  ms: number,
  message = "Operation timed out"
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  const targetPromise = typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn;
  try {
    return await Promise.race([targetPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  status: () => "pending" | "resolved" | "rejected";
}

export function defer<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  let state: "pending" | "resolved" | "rejected" = "pending";

  const promise = new Promise<T>((res, rej) => {
    resolve = (val) => {
      state = "resolved";
      res(val);
    };
    reject = (err) => {
      state = "rejected";
      rej(err);
    };
  });

  return { promise, resolve, reject, status: () => state };
}

export async function parallel<T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency?: number
): Promise<T[]> {
  if (!concurrency || concurrency >= tasks.length) {
    return Promise.all(tasks.map((task) => task()));
  }

  const results: T[] = new Array<T>(tasks.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]!();
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function series<T>(tasks: readonly (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  for (const task of tasks) {
    results.push(await task());
  }
  return results;
}

export async function waterfall<T = unknown>(
  tasks: readonly ((arg: unknown) => Promise<unknown>)[],
  initialValue?: unknown
): Promise<T> {
  let current: unknown = initialValue;
  for (const task of tasks) {
    current = await task(current);
  }
  return current as T;
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  iteratee: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const tasks = items.map((item, idx) => () => iteratee(item, idx));
  return parallel(tasks, limit);
}

export async function filterLimit<T>(
  items: readonly T[],
  limit: number,
  predicate: (item: T, index: number) => Promise<boolean>
): Promise<T[]> {
  const flags = await mapLimit(items, limit, predicate);
  return items.filter((_, idx) => flags[idx]);
}

export async function forEachLimit<T>(
  items: readonly T[],
  limit: number,
  iteratee: (item: T, index: number) => Promise<void>
): Promise<void> {
  await mapLimit(items, limit, iteratee);
}

export function race<T>(promises: readonly Promise<T>[]): Promise<T> {
  return Promise.race(promises);
}

export function allSettled<T>(promises: readonly Promise<T>[]): Promise<PromiseSettledResult<T>[]> {
  return Promise.allSettled(promises);
}

export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  shouldRetry?: (error: unknown) => boolean;
  cancelToken?: CancellationToken;
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const maxRetries = options.retries ?? 3;
  const baseDelay = options.delayMs ?? 100;
  const factor = options.factor ?? 2;
  const maxDelay = options.maxDelayMs ?? 10000;

  let attempt = 0;
  while (true) {
    if (options.cancelToken?.isCancelled) {
      throw new Error("Operation cancelled");
    }
    attempt++;
    try {
      return await fn();
    } catch (err: unknown) {
      if (attempt > maxRetries) throw err;
      if (options.shouldRetry && !options.shouldRetry(err)) throw err;

      let delay = Math.min(baseDelay * Math.pow(factor, attempt - 1), maxDelay);
      if (options.jitter) {
        delay = delay * (0.5 + Math.random() * 0.5);
      }
      await sleep(delay, options.cancelToken);
    }
  }
}
