# Compatibility Matrix — Mix & Tix

**Status:** Canonical Compatibility Specification (Reconciled Phase 1)  
**Applies to:** Compiler target, Node.js engines, and Browser targets

---

## 1. Compiler & Runtime Execution Environments

- **Node.js Engines:** `"node": "^24.0.0 || ^26.0.0"`
  - **Baseline:** Node.js 24 LTS (Active LTS).
  - **Forward Target:** Node.js 26 LTS.
- **Module System:** Pure ECMAScript Modules (ESM). All emitted code uses standard `import` / `export` syntax with explicit `.js` or `.mjs` extensions.
- **Target ECMAScript Baseline:** `ES2022` (or modern `ES2024`).

---

## 2. Browser Platform Baseline (SPA Target)

The browser SPA MVP targets modern evergreen browsers supporting:
- ES2022+ language features.
- Native `CustomElementRegistry` and `ShadowRoot` (for optional component encapsulation).
- W3C Trusted Types (where available, with fallback to `SanitizerProvider`).
- Direct DOM Level 3 APIs (`Node.textContent`, `Element.setAttribute`, `Element.style.setProperty`).
