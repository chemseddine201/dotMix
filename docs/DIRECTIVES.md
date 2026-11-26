# Mix & Tix Directives Reference

Mix supports **Dual-Mode Directives** across all `.mix` and `.tix` templates:

- **Block mode (clean mode):** concise compiler blocks such as `{if ...}`, `{each ...}`, `{auth ...}`, `{switch ...}`. Requires no imports.
- **Component mode (hybrid mode):** typed compile-time components imported from `@dotmix/runtime/directives` such as `<If>`, `<Each>`, `<Auth>`, `<Switch>`.

Both modes lower to the **exact same Intermediate Representation (IR)** and emit **byte-identical** client DOM and SSR output.

---

## 0. Quick Reference

| Family | Block (clean mode) | Component (hybrid mode) |
|---|---|---|
| Conditionals | `{if c}` `{elseif c}` `{else}` `{endif}` | `<If condition>` `<ElseIf condition>` `<Else>` |
| Conditionals | `{unless c}` `{else}` `{endunless}` | `<Unless condition>` `<Else>` |
| Conditionals | `{isset v as x}` `{else}` `{endisset}` | `<IsSet value>{(x) => …}` `<Else>` |
| Conditionals | `{isempty v}` `{else}` `{endisempty}` | `<IsEmpty value>` `<Else>` |
| Switch | `{switch s}` `{case "a", "b"}` `{case if c}` `{default}` `{endswitch}` | `<Switch on>` `<Case is>` `<Case condition>` `<Default>` |
| Loops | `{each (x, i) in list}` `{empty}` `{endeach}` | `<Each data fallback>{(x, i) => …}` / `<Empty>` |
| Loops | `{continue if c}` `{break if c}` | `<Each … skip stop>` |
| Loops | `{each x in list render Card}` `{empty}` `{endeach}` | `<Each data render as fallback />` |
| Loops | `{for i from a to b step s}` / `{for i times n}` `{endfor}` | `<For from to step>` / `<For times>` |
| Async | `{await p}` `{then v}` `{catch e}` `{endawait}` | `<Await promise pending catch>{(v) => …}` |
| Authentication | `{auth "guard" role "r" as user}` `{else}` `{endauth}` | `<Auth guard role>{(user) => …}` `<Else>` |
| Authentication | `{guest "guard"}` `{else}` `{endguest}` | `<Guest guard>` `<Else>` |
| Authorization | `{can "act" on subj}` `{elsecan …}` `{else}` `{endcan}` | `<Can I this>` `<ElseCan I this>` `<Else>` |
| Authorization | `{cannot "act" on subj}` `{endcannot}` | `<Cannot I this>` |
| Authorization | `{canany ["a","b"] on subj}` `{endcanany}` | `<CanAny I this>` |
| Environment & Context | `{dev}` `{production}` `{env "x"}` | `<Dev>` `<Production>` `<Env is>` |
| Environment & Context | `{context Ctx as v}` `{else}` `{endcontext}` | `<Context of>{(v) => …}` |
| Forms | `{error "f" in form as m}` `{errors in form as list}` `{valid "f" in form}` | `<FieldError form name>` `<FormErrors form>` `<FieldValid form name>` |
| Forms | `{csrf}` `{method "PUT"}` | `<Csrf />` `<Method value />` |
| Layouts & Stacks | `{section "n"}` `{yield "n"}` `{hassection "n"}` `{sectionmissing "n"}` | `<Section name>` `<Yield name>` `<HasSection name>` `<SectionMissing name>` |
| Layouts & Stacks | `{push "s" once "id"}` `{prepend "s"}` `{stack "s"}` | `<Push to once>` `<Prepend to once>` `<Stack name />` |
| Layouts & Stacks | `{push "head"}` | `<Head>` `<Title>` `<Meta>` `<Link>` |
| Composition | `{include Card with {…} if c}` / `unless c` | `<Include component props condition />` / `unless` |
| Composition | `{includefirst [loaders]}` `{else}` `{endincludefirst}` | `<IncludeFirst candidates fallback />` |
| Render Control | `{once}` `{memo on [deps]}` `{lazy visible}` `{keepalive key (max n)? (as k)?}` | `<Once>` `<Memo on>` `<Lazy trigger>` `<KeepAlive activeKey max>{(k) => …}</KeepAlive>` |
| Attributes & Events | `attr:if` `attr:unless` `attr:else` `attr:match` / `attr:case-x` `spread:if`, `class:x`, `style:x` | (attribute modifiers, same in both modes) |
| Attributes & Events | `onClick:if` `onClick:unless` `onClick:else` | (event modifiers, same in both modes) |
| Server Rendering | `{session "k" as v}` `{partial "n"}` `{json value as "id"}` | `<Session key>` `<Partial name>` `<Json id data />` |
| Debug & Text | `{dump v}` `{verbatim}…{endverbatim}` | `<Dump value />` `<Verbatim>` |

