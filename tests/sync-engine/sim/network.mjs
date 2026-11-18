/**
 * Simulated network with reorder, duplicate, drop-as-delay, and partition/heal
 */

import {
  recomputeStableFrontier,
  checkAntiEntropyNeeds,
  createStreamRangeRequest,
  handleStreamRangeRequest,
  ingestStreamRangeResponse,
  AntiEntropyRateLimiter,
  ANTI_ENTROPY_LIMITS,
} from "../../../packages/sync/dist/protocol/index.js";
import { checkDropRecoveryCapability } from "./capabilities.mjs";

export class SimNetwork {
  messages = [];
  messageCounter = 0;
  currentStep = 0;
  partitionMap = new Map();
  rateLimiters = new Map();

  getRateLimiter(responderId) {
    let limiter = this.rateLimiters.get(responderId);
    if (!limiter) {
      limiter = new AntiEntropyRateLimiter();
      this.rateLimiters.set(responderId, limiter);
    }
    return limiter;
  }

  stepTick() {
    this.currentStep++;
  }

  getCurrentStep() {
    return this.currentStep;
  }

  getInFlightCount() {
    return this.messages.length;
  }

  setPartitions(groups) {
    this.partitionMap.clear();
    for (let groupId = 0; groupId < groups.length; groupId++) {
      for (const replicaId of groups[groupId]) {
        this.partitionMap.set(replicaId, groupId);
      }
    }
  }

  healPartitions() {
    this.partitionMap.clear();
  }

  canDeliverBetween(fromId, toId) {
    const fromGroup = this.partitionMap.get(fromId);
    const toGroup = this.partitionMap.get(toId);
    if (fromGroup !== undefined && toGroup !== undefined && fromGroup !== toGroup) {
      return false;
    }
    return true;
  }

  canDeliver(msg) {
    if (this.currentStep < msg.deliverAfterStep) {
      return false;
    }
    return this.canDeliverBetween(msg.fromReplicaId, msg.toReplicaId);
  }

  broadcastOperation(fromReplicaId, cluster, operation) {
    const created = [];
    for (const toId of cluster.replicaIds) {
      if (toId !== fromReplicaId) {
        created.push(this.sendOperation(fromReplicaId, toId, operation));
      }
    }
    return created;
  }

  sendOperation(fromReplicaId, toReplicaId, operation) {
    const id = `msg-${++this.messageCounter}`;
    const channelPrincipal = {
      channelId: `chan:${fromReplicaId}->${toReplicaId}`,
      channelAuthenticated: true,
      transportSenderReplicaId: fromReplicaId,
    };
    const msg = {
      id,
      kind: "operation",
      fromReplicaId,
      toReplicaId,
      operation,
      channelPrincipal,
      deliverAfterStep: this.currentStep,
      dropped: false,
    };
    this.messages.push(msg);
    return msg;
  }

  broadcastAck(fromReplicaId, cluster, ack) {
    const created = [];
    for (const toId of cluster.replicaIds) {
      if (toId !== fromReplicaId) {
        created.push(this.sendAck(fromReplicaId, toId, ack));
      }
    }
    return created;
  }

  sendAck(fromReplicaId, toReplicaId, ack) {
    const id = `ack-${++this.messageCounter}`;
    const channelPrincipal = {
      channelId: `chan-ack:${fromReplicaId}->${toReplicaId}`,
      channelAuthenticated: true,
      transportSenderReplicaId: fromReplicaId,
    };
    const msg = {
      id,
      kind: "ack",
      fromReplicaId,
      toReplicaId,
      ack,
      channelPrincipal,
      deliverAfterStep: this.currentStep,
      dropped: false,
    };
    this.messages.push(msg);
    return msg;
  }

  broadcastCertificate(fromReplicaId, cluster, certificate) {
    const created = [];
    for (const toId of cluster.replicaIds) {
      created.push(this.sendCertificate(fromReplicaId, toId, certificate));
    }
    return created;
  }

  sendCertificate(fromReplicaId, toReplicaId, certificate) {
    const id = `cert-msg-${++this.messageCounter}`;
    const channelPrincipal = {
      channelId: `chan-cert:${fromReplicaId}->${toReplicaId}`,
      channelAuthenticated: true,
      transportSenderReplicaId: fromReplicaId,
    };
    const msg = {
      id,
      kind: "certificate",
      fromReplicaId,
      toReplicaId,
      certificate,
      channelPrincipal,
      deliverAfterStep: this.currentStep,
      dropped: false,
    };
    this.messages.push(msg);
    return msg;
  }

