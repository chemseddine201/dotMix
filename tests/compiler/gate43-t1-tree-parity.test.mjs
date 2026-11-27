import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  parse,
  parseEmbeddedExpression,
  parseExpressionSlice,
  LineMap
} from "../../packages/compiler-frontend/dist/index.js";
import {
  REPO_ROOT,
  collectC1Files,
  loadC2Expressions,
  loadOracle,
  normalizeForR4,
  sha256Canonical
} from "../fixtures/gate43/helpers.mjs";

describe("Gate 43 T1 — AST & Expression Tree Parity (R4)", () => {
  it("full parse() matches frozen Acorn oracle AST hash under R4 across every C1 .tix/.mix file", () => {
    const oracle = loadOracle();
    const files = collectC1Files();
    assert.ok(files.length >= 250, `Expected C1 corpus >= 250 files, got ${files.length}`);
    assert.strictEqual(files.length, oracle.counts.c1, "C1 file count changed relative to oracle");

    for (const filePath of files) {
      const source = fs.readFileSync(filePath, "utf8");
      const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
      const expected = oracle.c1[rel];
      assert.ok(expected, `Missing oracle entry for C1 file: ${rel}`);

      if (expected.accepted) {
        const tsAst = normalizeForR4(parse(source, { filename: rel }));
        assert.strictEqual(
          sha256Canonical(tsAst),
          expected.treeHash,
          `AST hash mismatch on C1 file: ${rel}`
        );
      } else {
        assert.throws(
          () => parse(source, { filename: rel }),
          (err) => {
            const code = err?.diagnostic?.code ?? err?.name ?? "UNKNOWN";
            assert.strictEqual(code, expected.code, `Error code mismatch on C1 file: ${rel}`);
            return true;
          }
        );
      }
    }
  });

  it("parseEmbeddedExpression(..., '}') matches oracle tree hash and offsets on every C2 expression", () => {
    const oracle = loadOracle();
    const expressions = loadC2Expressions();
    assert.ok(expressions.length >= 300, `Expected C2 >= 300 expressions, got ${expressions.length}`);
    assert.strictEqual(expressions.length, oracle.counts.c2);

    for (let i = 0; i < expressions.length; i++) {
      const expr = expressions[i];
      const expected = oracle.c2[i];
      assert.strictEqual(expected.input, expr, `Oracle C2[${i}] input mismatch`);

      const wrapped = `  ${expr}  } trailing`;
      const lm = new LineMap(wrapped);
      const tsRes = parseEmbeddedExpression(wrapped, 0, "}", lm);

      assert.strictEqual(tsRes.rawExpression, expected.rawExpression, `rawExpression mismatch on C2[${i}]: ${expr}`);
      assert.strictEqual(tsRes.exprStartOffset, expected.exprStartOffset, `exprStartOffset mismatch on C2[${i}]: ${expr}`);
      assert.strictEqual(tsRes.exprEndOffset, expected.exprEndOffset, `exprEndOffset mismatch on C2[${i}]: ${expr}`);
      assert.strictEqual(tsRes.afterDelimiterOffset, expected.afterDelimiterOffset, `afterDelimiterOffset mismatch on C2[${i}]: ${expr}`);
      assert.strictEqual(
        sha256Canonical(normalizeForR4(tsRes.expression)),
        expected.treeHash,
        `ESTree hash mismatch on C2[${i}]: ${expr}`
      );
    }
  });

  it("parseEmbeddedExpression supports '}>', ')' and parseExpressionSlice matches oracle", () => {
    const oracle = loadOracle();
    assert.strictEqual(oracle.t1Samples.length, 5);

    for (const sample of oracle.t1Samples) {
      for (const delim of ["}>", ")"]) {
        const expected = sample.delimiters[delim];
        const wrapped = ` ${sample.input} ${delim} rest`;
        const lm = new LineMap(wrapped);
        const tsRes = parseEmbeddedExpression(wrapped, 0, delim, lm);

        assert.strictEqual(tsRes.rawExpression, expected.rawExpression, `rawExpression mismatch (${delim}): ${sample.input}`);
        assert.strictEqual(tsRes.exprStartOffset, expected.exprStartOffset);
        assert.strictEqual(tsRes.exprEndOffset, expected.exprEndOffset);
        assert.strictEqual(tsRes.afterDelimiterOffset, expected.afterDelimiterOffset);
        assert.strictEqual(
          sha256Canonical(normalizeForR4(tsRes.expression)),
          expected.treeHash,
          `ESTree hash mismatch (${delim}): ${sample.input}`
        );
      }

      const full = `prefix:${sample.input}`;
      const lm = new LineMap(full);
      const tsSlice = parseExpressionSlice(sample.input, 7, lm);
      assert.strictEqual(
        sha256Canonical(normalizeForR4(tsSlice)),
        sample.sliceTreeHash,
        `parseExpressionSlice hash mismatch: ${sample.input}`
      );
    }
  });
});