---

## Core Design Rules

- **Same IR, same output:** Directive components are resolved at compile time and lower to the same IR as block directives, producing byte-identical client and SSR code. (`<Can>`, `<KeepAlive>`, and `<AuthProvider>` are runtime components.)
- **Same word:** Block keywords and component names match directly (`{each}` ↔ `<Each>`, `{for}` ↔ `<For>`). Only `{error}`/`{errors}`/`{valid}` use qualified names (`<FieldError>`, `<FormErrors>`, `<FieldValid>`) to avoid collisions.
- **Import-binding recognition:** Directive components are recognized only when imported from `@dotmix/runtime/directives` (or `@dotmix/runtime/permissions` for `<Can>`). Local components with matching names are never hijacked.
- **Optional branches:** `else`, `fallback`, `pending`, and `catch` are optional; never supply both a prop (`else={...}`) and a child branch (`<Else>`), which triggers `MIX_ERR_DIRECTIVE_ELSE_CONFLICT`.
- **Reactive:** All block arguments and component props accept `Maybe<T>` (`T | (() => T)`) and are tracked reactively.
- **Exposed values:** Exposed bindings use `as x` in block mode and typed child functions `{(x) => ...}` in component mode.
- **Exact diagnostics:** Misuse produces a compile-time `MixDiagnosticError` with exact source span.
- **Template style lint:** Enforce `blocks`, `components`, or `hybrid` (default) via `mix lint --template-style <style>`.
- **Canonical prop names:** `condition` (boolean gate), `value` (inspected value), `on` (switch subject / memo deps), `data` (collection), `name` / `to` (target name), `is` (match value), `trigger` (timing).
- **Markup comments:** Comments are not supported inside markup (`{/* … */}` or `{// …}`); put comments in the component script above `return` (`MIX_ERR_PARSE_SYNTAX`).
- **Component lifecycle hooks:** `onMount(callback)` and `onCleanup(fn)` are auto-imported primitives from `@dotmix/runtime` (also importable explicitly). `onMount` queues `callback` once in a microtask after the synchronous render pass inserts the component's nodes (skipped if the owner is disposed first; any returned cleanup runs on owner disposal; no-op under SSR).

---

## 1. Conditionals

### 1.1 `if` / `elseif` / `else` (`<If>`, `<ElseIf>`, `<Else>`)

Renders the first truthy branch; only the active branch is mounted in the DOM. Inside every `{elseif}`, `{else}`, `{case}` and `{default}` branch, types narrow exactly like a TypeScript `if / else if / else` chain, so the forms are interchangeable.

**Block mode:**
```mix
{if user().isAdmin}
  <AdminPanel />
{elseif user().isEditor}
  <EditorPanel />
{else}
  <ReadOnlyView />
{endif}
```

**Component mode:**
```mix
<If condition={user().isAdmin}>
  <AdminPanel />
  <ElseIf condition={user().isEditor}><EditorPanel /></ElseIf>
  <Else><ReadOnlyView /></Else>
</If>
```

