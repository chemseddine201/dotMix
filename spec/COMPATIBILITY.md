# Compatibility Matrix — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Compatibility Specification (Reconciled Phase Gate 1)  
**Applies to:** Compiler target, Node.js engines, and Browser targets  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Compiler & Runtime Execution Environments

- **Node.js Engines:** `"node": ">=22.12.0"`, `"npm": ">=10.0.0"`
  - **Primary Development & CI Baseline:** Node.js 26 Active LTS.
  - **CI Compatibility Matrix:** Validated across Node.js 22 (Maintenance LTS), Node.js 24 (Active LTS), and Node.js 26 (Active LTS).
  - **Local Host Compatibility:** Fully compatible with local host Node.js `v22.12.0`.
- **Module System:** Pure ECMAScript Modules (ESM). All workspace packages declare `"type": "module"`. All emitted code uses standard `import` / `export` syntax with explicit `.js` extensions.
- **Target ECMAScript Baseline:** `ES2023`.
- **TypeScript Baseline:** TypeScript `6.0.3` evaluated with the Compiler API, operating under `"strict": true`, `"verbatimModuleSyntax": true`, and `"erasableSyntaxOnly": true`.

---

## 2. Browser Platform Baseline (SPA Target)

The browser SPA MVP targets modern evergreen browsers supporting:
- ES2023 language features.
- Native `CustomElementRegistry` and `ShadowRoot`.
- W3C Trusted Types (where available, with application `SanitizerProvider` fallback).
- Direct DOM Level 3 APIs (`Node.textContent`, `Element.setAttribute`, `Element.style.setProperty`).
