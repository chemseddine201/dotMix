import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import {
  analyze,
  projectTypeScript,
  typecheckTix,
  rewriteModuleImportExtensions
} from "../../packages/compiler-semantic/dist/index.js";
import { MixDiagnosticError, DiagnosticCodes } from "../../packages/diagnostics/dist/index.js";

test("Gate 3: Semantic scope resolution, binding classification, and loop variable scoping", () => {
  const source = `<script lang="ts">
  import Header from "./Header.tix";
  const props = defineProps<{ title: string }>();
  const count = signal(0);
  const doubled = computed(() => count() * 2);
  const inputRef = createRef<HTMLInputElement>(null);
  function increment(step: number) {
    count.set(c => c + step);
  }
  const items = signal([{ id: "a", label: "First" }]);
</script>

<div>
  <Header title={props.title} />
  <input ref={inputRef} />
  <button @click={(e) => increment(1)}>{doubled()}</button>
  <ul>
    {#each items() as item, idx (item.id)}
      <li>{idx}: {item.label}</li>
    {/each}
  </ul>
</div>`;

  const ast = parse(source, { filename: "Counter.tix" });
  const desc = analyze(ast, { filename: "Counter.tix", source });

  assert.deepStrictEqual(desc.signals, ["count", "items"]);
  assert.deepStrictEqual(desc.computeds, ["doubled"]);
  assert.deepStrictEqual(desc.props, ["props"]);
  assert.deepStrictEqual(desc.refs, ["inputRef"]);
  assert.deepStrictEqual(desc.functions, ["increment"]);
  assert.strictEqual(desc.imports.get("Header"), "./Header.tix");
  assert.strictEqual(desc.diagnostics.length, 0);
});

test("Gate 3: Unresolved identifier in template or component call throws MixDiagnosticError with exact SourceSpan", () => {
  const source = `<script>
  const known = signal(1);
</script>
<div>
  <span>{known()}</span>
  <p>{unknownVariable + 1}</p>
</div>`;

  const ast = parse(source, { filename: "BadRef.mix" });
  assert.throws(
    () => analyze(ast, { filename: "BadRef.mix", source }),
    err => {
      assert.ok(err instanceof MixDiagnosticError);
      assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_UNRESOLVED_IDENTIFIER);
      assert.match(err.message, /unknownVariable/);
      assert.strictEqual(err.diagnostic.span.start.line, 6);
      assert.strictEqual(err.diagnostic.span.start.column, 7);
      return true;
    }
  );

  // Unimported component call <MissingComp />
  const compSource = `<div><MissingComp /></div>`;
  const compAst = parse(compSource, { filename: "BadComp.mix" });
  assert.throws(
    () => analyze(compAst, { filename: "BadComp.mix", source: compSource }),
    err => {
      assert.ok(err instanceof MixDiagnosticError);
      assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_UNRESOLVED_IDENTIFIER);
      assert.match(err.message, /MissingComp/);
      return true;
    }
  );
});

test("Gate 3 (R-SP-01..05): SourceMapSpanTable covers 100% of projected .tix.ts bytes without gaps or overlaps", () => {
  const source = `<script lang="ts">
  const count = signal(0);
  const myInput = createRef<HTMLInputElement>(null);
</script>
<section>
  <input ref={myInput} />
  <span>{count()}</span>
</section>`;

  const ast = parse(source, { filename: "Coverage.tix" });
  const projection = projectTypeScript(ast, source, "Coverage.tix");

  assert.ok(projection.code.length > 0);
  assert.ok(projection.spanTable.length > 0);

  let expectedCursor = 0;
  for (const entry of projection.spanTable) {
    assert.strictEqual(
      entry.genStart,
      expectedCursor,
      `Gap or overlap in SourceMapSpanTable at offset ${expectedCursor}`
    );
    assert.ok(entry.genEnd > entry.genStart, "SpanEntry must be non-empty");
    if (entry.kind === "verbatim") {
      assert.strictEqual(
        entry.genEnd - entry.genStart,
        entry.srcEnd - entry.srcStart,
        "Verbatim SpanEntry must have identical generated and source lengths (R-SP-01)"
      );
      assert.strictEqual(
        projection.code.slice(entry.genStart, entry.genEnd),
        source.slice(entry.srcStart, entry.srcEnd),
        "Verbatim SpanEntry text must match original source slice character-for-character"
      );
    }
    expectedCursor = entry.genEnd;
  }
  assert.strictEqual(
    expectedCursor,
    projection.code.length,
    "SourceMapSpanTable must cover 100% of projected .tix.ts bytes (R-SP-05)"
  );
});

