/**
 * Invariant checkers for simulation harness
 */

import {
  SYNC_PROTOCOL_LIMITS,
  canonicalizeValue,
  sha256Hex,
  toOperationKey,
  materializeVisibleArray,
} from "../../../packages/sync/dist/protocol/index.js";

export function visibleDigest(engine) {
  const visible = materializeVisibleArray(engine.entriesState);
  return sha256Hex(canonicalizeValue(visible.items));
}

export function entriesDigest(engine) {
  const sorted = [...engine.entriesState.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(canonicalizeValue(sorted));
}

export function checkContiguousFrontiers(engine, replicaId, event, stepIndex) {
  const frontiers = engine.meta.frontiers;
  const collectionId = engine.meta.collectionId;

  for (const [streamKey, durableSeq] of Object.entries(frontiers.localDurableFrontier)) {
    const compactionSeq = frontiers.compactionFrontier[streamKey] ?? 0;
    const snapSeq = frontiers.snapshotIncludedFrontier[streamKey] ?? 0;
    const baselineSeq = engine.meta.epochCertificate.baselineStableFrontier[streamKey] ?? 0;

    if (compactionSeq > durableSeq) {
      return {
        invariant: "contiguous_frontiers",
        replicaId,
        stepIndex,
        event,
        detail: `Stream ${streamKey}: compactionFrontier (${compactionSeq}) exceeds localDurableFrontier (${durableSeq})`,
        specClause: " Option A / S80",
      };
    }
    if (snapSeq > durableSeq) {
      return {
        invariant: "contiguous_frontiers",
        replicaId,
        stepIndex,
        event,
        detail: `Stream ${streamKey}: snapshotIncludedFrontier (${snapSeq}) exceeds localDurableFrontier (${durableSeq})`,
        specClause: "S80",
      };
    }

    // (G32-3): only check streams listed in the current certificate
    const listedInCurrentCert = streamKey in engine.meta.epochCertificate.baselineStableFrontier;
    if (listedInCurrentCert && compactionSeq > baselineSeq) {
      return {
        invariant: "contiguous_frontiers",
        replicaId,
        stepIndex,
        event,
        detail: `Stream ${streamKey}: compactionFrontier (${compactionSeq}) exceeds certified baseline floor (${baselineSeq})`,
        specClause: " Option A",
      };
    }

    const [epochStr, repId] = streamKey.split(":");
    const epochNum = Number(epochStr);

    const anchor = engine.meta.rollingStreamDigestAnchors[streamKey];
    const anchorSeq = anchor?.sequence ?? 0;
    const rollingDigests = engine.meta.rollingStreamDigests[streamKey] ?? {};

    for (let seq = 1; seq <= durableSeq; seq++) {
      const opKey = toOperationKey(collectionId, { epochNumber: epochNum, replicaId: repId, sequence: seq });
      const hasDigestRecord = engine.operationDigests.has(opKey);
      const hasRollingDigest = rollingDigests[seq] !== undefined;
      const isCoveredByAnchor = anchorSeq >= seq;

      if (!hasDigestRecord && !hasRollingDigest && !isCoveredByAnchor) {
        return {
          invariant: "contiguous_frontiers",
          replicaId,
          stepIndex,
          event,
          detail: `Stream ${streamKey} seq ${seq}: missing digest/anchor coverage at durableSeq ${durableSeq}`,
          specClause: "I24 / S81",
        };
      }

      if (seq > compactionSeq) {
        const hasJournalRecord = engine.mutationJournal.has(opKey);
        if (!hasJournalRecord) {
          return {
            invariant: "contiguous_frontiers",
            replicaId,
            stepIndex,
            event,
            detail: `Stream ${streamKey} seq ${seq}: missing from mutationJournal above compactionFrontier ${compactionSeq}`,
            specClause: " Option A / S80",
          };
        }
      }
    }
  }
  return null;
}

export function checkBuffersWithinBounds(engine, replicaId, event, stepIndex) {
  const meta = engine.meta;
  if (engine.inboundGapBuffer.size > SYNC_PROTOCOL_LIMITS.MAX_GAP_BUFFER_OPS_PER_COLLECTION) {
    return {
      invariant: "buffers_within_bounds",
      replicaId,
      stepIndex,
      event,
      detail: `Gap buffer size ${engine.inboundGapBuffer.size} exceeds limit ${SYNC_PROTOCOL_LIMITS.MAX_GAP_BUFFER_OPS_PER_COLLECTION}`,
      specClause: "S94",
    };
  }
  if (meta.totalGapBufferOps > SYNC_PROTOCOL_LIMITS.MAX_GAP_BUFFER_OPS_PER_COLLECTION) {
    return {
      invariant: "buffers_within_bounds",
      replicaId,
      stepIndex,
      event,
      detail: `Total gap buffer ops ${meta.totalGapBufferOps} exceeds limit ${SYNC_PROTOCOL_LIMITS.MAX_GAP_BUFFER_OPS_PER_COLLECTION}`,
      specClause: "S94",
    };
  }
  if (meta.totalGapBufferBytes > SYNC_PROTOCOL_LIMITS.MAX_GAP_BUFFER_BYTES_PER_COLLECTION) {
    return {
      invariant: "buffers_within_bounds",
      replicaId,
      stepIndex,
      event,
      detail: `Total gap buffer bytes ${meta.totalGapBufferBytes} exceeds limit ${SYNC_PROTOCOL_LIMITS.MAX_GAP_BUFFER_BYTES_PER_COLLECTION}`,
      specClause: "S94",
    };
  }
  if (engine.inboundDependencyBuffer.size > SYNC_PROTOCOL_LIMITS.MAX_DEPENDENCY_BUFFER_OPS_PER_COLLECTION) {
    return {
      invariant: "buffers_within_bounds",
      replicaId,
      stepIndex,
      event,
      detail: `Dependency buffer size ${engine.inboundDependencyBuffer.size} exceeds limit ${SYNC_PROTOCOL_LIMITS.MAX_DEPENDENCY_BUFFER_OPS_PER_COLLECTION}`,
      specClause: "S94",
    };
  }
  if (meta.totalDependencyBufferOps > SYNC_PROTOCOL_LIMITS.MAX_DEPENDENCY_BUFFER_OPS_PER_COLLECTION) {
    return {
      invariant: "buffers_within_bounds",
      replicaId,
      stepIndex,
      event,
      detail: `Total dependency buffer ops ${meta.totalDependencyBufferOps} exceeds limit ${SYNC_PROTOCOL_LIMITS.MAX_DEPENDENCY_BUFFER_OPS_PER_COLLECTION}`,
      specClause: "S94",
    };
  }
  if (meta.totalDependencyBufferBytes > SYNC_PROTOCOL_LIMITS.MAX_DEPENDENCY_BUFFER_BYTES_PER_COLLECTION) {
    return {
      invariant: "buffers_within_bounds",
      replicaId,
      stepIndex,
      event,
      detail: `Total dependency buffer bytes ${meta.totalDependencyBufferBytes} exceeds limit ${SYNC_PROTOCOL_LIMITS.MAX_DEPENDENCY_BUFFER_BYTES_PER_COLLECTION}`,
      specClause: "S94",
    };
  }
  if (engine.quarantineJournal.size > SYNC_PROTOCOL_LIMITS.MAX_QUARANTINE_RECORDS) {
    return {
      invariant: "buffers_within_bounds",
      replicaId,
      stepIndex,
      event,
      detail: `Quarantine journal size ${engine.quarantineJournal.size} exceeds limit ${SYNC_PROTOCOL_LIMITS.MAX_QUARANTINE_RECORDS}`,
      specClause: "S95",
    };
  }
  return null;
}

export function checkNoAppliedOpFromBlockedStream(engine, replicaId, event, stepIndex) {
  for (const [streamKey, equivRec] of Object.entries(engine.meta.activeEpochEquivocations)) {
    const firstSeq = equivRec.firstEquivocatedSeq;
    const [epochStr, repId] = streamKey.split(":");
    const epochNum = Number(epochStr);

    for (const [opKey, digRec] of engine.operationDigests.entries()) {
      if (digRec.epochNumber === epochNum && digRec.replicaId === repId && digRec.sequence >= firstSeq) {
        if (digRec.status === "APPLIED") {
          return {
            invariant: "no_applied_from_blocked_stream",
            replicaId,
            stepIndex,
            event,
            detail: `Operation ${opKey} has status APPLIED despite stream ${streamKey} being blocked at seq ${firstSeq}`,
            specClause: "S82 Option A",
          };
        }
      }
    }

    for (const [opKey, jRec] of engine.mutationJournal.entries()) {
      if (jRec.epochNumber === epochNum && jRec.replicaId === repId && jRec.sequence >= firstSeq) {
        if (jRec.disposition === "APPLIED") {
          return {
            invariant: "no_applied_from_blocked_stream",
            replicaId,
            stepIndex,
            event,
            detail: `Journal op ${opKey} has disposition APPLIED despite stream ${streamKey} being blocked at seq ${firstSeq}`,
            specClause: "S82 Option A",
          };
        }
      }
    }
  }
  return null;
}

export function checkSnapshotLabelsConsistent(engine, replicaId, event, stepIndex) {
  for (const [seq, snap] of engine.snapshotsV2.entries()) {
    if (snap.epochNumber !== snap.epochCertificate.epochNumber) {
      return {
        invariant: "snapshot_labels_consistent",
        replicaId,
        stepIndex,
        event,
        detail: `Snapshot ${seq} epochNumber (${snap.epochNumber}) !== epochCertificate.epochNumber (${snap.epochCertificate.epochNumber})`,
        specClause: "R Finding 3 Option A",
      };
    }
    const snapBaseline = snap.baselineStableFrontier;
    const certBaseline = snap.epochCertificate.baselineStableFrontier;
    for (const [k, v] of Object.entries(certBaseline)) {
      if (snapBaseline[k] !== v) {
        return {
          invariant: "snapshot_labels_consistent",
          replicaId,
          stepIndex,
          event,
          detail: `Snapshot ${seq} baselineStableFrontier[${k}] (${snapBaseline[k]}) !== cert baseline (${v})`,
          specClause: "R Finding 3 Option A",
        };
      }
    }
  }
  return null;
}

export function checkAllInvariants(cluster, event, stepIndex) {
  for (const node of cluster.replicas.values()) {
    const v1 = checkContiguousFrontiers(node.engine, node.id, event, stepIndex);
    if (v1) return v1;
    const v2 = checkBuffersWithinBounds(node.engine, node.id, event, stepIndex);
    if (v2) return v2;
    const v3 = checkNoAppliedOpFromBlockedStream(node.engine, node.id, event, stepIndex);
    if (v3) return v3;
    const v4 = checkSnapshotLabelsConsistent(node.engine, node.id, event, stepIndex);
    if (v4) return v4;
  }
  return null;
}

