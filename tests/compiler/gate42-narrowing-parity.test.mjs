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
    ? `import { If, ElseIf, Else, Switch, Case, Default } from "@dotmix/runtime/directives";\n`
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

const FIXTURE_A = makeFixture(`      {if props.run.type === "text" || props.run.type === "strong"}<b>{props.run.value}</b>{endif}
      {if props.run.type === "contact"}<i>{props.run.field}</i>{endif}
      {if props.run.type === "ph"}<u>{props.run.key}</u>{endif}`);

const FIXTURE_B = makeFixture(`      {if props.run.type === "text"}<b>{props.run.value}</b>
      {elseif props.run.type === "strong"}<b>{props.run.value}</b>
      {elseif props.run.type === "contact"}<i>{props.run.field}</i>
      {else}<u>{props.run.key}</u>
      {endif}`);

const FIXTURE_C = makeFixture(`      {switch props.run.type}
        {case "text", "strong"}<b>{props.run.value}</b>
        {case "contact"}<i>{props.run.field}</i>
        {default}<u>{props.run.key}</u>
      {endswitch}`);

const FIXTURE_D = makeFixture(`      {switch}
        {case if props.run.type === "text" || props.run.type === "strong"}<b>{props.run.value}</b>
        {case if props.run.type === "contact"}<i>{props.run.field}</i>
        {default}<u>{props.run.key}</u>
      {endswitch}`);

const FIXTURE_E = makeFixture(
  `      <If condition={props.run.type === "text"}><b>{props.run.value}</b>
        <ElseIf condition={props.run.type === "strong"}><b>{props.run.value}</b></ElseIf>
        <ElseIf condition={props.run.type === "contact"}><i>{props.run.field}</i></ElseIf>
        <Else><u>{props.run.key}</u></Else>
      </If>`,
  { importDirectives: true }
);

const FIXTURE_F = makeFixture(
  `      <Switch on={props.run.type}>
        <Case is={["text", "strong"]}><b>{props.run.value}</b></Case>
        <Case is="contact"><i>{props.run.field}</i></Case>
        <Default><u>{props.run.key}</u></Default>
      </Switch>`,
  { importDirectives: true }
);

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

describe("Gate 42 T1: type narrowing parity across all six branching forms", () => {
  const cases = [
    ["(a) separate {if} blocks", FIXTURE_A],
    ["(b) {if} / {elseif} / {elseif} / {else}", FIXTURE_B],
    ["(c) {switch} with multi-value, single-value, and {default}", FIXTURE_C],
    ["(d) subject-less {switch} with {case if} and {default}", FIXTURE_D],
    ["(e) <If> / <ElseIf> / <Else> component mode", FIXTURE_E],
    ["(f) <Switch> / <Case> / <Default> component mode", FIXTURE_F]
  ];

  for (const [label, src] of cases) {
    it(`${label} produces 0 diagnostics`, () => {
      const diagnostics = runTixCheck(src, "RunView.tix");
      assert.deepEqual(diagnostics, []);
    });
  }

  it("handles {if}/{elseif} without {else} and mixed {case}/{case if} narrowing", () => {
    const srcNoElse = makeFixture(`      {if props.run.type === "text"}<b>{props.run.value}</b>
      {elseif props.run.type === "contact"}<i>{props.run.field}</i>
      {endif}`);
    assert.deepEqual(runTixCheck(srcNoElse, "NoElse.tix"), []);

    const srcMixedSwitch = makeFixture(`      {switch props.run.type}
        {case "text", "strong"}<b>{props.run.value}</b>
        {case if props.run.type === "contact"}<i>{props.run.field}</i>
        {default}<u>{props.run.key}</u>
      {endswitch}`);
    assert.deepEqual(runTixCheck(srcMixedSwitch, "MixedSwitch.tix"), []);
  });
});

