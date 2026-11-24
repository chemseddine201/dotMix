/* global process */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import * as runtime from "../../node_modules/@dotmix/runtime/dist/index.js";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { compileToSsr } from "../../node_modules/@dotmix/compiler-ssr/dist/index.js";
import { encodeMappings } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { generate } from "../../node_modules/@dotmix/compiler-codegen/dist/index.js";
import { decodeSourceMapPosition } from "../../packages/cli/dist/dev-errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const cliBin = path.join(repoRoot, "packages/cli/dist/bin.js");

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

describe("Gate 40 — D-189 Error Boundaries, SSR, Root Safety Net & CLI Frames", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.document = document;
    runtime.setErrorReporter(null);
    runtime.setRootErrorConfig({});
  });

  afterEach(() => {
    runtime.setErrorReporter(null);
    runtime.setRootErrorConfig({});
  });

  it("E2: createErrorBoundary & ErrorBoundary catch render, effect, and event errors and recover on reset()", () => {
    const shouldThrowRender = runtime.signal(true);
    const shouldThrowEffect = runtime.signal(false);
    const host = document.createElement("div");

    const mounted = runtime.mount(() => {
      const wrap = document.createElement("div");
      runtime.createErrorBoundary(
        wrap,
        () => {
          if (shouldThrowRender()) throw new Error("render boom");
          const btn = document.createElement("button");
          btn.id = "trigger-event";
          btn.textContent = "OK";
          runtime.addEventListener(btn, "click", () => {
            throw new Error("handler boom");
          });
          runtime.createEffect(() => {
            if (shouldThrowEffect()) throw new Error("effect boom");
          });
          return [btn];
        },
        (err, reset) => {
          const box = document.createElement("div");
          box.className = "fb";
          const msg = document.createElement("span");
          msg.textContent = `caught:${err().message}`;
          const rbtn = document.createElement("button");
          rbtn.className = "reset-btn";
          rbtn.textContent = "Reset";
          rbtn.addEventListener("click", reset);
          box.append(msg, rbtn);
          return [box];
        }
      );
      return wrap;
    }, host);

    // 1. Render error caught
    assert.ok(host.textContent.includes("caught:render boom"), host.textContent);

    // Recover via reset()
    shouldThrowRender.set(false);
    host.querySelector(".reset-btn").click();
    assert.ok(host.querySelector("#trigger-event"), "Primary subtree recovered after reset()");

    // 2. Event handler error caught
    host.querySelector("#trigger-event").click();
    assert.ok(host.textContent.includes("caught:handler boom"), host.textContent);

    // Recover again
    host.querySelector(".reset-btn").click();
    assert.ok(host.querySelector("#trigger-event"));

    // 3. Reactive effect error caught
    shouldThrowEffect.set(true);
    assert.ok(host.textContent.includes("caught:effect boom"), host.textContent);

    // Recover after clearing effect condition
    shouldThrowEffect.set(false);
    host.querySelector(".reset-btn").click();
    assert.ok(host.querySelector("#trigger-event"));
    mounted.unmount();

    // Component <ErrorBoundary> helper
    const host2 = document.createElement("div");
    const m2 = runtime.mount(() =>
      runtime.ErrorBoundary({
        fallback: (err, reset) => {
          const b = document.createElement("button");
          b.textContent = `EB:${err.message}`;
          b.addEventListener("click", reset);
          return b;
        },
        children: () => { throw new Error("eb-fail"); }
      }),
      host2
    );
    assert.equal(host2.textContent, "EB:eb-fail");
    m2.unmount();
  });

  it("E2: SSR renders fallback HTML when subtree throws inside {try}/{catch}", async () => {
    const src = `<script>function Boom() { throw new Error("ssr-boom"); }</script><main>{try}<p>partial</p><Boom />{catch err}<div class="ssr-fb">SSR:{err.message}</div>{endtry}</main>`;
    const parsed = parse(src, { filename: "SsrTry.tix" });
    const desc = analyze(parsed, { filename: "SsrTry.tix", source: src });
    const ssr = compileToSsr(desc, undefined, { includeHydrationMarkers: true });

    const tmpFile = path.join(os.tmpdir(), `mix-ssr-try-${Date.now()}.mjs`);
    const runtimeUrl = pathToFileURL(path.join(repoRoot, "packages/runtime/dist/index.js")).href;
    const ssrRuntimeUrl = pathToFileURL(path.join(repoRoot, "packages/compiler-ssr/dist/runtime.js")).href;
    const rewritten = ssr.code
      .replaceAll('"@dotmix/runtime"', JSON.stringify(runtimeUrl))
      .replaceAll('"@dotmix/compiler-ssr/runtime"', JSON.stringify(ssrRuntimeUrl));
    fs.writeFileSync(tmpFile, rewritten, "utf-8");
    try {
      const mod = await import(pathToFileURL(tmpFile).href);
      const html = mod.renderToString({});
      assert.ok(html.includes('class="ssr-fb"'), html);
      assert.ok(html.includes("SSR:") && html.includes("ssr-boom"), html);
      assert.ok(!html.includes("<p>partial</p>"), "Partial HTML before throw must be rolled back");
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  it("E3: production root safety net renders localized fallback (ar/fr/en) or custom fallback and calls onError", () => {
    for (const [lang, expected] of [
      ["ar", "حدث خطأ غير متوقع"],
      ["fr", "Une erreur est survenue"],
      ["en", "Something went wrong"]
    ]) {
      document.documentElement.setAttribute("lang", lang);
      const target = document.createElement("div");
      const reported = [];
      const Broken = () => { throw new Error("root-crash"); };
      Broken.__mix_dev = { name: "Broken", file: "src/Broken.tix" };

      runtime.mount(Broken, target, {}, {
        onError: (err, info) => reported.push({ err, info })
      });

      assert.equal(reported.length, 1);
      assert.equal(reported[0].info.source, "mount");
      assert.ok(reported[0].info.componentStack.some((s) => s.includes("Broken")));
      const alertBox = target.querySelector('[role="alert"]');
      assert.ok(alertBox, `Default fallback must have role="alert" for ${lang}`);
      assert.ok(alertBox.textContent.includes(expected), `Expected ${expected}, got ${alertBox.textContent}`);
      assert.ok(alertBox.querySelector("button"), "Default fallback must include reload button");
    }

    // Custom fallback via options
    const target2 = document.createElement("div");
    runtime.mount(() => { throw new Error("custom-fail"); }, target2, {}, {
      fallback: (err) => `CustomFallback:${err.message}`
    });
    assert.equal(target2.textContent, "CustomFallback:custom-fail");
  });

  it("E3/E5: mix build wires mix.config.ts errors.{fallback,report} and emits ZERO mix-error-overlay or /__mix/ in dist/", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-gate40-prod-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "prod-err-app", type: "module", dependencies: { "@dotmix/runtime": "0.4.0" } })
      );
      fs.writeFileSync(
        path.join(tmpDir, "index.html"),
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>App</title></head><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>`
      );
      fs.writeFileSync(
        path.join(tmpDir, "mix.config.ts"),
        `export default { errors: { fallback: "src/ErrorPage.tix", report: "src/report-error.ts" } };\n`
      );
      fs.writeFileSync(
        path.join(tmpDir, "src/ErrorPage.tix"),
        `export default function ErrorPage(props: { error?: unknown }) { return (<div class="custom-err-page">Recovered:{String(props.error)}</div>); }\n`
      );
      fs.writeFileSync(
        path.join(tmpDir, "src/report-error.ts"),
        `export default function reportError(err: unknown) { (globalThis as Record<string, unknown>).__reportedErr = String(err); }\n`
      );
      fs.writeFileSync(
        path.join(tmpDir, "src/App.tix"),
        `export default function App() { return (<main>Hello</main>); }\n`
      );
      fs.writeFileSync(
        path.join(tmpDir, "src/main.ts"),
        `import { mount } from "@dotmix/runtime";\nimport App from "./App.tix";\nmount(App, document.getElementById("root")!);\n`
      );

      const res = spawnSync(process.execPath, [cliBin, "build", "src", "dist", "--clean"], {
        cwd: tmpDir,
        encoding: "utf-8"
      });
      assert.equal(res.status, 0, `mix build failed:\n${res.stdout}\n${res.stderr}`);

      const distFiles = walkFiles(path.join(tmpDir, "dist"));
      assert.ok(distFiles.length > 0);
      let foundConfigHook = false;
      for (const file of distFiles) {
        if (!/\.(js|mjs|html|css|json)$/.test(file)) continue;
        const content = fs.readFileSync(file, "utf-8");
        assert.ok(!content.includes("mix-error-overlay"), `dist file ${file} leaked mix-error-overlay`);
        assert.ok(!content.includes("/__mix/"), `dist file ${file} leaked /__mix/`);
        assert.ok(!content.includes("sourceMappingURL=data:"), `dist file ${file} leaked dev inline sourceMappingURL`);
        if (content.includes("setRootErrorConfig")) foundConfigHook = true;
      }
      assert.ok(foundConfigHook, "Built entry must wire setRootErrorConfig from mix.config.ts errors");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("E4: mix build and mix check print 7-line code frame on errors and exit non-zero", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-gate40-cli-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "src/Broken.tix"),
        [
          "export default function Broken() {",
          "  const items = [{ label: 'A' }, { label: 'B' }];",
          "  const title = 'List';",
          "  return (",
          "    <section>",
          "      <h1>{title}</h1>",
          "      <ul>{each (item, i, item) in items}<li>{item.label}</li>{endeach}</ul>",
          "    </section>",
          "  );",
          "}",
          ""
        ].join("\n")
      );

      const checkRes = spawnSync(process.execPath, [cliBin, "check", "src"], {
        cwd: tmpDir,
        encoding: "utf-8"
      });
      assert.notEqual(checkRes.status, 0, "mix check must exit non-zero on invalid explicit key");
      const combined = `${checkRes.stdout}\n${checkRes.stderr}`;
      assert.ok(combined.includes("MIX_ERR_INVALID_KEY"), combined);
      assert.ok(combined.includes("Broken.tix"), combined);
      assert.ok(combined.includes("^"), "CLI output must include code frame caret");

      // Parse error in mix build prints code frame and exits non-zero
      fs.writeFileSync(
        path.join(tmpDir, "src/SyntaxErr.tix"),
        "export default function SyntaxErr() {\n  const a = 1;\n  const b = 2;\n  return (<div><span>unclosed</div>);\n}\n"
      );
      const buildRes = spawnSync(process.execPath, [cliBin, "build", "src", "dist"], {
        cwd: tmpDir,
        encoding: "utf-8"
      });
      assert.notEqual(buildRes.status, 0, "mix build must exit non-zero on compile error");
      const buildOut = `${buildRes.stdout}\n${buildRes.stderr}`;
      assert.ok(buildOut.includes("SyntaxErr.tix"), buildOut);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("F1: decodeSourceMapPosition enforces exact-line matching, nearest column on same line, and null on unmapped lines", () => {
    const mappings = encodeMappings([
      [{ genCol: 4, sourceIdx: 0, srcLine: 1, srcCol: 2 }],
      [],
      [
        { genCol: 2, sourceIdx: 0, srcLine: 6, srcCol: 0 },
        { genCol: 10, sourceIdx: 0, srcLine: 6, srcCol: 8 },
        { genCol: 20, sourceIdx: 0, srcLine: 6, srcCol: 18 }
      ]
    ]);
    const map = { version: 3, file: "App.tix.js", sources: ["src/App.tix"], names: [], mappings };

    // Exact line & column hit
    assert.deepEqual(decodeSourceMapPosition(map, 1, 5), { line: 2, column: 3 });
    assert.deepEqual(decodeSourceMapPosition(map, 3, 11), { line: 7, column: 9 });

    // Nearest column on the same line (genCol 14 -> 0-based 13, closer to 10 than 20; tie at 15 prefers <= 15 -> 10)
    assert.deepEqual(decodeSourceMapPosition(map, 3, 14), { line: 7, column: 9 });
    assert.deepEqual(decodeSourceMapPosition(map, 3, 16), { line: 7, column: 9 });
    assert.deepEqual(decodeSourceMapPosition(map, 3, 18), { line: 7, column: 19 });

    // No segment on the exact generated line -> null (never guesses earlier line 1)
    assert.equal(decodeSourceMapPosition(map, 2, 1), null);
    assert.equal(decodeSourceMapPosition(map, 99, 1), null);
    assert.equal(decodeSourceMapPosition(map, 0, 1), null);
  });

  it("F1: codegen maps every script statement line accurately for both .tix (TS) and .mix (JS) without inline prod maps", () => {
    for (const [filename, src] of [
      [
        "Sample.tix",
        [
          'import { signal } from "@dotmix/runtime";',
          "interface Row { label: string; }",
          "export default function Sample() {",
          '  const rows = signal<Row[]>([{ label: "A" }]);',
          "  function fail(): void {",
          '    throw new Error("ts-fail");',
          "  }",
          "  return (<button onClick={fail}>{rows().length}</button>);",
          "}",
          ""
        ].join("\n")
      ],
      [
        "Sample.mix",
        [
          'import { signal } from "@dotmix/runtime";',
          "",
          "export default function Sample() {",
          '  const rows = signal([{ label: "A" }]);',
          "  function fail() {",
          '    throw new Error("js-fail");',
          "  }",
          "  return (<button onClick={fail}>{rows().length}</button>);",
          "}",
          ""
        ].join("\n")
      ]
    ]) {
      const parsed = parse(src, { filename });
      const desc = analyze(parsed, { filename, source: src });
      const out = generate(desc, { filename, source: src, mode: "development" });
      assert.ok(out.map, `Missing source map for ${filename}`);
      const genLines = out.code.split("\n");
      const throwLineIdx = genLines.findIndex((l) => l.includes("throw new Error"));
      assert.ok(throwLineIdx >= 0, `Could not find throw line in ${filename}`);
      const throwCol = genLines[throwLineIdx].indexOf("throw") + 1;
      const mapped = decodeSourceMapPosition(out.map, throwLineIdx + 1, throwCol);
      assert.deepEqual(mapped, { line: 6, column: 5 }, `Exact mapping mismatch for ${filename}`);
      assert.ok(!out.code.includes("sourceMappingURL=data:"), "codegen itself must not inline data sourceMappingURL");
    }
  });

  it("G1/G2: every template expression kind maps to its exact original line in TS, JS, and SSR with relative map.file", () => {
    const makeFixture = (isTs) => [
      'import { signal } from "@dotmix/runtime";',
      'import { If, ErrorBoundary } from "@dotmix/runtime/directives";',
      isTs ? "const Badge = (p: { label: string }) => p.label;" : "const Badge = (p) => p.label;",
      "export default function KitchenSink() {",
      '  const user = signal({ profile: { name: "Ada" } });',
      '  const attrExpr = signal("tip");',
      '  const propExpr = signal("badge");',
      "  const isActive = signal(true);",
      '  const textColor = signal("red");',
      "  const condA = signal(true);",
      "  const condB = signal(false);",
      '  const rows = signal([{ slug: "r1", title: "Row1" }]);',
      '  const status = signal("ok");',
      '  const matchVal = signal("ok");',
      "  const condCase = signal(false);",
      '  const reqPromise = signal(Promise.resolve("done"));',
      "  function handleInline() {}",
      "  return (",
      "    <section>",
      "      <p>{user().profile.name}</p>",
      "      <span title={attrExpr()}>a</span>",
      "      <Badge label={propExpr()} />",
      "      <div class:active={isActive()}>c</div>",
      "      <div style:color={textColor()}>s</div>",
      "      <button onClick={() => handleInline()}>go</button>",
      "      {if condA()}<p>A</p>{elseif condB()}<p>B</p>{endif}",
      "      <ul>{each (row, idx, row.slug) in rows()}<li>{row.title}</li>{endeach}</ul>",
      "      {switch status()}{case matchVal()}<b>M</b>{case if condCase()}<b>C</b>{endswitch}",
      "      {await reqPromise()}<p>p</p>{then data}<p>{data}</p>{endawait}",
      "      {try}<i>ok</i>{catch err}<i>{String(err)}</i>{endtry}",
      "      <If condition={condA()}><span>dir-if</span></If>",
      "      <ErrorBoundary fallback={(e) => <span>{String(e())}</span>}><em>eb</em></ErrorBoundary>",
      "    </section>",
      "  );",
      "}",
      ""
    ].join("\n");

    const lineOf = (src, needle) => src.split("\n").findIndex((l) => l.includes(needle)) + 1;

    for (const [isTs, absName, relExpected] of [
      [true, "G:/workspace/app/src/KitchenSink.tix", "src/KitchenSink.tix.js"],
      [false, "G:/workspace/app/src/KitchenSink.mix", "src/KitchenSink.mix.js"]
    ]) {
      const src = makeFixture(isTs);
      const parsed = parse(src, { filename: absName });
      const desc = analyze(parsed, { filename: absName, source: src });
      const out = generate(desc, { filename: absName, source: src, mode: "development" });
      assert.ok(out.map, `Missing map for ${absName}`);
      assert.equal(out.map.file, relExpected, "G2: map.file must be project-relative");
      assert.ok(!/^[a-zA-Z]:/.test(out.map.file), "G2: map.file must not leak drive letter");

      const genLines = out.code.split("\n");
      const checks = [
        ["interpolation", "user().profile.name", "<p>{user().profile.name}</p>"],
        ["attribute", "attrExpr()", "title={attrExpr()}"],
        ["prop", "propExpr()", "label={propExpr()}"],
        ["class:", "isActive()", "class:active={isActive()}"],
        ["style:", "textColor()", "style:color={textColor()}"],
        ["inline handler", "() => handleInline()", "onClick={() => handleInline()}"],
        ["{if}", "condA()", "{if condA()}"],
        ["{elseif}", "condB()", "{elseif condB()}"],
        ["{each} collection", "rows()", "in rows()"],
        ["{each} explicit key", "row.slug", "row.slug)"],
        ["{each} loop interpolation", ".title", "{row.title}"],
        ["{switch}", "status()", "{switch status()}"],
        ["{case} value", "matchVal()", "{case matchVal()}"],
        ["{case if}", "condCase()", "{case if condCase()}"],
        ["{await}", "reqPromise()", "{await reqPromise()}"],
        ["{try}", "__createErrorBoundary", "{try}"]
      ];

      for (const [label, genNeedle, srcNeedle] of checks) {
        const expectedLine = lineOf(src, srcNeedle);
        const gIdx = genLines.findIndex((l, idx) => idx > 20 && l.includes(genNeedle));
        assert.ok(gIdx >= 0, `[${absName}] Generated line for ${label} (${genNeedle}) not found`);
        const gCol = genLines[gIdx].indexOf(genNeedle) + 1;
        const pos = decodeSourceMapPosition(out.map, gIdx + 1, gCol);
        assert.ok(pos, `[${absName}] ${label} at gen line ${gIdx + 1} mapped to null`);
        assert.equal(pos.line, expectedLine, `[${absName}] ${label} mapped to line ${pos.line}, expected ${expectedLine}`);
      }

      // SSR map verification for TS & JS
      const ssr = compileToSsr(desc, undefined, { filename: absName, source: src, mode: "development" });
      assert.ok(ssr.map, `Missing SSR map for ${absName}`);
      assert.equal(ssr.map.file, relExpected, "SSR map.file must be project-relative");
      const ssrLines = ssr.code.split("\n");
      for (const [label, ssrNeedle, srcNeedle] of [
        ["SSR interpolation", "profile.name", "user().profile.name"],
        ["SSR attribute", "attrExpr", "title={attrExpr()}"],
        ["SSR {each} body", ".title", "row.title"],
        ["SSR {if}", "condA", "{if condA()}"]
      ]) {
        const expectedLine = lineOf(src, srcNeedle);
        const sIdx = ssrLines.findIndex((l) => l.includes("__html") || l.includes("if (") ? l.includes(ssrNeedle) : false);
        assert.ok(sIdx >= 0, `[${absName}] SSR line for ${label} not found`);
        const pos = decodeSourceMapPosition(ssr.map, sIdx + 1, ssrLines[sIdx].indexOf(ssrNeedle) + 1);
        assert.ok(pos, `[${absName}] ${label} mapped to null`);
        assert.equal(pos.line, expectedLine, `[${absName}] ${label} mapped to line ${pos.line}, expected ${expectedLine}`);
      }
    }
  });
});
