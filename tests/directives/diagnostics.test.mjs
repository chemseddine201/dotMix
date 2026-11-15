/**
 * Dual-Mode Directives — Static diagnostics and compile-time error coverage suite.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { DiagnosticCodes, getDiagnosticMetadata } from "../../node_modules/@dotmix/diagnostics/dist/index.js";

function collectAllDiagnostics(sourceCode) {
  const errors = [];
  const warnings = [];
  try {
    const ast = parse(sourceCode, { filename: "DiagTest.tix" });
    const desc = analyze(ast, { filename: "DiagTest.tix", source: sourceCode, throwOnError: false });
    errors.push(...desc.diagnostics);
    if (desc.warnings) warnings.push(...desc.warnings);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err) {
      errors.push({ code: err.code, message: err.message });
    } else if (err && typeof err === "object" && "diagnostic" in err) {
      errors.push(err.diagnostic);
    } else {
      throw err;
    }
  }
  return { errors, warnings };
}

test("orphan branch component outside enclosing parent reports MIX_ERR_DIRECTIVE_ORPHAN_BRANCH", () => {
  const { errors } = collectAllDiagnostics(
    `<script>import { Else } from "@dotmix/runtime/directives";</script><Else>Stray</Else>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_DIRECTIVE_ORPHAN_BRANCH));
});

test("out-of-order ElseIf after Else reports MIX_ERR_DIRECTIVE_BRANCH_ORDER", () => {
  const { errors } = collectAllDiagnostics(
    `<script>import { If, Else, ElseIf } from "@dotmix/runtime/directives"; const first = true; const second = false;</script><If condition={first}>A<Else>B</Else><ElseIf condition={second}>C</ElseIf></If>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_DIRECTIVE_BRANCH_ORDER));
});

test("both fallback prop and child Else on Can reports MIX_ERR_DIRECTIVE_ELSE_CONFLICT", () => {
  const { errors } = collectAllDiagnostics(
    `<script>import { Can, Else } from "@dotmix/runtime/directives";</script><Can I="edit" fallback="nope"><span>OK</span><Else><span>Denied</span></Else></Can>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_DIRECTIVE_ELSE_CONFLICT));
});

test("Case combining is and condition props reports MIX_ERR_SWITCH_CASE_FORM", () => {
  const { errors } = collectAllDiagnostics(
    `<script>import { Switch, Case } from "@dotmix/runtime/directives"; const mode = "a"; const ready = true;</script><Switch on={mode}><Case is="a" condition={ready}>Bad</Case></Switch>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_SWITCH_CASE_FORM));
});

test("content outside Case/Default inside Switch reports MIX_ERR_SWITCH_STRAY_CONTENT", () => {
  const { errors } = collectAllDiagnostics(
    `<script>import { Switch, Case } from "@dotmix/runtime/directives"; const mode = "a";</script><Switch on={mode}><p>Stray</p><Case is="a">Good</Case></Switch>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_SWITCH_STRAY_CONTENT));
});

test("Default before Case inside Switch reports MIX_ERR_SWITCH_DEFAULT_ORDER", () => {
  const { errors } = collectAllDiagnostics(
    `<script>import { Switch, Case, Default } from "@dotmix/runtime/directives"; const mode = "a";</script><Switch on={mode}><Default>D</Default><Case is="a">A</Case></Switch>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_SWITCH_DEFAULT_ORDER));
});

test("loop control statement after markup in each reports MIX_ERR_LOOP_CONTROL_POSITION", () => {
  const { errors } = collectAllDiagnostics(
    `<script>const items = [{ skip: false }];</script>{each items as item}<p>Markup first</p>{continue if item.skip}{endeach}`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_LOOP_CONTROL_POSITION));
});

test("for loop with zero step reports MIX_ERR_FOR_STEP_ZERO", () => {
  const { errors } = collectAllDiagnostics(
    `<div>{for stepNum from 1 to 5 step 0}{stepNum}{endfor}</div>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_FOR_STEP_ZERO));
});

test("for loop exceeding max iterations reports MIX_ERR_FOR_RANGE_TOO_LARGE", () => {
  const { errors } = collectAllDiagnostics(
    `<div>{for countIdx times 200000}{countIdx}{endfor}</div>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE));
});

test("Env with dynamic expression reports MIX_ERR_ENV_NOT_STATIC", () => {
  const { errors } = collectAllDiagnostics(
    `<script>import { Env } from "@dotmix/runtime/directives"; const dynEnv = "staging";</script><Env is={dynEnv}>Hi</Env>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_ENV_NOT_STATIC));
});

test("unknown form field name reports MIX_ERR_FORM_FIELD_UNKNOWN", () => {
  const { errors } = collectAllDiagnostics(
    `<script>function createForm(spec) { return spec; } const userForm = createForm({ initial: { email: "" } });</script>{error "missingField" in userForm}Err{enderror}`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_FORM_FIELD_UNKNOWN));
});

test("memo with empty dependency array emits MIX_WARN_MEMO_EMPTY_DEPS", () => {
  const { warnings } = collectAllDiagnostics(
    `<div>{memo on []}Static{endmemo}</div>`
  );
  assert.ok(warnings.some((diag) => diag.code === DiagnosticCodes.MIX_WARN_MEMO_EMPTY_DEPS));
});

test("signal write inside once reports MIX_ERR_ONCE_WRITE", () => {
  const { errors } = collectAllDiagnostics(
    `<script>const [count, setCount] = signal(0);</script><div>{once}{setCount(1)}{endonce}</div>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_ONCE_WRITE));
});

test("conditional modifier without base attribute reports MIX_ERR_CONDITIONAL_WITHOUT_BASE", () => {
  const { errors } = collectAllDiagnostics(
    `<script>const ok = true;</script><a title:if={ok}>Link</a>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_CONDITIONAL_WITHOUT_BASE));
});

test("conflicting :if and :unless on same attribute reports MIX_ERR_CONDITIONAL_CONFLICT", () => {
  const { errors } = collectAllDiagnostics(
    `<script>const ok = true; const deny = false;</script><a href="/home" href:if={ok} href:unless={deny}>Link</a>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_CONDITIONAL_CONFLICT));
});

test("standalone :else modifier reports MIX_ERR_CONDITIONAL_ELSE_ALONE", () => {
  const { errors } = collectAllDiagnostics(
    `<a href:else="/fallback">Link</a>`
  );
  assert.ok(errors.some((diag) => diag.code === DiagnosticCodes.MIX_ERR_CONDITIONAL_ELSE_ALONE));
});

test("conditional click without disabled or aria-disabled emits MIX_WARN_INERT_INTERACTIVE", () => {
  const { warnings } = collectAllDiagnostics(
    `<script>const ready = true; function save() {}</script><button on:click={save} on:click:if={ready}>Save</button>`
  );
  assert.ok(warnings.some((diag) => diag.code === DiagnosticCodes.MIX_WARN_INERT_INTERACTIVE));
});

test("runtime-gated diagnostic codes define severity, message, and hint metadata", () => {
  for (const code of [
    DiagnosticCodes.MIX_ERR_DIRECTIVE_NOT_COMPILED,
    DiagnosticCodes.MIX_ERR_AUTH_PROVIDER_MISSING,
    DiagnosticCodes.MIX_ERR_AUTH_ROLE_UNSUPPORTED
  ]) {
    const meta = getDiagnosticMetadata(code);
    assert.ok(meta);
    assert.equal(meta.severity, "error");
    assert.ok(meta.message.length > 0);
    assert.ok(meta.hint.length > 0);
  }
});
