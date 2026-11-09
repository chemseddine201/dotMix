/**
 * @mix/sync — Lamport Clocks & Mutation ID Sequencing
 */

import type { MutationId } from "../types.js";

let localSequence = 0;
let defaultClientId = "";

export function generateClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "client-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
}

export function getDefaultClientId(): string {
  if (!defaultClientId) {
    defaultClientId = generateClientId();
  }
  return defaultClientId;
}

export class LamportClock {
  private time: number;
  private readonly clientId: string;

  constructor(clientId: string = getDefaultClientId(), initialTime = 0) {
    this.clientId = clientId;
    this.time = initialTime;
  }

  get currentTime(): number {
    return this.time;
  }

  tick(): MutationId {
    this.time = Math.max(this.time + 1, Date.now());
    localSequence++;
    return {
      timestamp: this.time,
      clientId: this.clientId,
      sequence: localSequence,
    };
  }

  witness(remoteTime: number): void {
    this.time = Math.max(this.time, remoteTime) + 1;
  }
}

export function formatMutationId(id: MutationId): string {
  return `${id.timestamp}-${id.clientId}-${id.sequence}`;
}

export function parseMutationId(str: string): MutationId {
  const parts = str.split("-");
  return {
    timestamp: Number(parts[0] || 0),
    clientId: parts.slice(1, -1).join("-"),
    sequence: Number(parts[parts.length - 1] || 0),
  };
}

export function compareMutationIds(a: MutationId, b: MutationId): number {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp - b.timestamp;
  }
  if (a.clientId !== b.clientId) {
    return a.clientId < b.clientId ? -1 : 1;
  }
  return a.sequence - b.sequence;
}
