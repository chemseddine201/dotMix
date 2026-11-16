// Stylesheets in a component's own folder (`./Card.scss`) are its scoped styles.
// A stylesheet from another folder (`./styles/global.scss`) is global: compiled without scoping, so
// rules such as `:root { --token: … }` and `body { … }` apply to the page.

import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { generate } from "../../node_modules/@dotmix/compiler-codegen/dist/index.js";

// Like the CLI's readers, the resolver returns "" for a file it cannot find.
const stylesheets = {
  "./Card.scss": ".card { color: var(--brand); }",
  "./styles/global.scss": "@import \"./tokens.scss\";\nbody { margin: 0; }",
  "./tokens.scss": ":root { --brand: #6366f1; }"
};

function compile(filename, source) {
  const descriptor = analyze(parse(source, { filename }), { filename, source });
  return generate(descriptor, { filename, resolveStyle: (specifier) => stylesheets[specifier] ?? "" });
}

test("a stylesheet in the component folder stays scoped and one from another folder is global", () => {
  const result = compile("Card.tix", [
    "import \"./styles/global.scss\";",
    "import \"./Card.scss\";",
    "export default function Card() {",
    "  return (<div class=\"card\">card</div>);",
    "}",
    ""
  ].join("\n"));

  assert.match(result.css, /:root\{--brand: ?#6366f1;?\}/, "global :root rule must stay unscoped");
  assert.match(result.css, /(^|\})body\{margin:0;?\}/, "global body rule must stay unscoped");
  assert.doesNotMatch(result.css, /body\[data-mix-/);
  assert.doesNotMatch(result.css, /:root\[data-mix-/);
  assert.match(result.css, /\.card\[data-mix-[a-z0-9]+\]\{color:var\(--brand\);?\}/, "the component-folder stylesheet must be scoped");
  assert.ok(result.scopeAttribute, "the component keeps its scope attribute");
  assert.match(result.globalCss ?? "", /:root\{--brand/, "the global part is exposed so a build can avoid duplicating it");
  assert.doesNotMatch(result.globalCss ?? "", /\.card/);
});

test("an entry module that only imports a global stylesheet produces unscoped CSS", () => {
  const result = compile("main.mix", [
    "import \"./styles/global.scss\";",
    "export default function Main() {",
    "  return (<p>app</p>);",
    "}",
    ""
  ].join("\n"));

  assert.match(result.css, /:root\{--brand: ?#6366f1;?\}/);
  assert.doesNotMatch(result.css, /\[data-mix-/);
});