**Props:** `IfProps { condition: Maybe<unknown>; children: Children }`, `ElseIfProps { condition: Maybe<unknown>; children: Children }`, `ElseProps { children: Children }`.  
**Diagnostics:** `MIX_ERR_DIRECTIVE_ORPHAN_BRANCH`, `MIX_ERR_DIRECTIVE_BRANCH_ORDER`, `MIX_ERR_DIRECTIVE_ELSE_CONFLICT`.

### 1.2 `unless` (`<Unless>`)

Renders when `condition` is falsy.

**Block mode:**
```mix
{unless cart().length}<p>Your cart is empty.</p>{endunless}
```

**Component mode:**
```mix
<Unless condition={cart().length}><p>Your cart is empty.</p></Unless>
```

**Props:** `UnlessProps { condition: Maybe<unknown>; else?: Children; children: Children }`.

### 1.3 `isset` (`<IsSet>`)

Renders when `value !== null && value !== undefined`, narrowing the exposed binding to `NonNullable<T>`.

**Block mode:**
```mix
{isset user() as u}<p>Hello {u.name}</p>{else}<p>Guest</p>{endisset}
```

**Component mode:**
```mix
<IsSet value={user()}>
  {(u) => <p>Hello {u.name}</p>}
  <Else><p>Guest</p></Else>
</IsSet>
```

**Props:** `IsSetProps<T> { value: Maybe<T | null | undefined>; else?: Children; children: Children | ((value: NonNullable<T>) => Children) }`.

### 1.4 `isempty` (`<IsEmpty>`)

Renders when `value` is `null`, `undefined`, `""`, an array of length `0`, a `Map` or `Set` of size `0`, or a plain object with no own enumerable keys. `0` and `false` are **not** empty.

**Block mode:**
```mix
{isempty filters()}<p>No filters applied.</p>{else}<FilterChips list={filters()} />{endisempty}
```

**Component mode:**
```mix
<IsEmpty value={filters()} else={<FilterChips list={filters()} />}><p>No filters applied.</p></IsEmpty>
```

**Props:** `IsEmptyProps { value: Maybe<unknown>; else?: Children; children: Children }`.

---

## 2. Switch (`{switch}` / `<Switch>`, `<Case>`, `<Default>`)

Tests cases in source order using `Object.is` (`is`) or truthiness (`condition`) with no fall-through. Without `on`, only condition cases are allowed. Inside every `{elseif}`, `{else}`, `{case}` and `{default}` branch, types narrow exactly like a TypeScript `if / else if / else` chain, so the forms are interchangeable. The type check compares with `===`; at runtime values match with `Object.is` (they differ only for `NaN` and `-0`).

**Block mode:**
```mix
{switch status()}
  {case "loading"} <Spinner />
  {case "error", "timeout"} <ErrorBox message={error()} />
  {case if items().length === 0} <EmptyState />
  {default} <TaskList items={items()} />
{endswitch}
```

**Component mode:**
```mix
<Switch on={status()}>
  <Case is="loading"><Spinner /></Case>
  <Case is={["error", "timeout"]}><ErrorBox message={error()} /></Case>
  <Case condition={items().length === 0}><EmptyState /></Case>
  <Default><TaskList items={items()} /></Default>
</Switch>
```

**Props:** `SwitchProps<T> { on?: Maybe<T>; children: Children }`, `CaseProps<T> { is?: T | readonly T[]; condition?: Maybe<unknown>; children: Children }`, `DefaultProps { children: Children }`.  
**Diagnostics:** `MIX_ERR_SWITCH_CASE_FORM`, `MIX_ERR_SWITCH_STRAY_CONTENT`, `MIX_ERR_SWITCH_DEFAULT_ORDER`, `MIX_ERR_DIRECTIVE_ORPHAN_BRANCH`.

---

## 3. Loops

