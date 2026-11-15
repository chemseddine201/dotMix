# Language Specification Draft — Sections 6 & 7: Dual-Mode Directives

**Status:** DRAFT FOR HAA RATIFICATION (Gate 38; `D-170`..`D-181`)  
**Target Canonical Document:** `spec/LANGUAGE.md` (§6 and §7)  
**Authority:** Human Architecture Authority  

> This draft specifies the normative grammar and semantic rules for dual-mode template directives (F1–F14) intended to replace/extend `spec/LANGUAGE.md` §6 and §7 upon HAA ratification.

---

## 6. Dual-Mode Control-Flow and Template Directives (`D-170`..`D-180`)

### 6.1 Dual-Mode Equivalence & Component Recognition (`DM-1`, `DM-2`, `DM-3`)

1. **Compile-Time Equivalence (`DM-1`):** Every directive has a **block form** (`{keyword ...}`) and an equivalent **component form** (`<Component ...>`). Both forms lower during semantic analysis to the identical AST/IR node and emit byte-identical client DOM and SSR JavaScript.
2. **Compile-Time Resolution:** Directive components are resolved at compile time and are never runtime wrapper calls, except:
   - `<Can>` and `<KeepAlive>`, which are existing runtime components (`CanChain` lowers `{can}/{elsecan}/{else}` and branched `<Can>` into nested runtime `Can` calls; `KeepAliveBlock` lowers `{keepalive}` and `<KeepAlive>` to the runtime `KeepAlive` primitive);
   - `<AuthProvider>`, which is a runtime context provider.
   Calling an uncompiled directive stub at runtime throws `MIX_ERR_DIRECTIVE_NOT_COMPILED`.
3. **Import-Binding Recognition (`DM-3`):** A PascalCase tag `<Tag ...>` is recognized as a directive component **if and only if** its identifier resolves in the module's pre-template imports to `"@dotmix/runtime/directives"` (or `"@dotmix/runtime/permissions"` for `<Can>`). Local or third-party components sharing a directive name are never captured.
4. **Optional Branches & Conflict Rule (`DM-4`):** Branch props (`else`, `fallback`, `pending`, `catch`) and child branch elements (`<Else>`, `<Empty>`) are optional. Supplying both a prop and a corresponding child branch on the same directive emits `MIX_ERR_DIRECTIVE_ELSE_CONFLICT`.
5. **Reactivity & Exposed Bindings (`DM-5`, `DM-6`):** Every directive expression or prop accepts `Maybe<T> = T | (() => T)` and is reactively tracked unless explicitly untracked (`{once}`, `{memo}`). Exposed bindings use `as Ident` in block mode and child render-function parameters `{(ident) => ...}` in component mode, bound to the same internal accessors with narrowed types.
6. **Style Policy (`DM-8`, `D-179`):** `mix lint --template-style blocks|components|hybrid` (default `hybrid`) enforces a single template style by inspecting the AST `form` (`"block"` | `"component"`) and reporting disallowed forms at their exact `SourceSpan`.

### 6.2 Grammar of Block Directives

Embedded expressions inside block headers use parser-driven expression boundaries (`R-SYN-01`). Contextual keywords (`as`, `on`, `in`, `if`, `unless`, `from`, `to`, `step`, `times`, `role`, `render`, `with`, `once`, `by`, `field`, `max`, `visible`, `idle`) are recognized strictly in their syntactic positions.

