# Showcase Compliance Audit — Syntax, Compiler Support & Simulation Analysis

**Audit Date:** 2026-11-08  
**Revised:** 2026-11-08 (Incorporating Human Architecture Authority Review)  
**Auditor:** Antigravity (AI Coding Assistant)  
**Authority:** Human Architecture Authority  
**Task Reference:** Task 4 (`agent/INITIALIZATION_AGENT_TASK.md`)  
**Status:** Audit Complete — Widespread Simulation & Handwritten Workarounds Identified

---

## 1. Executive Summary

This audit performs an exhaustive technical inspection of the Mix / Tix Showcase application located in `examples/showcase/` (commit `b95110ec04a564cdea9feb7dfd3b635f3de18803`).

### Critical Finding
The Showcase **does not demonstrate genuine compiler-native component composition, reactive dynamic element morphing, or genuine cancellation**. Instead, it simulates capabilities through handwritten vanilla JavaScript imperative scripts (`examples/showcase/src/main.js`), inline template arithmetic, hardcoded abort strings, and empty compiler codegen stubs.

Per `governance/PROJECT_CHARTER.md` §3, an explicit project non-goal is:
> *"A Showcase that simulates compiler capabilities with handwritten JavaScript."*

---

## 2. Feature-by-Feature Compliance Matrix

| Syntax / Feature | Used in Showcase | Exists in Canonical Grammar? | Spec Reference | Compiler Support Exists? | Handwritten JS / HTML Simulation? | Unapproved Addition? |
|---|---|---|---|---|---|---|
| **`signal(...)`** | All components | Runtime API only | `RUNTIME_API.md` §1 | Auto-imported in codegen | No (Pass-through to runtime) | Ambient global syntax assumed without import declaration |
| **`.set(...)`** | All components | Runtime API method | `RUNTIME_API.md` §1 | Native JS method call | No | Standard method |
| **`@click={...}`** | All components | Syntax draft | `LANGUAGE.md` §5 | Parsed & emitted via addEventListener | No | Event modifiers unspecified |
| **`<script>` / `<style>`** | All components | Approved structure | `LANGUAGE.md` §4 | String index search (`indexOf`) | Partial (breaks on embedded delimiters) | No |
| **Dynamic Element `<{~expr}>`** | `DynamicCard.mix` | **Canonical** | Charter §4, D-105 | **Broken in Codegen** (drops attributes; static tag) | **Yes** (UI claims morphing, but DOM element never changes tag) | No (Charter locked) |
| **Control Flow `{#if}`** | None in showcase | **No** (Svelte syntax) | None | **Empty comment stub in Codegen** | **Yes** (Tab filtering in `main.js` via `grid.innerHTML = ""`) | **Yes** (Unapproved Svelte syntax; empty stub) |
| **Control Flow `{#each}`** | `TodoList.mix` | **No** (Svelte syntax) | `SEMANTICS.md` had `<each>` | Ad-hoc regex parser | No | **Yes** (Unapproved Svelte syntax; non-nested regex) |
| **Component Tags `<Child />`** | None in templates | Expected for UI lang | None | **Non-existent** (compiles to `createElement("Child")`) | **Yes** (Manually instantiated & appended in `main.js`) | Component nesting missing from compiler |
| **LIS Keyed Reconciliation** | `TodoList.mix` | Approved | D-110, Guardrail H | Exists in runtime | Partial (v3.2.2 R-KEY-03 used surrogate keys) | Surrogate key fallback in production |
| **WHATWG Security** | `SecurityDemo.mix` | Approved | D-107..D-109 | Partial | **Yes** (Trivial regex sanitizer in `main.js`) | Insecure regex sanitizer; caller-supplied sanitizer loophole |
| **TypeScript Projection** | `TypeSafeCard.tix` | Approved | D-106 | Partial | **Yes** (Component has zero props/types; 1:1 line map faking) | Lacks real .tix contract |
| **Cancellation Tokens** | `AsyncCancellation.mix`| Approved | D-104 | Exists in runtime | **100% Fake** (Sets hardcoded string; zero async or tokens) | Hardcoded string simulation |

---

## 3. Deep-Dive Audit of Explicit Features

### 3.1 Dynamic Element Syntax (`<{~expr}>`) in `DynamicCard.mix`
`DynamicCard.mix` declares:
```mix
<{~tag()}>
  <div class="card-content">
    Polymorphic semantic element instantiated with resolved identity and scoped attributes.
  </div>
</{~tag()}>
```
In the UI, buttons are provided: `<button @click={setArticle}>`, `<button @click={setSection}>`, `<button @click={setAside}>`.
- **Compiler Implementation (`packages/compiler-codegen/src/index.ts` lines 151-164):**
  ```ts
  lines.push(`  const __dynTag = ${dyn.tagExpression.code};`);
  lines.push(`  const ${elName} = typeof __dynTag === "string" ? createElement(__dynTag) : __dynTag();`);
  ...
  for (const child of dyn.children) {
    emitNode(child, elName);
  }
  ```