### 3.1 `each` + `empty` (`<Each>`, `<Empty>`)

Keyed reactive iteration with a two-mode key policy (`D-188`):
- **Implicit mode** (no key written): uses `item.id`, then `item.key` when a valid primitive (`string | finite number | symbol`), else object/function reference identity, else primitive value. Never throws on keys; duplicates are disambiguated by occurrence with stable DOM reuse and a single dev warning (`MIX_WARN_IMPLICIT_DUPLICATE_KEY`).
- **Explicit mode** (`{each (item, i, keyExpr) in list}` or `<Each key={(item) => ...}>`): strictly requires `string | finite number | symbol` (`MIX_ERR_INVALID_KEY`) and unique keys (`MIX_ERR_DUPLICATE_KEY`, atomic rejection). Checked at compile time in `.tix`.

In `<Each>`, the child function's `item` parameter binds to the item value and `index` binds to the index getter, so `i()` compiles identically to block-mode `i`.

**Block mode:**
```mix
{each (task, i) in tasks()}
  <TaskRow task={task} position={i + 1} />
{empty}
  <p>No tasks yet.</p>
{endeach}
```

**Component mode:**
```mix
<Each data={tasks()} fallback={<p>No tasks yet.</p>}>
  {(task, i) => <TaskRow task={task} position={i() + 1} />}
</Each>

<Each data={tasks()}>
  {(task, i) => <TaskRow task={task} position={i() + 1} />}
  <Empty><p>No tasks yet.</p></Empty>
</Each>
```

### 3.2 `continue if` / `break if` (`skip` / `stop`)

Must appear as the first statements of an `{each}` body before markup; lowered to a filter + take-while pipeline prior to keying.

**Block mode:**
```mix
{each (task, i) in tasks()}
  {continue if task.archived}
  {break if i >= 20}
  <TaskRow task={task} />
{endeach}
```

**Component mode:**
```mix
<Each data={tasks()} skip={(t) => t.archived} stop={(_, i) => i >= 20}>{(task) => <TaskRow task={task} />}</Each>
```

**Diagnostics:** `MIX_ERR_LOOP_CONTROL_POSITION`.

### 3.3 `each ... render` (`<Each render as?>`)

Renders a component once per item, passing the item under the loop variable name (block) or `as` prop (default `"item"`).

**Block mode:**
```mix
{each task in tasks() render TaskCard}{empty}<p>No tasks.</p>{endeach}
```

**Component mode:**
```mix
<Each data={tasks()} render={TaskCard} as="task" fallback={<p>No tasks.</p>} />
```

### 3.4 `for` (`<For>`)

Bounded reactive numeric range (`to` inclusive; default `step` is `1` or `-1` when `from > to`) or counted `times` (`0 .. n-1`).

**Block mode:**
```mix
<select>{for y from 2020 to currentYear()}<option value={y}>{y}</option>{endfor}</select>
{for i times rating()}<StarIcon />{endfor}
```

**Component mode:**
```mix
<select><For from={2020} to={currentYear()}>{(y) => <option value={y}>{y}</option>}</For></select>
<For times={rating()}>{() => <StarIcon />}</For>
```

**Runtime Errors:** `MIX_ERR_FOR_STEP_ZERO`, `MIX_ERR_FOR_RANGE_TOO_LARGE` (`> 100,000` items).

---

## 4. Async (`{await}` / `<Await>`)

Tracks promise identity, resets to `pending` when a new promise arrives, and ignores stale resolutions.

**Block mode:**
```mix
{await loadProfile(id())}
  <Spinner />
{then profile}
  <ProfileCard profile={profile} />
{catch err}
  <ErrorBox message={String(err)} />
{endawait}
```

**Component mode:**
```mix
<Await promise={loadProfile(id())} pending={<Spinner />} catch={(e) => <ErrorBox message={String(e)} />}>
  {(profile) => <ProfileCard profile={profile} />}
</Await>
```

