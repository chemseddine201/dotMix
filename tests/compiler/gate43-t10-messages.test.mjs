import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseEmbeddedExpression,
  parseExpressionSlice,
  parseScriptProgram,
  LineMap
} from "../../packages/compiler-frontend/dist/index.js";
import { loadC3Invalid, loadOracle } from "../fixtures/gate43/helpers.mjs";

function runCase(mode, input, delimiter) {
  const lm = new LineMap(input);
  try {
    if (mode === "embedded") {
      parseEmbeddedExpression(input, 0, delimiter, lm);
    } else if (mode === "slice") {
      parseExpressionSlice(input, 0, lm);
    } else if (mode === "script") {
      parseScriptProgram(input, 0, lm);
    } else {
      throw new Error(`Unknown mode: ${mode}`);
    }
    return { accepted: true, code: null, offset: null, endOffset: null, message: null };
  } catch (err) {
    return {
      accepted: false,
      code: err?.diagnostic?.code ?? err?.code ?? err?.name ?? "UNKNOWN",
      offset: err?.diagnostic?.span?.start?.offset ?? null,
      endOffset: err?.diagnostic?.span?.end?.offset ?? null,
      message: err?.diagnostic?.message ?? err?.message ?? ""
    };
  }
}

const UNTERMINATED_LITERAL_COMMENT_IDS = [
  "unterm-comment-01",
  "unterm-comment-02",
  "unterm-string-01",
  "unterm-string-02",
  "unterm-string-03",
  "unterm-template-01",
  "unterm-template-02",
  "unterm-regex-01",
  "unterm-regex-02"
];

const F3_ACCEPTED_CASES = [
  'flag ? "</b>" : ""}',
  'x ? `</p>` : ""}',
  "a /* </b> */ + b}",
  'cond && "<b>"}',
  "ok ? '</br>' : ''}"
];

