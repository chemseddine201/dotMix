/**
 * Gate 23 Test Suite — Scope-Aware Signal Auto-Invocation in SSR (@mix/compiler-ssr — D-126)
 *
 * Verifies:
 * 1. Bare signal identifiers in interpolations ({count}) are auto-invoked to their current value
 * 2. Bare computed identifiers ({doubled}) are auto-invoked in SSR
 * 3. Dynamic attributes with bare signals (class={theme}, data-val={count}) resolve to string values
 * 4. Conditional control flow ({#if isReady}) accurately branches based on the signal's boolean value
 * 5. Iteration control flow ({#each items as item (item.id)}) properly unwraps iterable signals
 * 6. Explicit function calls ({count()}) are not double-invoked (no count()())
 * 7. Expressions with operators ({count + 10}) transform bare signals correctly
 * 8. Inner parameters and loop variables shadow outer signals without accidental auto-invocation
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parse, parseExpressionSlice, LineMap } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { compileToSsr, transformSsrExpression } from "../../packages/compiler-ssr/dist/index.js";
import { signal, computed } from "../../packages/runtime/dist/index.js";

function evalSsr(code) {
  // Transform ES exports to CommonJS-style exports object
  const transformed = code
    .replace(/import\s*\{\s*([^}]+)\s*\}\s*from\s*["'][^"']+["'];?/g, "")
    .replace(/export function (\w+)/g, "exports.$1 = function $1")
    .replace(/export const (\w+)\s*=/g, "exports.$1 =");

  const fn = new Function("exports", "signal", "computed", transformed);
  const exports = {};
  fn(exports, signal, computed);
  return exports;
}

function parseExpr(code) {
  const lineMap = new LineMap(code);
  return parseExpressionSlice(code, 0, lineMap);
}

describe("Gate 23: Scope-Aware Signal Auto-Invocation in SSR (D-126)", () => {
  test("1. transformSsrExpression transforms bare signals and preserves explicit calls & member props", () => {
    const signals = new Set(["count", "isReady", "items", "user", "theme"]);

    const t1 = transformSsrExpression("count", parseExpr("count"), signals);
    assert.equal(t1, "count()");

    const t2 = transformSsrExpression("count()", parseExpr("count()"), signals);
    // Explicit call must not become count()()
    assert.equal(t2, "count()");

    const t3 = transformSsrExpression("count + 1", parseExpr("count + 1"), signals);
    assert.equal(t3, "count() + 1");

    const t4 = transformSsrExpression("isReady ? 'ready' : 'pending'", parseExpr("isReady ? 'ready' : 'pending'"), signals);
    assert.equal(t4, "isReady() ? 'ready' : 'pending'");

    const t5a = transformSsrExpression("person.count", parseExpr("person.count"), signals);
    assert.equal(t5a, "person.count");

    const t5b = transformSsrExpression("user.name", parseExpr("user.name"), signals);
    assert.equal(t5b, "user().name");

    const t6 = transformSsrExpression("items.length > 0", parseExpr("items.length > 0"), signals);
    assert.equal(t6, "items().length > 0");

    const t7 = transformSsrExpression("count", parseExpr("count"), signals, new Set(["count"]));
    // Shadowed signal identifier must remain uninvoked
    assert.equal(t7, "count");
  });

  test("2. SSR renders bare signals and computeds in text interpolations and dynamic attributes", () => {
    const source = `
<script>
  import { signal, computed } from "@mix/runtime";

  const count = signal(42);
  const theme = signal("dark-mode");
  const doubled = computed(() => count() * 2);
</script>

<div class={theme} data-count={count}>
  <span class="value">{count}</span>
  <span class="doubled">{doubled}</span>
  <span class="explicit">{count()}</span>
  <span class="math">{count + 8}</span>
</div>
`;

    const ast = parse(source, { filename: "Counter.mix" });
    const descriptor = analyze(ast, { filename: "Counter.mix", source });
    const ssr = compileToSsr(descriptor);

    const mod = evalSsr(ssr.code);
    const html = mod.renderToString();

    assert.ok(html.includes('class="dark-mode"'), `Expected class="dark-mode" in: ${html}`);
    assert.ok(html.includes('data-count="42"'), `Expected data-count="42" in: ${html}`);
    assert.ok(html.includes('<span class="value"><!--mix:t:0-->42<!--/mix:t:0--></span>'), `Expected value 42 in: ${html}`);
    assert.ok(html.includes('<span class="doubled"><!--mix:t:1-->84<!--/mix:t:1--></span>'), `Expected doubled 84 in: ${html}`);
    assert.ok(html.includes('<span class="explicit"><!--mix:t:2-->42<!--/mix:t:2--></span>'), `Expected explicit 42 in: ${html}`);
    assert.ok(html.includes('<span class="math"><!--mix:t:3-->50<!--/mix:t:3--></span>'), `Expected math 50 in: ${html}`);
  });

  test("3. SSR evaluates bare signals in {#if} conditionals accurately", () => {
    const source = `
<script>
  import { signal } from "@mix/runtime";

  const isVisible = signal(false);
  const isEnabled = signal(true);
</script>

<div>
  {#if isVisible}
    <p class="visible">Visible</p>
  {:else}
    <p class="hidden">Hidden</p>
  {/if}

  {#if isEnabled}
    <span class="enabled">Enabled</span>
  {/if}
</div>
`;

    const ast = parse(source, { filename: "Conditional.mix" });
    const descriptor = analyze(ast, { filename: "Conditional.mix", source });
    const ssr = compileToSsr(descriptor);

    const mod = evalSsr(ssr.code);
    const html = mod.renderToString();

    // isVisible is false, so it should render "Hidden", not "Visible"
    assert.ok(html.includes('<p class="hidden">Hidden</p>'), `Expected Hidden branch in: ${html}`);
    assert.ok(!html.includes('<p class="visible">Visible</p>'), `Should not contain Visible branch in: ${html}`);
    assert.ok(html.includes('<span class="enabled">Enabled</span>'), `Expected Enabled branch in: ${html}`);
  });

  test("4. SSR iterates over bare collection signals in {#each} blocks with proper key evaluation", () => {
    const source = `
<script>
  import { signal } from "@mix/runtime";

  const items = signal([
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" }
  ]);
</script>

<ul class="list">
  {#each items as item (item.id)}
    <li data-key={item.id}>{item.label}</li>
  {/each}
</ul>
`;

    const ast = parse(source, { filename: "List.mix" });
    const descriptor = analyze(ast, { filename: "List.mix", source });
    const ssr = compileToSsr(descriptor);

    const mod = evalSsr(ssr.code);
    const html = mod.renderToString();

    assert.ok(html.includes('<li data-key="a"><!--mix:t:1-->Alpha<!--/mix:t:1--></li>'), `Expected Alpha in: ${html}`);
    assert.ok(html.includes('<li data-key="b"><!--mix:t:1-->Beta<!--/mix:t:1--></li>'), `Expected Beta in: ${html}`);
    assert.ok(html.includes('<li data-key="c"><!--mix:t:1-->Gamma<!--/mix:t:1--></li>'), `Expected Gamma in: ${html}`);
  });

  test("5. SSR handles function signals passed at runtime via props safely", () => {
    const source = `
<script>
  import { defineProps } from "@mix/runtime";

  const props = defineProps();
</script>

<div class="card">
  <h2 class={props.badgeClass}>{props.title}</h2>
  <span>{props.counter}</span>
</div>
`;

    const ast = parse(source, { filename: "PropCard.mix" });
    const descriptor = analyze(ast, { filename: "PropCard.mix", source });
    const ssr = compileToSsr(descriptor);

    const mod = evalSsr(ssr.code);
    const countSignal = signal(99);
    const badgeSignal = signal("badge-active");

    const html = mod.renderToString({
      title: "Signal Card",
      badgeClass: badgeSignal,
      counter: countSignal
    });

    assert.ok(html.includes('class="badge-active"'), `Expected badge-active class from signal prop in: ${html}`);
    assert.ok(html.includes('<span><!--mix:t:1-->99<!--/mix:t:1--></span>'), `Expected 99 from signal prop in: ${html}`);
  });
});
