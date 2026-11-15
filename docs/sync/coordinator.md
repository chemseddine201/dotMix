# Mix Sync Coordinator: Protocol Specification & Server Contract

## 1. Role & Architectural Boundaries

In the D-137 replication topology, the **Coordinator Server** acts as the authoritative root for cluster membership, cryptographic key binding, and epoch advancement:
- **Topology:** Hybrid star and gossip topology. Clients connect to the coordinator over authenticated WebSocket channels, while co-located browser tabs coordinate locally via `BroadcastChannel` and IndexedDB.
- **Authority Scope:** The coordinator issues epoch certificates, admits or revokes replica members, ratifies baseline stable frontiers, and serves anti-entropy stream range responses.
- **Zero Trust on Payloads:** The coordinator does not synthesize or rewrite operation contents; every replicated operation must be signed by its authoring replica.

---

## 2. Core Protocol Message Flows

Client replicas and the coordinator exchange structured wire envelopes stamped with the active protocol specification (`protocolVersion = "D-137.v3.3.1"`).

```text
 Client Replica                                          Coordinator Server
       |                                                         |
       |-------------------- 1. JOIN (Request) ----------------->|
       |                                                         |
       |<------------------- 2. CERT (Response) -----------------|
       |                                                         |
       |-------------------- 3. OP (Local Mutation) ------------>|
       |<=================== 3. OP (Broadcast to Peers) ========|
       |                                                         |
       |-------------------- 4. ACK (Durable Frontier) --------->|
       |                                                         |
       |-------------------- 5. RANGE (Anti-Entropy Pull) ------>|
       |<------------------- 5. RANGE (Stream Response) ---------|
```

### 2.1 `JOIN`: Replica Enrollment & Key Binding
When a new replica connects to a synchronized collection, it must enroll with the coordinator before emitting durable operations:
```typescript
interface JoinClusterRequest {
  readonly protocolVersion: "D-137.v3.3.1";
  readonly collectionId: string;
  readonly replicaId: string;
  readonly authorKeyId: string;
  readonly authorPublicKeyHex: string;
  readonly requestedRole: "WRITER_REPLICA" | "OBSERVER_REPLICA";
  readonly clientSignature: string;
}
```
The coordinator validates the enrollment request, ensures the `replicaId` contains no invalid delimiters (e.g. `:` is forbidden), registers the public key, and returns an updated epoch certificate.

### 2.2 `CERT`: Epoch Membership Certificates
The epoch certificate establishes the cryptographic boundary for all operations in that epoch:
```typescript
interface EpochMembershipCertificate {
  readonly protocolVersion: "D-137.v3.3.1";
  readonly collectionId: string;
  readonly epochNumber: number;
  readonly epochCertificateId: string;
  readonly coordinatorReplicaId: string;
  readonly coordinatorKeyId: string;
  readonly coordinatorSignature: string;
  readonly memberBindings: Record<string, {
    readonly role: "WRITER_REPLICA" | "OBSERVER_REPLICA" | "COORDINATOR" | "MIGRATION_AUTHORITY";
    readonly authorKeyId: string;
    readonly authorPublicKeyHex: string;
    readonly signingAlgorithm: "ECDSA_P256" | "Ed25519";
  }>;
  readonly baselineStableFrontier: Record<string, number>;
  readonly revokedKeyIds?: readonly string[];
}
```

### 2.3 `OP`: Replicable Operation Broadcast
Operations emitted by writer replicas are forwarded to the coordinator in signed envelopes:
```typescript
interface ReplicableOperationEnvelope {
  readonly kind: "operation";
  readonly collectionId: string;
  readonly senderReplicaId: string;
  readonly operation: ReplicableOperation;
  readonly envelopeSignature?: string;
}
```
The coordinator performs pre-verification:
1. Operation `protocolVersion` matches `D-137.v3.3.1`.
2. Author replica is bound in the active epoch certificate with role `WRITER_REPLICA`.
3. Author signature verifies against the registered public key.
4. Operation dot sequence is greater than the stream's baseline stable frontier floor.
Upon validation, the coordinator broadcasts the operation to all other connected cluster members.

### 2.4 `ACK`: Durable Frontier Acknowledgment
Members regularly acknowledge their local durable progress to the coordinator:
```typescript
interface DurableAckPayload {
  readonly collectionId: string;
  readonly acknowledgingReplicaId: string;
  readonly acknowledgedFrontier: Record<string, number>; // streamKey -> sequence
  readonly timestamp: number;
}
```
The coordinator aggregates acknowledgments across active writer replicas to advance the cluster **stable frontier** (`stableFrontier`), unlocking garbage collection and snapshot baseline advances.

### 2.5 `RANGE`: Anti-Entropy Catch-Up
If a replica detects a gap in received sequence numbers or reconnects after being offline, it requests the missing range:
```typescript
interface StreamRangeRequestPayload {
  readonly collectionId: string;
  readonly targetStreamKey: string; // "epoch:replicaId"
  readonly fromSequenceExclusive: number;
  readonly toSequenceInclusive: number;
  readonly maximumCount: number;
}
```
The coordinator responds with an authenticated `StreamRangeResponsePayload` containing the ordered operations and their verified rolling digests.

---

## 3. Quorum & Epoch Transition Rules

1. **Non-Decreasing Baseline Floors:** Transitioning to epoch $N+1$ requires that every stream listed in the certificate specifies a `baselineStableFrontier` floor greater than or equal to its floor in epoch $N$. A certificate lowering a listed floor is rejected immediately (`D137_CERTIFICATE_FLOOR_REGRESSION`).
2. **Member-Only Certificate Distribution:** Epoch transition certificates must only be delivered to replicas listed in `memberBindings`. A certificate delivered to a non-member is rejected (`D137_CERTIFICATE_NOT_A_MEMBER`).
3. **Equivocation Isolation:** When the coordinator or any replica detects conflicting operations signed by the same author for the same causal dot, that author is marked as equivocated, isolated from the active cluster, and queued for eviction.

