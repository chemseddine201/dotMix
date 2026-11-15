/**
 * D137-v33-reference: Randomized Multi-Replica Convergence Test Suite
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  D137Engine,
  generateSigningKeyPair,
  canonicalizeValue,
  sha256Hex,
  computeOperationDigest,
  computeOperationSigningPayload,
  signPayloadAsync,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";
import { mulberry32, shuffle } from "./helpers.mjs";

describe("D-137 v3.3.1 Randomized Convergence Suite", () => {
  it("Verifies 100 randomized delivery permutations converge to identical state digests", async () => {
    const keyA = await generateSigningKeyPair("Ed25519", true);
    const keyB = await generateSigningKeyPair("Ed25519", true);
    const cert = {
      protocolVersion: PROTOCOL_VERSION,
      collectionId: "todos",
      epochNumber: 1,
      epochCertificateId: "cert-rand-1",
      coordinatorReplicaId: "A",
      coordinatorKeyId: "key:A:v1",
      memberBindings: {
        "A": { role: "WRITER_REPLICA", authorKeyId: "key:A:v1", authorPublicKeyHex: keyA.publicKeyHex, signingAlgorithm: "Ed25519" },
        "B": { role: "WRITER_REPLICA", authorKeyId: "key:B:v1", authorPublicKeyHex: keyB.publicKeyHex, signingAlgorithm: "Ed25519" },
      },
      baselineStableFrontier: { "1:A": 0, "1:B": 0 },
      coordinatorSignature: "sig",
    };

    const producerA = new D137Engine("todos", "A", 1, cert, "key:A:v1", keyA.privateKeyHex);
    const producerB = new D137Engine("todos", "B", 1, cert, "key:B:v1", keyB.privateKeyHex);

    const opsA = [];
    for (let i = 1; i <= 5; i++) {
      opsA.push((await producerA.allocateLocalMutation({ kind: "insert", externalId: `task-A-${i}`, initialFields: { v: i } })).op);
    }

    const opsB = [];
    for (let i = 1; i <= 3; i++) {
      opsB.push((await producerB.allocateLocalMutation({ kind: "insert", externalId: `task-B-${i}`, initialFields: { v: i } })).op);
    }

    const draftFork = { ...opsB[2], initialFields: { v: 9999 } };
    const payloadDigestFork = computeOperationDigest(draftFork);
    const signingPayloadFork = computeOperationSigningPayload({ ...draftFork, payloadDigest: payloadDigestFork });
    const authorSignatureFork = await signPayloadAsync(signingPayloadFork, keyB.privateKeyHex, "Ed25519");
    const opB3Fork = { ...draftFork, payloadDigest: payloadDigestFork, authorSignature: authorSignatureFork };

    const channelA = { channelId: "c-A", channelAuthenticated: true, transportSenderReplicaId: "A" };
    const channelB = { channelId: "c-B", channelAuthenticated: true, transportSenderReplicaId: "B" };

    let totalSeedsPassed = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const prng = mulberry32(seed);

      const r1 = new D137Engine("todos", "R1", 1, cert, "key:A:v1", keyA.privateKeyHex);
      const r2 = new D137Engine("todos", "R2", 1, cert, "key:A:v1", keyA.privateKeyHex);

      const streamForR1 = shuffle([...opsA, ...opsB, opB3Fork], prng);
      const streamForR2 = shuffle([...opsA, ...opsB, opB3Fork], prng);

      for (const op of streamForR1) {
        const chan = op.opDot.replicaId === "A" ? channelA : channelB;
        await r1.ingestRemoteOperation(op, chan);
      }

      for (const op of streamForR2) {
        const chan = op.opDot.replicaId === "A" ? channelA : channelB;
        await r2.ingestRemoteOperation(op, chan);
      }

      const digestR1 = sha256Hex(canonicalizeValue([...r1.entriesState.entries()].sort()));
      const digestR2 = sha256Hex(canonicalizeValue([...r2.entriesState.entries()].sort()));

      assert.equal(digestR1, digestR2, `Seed ${seed}: R1 and R2 state digests must match!`);
      assert.equal(r1.meta.frontiers.localDurableFrontier["1:B"], 0, `Seed ${seed}: B must be excised down to baseline 0`);
      assert.equal(r2.meta.frontiers.localDurableFrontier["1:B"], 0, `Seed ${seed}: B must be excised down to baseline 0`);
      totalSeedsPassed++;
    }

    assert.equal(totalSeedsPassed, 100);
  });
});