```ebnf
BlockDirective
  = IfBlock | UnlessBlock | IsSetBlock | IsEmptyBlock
  | SwitchBlock | EachBlock | ForBlock | AwaitBlock
  | AuthBlock | GuestBlock | CanBlock | CannotBlock | CanAnyBlock
  | DevBlock | ProductionBlock | EnvBlock | ContextBlock
  | FieldErrorBlock | FormErrorsBlock | FieldValidBlock | CsrfBlock | MethodBlock
  | SectionBlock | YieldBlock | HasSectionBlock | SectionMissingBlock
  | PushBlock | PrependBlock | StackBlock
  | IncludeBlock | IncludeFirstBlock
  | OnceBlock | MemoBlock | LazyBlock | KeepAliveBlock
  | SessionBlock | PartialBlock | JsonBlock | DumpBlock | VerbatimBlock ;

IfBlock        = "{if" , Expr , "}" , Body , { "{elseif" , Expr , "}" , Body } , [ "{else}" , Body ] , "{endif}" ;
UnlessBlock    = "{unless" , Expr , "}" , Body , [ "{else}" , Body ] , "{endunless}" ;
IsSetBlock     = "{isset" , Expr , [ "as" , Ident ] , "}" , Body , [ "{else}" , Body ] , "{endisset}" ;
IsEmptyBlock   = "{isempty" , Expr , "}" , Body , [ "{else}" , Body ] , "{endisempty}" ;

SwitchBlock    = "{switch" , [ Expr ] , "}" , { SwitchCase } , [ "{default}" , Body ] , "{endswitch}" ;
SwitchCase     = ( "{case" , ExprList , "}" | "{case" , "if" , Expr , "}" ) , Body ;

EachBlock      = "{each" , EachHeader , "}" , [ LoopControls ] , Body , [ "{empty}" , Body ] , "{endeach}"
               | "{each" , Ident , "in" , Expr , "render" , Expr , "}" , [ "{empty}" , Body ] , "{endeach}" ;
EachHeader     = ( "(" , Ident , [ "," , Ident , [ "," , Expr ] ] , ")" | Ident ) , "in" , Expr
               | Expr , "as" , ( "(" , Ident , [ "," , Ident ] , ")" | Ident ) ;
LoopControls   = { ( "{continue" | "{break" ) , "if" , Expr , "}" } ;

ForBlock       = "{for" , Ident , "from" , Expr , "to" , Expr , [ "step" , Expr ] , "}" , Body , "{endfor}"
               | "{for" , Ident , "times" , Expr , "}" , Body , "{endfor}" ;

AwaitBlock     = "{await" , Expr , "}" , Body , [ "{then" , Ident , "}" , Body ] , [ "{catch" , Ident , "}" , Body ] , "{endawait}" ;

AuthBlock      = "{auth" , [ StringLit ] , [ "role" , ExprList ] , [ "as" , Ident ] , "}" , Body , [ "{else}" , Body ] , "{endauth}" ;
GuestBlock     = "{guest" , [ StringLit ] , "}" , Body , [ "{else}" , Body ] , "{endguest}" ;

CanBlock       = "{can" , CanArgs , "}" , Body , { "{elsecan" , CanArgs , "}" , Body } , [ "{else}" , Body ] , "{endcan}" ;
CannotBlock    = "{cannot" , CanArgs , "}" , Body , [ "{else}" , Body ] , "{endcannot}" ;
CanAnyBlock    = "{canany" , Expr , "on" , Expr , "}" , Body , [ "{else}" , Body ] , "{endcanany}" ;
CanArgs        = Expr , "on" , Expr , [ "field" , StringLit ] ;

DevBlock       = "{dev}" , Body , "{enddev}" ;
ProductionBlock= "{production}" , Body , "{endproduction}" ;
EnvBlock       = "{env" , StringLit , { "," , StringLit } , "}" , Body , [ "{else}" , Body ] , "{endenv}" ;
ContextBlock   = "{context" , Expr , "as" , Ident , "}" , Body , [ "{else}" , Body ] , "{endcontext}" ;

FieldErrorBlock= "{error" , StringLit , "in" , Expr , [ "as" , Ident ] , "}" , Body , "{enderror}" ;
FormErrorsBlock= "{errors" , "in" , Expr , [ "as" , Ident ] , "}" , Body , "{enderrors}" ;
FieldValidBlock= "{valid" , StringLit , "in" , Expr , "}" , Body , "{endvalid}" ;
CsrfBlock      = "{csrf}" ;
MethodBlock    = "{method" , StringLit , "}" ;

SectionBlock   = "{section" , StringLit , "}" , Body , "{endsection}" ;
YieldBlock     = "{yield" , StringLit , "}" , Body , "{endyield}" ;
HasSectionBlock= "{hassection" , StringLit , "}" , Body , "{endhassection}" ;
SectionMissingBlock = "{sectionmissing" , StringLit , "}" , Body , "{endsectionmissing}" ;
PushBlock      = "{push" , StringLit , [ "once" , StringLit ] , "}" , Body , "{endpush}" ;
PrependBlock   = "{prepend" , StringLit , [ "once" , StringLit ] , "}" , Body , "{endprepend}" ;
StackBlock     = "{stack" , StringLit , "}" ;

IncludeBlock   = "{include" , Expr , [ "with" , Expr ] , [ ( "if" | "unless" ) , Expr ] , "}" ;
IncludeFirstBlock = "{includefirst" , Expr , [ "with" , Expr ] , "}" , Body , [ "{else}" , Body ] , "{endincludefirst}" ;

OnceBlock      = "{once}" , Body , "{endonce}" ;
MemoBlock      = "{memo" , "on" , Expr , [ "by" , Expr ] , "}" , Body , "{endmemo}" ;
LazyBlock      = "{lazy" , [ "visible" | "idle" ] , "}" , Body , [ "{else}" , Body ] , "{endlazy}" ;
KeepAliveBlock = "{keepalive" , Expr , [ "max" , Expr ] , [ "as" , Ident ] , "}" , Body , "{endkeepalive}" ;

SessionBlock   = "{session" , StringLit , "as" , Ident , "}" , Body , [ "{else}" , Body ] , "{endsession}" ;
PartialBlock   = "{partial" , StringLit , "}" , Body , "{endpartial}" ;
JsonBlock      = "{json" , Expr , "as" , StringLit , "}" ;

DumpBlock      = "{dump" , Expr , "}" ;
VerbatimBlock  = "{verbatim}" , RawText , "{endverbatim}" ;
```

