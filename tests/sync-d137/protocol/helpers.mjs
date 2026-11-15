/**
 * Protocol test helpers for D-137 tests
 */
import {
  D137Engine,
  computeCertificateSigningPayload,
  computeOperationDigest,
  computeOperationSigningPayload,
  generateSigningKeyPair,
  signPayloadAsync,
  canonicalizeValue,
  sha256Hex,
  materializeVisibleArray,
  PROTOCOL_VERSION,
} from "../../../packages/sync/dist/protocol/index.js";

export async function makeCluster(ids = ["A", "B", "C"], opts = {}) {
  const epoch = opts.epoch ?? 1;
  const keys = { ...(opts.keys ?? {}) };
  for (const id of ids) {
    if (!keys[id]) keys[id] = await generateSigningKeyPair("Ed25519", true);
  }

  const certDraft = {
    protocolVersion: PROTOCOL_VERSION,
    collectionId: "todos",
    epochNumber: epoch,
    epochCertificateId: opts.certId ?? `cert-epoch-${epoch}`,
    coordinatorReplicaId: ids[0],
    coordinatorKeyId: `key:${ids[0]}:v1`,
    memberBindings: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          role: "WRITER_REPLICA",
          authorKeyId: `key:${id}:v1`,
          authorPublicKeyHex: keys[id].publicKeyHex,
          signingAlgorithm: "Ed25519",
        },
      ])
    ),
    baselineStableFrontier: Object.fromEntries(ids.map((id) => [`${epoch}:${id}`, 0])),
    coordinatorSignature: "",
  };

  const coordinatorSignature = await signPayloadAsync(
    computeCertificateSigningPayload(certDraft),
    keys[ids[0]].privateKeyHex,
    "Ed25519"
  );
  const cert = { ...certDraft, coordinatorSignature };

  const e = {};
  for (const id of ids) {
    e[id] = new D137Engine("todos", id, epoch, cert, `key:${id}:v1`, keys[id].privateKeyHex);
  }

  for (const id of opts.observers ?? []) {
    e[id] = new D137Engine("todos", id, epoch, cert, `key:${id}:v1`);
  }

  return { keys, cert, e };
}

export const chan = (sender) => ({
  channelId: `c-${sender}`,
  channelAuthenticated: true,
  transportSenderReplicaId: sender,
});

export async function alloc(engine, input) {
  const r = await engine.allocateLocalMutation(input);
  if (!r.ok || !r.op) throw new Error(`allocation failed: ${r.code} ${r.detail}`);
  return r.op;
}

export async function resign(op, changes, privHex) {
  const draft = { ...op, ...changes };
  const payloadDigest = computeOperationDigest(draft);
  const authorSignature = await signPayloadAsync(
    computeOperationSigningPayload({ ...draft, payloadDigest }),
    privHex,
    "Ed25519"
  );
  return { ...draft, payloadDigest, authorSignature };
}

export async function deliver(engine, ops) {
  const out = [];
  for (const op of ops) {
    const r = await engine.ingestRemoteOperation(op, chan(op.opDot.replicaId));
    out.push({
      opKey: `${op.opDot.epochNumber}:${op.opDot.replicaId}:${op.opDot.sequence}`,
      ok: r.ok,
      disposition: r.disposition,
      code: r.code,
    });
  }
  return out;
}

export function entriesDigest(engine) {
  const sorted = [...engine.entriesState.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(canonicalizeValue(sorted));
}

export function visibleDigest(engine) {
  return sha256Hex(canonicalizeValue(materializeVisibleArray(engine.entriesState).items));
}

export function newObserver(c, id) {
  return new D137Engine("todos", id, c.cert.epochNumber, c.cert, `key:${id}:v1`);
}

export function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, prng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
