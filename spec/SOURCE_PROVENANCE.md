# Canonical Specification Source Provenance & Governance Ledger

**Authority:** Human Architecture Authority  
**Phase:** Phase Gate 1 & Gate 2 Reconciled Baseline  
**Date:** 2026-11-08  
**Archive Reference:** Tag `refs/tags/archive/pre-initialization-b95110e` (`b95110ec04a564cdea9feb7dfd3b635f3de18803`)  
**Governing Ratification:** Decisions `HAA-01` through `HAA-05` (`governance/DECISION_REGISTER.md`)

---

## 1. Source Provenance Ledger (With Exact Historical Git Blob SHAs)

The 10 canonical specification files under `spec/` are reconciled from the archived repository commits `b95110ec04a564cdea9feb7dfd3b635f3de18803` and `74dc8f9250b9374af90df06afeae56a0bfd36a58` (`spec/MIX_SPEC_v3.2.2.md`, blob `270c2e186efd281cedb151fbf54da44d4403e`), strictly subordinate to root governance documents:

| Specification Document | Historical Source Path on `archive/pre-initialization-b95110e` | Historical Git Blob SHA-1 | Governance Overrides & Ratified Decisions Applied |
|---|---|---|---|
| `spec/LANGUAGE.md` | `spec/LANGUAGE.md` + `spec/MIX_SPEC_v3.2.2.md` §4 | `b7ac15a5746e0ec8fcb0fc026cfb84a73b1fe4dd` / `270c2e186efd281cedb151fbf54da44d4403e` | `D-105` `<{~expr}>`; `R-SYN-01`/`R-SYN-01a` `parseExpressionAt` with `preserveParens: true`; `R-SYN-02` token-sequence closing tag verification; `TECH-07` `ComponentCallNode`; `{#if}` / `{#each}` grammar. |
| `spec/AST.md` | `spec/AST.md` + `spec/MIX_SPEC_v3.2.2.md` §4 | `3ee4fc592bde863a1394ec1eaea92986bf34119c` / `270c2e186efd281cedb151fbf54da44d4403e` | `HAA-04` self-contained structural `ESTreeNode` interfaces; `TECH-07` `ComponentCallNode`; `TECH-06` `DynamicElementNode` attributes. |
| `spec/SEMANTICS.md` | `spec/SEMANTICS.md` + `spec/MIX_SPEC_v3.2.2.md` §2, §7 | `2fef9758cc267c07f32aac7f6165b74d6a89b015` / `270c2e186efd281cedb151fbf54da44d4403e` | `D-101` independent `pendingRerun` (overriding `R-RX-04` state coupling); `D-102` lifecycle decoupling; `HAA-02` / `D-110` Option A strict atomic duplicate rejection policy (overriding `R-KEY-03` surrogate keys). |
| `spec/RUNTIME_API.md` | `spec/RUNTIME_API.md` + `spec/MIX_SPEC_v3.2.2.md` §2.5, §3, §6.4 | `160ae120eca04ae55242c6bae006bdac42c17cb3` / `270c2e186efd281cedb151fbf54da44d4403e` | `D-103` `detachedParent`; `D-104` cancellation generation tokens; `HAA-03` / `D-109` application `SanitizerProvider` authority, `WeakSet` registry, native Trusted Types; `HAA-04` zero runtime dependencies. |
| `spec/CSS_SCOPING.md` | `spec/CSS_SCOPING.md` + `spec/MIX_SPEC_v3.2.2.md` §6.3 | `5f4fa544662286efa0ac17ae76f8a10f33edd8e7` / `270c2e186efd281cedb151fbf54da44d4403e` | `D-108` static at-rule rejection (`@import`, `@charset`); `F-05` `:global(...)` and `:deep(...)` selector scoping (removing `:host`); runtime property/escape validation. |
| `spec/DIAGNOSTICS.md` | `spec/DIAGNOSTICS.md` + `spec/MIX_SPEC_v3.2.2.md` §5.4, §10 | `076317872fb785027ce8a8c739ea765d3cbc564a` / `270c2e186efd281cedb151fbf54da44d4403e` | `D-106` `SourceMapSpanTable` (`verbatim | origin | internal` with 100% byte coverage `R-SP-05`); `@mix/diagnostics` leaf package codes; `D-111` HMR codes. |
| `spec/SECURITY.md` | `spec/SECURITY.md` + `spec/MIX_SPEC_v3.2.2.md` §6 | `9e09460e01bd71febb8efa7d05bb0e3e92c84111` / `270c2e186efd281cedb151fbf54da44d4403e` | `D-107` normative WHATWG HTML §4.8.4.3.7 `srcset` scanner; `HAA-03` / `D-109` trusted HTML boundary and removal of caller-supplied sanitizer callbacks. |
| `spec/TESTING.md` | `spec/TESTING.md` + `spec/MIX_SPEC_v3.2.2.md` §9 | `d1c2650fb81318dcd06fd15957bf86c3b1e5ce58` / `270c2e186efd281cedb151fbf54da44d4403e` | Node.js native `node:test` + `node:assert/strict`; decision test matrix `D-101`..`D-111` and `T-RX`/`T-SYN`/`T-TC`/`T-SEC`/`T-KEY`/`T-HMR`. |
| `spec/PERFORMANCE.md` | `spec/PERFORMANCE.md` | `3a215e92b1018298a2a6ea3d1c5d60776c6c59fa` | Direct DOM invariants; fine-grained benchmarks; reproducible measurement discipline without unapproved `< 3.5 KB` draft clauses. |
| `spec/COMPATIBILITY.md` | `spec/COMPATIBILITY.md` | `f6fadee3a0fddd945f7db4f7aed5adce527e3fb6` | `HAA-05` Node.js 26 Active LTS baseline with `node: ">=22.12.0"`; TypeScript `6.0.3`; `typescript-eslint@8.72.1`; `eslint@9.39.5`; `@sveltejs/acorn-typescript@1.0.13`. |

---

## 2. Non-Fabrication Declaration: Upstream v3.2.1 Items 11 & 12

As explicitly documented in historical commit `74dc8f9250b9374af90df06afeae56a0bfd36a58` (`spec/MIX_SPEC_v3.2.2.md` §0.3, blob `270c2e186efd281cedb151fbf54da44d4403e`):
> *"Items 11 and 12 of the fourteen corrections in v3.2.1 are absent from the document. The upstream sections covered only [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14]."*

In accordance with the **Elephant–Goldfish Rule** and **`HAA-01`**:
- **Status:** **UNRATIFIED / ABSENT UPSTREAM**.
- **Agent Prohibition:** Coding agents are strictly prohibited from inventing syntax, APIs, or behaviors for Items 11 & 12.
