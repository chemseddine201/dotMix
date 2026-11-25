/* global document, Event */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { generate } from "../../node_modules/@dotmix/compiler-codegen/dist/index.js";
import { compileToSsr } from "../../node_modules/@dotmix/compiler-ssr/dist/index.js";
import { createDevServer } from "../../node_modules/@dotmix/cli/dist/index.js";
import { launchBrowser, browserSkipReason } from "../helpers/cdp-browser.mjs";

const islandArrowClamp = `import { createSignal } from "@dotmix/runtime";

function clamp(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(500, Math.max(10, n)) : 10;
}

export default function ArrowClampIsland() {
  const v = createSignal(25);
  const onInput = (e: Event) => {
    const t = e.target as HTMLInputElement | null;
    if (t) v.set(clamp(t.value));
  };
  return (
    <div id="arrow-clamp">
      <input id="arrow-clamp-input" type="number" value={String(v())} onInput={onInput} />
      <output id="arrow-clamp-out">{v()}</output>
    </div>
  );
}
`;

const islandInlineClampOr = `import { createSignal } from "@dotmix/runtime";

const MAX_V = 1000;
const MIN_V = 5;
const FALLBACK_V = 42;

function toNum(s: string): number {
  return Number(s);
}

export default function InlineClampIsland() {
  const v = createSignal(FALLBACK_V);
  const onInput = (e: Event) => {
    const t = e.target as HTMLInputElement | null;
    if (t) v.set(Math.min(MAX_V, Math.max(MIN_V, toNum(t.value) || FALLBACK_V)));
  };
  return (
    <div id="inline-clamp">
      <input id="inline-clamp-input" type="text" value={String(v())} onInput={onInput} />
      <output id="inline-clamp-out">{v()}</output>
    </div>
  );
}
`;

const islandFnDeclHandler = `import { createSignal } from "@dotmix/runtime";

function doubleVal(s: string): number {
  return (Number(s) || 0) * 2;
}

export default function FnDeclIsland() {
  const v = createSignal(3);
  function onInput(e: Event): void {
    const t = e.target as HTMLInputElement | null;
    if (t) v.set(doubleVal(t.value));
  }
  return (
    <div id="fn-decl">
      <input id="fn-decl-input" type="text" value={String(v())} onInput={onInput} />
      <output id="fn-decl-out">{v()}</output>
    </div>
  );
}
`;

describe("Gate 41 B3: .tix island script parser accepts complex signal .set(...) expressions", () => {
  it("parses, analyzes, generates CSR and SSR for arrow handler, Math.min/||, and function declaration handler", () => {
    for (const [name, src] of [
      ["ArrowClampIsland.tix", islandArrowClamp],
      ["InlineClampIsland.tix", islandInlineClampOr],
      ["FnDeclIsland.tix", islandFnDeclHandler]
    ]) {
      const ast = parse(src, { filename: name });
      const desc = analyze(ast, { filename: name, source: src });
      const csr = generate(desc, { filename: name, source: src });
      const ssr = compileToSsr(desc, undefined, { filename: name, source: src });
      assert.ok(csr.js.includes("v.set("), `${name}: CSR must preserve v.set(...)`);
      assert.ok(ssr.code.includes("<output"), `${name}: SSR must emit template`);
    }
  });

  describe("real-browser CDP execution", { skip: browserSkipReason }, () => {
    let browser;
    let server;
    let tmpDir;

    before(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-gate41-b3-cdp-"));
      fs.mkdirSync(path.join(tmpDir, "src/islands"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "b3-cdp", type: "module" }));
      fs.writeFileSync(
        path.join(tmpDir, "index.html"),
        '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>'
      );
      fs.writeFileSync(path.join(tmpDir, "src/islands/ArrowClampIsland.tix"), islandArrowClamp);
      fs.writeFileSync(path.join(tmpDir, "src/islands/InlineClampIsland.tix"), islandInlineClampOr);
      fs.writeFileSync(path.join(tmpDir, "src/islands/FnDeclIsland.tix"), islandFnDeclHandler);
      fs.writeFileSync(
        path.join(tmpDir, "src/main.ts"),
        [
          'import { mount } from "@dotmix/runtime";',
          'import ArrowClampIsland from "./islands/ArrowClampIsland.tix";',
          'import InlineClampIsland from "./islands/InlineClampIsland.tix";',
          'import FnDeclIsland from "./islands/FnDeclIsland.tix";',
          'const root = document.getElementById("root")!;',
          "const a = document.createElement('div'); root.appendChild(a); mount(() => ArrowClampIsland({}), a);",
          "const b = document.createElement('div'); root.appendChild(b); mount(() => InlineClampIsland({}), b);",
          "const c = document.createElement('div'); root.appendChild(c); mount(() => FnDeclIsland({}), c);"
        ].join("\n")
      );
      server = await createDevServer({ rootDir: tmpDir, port: 0, silent: true });
      browser = await launchBrowser();
    });

    after(async () => {
      if (browser) await browser.close();
      if (server) await server.close();
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("updates DOM reactively on input events for all three B3 islands", async () => {
      const page = await browser.newPage();
      await page.goto(`${server.url}/`);
      await page.waitForSelector("#fn-decl-out");

      const result = await page.evaluate(() => {
        const trigger = (id, val) => {
          const inp = document.getElementById(id);
          inp.value = val;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
        };
        trigger("arrow-clamp-input", "999");
        trigger("inline-clamp-input", "bad");
        trigger("fn-decl-input", "15");
        return {
          arrow: document.getElementById("arrow-clamp-out")?.textContent,
          inlineFallback: document.getElementById("inline-clamp-out")?.textContent,
          fnDecl: document.getElementById("fn-decl-out")?.textContent
        };
      });

      assert.deepEqual(result, {
        arrow: "500",
        inlineFallback: "42",
        fnDecl: "30"
      });
    });
  });
});

