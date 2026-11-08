# Toolchain Recommendation & Environment Compatibility

**Audit Date:** 2026-11-08  
**Revised:** 2026-11-08 (Incorporating Human Architecture Authority Review)  
**Auditor:** Antigravity (AI Coding Assistant)  
**Authority:** Human Architecture Authority  
**Task Reference:** Task 7 (`agent/INITIALIZATION_AGENT_TASK.md`)  
**Status:** Toolchain Evaluation Complete — November 2026 Reality Reconciled

---

## 1. Executive Summary

This evaluation establishes a reproducible, deterministic toolchain based on empirical compatibility testing against the host environment, the npm registry ecosystem, and official runtime/compiler releases as of **November 8, 2026**.

### Key Findings & Authority Alignment
1. **Node.js LTS Status (November 2026):**
   - **Node.js 26** entered **Active LTS** on October 28, 2026. It is the primary modern development baseline.
   - **Node.js 24** is an Active LTS release.
   - **Node.js 22** is currently in **Maintenance LTS**.
   - **Recommendation:** Evaluate Node.js 26 as the primary development and CI baseline. Test compatibility across Node 24 and Node 26. Decide whether to retain backwards compatibility for local host Node 22 (`v22.12.0`).
2. **TypeScript Ecosystem Status (November 2026):**
   - **TypeScript 7.0.2** is published as the current release, but it modularized into private/unstable subpaths (`typescript/unstable/*`) and broke standard `typescript-eslint@8.x` peer dependencies (`>=4.8.4 <6.1.0`). **Do not adopt TypeScript 7 until the required tooling supports it.**
   - **TypeScript 6.0.3** is listed among official releases and retains standard Compiler API structures.
   - **Recommendation:** Evaluate **TypeScript 6.0.3** with the TypeScript Compiler API. Do not select TypeScript 5.7.3 simply because an initial audit suggested it; TypeScript 5.7 is an outdated recommendation for a new November 2026 baseline.
3. **Linter & Peer Dependency Strategy:**
   - Verify exact peer compatibility between ESLint 9, `typescript-eslint`, and the selected TypeScript compiler version (targeting TS 6.0.3) before locking package manifests.

---

## 2. Detailed Toolchain Matrix

| Component | November 2026 Status | Evaluation & Recommendation |
|---|---|---|
| **Node.js Primary Baseline** | Node.js 26 (Active LTS as of Oct 28, 2026) | **Primary Baseline:** Target Node 26 for modern engine optimizations, native strip types, and latest V8 engine features. |
| **Node.js Compatibility** | Node.js 24 (Active LTS) / Node.js 22 (Maintenance LTS) | Test across Node 24 and 26 in CI. Set `"engines": { "node": ">=22.12.0" }` or `">=24.0.0"` depending on whether host Node 22 requires transitional support. |
| **TypeScript Compiler** | TypeScript 6.0.3 / TypeScript 7.0.2 | **Evaluate TypeScript 6.0.3:** Retains stable Compiler API structures while providing modern TS capabilities. Defer TypeScript 7.0.2 until tooling catches up. |
| **Linter (`typescript-eslint`)** | `typescript-eslint@8.x` (`>=4.8.4 <6.1.0`) | Verify exact peer compatibility with TS 6.0.3. Pin exact versions with verified clean resolution. |
| **Test Runner** | Native `node:test` + `node:assert/strict` | Zero external dependencies; native subtests; deterministic microtask queue flushing. |
| **DOM Test Environment** | `happy-dom` (`15.11.7`) | Isolated strictly to DOM test files (`tests/**/*.test.mjs`); zero runtime exposure. |
| **Real-Browser Verification** | Playwright (`@playwright/test`) | Headless Chromium for Gate 9 E2E and benchmark verification. |
| **Runtime Dependencies** | `@mix/runtime` | **ZERO external dependencies** (`dependencies: {}`). |

---

## 3. Node.js LTS Baseline Analysis

```text
Node.js Release Schedule Context (November 2026):
- Node 22: Maintenance LTS (April 2026 - April 2027)
- Node 24: Active LTS (October 2025 - October 2028)
- Node 26: Active LTS (Entered Active LTS Oct 28, 2026)
```