### 6.3 Family Semantics & Validation Rules

1. **Conditionals (F1):**
   - `{else}` is permitted only inside: `if`, `unless`, `isset`, `isempty`, `auth`, `guest`, `can`, `cannot`, `canany`, `env`, `context`, `includefirst`, `lazy`, `session`.
   - `{isset}` narrows its `as` / child-function parameter to `NonNullable<T>`.
   - `{isempty}` treats `null`, `undefined`, `""`, empty arrays (`length === 0`), empty `Map`/`Set` (`size === 0`), and plain objects with zero own enumerable keys as empty; `0` and `false` are **not** empty.
   - Orphan `<ElseIf>` / `<Else>` emit `MIX_ERR_DIRECTIVE_ORPHAN_BRANCH`; `<Else>` before `<ElseIf>` or duplicate `<Else>` emit `MIX_ERR_DIRECTIVE_BRANCH_ORDER`.

2. **Switch (F2):**
   - Cases evaluate in source order without fall-through; value matching uses `Object.is`.
   - When `{switch}` / `<Switch>` omits its subject (`on`), value cases (`{case "a"}` / `<Case is>`) are forbidden (`MIX_ERR_SWITCH_CASE_FORM`). Combining `is` and `condition` on `<Case>` also emits `MIX_ERR_SWITCH_CASE_FORM`.
   - Content before the first case emits `MIX_ERR_SWITCH_STRAY_CONTENT`; non-final `{default}` / `<Default>` emits `MIX_ERR_SWITCH_DEFAULT_ORDER`.

