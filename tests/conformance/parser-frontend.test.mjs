import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { walk } from "../../packages/ast/dist/index.js";
import { MixDiagnosticError, DiagnosticCodes, formatDiagnosticCodeFrame } from "../../packages/diagnostics/dist/index.js";

function assertDeepFrozen(obj, path = "root") {
  if (obj === null || typeof obj !== "object") return;
  assert.strictEqual(Object.isFrozen(obj), true, `Expected ${path} to be Object.frozen`);
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => assertDeepFrozen(item, `${path}[${idx}]`));
  } else {
    for (const [k, v] of Object.entries(obj)) {
      assertDeepFrozen(v, `${path}.${k}`);
    }
  }
}

test("Gate 2 (T-SYN-01..06): Expression boundary extraction across strings, template literals, regexes, comments, and parens (R-SYN-01, R-SYN-01a)", () => {
  const source = `<script lang="ts">
  const count = signal(0);
</script>
<div
  data-str={"} still inside string }"}
  data-tpl={\`prefix \${ { nested: "}" }.nested } suffix }\`}
  data-regex={/\\}/g.test("}") ? "match" : "no"}
  data-comment={/* } inside block comment */ count() // } inside line comment
  }
  data-parens={({ k: 1 as number }).k}
>
  {({ label: "ok" as const }).label}
</div>`;

  const ast = parse(source, { filename: "EdgeCases.tix" });
  assertDeepFrozen(ast);

  assert.strictEqual(ast.script?.lang, "ts");
  assert.strictEqual(ast.template.length, 1);

  const div = ast.template[0];
  assert.strictEqual(div.type, "Element");
  assert.strictEqual(div.tag, "div");
  assert.strictEqual(div.attributes.length, 5);

  const parensAttr = div.attributes[4];
  assert.strictEqual(parensAttr.type, "DynamicAttribute");
  assert.strictEqual(parensAttr.name, "data-parens");
  assert.strictEqual(parensAttr.rawExpression, "({ k: 1 as number }).k");

  const interp = div.children.find(c => c.type === "Interpolation");
  assert.ok(interp);
  assert.strictEqual(interp.rawExpression, '({ label: "ok" as const }).label');
});

test("Gate 2 (T-SYN-07..08): Unterminated and invalid expressions emit MixDiagnosticError with exact spans", () => {
  assert.throws(
    () => parse(`<div>{ count( </div>`),
    err => {
      assert.ok(err instanceof MixDiagnosticError);
      assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX);
      assert.strictEqual(err.diagnostic.span.start.line, 1);
      return true;
    }
  );

  // Trailing garbage before closing '}'
  assert.throws(
    () => parse(`<div>{ a b }</div>`),
    err => {
      assert.ok(err instanceof MixDiagnosticError);
      assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX);
      return true;
    }
  );

  // Empty expression '{}'
  assert.throws(
    () => parse(`<div>{   }</div>`),
    err => {
      assert.ok(err instanceof MixDiagnosticError);
      assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX);
      return true;
    }
  );
});

test("Gate 2 (D-105, R-SYN-02, R-SYN-03, TECH-06): Dynamic element <{~expr}> preserves attributes and compares closing tag by token sequence", () => {
  const source = `<{~isHeader() ? "h1" : "p"} id="dyn" class={cls()} @click={handleClick} ref={headingRef}>
  <span>Inside Dynamic</span>
</{~ /* comment ignored in R-SYN-02 */ isHeader( ) ? "h1" : "p" }>`;

  const ast = parse(source, { filename: "Dynamic.mix" });
  assertDeepFrozen(ast);

  assert.strictEqual(ast.template.length, 1);
  const dyn = ast.template[0];
  assert.strictEqual(dyn.type, "DynamicElement");
  assert.strictEqual(dyn.selfClosing, false);
  assert.strictEqual(dyn.rawTagExpression, 'isHeader() ? "h1" : "p"');
  assert.strictEqual(dyn.attributes.length, 4);
  assert.strictEqual(dyn.attributes[0].type, "StaticAttribute");
  assert.strictEqual(dyn.attributes[1].type, "DynamicAttribute");
  assert.strictEqual(dyn.attributes[2].type, "EventBinding");
  assert.strictEqual(dyn.attributes[3].type, "RefBinding");

  // Self-closing dynamic element <{~expr} />
  const selfClosingAst = parse(`<{~viewTag()} title={title()} />`);
  const selfDyn = selfClosingAst.template[0];
  assert.strictEqual(selfDyn.type, "DynamicElement");
  assert.strictEqual(selfDyn.selfClosing, true);
  assert.strictEqual(selfDyn.attributes.length, 1);

  // Mismatched closing tag token sequence must throw MIX_ERR_UNCLOSED_TAG
  assert.throws(
    () => parse(`<{~viewA()}><span>x</span></{~viewB()}>`),
    err => {
      assert.ok(err instanceof MixDiagnosticError);
      assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_UNCLOSED_TAG);
      assert.match(err.message, /does not match opening tag/);
      return true;
    }
  );

  // Whitespace inside `<{ ~` is forbidden per R-SYN-02 EBNF
  assert.throws(
    () => parse(`<{ ~viewA()}><span>x</span></{~viewA()}>`),
    err => {
      assert.ok(err instanceof MixDiagnosticError);
      assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX);
      return true;
    }
  );
});

