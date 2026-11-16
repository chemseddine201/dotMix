# dotMix — Release & Versioning Policy

**Document Authority:** Human Architecture Authority  
**Applies to:** All Core Workspace Packages and Official Tooling  
**Status:** Canonical Release Policy  

---

## 1. Semantic Versioning Specification (SemVer 2.0.0)

All published packages within the dotMix ecosystem adhere strictly to [Semantic Versioning 2.0.0](https://semver.org/). Version numbers follow the canonical `MAJOR.MINOR.PATCH` format:

1. **MAJOR:** Incompatible API modifications, breaking compiler changes, or removal of deprecated language contracts.
2. **MINOR:** Backwards-compatible feature additions, new compiler directives, or non-breaking runtime capabilities.
3. **PATCH:** Backwards-compatible defect corrections, performance optimizations, and security patches.

---

## 2. Pre-1.0 Rules & Evolution (`0.y.z`)

Prior to the formal `1.0.0` stabilization release, all packages reside in the initial development phase (`0.y.z`):

1. **Initial Baseline (`0.1.0`):** The first public developer preview baseline covering compiler frontend, semantic analysis, surgical DOM runtime, fine-grained reactivity, radix router, and CRDT synchronization.
2. **Minor Version Iterations (`0.x.0`):** Minor bumps during pre-1.0 indicate substantial feature integrations or architectural promotions (such as new language directives or storage format enhancements). Any breaking changes in pre-1.0 minor versions must be accompanied by comprehensive deprecation diagnostics and automated migration notes.
3. **Patch Releases (`0.x.y`):** Patch bumps must never alter public APIs, compiler grammar, or runtime behavior contracts. They are strictly restricted to bug fixes and security remediations.
4. **Graduation to `1.0.0`:** Transition to `1.0.0` requires explicit ratification by the Human Architecture Authority following production soak, complete browser matrix verification, and finalized canonical specifications.

---

## 3. Deprecation Policy & Migration Lifecycles

Breaking changes are never introduced abruptly. The framework mandates structured deprecation lifecycles:

1. **Compile-Time and Runtime Warnings:** Deprecated features, directives, or runtime exports emit structured diagnostic warnings (`@dotmix/diagnostics`) indicating the deprecated symbol, the recommended alternative, and the scheduled removal release.
2. **Deprecation Window:**
   - In **pre-1.0 (`0.y.z`)**, a deprecated contract must remain functional and produce warnings for at least **one full minor release** before removal.
   - In **post-1.0 (`X.y.z`)**, a deprecated contract must remain functional across the entire major version lifecycle and may only be removed in the next **MAJOR** release.
3. **Codemod & Automation Requirement:** Whenever viable, mechanical API migrations must be paired with automated CLI transformation commands (e.g., `mix upgrade`).

---

## 4. Ecosystem & Monorepo Version Coordination

To maintain absolute coherence across the multi-package architecture:

1. **Synchronized Core Packages:** The core compiler and runtime packages (`@dotmix/runtime`, `@dotmix/router`, `@dotmix/compiler-frontend`, `@dotmix/compiler-semantic`, `@dotmix/compiler-codegen`, `@dotmix/compiler-css`, `@dotmix/compiler-ssr`, `@dotmix/ast`, `@dotmix/cli`, `@dotmix/sync`) publish in lockstep versioning.
2. **Zero External Runtime Dependency Guarantee:** `@dotmix/runtime` and `@dotmix/router` must never introduce external third-party runtime dependencies. Standard library utilities (`@dotmix/helpers`) depend solely upon `@dotmix/runtime`.
3. **Internal Workspace References:** Workspace packages reference internal dependencies with strict version pins corresponding to the release tag, guaranteeing deterministic resolution in end-user installations.

---

## 5. Security & Hotfix Protocol

1. **Vulnerability Reporting:** Security issues affecting cryptographic operations, URL parsing, HTML sanitization, or CSS isolation receive immediate prioritized remediation.
2. **Zero-Regression Mandate:** Every security patch must include unmocked automated regression tests before distribution.
3. **Distribution Purity:** Official release builds are produced exclusively in clean environments with verified checksums and size-budget compliance.
