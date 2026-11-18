/**
 * Scenario generator and executor for seeded simulation
 */

import assert from "node:assert/strict";
import {
  computeCertificateSigningPayload,
  signPayloadAsync,
  commitCheckpoint,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";
import { persistEngineToStore, recoverFromStoreOnBoot } from "../../../packages/sync/dist/storage/index.js";
import { createByzantineOperation, createSignedAck, createSimCluster, mulberry32 } from "./cluster.mjs";
import { checkAllInvariants, entriesDigest, visibleDigest } from "./invariants.mjs";
import { SimNetwork } from "./network.mjs";

export async function runSimulation(config) {
  const prng = mulberry32(config.seed * 7919 + 31);
  const cluster = await createSimCluster(config.seed, config.numReplicas, config.withByzantine);
  const network = new SimNetwork();
  const eventTrace = [];
  const skippedEvents = [];

  const honestIds = cluster.replicaIds.filter((id) => !cluster.replicas.get(id).isByzantine);
  const seenOutboxKeys = new Set();

  for (let step = 0; step < config.steps; step++) {
    network.stepTick();
    const actionRoll = prng();
    let event = null;

    // 1. Produce Mutation (30% probability)
    if (actionRoll < 0.3) {
      const repId = honestIds[Math.floor(prng() * honestIds.length)];
      const node = cluster.replicas.get(repId);
      const live = [...node.engine.entriesState.values()].filter((e) => !e.deleted);
      const mutRoll = prng();
      let input;

      if (live.length === 0 || mutRoll < 0.4) {
        const extId = `item-${step}-${repId}`;
        const indexKey = `k${String(step).padStart(4, "0")}`;
        input = { kind: "insert", externalId: extId, indexKey, initialFields: { v: step, author: repId } };
        event = { type: "MUTATION_INSERT", replicaId: repId, externalId: extId, indexKey, fields: { v: step, author: repId } };
      } else {
        const target = live[Math.floor(prng() * live.length)];
        if (mutRoll < 0.7) {
          input = { kind: "update", targetIncarnation: target.targetBirthDot, externalId: target.externalId, partialFields: { v: step, modBy: repId } };
          event = { type: "MUTATION_UPDATE", replicaId: repId, targetIncarnation: target.targetBirthDot, externalId: target.externalId, fields: { v: step, modBy: repId } };
        } else if (mutRoll < 0.85) {
          const newIdx = `m${String(step).padStart(4, "0")}`;
          const bKey = `todos:${target.targetBirthDot.epochNumber}:${target.targetBirthDot.replicaId}:${target.targetBirthDot.sequence}`;
          input = { kind: "move", targetIncarnation: target.targetBirthDot, externalId: target.externalId, newIndexKey: newIdx, basePosSourceOpKey: bKey };
          event = { type: "MUTATION_MOVE", replicaId: repId, targetIncarnation: target.targetBirthDot, externalId: target.externalId, newIndexKey: newIdx };
        } else {
          input = { kind: "delete", targetIncarnation: target.targetBirthDot, externalId: target.externalId };
          event = { type: "MUTATION_DELETE", replicaId: repId, targetIncarnation: target.targetBirthDot, externalId: target.externalId };
        }
      }

      const allocRes = await node.engine.allocateLocalMutation(input);
      if (allocRes.ok && allocRes.op) {
        network.flushOutboxes(cluster, seenOutboxKeys);
      }
    }
    // 2. Byzantine Action (if enabled, 10% probability)
    else if (actionRoll < 0.4 && config.withByzantine) {
      const byzId = cluster.replicaIds.find((id) => cluster.replicas.get(id).isByzantine);
      if (byzId) {
        const byzNode = cluster.replicas.get(byzId);
        const behaviors = ["fork", "oversized_payload", "oversized_index", "invalid_dependency", "invalid_signature"];
        const bBehavior = behaviors[Math.floor(prng() * behaviors.length)];
        event = { type: "BYZANTINE_ACTION", replicaId: byzId, behavior: bBehavior };
        const byzOp = await createByzantineOperation(byzNode, bBehavior, cluster, step);
        if (byzOp) {
          network.broadcastOperation(byzId, cluster, byzOp);
        }
      }
    }
    // 3. Network Events: Reorder / Duplicate / Drop / Deliver (35% probability)
    else if (actionRoll < 0.75) {
      const deliverable = network.getDeliverableMessages();
      if (deliverable.length > 0) {
        const msg = deliverable[Math.floor(prng() * deliverable.length)];
        const netRoll = prng();
        if (netRoll < 0.2) {
          network.duplicateMessage(msg);
          event = { type: "DUPLICATE_MESSAGE", messageId: msg.id, from: msg.fromReplicaId, to: msg.toReplicaId };
        } else if (netRoll < 0.35) {
          const delay = 5 + Math.floor(prng() * 15);
          const dropRes = network.dropMessage(msg, delay);
          event = { type: "DROP_MESSAGE", messageId: msg.id, from: msg.fromReplicaId, to: msg.toReplicaId, delayedUntilStep: dropRes.delayedUntil };
        } else {
          await network.deliverMessage(msg, cluster);
          event = { type: "DELIVER_MESSAGE", messageId: msg.id, from: msg.fromReplicaId, to: msg.toReplicaId };
        }
      }
    }
    // 4. Partition / Heal (5% probability)
    else if (actionRoll < 0.8) {
      if (prng() < 0.5) {
        const mid = Math.floor(cluster.replicaIds.length / 2);
        const g1 = cluster.replicaIds.slice(0, mid);
        const g2 = cluster.replicaIds.slice(mid);
        network.setPartitions([g1, g2]);
        event = { type: "PARTITION", groups: [g1, g2] };
      } else {
        network.healPartitions();
        event = { type: "HEAL" };
      }
    }
    // 5. Random Checkpoints (5% probability)
    else if (actionRoll < 0.85) {
      const repId = cluster.replicaIds[Math.floor(prng() * cluster.replicaIds.length)];
      const node = cluster.replicas.get(repId);
      commitCheckpoint(node.engine.meta, node.engine.entriesState, node.engine.snapshotsV2, node.engine.mutationJournal);
      event = { type: "CHECKPOINT", replicaId: repId };
    }
    // 6. ACK Exchange (8% probability)
    else if (actionRoll < 0.93) {
      const repId = honestIds[Math.floor(prng() * honestIds.length)];
      const node = cluster.replicas.get(repId);
      const ackMsg = await createSignedAck(node, node.engine.meta.epochNumber, cluster.collectionId);
      network.broadcastAck(repId, cluster, ackMsg);
      event = { type: "EXCHANGE_ACK", fromReplicaId: repId, toReplicaId: "*" };
    }
    // 7. Key Revocation via Epoch Transition Certificate (2% probability)
    else if (actionRoll < 0.95) {
      const byzId = cluster.replicaIds.find((id) => cluster.replicas.get(id).isByzantine);
      const targetId = byzId ?? cluster.replicaIds[cluster.replicaIds.length - 1];
      const revokedKeyId = `key:${targetId}:v1`;
      const coord = cluster.replicas.get(cluster.coordinatorId);
      const nextEpoch = cluster.currentEpoch + 1;
      const newBaseline = {};
      for (const id of cluster.replicaIds) {
        const streamKey = `${cluster.currentEpoch}:${id}`;
        newBaseline[streamKey] = coord.engine.meta.frontiers.stableFrontier[streamKey] ?? 0;
      }
      const newBindings = { ...cluster.currentCert.memberBindings };
      delete newBindings[targetId];
      const existingRevoked = coord.engine.meta.revokedKeyIds ?? [];
      const cumulativeRevoked = [...new Set([...existingRevoked, revokedKeyId])];

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
      const replicaResults = {};

      for (const node of [...cluster.replicas.values()].filter((n) => n.id in cluster.currentCert.memberBindings)) {
        const certMsg = network.sendCertificate(coord.id, node.id, newCert);
        const res = await network.deliverMessage(certMsg, cluster);
        replicaResults[node.id] = { ok: res.ok, code: res.code };
      }

      cluster.currentEpoch = nextEpoch;
      cluster.currentCert = newCert;
      event = {
        type: "REVOKE_KEY",
        coordinatorId: coord.id,
        revokedKeyId,
        newEpoch: nextEpoch,
        replicaResults,
      };
      network.flushOutboxes(cluster, seenOutboxKeys);
    }
    // 8. Epoch Transition via ingestEpochTransitionCertificate (3% probability)
    else if (actionRoll < 0.98) {
      const coord = cluster.replicas.get(cluster.coordinatorId);
      const nextEpoch = cluster.currentEpoch + 1;
      const newBaseline = {};
      for (const id of cluster.replicaIds) {
        const streamKey = `${cluster.currentEpoch}:${id}`;
        newBaseline[streamKey] = coord.engine.meta.frontiers.stableFrontier[streamKey] ?? 0;
      }
      const draftCert = {
        protocolVersion: PROTOCOL_VERSION,
        collectionId: cluster.collectionId,
        epochNumber: nextEpoch,
        epochCertificateId: `cert-epoch-${nextEpoch}`,
        coordinatorReplicaId: coord.id,
        coordinatorKeyId: `key:${coord.id}:v1`,
        memberBindings: cluster.currentCert.memberBindings,
        baselineStableFrontier: newBaseline,
        coordinatorSignature: "",
      };
      const payload = computeCertificateSigningPayload(draftCert);
      const coordinatorSignature = await signPayloadAsync(payload, coord.keyPair.privateKeyHex, "Ed25519");
      const newCert = { ...draftCert, coordinatorSignature };
      const replicaResults = {};

      for (const node of [...cluster.replicas.values()].filter((n) => n.id in cluster.currentCert.memberBindings)) {
        const certMsg = network.sendCertificate(coord.id, node.id, newCert);
        const res = await network.deliverMessage(certMsg, cluster);
        replicaResults[node.id] = { ok: res.ok, code: res.code };
      }

      cluster.currentEpoch = nextEpoch;
      cluster.currentCert = newCert;
      event = {
        type: "EPOCH_TRANSITION",
        newEpoch: nextEpoch,
        baselineFrontier: newBaseline,
        replicaResults,
      };
      network.flushOutboxes(cluster, seenOutboxKeys);
    }
    // 9. Crash / Restart (2%)
    else {
      const repId = honestIds[Math.floor(prng() * honestIds.length)];
      const node = cluster.replicas.get(repId);
      await persistEngineToStore(node.backend, node.engine);
      const recovery = await recoverFromStoreOnBoot(node.backend, cluster.collectionId, node.id, {
        authorPrivateKeyHex: node.keyPair.privateKeyHex,
      });
      if (!recovery.ok || !recovery.engine) {
        throw new Error(`Seed ${config.seed}: boot recovery failed for ${repId}: ${recovery.code ?? ""} ${recovery.detail ?? ""}`);
      }
      node.engine = recovery.engine;
      node.engine.meta.remoteSyncEnabled = true;
      event = { type: "CRASH_RESTART", replicaId: repId, skipped: false };
    }

    if (event) {
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
  }

  // Quiescence & final heal
  await network.drainQuiescence(cluster, seenOutboxKeys);

  // Exchange ACKs between all honest replicas
  for (const hId of honestIds) {
    const node = cluster.replicas.get(hId);
    const ack = await createSignedAck(node, node.engine.meta.epochNumber, cluster.collectionId);
    for (const peerId of honestIds) {
      if (peerId !== hId) {
        await network.deliverMessage({
          id: `final-ack-${hId}->${peerId}`,
          kind: "ack",
          fromReplicaId: hId,
          toReplicaId: peerId,
          ack,
          channelPrincipal: { channelId: `chan:${hId}->${peerId}`, channelAuthenticated: true, transportSenderReplicaId: hId },
          deliverAfterStep: 0,
          dropped: false,
        }, cluster);
      }
    }
  }

  await network.drainQuiescence(cluster, seenOutboxKeys);

  const postViolation = checkAllInvariants(cluster, { type: "HEAL" }, config.steps);
  if (postViolation) {
    return {
      seed: config.seed,
      passed: false,
      stepsExecuted: config.steps,
      eventsCount: eventTrace.length,
      violation: postViolation,
      eventTrace,
      skippedEvents,
    };
  }

  // FINAL CONVERGENCE CHECK
  const finalMembers = honestIds.filter((id) => id in cluster.currentCert.memberBindings);

  // Risk D-4: at least 2 members must remain
  assert.ok(
    finalMembers.length >= 2,
    ` Risk D-4: fewer than 2 final members remain in cluster (${finalMembers.length}) on seed ${config.seed}`
  );

  const baseHonest = cluster.replicas.get(finalMembers[0]);
  const expectedVisDigest = visibleDigest(baseHonest.engine);
  const expectedEntDigest = entriesDigest(baseHonest.engine);

  for (let i = 1; i < finalMembers.length; i++) {
    const honest = cluster.replicas.get(finalMembers[i]);
    const visDigest = visibleDigest(honest.engine);
    const entDigest = entriesDigest(honest.engine);

    if (visDigest !== expectedVisDigest) {
      const violation = {
        invariant: "quiescent_convergence",
        replicaId: honest.id,
        stepIndex: config.steps,
        event: { type: "HEAL" },
        detail: `Visible digest divergence between ${baseHonest.id} (${expectedVisDigest}) and ${honest.id} (${visDigest})`,
        specClause: "I24",
      };
      return {
        seed: config.seed,
        passed: false,
        stepsExecuted: config.steps,
        eventsCount: eventTrace.length,
        violation,
        eventTrace,
        skippedEvents,
        visibleDigestMismatch: {
          [baseHonest.id]: expectedVisDigest,
          [honest.id]: visDigest,
        },
      };
    }

    if (entDigest !== expectedEntDigest) {
      const violation = {
        invariant: "quiescent_convergence",
        replicaId: honest.id,
        stepIndex: config.steps,
        event: { type: "HEAL" },
        detail: `Entry state digest divergence between ${baseHonest.id} (${expectedEntDigest}) and ${honest.id} (${entDigest})`,
        specClause: "I24",
      };
      return {
        seed: config.seed,
        passed: false,
        stepsExecuted: config.steps,
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
    stepsExecuted: config.steps,
    eventsCount: eventTrace.length,
    eventTrace,
    skippedEvents,
  };
}