test("Gate 2 (TECH-07): PascalCase tags parse into ComponentCallNode while lowercase tags parse into ElementNode", () => {
  const source = `<Card title="Wrapper">
  <Header label={title()} @save={onSave} />
  <div class="body"><input type="text" disabled></div>
</Card>`;

  const ast = parse(source);
  assertDeepFrozen(ast);

  const card = ast.template[0];
  assert.strictEqual(card.type, "ComponentCall");
  assert.strictEqual(card.name, "Card");
  assert.strictEqual(card.selfClosing, false);

  const header = card.children.find(c => c.type === "ComponentCall");
  assert.ok(header);
  assert.strictEqual(header.name, "Header");
  assert.strictEqual(header.selfClosing, true);
  assert.strictEqual(header.attributes.length, 2);

  const div = card.children.find(c => c.type === "Element");
  assert.ok(div);
  assert.strictEqual(div.tag, "div");
  const input = div.children[0];
  assert.strictEqual(input.type, "Element");
  assert.strictEqual(input.tag, "input");
  assert.strictEqual(input.selfClosing, true);
});

test("Gate 2: Control flow {#if}/{:else if}/{:else} and keyed {#each} blocks (D-110)", () => {
  const source = `{#if status() === "loading"}
  <p>Loading...</p>
{:else if status() === "error"}
  <p>Error!</p>
{:else}
  <ul>
    {#each (items() as Item[]) as item, idx (item.id)}
      <li mix-html={item.safeHtml}>{idx}: {item.name}</li>
    {/each}
  </ul>
{/if}`;

  const ast = parse(source, { filename: "List.tix" });
  assertDeepFrozen(ast);

  const ifNode = ast.template[0];
  assert.strictEqual(ifNode.type, "IfBlock");
  assert.strictEqual(ifNode.rawCondition, 'status() === "loading"');
  assert.ok(ifNode.alternate && !Array.isArray(ifNode.alternate));
  assert.strictEqual(ifNode.alternate.type, "IfBlock");
  assert.strictEqual(ifNode.alternate.rawCondition, 'status() === "error"');
  assert.ok(Array.isArray(ifNode.alternate.alternate));

  const ul = ifNode.alternate.alternate.find(n => n.type === "Element");
  assert.ok(ul);
  const eachNode = ul.children.find(n => n.type === "EachBlock");
  assert.ok(eachNode);
  assert.strictEqual(eachNode.rawCollection, "(items() as Item[])");
  assert.strictEqual(eachNode.itemIdentifier, "item");
  assert.strictEqual(eachNode.indexIdentifier, "idx");
  assert.strictEqual(eachNode.rawKeyExpression, "item.id");

  const li = eachNode.children.find(n => n.type === "Element");
  assert.ok(li);
  assert.strictEqual(li.attributes[0].type, "DirectiveAttribute");
  assert.strictEqual(li.attributes[0].name, "mix-html");

  // Unkeyed {#each} must be rejected per D-110
  assert.throws(
    () => parse(`{#each items() as item}<li>{item}</li>{/each}`),
    err => {
      assert.ok(err instanceof MixDiagnosticError);
      assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_PARSE_SYNTAX);
      assert.match(err.message, /requires an item identifier and explicit '\(key\)'/);
      return true;
    }
  );
});