**Props:** `AwaitProps<T> { promise: Maybe<Promise<T>>; pending?: Children; catch?: (error: unknown) => Children; children: (value: T) => Children }`.

---

## 5. Authentication (`{auth}`, `{guest}` / `<Auth>`, `<Guest>`, `<AuthProvider>`)

Configured via `createAuth({ guards, defaultGuard, hasRole })` and provided by `<AuthProvider value={auth}>`.

### 5.1 `auth` (`<Auth>`)

**Block mode:**
```mix
{auth as user}<p>Welcome back, {user.name}</p>{else}<LoginButton />{endauth}
{auth "admin" role "owner", "editor"}<AdminMenu />{endauth}
```

**Component mode:**
```mix
<Auth else={<LoginButton />}>{(user) => <p>Welcome back, {user.name}</p>}</Auth>
<Auth guard="admin" role={["owner", "editor"]}><AdminMenu /></Auth>
```

### 5.2 `guest` (`<Guest>`)

**Block mode:**
```mix
{guest}<a href="/login">Sign in</a>{endguest}
```

**Component mode:**
```mix
<Guest><a href="/login">Sign in</a></Guest>
```

### 5.3 Typing the user

The type of `user` in `{auth as user}`, `<Auth>{(user) => ...}</Auth>` and `useAuth().user()` is
resolved by four levels. The first one that applies wins.

**1. Annotated callback parameter (component form).** The annotation gives the type. When a guard
type is also known (level 2 or 3), it must be assignable to the annotation, and the type checker
reports a mismatch.

```mix
<Auth guard="admin">{(user: AdminUser) => <p>{user.permissions.length}</p>}</Auth>
```

**2. Same-file provider.** The nearest enclosing `<AuthProvider value={expr}>` in the same file
gives the type, per guard:

```mix
<AuthProvider value={appAuth}>
  {auth as user}<p>{user.email}</p>{endauth}
  {auth "admin" as user}<p>{user.permissions.length}</p>{endauth}
</AuthProvider>
```

**3. App-wide registration.** Register the auth type once, by module augmentation:

```ts
// src/auth/appAuth.ts
import { createAuth } from "@dotmix/runtime/directives";
export const appAuth = createAuth({
  guards: {
    web: (): Customer | null => session.customer(),
    admin: (): AdminUser | null => session.admin(),
  },
  defaultGuard: "web",
});

// src/env.d.ts
/// <reference types="@dotmix/runtime/client" />
declare module "@dotmix/runtime/directives" {
  interface Register {
    auth: typeof import("./auth/appAuth").appAuth;
  }
}
```

Then, in any file:

```text
{auth as user} ............. user: Customer (the default guard)
{auth "admin" as user} ..... user: AdminUser
const auth = useAuth(); .... auth.user("admin"): AdminUser | null
```

A project that prefers a hand-written interface, or has no auth instance in scope, registers the
types directly with the exported helper type:

```ts
declare module "@dotmix/runtime/directives" {
  interface Register {
    auth: AuthInstanceOf<{ web: Customer; admin: AdminUser }, "web">;
  }
}
```

**4. Fallback.** Otherwise `user` is `unknown`. Property access on it reports a type error with
this hint:

```text
Type the auth user: register it in src/env.d.ts (interface Register { auth: ... }), wrap the block in <AuthProvider value={...}>, or annotate the parameter in <Auth>{(user: User) => ...}</Auth>.
```

**Diagnostics:** `MIX_ERR_AUTH_PROVIDER_MISSING`, `MIX_ERR_AUTH_ROLE_UNSUPPORTED`.

---

## 6. Authorization (`{can}`, `{cannot}`, `{canany}` / `<Can>`, `<ElseCan>`, `<Cannot>`, `<CanAny>`)

`{can}…{elsecan}…{else}…{endcan}` and `<Can>` containing `<ElseCan>` / `<Else>` children both lower to `CanChain`, emitting nested calls to the existing runtime `Can` component where each `elsecan` / `else` becomes the previous `Can`'s `fallback`. A plain `<Can fallback={...}>` without `<ElseCan>` / `<Else>` children remains unchanged.

