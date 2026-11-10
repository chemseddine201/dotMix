/**
 * mix-helpers/async — Priority Queue, Mutex, Semaphore & Async Function Wrappers
 */

import { type Deferred, defer } from "./control-flow.js";

export type QueueTask<T, R> = (task: T) => Promise<R>;

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

export function createQueue<T, R = unknown>(
  worker: QueueTask<T, R>,
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
        .catch((err: unknown) => item.deferred.reject(err))
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
    pause(): void {
      isPaused = true;
    },
    resume(): void {
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
    clear(): void {
      queue.length = 0;
    },
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
    },
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
    },
  };
}

export function pDebounce<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  waitMs: number
): (...args: Args) => Promise<R> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingResolvers: Array<{ resolve: (val: R) => void; reject: (err: unknown) => void }> = [];

  return function (...args: Args): Promise<R> {
    if (timer !== null) {
      clearTimeout(timer);
    }
    return new Promise<R>((resolve, reject) => {
      pendingResolvers.push({ resolve, reject });
      timer = setTimeout(() => {
        const currentResolvers = pendingResolvers;
        pendingResolvers = [];
        timer = null;
        fn(...args).then(
          (val) => currentResolvers.forEach((r) => r.resolve(val)),
          (err: unknown) => currentResolvers.forEach((r) => r.reject(err))
        );
      }, waitMs);
    });
  };
}

export function pThrottle<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  limit: number,
  intervalMs: number
): (...args: Args) => Promise<R> {
  let activeCount = 0;
  const queue: Array<{ args: Args; resolve: (val: R) => void; reject: (err: unknown) => void }> = [];

  function scheduleNext(): void {
    while (activeCount < limit && queue.length > 0) {
      const next = queue.shift()!;
      activeCount++;
      setTimeout(() => {
        activeCount--;
        scheduleNext();
      }, intervalMs);
      fn(...next.args).then(next.resolve, next.reject);
    }
  }

  return function (...args: Args): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      queue.push({ args, resolve, reject });
      scheduleNext();
    });
  };
}

export function pMemoize<Args extends unknown[], R>(
  fn: (...args: Args) => Promise<R>,
  options: { ttlMs?: number; keyResolver?: (...args: Args) => string } = {}
): (...args: Args) => Promise<R> {
  const cache = new Map<string, { promise: Promise<R>; expiresAt?: number | undefined }>();
  return function (...args: Args): Promise<R> {
    const key = options.keyResolver ? options.keyResolver(...args) : JSON.stringify(args);
    const existing = cache.get(key);
    if (existing && (!existing.expiresAt || Date.now() < existing.expiresAt)) {
      return existing.promise;
    }
    const promise = fn(...args).catch((err: unknown) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, {
      promise,
      expiresAt: options.ttlMs ? Date.now() + options.ttlMs : undefined,
    });
    return promise;
  };
}
