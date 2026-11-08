# Language Specification — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Language Specification (Reconciled Phase Gate 1)  
**Applies to:** Compiler Frontend (`@mix/compiler-frontend`) and AST (`@mix/ast`)  
**Provenance Reference:** `spec/SOURCE_PROVENANCE.md`

---

## 1. Syntax Modes: `.mix` vs `.tix`

Mix and Tix share an identical underlying Abstract Syntax Tree (AST), semantic representation, and code generation pipeline. They differ in grammar strictness:

- **`.mix` (Flexible Syntax):**
  - Designed for rapid UI authoring with flexible script block placement and concise markup expressions.
  - Allows optional semicolons, implicit component exports, and inferred types.
- **`.tix` (Strict TypeScript-Oriented Syntax):**
  - Requires explicit TypeScript type annotations for component props, events, and slots.
  - Strict script block placement with `<script lang="ts">`.
  - Type-checked against component interfaces using TypeScript Compiler API projection (`spec/DIAGNOSTICS.md`).

---

## 2. Dynamic Element Syntax (D-105)

### 2.1 Grammar
Dynamic element tags use the canonical tilde syntax:

```mix
<{~expression}>
  <!-- Child content -->
</{~expression}>
```

- **Opening Tag:** Begins with `<{~` followed by a valid JavaScript/TypeScript expression, closed by `}>`.
- **Closing Tag:** Begins with `</{~` followed by the matching expression text, closed by `}>`.

### 2.2 Evaluation Semantics
1. **Single Evaluation Rule:** The dynamic tag expression `expression` is evaluated **exactly once** when the dynamic element instance is created.
2. **Identity Retention:** The resolved tag identity (HTML element tag name string or Component factory reference) is retained in the element instance.
3. **Closing Tag Non-Evaluation:** The closing tag `</{~expression}>` serves solely as a lexical block delimiter and **never** re-evaluates the expression.

---

## 3. Expression Boundary Extraction (D-105)

Embedded logic expressions within markup attributes (`attr={expr}`) and text interpolations (`{expr}`) are delimited by curly braces `{` and `}`.

Because embedded expressions may contain arbitrary JavaScript/TypeScript syntax, the lexical scanner must extract expression boundaries without full AST parsing using a delimiter-aware state machine.

### Boundary Scanner Requirements:
The scanner must track nesting depth `depth = 1` starting immediately after the opening `{`, decrementing on matching `}`, and ignoring braces within:
1. **Single-line Comments:** `// ... \n`
2. **Multi-line Block Comments:** `/* ... */`
3. **Single-Quoted Strings:** `'...'` (accounting for escaped quotes `\'`)
4. **Double-Quoted Strings:** `"..."` (accounting for escaped quotes `\"`)
5. **Template Literals:** `` `...` `` including nested interpolations `` `...${nestedExpr}...` `` (which recursively increment delimiter depth)
6. **Regular Expression Literals:** `/.../[gimsuy]*` (distinguished from division operators by scanning the preceding token context)

When `depth === 0`, the expression boundary terminates cleanly, and the enclosed source span is delegated to the expression parser (`acorn` + `@sveltejs/acorn-typescript`).

---

## 4. Component Structure

A component file consists of three optional, order-independent top-level sections:

```mix
<script [lang="ts"]>
  // Reactive state, props, helper functions, lifecycle hooks
</script>

<!-- Template Markup -->
<main class="container">
  <h1>{title()}</h1>
  <{~dynamicView()} />
</main>

<style [scoped]>
  /* Component-scoped CSS styles */
  .container {
    padding: 1rem;
  }
</style>
```

---

## 5. Attributes, Directives, and Event Handlers

- **Static Attributes:** `name="value"`
- **Reactive Attribute Bindings:** `name={signal()}`
- **Boolean Attributes:** `disabled={isDisabled()}` (omitted if falsy, present if truthy)
- **Event Listeners:** `@event={handler}` or `on:event={handler}`
- **References:** `ref={myRef}`
- **Direct HTML Binding:** `mix-html={trustedContent()}` (subject strictly to application `SanitizerProvider` / Trusted Types runtime validation per `spec/SECURITY.md` and `HAA-03`)