test("Gate 3 (D-106, R-TC-01..03, R-RS-01..03): TypeScript 6.0.3 Compiler API verifies .tix props (NoInfer excess props), refs, and import extensions", () => {
  const buttonModuleDts = `
export interface ButtonProps {
  label: string;
  count: number;
}
export declare function Button(props: ButtonProps): unknown;
export default Button;
`;

  // 1. Valid .tix component passes TypeScript 6.0.3 verification with 0 diagnostics
  const validTix = `<script lang="ts">
  import Button from "./Button.tix";
  const count = signal(5);
  const inputEl = createRef<HTMLInputElement>(null);
</script>
<div>
  <input ref={inputEl} />
  <Button label="Click me" count={count()} />
</div>`;

  const validAst = parse(validTix, { filename: "ValidApp.tix" });
  const validCheck = typecheckTix(validAst, validTix, {
    filename: "ValidApp.tix",
    virtualFiles: { "./Button.tix": buttonModuleDts }
  });
  assert.deepStrictEqual(validCheck.diagnostics, []);

  // 2. Misspelled / excess prop (`lable` instead of `label`) is caught thanks to NoInfer<P> (R-TC-03)
  // and mapped back to the exact template line!
  const misspelledPropTix = `<script lang="ts">
  import Button from "./Button.tix";
</script>
<div>
  <Button label="ok" count={1} lable="typo" />
</div>`;

  const typoAst = parse(misspelledPropTix, { filename: "TypoApp.tix" });
  const typoCheck = typecheckTix(typoAst, misspelledPropTix, {
    filename: "TypoApp.tix",
    virtualFiles: { "./Button.tix": buttonModuleDts }
  });
  assert.ok(typoCheck.diagnostics.length > 0, "Expected excess property diagnostic for 'lable'");
  const typoDiag = typoCheck.diagnostics[0];
  assert.strictEqual(typoDiag.code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
  assert.strictEqual(typoDiag.span.start.line, 5, "Diagnostic must map to line 5 where <Button ... lable='typo' /> is located");

  // 3. Incompatible ref element type (`RefTarget<HTMLInputElement>` bound to `<div>`) is caught via VerifyRef + NoInfer (R-TC-01)
  const badRefTix = `<script lang="ts">
  const inputEl = createRef<HTMLInputElement>(null);
</script>
<div ref={inputEl}>Not an input</div>`;

  const badRefAst = parse(badRefTix, { filename: "BadRef.tix" });
  const badRefCheck = typecheckTix(badRefAst, badRefTix, { filename: "BadRef.tix" });
  assert.ok(badRefCheck.diagnostics.length > 0, "Expected VerifyRef mismatch diagnostic");
  assert.strictEqual(badRefCheck.diagnostics[0].span.start.line, 4);

  // 4. Relative import without extension is rejected (R-RS-01) and .tix -> .tix.js rewriting works (R-RS-03)
  const noExtTix = `<script lang="ts">
  import Button from "./Button";
</script>
<div><Button /></div>`;
  const noExtAst = parse(noExtTix, { filename: "NoExt.tix" });
  assert.throws(
    () => analyze(noExtAst, { filename: "NoExt.tix", source: noExtTix }),
    err => {
      assert.ok(err instanceof MixDiagnosticError);
      assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
      assert.match(err.message, /missing an explicit file extension/);
      return true;
    }
  );

  const rewritten = rewriteModuleImportExtensions(`import Button from "./Button.tix";\nimport Card from "./Card.mix";`);
  assert.strictEqual(
    rewritten,
    `import Button from "./Button.tix.js";\nimport Card from "./Card.mix.js";`
  );
});