### 6.1 `can` / `elsecan` / `else` (`<Can>`, `<ElseCan>`, `<Else>`)

**Block mode:**
```mix
{can "update" on task}
  <EditButton task={task} />
{elsecan "read" on task}
  <ViewButton task={task} />
{else}
  <LockIcon />
{endcan}
```

**Component mode:**
```mix
<Can I="update" this={task}>
  <EditButton task={task} />
  <ElseCan I="read" this={task}><ViewButton task={task} /></ElseCan>
  <Else><LockIcon /></Else>
</Can>
```

### 6.2 `cannot` (`<Cannot>`)

**Block mode:**
```mix
{cannot "delete" on project}<p>Only owners can delete this project.</p>{endcannot}
```

**Component mode:**
```mix
<Cannot I="delete" this={project}><p>Only owners can delete this project.</p></Cannot>
```

### 6.3 `canany` (`<CanAny>`)

**Block mode:**
```mix
{canany ["update", "delete"] on task}<TaskActionsMenu task={task} />{endcanany}
```

**Component mode:**
```mix
<CanAny I={["update", "delete"]} this={task}><TaskActionsMenu task={task} /></CanAny>
```

---

## 7. Environment & Context

### 7.1 `dev` / `production` / `env` (`<Dev>`, `<Production>`, `<Env>`)

Resolved at compile time from the build `mode` (`mix dev` → `development`, `mix build` → `production`, `--mode <name>`, Vite `config.mode`). Inactive branches are stripped completely from output.

**Block mode:**
```mix
{dev}<DebugToolbar />{enddev}
{env "staging", "preview"}<Banner text="Test environment" />{endenv}
```

**Component mode:**
```mix
<Dev><DebugToolbar /></Dev>
<Env is={["staging", "preview"]}><Banner text="Test environment" /></Env>
```

**Diagnostics:** `MIX_ERR_ENV_NOT_STATIC`.

### 7.2 `context` (`<Context>`)

Reads `getContext(of)` and renders when non-nullish.

**Block mode:**
```mix
{context ThemeContext as theme}<Logo variant={theme.mode} />{endcontext}
```

**Component mode:**
```mix
<Context of={ThemeContext}>{(theme) => <Logo variant={theme.mode} />}</Context>
```

---

## 8. Forms (`{error}`, `{errors}`, `{valid}`, `{csrf}`, `{method}`)

Errors are visible when `fields[name].error() !== null && fields[name].touched()`. `handleSubmit()` marks all fields touched.

**Block mode:**
```mix
{error "email" in form as message}<p class="error">{message}</p>{enderror}
<form method="post" action="/tasks/7">{csrf}{method "PUT"}<button>Save</button></form>
```

**Component mode:**
```mix
<FieldError form={form} name="email">{(message) => <p class="error">{message}</p>}</FieldError>
<form method="post" action="/tasks/7"><Csrf /><Method value="PUT" /><button>Save</button></form>
```

Also:
- `{errors in form as list}...{enderrors}` ↔ `<FormErrors form>{(list) => ...}</FormErrors>`
- `{valid "email" in form}...{endvalid}` ↔ `<FieldValid form name>...</FieldValid>`

**Diagnostics:** `MIX_ERR_FORM_FIELD_UNKNOWN`.

---

## 9. Layouts, Sections, Stacks, and Head

### 9.1 Sections (`{section}`, `{yield}`, `{hassection}`, `{sectionmissing}`)

**Block mode:**
```mix
<DashboardLayout>
  {section "sidebar"}<TaskFilters />{endsection}
  <TaskList />
</DashboardLayout>

<div class="layout">
  {hassection "sidebar"}<aside>{yield "sidebar"}{endyield}</aside>{endhassection}
  <main><slot /></main>
</div>
```

