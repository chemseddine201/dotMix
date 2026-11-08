# Decision Register — Accepted Baseline and Change Control

This register records constraints known to be accepted in the project's current baseline. The agent must compare them against the repository's actual canonical decision documents and report any mismatch. This register does not authorize inventing missing details.

| ID | Accepted direction | Required verification |
|---|---|---|
| D-101 | Deferred rerun; `pendingRerun` independent of computation state; coalesced notifications; non-nested effect execution; configurable scheduler iteration safety ceiling and deterministic cycle error. | Verify exact scheduler algorithm, ceiling semantics, error contract, and tests. |
| D-102 | Owner lifecycle state is separate from computation state. | Verify all state transitions, disposal, unlinking, and scheduling behavior—not only type declarations. |
| D-103 | Preserve `createRoot` with optional `detachedParent?: Owner \| null`. | Verify context inheritance is distinct from automatic disposal ownership. |
| D-104 | Platform-neutral cancellation token in core; adapters may bridge to platform cancellation; generation checks prevent stale results. | Verify token ownership, request replacement, owner disposal, and stale Promise behavior. |
| D-105 | Preserve dynamic element syntax `<{~expr}>...</{~expr}>`; resolve identity once per element instance. | Verify grammar, parser boundaries, and runtime/codegen semantics. |
| D-106 | `.tix` uses TypeScript Compiler API for type verification; no competing type checker. | Verify props/ref/generic model, source mapping, and API isolation. |
| D-107 | `srcset` handling must follow the normative WHATWG algorithm or a reviewed implementation demonstrably conforming to it. | Verify algorithm provenance and meaningful conformance vectors, including data URLs and commas. |
| D-108 | Dynamic CSS has compile-time and runtime validation, including escapes and URL policy. | Verify values and context handling; property allowlist alone is insufficient. |
| D-109 | Explicit trusted HTML boundary and defined SanitizerProvider/Trusted Types integration. | Verify sanitizer trust requirements, contexts, and failure behavior. |
| D-110 | No surrogate fallback keys; deterministic duplicate-key diagnostics and atomic behavior. | Verify duplicate item is rejected before DOM/Owner creation where feasible. |
| D-111 | HMR method dispatch uses stable component scope/context; lexical closures must not be assumed rebindable. | Verify updated methods access live component state through the stable scope contract. |

## Change-control protocol

For any conflict:
1. Quote the conflicting canonical clauses.
2. Identify affected decision IDs and packages.
3. Explain behavioral and compatibility consequences.
4. Propose the smallest viable resolution.
5. STOP for human approval.

Do not mark a decision "closed" merely because a document mentions it. Require implementation-level tests when the relevant phase is implemented.
