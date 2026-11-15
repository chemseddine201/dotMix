import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";
import { DiagnosticCodes } from "../../packages/diagnostics/dist/index.js";

function runTixCheck(sourceCode, filename = "FormInitialValues.tix") {
  const ast = parse(sourceCode, { filename });
  const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
  const typecheckResult = typecheckTix(descriptor, sourceCode, {
    filename,
    throwOnError: false
  });
  return [...descriptor.diagnostics, ...typecheckResult.diagnostics];
}

test("createForm with initialValues accepts known field in error directive with zero diagnostics", () => {
  const sourceCode = `import { createForm } from "@dotmix/runtime/forms";
export default function FormInitialValues() {
  const form = createForm({ initialValues: { email: "" } });
  return (
    <form>
      {error "email" in form as message}<p class="error">{message}</p>{enderror}
    </form>
  );
}
`;
  const diagnostics = runTixCheck(sourceCode);
  assert.deepEqual(diagnostics, []);
});

test("createForm with initialValues reports MIX_ERR_FORM_FIELD_UNKNOWN exactly once for unknown field", () => {
  const sourceCode = `import { createForm } from "@dotmix/runtime/forms";
export default function FormInitialValuesUnknown() {
  const form = createForm({ initialValues: { email: "" } });
  return (
    <form>
      {error "missingField" in form as message}<p class="error">{message}</p>{enderror}
    </form>
  );
}
`;
  const diagnostics = runTixCheck(sourceCode, "FormInitialValuesUnknown.tix");
  const unknownFieldErrors = diagnostics.filter(
    (diag) => diag.code === DiagnosticCodes.MIX_ERR_FORM_FIELD_UNKNOWN
  );
  assert.equal(unknownFieldErrors.length, 1);
  assert.equal(diagnostics.length, 1);
});

