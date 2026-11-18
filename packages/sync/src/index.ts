/**
 * @dotmix/sync — Local-First Offline-First Reactive CRDT State Sync Engine for Mix/Tix
 */

export * from "./types.js";
export * from "./crdt/clock.js";
export * from "./crdt/fractional.js";
export * from "./crdt/lww.js";
export * from "./crdt/array.js";
export * from "./storage/memory.js";
export * from "./storage/indexeddb.js";
export * from "./storage/opfs.js";
export * from "./engine/channel.js";
export * from "./engine/engine.js";
export * from "./primitives/syncSignal.js";
export * from "./primitives/syncCollection.js";
export * from "./storage/index.js";
export * from "./protocol/index.js";
export * from "./adapter/index.js";
export * from "./overlay/index.js";
export * from "./migration/index.js";
export * from "./transport/index.js";
export * from "./diagnostics/index.js";
export type { WireEnvelope } from "./transport/index.js";
export { AuthenticatedWebSocketTransport } from "./transport/index.js";

// Deprecated aliases: the sync engine's former "d137" codename, kept so code written against 0.1.x
// keeps compiling. Prefer the new names; these will be removed in a future minor release.
import {
  createReplicatedCollectionAdapter as createReplicatedCollectionAdapterInternal,
  ReplicatedCollectionAdapterImpl as ReplicatedCollectionAdapterImplInternal
} from "./adapter/collection-adapter.js";
import { createReplicatedSignalAdapter as createReplicatedSignalAdapterInternal } from "./adapter/signal-adapter.js";
import { ReplicationEngine as ReplicationEngineInternal } from "./protocol/engine.js";
import { SYNC_PROTOCOL_LIMITS as SYNC_PROTOCOL_LIMITS_INTERNAL } from "./protocol/limits.js";

/** @deprecated Renamed to `createReplicatedCollectionAdapter`. */
export const createD137CollectionAdapter = createReplicatedCollectionAdapterInternal;
/** @deprecated Renamed to `createReplicatedSignalAdapter`. */
export const createD137SignalAdapter = createReplicatedSignalAdapterInternal;
/** @deprecated Renamed to `ReplicationEngine`. */
export const D137Engine = ReplicationEngineInternal;
/** @deprecated Renamed to `ReplicatedCollectionAdapterImpl`. */
export const D137CollectionAdapterImpl = ReplicatedCollectionAdapterImplInternal;
/** @deprecated Renamed to `SYNC_PROTOCOL_LIMITS`. */
export const D137_V331_LIMITS = SYNC_PROTOCOL_LIMITS_INTERNAL;
