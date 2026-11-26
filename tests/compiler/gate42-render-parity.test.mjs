/* global document */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { compileToSsr } from "../../node_modules/@dotmix/compiler-ssr/dist/index.js";
import { createDevServer } from "../../node_modules/@dotmix/cli/dist/index.js";
import { launchBrowser, browserSkipReason } from "../helpers/cdp-browser.mjs";

const RUN_TYPE_DEF = `export type Run =
  | { readonly type: "text"; readonly value: string }
  | { readonly type: "strong"; readonly value: string }
  | { readonly type: "contact"; readonly field: "whatsapp" | "phone" }
  | { readonly type: "ph"; readonly key: string };`;

function makeFixture(body, { importDirectives = false } = {}) {
  const dirImport = importDirectives
    ? `import { If, ElseIf, Else, Switch, Case, Default } from "@dotmix/runtime/directives";\n`
    : "";
  return `${dirImport}${RUN_TYPE_DEF}

export default function RunView(props: { run: Run }) {
  return (
    <span class="run">
${body}
    </span>
  );
}
`;
}

const FORMS = {
  a: makeFixture(`      {if props.run.type === "text" || props.run.type === "strong"}<b>{props.run.value}</b>{endif}
      {if props.run.type === "contact"}<i>{props.run.field}</i>{endif}
      {if props.run.type === "ph"}<u>{props.run.key}</u>{endif}`),
  b: makeFixture(`      {if props.run.type === "text"}<b>{props.run.value}</b>
      {elseif props.run.type === "strong"}<b>{props.run.value}</b>
      {elseif props.run.type === "contact"}<i>{props.run.field}</i>
      {else}<u>{props.run.key}</u>
      {endif}`),
  c: makeFixture(`      {switch props.run.type}
        {case "text", "strong"}<b>{props.run.value}</b>
        {case "contact"}<i>{props.run.field}</i>
        {default}<u>{props.run.key}</u>
      {endswitch}`),
  d: makeFixture(`      {switch}
        {case if props.run.type === "text" || props.run.type === "strong"}<b>{props.run.value}</b>
        {case if props.run.type === "contact"}<i>{props.run.field}</i>
        {default}<u>{props.run.key}</u>
      {endswitch}`),
  e: makeFixture(
    `      <If condition={props.run.type === "text"}><b>{props.run.value}</b>
        <ElseIf condition={props.run.type === "strong"}><b>{props.run.value}</b></ElseIf>
        <ElseIf condition={props.run.type === "contact"}><i>{props.run.field}</i></ElseIf>
        <Else><u>{props.run.key}</u></Else>
      </If>`,
    { importDirectives: true }
  ),
  f: makeFixture(
    `      <Switch on={props.run.type}>
        <Case is={["text", "strong"]}><b>{props.run.value}</b></Case>
        <Case is="contact"><i>{props.run.field}</i></Case>
        <Default><u>{props.run.key}</u></Default>
      </Switch>`,
    { importDirectives: true }
  )
};

const VARIANTS = [
  { type: "text", value: "hello" },
  { type: "strong", value: "world" },
  { type: "contact", field: "whatsapp" },
  { type: "ph", key: "email_label" }
];

function stripMixComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, "><").trim();
}

function compileSsrRenderer(src, filename) {
  const ast = parse(src, { filename });
  const desc = analyze(ast, { filename, source: src });
  const ssr = compileToSsr(desc, undefined, { filename, source: src, includeHydrationMarkers: true });
  // Strip any runtime imports since these fixtures only use core primitives
  const code = ssr.code
    .replace(/^import\s+[\s\S]*?;\s*$/gm, "")
    .replace(/export function /g, "function ")
    .replace(/export const /g, "const ");
  return new Function(`${code}\nreturn renderToString;`)();
}