- **The Reality:**
  1. `__dynTag` is evaluated **once** at component construction and assigned to `elName`. It is **not** wrapped in `createEffect()`.
  2. When the user clicks `<button @click={setSection}>`, the signal `tag` changes value, but the DOM element remains permanently whatever tag was resolved at mount time!
  3. Furthermore, lines 151-164 completely fail to iterate over or emit `dyn.attributes`. Any attributes on `<{~tag}>` are silently discarded!
  4. The showcase creates the optical illusion of dynamic tag morphing because the text interpolation `Active DOM Tag: <{tag()}>` updates, while the actual underlying DOM element is completely static.

---

### 3.2 Component Syntax & Imperative Assembly in `main.js`
In a true compiler-native UI framework, `App.mix` would compose child components directly in markup:
```mix
<!-- Expected compiler-native composition -->
<Header />
<div class="grid-layout">
  <DiamondReactivity />
  <TodoList />
  <AsyncCancellation />
  <DynamicCard />
  <SecurityDemo />
  <TypeSafeCard />
</div>
```
- **Showcase Reality (`examples/showcase/src/App.mix`):**
  `App.mix` contains only an empty shell:
  ```mix
  <div class="main-content">
    <div class="grid-layout" id="showcase-grid">
    </div>
  </div>
  ```
- **The Handwritten Assembly in `examples/showcase/src/main.js` (lines 30-74):**
  ```js
  // Manually invoke compiled factories as plain JS functions
  const headerInstance = Header();
  container.appendChild(headerInstance.element);

  const appInstance = App();
  container.appendChild(appInstance.element);

  const grid = appInstance.element.querySelector("#showcase-grid");

  const reactivityInstance = DiamondReactivity();
  const todoInstance = TodoList();
  const cancellationInstance = AsyncCancellation();
  const dynamicInstance = DynamicCard();
  const securityInstance = SecurityDemo();
  const typeSafeInstance = TypeSafeCard();
  ...
  // Tab filtering via raw innerHTML destruction!
  createEffect(() => {
    const activeTab = appInstance.activeTab ? appInstance.activeTab() : "all";
    if (!grid) return;
    grid.innerHTML = ""; // <-- Destroys DOM directly!

    for (const sec of sections) {
      if (activeTab === "all" || activeTab === sec.id) {
        grid.appendChild(sec.el);
      }
    }
  });
  ```
- **Why this exists:** The compiler in `@mix/compiler-codegen` has **zero** support for child component invocation. If a user writes `<Header />` in a `.mix` template, the codegen literally emits `createElement("Header")`. Because the compiler cannot compile component tags or conditional branches, the authors hand-wrote imperative DOM assembly in `main.js`.

---

### 3.3 Conditional Control Flow (`{#if}`) — The Empty Codegen Stub
The tab switching in `main.js` had to use `grid.innerHTML = ""` because conditional syntax was not functional in the compiler.
In `packages/compiler-codegen/src/index.ts` lines 182-196:
```ts
} else if (node.type === "IfBlock") {
  const ifNode = node as IfBlockNode;
  const anchorName = `anchor${textIndex++}`;
  lines.push(`  const ${anchorName} = createTextNode("");`);
  if (parentName) {
    lines.push(`  ${parentName}.appendChild(${anchorName});`);
  }

  lines.push("  createEffect(() => {");
  lines.push(`    if (${ifNode.condition.code}) {`);
  lines.push(`      // Conditional consequent branch`);
  lines.push("    }");
  if (ifNode.alternate) {
    lines.push("    else {");
    lines.push(`      // Conditional alternate branch`);
    lines.push("    }");
  }
  lines.push("  });");
}
```
The compiler literally emitted comment placeholders `// Conditional consequent branch` and generated **no DOM elements, no anchors, and no branch rendering**.

---

