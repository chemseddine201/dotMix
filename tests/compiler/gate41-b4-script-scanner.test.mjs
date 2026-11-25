/* global document */
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

const islandRegexAndDivision = `import { createSignal } from "@dotmix/runtime";

// Helper comment with closing ")" and "}" and quote "
function fmt(n: number): string {
  return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, " ");
}

export default function ScannerIsland(
  // comment inside params with ")"
  props: { initial?: number } = { initial: 12000 }
) {
  const amount = createSignal(props.initial ?? 12000);
  const stripBad = (s: string) => s.replace(/["'{}]/g, "");
  const a = 60;
  const b = 3;
  const ratio = a / b;
  const pct = (amount()) / 100 * 30;
  // comment with ")" and "}" right before return
  /* block comment with ")" and "{" */
  const label = stripBad(\`val=\${fmt(pct)}/\${ratio}\`);
  return (
    <section id="scanner-island">
      <p id="formatted">{fmt(amount())}</p>
      <p id="division">{ratio}</p>
      <p id="paren-div">{pct}</p>
      <p id="combined">{label}</p>
    </section>
  );
}
`;

describe("Gate 41 B4: .tix script scanner handles regex literals, division after ), and comments with ')'", () => {
  it("parses, analyzes, generates CSR and SSR without scanner confusion", () => {
    const ast = parse(islandRegexAndDivision, { filename: "ScannerIsland.tix" });
    const desc = analyze(ast, { filename: "ScannerIsland.tix", source: islandRegexAndDivision });
    const csr = generate(desc, { filename: "ScannerIsland.tix", source: islandRegexAndDivision });
    const ssr = compileToSsr(desc, undefined, { filename: "ScannerIsland.tix", source: islandRegexAndDivision });
    assert.ok(csr.js.includes("\\B(?=(\\d{3})+(?!\\d))"), "CSR must preserve regex literal");
    assert.ok(ssr.code.includes("scanner-island"), "SSR must emit template");
  });

  describe("real-browser CDP execution", { skip: browserSkipReason }, () => {
    let browser;
    let server;
    let tmpDir;

    before(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-gate41-b4-cdp-"));
      fs.mkdirSync(path.join(tmpDir, "src/islands"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "b4-cdp", type: "module" }));
      fs.writeFileSync(
        path.join(tmpDir, "index.html"),
        '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>'
      );
      fs.writeFileSync(path.join(tmpDir, "src/islands/ScannerIsland.tix"), islandRegexAndDivision);
      fs.writeFileSync(
        path.join(tmpDir, "src/main.ts"),
        [
          'import { mount } from "@dotmix/runtime";',
          'import ScannerIsland from "./islands/ScannerIsland.tix";',
          'const root = document.getElementById("root")!;',
          "mount(() => ScannerIsland({ initial: 12000 }), root);"
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

    it("renders expected formatted regex, division, and paren-division results in browser DOM", async () => {
      const page = await browser.newPage();
      await page.goto(`${server.url}/`);
      await page.waitForSelector("#combined");

      const dom = await page.evaluate(() => ({
        formatted: document.getElementById("formatted")?.textContent,
        division: document.getElementById("division")?.textContent,
        parenDiv: document.getElementById("paren-div")?.textContent,
        combined: document.getElementById("combined")?.textContent
      }));

      assert.deepEqual(dom, {
        formatted: "12 000",
        division: "20",
        parenDiv: "3600",
        combined: "val=3 600/20"
      });
    });
  });
});

