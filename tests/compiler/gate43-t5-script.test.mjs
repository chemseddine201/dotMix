import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  extractTopLevelSections,
  parseScriptProgram,
  LineMap
} from "../../packages/compiler-frontend/dist/index.js";
import {
  REPO_ROOT,
  collectC1Files,
  loadOracle,
  normalizeForR4,
  sha256Canonical
} from "../fixtures/gate43/helpers.mjs";

describe("Gate 43 T5 — parseScriptProgram Parity (R5)", () => {
  it("matches oracle accept/reject and R4 Program tree hash on every C1 script section", () => {
    const oracle = loadOracle();
    const files = collectC1Files();
    let checked = 0;

    for (const filePath of files) {
      const source = fs.readFileSync(filePath, "utf8");
      const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
      const expected = oracle.c1[rel];
      assert.ok(expected, `Missing oracle entry for C1 file: ${rel}`);

      const lm = new LineMap(source, rel);
      const sections = extractTopLevelSections(source, lm, rel);
      if (!sections.script || !sections.script.content.trim()) {
        assert.strictEqual(expected.script, null);
        continue;
      }

      assert.ok(expected.script, `Missing oracle script entry for C1: ${rel}`);
      checked++;
      const scriptText = sections.script.content;
      const scriptLm = new LineMap(scriptText, rel);

      let tsOk = true;
      let tsTreeHash = null;
      let tsCode = null;
      try {
        const tsTree = normalizeForR4(parseScriptProgram(scriptText, 0, scriptLm), { scriptProgram: true });
        tsTreeHash = sha256Canonical(tsTree);
      } catch (err) {
        tsOk = false;
        tsCode = err?.diagnostic?.code ?? err?.name ?? "UNKNOWN";
      }

      assert.strictEqual(tsOk, expected.script.accepted, `Script accept/reject mismatch on C1: ${rel}`);
      if (expected.script.accepted) {
        assert.strictEqual(tsTreeHash, expected.script.treeHash, `Script Program AST hash mismatch on C1: ${rel}`);
      } else {
        assert.strictEqual(tsCode, expected.script.code, `Script error code mismatch on C1: ${rel}`);
      }
    }

    assert.strictEqual(checked, oracle.counts.c1Scripts);
    assert.ok(checked >= 200, `Expected >= 200 C1 scripts, checked ${checked}`);
  });

  it("handles TS-only declarations and invalid scripts with 'Script syntax error: ' prefix", () => {
    const oracle = loadOracle();
    assert.strictEqual(oracle.t5TsDecls.length, 11);

    for (const decl of oracle.t5TsDecls) {
      const lm = new LineMap(decl.code);
      const tsTree = normalizeForR4(parseScriptProgram(decl.code, 0, lm), { scriptProgram: true });
      assert.strictEqual(sha256Canonical(tsTree), decl.treeHash, `TS declaration mismatch: ${decl.code}`);
    }

    const badScript = "const x = ;";
    const badLm = new LineMap(badScript);
    assert.throws(
      () => parseScriptProgram(badScript, 0, badLm),
      (err) => {
        assert.strictEqual(err?.diagnostic?.code, "MIX_ERR_PARSE_SYNTAX");
        assert.ok(
          err?.diagnostic?.message?.startsWith("Script syntax error: "),
          `Expected 'Script syntax error: ' prefix, got: ${err?.diagnostic?.message}`
        );
        return true;
      }
    );
  });
});