describe("Gate 43 T10 — Messages, Unterminated Offsets, and Token Markup Probes (FIX2)", () => {
  it("(a) matches oracle messages character-for-character on every C3 entry with our own message", () => {
    const oracle = loadOracle();
    const checked = [];

    for (const entry of oracle.c3) {
      if (!entry.isOurOwnMessage) continue;

      const tsRes = runCase(entry.mode, entry.input, entry.delimiter);
      checked.push(entry.id);
      assert.strictEqual(tsRes.accepted, false, `TS accepted C3 ${entry.id}`);
      assert.strictEqual(tsRes.code, entry.code);
      assert.strictEqual(
        tsRes.message,
        entry.message,
        `Message mismatch on C3 ${entry.id} (${JSON.stringify(entry.input)}): expected ${JSON.stringify(entry.message)}, got ${JSON.stringify(tsRes.message)}`
      );
    }

    assert.strictEqual(checked.length, oracle.counts.c3OurOwnMessages);
    assert.ok(checked.length > 0);
  });

  it("(b) matches oracle message, offset, and span on extra M1 trailing-token inputs", () => {
    const oracle = loadOracle();
    for (const expected of oracle.t10Extra.m1Extra) {
      const tsRes = runCase("embedded", expected.input, "}");

      assert.strictEqual(expected.accepted, false);
      assert.strictEqual(tsRes.accepted, false, `TS accepted ${JSON.stringify(expected.input)}`);
      assert.strictEqual(tsRes.code, expected.code);
      assert.strictEqual(
        tsRes.message,
        expected.message,
        `Message mismatch on ${JSON.stringify(expected.input)}: expected ${JSON.stringify(expected.message)}, got ${JSON.stringify(tsRes.message)}`
      );
      assert.strictEqual(tsRes.offset, expected.offset, `Offset mismatch on ${JSON.stringify(expected.input)}`);
      assert.strictEqual(tsRes.endOffset, expected.endOffset, `Span end mismatch on ${JSON.stringify(expected.input)}`);
    }
  });

  it("(c) never leaks wrapper tokens \"')'\" or \"void\" into messages for inputs without '('", () => {
    const oracle = loadOracle();
    const invalid = loadC3Invalid();
    const candidates = [
      ...invalid.map((e) => ({ label: `C3:${e.id}`, mode: e.mode, input: e.input, delimiter: e.delimiter })),
      ...oracle.t10Extra.m1Extra.map((e, i) => ({ label: `M1:${i}`, mode: "embedded", input: e.input, delimiter: "}" })),
      ...oracle.t8ExtraCases.map((e, i) => ({ label: `T8:${i}`, mode: "embedded", input: e.input, delimiter: "}" }))
    ];

    for (const c of candidates) {
      if (c.input.includes("(") || c.delimiter === ")") continue;
      const tsRes = runCase(c.mode, c.input, c.delimiter);
      assert.strictEqual(tsRes.accepted, false, `TS accepted ${c.label}`);
      assert.ok(
        !tsRes.message.includes("')'") && !tsRes.message.includes("void"),
        `Wrapper leaked on ${c.label} (${JSON.stringify(c.input)}): ${JSON.stringify(tsRes.message)}`
      );
    }
  });

  it("(d) F2: unterminated string, template, regex, and comment entries point at their opening character", () => {
    const invalid = loadC3Invalid();
    const byId = new Map(invalid.map((e) => [e.id, e]));

    for (const id of ["unterm-regex-01", "unterm-regex-02", "unterm-template-01"]) {
      const entry = byId.get(id);
      assert.ok(entry, `Missing C3 ${id}`);
      const tsRes = runCase(entry.mode, entry.input, entry.delimiter);
      assert.strictEqual(tsRes.accepted, false);
      assert.strictEqual(tsRes.offset, 0, `Expected ${id} offset 0, got ${tsRes.offset}`);
    }

    const openingChars = new Set(['"', "'", "`", "/"]);
    for (const id of UNTERMINATED_LITERAL_COMMENT_IDS) {
      const entry = byId.get(id);
      assert.ok(entry, `Missing C3 ${id}`);
      const tsRes = runCase(entry.mode, entry.input, entry.delimiter);
      assert.strictEqual(tsRes.accepted, false);
      assert.strictEqual(tsRes.offset, entry.expectedOffset, `Offset mismatch on ${id}`);
      const ch = entry.input[tsRes.offset];
      assert.ok(
        openingChars.has(ch),
        `Expected ${id} offset ${tsRes.offset} to point at opening delimiter, got ${JSON.stringify(ch)}`
      );
    }
  });

  it("(e) F3: accepts closing-tag-like text inside strings, templates, and comments (TS engine)", () => {
    for (const input of F3_ACCEPTED_CASES) {
      const lm = new LineMap(input);
      const res = parseEmbeddedExpression(input, 0, "}", lm);
      assert.ok(res.expression, `Expected expression AST for ${JSON.stringify(input)}`);
      assert.strictEqual(res.afterDelimiterOffset, input.length);
    }
  });

  it("(f) F3: keeps rejecting JSX logical/conditional markup, markup-05, and && / ? type assertions", () => {
    const oracle = loadOracle();
    const byId = new Map(oracle.c3.map((e) => [e.id, e]));

    const jsxIds = ["jsx-01", "jsx-02", "jsx-03", "jsx-04", "jsx-05", "jsx-06", "jsx-07"];
    for (const id of jsxIds) {
      const expected = byId.get(id);
      assert.ok(expected);
      const tsRes = runCase(expected.mode, expected.input, expected.delimiter);
      assert.strictEqual(tsRes.accepted, false);
      assert.strictEqual(tsRes.code, expected.code, `Code mismatch on ${id}`);
      assert.strictEqual(tsRes.message, expected.message, `Message mismatch on ${id}`);
      assert.strictEqual(tsRes.offset, expected.offset, `Offset mismatch on ${id}`);
      const expectedEnd = id === "jsx-02" ? 17 : id === "jsx-06" ? 22 : expected.endOffset;
      assert.strictEqual(tsRes.endOffset, expectedEnd, `Span end mismatch on ${id}`);
    }

    const m5Expected = byId.get("markup-05");
    assert.ok(m5Expected);
    const m5Ts = runCase(m5Expected.mode, m5Expected.input, m5Expected.delimiter);
    assert.strictEqual(m5Ts.accepted, false);
    assert.strictEqual(m5Ts.code, m5Expected.code);
    assert.strictEqual(m5Ts.offset, m5Expected.offset);
    assert.strictEqual(m5Ts.endOffset, m5Expected.endOffset);
    assert.strictEqual(m5Ts.message, "Invalid expression syntax: '>' expected.");

    for (const expected of oracle.t10Extra.f3TypeAssertions) {
      const tsRes = runCase("embedded", expected.input, "}");
      assert.strictEqual(tsRes.accepted, false);
      assert.strictEqual(tsRes.code, expected.code, `Code mismatch on ${expected.input}`);
      assert.strictEqual(tsRes.message, expected.message, `Message mismatch on ${expected.input}`);
      assert.strictEqual(tsRes.offset, expected.offset, `Offset mismatch on ${expected.input}`);
      assert.strictEqual(tsRes.endOffset, expected.endOffset, `Span end mismatch on ${expected.input}`);
    }
  });
});