### 3.4 Asynchronous Cancellation in `AsyncCancellation.mix` — 100% Fake
`AsyncCancellation.mix` claims to showcase the *"Pure ECMAScript Cancellation Token (§3)"*.
Inspection of its `<script>` block reveals:
```mix
<script>
  let query = signal("TypeScript");
  let status = signal("Idle");
  let activeGeneration = signal(0);

  function startQuery() {
    const gen = activeGeneration() + 1;
    activeGeneration.set(gen);
    status.set("Fetching results for: " + query() + " (Gen #" + gen + ")...");
  }

  function cancelQuery() {
    status.set("Cancelled via CancellationToken (MIX_RT_ABORTED)");
  }
</script>
```
- **The Reality:**
  1. `startQuery()` creates no `Promise`, starts no `fetch()`, sets no timer, and invokes no asynchronous operation.
  2. `cancelQuery()` creates no `CancellationToken`, calls no cancellation method, and triggers no abort listener. It literally executes a synchronous string assignment: `status.set("Cancelled via CancellationToken (MIX_RT_ABORTED)")`.
  3. This is pure simulation designed to deceive visual inspection.

---

### 3.5 Diamond Reactivity in `DiamondReactivity.mix` — Inline Template Arithmetic
`DiamondReactivity.mix` claims to demonstrate the *"5-State Push-Pull Reactive Scheduler (Diamond Graph)"*.
A true diamond graph consists of:
```text
      Signal A
     /        \
Computed B   Computed C
     \        /
     Computed D
```
Inspection of `DiamondReactivity.mix` template reveals:
```mix
<div class="graph-node graph-node-root">
  <div>Source Signal A: <strong>{baseValue()}</strong></div>
</div>

<div class="graph-row">
  <div class="graph-node graph-node-computed">
    <div>B (A * 2): <strong>{baseValue() * 2}</strong></div>
  </div>
  <div class="graph-node graph-node-computed">
    <div>C (A + 10): <strong>{baseValue() + 10}</strong></div>
  </div>
</div>

<div class="graph-node graph-node-computed">
  <div>D (B + C): <strong>{baseValue() * 2 + (baseValue() + 10)}</strong></div>
</div>
```
- **The Reality:**
  There are **zero computed signals** declared. Node B, Node C, and Node D are ordinary inline template interpolations reading `baseValue()` directly. There is no diamond dependency graph in this component; it simply computes inline arithmetic in each independent interpolation text node.

---

### 3.6 Security & Sanitizer in `SecurityDemo.mix` and `main.js`
`SecurityDemo.mix` uses:
```mix
<div class="html-preview" mix-html={safeHtml()}></div>
```
Where `safeHtml = signal("<strong>Safe formatted text</strong> from trusted boundary")`.
- In `main.js` lines 12-19, the showcase registers a global sanitizer:
  ```js
  setSanitizerProvider({
    sanitizeHtml(raw) {
      return String(raw)
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");
    }
  });
  ```
- **The Reality:**
  1. This regular expression sanitizer is trivially bypassed (e.g. `<img src=x onerror=alert(1)>`, `<a href="javascript:alert(1)">`, unclosed `<script`).
  2. Guardrail G explicitly commands: *"Do not parse complex CSS with regular expressions alone... TypeScript brands and Symbols are not security boundaries. Never make unsafe HTML insertion the default."*
  3. In addition, the draft API `createTrustedHtml(dirtyHtml, sanitizerFn)` allowed callers to supply an arbitrary sanitizer callback (e.g. an identity function `x => x`), allowing untrusted code to register arbitrary HTML in the trusted `WeakSet`.
  4. The sanitizer authority must be controlled by the approved application-level security boundary (`setSanitizerProvider`), not freely supplied by untrusted component code.

---

### 3.7 Strict `.tix` in `TypeSafeCard.tix` — Missing Type Contracts
`TypeSafeCard.tix` was intended to demonstrate strict TypeScript verification per `PROJECT_CHARTER.md` and D-106.
Inspection reveals:
```tix
<script lang="ts">
  let localState = signal(42);

  function doubleCount() {
    localState.set((c) => c * 2);
  }
</script>
```
- **The Reality:**
  1. It contains no typed props interface (`export let count: number`), no generic props, and no component declaration contract.
  2. It is an ordinary `.mix` script with `lang="ts"` appended.
  3. The virtual projection generator in `packages/compiler-semantic/src/projection.ts` was accompanied by `generateSourceMap` which faked source mappings by looping lines 1 to 1.

---

## 4. Conclusion & Required Actions

The current Showcase is **not an acceptable proof of compiler or runtime correctness**. It must not be retained as evidence of completion for any phase gate.

### Required Actions for Gate 9:
1. Deprecate and discard `examples/showcase/src/main.js` handwritten DOM assembly.
2. Implement compiler-native component invocation (`<Component />`) and conditional blocks (`{#if}` or `<if>`) during approved phases.
3. Replace fake demonstrations (`AsyncCancellation.mix`, `DiamondReactivity.mix`) with genuine reactive pipelines (`computed(...)`, real asynchronous resources).
4. Integrate a real sanitizer (e.g. DOMPurify or native Trusted Types) rather than regular expressions, governed strictly by the application-level security boundary.