  flushOutboxes(cluster, seenOutboxKeys) {
    const created = [];
    for (const [repId, node] of cluster.replicas) {
      for (const [opKey, entry] of node.engine.syncOutbox) {
        if (!seenOutboxKeys.has(opKey)) {
          seenOutboxKeys.add(opKey);
          created.push(...this.broadcastOperation(repId, cluster, entry.operation));
        }
      }
    }
    return created;
  }

  duplicateMessage(msg) {
    const dup = {
      ...msg,
      id: `${msg.id}-dup-${++this.messageCounter}`,
      deliverAfterStep: this.currentStep,
    };
    this.messages.push(dup);
    return dup;
  }

  dropMessage(msg, delaySteps) {
    const dropCap = checkDropRecoveryCapability();
    if (!dropCap.supported) {
      msg.deliverAfterStep = this.currentStep + delaySteps;
      msg.dropped = true;
      return { dropped: true, delayedUntil: msg.deliverAfterStep };
    }
    const idx = this.messages.indexOf(msg);
    if (idx !== -1) {
      this.messages.splice(idx, 1);
    }
    return { dropped: true, delayedUntil: -1 };
  }

  getDeliverableMessages() {
    return this.messages.filter((m) => this.canDeliver(m));
  }

  async deliverMessage(msg, cluster) {
    const idx = this.messages.indexOf(msg);
    if (idx !== -1) {
      this.messages.splice(idx, 1);
    }
    const node = cluster.replicas.get(msg.toReplicaId);
    if (!node) {
      return { ok: false, code: "SIM_UNKNOWN_REPLICA", detail: `Unknown replica ${msg.toReplicaId}` };
    }
    if (msg.kind === "operation" && msg.operation) {
      return await node.engine.ingestRemoteOperation(msg.operation, msg.channelPrincipal);
    }
    if (msg.kind === "certificate" && msg.certificate) {
      const res = await node.engine.ingestEpochTransitionCertificate(msg.certificate);
      if (!res.ok && res.code === "SYNC_EPOCH_TRANSITION_NOT_READY") {
        msg.deliverAfterStep = this.currentStep + 1;
        this.messages.push(msg);
      }
      return res;
    }
    if (msg.kind === "ack" && msg.ack) {
      const anyEngine = node.engine;
      if (typeof anyEngine.ingestDurableAck === "function") {
        return await anyEngine.ingestDurableAck(msg.ack);
      }
      if (typeof anyEngine.ingestDurableAckMessage === "function") {
        return await anyEngine.ingestDurableAckMessage(msg.ack);
      }
      if (!node.engine.meta.clusterAcks[msg.fromReplicaId]) {
        node.engine.meta.clusterAcks[msg.fromReplicaId] = {};
      }
      for (const [sKey, seq] of Object.entries(msg.ack.durableFrontier)) {
        node.engine.meta.clusterAcks[msg.fromReplicaId][sKey] = seq;
      }
      recomputeStableFrontier(node.engine.meta);
      return { ok: true };
    }
    return { ok: true };
  }

