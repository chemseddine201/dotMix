import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import { compileToSsr } from "../../packages/compiler-ssr/dist/index.js";
import { MixLanguageService } from "../../packages/language-server/dist/index.js";
import { DiagnosticCodes, MixDiagnosticError } from "../../packages/diagnostics/dist/index.js";
import * as MixRuntime from "../../packages/runtime/dist/index.js";

function setupDom() {
  const win = new Window({ url: "http://localhost/" });
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.HTMLElement = win.HTMLElement;
  globalThis.SVGElement = win.SVGElement;
  globalThis.Element = win.Element;
  globalThis.Node = win.Node;
  globalThis.Text = win.Text;
  globalThis.Comment = win.Comment;
  globalThis.DocumentFragment = win.DocumentFragment;
  globalThis.Event = win.Event;
  globalThis.CustomEvent = win.CustomEvent;
  return win;
}

describe("Gate 28 (T-28.4 — D-132 & D-133 Option b): Element Expressions in Attributes & Control-Flow Diagnostics", () => {
  it("1. Parses element and fragment expressions inside attribute {...} values with exact SourceSpans and semantic scope verification", () => {
    const src = `<script lang="ts">
  import { signal } from "@mix/runtime";
  import { Can } from "@mix/runtime/permissions";
  const reason = signal("Locked");
</script>
<div class="box">
  <Can I="update" a="Doc" fallback={<span class="denied">Denied: {reason()}</span>}>
    <button class="allow">Edit</button>
  </Can>
</div>`;

    const ast = parse(src, { filename: "AttrElement.tix" });
    const divNode = ast.template[0];
    assert.strictEqual(divNode.type, "Element");
    const canNode = divNode.children.find((n) => n.type === "ComponentCall");
    assert.ok(canNode, "Expected <Can> ComponentCallNode");

    const fallbackAttr = canNode.attributes.find((a) => a.name === "fallback");
    assert.ok(fallbackAttr, "Expected fallback attribute on <Can>");
    assert.strictEqual(fallbackAttr.type, "DynamicAttribute");
    assert.ok(
      Array.isArray(fallbackAttr.templateValue) && fallbackAttr.templateValue.length === 1,
      "Expected fallback attribute to contain parsed templateValue subtree"
    );
    const spanEl = fallbackAttr.templateValue[0];
    assert.strictEqual(spanEl.type, "Element");
    assert.strictEqual(spanEl.tag, "span");
    assert.strictEqual(spanEl.span.start.line, 7);

    const desc = analyze(ast, { filename: "AttrElement.tix", source: src });
    assert.strictEqual(desc.diagnostics.length, 0);

    // Unresolved identifier inside attribute element expression must be caught by analyze()
    const badSrc = `<script>
  import { Can } from "@mix/runtime/permissions";
</script>
<Can I="update" a="Doc" fallback={<span>{missingSignal()}</span>}>
  <button>Edit</button>
</Can>`;
    const badAst = parse(badSrc, { filename: "BadAttrElement.mix" });
    assert.throws(
      () => analyze(badAst, { filename: "BadAttrElement.mix", source: badSrc }),
      (err) => {
        assert.ok(err instanceof MixDiagnosticError);
        assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_UNRESOLVED_IDENTIFIER);
        assert.match(err.message, /missingSignal/);
        return true;
      }
    );
  });

  it("2. Typechecks .tix components with element expressions in attributes via typecheckTix", () => {
    const src = `<script lang="ts">
  import { signal } from "@mix/runtime";
  import { Can } from "@mix/runtime/permissions";
  const label = signal("Read Only");
</script>
<Can I="update" a="Post" fallback={<span class="badge">{label()}</span>}>
  <button>Edit</button>
</Can>`;

    const ast = parse(src, { filename: "TypecheckAttr.tix" });
    const desc = analyze(ast, { filename: "TypecheckAttr.tix", source: src });
    const tc = typecheckTix(desc, src, { filename: "TypecheckAttr.tix", throwOnError: false });
    assert.strictEqual(
      tc.diagnostics.length,
      0,
      `Expected 0 typecheck diagnostics, got: ${JSON.stringify(tc.diagnostics)}`
    );
  });

  it("3. Compiles attribute element expression to a lazily-mounted render function in CSR DOM and SSR renderToString", () => {
    const win = setupDom();
    try {
      const canEdit = MixRuntime.signal(false);
      const badgeText = MixRuntime.signal("Guest Mode");

      const src = `<script>
  import { computed, defineProps } from "@mix/runtime";
  import { defineAbility, PermissionProvider, Can } from "@mix/runtime/permissions";

  const props = defineProps();
  const ability = computed(() =>
    defineAbility((can, cannot) => {
      if (props.canEdit()) {
        can("update", "Article");
      } else {
        cannot("update", "Article");
      }
    })
  );
</script>
<PermissionProvider ability={ability}>
  <div class="host">
    <Can I="update" a="Article" fallback={<span class="badge-guest">{props.badgeText()}</span>}>
      <button class="btn-edit">Edit Article</button>
    </Can>
  </div>
</PermissionProvider>`;

      const ast = parse(src, { filename: "CsrAttrElement.mix" });
      const desc = analyze(ast, { filename: "CsrAttrElement.mix", source: src });
      const gen = generate(desc, { filename: "CsrAttrElement.mix" });

      // Execute generated CSR component in happy-dom
      let execCode = gen.code
        .replace(/import\s+\{([^}]+)\}\s+from\s+["']@mix\/runtime["'];?/g, (_, list) => {
          const bindings = list
            .split(",")
            .map((s) => s.trim().replace(/\s+as\s+/g, ": "))
            .join(", ");
          return `const { ${bindings} } = __MixRuntime;`;
        })
        .replace(/import\s+\{([^}]+)\}\s+from\s+["']@mix\/runtime\/permissions["'];?/g, (_, list) => {
          const bindings = list
            .split(",")
            .map((s) => s.trim().replace(/\s+as\s+/g, ": "))
            .join(", ");
          return `const { ${bindings} } = __MixRuntime;`;
        })
        .replace(/export\s+default\s+[A-Za-z0-9_$]+;?/g, "")
        .replace(/export\s+function\s+([A-Za-z0-9_$]+)/g, "function $1");

      const factory = new Function(
        "__MixRuntime",
        `${execCode}\nreturn { CsrAttrElement };`
      );
      const { CsrAttrElement } = factory(MixRuntime);

      const container = document.createElement("div");
      document.body.appendChild(container);

      let disposeRoot;
      MixRuntime.createRoot((dispose) => {
        disposeRoot = dispose;
        const nodes = CsrAttrElement({ canEdit, badgeText });
        for (const n of Array.isArray(nodes) ? nodes : [nodes]) {
          container.appendChild(n);
        }
      });

      // Initially canEdit() is false -> fallback <span class="badge-guest">Guest Mode</span> is mounted
      assert.strictEqual(container.querySelector(".btn-edit") === null, true);
      const guestSpan = container.querySelector(".badge-guest");
      assert.strictEqual(guestSpan !== null, true);
      assert.strictEqual(guestSpan.textContent, "Guest Mode");

      // Reactive signal inside fallback attribute element updates in place
      badgeText.set("Read-Only Viewer");
      assert.strictEqual(container.querySelector(".badge-guest").textContent, "Read-Only Viewer");

      // Flip canEdit -> true: swaps to <button class="btn-edit">
      canEdit.set(true);
      assert.strictEqual(container.querySelector(".badge-guest") === null, true);
      assert.strictEqual(container.querySelector(".btn-edit") !== null, true);
      assert.strictEqual(container.querySelector(".btn-edit").textContent, "Edit Article");

      disposeRoot();

      // Also verify SSR compileToSsr parity
      canEdit.set(false);
      badgeText.set("Guest Mode");
      const ssr = compileToSsr(desc, undefined, { includeHydrationMarkers: false });
      const ssrExec = ssr.code
        .replace(/import\s+\{([^}]+)\}\s+from\s+["']@mix\/runtime["'];?/g, (_, list) => {
          const bindings = list
            .split(",")
            .map((s) => s.trim().replace(/\s+as\s+/g, ": "))
            .join(", ");
          return `const { ${bindings} } = __MixRuntime;`;
        })
        .replace(/import\s+\{([^}]+)\}\s+from\s+["']@mix\/runtime\/permissions["'];?/g, (_, list) => {
          const bindings = list
            .split(",")
            .map((s) => s.trim().replace(/\s+as\s+/g, ": "))
            .join(", ");
          return `const { ${bindings} } = __MixRuntime;`;
        })
        .replace(/export\s+function\s+renderToString/g, "function renderToString")
        .replace(/export\s+function\s+renderToStream/g, "function renderToStream")
        .replace(/export\s+const\s+css/g, "const css");

      const ssrFactory = new Function("__MixRuntime", `${ssrExec}\nreturn { renderToString };`);
      const { renderToString } = ssrFactory(MixRuntime);
      const html = renderToString({ canEdit, badgeText });
      assert.ok(
        html.includes('<span class="badge-guest">Guest Mode</span>'),
        `Expected SSR HTML to contain fallback element, got: ${html}`
      );
    } finally {
      win.close();
    }
  });

  it("4. D-133 (Option b): Diagnoses {cond && <el/>} with MIX_ERR_JSX_LOGICAL_EXPRESSION and warns on legacy {#if}/{#each}", () => {
    const jsxLogicalSrc = `<script>
  const show = true;
</script>
<div>
  {show && <span class="hi">Hello</span>}
</div>`;

    assert.throws(
      () => parse(jsxLogicalSrc, { filename: "JsxLogical.mix" }),
      (err) => {
        assert.ok(err instanceof MixDiagnosticError);
        assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_JSX_LOGICAL_EXPRESSION);
        assert.ok(
          err.message.includes("{if"),
          `Expected hint to use {if ...}{endif}, got: ${err.message}`
        );
        return true;
      }
    );

    const legacySrc = `<script>
  import { signal } from "@mix/runtime";
  const show = signal(true);
  const items = signal([{ id: 1, name: "A" }]);
</script>
<div>
  {#if show()}
    <ul>
      {#each items() as item (item.id)}
        <li>{item.name}</li>
      {/each}
    </ul>
  {/if}
</div>`;

    const lsp = new MixLanguageService();
    const diags = lsp.getDiagnostics("file:///app/Legacy.mix", legacySrc);
    const legacyWarnings = diags.filter((d) => d.code === DiagnosticCodes.MIX_WARN_LEGACY_CONTROL_FLOW);
    assert.strictEqual(
      legacyWarnings.length >= 2,
      true,
      `Expected MIX_WARN_LEGACY_CONTROL_FLOW warnings for {#if} and {#each}, got: ${JSON.stringify(diags)}`
    );
  });
});
