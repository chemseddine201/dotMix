/**
 * mix-helpers/async — dotMix Async Control-Flow & Concurrency Primitives (`asyncFlow`)
 *
 * 100% zero external dependencies. Integrated with CancellationToken.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { CancellationToken } from "@mix/runtime";

export function sleep(ms: number, cancelToken?: CancellationToken): Promise<void> {
  return new Promise((resolve, reject) => {
    if (cancelToken?.isCancelled) {
      return reject(new Error("Operation cancelled"));
    }
    const timer = setTimeout(() => {
      if (cancelToken) unbind();
      resolve();
    }, ms);

    let unbind = () => {};
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
  reject: (reason?: any) => void;
  status: () => "pending" | "resolved" | "rejected";
}

export function defer<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
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

  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
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

export async function waterfall(
  tasks: readonly ((arg: any) => Promise<any>)[],
  initialValue?: any
): Promise<any> {
  let current = initialValue;
  for (const task of tasks) {
    current = await task(current);
  }
  return current;
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

export interface RetryOptions {
  retries?: number;
  delayMs?: number;
  factor?: number;
  maxDelayMs?: number;
  jitter?: boolean;
  shouldRetry?: (error: any) => boolean;
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
    } catch (err: any) {
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

export interface AsyncQueue<T, R> {
  push(task: T, priority?: number): Promise<R>;
  pause(): void;
  resume(): void;
  drain(): Promise<void>;
  length(): number;
  running(): number;
  clear(): void;
}

interface QueueItem<T, R> {
  task: T;
  priority: number;
  deferred: Deferred<R>;
}

export function createQueue<T, R = any>(
  worker: (task: T) => Promise<R>,
  concurrency = 1
): AsyncQueue<T, R> {
  const queue: QueueItem<T, R>[] = [];
  let runningCount = 0;
  let isPaused = false;
  const drainWaiters: (() => void)[] = [];

  function processNext(): void {
    if (isPaused) return;
    while (runningCount < concurrency && queue.length > 0) {
      const item = queue.shift()!;
      runningCount++;

      worker(item.task)
        .then((res) => item.deferred.resolve(res))
        .catch((err) => item.deferred.reject(err))
        .finally(() => {
          runningCount--;
          processNext();
          if (runningCount === 0 && queue.length === 0) {
            drainWaiters.forEach((w) => w());
            drainWaiters.length = 0;
          }
        });
    }
  }

  return {
    push(task: T, priority = 0): Promise<R> {
      const deferred = defer<R>();
      const item: QueueItem<T, R> = { task, priority, deferred };

      // Insert sorted by descending priority
      let idx = queue.findIndex((x) => x.priority < priority);
      if (idx === -1) idx = queue.length;
      queue.splice(idx, 0, item);

      processNext();
      return deferred.promise;
    },
    pause() {
      isPaused = true;
    },
    resume() {
      isPaused = false;
      processNext();
    },
    drain(): Promise<void> {
      if (runningCount === 0 && queue.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => drainWaiters.push(resolve));
    },
    length(): number {
      return queue.length;
    },
    running(): number {
      return runningCount;
    },
    clear() {
      queue.length = 0;
    }
  };
}

export interface Mutex {
  acquire(): Promise<() => void>;
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
  isLocked(): boolean;
}

export function createMutex(): Mutex {
  let isLocked = false;
  const waiters: (() => void)[] = [];

  return {
    acquire(): Promise<() => void> {
      if (!isLocked) {
        isLocked = true;
        let released = false;
        return Promise.resolve(() => {
          if (released) return;
          released = true;
          if (waiters.length > 0) {
            const next = waiters.shift()!;
            next();
          } else {
            isLocked = false;
          }
        });
      }

      return new Promise<() => void>((resolve) => {
        waiters.push(() => {
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            if (waiters.length > 0) {
              const next = waiters.shift()!;
              next();
            } else {
              isLocked = false;
            }
          });
        });
      });
    },
    async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      const release = await this.acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    isLocked(): boolean {
      return isLocked;
    }
  };
}

export interface Semaphore {
  acquire(): Promise<() => void>;
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
  available(): number;
}

export function createSemaphore(permits: number): Semaphore {
  let availablePermits = permits;
  const waiters: (() => void)[] = [];

  return {
    acquire(): Promise<() => void> {
      if (availablePermits > 0) {
        availablePermits--;
        let released = false;
        return Promise.resolve(() => {
          if (released) return;
          released = true;
          if (waiters.length > 0) {
            const next = waiters.shift()!;
            next();
          } else {
            availablePermits++;
          }
        });
      }

      return new Promise<() => void>((resolve) => {
        waiters.push(() => {
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            if (waiters.length > 0) {
              const next = waiters.shift()!;
              next();
            } else {
              availablePermits++;
            }
          });
        });
      });
    },
    async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      const release = await this.acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    available(): number {
      return availablePermits;
    }
  };
}

export function pMemoize<F extends (...args: any[]) => Promise<any>>(
  fn: F,
  options: { ttlMs?: number; keyResolver?: (...args: Parameters<F>) => string } = {}
): F {
  const cache = new Map<string, { promise: Promise<any>; expiresAt?: number | undefined }>();
  return function (...args: Parameters<F>) {
    const key = options.keyResolver ? options.keyResolver(...args) : JSON.stringify(args);
    const existing = cache.get(key);
    if (existing && (!existing.expiresAt || Date.now() < existing.expiresAt)) {
      return existing.promise;
    }
    const promise = fn(...args).catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, {
      promise,
      expiresAt: options.ttlMs ? Date.now() + options.ttlMs : undefined
    });
    return promise;
  } as F;
}

export const asyncFlow = {
  sleep,
  timeout,
  defer,
  parallel,
  series,
  waterfall,
  mapLimit,
  filterLimit,
  forEachLimit,
  retry,
  createQueue,
  createMutex,
  createSemaphore,
  pMemoize
};

