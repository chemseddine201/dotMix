/**
 *: Baseline & Differential Oracle Test
 *
 * Compares tools/sync-reference against production core (@dotmix/sync/protocol)
 * over 200 deterministic random seeds.
 *
 * Verifies for every operation:
 * - Return status (`ok`)
 * - Error code (`code`)
 * - Operation disposition (`disposition`)
 *
 * And after ingestion sequence completes:
 * - `visibleDigest()` equality between reference and production
 * - `entriesDigest()` equality between reference and production
 * - Frontiers equality between reference and production
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ReplicationEngine as RefEngine } from "../../../tools/sync-reference/dist/engine.js";
import { generateSigningKeyPair, signPayloadAsync, computeOperationDigest, computeOperationSigningPayload } from "../../../tools/sync-reference/dist/crypto.js";
import { canonicalizeValue, sha256Hex } from "../../../tools/sync-reference/dist/canonicalization.js";
import { materializeVisibleArray } from "../../../tools/sync-reference/dist/crdt.js";
import {
  ReplicationEngine as ProdEngine,
  visibleDigest as prodVisibleDigest,
  entriesDigest as prodEntriesDigest,
  PROTOCOL_VERSION
} from "../../../packages/sync/dist/protocol/index.js";

// Deterministic PRNG
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, prng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

function refVisibleDigest(entriesState) {
  const view = materializeVisibleArray(entriesState);
  return sha256Hex(canonicalizeValue(view.items));
}

function refEntriesDigest(entriesState) {
  const sorted = [...entriesState.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return sha256Hex(canonicalizeValue(sorted));
}

describe(" Baseline & Differential Oracle (200 Seeds)", async () => {
  const keyA = await generateSigningKeyPair("Ed25519", true);
  const keyB = await generateSigningKeyPair("Ed25519", true);
  const keyC = await generateSigningKeyPair("Ed25519", true);

  const cert = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: "todos",
    epochNumber: 1,
    epochCertificateId: "cert-oracle-1",
    coordinatorReplicaId: "A",
    coordinatorKeyId: "key:A:v1",
    memberBindings: {
      "A": { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
      "B": { role: "WRITER_REPLICA", authorKeyId: "key:B:v1", authorPublicKeyHex: keyB.publicKeyHex, signingAlgorithm: "Ed25519" },
      "C": { role: "WRITER_REPLICA", authorKeyId: "key:C:v1", authorPublicKeyHex: keyC.publicKeyHex, signingAlgorithm: "Ed25519" },
    },
    baselineStableFrontier: { "1:A": 0, "1:B": 0, "1:C": 0 },
    coordinatorSignature: "sig-coord",
  };

  const channelA = { channelId: "c-A", channelAuthenticated: true, transportSenderReplicaId: "A" };
  const channelB = { channelId: "c-B", channelAuthenticated: true, transportSenderReplicaId: "B" };

  it("Executes 200 differential seeds against reference engine with 0 divergences", async () => {
    let seedsPassed = 0;

    for (let seed = 1; seed <= 200; seed++) {
      const prng = mulberry32(seed);

      // Create reference producer and prod producer for A and B
      const refA = new RefEngine("todos", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
      const prodA = new ProdEngine("todos", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);

      const refB = new RefEngine("todos", "B", 1, cert, "key:B:v1", keyB.privateKeyHex);
      const prodB = new ProdEngine("todos", "B", 1, cert, "key:B:v1", keyB.privateKeyHex);

      // Create consumer receiver C
      const refC = new RefEngine("todos", "C", 1, cert, "key:C:v1", keyC.privateKeyHex);
      const prodC = new ProdEngine("todos", "C", 1, cert, "key:C:v1", keyC.privateKeyHex);

      const ops = [];

      // Generate mutations on A
      const countA = 3 + Math.floor(prng() * 5); // 3 to 7 ops
      for (let i = 1; i <= countA; i++) {
        const itemId = `task-a-${i}`;
        const refAlloc = await refA.allocateLocalMutation({
          kind: "insert",
          externalId: itemId,
          initialFields: { title: `A task ${i}`, done: false, seed },
        });
        const prodAlloc = await prodA.allocateLocalMutation({
          kind: "insert",
          externalId: itemId,
          initialFields: { title: `A task ${i}`, done: false, seed },
        });

        assert.equal(refAlloc.ok, prodAlloc.ok, `Seed ${seed}: Alloc A ok mismatch`);
        assert.equal(refAlloc.op?.payloadDigest, prodAlloc.op?.payloadDigest, `Seed ${seed}: Alloc A digest mismatch`);
        ops.push(prodAlloc.op);
      }

      // Generate mutations on B
      const countB = 2 + Math.floor(prng() * 4); // 2 to 5 ops
      for (let i = 1; i <= countB; i++) {
        const itemId = `task-b-${i}`;
        const prodAlloc = await prodB.allocateLocalMutation({
          kind: "insert",
          externalId: itemId,
          initialFields: { title: `B task ${i}`, priority: i, seed },
        });
        const refAlloc = await refB.allocateLocalMutation({
          kind: "insert",
          externalId: itemId,
          initialFields: { title: `B task ${i}`, priority: i, seed },
        });

        assert.equal(refAlloc.ok, prodAlloc.ok, `Seed ${seed}: Alloc B ok mismatch`);
        assert.equal(refAlloc.op?.payloadDigest, prodAlloc.op?.payloadDigest, `Seed ${seed}: Alloc B digest mismatch`);
        ops.push(prodAlloc.op);
      }

      // In some seeds, add an update or delete
      if (ops.length >= 2 && prng() > 0.4) {
        const targetOp = ops[0];
        const prodUpdate = await prodA.allocateLocalMutation({
          kind: "update",
          targetIncarnation: targetOp.opDot,
          externalId: targetOp.externalId,
          partialFields: { done: true, modifiedBy: "A" },
        });
        const refUpdate = await refA.allocateLocalMutation({
          kind: "update",
          targetIncarnation: targetOp.opDot,
          externalId: targetOp.externalId,
          partialFields: { done: true, modifiedBy: "A" },
        });
        assert.equal(refUpdate.ok, prodUpdate.ok, `Seed ${seed}: Update ok mismatch`);
        ops.push(prodUpdate.op);
      }

      // In some seeds (seed % 5 === 0), add an authentic equivocated fork from B
      if (seed % 5 === 0 && countB >= 2) {
        const lastBOp = ops.filter(o => o.opDot.replicaId === "B").pop();
        if (lastBOp) {
          const draftFork = { ...lastBOp, initialFields: { title: "Equivocated fork", seed } };
          const payloadDigestFork = computeOperationDigest(draftFork);
          const signingPayloadFork = computeOperationSigningPayload({ ...draftFork, payloadDigest: payloadDigestFork });
          const authorSignatureFork = await signPayloadAsync(signingPayloadFork, keyB.privateKeyHex, "Ed25519");
          const opBFork = { ...draftFork, payloadDigest: payloadDigestFork, authorSignature: authorSignatureFork };
          ops.push(opBFork);
        }
      }

      // Shuffle ops to create out-of-order and gap buffering
      const deliveryOrder = shuffle(ops, prng);

      // Deliver to both RefEngine C and ProdEngine C
      for (const op of deliveryOrder) {
        const channel = op.opDot.replicaId === "A" ? channelA : channelB;
        const refRes = await refC.ingestRemoteOperation(op, channel);
        const prodRes = await prodC.ingestRemoteOperation(op, channel);

        assert.equal(prodRes.ok, refRes.ok, `Seed ${seed} op ${op.opDot.replicaId}:${op.opDot.sequence}: ok mismatch`);
        assert.equal(prodRes.disposition, refRes.disposition, `Seed ${seed} op ${op.opDot.replicaId}:${op.opDot.sequence}: disposition mismatch (${prodRes.disposition} vs ${refRes.disposition})`);
        assert.equal(prodRes.code, refRes.code, `Seed ${seed} op ${op.opDot.replicaId}:${op.opDot.sequence}: code mismatch`);
      }

      // Compare digests
      const rVisDigest = refVisibleDigest(refC.entriesState);
      const pVisDigest = prodVisibleDigest(prodC.entriesState);
      assert.equal(pVisDigest, rVisDigest, `Seed ${seed}: visibleDigest mismatch!`);

      const rEntDigest = refEntriesDigest(refC.entriesState);
      const pEntDigest = prodEntriesDigest(prodC.entriesState);
      assert.equal(pEntDigest, rEntDigest, `Seed ${seed}: entriesDigest mismatch!`);

      // Compare frontiers
      assert.deepEqual(
        prodC.meta.frontiers.localDurableFrontier,
        refC.meta.frontiers.localDurableFrontier,
        `Seed ${seed}: localDurableFrontier mismatch!`
      );

      seedsPassed++;
    }

    assert.equal(seedsPassed, 200, "All 200 seeds must pass without divergence");
  });
});

