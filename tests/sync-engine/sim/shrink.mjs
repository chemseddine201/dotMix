/**
 * Trace shrinking / Delta Debugging to isolate minimal failing event traces
 */

import {
  commitCheckpoint,
  defaultAntiEntropyRateLimiter,
  computeCertificateSigningPayload,
  signPayloadAsync,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";
import { persistEngineToStore, recoverFromStoreOnBoot } from "../../../packages/sync/dist/storage/index.js";
import { createByzantineOperation, createSignedAck, createSimCluster } from "./cluster.mjs";
import { checkAllInvariants, entriesDigest, visibleDigest } from "./invariants.mjs";
import { SimNetwork } from "./network.mjs";

export async function replayTrace(config, events) {
  defaultAntiEntropyRateLimiter.reset();
  const cluster = await createSimCluster(config.seed, config.numReplicas, config.withByzantine);
  const network = new SimNetwork();
  const eventTrace = [];
  const skippedEvents = [];
  const seenOutboxKeys = new Set();

  const honestIds = cluster.replicaIds.filter((id) => !cluster.replicas.get(id).isByzantine);

  for (let step = 0; step < events.length; step++) {
    network.stepTick();
    const event = events[step];

    if (
      event.type === "MUTATION_INSERT" ||
      event.type === "MUTATION_UPDATE" ||
      event.type === "MUTATION_MOVE" ||
      event.type === "MUTATION_DELETE"
    ) {
      const node = cluster.replicas.get(event.replicaId);
      if (node) {
        let input;
        if (event.type === "MUTATION_INSERT") {
          input = { kind: "insert", externalId: event.externalId, indexKey: event.indexKey, initialFields: event.fields };
        } else if (event.type === "MUTATION_UPDATE") {
          input = { kind: "update", targetIncarnation: event.targetIncarnation, externalId: event.externalId, partialFields: event.fields };
        } else if (event.type === "MUTATION_MOVE") {
          const bKey = `todos:${event.targetIncarnation.epochNumber}:${event.targetIncarnation.replicaId}:${event.targetIncarnation.sequence}`;
          input = { kind: "move", targetIncarnation: event.targetIncarnation, externalId: event.externalId, newIndexKey: event.newIndexKey, basePosSourceOpKey: bKey };
        } else {
          input = { kind: "delete", targetIncarnation: event.targetIncarnation, externalId: event.externalId };
        }

        const allocRes = await node.engine.allocateLocalMutation(input);
        if (allocRes.ok && allocRes.op) {
          network.flushOutboxes(cluster, seenOutboxKeys);
        }
      }
    } else if (event.type === "BYZANTINE_ACTION") {
      const byzNode = cluster.replicas.get(event.replicaId);
      if (byzNode) {
        const byzOp = await createByzantineOperation(byzNode, event.behavior, cluster, step);
        if (byzOp) {
          network.broadcastOperation(event.replicaId, cluster, byzOp);
        }
      }
    } else if (
      event.type === "DELIVER_MESSAGE" ||
      event.type === "DUPLICATE_MESSAGE" ||
      event.type === "DROP_MESSAGE"
    ) {
      const deliverable = network.getDeliverableMessages();
      const match =
        (event.messageId ? deliverable.find((m) => m.id === event.messageId) : undefined) ??
        deliverable.find((m) => m.fromReplicaId === event.from && m.toReplicaId === event.to) ??
        deliverable[0];
      if (match) {
        if (event.type === "DELIVER_MESSAGE") {
          await network.deliverMessage(match, cluster);
        } else if (event.type === "DUPLICATE_MESSAGE") {
          network.duplicateMessage(match);
        } else {
          network.dropMessage(match, 10);
        }
      }
    } else if (event.type === "PARTITION") {
      network.setPartitions(event.groups);
    } else if (event.type === "HEAL") {
      network.healPartitions();
    } else if (event.type === "CHECKPOINT") {
      const node = cluster.replicas.get(event.replicaId);
      if (node) {
        commitCheckpoint(node.engine.meta, node.engine.entriesState, node.engine.snapshotsV2, node.engine.mutationJournal);
      }
    } else if (event.type === "EXCHANGE_ACK") {
      const node = cluster.replicas.get(event.fromReplicaId);
      if (node) {
        const ack = await createSignedAck(node, node.engine.meta.epochNumber, cluster.collectionId);
        network.broadcastAck(event.fromReplicaId, cluster, ack);
      }
    } else if (event.type === "REVOKE_KEY") {
      const coord = cluster.replicas.get(event.coordinatorId);
      if (coord) {
        const nextEpoch = event.newEpoch ?? cluster.currentEpoch + 1;
        const newBaseline = {};
        for (const id of cluster.replicaIds) {
          const streamKey = `${cluster.currentEpoch}:${id}`;
          newBaseline[streamKey] = coord.engine.meta.frontiers.stableFrontier[streamKey] ?? 0;
        }
        const newBindings = { ...cluster.currentCert.memberBindings };
        const existingRevoked = coord.engine.meta.revokedKeyIds ?? [];
        const cumulativeRevoked = [...new Set([...existingRevoked, event.revokedKeyId])];

        const draftCert = {
          protocolVersion: PROTOCOL_VERSION,
          collectionId: cluster.collectionId,
          epochNumber: nextEpoch,
          epochCertificateId: `cert-epoch-${nextEpoch}`,
          coordinatorReplicaId: coord.id,
          coordinatorKeyId: `key:${coord.id}:v1`,
          memberBindings: newBindings,
          baselineStableFrontier: newBaseline,
          revokedKeyIds: cumulativeRevoked,
          coordinatorSignature: "",
        };
        const payload = computeCertificateSigningPayload(draftCert);
        const coordinatorSignature = await signPayloadAsync(payload, coord.keyPair.privateKeyHex, "Ed25519");
        const newCert = { ...draftCert, coordinatorSignature };
        for (const node of [...cluster.replicas.values()].filter((n) => n.id in cluster.currentCert.memberBindings)) {
          const certMsg = network.sendCertificate(coord.id, node.id, newCert);
          await network.deliverMessage(certMsg, cluster);
        }
        cluster.currentEpoch = nextEpoch;
        cluster.currentCert = newCert;
        network.flushOutboxes(cluster, seenOutboxKeys);
      }
    } else if (event.type === "EPOCH_TRANSITION") {
      const coord = cluster.replicas.get(cluster.coordinatorId);
      const nextEpoch = event.newEpoch;
      const draftCert = {
        protocolVersion: PROTOCOL_VERSION,
        collectionId: cluster.collectionId,
        epochNumber: nextEpoch,
        epochCertificateId: `cert-epoch-${nextEpoch}`,
        coordinatorReplicaId: coord.id,
        coordinatorKeyId: `key:${coord.id}:v1`,
        memberBindings: cluster.currentCert.memberBindings,
        baselineStableFrontier: event.baselineFrontier,
        coordinatorSignature: "",
      };
      const payload = computeCertificateSigningPayload(draftCert);
      const coordinatorSignature = await signPayloadAsync(payload, coord.keyPair.privateKeyHex, "Ed25519");
      const newCert = { ...draftCert, coordinatorSignature };
      for (const node of [...cluster.replicas.values()].filter((n) => n.id in cluster.currentCert.memberBindings)) {
        const certMsg = network.sendCertificate(coord.id, node.id, newCert);
        await network.deliverMessage(certMsg, cluster);
      }
      cluster.currentEpoch = nextEpoch;
      cluster.currentCert = newCert;
      network.flushOutboxes(cluster, seenOutboxKeys);
    } else if (event.type === "CRASH_RESTART") {
      const node = cluster.replicas.get(event.replicaId);
      if (node && !event.skipped) {
        await persistEngineToStore(node.backend, node.engine);
        const recovery = await recoverFromStoreOnBoot(
          node.backend,
          cluster.collectionId,
          node.id,
          { authorPrivateKeyHex: node.keyPair.privateKeyHex }
        );
        if (recovery.ok && recovery.engine) {
          node.engine = recovery.engine;
          node.engine.meta.remoteSyncEnabled = true;
        }
      } else if (event.reason) {
        skippedEvents.push(event.reason);
      }
    }

    eventTrace.push(event);

    const violation = checkAllInvariants(cluster, event, step);
    if (violation) {
      return {
        seed: config.seed,
        passed: false,
        stepsExecuted: step + 1,
        eventsCount: eventTrace.length,
        violation,
        eventTrace,
        skippedEvents,
      };
    }
  }

  // Quiescence & final check
  await network.drainQuiescence(cluster, seenOutboxKeys, 500);

  // Exchange ACKs between honest replicas
  for (const hId of honestIds) {
    const node = cluster.replicas.get(hId);
    const ack = await createSignedAck(node, node.engine.meta.epochNumber, cluster.collectionId);
    for (const peerId of honestIds) {
      if (peerId !== hId) {
        await network.deliverMessage(
          {
            id: `final-ack-${hId}->${peerId}`,
            kind: "ack",
            fromReplicaId: hId,
            toReplicaId: peerId,
            ack,
            channelPrincipal: { channelId: `chan:${hId}->${peerId}`, channelAuthenticated: true, transportSenderReplicaId: hId },
            deliverAfterStep: 0,
            dropped: false,
          },
          cluster
        );
      }
    }
  }

  // Final drain after ACK exchange
  await network.drainQuiescence(cluster, seenOutboxKeys, 500);

  // Check invariants post-quiescence
  const postViolation = checkAllInvariants(cluster, { type: "HEAL" }, events.length);
  if (postViolation) {
    return {
      seed: config.seed,
      passed: false,
      stepsExecuted: events.length,
      eventsCount: eventTrace.length,
      violation: postViolation,
      eventTrace,
      skippedEvents,
    };
  }

  const baseHonest = cluster.replicas.get(honestIds[0]);
  const expectedVisDigest = visibleDigest(baseHonest.engine);
  const expectedEntDigest = entriesDigest(baseHonest.engine);

  for (let i = 1; i < honestIds.length; i++) {
    const honest = cluster.replicas.get(honestIds[i]);
    const visDigest = visibleDigest(honest.engine);
    const entDigest = entriesDigest(honest.engine);

    if (visDigest !== expectedVisDigest || entDigest !== expectedEntDigest) {
      const violation = {
        invariant: "quiescent_convergence",
        replicaId: honest.id,
        stepIndex: events.length,
        event: { type: "HEAL" },
        detail: `Divergence on replay between ${baseHonest.id} and ${honest.id}`,
        specClause: "I24",
      };
      return {
        seed: config.seed,
        passed: false,
        stepsExecuted: events.length,
        eventsCount: eventTrace.length,
        violation,
        eventTrace,
        skippedEvents,
      };
    }
  }

  return {
    seed: config.seed,
    passed: true,
    stepsExecuted: events.length,
    eventsCount: eventTrace.length,
    eventTrace,
    skippedEvents,
  };
}

export async function shrinkFailingTrace(config, initialTrace) {
  const initialRes = await replayTrace(config, initialTrace);
  const targetInvariant = initialRes.violation?.invariant;
  let currentTrace = [...initialTrace];

  // Pass 1: Chunk removal (binary reduction)
  let chunkSize = Math.floor(currentTrace.length / 2);
  while (chunkSize >= 1) {
    let changed = false;
    for (let offset = 0; offset + chunkSize <= currentTrace.length; offset += chunkSize) {
      const candidate = [...currentTrace.slice(0, offset), ...currentTrace.slice(offset + chunkSize)];
      if (candidate.length === 0) continue;
      const res = await replayTrace(config, candidate);
      if (!res.passed && (!targetInvariant || res.violation?.invariant === targetInvariant)) {
        currentTrace = candidate;
        changed = true;
        break;
      }
    }
    if (!changed) {
      chunkSize = Math.floor(chunkSize / 2);
    }
  }

  // Pass 2: 1-minimal element removal
  let i = 0;
  while (i < currentTrace.length) {
    if (currentTrace.length <= 1) break;
    const candidate = [...currentTrace.slice(0, i), ...currentTrace.slice(i + 1)];
    const res = await replayTrace(config, candidate);
    if (!res.passed && (!targetInvariant || res.violation?.invariant === targetInvariant)) {
      currentTrace = candidate;
    } else {
      i++;
    }
  }

  return currentTrace;
}

