/**
 * @mix/sync — Origin Private File System (OPFS) Storage Driver
 */

import type { Mutation, SyncDriver } from "../types.js";
import { IndexedDbDriver } from "./indexeddb.js";

export class OpfsDriver implements SyncDriver {
  readonly name = "opfs";
  private rootDir: FileSystemDirectoryHandle | null = null;
  private fallback: SyncDriver = new IndexedDbDriver();

  async init(): Promise<void> {
    if (
      typeof navigator === "undefined" ||
      !navigator.storage ||
      typeof navigator.storage.getDirectory !== "function"
    ) {
      return this.fallback.init();
    }

    try {
      this.rootDir = await navigator.storage.getDirectory();
    } catch {
      await this.fallback.init();
    }
  }

  async getItem<T>(key: string): Promise<T | null> {
    if (!this.rootDir) return this.fallback.getItem<T>(key);
    try {
      const fileHandle = await this.rootDir.getFileHandle(`snapshot_${key}.json`);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async setItem<T>(key: string, value: T): Promise<void> {
    if (!this.rootDir) return this.fallback.setItem<T>(key, value);
    try {
      const fileHandle = await this.rootDir.getFileHandle(`snapshot_${key}.json`, {
        create: true,
      });
      const writable = await (fileHandle as unknown as { createWritable: () => Promise<FileSystemWritableFileStream> }).createWritable();
      await writable.write(JSON.stringify(value));
      await writable.close();
    } catch {
      await this.fallback.setItem<T>(key, value);
    }
  }

  async removeItem(key: string): Promise<void> {
    if (!this.rootDir) return this.fallback.removeItem(key);
    try {
      await this.rootDir.removeEntry(`snapshot_${key}.json`);
    } catch {
      await this.fallback.removeItem(key);
    }
  }

  async appendMutation(mutation: Mutation<unknown>): Promise<void> {
    // Forward mutations to indexeddb log for fast indexed querying
    return this.fallback.appendMutation(mutation);
  }

  async getPendingMutations(storeKey?: string): Promise<Mutation<unknown>[]> {
    return this.fallback.getPendingMutations(storeKey);
  }

  async markMutationsCommitted(mutationIdStrs: string[]): Promise<void> {
    return this.fallback.markMutationsCommitted(mutationIdStrs);
  }

  async markMutationRejected(mutationIdStr: string): Promise<void> {
    return this.fallback.markMutationRejected(mutationIdStr);
  }

  async clear(): Promise<void> {
    if (!this.rootDir) return this.fallback.clear();
    try {
      // Clear entries in OPFS
      for await (const name of (this.rootDir as unknown as { keys: () => AsyncIterable<string> }).keys()) {
        await this.rootDir.removeEntry(name);
      }
    } catch {
      // Ignore
    }
    await this.fallback.clear();
  }
}
