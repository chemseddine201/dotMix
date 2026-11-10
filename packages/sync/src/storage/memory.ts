/**
 * @mix/sync — In-Memory Synchronous & Asynchronous Log Driver
 */

import type { Mutation, SyncDriver } from "../types.js";

export class MemoryDriver implements SyncDriver {
  readonly name = "memory";
  private store: Map<string, unknown> = new Map();
  private mutations: Mutation<unknown>[] = [];

  async init(): Promise<void> {
    // No-op for in-memory
  }

  getItemSync<T>(key: string): T | null {
    const val = this.store.get(key);
    return val !== undefined ? (structuredClone(val) as T) : null;
  }

  async getItem<T>(key: string): Promise<T | null> {
    const val = this.store.get(key);
    return val !== undefined ? (structuredClone(val) as T) : null;
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    this.store.set(key, structuredClone(value));
  }

  async removeItem(key: string): Promise<void> {
    this.store.delete(key);
  }

  async appendMutation(mutation: Mutation<unknown>): Promise<void> {
    this.mutations.push(structuredClone(mutation));
  }

  async getPendingMutations(storeKey?: string): Promise<Mutation<unknown>[]> {
    return this.mutations
      .filter((m) => m.state === "pending" && (!storeKey || m.storeKey === storeKey))
      .map((m) => structuredClone(m));
  }

  async markMutationsCommitted(mutationIdStrs: string[]): Promise<void> {
    const set = new Set(mutationIdStrs);
    for (const m of this.mutations) {
      if (set.has(m.idStr)) {
        m.state = "committed";
      }
    }
  }

  async markMutationRejected(mutationIdStr: string): Promise<void> {
    for (const m of this.mutations) {
      if (m.idStr === mutationIdStr) {
        m.state = "rejected";
      }
    }
  }

  async pruneMutations(predicate: (m: Mutation<unknown>) => boolean): Promise<number> {
    const prevLen = this.mutations.length;
    this.mutations = this.mutations.filter((m) => !predicate(m));
    return prevLen - this.mutations.length;
  }

  async clear(): Promise<void> {
    this.store.clear();
    this.mutations = [];
  }
}