3. **Loops (F3):**
   - `{continue if E}` and `{break if E}` must appear strictly as the leading statements of an `{each}` body before markup (`MIX_ERR_LOOP_CONTROL_POSITION`), with loop variables in scope. They lower to a pre-keying filter (`!skip`) and take-while (`!stop`, excluding the matching item).
   - In `<Each>` component mode, the child function's second parameter `index` is bound to the internal index getter (`i()` matches block-mode `i`).
   - `{for}` bounds are reactive and `to` is inclusive; `step === 0` throws `MIX_ERR_FOR_STEP_ZERO`; ranges exceeding 100,000 items throw `MIX_ERR_FOR_RANGE_TOO_LARGE`.

4. **Async, Auth, Permissions (F4–F6):**
   - `{await}` / `<Await>` tracks promise identity and discards stale resolutions.
   - `{auth}` / `{guest}` read the `AuthProvider` context (`MIX_ERR_AUTH_PROVIDER_MISSING` if absent; `MIX_ERR_AUTH_ROLE_UNSUPPORTED` if `role` is used without `hasRole`).
   - The type of the `as` binding / callback parameter is resolved in this order: annotated callback parameter, nearest same-file <AuthProvider> (per guard), Register.auth (per guard), otherwise unknown.
   - `{can}` / `{elsecan}` / `{else}` and `<Can>` containing `<ElseCan>` / `<Else>` lower to `CanChain` (nested runtime `Can` calls via `fallback`). Plain `<Can>` without branch children stays an unlowered runtime component call.

5. **Compile-Time Environment & Context (F7):**
   - `{dev}`, `{production}`, and `{env}` (`<Dev>`, `<Production>`, `<Env>`) are evaluated at compile time against the compiler's `mode` (`"development"` in `mix dev`, `"production"` in `mix build`, overridden by `--mode` or Vite `config.mode`). Inactive branches are eliminated from emitted client and SSR code. Non-static `<Env is>` emits `MIX_ERR_ENV_NOT_STATIC`.
   - `{context Ctx as v}` reads `getContext(Ctx)` and narrows `v` to `NonNullable<T>`.

6. **Forms, Sections, Stacks, Head, Composition, Render Control (F8–F11):**
   - Form error visibility requires `error() !== null && touched()`; `handleSubmit()` marks all fields touched. Unknown static field names emit `MIX_ERR_FORM_FIELD_UNKNOWN`.
   - Stacks render prepends first (in mount order), then pushes (in mount order), deduplicating `once` by id, and removing contributions on unmount.
   - `{push "head"}` / `<Head>` (`<Title>`, `<Meta>`, `<Link>`) deduplicates `title` (last-wins), `meta` (by `name`, `property`, or `http-equiv`), and `link` (by `rel` + `href`), restoring prior tags on unmount and injecting into `<head>` during SSR.
   - `{once}` prohibits signal writes (`MIX_ERR_ONCE_WRITE`); `{memo on []}` emits `MIX_WARN_MEMO_EMPTY_DEPS`.
   - `{lazy}` defers mounting until `IntersectionObserver` (`"visible"`, default) or `requestIdleCallback` / `setTimeout` (`"idle"`) on the client, and renders immediately during SSR.
   - `{keepalive}` / `<KeepAlive>` lowers to the existing runtime LRU `KeepAlive` (`activeKey`, `max`, `children`); SSR renders only the active key's subtree.

7. **SSR & Verbatim (F13–F14):**
   - `@dotmix/server-node` supplies `RequestContext { session(key): unknown; csrfToken(): string }` during SSR.
   - `renderToString(App, { partial: "name" })` isolates and returns only the named `{partial}` / `<Partial>` region.
   - `{json}` / `<Json>` emits `<script type="application/json">` escaping `</script` (case-insensitive), `<!--`, `U+2028`, and `U+2029`.
   - `{dump}` / `<Dump>` is omitted completely in `production` mode.
   - `{verbatim}` / `<Verbatim>` enters raw-text scanning mode until the matching closer; `<Verbatim>` requires pre-template import recognition from `@dotmix/runtime/directives`.

---

## 7. Attributes, Class/Style Maps, and Conditional Modifiers (`D-109`, `D-132`, `D-175`, `D-181`)

