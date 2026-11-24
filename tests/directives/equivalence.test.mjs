/**
 * Dual-Mode Directives — Registry integrity and unmocked client + SSR equivalence suite.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import {
  analyze,
  DIRECTIVE_SPECS,
  ATTRIBUTE_DIRECTIVE_SPECS,
  BOOLEAN_HTML_ATTRIBUTES,
  ALL_BLOCK_OPEN_KEYWORDS,
  ALL_BLOCK_CLOSE_KEYWORDS,
  ALL_BRANCH_MARKERS,
  ALL_INLINE_STATEMENTS,
  ELSE_SUPPORTING_BLOCKS,
  ALL_MAIN_COMPONENT_NAMES,
  ALL_BRANCH_COMPONENT_NAMES,
  ALL_COMPONENT_NAMES,
  getBlockDirectiveSpec,
  getComponentDirectiveSpec,
  getBranchComponentSpecs,
  isDirectiveComponentName,
  isValidDirectiveImportSource,
  DIRECTIVES_IMPORT,
  PERMISSIONS_IMPORT
} from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { generate } from "../../node_modules/@dotmix/compiler-codegen/dist/index.js";
import { compileToSsr } from "../../node_modules/@dotmix/compiler-ssr/dist/index.js";
import {
  DiagnosticCodes,
  DIRECTIVE_DIAGNOSTIC_METADATA,
  getDiagnosticMetadata
} from "../../node_modules/@dotmix/diagnostics/dist/index.js";
import { createDirectiveNode, walk } from "../../node_modules/@dotmix/ast/dist/index.js";

const EXPECTED_BLOCK_OPENERS = [
  "if", "unless", "isset", "isempty", "switch", "each", "for", "await",
  "auth", "guest", "can", "cannot", "canany", "dev", "production", "env",
  "context", "error", "errors", "valid", "csrf", "method", "section",
  "yield", "hassection", "sectionmissing", "push", "prepend", "stack",
  "include", "includefirst", "once", "memo", "lazy", "hydrate", "keepalive", "try",
  "session", "partial", "json", "dump", "verbatim"
];

const EXPECTED_BLOCK_CLOSERS = [
  "endif", "endunless", "endisset", "endisempty", "endswitch", "endeach",
  "endfor", "endawait", "endauth", "endguest", "endcan", "endcannot",
  "endcanany", "enddev", "endproduction", "endenv", "endcontext",
  "enderror", "enderrors", "endvalid", "endsection", "endyield",
  "endhassection", "endsectionmissing", "endpush", "endprepend",
  "endincludefirst", "endonce", "endmemo", "endlazy", "endhydrate", "endkeepalive", "endtry",
  "endsession", "endpartial", "endverbatim"
];

const EXPECTED_BRANCH_MARKERS = [
  "elseif", "else", "case", "default", "empty", "then", "catch", "elsecan"
];

const EXPECTED_ELSE_BLOCKS = [
  "if", "unless", "isset", "isempty", "auth", "guest", "can", "cannot",
  "canany", "env", "context", "includefirst", "lazy", "session"
];

const EXPECTED_MAIN_COMPONENTS = [
  "If", "Unless", "IsSet", "IsEmpty", "Switch", "Each", "For", "Await",
  "Auth", "Guest", "Can", "Cannot", "CanAny", "Dev", "Production", "Env",
  "Context", "FieldError", "FormErrors", "FieldValid", "Csrf", "Method",
  "Section", "Yield", "HasSection", "SectionMissing", "Push", "Prepend",
  "Stack", "Head", "Include", "IncludeFirst", "Once", "Memo", "Lazy", "Hydrate",
  "KeepAlive", "ErrorBoundary", "Session", "Partial", "Json", "Dump", "Verbatim"
];

const EXPECTED_BRANCH_COMPONENTS = [
  "ElseIf", "Else", "Case", "Default", "Empty", "ElseCan", "Title", "Meta", "Link"
];

const EXPECTED_ATTRIBUTE_MODIFIER_IDS = [
  "attr:if", "attr:unless", "attr:else", "attr:match", "attr:case",
  "spread:if", "class:map", "class:name", "style:map", "style:prop",
  "event:if", "event:unless", "event:else"
];

const EXPECTED_DIRECTIVE_DIAGNOSTIC_CODES = [
  "MIX_ERR_DIRECTIVE_ORPHAN_BRANCH",
  "MIX_ERR_DIRECTIVE_BRANCH_ORDER",
  "MIX_ERR_DIRECTIVE_ELSE_CONFLICT",
  "MIX_ERR_DIRECTIVE_NOT_COMPILED",
  "MIX_ERR_SWITCH_CASE_FORM",
  "MIX_ERR_SWITCH_STRAY_CONTENT",
  "MIX_ERR_SWITCH_DEFAULT_ORDER",
  "MIX_ERR_LOOP_CONTROL_POSITION",
  "MIX_ERR_FOR_STEP_ZERO",
  "MIX_ERR_FOR_RANGE_TOO_LARGE",
  "MIX_ERR_AUTH_PROVIDER_MISSING",
  "MIX_ERR_AUTH_ROLE_UNSUPPORTED",
  "MIX_ERR_ENV_NOT_STATIC",
  "MIX_ERR_FORM_FIELD_UNKNOWN",
  "MIX_WARN_MEMO_EMPTY_DEPS",
  "MIX_ERR_ONCE_WRITE",
  "MIX_ERR_CONDITIONAL_WITHOUT_BASE",
  "MIX_ERR_CONDITIONAL_CONFLICT",
  "MIX_ERR_CONDITIONAL_ELSE_ALONE",
  "MIX_WARN_INERT_INTERACTIVE"
];

function compilePairOutputs(sourceCode, compileOpts = {}) {
  const filename = compileOpts.filename ?? "SampleComponent.tix";
  const parsed = parse(sourceCode, { filename });
  const descriptor = analyze(parsed, { filename, source: sourceCode, throwOnError: true });
  const clientOut = generate(descriptor, { filename, componentName: "SampleComponent", mode: compileOpts.mode ?? "development" });
  const ssrOut = compileToSsr(descriptor, undefined, { includeHydrationMarkers: false, mode: compileOpts.mode ?? "development" });
  return { descriptor, clientJs: clientOut.js, ssrCode: ssrOut.code };
}

function normalizeDevEachLoc(js) {
  return js.replace(/, loc: \{[^}]*\}/g, "");
}

function assertBlockEqualsComponent(title, blockSource, componentSource, compileOpts = {}) {
  test(`equivalence: ${title}`, () => {
    const blockOut = compilePairOutputs(blockSource, compileOpts);
    const compOut = compilePairOutputs(componentSource, compileOpts);
    assert.equal(normalizeDevEachLoc(compOut.clientJs), normalizeDevEachLoc(blockOut.clientJs), `Client JS mismatch for ${title}`);
    assert.equal(compOut.ssrCode, blockOut.ssrCode, `SSR code mismatch for ${title}`);
    if (!compileOpts.mode) {
      const prodBlock = compilePairOutputs(blockSource, { ...compileOpts, mode: "production" });
      const prodComp = compilePairOutputs(componentSource, { ...compileOpts, mode: "production" });
      assert.equal(prodComp.clientJs, prodBlock.clientJs, `Prod Client JS mismatch for ${title}`);
      assert.ok(!prodComp.clientJs.includes("loc:"), `Prod Client JS must not contain dev loc for ${title}`);
    }
    assert.ok(!compOut.clientJs.includes("@dotmix/runtime/directives"), `Directive import leaked in client JS for ${title}`);
    assert.ok(!compOut.ssrCode.includes("@dotmix/runtime/directives"), `Directive import leaked in SSR code for ${title}`);
  });
}

test("registry block keywords and branch markers are complete and frozen", () => {
  assert.deepEqual([...ALL_BLOCK_OPEN_KEYWORDS].sort(), [...EXPECTED_BLOCK_OPENERS].sort());
  assert.deepEqual([...ALL_BLOCK_CLOSE_KEYWORDS].sort(), [...EXPECTED_BLOCK_CLOSERS].sort());
  assert.deepEqual([...ALL_BRANCH_MARKERS].sort(), [...EXPECTED_BRANCH_MARKERS].sort());
  assert.deepEqual([...ALL_INLINE_STATEMENTS].sort(), ["break", "continue"]);
  assert.deepEqual([...ELSE_SUPPORTING_BLOCKS].sort(), [...EXPECTED_ELSE_BLOCKS].sort());
  assert.ok(Object.isFrozen(DIRECTIVE_SPECS));
  assert.ok(Object.isFrozen(ATTRIBUTE_DIRECTIVE_SPECS));
});

test("registry component names and import bindings enforce compile-time rules", () => {
  assert.deepEqual([...ALL_MAIN_COMPONENT_NAMES].sort(), [...EXPECTED_MAIN_COMPONENTS].sort());
  assert.deepEqual([...ALL_BRANCH_COMPONENT_NAMES].sort(), [...EXPECTED_BRANCH_COMPONENTS].sort());
  assert.deepEqual(
    [...ALL_COMPONENT_NAMES].sort(),
    [...EXPECTED_MAIN_COMPONENTS, ...EXPECTED_BRANCH_COMPONENTS].sort()
  );

  assert.equal(isDirectiveComponentName("AuthProvider"), false);
  assert.equal(isDirectiveComponentName("If"), true);
  assert.equal(isDirectiveComponentName("ElseCan"), true);

  assert.equal(isValidDirectiveImportSource("If", DIRECTIVES_IMPORT), true);
  assert.equal(isValidDirectiveImportSource("If", "./local.tix"), false);
  assert.equal(isValidDirectiveImportSource("Can", PERMISSIONS_IMPORT), true);
  assert.equal(isValidDirectiveImportSource("Can", DIRECTIVES_IMPORT), true);

  assert.equal(getComponentDirectiveSpec("Can")?.isRuntimeComponent, true);
  assert.equal(getComponentDirectiveSpec("KeepAlive")?.isRuntimeComponent, true);
  assert.equal(getComponentDirectiveSpec("If")?.isRuntimeComponent, false);
  assert.equal(getBlockDirectiveSpec("verbatim")?.rawTextMode, true);
});

test("registry props match specification and omit KeepAlive id prop", () => {
  const propNames = (spec) => spec.props.map((prop) => prop.name);

  assert.deepEqual(propNames(getComponentDirectiveSpec("If")), ["condition", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Unless")), ["condition", "else", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("IsSet")), ["value", "else", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("IsEmpty")), ["value", "else", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Switch")), ["on", "children"]);
  assert.deepEqual(
    getBranchComponentSpecs("Case")[0].props.map((prop) => prop.name),
    ["is", "condition", "children"]
  );
  assert.deepEqual(propNames(getComponentDirectiveSpec("Each")), [
    "data", "key", "skip", "stop", "fallback", "render", "as", "children"
  ]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("For")), [
    "from", "to", "step", "times", "children"
  ]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Await")), [
    "promise", "pending", "catch", "children"
  ]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Auth")), ["guard", "role", "else", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Guest")), ["guard", "else", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Can")), [
    "I", "this", "a", "an", "field", "not", "fallback", "children"
  ]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Env")), ["is", "else", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Context")), ["of", "else", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("FieldError")), ["form", "name", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("FormErrors")), ["form", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("FieldValid")), ["form", "name", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Csrf")), []);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Method")), ["value"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Push")), ["to", "once", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Prepend")), ["to", "once", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Stack")), ["name"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Include")), [
    "component", "props", "condition", "unless", "pending", "fallback"
  ]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("IncludeFirst")), [
    "candidates", "props", "pending", "fallback", "children"
  ]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Memo")), ["on", "equals", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Lazy")), ["trigger", "fallback", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Hydrate")), ["when", "media", "children"]);

  const keepAliveProps = propNames(getComponentDirectiveSpec("KeepAlive"));
  assert.deepEqual(keepAliveProps, ["activeKey", "max", "render", "children"]);
  assert.equal(keepAliveProps.includes("id"), false);

  assert.deepEqual(propNames(getComponentDirectiveSpec("Session")), ["key", "else", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Partial")), ["name", "children"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Json")), ["id", "data"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Dump")), ["value"]);
  assert.deepEqual(propNames(getComponentDirectiveSpec("Verbatim")), ["children"]);
});

test("attribute modifier specs and directive diagnostic metadata are complete", () => {
  assert.deepEqual(
    ATTRIBUTE_DIRECTIVE_SPECS.map((spec) => spec.id).sort(),
    [...EXPECTED_ATTRIBUTE_MODIFIER_IDS].sort()
  );
  assert.deepEqual(
    [...BOOLEAN_HTML_ATTRIBUTES].sort(),
    ["checked", "disabled", "hidden", "readonly", "required", "selected"]
  );

  for (const code of EXPECTED_DIRECTIVE_DIAGNOSTIC_CODES) {
    assert.equal(DiagnosticCodes[code], code, `Missing DiagnosticCodes.${code}`);
    const meta = getDiagnosticMetadata(code);
    assert.ok(meta, `Missing metadata for ${code}`);
    assert.ok(meta.message.length > 0);
    assert.ok(meta.hint.length > 0);
  }
  assert.equal(
    Object.keys(DIRECTIVE_DIAGNOSTIC_METADATA).length,
    EXPECTED_DIRECTIVE_DIAGNOSTIC_CODES.length
  );
});

test("directive AST nodes freeze and walk visits children cleanly", () => {
  const span = {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 10, offset: 9 },
    file: "Sample.tix"
  };
  const textChild = { type: "Text", value: "hello", span };
  const elseChild = { type: "Text", value: "fallback", span };
  const node = createDirectiveNode({
    type: "UnlessBlock",
    span,
    condition: { type: "Identifier", name: "ready" },
    rawCondition: "ready",
    consequent: [textChild],
    alternate: [elseChild],
    form: "block"
  });

  assert.ok(Object.isFrozen(node));
  assert.ok(Object.isFrozen(node.consequent));

  const visited = [];
  walk(node, { enter: (visitedNode) => visited.push(visitedNode.type) });
  assert.deepEqual(visited, ["UnlessBlock", "Text", "Text"]);
});

// End-to-end byte-identical client + SSR equivalence pairs across every directive family

assertBlockEqualsComponent(
  "if / elseif / else conditional chain",
  `<script>const ok = false; const alt = true;</script><div>{if ok}<span>A</span>{elseif alt}<span>B</span>{else}<span>C</span>{endif}</div>`,
  `<script>import { If, ElseIf, Else } from "@dotmix/runtime/directives"; const ok = false; const alt = true;</script><div><If condition={ok}><span>A</span><ElseIf condition={alt}><span>B</span></ElseIf><Else><span>C</span></Else></If></div>`
);

assertBlockEqualsComponent(
  "unless / else conditional",
  `<script>const banned = false;</script><div>{unless banned}<p>Welcome</p>{else}<p>Denied</p>{endunless}</div>`,
  `<script>import { Unless, Else } from "@dotmix/runtime/directives"; const banned = false;</script><div><Unless condition={banned}><p>Welcome</p><Else><p>Denied</p></Else></Unless></div>`
);

assertBlockEqualsComponent(
  "isset with narrowed binding and else",
  `<script>const user = { name: "Ada" };</script><div>{isset user as member}<span>{member.name}</span>{else}<span>Guest</span>{endisset}</div>`,
  `<script>import { IsSet, Else } from "@dotmix/runtime/directives"; const user = { name: "Ada" };</script><div><IsSet value={user}>{(member) => <span>{member().name}</span>}<Else><span>Guest</span></Else></IsSet></div>`
);

assertBlockEqualsComponent(
  "isempty with else",
  `<script>const records = [];</script><div>{isempty records}<p>None</p>{else}<p>Has rows</p>{endisempty}</div>`,
  `<script>import { IsEmpty, Else } from "@dotmix/runtime/directives"; const records = [];</script><div><IsEmpty value={records}><p>None</p><Else><p>Has rows</p></Else></IsEmpty></div>`
);

assertBlockEqualsComponent(
  "switch with value cases, multiple matches, condition case, and default",
  `<script>const role = "editor"; const flags = { isTrial: false };</script><div>{switch role}{case "admin", "owner"}<p>Admin</p>{case "editor"}<p>Editor</p>{default}<p>Viewer</p>{endswitch}{switch}{case if flags.isTrial}<p>Trial</p>{default}<p>Paid</p>{endswitch}</div>`,
  `<script>import { Switch, Case, Default } from "@dotmix/runtime/directives"; const role = "editor"; const flags = { isTrial: false };</script><div><Switch on={role}><Case is={["admin", "owner"]}><p>Admin</p></Case><Case is="editor"><p>Editor</p></Case><Default><p>Viewer</p></Default></Switch><Switch><Case condition={flags.isTrial}><p>Trial</p></Case><Default><p>Paid</p></Default></Switch></div>`
);

assertBlockEqualsComponent(
  "each basic loop with index getter unwrapped identically",
  `<script>const tasks = [{ id: 1, title: "Write" }];</script><ul>{each (task, idx, task.id) in tasks}<li>{idx}: {task.title}</li>{endeach}</ul>`,
  `<script>import { Each } from "@dotmix/runtime/directives"; const tasks = [{ id: 1, title: "Write" }];</script><ul><Each data={tasks} key={(task) => task.id}>{(task, idx) => <li>{idx()}: {task.title}</li>}</Each></ul>`
);

assertBlockEqualsComponent(
  "each extended loop with skip, stop, and empty fallback",
  `<script>const tasks = [{ id: 1, archived: false, title: "Ship" }];</script><ul>{each tasks as task, idx}{continue if task.archived}{break if idx >= 10}<li>{idx}: {task.title}</li>{empty}<li>Empty</li>{endeach}</ul>`,
  `<script>import { Each, Empty } from "@dotmix/runtime/directives"; const tasks = [{ id: 1, archived: false, title: "Ship" }];</script><ul><Each data={tasks} skip={(task) => task.archived} stop={(_, idx) => idx >= 10}>{(task, idx) => <li>{idx()}: {task.title}</li>}<Empty><li>Empty</li></Empty></Each></ul>`
);

assertBlockEqualsComponent(
  "each render component shorthand",
  `<script>const tasks = [{ id: 1 }]; function TaskRow(props) { return props.task.id; }</script><div>{each task in tasks render TaskRow}{endeach}</div>`,
  `<script>import { Each } from "@dotmix/runtime/directives"; const tasks = [{ id: 1 }]; function TaskRow(props) { return props.task.id; }</script><div><Each data={tasks} as="task" render={TaskRow} /></div>`
);

assertBlockEqualsComponent(
  "for range and times bounded loops",
  `<script>const limit = 3;</script><div>{for stepNum from 1 to limit step 1}<span>{stepNum}</span>{endfor}{for countIdx times 2}<b>{countIdx}</b>{endfor}</div>`,
  `<script>import { For } from "@dotmix/runtime/directives"; const limit = 3;</script><div><For from={1} to={limit} step={1}>{(stepNum) => <span>{stepNum()}</span>}</For><For times={2}>{(countIdx) => <b>{countIdx()}</b>}</For></div>`
);

assertBlockEqualsComponent(
  "await promise with pending, then, and catch",
  `<script>const req = Promise.resolve("ok");</script><div>{await req}<p>Loading</p>{then payload}<p>{payload}</p>{catch err}<p>{err}</p>{endawait}</div>`,
  `<script>import { Await } from "@dotmix/runtime/directives"; const req = Promise.resolve("ok");</script><div><Await promise={req} pending={<p>Loading</p>} catch={(err) => <p>{err()}</p>}>{(payload) => <p>{payload()}</p>}</Await></div>`
);

assertBlockEqualsComponent(
  "auth and guest directives",
  `<script></script><div>{auth "web" role "admin", "mod" as account}<span>{account.email}</span>{else}<span>Anon</span>{endauth}{guest}<a href="/login">Sign in</a>{endguest}</div>`,
  `<script>import { Auth, Guest, Else } from "@dotmix/runtime/directives";</script><div><Auth guard="web" role={["admin", "mod"]}>{(account) => <span>{account().email}</span>}<Else><span>Anon</span></Else></Auth><Guest><a href="/login">Sign in</a></Guest></div>`
);

assertBlockEqualsComponent(
  "can chain with elsecan and else, plus cannot and canany",
  `<script>const post = { id: 1 };</script><div>{can "edit" on post}<span>Edit</span>{elsecan "view" on post}<span>View</span>{else}<span>Hidden</span>{endcan}{cannot "delete" on post}<span>Locked</span>{endcannot}{canany ["publish", "archive"] on post}<span>Manage</span>{endcanany}</div>`,
  `<script>import { Can, ElseCan, Else, Cannot, CanAny } from "@dotmix/runtime/directives"; const post = { id: 1 };</script><div><Can I="edit" this={post}><span>Edit</span><ElseCan I="view" this={post}><span>View</span></ElseCan><Else><span>Hidden</span></Else></Can><Cannot I="delete" this={post}><span>Locked</span></Cannot><CanAny I={["publish", "archive"]} this={post}><span>Manage</span></CanAny></div>`
);

assertBlockEqualsComponent(
  "dev, production, and env compile-time gates",
  `<script></script><div>{dev}<span>DevOnly</span>{enddev}{production}<span>ProdOnly</span>{endproduction}{env "development", "staging"}<span>StageOrDev</span>{else}<span>Other</span>{endenv}</div>`,
  `<script>import { Dev, Production, Env, Else } from "@dotmix/runtime/directives";</script><div><Dev><span>DevOnly</span></Dev><Production><span>ProdOnly</span></Production><Env is={["development", "staging"]}><span>StageOrDev</span><Else><span>Other</span></Else></Env></div>`
);

assertBlockEqualsComponent(
  "context reader with narrowed binding",
  `<script>const ThemeCtx = { defaultValue: "light" };</script><div>{context ThemeCtx as theme}<span>{theme}</span>{else}<span>None</span>{endcontext}</div>`,
  `<script>import { Context, Else } from "@dotmix/runtime/directives"; const ThemeCtx = { defaultValue: "light" };</script><div><Context of={ThemeCtx}>{(theme) => <span>{theme()}</span>}<Else><span>None</span></Else></Context></div>`
);

assertBlockEqualsComponent(
  "forms error, errors, valid, csrf, and method",
  `<script>const loginForm = { field: () => ({ touched: () => false, error: () => null, validating: () => false }), errors: () => ({}) };</script><form>{csrf}{method "PATCH"}{error "email" in loginForm as msg}<span>{msg}</span>{enderror}{errors in loginForm as errList}<ul>{each errList as entry}<li>{entry.message}</li>{endeach}</ul>{enderrors}{valid "email" in loginForm}<span>OK</span>{endvalid}</form>`,
  `<script>import { Csrf, Method, FieldError, FormErrors, FieldValid, Each } from "@dotmix/runtime/directives"; const loginForm = { field: () => ({ touched: () => false, error: () => null, validating: () => false }), errors: () => ({}) };</script><form><Csrf /><Method value="PATCH" /><FieldError form={loginForm} name="email">{(msg) => <span>{msg()}</span>}</FieldError><FormErrors form={loginForm}>{(errList) => <ul><Each data={errList()}>{(entry) => <li>{entry.message}</li>}</Each></ul>}</FormErrors><FieldValid form={loginForm} name="email"><span>OK</span></FieldValid></form>`
);

assertBlockEqualsComponent(
  "layout sections, yield, stacks, and head group",
  `<script>function PageShell() { return null; } const pageTitle = "Home";</script><PageShell>{section "sidebar"}<aside>Nav</aside>{endsection}{yield "header"}<h1>Default</h1>{endyield}{hassection "sidebar"}<span>HasSidebar</span>{endhassection}{sectionmissing "footer"}<span>NoFooter</span>{endsectionmissing}{push "scripts" once "app"}<span data-role="script"></span>{endpush}{prepend "styles"}<span data-role="style"></span>{endprepend}{stack "scripts"}{push "head"}<title>{pageTitle}</title><meta name="description" content="Docs" />{endpush}</PageShell>`,
  `<script>import { Section, Yield, HasSection, SectionMissing, Push, Prepend, Stack, Head, Title, Meta } from "@dotmix/runtime/directives"; function PageShell() { return null; } const pageTitle = "Home";</script><PageShell><Section name="sidebar"><aside>Nav</aside></Section><Yield name="header"><h1>Default</h1></Yield><HasSection name="sidebar"><span>HasSidebar</span></HasSection><SectionMissing name="footer"><span>NoFooter</span></SectionMissing><Push to="scripts" once="app"><span data-role="script"></span></Push><Prepend to="styles"><span data-role="style"></span></Prepend><Stack name="scripts" /><Head><Title>{pageTitle}</Title><Meta name="description" content="Docs" /></Head></PageShell>`
);

assertBlockEqualsComponent(
  "composition include and includefirst",
  `<script>function Card() { return null; } const ok = true; const cands = [Card];</script><div>{include Card with { title: "Hi" } if ok}{includefirst cands}<span>Busy</span>{else}<span>Missing</span>{endincludefirst}</div>`,
  `<script>import { Include, IncludeFirst, Else } from "@dotmix/runtime/directives"; function Card() { return null; } const ok = true; const cands = [Card];</script><div><Include component={Card} props={{ title: "Hi" }} condition={ok} /><IncludeFirst candidates={cands} pending={<span>Busy</span>}><Else><span>Missing</span></Else></IncludeFirst></div>`
);

assertBlockEqualsComponent(
  "render control once, memo, lazy, hydrate, and keepalive without id",
  `<script>const activeTab = "tab-1"; const stamp = 1;</script><div>{once}<p>Static</p>{endonce}{memo on [stamp]}<p>{stamp}</p>{endmemo}{lazy idle}<p>Deferred</p>{else}<p>Wait</p>{endlazy}{hydrate visible}<p>Visible</p>{endhydrate}{hydrate media "(max-width: 768px)"}<p>Mobile</p>{endhydrate}{hydrate never}<p>StaticOnly</p>{endhydrate}{keepalive activeTab max 5 as key}<section>{key}</section>{endkeepalive}</div>`,
  `<script>import { Once, Memo, Lazy, Else, Hydrate, KeepAlive } from "@dotmix/runtime/directives"; const activeTab = "tab-1"; const stamp = 1;</script><div><Once><p>Static</p></Once><Memo on={[stamp]}><p>{stamp}</p></Memo><Lazy trigger="idle"><p>Deferred</p><Else><p>Wait</p></Else></Lazy><Hydrate when="visible"><p>Visible</p></Hydrate><Hydrate when='media "(max-width: 768px)"'><p>Mobile</p></Hydrate><Hydrate when="never"><p>StaticOnly</p></Hydrate><KeepAlive activeKey={activeTab} max={5}>{(key) => <section>{key()}</section>}</KeepAlive></div>`
);

assertBlockEqualsComponent(
  "error boundary try/catch and ErrorBoundary component",
  `<script>function Risky() { return null; }</script><div>{try}<Risky />{catch err, reset}<button onClick={reset}>{String(err)}</button>{endtry}</div>`,
  `<script>import { ErrorBoundary } from "@dotmix/runtime/directives"; function Risky() { return null; }</script><div><ErrorBoundary fallback={(err, reset) => <button onClick={reset}>{String(err())}</button>}><Risky /></ErrorBoundary></div>`
);

assertBlockEqualsComponent(
  "server rendering session, partial, json, and debug dump and verbatim",
  `<script>const payload = { ok: true };</script><div>{session "flash" as flashMsg}<p>{flashMsg}</p>{else}<p>Empty</p>{endsession}{partial "feed"}<ul><li>Row</li></ul>{endpartial}{json payload as "state"}{dump payload}{verbatim}Literal {if ok} markup{endverbatim}</div>`,
  `<script>import { Session, Else, Partial, Json, Dump, Verbatim } from "@dotmix/runtime/directives"; const payload = { ok: true };</script><div><Session key="flash">{(flashMsg) => <p>{flashMsg()}</p>}<Else><p>Empty</p></Else></Session><Partial name="feed"><ul><li>Row</li></ul></Partial><Json id="state" data={payload} /><Dump value={payload} /><Verbatim>Literal {if ok} markup</Verbatim></div>`
);

test("compile-time mode removes dev/env/dump output in production builds", () => {
  const source = `<script>const secret = { token: "dev-secret" };</script><div>{dev}DEV_SECRET_BANNER{enddev}{production}PROD_BANNER{endproduction}{env "staging"}STAGING_BANNER{endenv}{dump secret}</div>`;
  const devResult = compilePairOutputs(source, { mode: "development" });
  assert.ok(devResult.clientJs.includes("DEV_SECRET_BANNER"));
  assert.ok(!devResult.clientJs.includes("PROD_BANNER"));
  assert.ok(devResult.clientJs.includes("mix-dump"));
  assert.ok(devResult.ssrCode.includes("DEV_SECRET_BANNER"));
  assert.ok(!devResult.ssrCode.includes("PROD_BANNER"));
  assert.ok(devResult.ssrCode.includes("mix-dump"));

  const prodResult = compilePairOutputs(source, { mode: "production" });
  assert.ok(!prodResult.clientJs.includes("DEV_SECRET_BANNER"));
  assert.ok(prodResult.clientJs.includes("PROD_BANNER"));
  assert.ok(!prodResult.clientJs.includes("STAGING_BANNER"));
  assert.ok(!prodResult.clientJs.includes("mix-dump"));
  assert.ok(!prodResult.ssrCode.includes("DEV_SECRET_BANNER"));
  assert.ok(prodResult.ssrCode.includes("PROD_BANNER"));
  assert.ok(!prodResult.ssrCode.includes("mix-dump"));
});

test("attribute, class, style, match, and conditional event modifiers compile for client and SSR", () => {
  const source = `<script>const active = true; const tier = "pro"; const extra = { role: "button" }; function save() {} function deny() {}</script><button class={{ active }} class:primary={active} style={{ color: "red" }} style:width.px={100} title="Edit" title:if={active} title:else="Locked" data-tier:match={tier} data-tier:case-pro="p" data-tier:else="free" disabled={active} on:click={save} on:click:if={active} on:click:else={deny} {...extra} spread:if={active}>Go</button>`;
  const out = compilePairOutputs(source);
  assert.ok(out.clientJs.includes("__mixBindClassMap"));
  assert.ok(out.clientJs.includes("__mixToggleClass"));
  assert.ok(out.clientJs.includes("__mixBindStyleMap"));
  assert.ok(out.clientJs.includes("__mixSetStyleProp"));
  assert.ok(out.clientJs.includes("__mixBindConditionalAttr"));
  assert.ok(out.clientJs.includes("__mixBindMatchAttr"));
  assert.ok(out.clientJs.includes("__mixBindBooleanAttr"));
  assert.ok(out.clientJs.includes("__mixOnConditionalEvent"));
  assert.ok(out.clientJs.includes("__mixSpreadAttrs"));
  assert.ok(out.ssrCode.includes("__mixSsrClassTokens"));
  assert.ok(out.ssrCode.includes("__mixSsrFormatStyle"));
});

test("KeepAlive SSR renders active key subtree without DOM APIs or caching", () => {
  const source = `<script>const tab = "profile";</script><div>{keepalive tab as currentTab}<span>Active:{currentTab}</span>{endkeepalive}</div>`;
  const out = compilePairOutputs(source);
  assert.ok(!out.ssrCode.includes("document."));
  assert.ok(!out.ssrCode.includes("KeepAlive("));
  assert.ok(out.ssrCode.includes("const currentTab = (tab);"));
});
