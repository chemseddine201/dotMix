import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parse,
  parseEmbeddedExpression,
  parseExpressionSlice,
  parseScriptProgram,
  LineMap
} from "../../packages/compiler-frontend/dist/index.js";
import {
  REPO_ROOT,
  collectC1Files,
  loadC3Invalid,
  loadOracle
} from "../fixtures/gate43/helpers.mjs";

function runCase(entry) {
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
    return { accepted: true, code: null, offset: null, message: null };
  } catch (err) {
    return {
      accepted: false,
      code: err?.diagnostic?.code ?? err?.code ?? err?.name ?? "UNKNOWN",
      offset: err?.diagnostic?.span?.start?.offset ?? null,
      message: err?.diagnostic?.message ?? err?.message ?? ""
    };
  }
}

describe("Gate 43 T2 — Acceptance & Diagnostic Code Parity (R8, R9)", () => {
  it("accepts every C1 file that oracle accepts (R9)", () => {
    const oracle = loadOracle();
    const files = collectC1Files();
    assert.strictEqual(files.length, oracle.counts.c1);

    for (const filePath of files) {
      const source = fs.readFileSync(filePath, "utf8");
      const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
      const expected = oracle.c1[rel];
      assert.ok(expected, `Missing oracle entry for C1 file: ${rel}`);

      let tsOk = true;
      let tsCode = null;
      try {
        parse(source, { filename: rel });
      } catch (err) {
        tsOk = false;
        tsCode = err?.diagnostic?.code ?? err?.name ?? "UNKNOWN";
      }

      if (expected.accepted) {
        assert.strictEqual(tsOk, true, `TypeScript rejected C1 file accepted by Acorn: ${rel} (${tsCode})`);
      } else if (!tsOk) {
        assert.strictEqual(tsCode, expected.code, `Diagnostic code mismatch on rejected C1 file: ${rel}`);
      }
    }
  });

  it("matches accept/reject and diagnostic codes across all C3 invalid inputs (R8)", () => {
    const oracle = loadOracle();
    const invalid = loadC3Invalid();
    assert.ok(invalid.length >= 60, `Expected C3 >= 60 invalid inputs, got ${invalid.length}`);
    assert.strictEqual(invalid.length, oracle.counts.c3);

    for (let i = 0; i < invalid.length; i++) {
      const entry = invalid[i];
      const expected = oracle.c3[i];
      assert.strictEqual(expected.id, entry.id);
      assert.strictEqual(expected.accepted, false, `Oracle unexpectedly accepted C3 ${entry.id}`);
      assert.strictEqual(expected.code, entry.expectedCode, `Oracle code mismatch for C3 ${entry.id}`);

      const tsRes = runCase(entry);

      assert.strictEqual(tsRes.accepted, false, `TypeScript unexpectedly accepted C3 ${entry.id}: ${entry.input}`);
      assert.strictEqual(
        tsRes.code,
        expected.code,
        `Diagnostic code mismatch on C3 ${entry.id} (${entry.input}): expected ${expected.code}, got ${tsRes.code} (${tsRes.message})`
      );

      if (tsRes.offset !== null) {
        assert.ok(
          tsRes.offset >= 0 && tsRes.offset <= entry.input.length,
          `Error offset out of bounds on C3 ${entry.id}: ${tsRes.offset} not in [0, ${entry.input.length}]`
        );
      }
    }
  });

  it("documents R9 modern TS acceptance delta (#priv in obj)", () => {
    const oracle = loadOracle();
    assert.strictEqual(oracle.r9PrivInObj.accepted, false);
    assert.strictEqual(oracle.r9PrivInObj.code, "MIX_ERR_PARSE_SYNTAX");

    const wrapped = oracle.r9PrivInObj.input;
    const lm = new LineMap(wrapped);
    const res = parseEmbeddedExpression(wrapped, 0, oracle.r9PrivInObj.delimiter, lm);
    assert.strictEqual(res.rawExpression, "#priv in obj");
  });
});
