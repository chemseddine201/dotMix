/**
 * @mix/sync — Local-First Reactive Signal Primitive
 */

import { signal } from "@mix/runtime";
import type { Mutation, MutationId, SyncDriver, SyncSignal, SyncSignalOptions, SyncStatus } from "../types.js";
import { formatMutationId } from "../crdt/clock.js";
import { LWWRegister } from "../crdt/lww.js";
import { getDefaultSyncEngine, SyncEngine } from "../engine/engine.js";
import { IndexedDbDriver } from "../storage/indexeddb.js";
import { OpfsDriver } from "../storage/opfs.js";

function resolveDriver(
  driverOpt: SyncDriver | "memory" | "indexeddb" | "opfs" | undefined,
  engine: SyncEngine
): SyncDriver {
  if (typeof driverOpt === "object" && driverOpt !== null) {
    return driverOpt;
  }
  if (driverOpt === "opfs") return new OpfsDriver();
  if (driverOpt === "indexeddb") return new IndexedDbDriver();
  return engine.driver;
}

export function syncSignal<T>(
  initialValue: T,
  keyOrOptions: string | SyncSignalOptions<T>
): SyncSignal<T> {
  const options: SyncSignalOptions<T> =
    typeof keyOrOptions === "string" ? { key: keyOrOptions } : keyOrOptions;
  const engine = (options.syncEngine as SyncEngine) || getDefaultSyncEngine();
  const driver = resolveDriver(options.driver, engine);
  const key = options.key;

  const initId: MutationId = engine.clock.tick();
  const register = new LWWRegister<T>(initialValue, initId);

  // Underlying Mix reactive signals
  const internalSignal = signal<T>(initialValue);
  const pendingCountSig = signal<number>(0);
  const statusSig = signal<SyncStatus>(engine.isOnline() ? "synced" : "offline");

  const syncSaved = driver.getItemSync?.<{ value: T; mutationId: MutationId }>(key) ?? null;
  if (syncSaved && syncSaved.mutationId) {
    engine.clock.witness(syncSaved.mutationId.timestamp);
    register.merge(syncSaved.value, syncSaved.mutationId);
    internalSignal.set(register.value);
  }

  // History stack for optimistic rollback
  const historyStack: { value: T; mutationIdStr: string }[] = [];

  // Register with SyncEngine
  engine.registerStore(key, {
    applyRemoteMutation(remoteMut: Mutation<unknown>) {
      const remoteVal = remoteMut.payload as T;
      const remoteId = remoteMut.id;
      if (register.merge(remoteVal, remoteId)) {
        internalSignal.set(register.value);
        void driver.setItem(key, register.toJSON());
      }
    },
    rollbackMutation(mutationIdStr: string) {
      const idx = historyStack.findIndex((h) => h.mutationIdStr === mutationIdStr);
      if (idx !== -1) {
        const item = historyStack[idx]!;
        historyStack.splice(idx, 1);
        pendingCountSig.set(historyStack.length);

        // Revert to the snapshot before this mutation
        internalSignal.set(item.value);
        register.set(item.value, engine.clock.tick());
        void driver.setItem(key, register.toJSON());
      }
    },
  });

  // Attempt async hydration from driver on init
  void (async () => {
    try {
      await driver.init();
      const saved = await driver.getItem<{ value: T; mutationId: MutationId }>(key);
      if (saved && saved.mutationId) {
        engine.clock.witness(saved.mutationId.timestamp);
        register.merge(saved.value, saved.mutationId);
        internalSignal.set(register.value);
      }
    } catch {
      // Ignore hydration failure and keep initialValue
    }
  })();

  const read = (() => internalSignal()) as unknown as SyncSignal<T>;

  read.set = (newValueOrFn: T | ((prev: T) => T)) => {
    const prev = internalSignal();
    const nextVal = typeof newValueOrFn === "function"
      ? (newValueOrFn as (prev: T) => T)(prev)
      : newValueOrFn;

    const mutId = engine.clock.tick();
    const idStr = formatMutationId(mutId);

    // 1. Record rollback history
    historyStack.push({ value: prev, mutationIdStr: idStr });
    pendingCountSig.set(historyStack.length);

    // 2. Immediate optimistic update (0ms perceived latency)
    register.set(nextVal, mutId);
    internalSignal.set(nextVal);
    statusSig.set(engine.isOnline() ? "syncing" : "offline");

    // 3. Persist and enqueue asynchronously
    const mutation: Mutation<T> = {
      id: mutId,
      idStr,
      storeKey: key,
      op: "set",
      payload: nextVal,
      previousState: prev,
      state: "pending",
      createdAt: Date.now(),
    };

    void driver.setItem(key, register.toJSON());
    void engine.enqueueMutation(mutation).then(() => {
      if (engine.isOnline() && pendingCountSig() === 0) {
        statusSig.set("synced");
      }
    });
  };

  read.rollback = () => {
    if (historyStack.length > 0) {
      const last = historyStack.pop()!;
      pendingCountSig.set(historyStack.length);
      internalSignal.set(last.value);
      register.set(last.value, engine.clock.tick());
      void driver.setItem(key, register.toJSON());
    }
  };

  read.commit = () => {
    historyStack.length = 0;
    pendingCountSig.set(0);
    statusSig.set(engine.isOnline() ? "synced" : "offline");
  };

  Object.defineProperties(read, {
    status: { get: () => () => statusSig(), enumerable: true },
    isPending: { get: () => () => pendingCountSig() > 0, enumerable: true },
    pendingCount: { get: () => () => pendingCountSig(), enumerable: true },
  });

  return read;
}
