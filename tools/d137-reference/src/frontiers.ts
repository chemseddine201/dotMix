/**
 * D137-v33-reference: Frontier Tracking, Rolling Digest Anchors & Frontier Reconciliation
 */

import { sha256Hex } from "./canonicalization.js";
import type { OriginStreamKey, ReplicaMetaRecord, SequenceNumber } from "./types.js";

/**
 * Computes rolling stream digest with persistent anchor support (Fixes Defect 6).
 * When history below seq is pruned, the anchor preserves the hash chain continuity.
 */
export function updateRollingStreamDigest(
  meta: ReplicaMetaRecord,
  streamKey: OriginStreamKey,
  seq: SequenceNumber,
  payloadDigest: string
): string {
  if (!meta.rollingStreamDigests[streamKey]) {
    meta.rollingStreamDigests[streamKey] = {};
  }

  let prevDigest: string;
  if (seq === 1) {
    prevDigest = "0".repeat(64);
  } else {
    const directPrev = meta.rollingStreamDigests[streamKey][seq - 1];
    if (directPrev) {
      prevDigest = directPrev;
    } else {
      const anchor = meta.rollingStreamDigestAnchors[streamKey];
      if (anchor && anchor.sequence === seq - 1) {
        prevDigest = anchor.digest;
      } else {
        // Fallback or unanchored (will be flagged if mismatched)
        prevDigest = anchor?.digest ?? "0".repeat(64);
      }
    }
  }

  const nextDigest = sha256Hex(`${prevDigest}:${payloadDigest}`);
  meta.rollingStreamDigests[streamKey][seq] = nextDigest;
  return nextDigest;
}

/**
 * Prunes rolling stream digests up to horizonSeq while setting a persistent anchor.
 */
export function pruneRollingStreamDigests(
  meta: ReplicaMetaRecord,
  streamKey: OriginStreamKey,
  horizonSeq: SequenceNumber
): void {
  const streamMap = meta.rollingStreamDigests[streamKey];
  if (!streamMap) return;

  // Find the highest sequence <= horizonSeq to become the anchor
  let bestAnchorSeq = 0;
  let bestAnchorDigest = "";

  for (const seqStr of Object.keys(streamMap)) {
    const s = Number(seqStr);
    if (s <= horizonSeq) {
      if (s >= bestAnchorSeq) {
        bestAnchorSeq = s;
        bestAnchorDigest = streamMap[s]!;
      }
      delete streamMap[s];
    }
  }

  if (bestAnchorSeq > 0) {
    meta.rollingStreamDigestAnchors[streamKey] = {
      sequence: bestAnchorSeq,
      digest: bestAnchorDigest,
    };
  }
}

/**
 * Computes the stable frontier as the min durable sequence acknowledged by all cluster members.
 */
export function recomputeStableFrontier(meta: ReplicaMetaRecord): void {
  const members = Object.keys(meta.epochMemberBindings).filter(
    (m) => meta.epochMemberBindings[m]!.role === "WRITER_REPLICA"
  );
  if (members.length === 0) return;

  const allStreamKeys = new Set<OriginStreamKey>();
  for (const streamKey of Object.keys(meta.frontiers.localDurableFrontier)) {
    allStreamKeys.add(streamKey);
  }

  for (const streamKey of allStreamKeys) {
    let minAck = Infinity;
    for (const m of members) {
      const ack = meta.clusterAcks[m]?.[streamKey] ?? 0;
      if (ack < minAck) minAck = ack;
    }
    meta.frontiers.stableFrontier[streamKey] = minAck === Infinity ? 0 : minAck;
  }
}

/**
 * Reconciles ALL 8 frontiers, peer ACKs, and rolling digests post-excision (Fixes Defect 2).
 * Guarantees localDurableFrontier is the upper bound for all internal frontiers.
 */
export function reconcileAllFrontiersPostExcision(
  meta: ReplicaMetaRecord,
  streamKey: OriginStreamKey,
  excisionFloorSeq: SequenceNumber
): void {
  // 1. Clamp localDurableFrontier & knownProducedFrontier
  meta.frontiers.localDurableFrontier[streamKey] = excisionFloorSeq;
  meta.frontiers.knownProducedFrontier[streamKey] = excisionFloorSeq;

  // 2. Clamp stableFrontier
  const curStable = meta.frontiers.stableFrontier[streamKey] ?? 0;
  meta.frontiers.stableFrontier[streamKey] = Math.min(curStable, excisionFloorSeq);

  // 3. Clamp serverAcceptedFrontier
  const curServer = meta.frontiers.serverAcceptedFrontier[streamKey] ?? 0;
  meta.frontiers.serverAcceptedFrontier[streamKey] = Math.min(curServer, excisionFloorSeq);

  // 4. Clamp compactionFrontier
  const curCompaction = meta.frontiers.compactionFrontier[streamKey] ?? 0;
  meta.frontiers.compactionFrontier[streamKey] = Math.min(curCompaction, excisionFloorSeq);

  // 5. Clamp snapshotIncludedFrontier
  const curSnap = meta.frontiers.snapshotIncludedFrontier[streamKey] ?? 0;
  meta.frontiers.snapshotIncludedFrontier[streamKey] = Math.min(curSnap, excisionFloorSeq);

  // 6. Clamp digestPrunedFrontier (must not exceed compactionFrontier)
  const curDigestPruned = meta.frontiers.digestPrunedFrontier[streamKey] ?? 0;
  meta.frontiers.digestPrunedFrontier[streamKey] = Math.min(curDigestPruned, meta.frontiers.compactionFrontier[streamKey]);

  // 7. Reconcile peer clusterAcks
  for (const repId of Object.keys(meta.clusterAcks)) {
    if (meta.clusterAcks[repId]?.[streamKey] !== undefined) {
      meta.clusterAcks[repId][streamKey] = Math.min(meta.clusterAcks[repId][streamKey]!, excisionFloorSeq);
    }
  }

  // 8. Reconcile rolling stream digests
  if (meta.rollingStreamDigests[streamKey]) {
    for (const seqStr of Object.keys(meta.rollingStreamDigests[streamKey])) {
      if (Number(seqStr) > excisionFloorSeq) {
        delete meta.rollingStreamDigests[streamKey][Number(seqStr)];
      }
    }
  }

  // 9. If anchor is above excision floor, reset anchor to excision floor if known
  if (meta.rollingStreamDigestAnchors[streamKey]?.sequence > excisionFloorSeq) {
    if (excisionFloorSeq === 0) {
      delete meta.rollingStreamDigestAnchors[streamKey];
    } else {
      meta.rollingStreamDigestAnchors[streamKey] = {
        sequence: excisionFloorSeq,
        digest: meta.rollingStreamDigests[streamKey]?.[excisionFloorSeq] ?? "0".repeat(64),
      };
    }
  }
}
