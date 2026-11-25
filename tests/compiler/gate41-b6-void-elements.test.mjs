import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { HTML_VOID_ELEMENTS } from "../../node_modules/@dotmix/ast/dist/index.js";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { generate } from "../../node_modules/@dotmix/compiler-codegen/dist/index.js";
import { compileToSsr } from "../../node_modules/@dotmix/compiler-ssr/dist/index.js";
import { MixDiagnosticError, DiagnosticCodes } from "../../node_modules/@dotmix/diagnostics/dist/index.js";

describe("Gate 41 B6: HTML void elements and <canvas> handling", () => {
  it("HTML_VOID_ELEMENTS contains only the 13 real HTML void elements", () => {
    const expected = [
      "area", "base", "br", "col", "embed", "hr",
      "img", "input", "link", "meta", "source", "track", "wbr"
    ];
    assert.deepEqual([...HTML_VOID_ELEMENTS].sort(), expected);
    assert.equal(HTML_VOID_ELEMENTS.has("canvas"), false);
    assert.equal(HTML_VOID_ELEMENTS.has("param"), false);
  });

  it("<canvas class=\"c\"></canvas> parses, compiles (CSR + SSR), and renders; self-closing <canvas class=\"c\" /> emits explicit </canvas> in SSR", () => {
    const pairSrc = `export default function CanvasBox() {
  return <div class="wrap"><canvas class="c"></canvas><p id="after">ok</p></div>;
}`;
    const pairAst = parse(pairSrc, { filename: "CanvasBox.tix" });
    const pairDesc = analyze(pairAst, { filename: "CanvasBox.tix", source: pairSrc });
    const pairCsr = generate(pairDesc, { filename: "CanvasBox.tix", source: pairSrc });
    const pairSsr = compileToSsr(pairDesc, undefined, { filename: "CanvasBox.tix", source: pairSrc });

    assert.ok(pairCsr.js.includes('__createElement("canvas")'));
    const renderPair = new Function(
      pairSsr.code.replace(/export function /g, "function ").replace(/export const /g, "const ") + "\nreturn renderToString;"
    )();
    const pairHtml = renderPair({});
    assert.ok(pairHtml.includes('<canvas class="c"></canvas>'), `Expected <canvas class="c"></canvas>, got: ${pairHtml}`);

    // Self-closing <canvas class="c" /> in .tix must still emit <canvas class="c"></canvas> in SSR HTML so siblings are not swallowed
    const selfSrc = `export default function CanvasSelf() {
  return <div class="wrap"><canvas class="c" /><p id="after">ok</p></div>;
}`;
    const selfAst = parse(selfSrc, { filename: "CanvasSelf.tix" });
    const selfDesc = analyze(selfAst, { filename: "CanvasSelf.tix", source: selfSrc });
    const selfSsr = compileToSsr(selfDesc, undefined, { filename: "CanvasSelf.tix", source: selfSrc });
    const renderSelf = new Function(
      selfSsr.code.replace(/export function /g, "function ").replace(/export const /g, "const ") + "\nreturn renderToString;"
    )();
    const selfHtml = renderSelf({});
    assert.ok(selfHtml.includes('<canvas class="c"></canvas>'), `SSR must not emit self-closing <canvas />, got: ${selfHtml}`);

    const win = new Window();
    win.document.body.innerHTML = selfHtml;
    assert.equal(win.document.querySelector("canvas")?.children.length, 0);
    assert.equal(win.document.querySelector("#after")?.parentElement?.tagName, "DIV");
  });

  it("<img> and <br> stay void, and <img></img> keeps its current diagnostic", () => {
    const voidAst = parse(`<div><img src="/a.png"><br></div>`, { filename: "VoidOk.tix" });
    const div = voidAst.template[0];
    assert.equal(div.children[0].tag, "img");
    assert.equal(div.children[0].selfClosing, true);
    assert.equal(div.children[1].tag, "br");
    assert.equal(div.children[1].selfClosing, true);

    assert.throws(
      () => parse(`<div><img src="/a.png"></img></div>`, { filename: "VoidBad.tix" }),
      (err) => err instanceof MixDiagnosticError && err.code === DiagnosticCodes.MIX_ERR_UNCLOSED_TAG
    );
    assert.throws(
      () => parse(`<img src="/a.png"></img>`, { filename: "VoidBadRoot.tix" }),
      (err) => err instanceof MixDiagnosticError && err.code === DiagnosticCodes.MIX_ERR_PARSE_SYNTAX
    );
  });
});