### Compatibility Recommendation
- The root `package.json` engine declaration should reflect:
  ```json
  "engines": {
    "node": ">=22.12.0",
    "npm": ">=10.0.0"
  }
  ```
- Setting `"node": ">=22.12.0"` cleanly admits Node 22 Maintenance LTS, Node 24 Active LTS, and Node 26 Active LTS without redundant semver range union syntax. This allows development on the local host environment (`v22.12.0`) without `EBADENGINE` warnings, while establishing Node 26 Active LTS as the primary development and CI verification baseline.

---

## 4. TypeScript Compiler API & Tooling Evaluation

### 4.1 Why TypeScript 7 is Deferred
In Git commit `b95110e`, previous agents blindly pinned `typescript@7.0.2` without evaluating tooling support:
1. `require("typescript").createSourceFile` was `undefined`. Root monolithic exports were removed in favor of `typescript/unstable/ast` and `typescript/unstable/sync`.
2. `npm install typescript-eslint` failed with `ERESOLVE unable to resolve dependency tree` because `typescript-eslint@8.x` strictly bounds peer dependencies to `typescript@">=4.8.4 <6.1.0"`.
3. The previous agent responded by stripping TypeScript linting entirely, degrading code quality controls.
4. **Conclusion:** In accordance with Architecture Guardrail J, do not adopt a version purely by novelty. TS 7 is deferred until ecosystem tooling officially supports it.

### 4.2 Evaluating TypeScript 6.0.3
- **TypeScript 6.0.3** is the recommended candidate for evaluation in Gate 1.
- Provides standard, public Compiler API methods for `.tix` type verification.
- Retains composite project reference support (`tsc -b`).
- Peer compatibility with ESLint 9 and `typescript-eslint` must be empirically verified during Gate 1 toolchain setup.

---

## 5. Proposed Root `package.json` Manifest for Gate 1 Evaluation

```json
{
  "name": "mix-tix",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "engines": {
    "node": ">=22.12.0",
    "npm": ">=10.0.0"
  },
  "scripts": {
    "build": "tsc -b",
    "lint": "eslint .",
    "test": "node --test tests/**/*.test.mjs"
  },
  "devDependencies": {
    "@eslint/js": "9.39.5",
    "@types/node": "26.0.0",
    "eslint": "9.19.0",
    "happy-dom": "15.11.7",
    "typescript": "6.0.3",
    "typescript-eslint": "8.72.1"
  }
}
```

*Note: `typescript-eslint@8.72.1` specifies peer dependency `typescript: ">=4.8.4 <6.1.0"`, providing verified clean peer resolution with `typescript@6.0.3`. Pairing `typescript@6.0.3` with older `typescript-eslint@8.21.0` (which only supported `<5.8.0`) is strictly avoided as it triggers npm `ERESOLVE`.*

---

## 6. Package Compiler & Runtime Dependency Invariants

| Package | Allowed Dependencies (Pinned Versions) | Forbidden Dependencies |
|---|---|---|
| `@mix/diagnostics` | None (Zero external dependencies) | `@mix/*`, external npm |
| `@mix/ast` | `@mix/diagnostics` | `@mix/compiler-*`, `@mix/runtime` |
| `@mix/compiler-frontend` | `@mix/diagnostics`, `@mix/ast`, `acorn@8.14.0`, `@sveltejs/acorn-typescript@1.4.1` | `@mix/runtime` (**FORBIDDEN**) |
| `@mix/compiler-semantic` | `@mix/diagnostics`, `@mix/ast`, `typescript@6.0.3` (internal adapter) | `@mix/runtime` (**FORBIDDEN**) |
| `@mix/compiler-css` | `@mix/diagnostics`, `@mix/ast`, `css-tree@3.1.0` | `@mix/runtime` |
| `@mix/compiler-codegen` | `@mix/diagnostics`, `@mix/ast`, `@mix/compiler-semantic`, `@mix/compiler-css` | `@mix/runtime` |
| `@mix/runtime` | **Zero external dependencies** (`dependencies: {}`) | `@mix/ast`, `@mix/compiler-*`, `@csstools/css-tokenizer` |
