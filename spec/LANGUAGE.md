# Language Specification — Mix & Tix

**Authority:** Human Architecture Authority  
**Status:** Canonical Language Specification (Reconciled Phase Gate 1 & Gate 2)  
**Applies to:** Compiler Frontend (`@dotmix/compiler-frontend`) and AST (`@dotmix/ast`)  
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
import Header from "./Header.tix";

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
   - HTML void elements (`area`, `base`, `br`, `col`, `embed`, `hr`, `img`, `input`, `link`, `meta`, `source`, `track`, `wbr`) may be written without a closing tag or self-closed with `/>`.
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
3. **Token-Sequence Closing Tag Verification (`R-SYN-02`):** The closing tag expression in `</$tagName>` is compared against the opening tag expression in `<$tagName>` by **normalized token sequence (token type and value)** using the TypeScript scanner-based tokenizer (`createTsTokenizer`) while ignoring whitespace and comments. If the token sequences differ, the parser emits `MIX_ERR_UNCLOSED_TAG` with both opening and closing source spans.
4. **Closing Tag Non-Evaluation (`R-SYN-03`):** The closing tag expression serves strictly as a lexical delimiter; it is never evaluated at runtime, never emitted in generated code, and never type-checked independently.

---

## 5. Embedded Expression Boundaries (`R-SYN-01`, `R-SYN-01a`, `R-SYN-01b`, `R-SYN-01c`)

1. **Parser-Driven Boundary Detection (`R-SYN-01`):**
   - The TypeScript scanner and parser—not a naive brace-counting lexer—determine the end of every embedded JavaScript/TypeScript expression (`{expr}`, `attr={expr}`, `<$tagName>`, `{if expr}`, `{each (item, idx) in expr}`).
   - At the start offset `s` of an embedded expression, `@dotmix/compiler-frontend` scans the expression boundary with `ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard)` (using `reScanSlashToken()` where an operand is expected and `reScanTemplateToken(false)` on template interpolation `}`) up to the expected delimiter (`}`, `}>`, `)`, or slice end), then parses the extracted slice in expression position:
     ```ts
     const wrapped = `void (${rawExpression})`;
     const sf = ts.createSourceFile(
       "expr.ts",
       wrapped,
       ts.ScriptTarget.Latest,
       true,
       ts.ScriptKind.TS
     );
     ```
   - Parse diagnostics, missing delimiters, or trailing tokens emit `MIX_ERR_PARSE_SYNTAX` at the token-snapped source offset. After `exprEndOffset`, only ASCII whitespace and JS comments (`//...`, `/*...*/`) may precede the expected closing delimiter (`}`, `}>`, `)`).
2. **Parenthesized Expressions (`R-SYN-01a`):** Outer parentheses are preserved as `ParenthesizedExpression` nodes in the converted ESTree AST so expressions such as `{ ({ k: 1 }) }` include outer closing parentheses in `exprEndOffset`.
3. **AST Representation (`R-SYN-01b`):** Parsed expressions are stored as structural, deeply frozen `ESTreeNode` trees with 1-based line/column and 0-based offset `SourceSpan` coordinates.
4. **Markup in Expressions & Attribute Subtrees (`R-SYN-01c`, `D-132`, `D-133`):**
   - Arbitrary template markup tags inside general `{ ... }` expressions are forbidden (`R-SYN-01c`).
   - Token-based probing (`scanMarkupProbe` over TypeScript scanner tokens) inspects only real code tokens: text inside strings, template literals, comments, and regex literals is never treated as markup.
   - Markup starting immediately after `&&`, `||`, `?`, or `:` (e.g. `{cond && <span>Hi</span>}`) is rejected with `MIX_ERR_JSX_LOGICAL_EXPRESSION` and a hint to use `{if cond}<span>Hi</span>{endif}` (`D-133` Option b).
   - Anywhere else inside an expression, markup is rejected as a syntax error (`MIX_ERR_PARSE_SYNTAX`).
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

### 6.2 Keyed Collection Block (`{each (item, index) in items} ... {endeach}` — `D-110`, `D-112`, `D-188`)
```mix
{each (item, index) in itemsExpr}
  <li>{index}: {item.label}</li>
{endeach}
```
- Also supports `{each item in itemsExpr} ... {endeach}`, `{each itemsExpr as (item, index)} ... {endeach}`, and `<Each data={itemsExpr} key?={...}>`.
- **Two-Mode Key Policy (`D-188`):**
  - **Implicit mode** (no key written): resolves `item.id` if a valid primitive (`string | finite number | symbol`), else `item.key` if a valid primitive, else object/function reference identity, else primitive value (`-0` normalized to `0`). Implicit mode never throws on keys; duplicate implicit keys are disambiguated by occurrence with per-list interned synthetic keys (preserving DOM nodes across updates) and emit a single dev warning per list (`MIX_WARN_IMPLICIT_DUPLICATE_KEY`).
  - **Explicit mode** (author wrote a key: `{each (item, i, keyExpr) in list}`, `{each list as (item, i, keyExpr)}`, `{#each list as item (keyExpr)}`, or `<Each key={...}>`): strict mode enforcing valid primitive keys (`string | finite number | symbol`, rejecting objects, `null`, `undefined`, `NaN`, `±Infinity`, booleans, bigints with `MIX_ERR_INVALID_KEY`) and atomic duplicate-key rejection (`MIX_ERR_DUPLICATE_KEY`, `D-110` / `HAA-02`). `.tix` typechecking (`mix check` / LSP) also checks explicit key expressions against `string | number | symbol` at compile time.
- **Legacy Control-Flow Deprecation (`D-133`):** Legacy `{#if}` / `{#each}` / `{#await}` blocks remain parseable for backward compatibility and emit a `MIX_WARN_LEGACY_CONTROL_FLOW` warning in `mix check` and the Language Server.

### 6.3 Error Boundary Block (`{try} ... {catch err, reset} ... {endtry}` — `D-189`)
```mix
{try}
  <RiskyWidget />
{catch err, reset}
  <p>Failed: {String(err)}</p>
  <button onClick={reset}>Retry</button>
{endtry}
```
- Dual-mode equivalent: `<ErrorBoundary fallback={(err, reset) => ...}>...</ErrorBoundary>`.
- Catches synchronous render errors, reactive effect errors, and event handler errors inside its subtree, renders the fallback, and restores the primary subtree when `reset()` is invoked. During SSR (`renderToString`), a thrown error rolls back partial subtree output and renders the fallback HTML.

---

## 7. Attributes, Directives, and Event Handlers

- **Static Attributes:** `name="value"` or boolean shorthand `disabled` (`StaticAttributeNode`)
- **Reactive Attribute Bindings:** `name={expr}` or element/fragment subtree `name={<span/>}` (`DynamicAttributeNode`, `D-132`)
- **Event Listeners:** `onClick={handler}`, `onInput={handler}`, `@click={handler}`, or `on:click={handler}` (`EventBindingNode`)
- **Element References:** `ref={myRef}` (`RefBindingNode`)
- **Trusted HTML Directive:** `mix-html={trustedHtmlExpr}` (`DirectiveAttributeNode`, validated at runtime via `SanitizerProvider` and `WeakSet` registry per `D-109` / `HAA-03`)