describe("Gate 42 T2: negative narrowing diagnostics at exact line:col", () => {
  const negativeCases = [
    [
      "(b) wrong access inside {elseif} branch",
      makeFixture(`      {if props.run.type === "text"}<b>{props.run.value}</b>
      {elseif props.run.type === "strong"}<b>{props.run.value}</b>
      {elseif props.run.type === "contact"}<i>{props.run.value}</i>
      {else}<u>{props.run.key}</u>
      {endif}`),
      { needle: "props.run.value", occurrence: 2, propOffset: "props.run.".length }
    ],
    [
      "(c) wrong access inside {case} branch",
      makeFixture(`      {switch props.run.type}
        {case "text", "strong"}<b>{props.run.value}</b>
        {case "contact"}<i>{props.run.value}</i>
        {default}<u>{props.run.key}</u>
      {endswitch}`),
      { needle: "props.run.value", occurrence: 1, propOffset: "props.run.".length }
    ],
    [
      "(d) wrong access inside {case if} branch",
      makeFixture(`      {switch}
        {case if props.run.type === "text" || props.run.type === "strong"}<b>{props.run.value}</b>
        {case if props.run.type === "contact"}<i>{props.run.value}</i>
        {default}<u>{props.run.key}</u>
      {endswitch}`),
      { needle: "props.run.value", occurrence: 1, propOffset: "props.run.".length }
    ],
    [
      "(e) wrong access inside <ElseIf> component branch",
      makeFixture(
        `      <If condition={props.run.type === "text"}><b>{props.run.value}</b>
        <ElseIf condition={props.run.type === "strong"}><b>{props.run.value}</b></ElseIf>
        <ElseIf condition={props.run.type === "contact"}><i>{props.run.value}</i></ElseIf>
        <Else><u>{props.run.key}</u></Else>
      </If>`,
        { importDirectives: true }
      ),
      { needle: "props.run.value", occurrence: 2, propOffset: "props.run.".length }
    ],
    [
      "(f) wrong access inside <Case> component branch",
      makeFixture(
        `      <Switch on={props.run.type}>
        <Case is={["text", "strong"]}><b>{props.run.value}</b></Case>
        <Case is="contact"><i>{props.run.value}</i></Case>
        <Default><u>{props.run.key}</u></Default>
      </Switch>`,
        { importDirectives: true }
      ),
      { needle: "props.run.value", occurrence: 1, propOffset: "props.run.".length }
    ]
  ];

  for (const [label, src, target] of negativeCases) {
    it(`${label} reports exactly 1 diagnostic at exact line:col`, () => {
      const diagnostics = runTixCheck(src, "NegativeView.tix");
      assert.equal(diagnostics.length, 1, `Expected 1 diagnostic, got ${JSON.stringify(diagnostics)}`);
      assert.equal(diagnostics[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
      assert.ok(diagnostics[0].message.includes("value"));

      const expectedExprLoc = lineColOf(src, target.needle, target.occurrence);
      const expectedLine = expectedExprLoc.line;
      const expectedCol = expectedExprLoc.column + target.propOffset;
      assert.equal(diagnostics[0].span.start.line, expectedLine);
      assert.equal(diagnostics[0].span.start.column, expectedCol);
    });
  }

  it("reports exact line:col inside {else} and {default} branches when narrowed", () => {
    const srcElse = makeFixture(`      {if props.run.type === "text" || props.run.type === "strong"}<b>{props.run.value}</b>
      {elseif props.run.type === "contact"}<i>{props.run.field}</i>
      {else}<u>{props.run.field}</u>
      {endif}`);
    const dElse = runTixCheck(srcElse, "NegElse.tix");
    assert.equal(dElse.length, 1);
    assert.equal(dElse[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    const elseLoc = lineColOf(srcElse, "props.run.field", 1);
    assert.equal(dElse[0].span.start.line, elseLoc.line);
    assert.equal(dElse[0].span.start.column, elseLoc.column + "props.run.".length);

    const srcDefault = makeFixture(`      {switch props.run.type}
        {case "text", "strong"}<b>{props.run.value}</b>
        {case "contact"}<i>{props.run.field}</i>
        {default}<u>{props.run.field}</u>
      {endswitch}`);
    const dDef = runTixCheck(srcDefault, "NegDefault.tix");
    assert.equal(dDef.length, 1);
    assert.equal(dDef[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    const defLoc = lineColOf(srcDefault, "props.run.field", 1);
    assert.equal(dDef[0].span.start.line, defLoc.line);
    assert.equal(dDef[0].span.start.column, defLoc.column + "props.run.".length);
  });

  it("typechecks switch subject even when switch has only {default} or only {case if}", () => {
    const srcOnlyDefault = makeFixture(`      {switch props.run.missingProp}
        {default}<u>{props.run.type}</u>
      {endswitch}`);
    const d1 = runTixCheck(srcOnlyDefault, "OnlyDefault.tix");
    assert.equal(d1.length, 1);
    assert.equal(d1[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    const loc1 = lineColOf(srcOnlyDefault, "props.run.missingProp", 0);
    assert.equal(d1[0].span.start.line, loc1.line);
    assert.equal(d1[0].span.start.column, loc1.column + "props.run.".length);

    const srcOnlyCaseIf = makeFixture(`      {switch props.run.missingProp}
        {case if props.run.type === "ph"}<u>{props.run.key}</u>
      {endswitch}`);
    const d2 = runTixCheck(srcOnlyCaseIf, "OnlyCaseIf.tix");
    assert.equal(d2.length, 1);
    assert.equal(d2[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    const loc2 = lineColOf(srcOnlyCaseIf, "props.run.missingProp", 0);
    assert.equal(d2[0].span.start.line, loc2.line);
    assert.equal(d2[0].span.start.column, loc2.column + "props.run.".length);
  });
});

describe("Gate 42 T3: out-of-type case value reports 1 diagnostic at case value", () => {
  it("reports 1 diagnostic at the case value in block {switch}", () => {
    const src = makeFixture(`      {switch props.run.type}
        {case "text", "strong"}<b>{props.run.value}</b>
        {case "unknown"}<span>nope</span>
        {case "contact"}<i>{props.run.field}</i>
        {default}<u>{props.run.key}</u>
      {endswitch}`);
    const diagnostics = runTixCheck(src, "OutOfTypeCase.tix");
    assert.equal(diagnostics.length, 1, `Expected 1 diagnostic, got ${JSON.stringify(diagnostics)}`);
    assert.equal(diagnostics[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    const caseLoc = lineColOf(src, '"unknown"', 0);
    assert.equal(diagnostics[0].span.start.line, caseLoc.line);
    assert.equal(diagnostics[0].span.start.column, caseLoc.column);
  });

  it("reports 1 diagnostic at the case value in component <Switch><Case>", () => {
    const src = makeFixture(
      `      <Switch on={props.run.type}>
        <Case is={["text", "strong"]}><b>{props.run.value}</b></Case>
        <Case is="unknown"><span>nope</span></Case>
        <Case is="contact"><i>{props.run.field}</i></Case>
        <Default><u>{props.run.key}</u></Default>
      </Switch>`,
      { importDirectives: true }
    );
    const diagnostics = runTixCheck(src, "OutOfTypeCaseComp.tix");
    assert.equal(diagnostics.length, 1, `Expected 1 diagnostic, got ${JSON.stringify(diagnostics)}`);
    assert.equal(diagnostics[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
    const caseLoc = lineColOf(src, 'is="unknown"', 0);
    assert.equal(diagnostics[0].span.start.line, caseLoc.line);
    assert.equal(diagnostics[0].span.start.column, caseLoc.column);
  });
});

describe("Gate 42 T5: language-server diagnostics for fixture (c) are empty", () => {
  it("MixLanguageService.getDiagnostics returns [] for switch parity fixture (c)", () => {
    const lsp = new MixLanguageService();
    const uri = pathToFileURL(path.resolve("Gate42SwitchFixtureC.tix")).href;
    const diags = lsp.getDiagnostics(uri, FIXTURE_C);
    assert.deepEqual(diags, []);
  });
});