  async executeAntiEntropy(cluster, seenOutboxKeys) {
    const seen = seenOutboxKeys ?? new Set();
    let totalRecovered = 0;
    const honestNodes = [...cluster.replicas.values()].filter((n) => !n.isByzantine);

    for (const nodeA of honestNodes) {
      const gapRequests = checkAntiEntropyNeeds(nodeA.engine);
      for (const req of gapRequests) {
        for (const nodeB of honestNodes) {
          if (nodeB.id === nodeA.id) continue;
          if (!this.canDeliverBetween(nodeB.id, nodeA.id)) continue;
          try {
            const handleRes = await handleStreamRangeRequest(nodeB.engine, req, this.getRateLimiter(nodeB.id));
            if (handleRes.ok && handleRes.response && handleRes.response.operations.length > 0) {
              const ingestRes = await ingestStreamRangeResponse(nodeA.engine, handleRes.response);
              if (ingestRes.ok && ingestRes.countApplied) {
                totalRecovered += ingestRes.countApplied;
                break;
              }
            }
          } catch {
            // ignore
          }
        }
      }

      const allStreamKeys = new Set();
      for (const nodeB of honestNodes) {
        for (const s of Object.keys(nodeB.engine.meta.frontiers.localDurableFrontier)) {
          allStreamKeys.add(s);
        }
      }

      for (const streamKey of allStreamKeys) {
        if (nodeA.engine.meta.activeEpochEquivocations[streamKey]) continue;
        const localSeq = nodeA.engine.meta.frontiers.localDurableFrontier[streamKey] ?? 0;
        let bestPeer = null;
        let maxPeerSeq = localSeq;

        const authorId = streamKey.split(":")[1];
        if (authorId) {
          const authorNode = cluster.replicas.get(authorId);
          if (authorNode && !authorNode.isByzantine && this.canDeliverBetween(authorNode.id, nodeA.id)) {
            const authSeq = authorNode.engine.meta.frontiers.localDurableFrontier[streamKey] ?? 0;
            if (authSeq > localSeq) {
              bestPeer = authorNode;
              maxPeerSeq = authSeq;
            }
          }
        }

        if (!bestPeer) {
          for (const nodeB of honestNodes) {
            if (nodeB.id === nodeA.id) continue;
            if (!this.canDeliverBetween(nodeB.id, nodeA.id)) continue;
            const bSeq = nodeB.engine.meta.frontiers.localDurableFrontier[streamKey] ?? 0;
            if (bSeq > maxPeerSeq) {
              bestPeer = nodeB;
              maxPeerSeq = bSeq;
            }
          }
        }

        if (bestPeer && maxPeerSeq > localSeq) {
          const fromSeq = localSeq + 1;
          const toSeq = Math.min(maxPeerSeq, fromSeq + ANTI_ENTROPY_LIMITS.MAX_RANGE_REQUEST_SPAN - 1);
          try {
            const req = createStreamRangeRequest(nodeA.engine, streamKey, fromSeq, toSeq, bestPeer.id);
            const handleRes = await handleStreamRangeRequest(bestPeer.engine, req, this.getRateLimiter(bestPeer.id));
            if (handleRes.ok && handleRes.response && handleRes.response.operations.length > 0) {
              const ingestRes = await ingestStreamRangeResponse(nodeA.engine, handleRes.response);
              if (ingestRes.ok && ingestRes.countApplied) {
                totalRecovered += ingestRes.countApplied;
              }
            }
          } catch {
            // ignore
          }
        }
      }
    }

    for (const nodeA of honestNodes) {
      for (const [streamKey, eqRec] of Object.entries(nodeA.engine.meta.activeEpochEquivocations)) {
        for (const nodeB of honestNodes) {
          if (nodeB.id === nodeA.id) continue;
          const bEq = nodeB.engine.meta.activeEpochEquivocations[streamKey];
          if (bEq && bEq.firstEquivocatedSeq <= eqRec.firstEquivocatedSeq) continue;
          if (!this.canDeliverBetween(nodeA.id, nodeB.id)) continue;

          const opsToSend = [
            ...(eqRec.conflictingOps ?? []),
            ...[...nodeA.engine.mutationJournal.values()]
              .filter((j) => `${j.epochNumber}:${j.replicaId}` === streamKey && j.sequence >= eqRec.firstEquivocatedSeq)
              .map((j) => j.operation),
          ];

          for (const op of opsToSend) {
            const chan = {
              channelId: `equivocation-evidence:${nodeA.id}->${nodeB.id}`,
              channelAuthenticated: true,
              transportSenderReplicaId: nodeA.id,
            };
            await nodeB.engine.ingestRemoteOperation(op, chan);
            const updatedBEq = nodeB.engine.meta.activeEpochEquivocations[streamKey];
            if (updatedBEq && updatedBEq.firstEquivocatedSeq <= eqRec.firstEquivocatedSeq) {
              totalRecovered++;
              break;
            }
          }
        }
      }
    }

    if (totalRecovered > 0) {
      this.flushOutboxes(cluster, seen);
    }
    return totalRecovered;
  }

  async drainQuiescence(cluster, seenOutboxKeys, maxSteps = 1_000_000) {
    this.healPartitions();
    const seen = seenOutboxKeys ?? new Set();
    this.flushOutboxes(cluster, seen);
    for (const msg of this.messages) {
      msg.deliverAfterStep = 0;
    }
    let steps = 0;
    let drainedCount = 0;
    while (steps < maxSteps) {
      steps++;
      this.stepTick();
      const deliverable = this.getDeliverableMessages();
      if (deliverable.length > 0) {
        const msg = deliverable[0];
        await this.deliverMessage(msg, cluster);
        drainedCount++;
        this.flushOutboxes(cluster, seen);
        continue;
      }

      const recovered = await this.executeAntiEntropy(cluster, seen);
      if (recovered > 0) {
        drainedCount += recovered;
        continue;
      }
      const newlyFlushed = this.flushOutboxes(cluster, seen);
      if (newlyFlushed.length === 0 && this.messages.length === 0) {
        break;
      }
    }

    if (this.messages.length > 0) {
      throw new Error(`Simulation did not reach quiescence: ${this.messages.length} messages pending after ${steps} drain steps`);
    }
    return { steps, drainedCount };
  }
}