**Component mode:**
```mix
<DashboardLayout>
  <Section name="sidebar"><TaskFilters /></Section>
  <TaskList />
</DashboardLayout>

<div class="layout">
  <HasSection name="sidebar"><aside><Yield name="sidebar" /></aside></HasSection>
  <main><slot /></main>
</div>
```

### 9.2 Stacks (`{push}`, `{prepend}`, `{stack}`)

Prepends render first (in order), then pushes (in order). `once` keeps only the first entry with that id. Entries are removed on unmount and collected during SSR.

**Block mode:**
```mix
{push "scripts" once "chart-lib"}<script src="/vendor/chart.js"></script>{endpush}
{stack "scripts"}
```

**Component mode:**
```mix
<Push to="scripts" once="chart-lib"><script src="/vendor/chart.js"></script></Push>
<Stack name="scripts" />
```

### 9.3 Head (`{push "head"}` / `<Head>`, `<Title>`, `<Meta>`, `<Link>`)

Deduplication: `title` last-wins; `meta` by `name`, `property`, or `http-equiv`; `link` by `rel` + `href`. Restores previous tags on unmount and injects into `<head>` during SSR.

**Block mode:**
```mix
{push "head"}
  <title>{task().title} · Tasks</title>
  <meta name="description" content={task().summary} />
  <link rel="canonical" href={`/tasks/${task().id}`} />
{endpush}
```

**Component mode:**
```mix
<Head>
  <Title>{task().title} · Tasks</Title>
  <Meta name="description" content={task().summary} />
  <Link rel="canonical" href={`/tasks/${task().id}`} />
</Head>
```

---

## 10. Composition (`{include}`, `{includefirst}`)

Supports synchronous component references and dynamic lazy loaders `() => import("./X.tix")`.

**Block mode:**
```mix
{include TaskCard with { task } if showCard()}
{includefirst [() => import("./themes/Custom.tix"), () => import("./themes/Default.tix")]}{else}<p>Theme unavailable</p>{endincludefirst}
```

**Component mode:**
```mix
<Include component={TaskCard} props={{ task }} condition={showCard()} />
<IncludeFirst candidates={[() => import("./themes/Custom.tix"), () => import("./themes/Default.tix")]} fallback={<p>Theme unavailable</p>} />
```

---

## 11. Render Control (`{once}`, `{memo}`, `{lazy}`, `{keepalive}`, `{hydrate}`, `{try}`)

- `{once}` / `<Once>`: untracked single render; never updates (`MIX_ERR_ONCE_WRITE` on signal writes inside).
- `{memo on [deps] (by fn)?}` / `<Memo on equals?>`: updates only when dependencies change (`MIX_WARN_MEMO_EMPTY_DEPS` on empty `[]`).
- `{lazy visible|idle}` / `<Lazy trigger? fallback?>`: defers client mount until viewport intersection (`visible`) or browser idle (`idle`); SSR renders immediately.
- `{keepalive Expr (max Expr)? (as Ident)?}…{endkeepalive}` / `<KeepAlive activeKey max?>{(key) => …}</KeepAlive>`: lowers to the existing runtime LRU `KeepAlive` (`activeKey`, `max`, `children`). SSR renders only the active key's subtree.
- `{try}…{catch err, reset}…{endtry}` / `<ErrorBoundary fallback={(err, reset) => …}>…</ErrorBoundary>`: catches synchronous render, reactive effect, and event handler errors in its subtree, renders the fallback, and supports `reset()` recovery (plus SSR fallback rendering).

**Block mode:**
```mix
{memo on [chartData()]}<HeavyChart data={chartData()} theme={theme()} />{endmemo}
{lazy visible}<CommentsSection postId={id()} />{else}<CommentsSkeleton />{endlazy}
{keepalive activeTab() max 5 as key}<TabPanel id={key} />{endkeepalive}
{try}<RiskyWidget />{catch err, reset}<button onClick={reset}>Retry ({String(err)})</button>{endtry}
```

