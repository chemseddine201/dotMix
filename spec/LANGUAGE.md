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

## 2. Component File Structure (`HAA-06` / `D-112`)

Mix (`.mix`, JavaScript) and Tix (`.tix`, TypeScript) components support **Functional ReactJS-Style Component Authoring** (`export default function ComponentName(props) { ... return ( <...> ); }`) alongside optional `<style>` blocks (as well as `<script>` SFC blocks):

```tsx
interface ViewProps {
  title: string;
}

export default function App(props: ViewProps = { title: "Dashboard" }) {
  const dynamicView = signal("section");

  return (
    <main class="container">
      <Header title={props.title} />
      <h1>{props.title}</h1>
      <$dynamicView class="card">
        <p>Dynamic content</p>
      </$dynamicView>
    </main>
  );
}

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

## 4. Dynamic Element Syntax (`D-105`, `D-112` / `HAA-06`, `R-SYN-02`, `R-SYN-03`)

### 4.1 Grammar
Dynamic element tags use the clean `$` prefix syntax (`<$tagName>...</$tagName>`, `<$props.tag />`, or `<${expr}>...</${expr}>`; legacy `<{~expr}>` remains supported for backward parser conformance):

```ebnf
DynamicElement  = DynamicOpenTag , "/>"
                | DynamicOpenTag , ">" , { TemplateNode } , DynamicCloseTag ;
DynamicOpenTag  = "<$" , ( TagMemberPath | "{" , TSExpression , "}" ) , { Attribute } ;
DynamicCloseTag = "</$" , ( TagMemberPath | "{" , TSExpression , "}" ) , ">" ;
```

### 4.2 Parsing & Evaluation Semantics
1. **Single Evaluation Rule (`D-105`):** The dynamic tag expression is evaluated **exactly once** when the dynamic element instance is created.
2. **Attribute Preservation (`TECH-06`):** All static attributes, dynamic attributes, event listeners (`onClick={...}`, `on:click={...}`, `@click={...}`), refs, and directives on `<$tagName ...>` are preserved on `DynamicElementNode` and applied to the resolved element/component.
3. **Token-Sequence Closing Tag Verification (`R-SYN-02`):** The closing tag expression in `</$tagName>` is compared against the opening tag expression in `<$tagName>` by **normalized token sequence (token type and value)** using the Acorn-TypeScript tokenizer while ignoring whitespace and comments. If the token sequences differ, the parser emits `MIX_ERR_UNCLOSED_TAG` with both opening and closing source spans.
4. **Closing Tag Non-Evaluation (`R-SYN-03`):** The closing tag expression serves strictly as a lexical delimiter; it is never evaluated at runtime, never emitted in generated code, and never type-checked independently.

---

## 5. Embedded Expression Boundaries (`R-SYN-01`, `R-SYN-01a`, `R-SYN-01b`, `R-SYN-01c`)

1. **Parser-Driven Boundary Detection (`R-SYN-01`):**
   - The expression parser—not a naive brace-counting lexer—determines the end of every embedded JavaScript/TypeScript expression (`{expr}`, `attr={expr}`, `<$tagName>`, `{if expr}`, `{each (item, idx) in expr}`).
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
4. **Markup in Expressions & Attribute Subtrees (`R-SYN-01c`, `D-132`, `D-133`):**
   - Arbitrary template markup tags inside general `{ ... }` expressions are forbidden (`R-SYN-01c`).
   - JSX-style logical or conditional markup inside expressions (e.g. `{cond && <span>Hi</span>}`) is rejected with `MIX_ERR_JSX_LOGICAL_EXPRESSION` and a hint to use `{if cond}<span>Hi</span>{endif}` (`D-133` Option b).
   - **Attribute Element & Fragment Expressions (`D-132`):** Attribute bindings of the form `attr={<Element ... />}` or `attr={<>...</>}` (e.g., `<Can fallback={<span class="denied">Read Only</span>}>` or `<Button icon={<Icon name="plus" />} />`) are parsed as a nested `TemplateNode[]` subtree (`DynamicAttributeNode.templateValue`) and compiled to a lazily-mounted render function.

---

## 6. Control-Flow Blocks (`IfBlockNode` & `EachBlockNode` — `HAA-06` / `D-112` / `D-133`)

### 6.1 Conditional Block (`{if} ... {elseif} ... {else} ... {endif}`)
```mix
{if conditionExpr}
  <p>Primary branch</p>
{elseif secondaryExpr}
  <p>Secondary branch</p>
{else}
  <p>Fallback branch</p>
{endif}
```

### 6.2 Keyed Collection Block (`{each (item, index) in items} ... {endeach}` — `D-110` & `D-112`)
```mix
{each (item, index) in itemsExpr}
  <li>{index}: {item.label}</li>
{endeach}
```
- Also supports `{each item in itemsExpr} ... {endeach}` and `{each itemsExpr as (item, index)} ... {endeach}`.
- Automatically resolves the item key via `(item?.id ?? item?.key ?? item)` (or accepts an explicit third tuple expression `{each (item, index, item.customKey) in itemsExpr}`) while enforcing `D-110` (`HAA-02`) atomic duplicate-key rejection at runtime.
- **Legacy Control-Flow Deprecation (`D-133`):** Legacy `{#if}` / `{#each}` / `{#await}` blocks remain parseable for backward compatibility and emit a `MIX_WARN_LEGACY_CONTROL_FLOW` warning in `mix check` and the Language Server.

---

## 7. Attributes, Directives, and Event Handlers

- **Static Attributes:** `name="value"` or boolean shorthand `disabled` (`StaticAttributeNode`)
- **Reactive Attribute Bindings:** `name={expr}` or element/fragment subtree `name={<span/>}` (`DynamicAttributeNode`, `D-132`)
- **Event Listeners:** `onClick={handler}`, `onInput={handler}`, `@click={handler}`, or `on:click={handler}` (`EventBindingNode`)
- **Element References:** `ref={myRef}` (`RefBindingNode`)
- **Trusted HTML Directive:** `mix-html={trustedHtmlExpr}` (`DirectiveAttributeNode`, validated at runtime via `SanitizerProvider` and `WeakSet` registry per `D-109` / `HAA-03`)