### 7.1 Standard Attributes & Bindings

- **Static attributes:** `name="value"` or boolean shorthand `disabled` (`StaticAttributeNode`).
- **Reactive attributes:** `name={expr}` or element/fragment template subtree `name={<span/>}` (`DynamicAttributeNode`, `D-132`).
- **Event listeners:** `onClick={handler}`, `on:click={handler}`, `@click={handler}` with optional modifier chains (`.prevent`, `.stop`, `.self`, `.once`, `.capture`, `.passive`, `.debounce`, `.throttle`, `.window`, `.document`, `.outside`, key filters, `.ctrl`, `.shift`, `.alt`, `.meta`).
- **Refs & two-way bindings:** `ref={myRef}`, `bind:value={sig}`, `bind:checked={sig}`.
- **Trusted HTML:** `mix-html={trustedHtmlExpr}` (`D-109`).

### 7.2 Class & Style Maps and Directives (F12.1)

```ebnf
ClassDirective = "class" , "=" , "{" , ( ObjectExpr | ArrayExpr ) , "}"
               | "class:" , CssIdent , "=" , "{" , Expr , "}" ;
StyleDirective = "style" , "=" , "{" , ObjectExpr , "}"
               | "style:" , ( CssIdent | "--" , CssIdent ) , "=" , "{" , Expr , "}" ;
```

- Object/array `class` bindings and `class:<name>` directives merge with static `class="..."` attributes and compile to one `toggleClass` effect per key.
- Object `style` bindings and `style:<prop>` (including CSS custom properties `style:--var`) compile to one `style.setProperty` effect per key.

### 7.3 Conditional Attributes, Spreads, and Events (F12.2, F12.3)

```ebnf
AttrModifier   = AttrName , ":" , ( "if" | "unless" | "else" | "match" | "case-" , CaseToken ) , "=" , AttrVal ;
CaseToken      = Ident | IntegerLiteral ;
SpreadModifier = "{..." , Expr , "}" , "spread:if=" , "{" , Expr , "}" ;
EventModifier  = EventName , ":" , ( "if" | "unless" | "else" ) , "=" , "{" , Expr , "}" ;
```

1. **Attribute modifiers:**
   - `attr:if={c}` / `attr:unless={c}` require a base `attr={v}` or `attr="v"` on the same element (`MIX_ERR_CONDITIONAL_WITHOUT_BASE`).
   - `attr:match={x}` pairs with `attr:case-<token>={v}` and optional `attr:else={fallback}` without requiring a base attribute.
   - `spread:if={c}` requires an adjacent `{...obj}` spread (`MIX_ERR_CONDITIONAL_WITHOUT_BASE`).
   - Boolean HTML attributes (`checked`, `selected`, `disabled`, `readonly`, `required`, `hidden`) treat `attr={c}` and `attr:if={c}` identically.
2. **Event modifiers:**
   - Evaluate the condition **before** attaching any listener so an inactive handler is never attached even briefly.
   - Transitions (`falsy → truthy`, `truthy → falsy`) call `addEventListener` / `removeEventListener` with the exact same listener reference and options; `:else` swaps handlers atomically within a single effect run.
   - Owner cleanup detaches active listeners on unmount; SSR emits no event listeners; hydration evaluates the condition first.
   - On components (`<Card onSelect={fn} onSelect:if={cond} />`), the prop resolves to `undefined` when inactive.
3. **Modifier diagnostics:**
   - `MIX_ERR_CONDITIONAL_CONFLICT`: `:if` and `:unless` on the same attribute or event.
   - `MIX_ERR_CONDITIONAL_ELSE_ALONE`: `:else` without a matching `:if`, `:unless`, or `:match`.
   - `MIX_WARN_INERT_INTERACTIVE`: `onClick:if` / `onClick:unless` on `<button>` or `<a href>` without `disabled` or `aria-disabled:unless`.
