import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";
import { DiagnosticCodes } from "../../packages/diagnostics/dist/index.js";

function runTixCheck(sourceCode, filename = "LoopControls.tix") {
  const ast = parse(sourceCode, { filename });
  const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
  const typecheckResult = typecheckTix(descriptor, sourceCode, {
    filename,
    throwOnError: false
  });
  return [...descriptor.diagnostics, ...typecheckResult.diagnostics];
}

test("each loop with continue if, break if, and empty infers TaskItem type with zero diagnostics", () => {
  const combinedSource = `import { signal } from "@dotmix/runtime";
interface TaskItem { title: string; archived: boolean; }
export default function LoopControls() {
  const tasks = signal<TaskItem[]>([{ title: "Write", archived: false }]);
  return (
    <ul>
      {each (task, i) in tasks()}
        {continue if task.archived}
        {break if i >= 20}
        <li>{task.title}</li>
      {empty}
        <li>No tasks yet.</li>
      {endeach}
    </ul>
  );
}
`;
  assert.deepEqual(runTixCheck(combinedSource, "LoopControls.tix"), []);
});

test("each loop preserves item type when continue if, break if, or empty is used individually", () => {
  const onlyContinueSource = `import { signal } from "@dotmix/runtime";
interface TaskItem { title: string; archived: boolean; }
export default function OnlyContinue() {
  const tasks = signal<TaskItem[]>([{ title: "Write", archived: false }]);
  return (
    <ul>
      {each (task, i) in tasks()}
        {continue if task.archived}
        <li>{task.title}</li>
      {endeach}
    </ul>
  );
}
`;
  const onlyBreakSource = `import { signal } from "@dotmix/runtime";
interface TaskItem { title: string; archived: boolean; }
export default function OnlyBreak() {
  const tasks = signal<TaskItem[]>([{ title: "Write", archived: false }]);
  return (
    <ul>
      {each (task, i) in tasks()}
        {break if i >= 20}
        <li>{task.title}</li>
      {endeach}
    </ul>
  );
}
`;
  const onlyEmptySource = `import { signal } from "@dotmix/runtime";
interface TaskItem { title: string; archived: boolean; }
export default function OnlyEmpty() {
  const tasks = signal<TaskItem[]>([{ title: "Write", archived: false }]);
  return (
    <ul>
      {each (task, i) in tasks()}
        <li>{task.title}</li>
      {empty}
        <li>No tasks yet.</li>
      {endeach}
    </ul>
  );
}
`;

  assert.deepEqual(runTixCheck(onlyContinueSource, "OnlyContinue.tix"), []);
  assert.deepEqual(runTixCheck(onlyBreakSource, "OnlyBreak.tix"), []);
  assert.deepEqual(runTixCheck(onlyEmptySource, "OnlyEmpty.tix"), []);
});

test("each loop with loop controls reports wrong property access task.nope", () => {
  const invalidPropertySource = `import { signal } from "@dotmix/runtime";
interface TaskItem { title: string; archived: boolean; }
export default function LoopControlsInvalid() {
  const tasks = signal<TaskItem[]>([{ title: "Write", archived: false }]);
  return (
    <ul>
      {each (task, i) in tasks()}
        {continue if task.archived}
        {break if i >= 20}
        <li>{task.nope}</li>
      {empty}
        <li>No tasks yet.</li>
      {endeach}
    </ul>
  );
}
`;
  const diagnostics = runTixCheck(invalidPropertySource, "LoopControlsInvalid.tix");
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, DiagnosticCodes.MIX_ERR_INVALID_PROP_TYPE);
  assert.ok(diagnostics[0].message.includes("nope"));
});