**Component mode:**
```mix
<Memo on={[chartData]}><HeavyChart data={chartData()} theme={theme()} /></Memo>
<Lazy trigger="visible" fallback={<CommentsSkeleton />}><CommentsSection postId={id()} /></Lazy>
<KeepAlive activeKey={activeTab()} max={5}>{(key) => <TabPanel id={key} />}</KeepAlive>
<ErrorBoundary fallback={(err, reset) => <button onClick={reset}>Retry ({String(err)})</button>}><RiskyWidget /></ErrorBoundary>
```

---

## 12. Attributes, Classes, Styles, and Events

Attribute and event modifiers are identical in both modes (no separate component form):

- **Class / style objects & directives:** `class={{ btn: true, active: isActive() }}`, `class={["btn", isActive() && "active"]}`, `class:active={isActive()}`, `style={{ color: color(), "--gap": gap() + "px" }}`, `style:color={color()}`, `style:--gap={gap() + "px"}` (one fine-grained effect per key).
- **Conditional attributes:** `attr:if={c}`, `attr:unless={c}`, `attr:else={v2}`, `attr:match={x}` + `attr:case-<token>={v}`, `{...obj} spread:if={c}`.
- **Conditional events:** `onClick={save} onClick:if={editable()}`, `onClick:unless={locked()}`, `onClick:else={askToLogin}` (works with `onClick`, `@click`, `on:click`, and modifier chains such as `@click.prevent.outside:if`). Listeners never attach before the first evaluation, swap atomically on `:else`, and clean up on unmount.

```mix
<img src={avatar()} src:if={hasAvatar()} src:else="/img/default.png"
     title="Remove" title:if={canRemove()}
     aria-hidden="true" aria-hidden:unless={visible()} />
<span data-state:match={status()} data-state:case-ok="green" data-state:case-error="red" data-state:else="grey"></span>
<button onClick={save} onClick:if={editable()} aria-disabled:unless={editable()}>Save</button>
```

**Diagnostics:** `MIX_ERR_CONDITIONAL_WITHOUT_BASE`, `MIX_ERR_CONDITIONAL_CONFLICT`, `MIX_ERR_CONDITIONAL_ELSE_ALONE`, `MIX_WARN_INERT_INTERACTIVE`.

---

## 13. Server Rendering (`{session}`, `{partial}`, `{json}`)

`@dotmix/server-node` supplies `RequestContext { session(key): unknown; csrfToken(): string }` during SSR.

**Block mode:**
```mix
{session "flash" as msg}<div class="flash">{msg}</div>{endsession}
{partial "task-row"}<TaskRow task={task()} />{endpartial}
{json initialState() as "app-state"}
```

**Component mode:**
```mix
<Session key="flash">{(msg) => <div class="flash">{msg}</div>}</Session>
<Partial name="task-row"><TaskRow task={task()} /></Partial>
<Json id="app-state" data={initialState()} />
```

- `renderToString(App, { partial: "task-row" })` renders only the named partial region.
- `{json}` / `<Json>` emits `<script type="application/json">` with `</script` (case-insensitive), `<!--`, `U+2028`, and `U+2029` safely escaped.

---

## 14. Debug and Text (`{dump}`, `{verbatim}`)

- `{dump v}` / `<Dump value />`: renders a collapsible JSON view in `development` mode and is stripped completely in `production`.
- `{verbatim}…{endverbatim}` / `<Verbatim>…</Verbatim>`: raw-text mode; nothing inside is parsed as template syntax. `<Verbatim>` is recognized from pre-template import bindings.

**Block mode:**
```mix
{dump currentUser()}
{verbatim}Use {each item in list} … {endeach} to loop.{endverbatim}
```

**Component mode:**
```mix
<Dump value={currentUser()} />
<Verbatim>Use {each item in list} … {endeach} to loop.</Verbatim>
```
