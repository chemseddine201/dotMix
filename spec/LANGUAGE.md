# Language Specification — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Language Specification (Reconciled Phase Gate 1 & Gate 2)  
**Applies to:** Compiler Frontend (`@mix/compiler-frontend`) and AST (`@mix/ast`)  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Syntax Modes: `.mix` vs `.tix`

Mix and Tix share an identical underlying Abstract Syntax Tree (AST), semantic representation, and code generation pipeline. They differ in grammar strictness:

- **`.mix` (Flexible JavaScript-Oriented Syntax):**
  - Designed for rapid UI authoring with concise markup expressions and `<script>` blocks.
  - Allows optional semicolons, implicit component exports, and inferred types.
- **`.tix` (Strict TypeScript-Oriented Syntax):**
  - Requires explicit TypeScript type annotations for component props, refs, and events.
  - Uses `<script lang="ts">` (or defaults to TypeScript mode when file extension is `.tix`).
  - Statically verified via the official TypeScript Compiler API (`typescript@6.0.3`) using virtual `.tix.ts` projection (`spec/DIAGNOSTICS.md`, `D-106`).

---

## 2. Component File Structure

A component file consists of up to one `<script>` block, up to one `<style>` block, and template markup in any top-level order:

```mix
<script lang="ts">
  // Reactive state, props, refs, helper functions, lifecycle hooks
</script>

<!-- Template Markup -->
<main class="container">
  <Header title={title()} />
  <h1>{title()}</h1>
  <{~dynamicView()} class="card">
    <p>Dynamic content</p>
  </{~dynamicView()}>
</main>

<style scoped>
  .container {
    padding: 1rem;
  }
</style>
```

Duplicate `<script>` or `<style>` blocks in a single component file are rejected at compile time with `MIX_ERR_PARSE_SYNTAX`.

---

## 3. Elements vs Component Invocations (`TECH-07`)

1. **Standard HTML/SVG Elements (`ElementNode`):**
   - Begin with a lowercase ASCII letter (`^[a-z]`), e.g. `<div>`, `<button>`, `<input />`, `<svg>`.
   - HTML void elements (`area`, `base`, `br`, `col`, `embed`, `hr`, `img`, `input`, `link`, `meta`, `param`, `source`, `track`, `wbr`) may be written without a closing tag or self-closed with `/>`.
2. **Component Invocations (`ComponentCallNode`):**
   - Begin with an uppercase ASCII letter (`^[A-Z]`, PascalCase), e.g. `<Header title={title()} />` or `<Card><p>Slot</p></Card>`.
   - Compiled to component factory invocations rather than `document.createElement`.

---

## 4. Dynamic Element Syntax (`D-105`, `R-SYN-02`, `R-SYN-03`)

### 4.1 Grammar
Dynamic element tags use the canonical tilde syntax (`<{~...}>`), supporting both paired tags and self-closing tags:

```ebnf
DynamicElement  = DynamicOpenTag , "/>"
                | DynamicOpenTag , ">" , { TemplateNode } , DynamicCloseTag ;
DynamicOpenTag  = "<{~" , TSExpression , "}" , { Attribute } ;
DynamicCloseTag = "</{~" , TSExpression , "}" , ">" ;
(* No whitespace is permitted inside "<{~" or "</{~" *)
```

### 4.2 Parsing & Evaluation Semantics
1. **Single Evaluation Rule (`D-105`):** The dynamic tag expression `TSExpression` is evaluated **exactly once** when the dynamic element instance is created.
2. **Attribute Preservation (`TECH-06`):** All static attributes, dynamic attributes, event listeners, refs, and directives on `<{~expr} ...>` are preserved on `DynamicElementNode` and applied to the resolved element/component.
3. **Token-Sequence Closing Tag Verification (`R-SYN-02`):** The closing tag expression in `</{~expr}>` is compared against the opening tag expression in `<{~expr}>` by **normalized token sequence (token type and value)** using the Acorn-TypeScript tokenizer while ignoring whitespace and comments. If the token sequences differ, the parser emits `MIX_ERR_UNCLOSED_TAG` with both opening and closing source spans.
4. **Closing Tag Non-Evaluation (`R-SYN-03`):** The closing tag expression serves strictly as a lexical delimiter; it is never evaluated at runtime, never emitted in generated code, and never type-checked independently.

---

## 5. Embedded Expression Boundaries (`R-SYN-01`, `R-SYN-01a`, `R-SYN-01b`, `R-SYN-01c`)

1. **Parser-Driven Boundary Detection (`R-SYN-01`):**
   - The expression parser—not a naive brace-counting lexer—determines the end of every embedded JavaScript/TypeScript expression (`{expr}`, `attr={expr}`, `<{~expr}>`, `{#if expr}`, `{#each expr as ... (keyExpr)}`).
   - At the start offset `s` of an embedded expression, `@mix/compiler-frontend` invokes:
     ```ts
     const Parser = acorn.Parser.extend(tsPlugin());
     const node = Parser.parseExpressionAt(source, s, {
       ecmaVersion: "latest",
       sourceType: "module",
       locations: true,
       preserveParens: true,
     });
     ```
   - After `node.end`, the scanner skips ASCII whitespace and JS comments (`//...`, `/*...*/`) and verifies that the immediately following character sequence matches the expected context delimiter (`}`, `}>`, `)`). Otherwise, it emits `MIX_ERR_PARSE_SYNTAX`.
2. **Parenthesized Expressions (`R-SYN-01a`):** `preserveParens: true` is mandatory so expressions such as `{ ({ k: 1 }) }` include outer closing parentheses in `node.end`.
3. **AST Representation (`R-SYN-01b`):** Parsed expressions are stored as structural, deeply frozen `ESTreeNode` trees with 1-based line/column and 0-based offset `SourceSpan` coordinates.
4. **No Markup Inside Expressions (`R-SYN-01c`):** Template markup tags inside `{ ... }` expressions are forbidden and rejected with `MIX_ERR_PARSE_SYNTAX`.

---

## 6. Control-Flow Blocks (`IfBlockNode` & `EachBlockNode`)

### 6.1 Conditional Block (`{#if}`)
```mix
{#if conditionExpr}
  <p>Primary branch</p>
{:else if secondaryExpr}
  <p>Secondary branch</p>
{:else}
  <p>Fallback branch</p>
{/if}
```

### 6.2 Keyed Collection Block (`{#each}` — `D-110`)
```mix
{#each itemsExpr as item, index (item.id)}
  <li>{index}: {item.label}</li>
{/each}
```
- The index binding `, index` is optional.
- The key expression `(keyExpr)` is **mandatory** per `D-110` and Architecture Guardrail §H. Unkeyed `{#each}` blocks are rejected at compile time with `MIX_ERR_PARSE_SYNTAX`.

---

## 7. Attributes, Directives, and Event Handlers

- **Static Attributes:** `name="value"` or boolean shorthand `disabled` (`StaticAttributeNode`)
- **Reactive Attribute Bindings:** `name={expr}` (`DynamicAttributeNode`)
- **Event Listeners:** `@click={handler}` or `on:click={handler}` (`EventBindingNode`)
- **Element References:** `ref={myRef}` (`RefBindingNode`)
- **Trusted HTML Directive:** `mix-html={trustedHtmlExpr}` (`DirectiveAttributeNode`, validated at runtime via `SanitizerProvider` and `WeakSet` registry per `D-109` / `HAA-03`)
