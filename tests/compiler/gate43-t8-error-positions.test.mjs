import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseEmbeddedExpression,
  parseExpressionSlice,
  parseScriptProgram,
  LineMap
} from "../../packages/compiler-frontend/dist/index.js";
import {
  loadC3Invalid,
  loadOracle,
  normalizeForR4,
  sha256Canonical
} from "../fixtures/gate43/helpers.mjs";

const ACCEPTED_TS_CANONICAL_OFFSETS = new Set([
  "markup-01",
  "markup-02",
  "markup-03",
  "markup-04",
  "unterm-template-01",
  "unterm-template-02",
  "unterm-regex-01",
  "unterm-regex-02",
  "script-02",
  "script-03"
]);

const D3_MISSING_DELIMITER_IDS = new Set([
  "unterm-delim-01",
  "unterm-delim-02",
  "unterm-delim-03",
  "unterm-brace-01"
]);

function runInvalidCase(entry) {
  const lm = new LineMap(entry.input);
  try {
    if (entry.mode === "embedded") {
      parseEmbeddedExpression(entry.input, 0, entry.delimiter, lm);
    } else if (entry.mode === "slice") {
      parseExpressionSlice(entry.input, 0, lm);
    } else if (entry.mode === "script") {
      parseScriptProgram(entry.input, 0, lm);
    } else {
      throw new Error(`Unknown mode: ${entry.mode}`);
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

describe("Gate 43 T8 — Error Positions & D3 Delimiter Messages (FIX1)", () => {
  it("reports every C3 entry at exact expectedOffset with non-whitespace token start and matching D3 messages", () => {
    const oracle = loadOracle();
    const invalid = loadC3Invalid();
    assert.strictEqual(invalid.length, 69);
    assert.strictEqual(invalid.length, oracle.counts.c3);

    const differsFromAcorn = [];

    for (let i = 0; i < invalid.length; i++) {
      const entry = invalid[i];
      const oracleEntry = oracle.c3[i];
      assert.strictEqual(oracleEntry.id, entry.id);
      assert.strictEqual(
        typeof entry.expectedOffset,
        "number",
        `C3 ${entry.id} missing numeric expectedOffset`
      );

      const tsRes = runInvalidCase(entry);

      assert.strictEqual(tsRes.accepted, false, `TS unexpectedly accepted C3 ${entry.id}`);
      assert.strictEqual(
        tsRes.code,
        entry.expectedCode,
        `Code mismatch on C3 ${entry.id}: expected ${entry.expectedCode}, got ${tsRes.code}`
      );
      assert.strictEqual(tsRes.code, oracleEntry.code);
      assert.strictEqual(
        tsRes.offset,
        entry.expectedOffset,
        `Offset mismatch on C3 ${entry.id} (${JSON.stringify(entry.input)}): expected ${entry.expectedOffset}, got ${tsRes.offset} (${tsRes.message})`
      );

      if (!entry.id.startsWith("empty-") && tsRes.offset < entry.input.length) {
        const ch = entry.input[tsRes.offset];
        assert.ok(
          ch !== undefined && !/\s/.test(ch),
          `Offset on C3 ${entry.id} points at whitespace ${JSON.stringify(ch)} (offset ${tsRes.offset} in ${JSON.stringify(entry.input)})`
        );
      }

      if (D3_MISSING_DELIMITER_IDS.has(entry.id)) {
        assert.strictEqual(
          tsRes.message,
          oracleEntry.message,
          `D3 message mismatch on C3 ${entry.id}: expected ${JSON.stringify(oracleEntry.message)}, got ${JSON.stringify(tsRes.message)}`
        );
      }

      if (tsRes.offset !== oracleEntry.offset) {
        differsFromAcorn.push(entry.id);
      }
    }

    assert.deepStrictEqual(
      differsFromAcorn.sort(),
      [...ACCEPTED_TS_CANONICAL_OFFSETS].sort(),
      `Offsets differing from Acorn must be exactly the 10 accepted entries, got: ${differsFromAcorn.join(", ")}`
    );
  });

  it("never reports whitespace or comment offset on expressions with spaces/comments before syntax error", () => {
    const oracle = loadOracle();
    const expectedOffsets = [6, 12, 14, 4, 4];
    assert.strictEqual(oracle.t8ExtraCases.length, expectedOffsets.length);

    for (let i = 0; i < oracle.t8ExtraCases.length; i++) {
      const c = oracle.t8ExtraCases[i];
      const expectedOffset = expectedOffsets[i];
      const tsRes = runInvalidCase({ mode: "embedded", input: c.input, delimiter: "}" });

      assert.strictEqual(tsRes.accepted, false, `Expected error on ${JSON.stringify(c.input)}`);
      assert.strictEqual(tsRes.code, c.code);
      assert.strictEqual(
        tsRes.offset,
        expectedOffset,
        `Expected offset ${expectedOffset} for ${JSON.stringify(c.input)}, got ${tsRes.offset} (${tsRes.message})`
      );
      assert.ok(!/\s/.test(c.input[tsRes.offset]), `Offset points at whitespace on ${JSON.stringify(c.input)}`);
      if (c.isOurOwnMessage) {
        assert.strictEqual(tsRes.message, c.message);
        assert.strictEqual(tsRes.offset, c.offset);
        assert.strictEqual(tsRes.endOffset, c.endOffset);
      }
    }
  });
});

describe("Gate 43 T9 — Parse Wrapper Context Safety (FIX1 D2)", () => {
  it("parses >= 20 context-sensitive expressions identically to frozen oracle without wrapper interference", () => {
    const oracle = loadOracle();
    assert.ok(oracle.t9.length >= 20);

    for (let i = 0; i < oracle.t9.length; i++) {
      const expected = oracle.t9[i];
      const wrapped = `  ${expected.input}  } tail`;
      const lm = new LineMap(wrapped);

      const tsRes = parseEmbeddedExpression(wrapped, 0, "}", lm);

      assert.strictEqual(tsRes.rawExpression, expected.rawExpression, `rawExpression mismatch on T9[${i}]: ${expected.input}`);
      assert.strictEqual(tsRes.exprStartOffset, expected.exprStartOffset);
      assert.strictEqual(tsRes.exprEndOffset, expected.exprEndOffset);
      assert.strictEqual(tsRes.afterDelimiterOffset, expected.afterDelimiterOffset);
      assert.strictEqual(
        sha256Canonical(normalizeForR4(tsRes.expression)),
        expected.treeHash,
        `AST hash mismatch on T9[${i}]: ${expected.input}`
      );
    }
  });

  it("does not allow the wrapper parenthesis to be parsed as arrow parameters (a : b})", () => {
    const input = "a : b}";
    const lm = new LineMap(input);
    let caught = null;
    try {
      parseEmbeddedExpression(input, 0, "}", lm);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught, "Expected syntax error on 'a : b}'");
    assert.strictEqual(caught.diagnostic.code, "MIX_ERR_PARSE_SYNTAX");
    assert.strictEqual(caught.diagnostic.span.start.offset, 2);
    assert.ok(
      !caught.diagnostic.message.includes("'=>' expected"),
      `Wrapper parenthesis leaked into arrow-parameter grammar: ${caught.diagnostic.message}`
    );
  });
});
