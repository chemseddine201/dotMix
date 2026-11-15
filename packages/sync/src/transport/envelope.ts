/**
 * @dotmix/sync — Wire Envelope & Gate 33 Strict Decoding (Gate 34 / T-34.5)
 *
 * All wire payloads exchanged between replicas, multi-tab coordinators, and the
 * reference coordinator are packaged inside a WireEnvelope and decoded strictly
 * through the Gate 33 decoder with zero external dependencies.
 */

import {
  decodeWireOperation,
  type DecodeResult,
  type EpochMembershipCertificate,
  PROTOCOL_VERSION,
  type ReplicableOperation,
} from "../protocol/types.js";
import { D137_V331_LIMITS } from "../protocol/limits.js";
import { computeCanonicalByteSize } from "../protocol/canonical.js";
import type { StreamRangeRequest, StreamRangeResponse } from "../protocol/antientropy.js";
import type { DurableAckMessage } from "../protocol/types.js";

export type WireEnvelopeType =
  | "op"
  | "ack"
  | "serverAck"
  | "serverReject"
  | "bootstrap"
  | "cert"
  | "rangeRequest"
  | "rangeResponse";

export interface ServerAckPayload {
  readonly opKey?: string | undefined;
  readonly originStreamKey?: string | undefined;
  readonly sequenceNumber?: number | undefined;
  readonly serverTimestamp: number;
}

export interface ServerRejectPayload {
  readonly opKey?: string | undefined;
  readonly errorCode: string;
  readonly reason: string;
  readonly compensationAction?: string | undefined;
}

export interface BootstrapPayload {
  readonly certificate: EpochMembershipCertificate;
  readonly assignedReplicaId?: string | undefined;
  readonly initialFrontier?: Record<string, number> | undefined;
}

export interface WireEnvelope<TPayload = unknown> {
  readonly protocolVersion: string;
  readonly type: WireEnvelopeType;
  readonly collectionId: string;
  readonly senderReplicaId: string;
  readonly payload: TPayload;
  readonly timestamp: number;
  readonly signature?: string | undefined;
}

const ALLOWED_ENVELOPE_KEYS = new Set([
  "protocolVersion",
  "type",
  "collectionId",
  "senderReplicaId",
  "payload",
  "timestamp",
  "signature",
]);

const VALID_ENVELOPE_TYPES = new Set<WireEnvelopeType>([
  "op",
  "ack",
  "serverAck",
  "serverReject",
  "bootstrap",
  "cert",
  "rangeRequest",
  "rangeResponse",
]);

function isObjectRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
}

function findDisallowedPropertyKey(
  targetRecord: Record<string, unknown>,
  allowedPropertyKeys: Set<string>
): string | null {
  for (const propertyKey of Object.keys(targetRecord)) {
    if (!allowedPropertyKeys.has(propertyKey)) return propertyKey;
  }
  return null;
}

function validateDurableAckMessage(rawPayload: unknown): DecodeResult<DurableAckMessage> {
  if (!isObjectRecord(rawPayload)) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "ACK payload must be an object" };
  }
  if (typeof rawPayload["collectionId"] !== "string" || !rawPayload["collectionId"]) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "ACK collectionId must be non-empty string" };
  }
  if (typeof rawPayload["fromReplicaId"] !== "string" || !rawPayload["fromReplicaId"]) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "ACK fromReplicaId must be non-empty string" };
  }
  if (typeof rawPayload["epochNumber"] !== "number" || !Number.isInteger(rawPayload["epochNumber"]) || rawPayload["epochNumber"] < 1) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "ACK epochNumber must be positive integer" };
  }
  if (!isObjectRecord(rawPayload["durableFrontier"])) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "ACK durableFrontier must be an object" };
  }
  return { ok: true, value: rawPayload as unknown as DurableAckMessage };
}

function validateStreamRangeRequest(rawPayload: unknown): DecodeResult<StreamRangeRequest> {
  if (!isObjectRecord(rawPayload)) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "rangeRequest must be an object" };
  }
  const requiredStringProperties = ["collectionId", "requesterReplicaId", "targetReplicaId", "streamKey"];
  for (const propertyName of requiredStringProperties) {
    if (typeof rawPayload[propertyName] !== "string" || !rawPayload[propertyName]) {
      return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: `rangeRequest ${propertyName} must be string` };
    }
  }
  const fromSeq = rawPayload["fromSeq"];
  const toSeq = rawPayload["toSeq"];
  if (typeof fromSeq !== "number" || typeof toSeq !== "number" || fromSeq < 1 || toSeq < fromSeq) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "rangeRequest fromSeq/toSeq invalid" };
  }
  return { ok: true, value: rawPayload as unknown as StreamRangeRequest };
}

