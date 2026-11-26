import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { DiagnosticCodes } from "../../node_modules/@dotmix/diagnostics/dist/index.js";
import { MixLanguageService } from "../../node_modules/@dotmix/language-server/dist/index.js";

const RUN_TYPE_DEF = `export type Run =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "strong"; readonly value: string }
  | { readonly type: "contact"; readonly field: "whatsapp" | "phone" }
  | { readonly type: "ph"; readonly key: string };`;

function makeFixture(body, { importDirectives = false } = {}) {
  const dirImport = importDirectives
    ? `import { Switch, Case, Default } from "@dotmix/runtime/directives";\n`
    : "";
  return `${dirImport}${RUN_TYPE_DEF}

export default function RunView(props: { run: Run }) {
  return (
    <span class="run">
${body}
    </span>
  );
}
`;
}

const FIXTURE_D1 = makeFixture(`      {switch props.run.typo}
        {case "text"}<b>x</b>
        {case "contact"}<i>y</i>
        {case "ph"}<u>z</u>
      {endswitch}`);

const FIXTURE_D2 = makeFixture(
  `      <Switch on={props.run.typo}>
        <Case is="text"><b>x</b></Case>
        <Case is="contact"><i>y</i></Case>
        <Case is="ph"><u>z</u></Case>
      </Switch>`,
  { importDirectives: true }
);

const FIXTURE_D3 = makeFixture(`      {switch props.run.type}
        {case "text", "strong"}<b>{props.run.field}</b>
        {case "contact"}<i>{props.run.value}</i>
        {default}<u>{props.run.key}</u>
      {endswitch}`);

const FIXTURE_D4 = makeFixture(`      {switch props.run.typo ? props.run.type : props.run.type}
        {case "text"}<b>x</b>
        {case "unknown"}<span>nope</span>
        {case "contact"}<i>y</i>
      {endswitch}`);

function runTixCheck(sourceCode, filename = "RunView.tix") {
  const ast = parse(sourceCode, { filename });
  const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
  const typecheckResult = typecheckTix(descriptor, sourceCode, {
    filename,
    throwOnError: false
  });
  return [...descriptor.diagnostics, ...typecheckResult.diagnostics];
}

function lineColOf(sourceCode, needle, occurrence = 0) {
  let idx = -1;
  let from = 0;
  for (let i = 0; i <= occurrence; i++) {
    idx = sourceCode.indexOf(needle, from);
    assert.notEqual(idx, -1, `Could not find ${JSON.stringify(needle)} in source`);
    from = idx + 1;
  }
  const prefix = sourceCode.slice(0, idx);
  const lines = prefix.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1
  };
}

describe("Gate 42 FIX1: deduplicate identical diagnostics on {switch} subjects", () => {
  it("D1: block {switch} subject error reports exactly 1 diagnostic at exact line:col", () => {
    const diagnostics = runTixCheck(FIXTURE_D1, "SwitchSubjectTypo.tix");
    assert.equal(diagnostics.length, 1, `Expected 1 diagnostic, got ${diagnostics.length}: ${JSON.stringify(diagnostics)}`);
    assert.equal(diagnostics[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    assert.ok(diagnostics[0].message.includes("typo"));

    const loc = lineColOf(FIXTURE_D1, "props.run.typo", 0);
    assert.equal(diagnostics[0].span.start.line, loc.line);
    assert.equal(diagnostics[0].span.start.column, loc.column + "props.run.".length);
  });

  it("D2: component <Switch on=...> subject error reports exactly 1 diagnostic at exact line:col", () => {
    const diagnostics = runTixCheck(FIXTURE_D2, "SwitchComponentTypo.tix");
    assert.equal(diagnostics.length, 1, `Expected 1 diagnostic, got ${diagnostics.length}: ${JSON.stringify(diagnostics)}`);
    assert.equal(diagnostics[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    assert.ok(diagnostics[0].message.includes("typo"));

    const loc = lineColOf(FIXTURE_D2, "props.run.typo", 0);
    assert.equal(diagnostics[0].span.start.line, loc.line);
    assert.equal(diagnostics[0].span.start.column, loc.column + "props.run.".length);
  });

  it("D3 (no over-merge): two different wrong accesses in two different {case} bodies give 2 diagnostics", () => {
    const diagnostics = runTixCheck(FIXTURE_D3, "SwitchTwoBodyErrors.tix");
    assert.equal(diagnostics.length, 2, `Expected 2 diagnostics, got ${diagnostics.length}: ${JSON.stringify(diagnostics)}`);
    assert.equal(diagnostics[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    assert.equal(diagnostics[1].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    assert.ok(diagnostics[0].message.includes("field"));
    assert.ok(diagnostics[1].message.includes("value"));

    const fieldLoc = lineColOf(FIXTURE_D3, "props.run.field", 0);
    assert.equal(diagnostics[0].span.start.line, fieldLoc.line);
    assert.equal(diagnostics[0].span.start.column, fieldLoc.column + "props.run.".length);

    const valueLoc = lineColOf(FIXTURE_D3, "props.run.value", 0);
    assert.equal(diagnostics[1].span.start.line, valueLoc.line);
    assert.equal(diagnostics[1].span.start.column, valueLoc.column + "props.run.".length);
  });

  it("D4 (no over-merge): subject wrong access plus out-of-type case value gives 2 diagnostics at distinct locations", () => {
    const diagnostics = runTixCheck(FIXTURE_D4, "SwitchSubjectAndCaseError.tix");
    assert.equal(diagnostics.length, 2, `Expected 2 diagnostics, got ${diagnostics.length}: ${JSON.stringify(diagnostics)}`);

    const subjectDiag = diagnostics.find((d) => d.message.includes("typo"));
    const caseDiag = diagnostics.find((d) => d.message.includes("unknown"));
    assert.ok(subjectDiag, `Expected subject diagnostic in ${JSON.stringify(diagnostics)}`);
    assert.ok(caseDiag, `Expected out-of-type case diagnostic in ${JSON.stringify(diagnostics)}`);
    assert.equal(subjectDiag.code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    assert.equal(caseDiag.code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    assert.notEqual(subjectDiag.span.start.offset, caseDiag.span.start.offset);

    const typoLoc = lineColOf(FIXTURE_D4, "props.run.typo", 0);
    assert.equal(subjectDiag.span.start.line, typoLoc.line);
    assert.equal(subjectDiag.span.start.column, typoLoc.column + "props.run.".length);

    const caseLoc = lineColOf(FIXTURE_D4, '"unknown"', 0);
    assert.equal(caseDiag.span.start.line, caseLoc.line);
    assert.equal(caseDiag.span.start.column, caseLoc.column);
  });

  it("D5: MixLanguageService.getDiagnostics returns exactly 1 diagnostic for D1", () => {
    const lsp = new MixLanguageService();
    const uri = pathToFileURL(path.resolve("Gate42Fix1D1.tix")).href;
    const diags = lsp.getDiagnostics(uri, FIXTURE_D1);
    assert.equal(diags.length, 1, `Expected 1 LSP diagnostic, got ${diags.length}: ${JSON.stringify(diags)}`);
    assert.equal(diags[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    assert.ok(diags[0].message.includes("typo"));

    const loc = lineColOf(FIXTURE_D1, "props.run.typo", 0);
    assert.equal(diags[0].range.start.line, loc.line - 1);
    assert.equal(diags[0].range.start.character, loc.column - 1 + "props.run.".length);
  });
});
