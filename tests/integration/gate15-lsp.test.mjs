/**
 * Gate 15 Test Suite — Language Server Protocol (@mix/language-server) & VS Code Extension (D-118)
 *
 * Verifies:
 * 1. getDiagnostics() produces accurate 0-based LSP diagnostics for syntax and type errors
 * 2. doHover() returns rich Markdown tooltips and accurate symbol ranges
 * 3. doComplete() suggests variables in scope, control-flow keywords, and two-way form bindings
 * 4. doDefinition() locates symbol declarations from template references
 * 5. VS Code extension package configuration and TextMate grammar validation
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MixLanguageService,
  offsetToPosition,
  positionToOffset,
  DiagnosticSeverity,
  CompletionItemKind,
} from "../../packages/language-server/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

describe("Gate 15: Language Server Protocol & VS Code Extension (D-118)", () => {
  const service = new MixLanguageService();

  test("1. offsetToPosition and positionToOffset conversions", () => {
    const text = "hello\nworld\nfoo";
    const pos = offsetToPosition(text, 7); // 'o' in 'world'
    assert.strictEqual(pos.line, 1);
    assert.strictEqual(pos.character, 1);

    const backOffset = positionToOffset(text, pos);
    assert.strictEqual(backOffset, 7);
  });

  test("2. getDiagnostics() reports accurate 0-based LSP diagnostics", () => {
    const text = `
<script>
  let known = 1;
</script>
<div>
  <p>{unknownVar}</p>
</div>
`;
    const uri = "file:///app/Test.mix";
    const diags = service.getDiagnostics(uri, text);

    assert.ok(diags.length > 0);
    const diag = diags.find((d) => d.code === "MIX_ERR_UNRESOLVED_IDENTIFIER");
    assert.ok(diag, "Unresolved identifier diagnostic must be emitted");
    assert.strictEqual(diag.severity, DiagnosticSeverity.Error);
    assert.ok(diag.message.includes("unknownVar"));
    assert.strictEqual(diag.range.start.line, 5); // 0-based line 5
  });

  test("3. doHover() provides Markdown documentation and symbol range", () => {
    const text = `
<script>
  const counter = signal(0);
</script>
<button>{counter()}</button>
`;
    const uri = "file:///app/Hover.mix";
    // Find offset of 'counter' in template
    const offset = text.indexOf("counter()");
    const pos = offsetToPosition(text, offset + 2);

    const hover = service.doHover(uri, text, pos);
    assert.ok(hover, "Hover must be returned for reactive signal");
    assert.strictEqual(hover.contents.kind, "markdown");
    assert.ok(hover.contents.value.includes("**counter** (signal)"));
    assert.ok(hover.range);
    assert.strictEqual(hover.range.start.line, 4);
  });

  test("4. doComplete() suggests variables in scope, control keywords, and directives", () => {
    const text = `
<script>
  const count = signal(0);
  const doubled = computed(() => count() * 2);
  function submit() {}
</script>
<div>
  
</div>
`;
    const uri = "file:///app/Complete.mix";
    const pos = { line: 6, character: 2 };
    const items = service.doComplete(uri, text, pos);

    // Check scope bindings
    const countItem = items.find((i) => i.label === "count");
    assert.ok(countItem);
    assert.strictEqual(countItem.kind, CompletionItemKind.Variable);

    const doubledItem = items.find((i) => i.label === "doubled");
    assert.ok(doubledItem);

    const submitItem = items.find((i) => i.label === "submit");
    assert.ok(submitItem);
    assert.strictEqual(submitItem.kind, CompletionItemKind.Function);

    // Check framework keywords & directives
    assert.ok(items.some((i) => i.label === "if" && i.kind === CompletionItemKind.Keyword));
    assert.ok(items.some((i) => i.label === "each" && i.kind === CompletionItemKind.Keyword));
    assert.ok(items.some((i) => i.label === "await" && i.kind === CompletionItemKind.Keyword));
    assert.ok(items.some((i) => i.label === "bind:value"));
  });

  test("5. doDefinition() navigates to symbol declaration", () => {
    const text = `
<script>
  let title = "Hello World";
</script>
<h1>{title}</h1>
`;
    const uri = "file:///app/Def.mix";
    const refOffset = text.indexOf("title}");
    const pos = offsetToPosition(text, refOffset + 2);

    const loc = service.doDefinition(uri, text, pos);
    assert.ok(loc, "Definition must be found");
    assert.strictEqual(loc.uri, uri);
    assert.strictEqual(loc.range.start.line, 2, "Declaration must point to line 2 in script");
  });

  test("6. VS Code extension package configuration and TextMate grammar validation", () => {
    const extPkgPath = path.join(rootDir, "editors/vscode-mix/package.json");
    const grammarPath = path.join(rootDir, "editors/vscode-mix/syntaxes/mix.tmLanguage.json");

    assert.ok(fs.existsSync(extPkgPath), "VS Code package.json must exist");
    assert.ok(fs.existsSync(grammarPath), "TextMate grammar file must exist");

    const pkg = JSON.parse(fs.readFileSync(extPkgPath, "utf-8"));
    const grammar = JSON.parse(fs.readFileSync(grammarPath, "utf-8"));

    // Check extension registration
    const languages = pkg.contributes?.languages || [];
    assert.ok(languages.some((l) => l.id === "mix" && l.extensions.includes(".mix")));
    assert.ok(languages.some((l) => l.id === "tix" && l.extensions.includes(".tix")));

    // Check grammar rules
    assert.strictEqual(grammar.scopeName, "source.mix");
    assert.ok(grammar.repository["control-flow"]);
    assert.ok(grammar.repository["dynamic-element"]);
    assert.ok(grammar.repository["script-tag"]);
    assert.ok(grammar.repository["style-tag"]);
  });
});