function validateStreamRangeResponse(rawPayload: unknown): DecodeResult<StreamRangeResponse> {
  if (!isObjectRecord(rawPayload)) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "rangeResponse must be an object" };
  }
  if (!Array.isArray(rawPayload["operations"])) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "rangeResponse operations must be array" };
  }
  const decodedOperations: ReplicableOperation[] = [];
  for (let operationIndex = 0; operationIndex < rawPayload["operations"].length; operationIndex++) {
    const operationDecodeResult = decodeWireOperation(rawPayload["operations"][operationIndex]);
    if (!operationDecodeResult.ok) {
      return {
        ok: false,
        code: operationDecodeResult.code,
        detail: `rangeResponse operation at index ${operationIndex} failed: ${operationDecodeResult.detail}`,
      };
    }
    decodedOperations.push(operationDecodeResult.value);
  }
  return {
    ok: true,
    value: {
      ...(rawPayload as unknown as StreamRangeResponse),
      operations: decodedOperations,
    },
  };
}

function validateServerAck(rawPayload: unknown): DecodeResult<ServerAckPayload> {
  if (!isObjectRecord(rawPayload)) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "serverAck payload must be an object" };
  }
  if (typeof rawPayload["serverTimestamp"] !== "number") {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "serverAck serverTimestamp must be number" };
  }
  return { ok: true, value: rawPayload as unknown as ServerAckPayload };
}

function validateServerReject(rawPayload: unknown): DecodeResult<ServerRejectPayload> {
  if (!isObjectRecord(rawPayload)) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "serverReject payload must be an object" };
  }
  if (typeof rawPayload["errorCode"] !== "string" || !rawPayload["errorCode"]) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "serverReject errorCode must be non-empty string" };
  }
  if (typeof rawPayload["reason"] !== "string") {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "serverReject reason must be string" };
  }
  return { ok: true, value: rawPayload as unknown as ServerRejectPayload };
}

function validateCertificateStructure(rawCandidate: unknown): DecodeResult<EpochMembershipCertificate> {
  if (!isObjectRecord(rawCandidate)) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Certificate must be an object" };
  }
  if (rawCandidate["protocolVersion"] !== PROTOCOL_VERSION) {
    return { ok: false, code: "D137_PROTOCOL_VERSION_MISMATCH", detail: "Invalid certificate protocolVersion" };
  }
  const requiredStringProperties = [
    "collectionId",
    "epochCertificateId",
    "coordinatorReplicaId",
    "coordinatorKeyId",
    "coordinatorSignature",
  ];
  for (const propertyName of requiredStringProperties) {
    if (typeof rawCandidate[propertyName] !== "string" || !rawCandidate[propertyName]) {
      return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: `Certificate ${propertyName} must be non-empty string` };
    }
  }
  if (
    typeof rawCandidate["epochNumber"] !== "number" ||
    !Number.isInteger(rawCandidate["epochNumber"]) ||
    rawCandidate["epochNumber"] < 1
  ) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Certificate epochNumber must be positive integer" };
  }
  if (!isObjectRecord(rawCandidate["memberBindings"]) || !isObjectRecord(rawCandidate["baselineStableFrontier"])) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Certificate bindings/frontier must be objects" };
  }
  return { ok: true, value: rawCandidate as unknown as EpochMembershipCertificate };
}

function validateBootstrap(rawPayload: unknown): DecodeResult<BootstrapPayload> {
  if (!isObjectRecord(rawPayload)) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "bootstrap payload must be an object" };
  }
  const certificateResult = validateCertificateStructure(rawPayload["certificate"]);
  if (!certificateResult.ok) {
    return certificateResult;
  }
  return {
    ok: true,
    value: {
      certificate: certificateResult.value,
      assignedReplicaId: typeof rawPayload["assignedReplicaId"] === "string" ? rawPayload["assignedReplicaId"] : undefined,
      initialFrontier: isObjectRecord(rawPayload["initialFrontier"]) ? (rawPayload["initialFrontier"] as Record<string, number>) : undefined,
    },
  };
}

/**
 * Gate 33 Strict Wire Envelope Decoder
 */
