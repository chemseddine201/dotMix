/**
 * @dotmix/sync — Signal Adapter
 *
 * Implements the SyncSignal<T> facade backed by a single-entry collection
 * with externalId "__value__" on the protocol engine.
 * Zero external dependencies.
 */

import { signal } from "@dotmix/runtime";
import type { SyncSignalOptions, SyncStatus } from "../types.js";
import type { ReplicatedSignalAdapter } from "./contract.js";
import { createReplicatedCollectionAdapter } from "./collection-adapter.js";

interface SingleValueItem<T> {
  id: string;
  value: T;
}

let hasWarnedCommitDeprecation = false;

export function createReplicatedSignalAdapter<T>(
  initialValue: T,
  options: SyncSignalOptions<T>
): ReplicatedSignalAdapter<T> {
  const storeKey = options.key;
  const signalValueSignal = signal<T>(initialValue);

  const adapterOptions = {
    key: storeKey,
    engine: "replicated" as const,
    initialItems: [{ id: "__value__", value: initialValue }],
    ...(options.syncEngine !== undefined ? { syncEngine: options.syncEngine } : {}),
    ...(options.driver !== undefined ? { driver: options.driver } : {}),
  };

  const underlyingCollection = createReplicatedCollectionAdapter<SingleValueItem<T>>(adapterOptions);

  const accessor = (() => {
    const liveItems = underlyingCollection.items();
    if (liveItems.length > 0 && liveItems[0] && liveItems[0].value !== undefined) {
      return liveItems[0].value;
    }
    return signalValueSignal();
  }) as ReplicatedSignalAdapter<T>;

  accessor.set = (newValue: T | ((previousValue: T) => T)): void => {
    const currentValue = accessor();
    const resolvedValue =
      typeof newValue === "function"
        ? (newValue as (previousValue: T) => T)(currentValue)
        : newValue;

    signalValueSignal.set(resolvedValue);

    const existingItems = underlyingCollection.items();
    if (existingItems.length > 0) {
      void underlyingCollection.update("__value__", { value: resolvedValue });
    } else {
      void underlyingCollection.insert({ id: "__value__", value: resolvedValue });
    }
  };

  Object.defineProperty(accessor, "status", {
    value: (): SyncStatus => underlyingCollection.status(),
    writable: false,
    enumerable: true,
  });

  Object.defineProperty(accessor, "isPending", {
    value: (): boolean => underlyingCollection.isPending(),
    writable: false,
    enumerable: true,
  });

  Object.defineProperty(accessor, "pendingCount", {
    value: (): number => underlyingCollection.pendingCount(),
    writable: false,
    enumerable: true,
  });

  accessor.rollback = (): void => {
    underlyingCollection.rollback();
  };

  accessor.commit = (): void => {
    if (!hasWarnedCommitDeprecation) {
      hasWarnedCommitDeprecation = true;
      console.warn(
        "@dotmix/sync: commit() on syncSignal is deprecated under the active sync engine. Mutations are committed automatically via authenticated transactions."
      );
    }
    underlyingCollection.overlayHost.clearIntents();
  };

  Object.defineProperty(accessor, "engineInstance", {
    value: underlyingCollection.engineInstance,
    writable: false,
    enumerable: true,
  });

  Object.defineProperty(accessor, "engine", {
    get: (): unknown => underlyingCollection.engine,
    enumerable: true,
  });

  Object.defineProperty(accessor, "storeKey", {
    value: storeKey,
    writable: false,
    enumerable: true,
  });

  Object.defineProperty(accessor, "options", {
    value: options,
    writable: false,
    enumerable: true,
  });

  return accessor;
}