describe("Gate 42 T4: SSR and real-browser CSR render parity across (a)-(f)", () => {
  it("SSR HTML without <!--mix:...--> comment markers is identical across all six forms for all 4 Run variants", () => {
    const renderers = Object.fromEntries(
      Object.entries(FORMS).map(([key, src]) => [key, compileSsrRenderer(src, `Form${key.toUpperCase()}.tix`)])
    );

    const expectedByType = {
      text: '<span class="run"><b>hello</b></span>',
      strong: '<span class="run"><b>world</b></span>',
      contact: '<span class="run"><i>whatsapp</i></span>',
      ph: '<span class="run"><u>email_label</u></span>'
    };

    for (const variant of VARIANTS) {
      const outputs = Object.entries(renderers).map(([key, fn]) => [
        key,
        stripMixComments(fn({ run: variant }))
      ]);
      const baseline = outputs[0][1];
      assert.equal(baseline, expectedByType[variant.type]);
      for (const [key, html] of outputs) {
        assert.equal(html, baseline, `SSR mismatch for form (${key}) on variant ${variant.type}`);
      }
    }
  });

  describe("real-browser CDP CSR render parity", { skip: browserSkipReason }, () => {
    let browser;
    let server;
    let tmpDir;

    before(async () => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-gate42-t4-cdp-"));
      fs.mkdirSync(path.join(tmpDir, "src/forms"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "gate42-t4-cdp", type: "module" }));
      fs.writeFileSync(
        path.join(tmpDir, "index.html"),
        '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>'
      );

      for (const [key, src] of Object.entries(FORMS)) {
        fs.writeFileSync(path.join(tmpDir, `src/forms/Form${key.toUpperCase()}.tix`), src);
      }

      const appSrc = `import { createSignal } from "@dotmix/runtime";
import FormA from "./forms/FormA.tix";
import FormB from "./forms/FormB.tix";
import FormC from "./forms/FormC.tix";
import FormD from "./forms/FormD.tix";
import FormE from "./forms/FormE.tix";
import FormF from "./forms/FormF.tix";
import type { Run } from "./forms/FormA.tix";

export default function App() {
  const run = createSignal<Run>({ type: "text", value: "hello" });
  (globalThis as unknown as { __setRun: (r: Run) => void }).__setRun = (next: Run) => run.set(next);
  return (
    <div id="harness">
      <div id="form-a"><FormA run={run()} /></div>
      <div id="form-b"><FormB run={run()} /></div>
      <div id="form-c"><FormC run={run()} /></div>
      <div id="form-d"><FormD run={run()} /></div>
      <div id="form-e"><FormE run={run()} /></div>
      <div id="form-f"><FormF run={run()} /></div>
    </div>
  );
}
`;
      fs.writeFileSync(path.join(tmpDir, "src/App.tix"), appSrc);
      fs.writeFileSync(
        path.join(tmpDir, "src/main.ts"),
        [
          'import { mount } from "@dotmix/runtime";',
          'import App from "./App.tix";',
          'const root = document.getElementById("root")!;',
          "mount(() => App(), root);"
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

    it("updates DOM identically across all six forms through text -> strong -> contact -> ph -> text", async () => {
      const page = await browser.newPage();
      await page.goto(`${server.url}/`);
      await page.waitForSelector("#form-f span.run");

      const sequence = [
        { variant: null, expected: '<span class="run"><b>hello</b></span>' },
        { variant: { type: "strong", value: "world" }, expected: '<span class="run"><b>world</b></span>' },
        { variant: { type: "contact", field: "whatsapp" }, expected: '<span class="run"><i>whatsapp</i></span>' },
        { variant: { type: "ph", key: "email_label" }, expected: '<span class="run"><u>email_label</u></span>' },
        { variant: { type: "text", value: "again" }, expected: '<span class="run"><b>again</b></span>' }
      ];

      for (const step of sequence) {
        if (step.variant !== null) {
          await page.evaluate((next) => {
            globalThis.__setRun(next);
          }, step.variant);
        }

        const doms = await page.evaluate(() => {
          const stripComments = (el) => {
            const clone = el.cloneNode(true);
            const walkComments = (node) => {
              for (const child of [...node.childNodes]) {
                if (child.nodeType === 8) child.remove();
                else walkComments(child);
              }
            };
            walkComments(clone);
            return clone.innerHTML.replace(/>\s+</g, "><").trim();
          };
          return {
            a: stripComments(document.getElementById("form-a")),
            b: stripComments(document.getElementById("form-b")),
            c: stripComments(document.getElementById("form-c")),
            d: stripComments(document.getElementById("form-d")),
            e: stripComments(document.getElementById("form-e")),
            f: stripComments(document.getElementById("form-f"))
          };
        });

        for (const [key, html] of Object.entries(doms)) {
          assert.equal(html, step.expected, `CSR DOM mismatch for form (${key}) at expected ${step.expected}`);
        }
      }
      assert.deepEqual(page.getConsoleErrors(), []);
    });
  });
});

