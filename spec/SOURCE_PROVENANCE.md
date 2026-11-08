# Canonical Specification Source Provenance & Governance Ledger

**Authority:** Human Architecture Authority  
**Phase:** Phase Gate 1 — Foundation & Canonical Specification Import  
**Date:** 2026-11-08  
**Governing Ratification:** Decisions `HAA-01` through `HAA-05` (`agent/GATE_1_FOUNDATION_TASK.md`)

---

## 1. Source Provenance Ledger

The 10 canonical specification files under `spec/` are reconciled from historical repository records and drafts, strictly subordinate to root governance documents:

| Specification Document | Historical Source Commit & Path | SHA-256 Digest of Source | Governance Overrides & Ratified Decisions |
|---|---|---|---|
| `spec/LANGUAGE.md` | `b95110ec04a564cdea9feb7dfd3b635f3de18803:spec/LANGUAGE.md` | Verified against `archive/pre-initialization-b95110e` | `D-105` canonical `<{~expr}>` syntax; single tag resolution per element instance; delimiter-aware scanner. |
| `spec/AST.md` | `b95110ec04a564cdea9feb7dfd3b635f3de18803:spec/AST.md` | Verified against `archive/pre-initialization-b95110e` | `HAA-04` self-contained structural ESTree expression node interfaces (no `@types/*` leakage in `.d.ts`). |
| `spec/SEMANTICS.md` | `b95110ec04a564cdea9feb7dfd3b635f3de18803:spec/SEMANTICS.md` & `74dc8f9:spec/MIX_SPEC_v3.2.2.md` §2, §7 | Verified against `archive/pre-initialization-b95110e` | `D-101` independent `pendingRerun` (overriding `R-RX-04` state coupling); `D-102` lifecycle decoupling; `HAA-02` / `D-110` Option A strict atomic duplicate rejection policy (overriding `R-KEY-03` surrogate keys and draft first-occurrence drop). |
| `spec/RUNTIME_API.md` | `b95110ec04a564cdea9feb7dfd3b635f3de18803:spec/RUNTIME_API.md` & `74dc8f9:spec/MIX_SPEC_v3.2.2.md` §2.5, §3, §6.4 | Verified against `archive/pre-initialization-b95110e` | `D-103` `detachedParent`; `D-104` cancellation generation tokens; `HAA-03` / `D-109` application `SanitizerProvider` authority, `WeakSet` registry, native Trusted Types (eliminating caller-supplied sanitizer callback); `HAA-04` zero runtime dependencies. |
| `spec/CSS_SCOPING.md` | `b95110ec04a564cdea9feb7dfd3b635f3de18803:spec/CSS_SCOPING.md` | Verified against `archive/pre-initialization-b95110e` | `D-108` static at-rule rejection (`@import`, `@charset`); `F-05` selector scoping via `:global(...)` and `:deep(...)` (removing unapproved `:host`); runtime property/escape validation. |
| `spec/DIAGNOSTICS.md` | `b95110ec04a564cdea9feb7dfd3b635f3de18803:spec/DIAGNOSTICS.md` | Verified against `archive/pre-initialization-b95110e` | `D-106` bidirectional span mapping; `@mix/diagnostics` leaf package codes; `D-111` stable HMR scope codes. |
| `spec/SECURITY.md` | `b95110ec04a564cdea9feb7dfd3b635f3de18803:spec/SECURITY.md` & `74dc8f9:spec/MIX_SPEC_v3.2.2.md` §6 | Verified against `archive/pre-initialization-b95110e` | `D-107` normative WHATWG HTML §4.8.4.3.7 `srcset` scanner; `HAA-03` / `D-109` trusted HTML boundary and removal of caller-supplied sanitizer bypasses. |
| `spec/TESTING.md` | `b95110ec04a564cdea9feb7dfd3b635f3de18803:spec/TESTING.md` | Verified against `archive/pre-initialization-b95110e` | Node.js native `node:test` + `node:assert/strict`; decision test matrix `D-101`..`D-111`. |
| `spec/PERFORMANCE.md` | `b95110ec04a564cdea9feb7dfd3b635f3de18803:spec/PERFORMANCE.md` | Verified against `archive/pre-initialization-b95110e` | Direct DOM invariants; fine-grained benchmarks; reproducible measurement discipline without unapproved `< 3.5 KB` draft clauses. |
| `spec/COMPATIBILITY.md` | `b95110ec04a564cdea9feb7dfd3b635f3de18803:spec/COMPATIBILITY.md` | Verified against `archive/pre-initialization-b95110e` | `HAA-05` Node.js 26 Active LTS baseline with `node: ">=22.12.0"`; TypeScript 6.0.3; `typescript-eslint@8.72.1`; pure ESM; `ES2023`. |

---

## 2. Non-Fabrication Declaration: Upstream v3.2.1 Items 11 & 12

As explicitly documented in historical commit `74dc8f9` (`spec/MIX_SPEC_v3.2.2.md` §0.3):
> *"Items 11 and 12 of the fourteen corrections in v3.2.1 are absent from the document. The upstream sections covered only [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14]."*

In accordance with the **Elephant–Goldfish Rule** and **`HAA-01`**:
- **Status:** **UNRATIFIED / ABSENT UPSTREAM**.
- **Agent Prohibition:** Coding agents are strictly prohibited from inventing syntax, APIs, or behaviors for Items 11 & 12. No assumptions or common framework heuristics may be introduced to fill these gaps without explicit written instructions and specification text from the Human Architecture Authority.

---

## 3. Governance Precedence Hierarchy

All specifications in this directory are binding on implementation packages subject to the strict governance hierarchy established in `AGENTS.md §2`:

```text
1. Human Architecture Authority (Project Owner)
   └── 2. Master Constitution & Root Governance:
          ├── AGENTS.md                              (Root agent constitution)
          ├── governance/PROJECT_CHARTER.md          (Mission, identity, non-goals)
          └── governance/ARCHITECTURE_GUARDRAILS.md  (Guardrails A through J)
   └── 3. Canonical Specification Documents (spec/*.md + spec/SOURCE_PROVENANCE.md)
   └── 4. Change Control & Gate Definitions:
          ├── governance/DECISION_REGISTER.md        (Accepted decisions D-101..111, HAA-01..05)
          └── governance/PHASE_GATES.md              (Gate acceptance criteria)
   └── 5. Task Directives & Handoffs:
          ├── agent/*.md
          └── AGENT_HANDOFF.md
   └── 6. Active Code, Packages, and Tests
```
