import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@dotmix/compiler-frontend";
import { DiagnosticCodes } from "@dotmix/diagnostics";

const EXPECTED_COMMENT_MESSAGE =
  'Comments are not supported inside markup ("{/* … */}"). Put the comment in the component script, above `return`.';

function captureParseDiagnostic(sourceCode, filename) {
  try {
    parse(sourceCode, { filename });
    assert.fail("Expected parse() to throw MixDiagnosticError");
  } catch (error) {
    return error;
  }
}

describe("markup comment error message", () => {
  it("reports clear message with line and column for block comment syntax {/* ... */} in markup", () => {
    const sourceCode = [
      "export default function Card() {",
      "  return (",
      "    <div>",
      "      {/* checked */}",
      "    </div>",
      "  );",
      "}",
      ""
    ].join("\n");

    const error = captureParseDiagnostic(sourceCode, "BlockComment.mix");
    assert.equal(error.code, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX);
    assert.equal(error.diagnostic.message, EXPECTED_COMMENT_MESSAGE);
    assert.equal(error.diagnostic.span.start.line, 4);
    assert.equal(error.diagnostic.span.start.column, 7);
  });

  it("reports clear message with line and column for line comment syntax {// ...} in markup", () => {
    const sourceCode = [
      "export default function Card() {",
      "  return (",
      "    <div>",
      "        {// comment",
      "        }",
      "    </div>",
      "  );",
      "}",
      ""
    ].join("\n");

    const error = captureParseDiagnostic(sourceCode, "LineComment.mix");
    assert.equal(error.code, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX);
    assert.equal(error.diagnostic.message, EXPECTED_COMMENT_MESSAGE);
    assert.equal(error.diagnostic.span.start.line, 4);
    assert.equal(error.diagnostic.span.start.column, 9);
  });

  it("keeps existing control-flow tag diagnostics unchanged", () => {
    const legacyTagSource = "<div>\n  {/unexpected}\n</div>\n";
    const legacyTagError = captureParseDiagnostic(legacyTagSource, "StrayLegacyTag.mix");
    assert.equal(legacyTagError.code, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX);
    assert.match(legacyTagError.diagnostic.message, /^Unexpected control flow tag/);

    const unclosedIfSource = "<div>\n  {if condition}<p>Open</p>\n</div>\n";
    const unclosedError = captureParseDiagnostic(unclosedIfSource, "UnclosedIf.mix");
    assert.equal(unclosedError.code, DiagnosticCodes.MIX_ERR_UNCLOSED_TAG);
    assert.notEqual(unclosedError.diagnostic.message, EXPECTED_COMMENT_MESSAGE);
  });
});