export function decodeWireEnvelope(rawEnvelope: unknown): DecodeResult<WireEnvelope> {
  if (!isObjectRecord(rawEnvelope)) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Wire envelope must be an object" };
  }

  const payloadByteSize = computeCanonicalByteSize(rawEnvelope);
  if (payloadByteSize > D137_V331_LIMITS.MAX_WIRE_MESSAGE_BYTES) {
    return {
      ok: false,
      code: "D137_WIRE_MESSAGE_TOO_LARGE",
      detail: `Wire envelope size (${payloadByteSize} bytes) exceeds limit (${D137_V331_LIMITS.MAX_WIRE_MESSAGE_BYTES} bytes)`,
    };
  }

  const disallowedPropertyKey = findDisallowedPropertyKey(rawEnvelope, ALLOWED_ENVELOPE_KEYS);
  if (disallowedPropertyKey) {
    return {
      ok: false,
      code: "D137_WIRE_UNKNOWN_FIELD",
      detail: `Unknown field '${disallowedPropertyKey}' in wire envelope`,
    };
  }

  if (rawEnvelope["protocolVersion"] !== PROTOCOL_VERSION) {
    return {
      ok: false,
      code: "D137_PROTOCOL_VERSION_MISMATCH",
      detail: `Unsupported envelope protocol version: '${String(rawEnvelope["protocolVersion"])}'`,
    };
  }

  const envelopeType = rawEnvelope["type"] as WireEnvelopeType;
  if (!VALID_ENVELOPE_TYPES.has(envelopeType)) {
    return {
      ok: false,
      code: "D137_WIRE_TYPE_MISMATCH",
      detail: `Unknown wire envelope type: '${String(rawEnvelope["type"])}'`,
    };
  }

  if (typeof rawEnvelope["collectionId"] !== "string" || !rawEnvelope["collectionId"]) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Envelope collectionId must be non-empty string" };
  }
  if (typeof rawEnvelope["senderReplicaId"] !== "string" || !rawEnvelope["senderReplicaId"]) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Envelope senderReplicaId must be non-empty string" };
  }
  if (typeof rawEnvelope["timestamp"] !== "number" || rawEnvelope["timestamp"] <= 0) {
    return { ok: false, code: "D137_WIRE_TYPE_MISMATCH", detail: "Envelope timestamp must be positive integer" };
  }

  const rawPayload = rawEnvelope["payload"];

  // Strict payload decoding based on envelope type
  let decodedPayload: unknown;
  if (envelopeType === "op") {
    const operationDecodeResult = decodeWireOperation(rawPayload);
    if (!operationDecodeResult.ok) return operationDecodeResult;
    decodedPayload = operationDecodeResult.value;
  } else if (envelopeType === "ack") {
    const ackValidationResult = validateDurableAckMessage(rawPayload);
    if (!ackValidationResult.ok) return ackValidationResult;
    decodedPayload = ackValidationResult.value;
  } else if (envelopeType === "serverAck") {
    const serverAckResult = validateServerAck(rawPayload);
    if (!serverAckResult.ok) return serverAckResult;
    decodedPayload = serverAckResult.value;
  } else if (envelopeType === "serverReject") {
    const serverRejectResult = validateServerReject(rawPayload);
    if (!serverRejectResult.ok) return serverRejectResult;
    decodedPayload = serverRejectResult.value;
  } else if (envelopeType === "bootstrap") {
    const bootstrapResult = validateBootstrap(rawPayload);
    if (!bootstrapResult.ok) return bootstrapResult;
    decodedPayload = bootstrapResult.value;
  } else if (envelopeType === "cert") {
    const certificateResult = validateCertificateStructure(rawPayload);
    if (!certificateResult.ok) return certificateResult;
    decodedPayload = certificateResult.value;
  } else if (envelopeType === "rangeRequest") {
    const rangeRequestResult = validateStreamRangeRequest(rawPayload);
    if (!rangeRequestResult.ok) return rangeRequestResult;
    decodedPayload = rangeRequestResult.value;
  } else if (envelopeType === "rangeResponse") {
    const rangeResponseResult = validateStreamRangeResponse(rawPayload);
    if (!rangeResponseResult.ok) return rangeResponseResult;
    decodedPayload = rangeResponseResult.value;
  }

  return {
    ok: true,
    value: {
      protocolVersion: PROTOCOL_VERSION,
      type: envelopeType,
      collectionId: rawEnvelope["collectionId"],
      senderReplicaId: rawEnvelope["senderReplicaId"],
      payload: decodedPayload,
      timestamp: rawEnvelope["timestamp"],
      signature: typeof rawEnvelope["signature"] === "string" ? rawEnvelope["signature"] : undefined,
    },
  };
}

/**
 * Creates a valid D-137 wire envelope.
 */
export function createWireEnvelope<TPayload>(
  envelopeType: WireEnvelopeType,
  collectionId: string,
  senderReplicaId: string,
  payload: TPayload,
  signature?: string
): WireEnvelope<TPayload> {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: envelopeType,
    collectionId,
    senderReplicaId,
    payload,
    timestamp: Date.now(),
    signature,
  };
}