test("Gate 2: SourceSpan 1-based line/column accuracy and walk visitor traversal", () => {
  const source = `<script>
  const x = 1;
</script>

<section>
  <p>{x}</p>
</section>

<style scoped>
  p { color: red; }
</style>`;

  const ast = parse(source, { filename: "Spans.mix" });
  const visitedTypes = [];

  walk(ast, {
    enter(node, parent) {
      visitedTypes.push(node.type);
      assert.ok(node.span.start.offset <= node.span.end.offset);
      if (parent) {
        assert.ok(node.span.start.offset >= parent.span.start.offset);
        assert.ok(node.span.end.offset <= parent.span.end.offset);
      }
    }
  });

  assert.deepStrictEqual(visitedTypes, [
    "Component",
    "ScriptBlock",
    "StyleBlock",
    "Element",
    "Text",
    "Element",
    "Interpolation",
    "Text"
  ]);

  const section = ast.template[0];
  assert.strictEqual(section.span.start.line, 5);
  assert.strictEqual(section.span.start.column, 1);

  const p = section.children.find(c => c.type === "Element");
  assert.strictEqual(p.span.start.line, 6);
  assert.strictEqual(p.span.start.column, 3);

  const frame = formatDiagnosticCodeFrame(source, p.span);
  assert.match(frame, /6 \| {3}<p>\{x\}<\/p>/);
});

test("HAA-06 Language Upgrade: Functional React-style components, <$tagName>, {if}/{elseif}/{else}/{endif}, and {each (item, idx) in list}/{endeach}", () => {
  const source = `interface Props {
  headingTag?: string;
}

export default function Dashboard(props: Props = { headingTag: "h2" }) {
  const count = signal(3);
  const tasks = signal([{ id: 1, title: "Ship" }]);

  return (
    <section class="dash">
      <$props.headingTag id="hdr" onClick={() => count.set(count() + 1)}>
        Dashboard ({count()})
      </$props.headingTag>
      {if count() > 5}
        <p>High</p>
      {elseif count() > 0}
        <ul>
          {each (task, idx) in tasks()}
            <li>{idx}: {task.title}</li>
          {endeach}
        </ul>
      {else}
        <p>Empty</p>
      {endif}
    </section>
  );
}

<style>
  .dash { padding: 8px; }
</style>`;

  const ast = parse(source, { filename: "Dashboard.tix" });
  assertDeepFrozen(ast);

  assert.strictEqual(ast.script?.lang, "ts");
  assert.match(ast.script.content, /defineProps<Props>/);
  assert.ok(ast.style);
  assert.strictEqual(ast.template.length, 1);

  const section = ast.template[0];
  assert.strictEqual(section.type, "Element");
  assert.strictEqual(section.tag, "section");

  const dynHeading = section.children.find(n => n.type === "DynamicElement");
  assert.ok(dynHeading);
  assert.strictEqual(dynHeading.rawTagExpression, "props.headingTag");
  assert.strictEqual(dynHeading.attributes.length, 2);
  assert.strictEqual(dynHeading.attributes[1].type, "EventBinding");
  assert.strictEqual(dynHeading.attributes[1].name, "click");

  const ifBlock = section.children.find(n => n.type === "IfBlock");
  assert.ok(ifBlock);
  assert.strictEqual(ifBlock.rawCondition, "count() > 5");
  assert.ok(ifBlock.alternate && !Array.isArray(ifBlock.alternate));
  assert.strictEqual(ifBlock.alternate.type, "IfBlock");
  assert.strictEqual(ifBlock.alternate.rawCondition, "count() > 0");

  const ul = ifBlock.alternate.consequent.find(n => n.type === "Element");
  assert.ok(ul);
  const eachBlock = ul.children.find(n => n.type === "EachBlock");
  assert.ok(eachBlock);
  assert.strictEqual(eachBlock.rawCollection, "tasks()");
  assert.strictEqual(eachBlock.itemIdentifier, "task");
  assert.strictEqual(eachBlock.indexIdentifier, "idx");

  // Also support `{each tasks() as (task, idx)} ... {endeach}`
  const asTupleAst = parse(`<ul>{each tasks() as (task, idx)}<li>{task.title}</li>{endeach}</ul>`);
  const asTupleEach = asTupleAst.template[0].children[0];
  assert.strictEqual(asTupleEach.type, "EachBlock");
  assert.strictEqual(asTupleEach.itemIdentifier, "task");
  assert.strictEqual(asTupleEach.indexIdentifier, "idx");

  // Mismatched <$tagA>...</$tagB> must throw MIX_ERR_UNCLOSED_TAG
  assert.throws(
    () => parse(`<$tagA><span>x</span></$tagB>`),
    err => {
      assert.ok(err instanceof MixDiagnosticError);
      assert.strictEqual(err.code, DiagnosticCodes.MIX_ERR_UNCLOSED_TAG);
      return true;
    }
  );
});
