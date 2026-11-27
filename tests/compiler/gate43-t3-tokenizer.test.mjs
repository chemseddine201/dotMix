import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  createTsTokenizer,
  extractTopLevelSections,
  LineMap
} from "../../packages/compiler-frontend/dist/index.js";
import {
  REPO_ROOT,
  collectC1Files,
  loadC2Expressions,
  loadOracle,
  tokenizeAll,
  normalizeTokenForR6,
  sha256Canonical,
  extractHeaderSlices
} from "../fixtures/gate43/helpers.mjs";

describe("Gate 43 T3 — Tokenizer Parity (R6)", () => {
  it("matches oracle token sequences on every C2 expression", () => {
    const oracle = loadOracle();
    const expressions = loadC2Expressions();
    assert.ok(expressions.length >= 300);
    assert.strictEqual(expressions.length, oracle.counts.c2);

    for (let i = 0; i < expressions.length; i++) {
      const expr = expressions[i];
      const expected = oracle.c2[i];
      assert.strictEqual(expected.input, expr);

      const tsHash = sha256Canonical(tokenizeAll(createTsTokenizer, expr).map(normalizeTokenForR6));
      assert.strictEqual(tsHash, expected.tokensHash, `Tokenizer hash mismatch on C2[${i}]: ${expr}`);
    }
  });

  it("matches oracle token sequences on C1 header slices and script blocks", () => {
    const oracle = loadOracle();
    const files = collectC1Files();
    let headerCount = 0;
    let scriptCount = 0;

    for (const filePath of files) {
      const source = fs.readFileSync(filePath, "utf8");
      const rel = path.relative(REPO_ROOT, filePath).split(path.sep).join("/");
      const expected = oracle.c1[rel];
      assert.ok(expected, `Missing oracle entry for C1 file: ${rel}`);

      const lm = new LineMap(source, rel);
      const sections = extractTopLevelSections(source, lm, rel);

      if (sections.script && sections.script.content.trim().length > 0) {
        assert.ok(expected.script, `Missing oracle script entry on C1: ${rel}`);
        scriptCount++;
        const tsHash = sha256Canonical(
          tokenizeAll(createTsTokenizer, sections.script.content).map(normalizeTokenForR6)
        );
        assert.strictEqual(tsHash, expected.script.tokensHash, `Script tokenizer mismatch on C1: ${rel}`);
      } else {
        assert.strictEqual(expected.script, null, `Unexpected oracle script on C1: ${rel}`);
      }

      const headers = extractHeaderSlices(sections.templateBuffer);
      let idx = 0;
      for (const expectedHeader of expected.headers) {
        while (idx < headers.length && headers[idx] !== expectedHeader.slice) {
          idx++;
        }
        assert.ok(idx < headers.length, `Missing header slice in C1 ${rel}: ${expectedHeader.slice.slice(0, 60)}`);
        const slice = headers[idx];
        idx++;
        headerCount++;

        const tsHeader = [];
        const t = createTsTokenizer(slice);
        let depth = 1;
        while (true) {
          const tok = t.getToken();
          tsHeader.push(
            normalizeTokenForR6({ label: tok.type.label, value: tok.value, start: tok.start, end: tok.end })
          );
          if (tok.type.label === "eof") break;
          if (tok.type.label === "{") depth++;
          else if (tok.type.label === "}") {
            depth--;
            if (depth === 0) break;
          }
        }
        assert.strictEqual(
          sha256Canonical(tsHeader),
          expectedHeader.tokensHash,
          `Header tokenizer mismatch on C1 ${rel}: ${slice.slice(0, 60)}`
        );
      }
    }

    assert.strictEqual(headerCount, oracle.counts.c1Headers);
    assert.strictEqual(scriptCount, oracle.counts.c1Scripts);
    assert.ok(headerCount > 0, "Expected at least one C1 header slice");
    assert.ok(scriptCount > 0, "Expected at least one C1 script section");
  });
});
