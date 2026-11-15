import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  createRequestContext,
  createSsrHeadCollector,
  createSsrStackCollector,
  escapeJsonForScript,
  extractPartialRegion,
  getActiveRequestContext,
  injectHeadAndStacks,
  renderToStream,
  renderToString,
  serializeJsonScriptTag
} from "../../packages/server-node/dist/index.js";
import {
  build,
  parseCliArguments
} from "../../packages/cli/dist/index.js";
import {
  lintCommand,
  lintSource,
  runLint
} from "../../packages/cli/dist/commands/lint.js";
import { mix as createMixVitePlugin } from "../../packages/vite-plugin/dist/index.js";
import { MixLanguageService } from "../../packages/language-server/dist/index.js";
import {
  ATTRIBUTE_DIRECTIVE_SPECS,
  DIRECTIVE_SPECS
} from "../../packages/compiler-semantic/dist/index.js";

describe("SSR directives server adapter, CLI mode/lint, and LSP directive tooling", () => {
  it("ssr request context: reads session keys and supplies consistent per-request csrf token", () => {
    const context = createRequestContext({
      session: { flash: "Saved!", userId: 42 },
      csrfToken: "csrf-secret-token"
    });

    assert.strictEqual(context.session("flash"), "Saved!");
    assert.strictEqual(context.session("userId"), 42);
    assert.strictEqual(context.session("missing"), undefined);
    assert.strictEqual(context.csrfToken(), "csrf-secret-token");

    const generatedContext = createRequestContext({
      session: (key) => (key === "theme" ? "dark" : undefined)
    });
    const firstToken = generatedContext.csrfToken();
    const secondToken = generatedContext.csrfToken();
    assert.ok(firstToken.length >= 32);
    assert.strictEqual(firstToken, secondToken);
    assert.strictEqual(generatedContext.session("theme"), "dark");

    let activeTokenInsideRender = "";
    const html = renderToString(
      (_props, ssrCtx) => {
        const active = getActiveRequestContext();
        activeTokenInsideRender = active ? active.csrfToken() : "";
        return `<p data-flash="${String(ssrCtx?.session("flash") ?? "")}">${ssrCtx?.csrfToken()}</p>`;
      },
      { request: context }
    );

    assert.strictEqual(activeTokenInsideRender, "csrf-secret-token");
    assert.strictEqual(html, '<p data-flash="Saved!">csrf-secret-token</p>');
  });

  it("ssr json escaping: escapes </script, <!--, U+2028, and U+2029 inside script tags while preserving JSON.parse round-trip", () => {
    const payload = {
      closingLower: "</script><script>alert(1)</script>",
      closingMixed: "</ScRiPt>",
      htmlComment: "<!-- injected -->",
      lineSep: "line1\u2028line2",
      paraSep: "para1\u2029para2",
      nested: { count: 3 }
    };

    const scriptTag = serializeJsonScriptTag("app-state", payload);
    assert.ok(scriptTag.startsWith('<script id="app-state" type="application/json">'));
    assert.ok(scriptTag.endsWith("</script>"));

    const innerStart = scriptTag.indexOf(">") + 1;
    const innerEnd = scriptTag.lastIndexOf("</script>");
    const innerJson = scriptTag.slice(innerStart, innerEnd);

    assert.strictEqual(innerJson.toLowerCase().includes("</script"), false);
    assert.strictEqual(innerJson.includes("<!--"), false);
    assert.strictEqual(innerJson.includes("\u2028"), false);
    assert.strictEqual(innerJson.includes("\u2029"), false);

    const parsedBack = JSON.parse(innerJson);
    assert.deepStrictEqual(parsedBack, payload);

    const directEscaped = escapeJsonForScript('{"raw":"</SCRIPT><!--"}');
    assert.strictEqual(directEscaped.toLowerCase().includes("</script"), false);
    assert.strictEqual(directEscaped.includes("<!--"), false);
    assert.deepStrictEqual(JSON.parse(directEscaped), { raw: "</SCRIPT><!--" });
  });

  it("ssr partial rendering: renderToString with partial isolates only the named partial region", () => {
    const appModule = {
      renderToString(props) {
        const title = String(props?.title ?? "Default");
        return [
          "<!--mix:partial:header--><header>Site Header</header><!--/mix:partial:header-->",
          `<!--mix:partial:task-row--><li class="task-row">${title}</li><!--/mix:partial:task-row-->`,
          "<!--mix:partial:footer--><footer>Site Footer</footer><!--/mix:partial:footer-->"
        ].join("");
      }
    };

    const partialHtml = renderToString(appModule, {
      partial: "task-row",
      props: { title: "Ship Gate" }
    });
    assert.strictEqual(partialHtml, '<li class="task-row">Ship Gate</li>');

    const missingHtml = renderToString(appModule, { partial: "nonexistent" });
    assert.strictEqual(missingHtml, "");

    const nestedSource =
      "<!--mix:partial:outer-->before<!--mix:partial:outer-->inner<!--/mix:partial:outer-->after<!--/mix:partial:outer-->";
    assert.strictEqual(
      extractPartialRegion(nestedSource, "outer"),
      "before<!--mix:partial:outer-->inner<!--/mix:partial:outer-->after"
    );
  });

  it("ssr head deduplication: title is last-wins and meta/link deduplicate in buffered and streamed output", async () => {
    const headCollector = createSsrHeadCollector();
    const stackCollector = createSsrStackCollector();

    const app = {
      renderToString(_props, ssrCtx) {
        ssrCtx?.head.addTitle("Initial Title");
        ssrCtx?.head.addTitle("Final Title");
        ssrCtx?.head.addMeta({ name: "description", content: "Old description" });
        ssrCtx?.head.addMeta({ name: "description", content: "Updated description" });
        ssrCtx?.head.addMeta({ property: "og:title", content: "Mix App" });
        ssrCtx?.head.addMeta({ "http-equiv": "refresh", content: "30" });
        ssrCtx?.head.addLink({ rel: "canonical", href: "/tasks/7" });
        ssrCtx?.head.addLink({ rel: "canonical", href: "/tasks/7" });
        return "<!DOCTYPE html><html><head><!--mix:head--></head><body><main>Body</main></body></html>";
      },
      async *renderToStream(_props, _onChunk, ssrCtx) {
        yield "<!DOCTYPE html><html><head><!--mix:head--></head><body>";
        ssrCtx?.head.addTitle("Initial Title");
        ssrCtx?.head.addTitle("Final Title");
        ssrCtx?.head.addMeta({ name: "description", content: "Old description" });
        ssrCtx?.head.addMeta({ name: "description", content: "Updated description" });
        ssrCtx?.head.addLink({ rel: "canonical", href: "/tasks/7" });
        ssrCtx?.head.addLink({ rel: "canonical", href: "/tasks/7" });
        yield "<main>Streamed Body</main></body></html>";
      }
    };

    const buffered = renderToString(app, { headCollector, stackCollector });
    assert.ok(buffered.includes("<title>Final Title</title>"));
    assert.strictEqual(buffered.includes("Initial Title"), false);
    assert.ok(buffered.includes('<meta name="description" content="Updated description" />'));
    assert.strictEqual(buffered.includes("Old description"), false);
    assert.strictEqual(buffered.split('<link rel="canonical" href="/tasks/7" />').length - 1, 1);

    let streamed = "";
    for await (const chunk of renderToStream(app)) {
      streamed += chunk;
    }
    assert.ok(streamed.includes("<title>Final Title</title>"));
    assert.strictEqual(streamed.includes("Initial Title"), false);
    assert.ok(streamed.includes('<meta name="description" content="Updated description" />'));
    assert.strictEqual(streamed.split('<link rel="canonical" href="/tasks/7" />').length - 1, 1);
  });

  it("ssr stacks: renders prepends before pushes in order and deduplicates once entries in buffered and streamed HTML", async () => {
    const head = createSsrHeadCollector();
    const stacks = createSsrStackCollector();

    stacks.push("scripts", '<script src="/push-1.js"></script>');
    stacks.prepend("scripts", '<script src="/prepend-1.js"></script>');
    stacks.push("scripts", '<script src="/chart.js"></script>', "chart-lib");
    stacks.push("scripts", '<script src="/chart-dup.js"></script>', "chart-lib");
    stacks.prepend("scripts", '<script src="/prepend-2.js"></script>');
    stacks.push("scripts", '<script src="/push-2.js"></script>');

    const rawTemplate = "<html><body><div>Content</div><!--mix:stack:scripts--></body></html>";
    const injected = injectHeadAndStacks(rawTemplate, head, stacks);
    const expectedScripts = [
      '<script src="/prepend-1.js"></script>',
      '<script src="/prepend-2.js"></script>',
      '<script src="/push-1.js"></script>',
      '<script src="/chart.js"></script>',
      '<script src="/push-2.js"></script>'
    ].join("");
    assert.strictEqual(
      injected,
      `<html><body><div>Content</div>${expectedScripts}</body></html>`
    );

    const streamApp = {
      renderToString: () => rawTemplate,
      async *renderToStream(_props, _onChunk, ssrCtx) {
        yield "<html><body>";
        ssrCtx?.stacks.push("scripts", '<script src="/a.js"></script>');
        ssrCtx?.stacks.prepend("scripts", '<script src="/first.js"></script>');
        ssrCtx?.stacks.push("scripts", '<script src="/once.js"></script>', "vendor-once");
        ssrCtx?.stacks.push("scripts", '<script src="/once-ignored.js"></script>', "vendor-once");
        yield "<div>Streamed</div><!--mix:stack:scripts--></body></html>";
      }
    };

    let streamedHtml = "";
    for await (const chunk of renderToStream(streamApp)) {
      streamedHtml += chunk;
    }
    assert.strictEqual(
      streamedHtml,
      '<html><body><div>Streamed</div><script src="/first.js"></script><script src="/a.js"></script><script src="/once.js"></script></body></html>'
    );
  });

  it("ssr csrf and method inputs: renders hidden _token and _method fields via RequestContext", () => {
    const requestContext = createRequestContext({ csrfToken: "csrf-form-999" });
    const html = renderToString(
      (_props, ssrCtx) => {
        const token = ssrCtx?.csrfToken() ?? "";
        return `<form method="post"><input type="hidden" name="_token" value="${token}" /><input type="hidden" name="_method" value="PUT" /></form>`;
      },
      { request: requestContext }
    );

    assert.ok(html.includes('<input type="hidden" name="_token" value="csrf-form-999" />'));
    assert.ok(html.includes('<input type="hidden" name="_method" value="PUT" />'));
  });

  it("cli args and vite plugin: parses --mode and --template-style and forwards mode through vite configResolved", () => {
    const parsedBuild = parseCliArguments(["build", "--mode", "staging"]);
    assert.strictEqual(parsedBuild.command, "build");
    assert.strictEqual(parsedBuild.values.mode, "staging");

    const parsedLint = parseCliArguments(["lint", "--template-style", "blocks"]);
    assert.strictEqual(parsedLint.command, "lint");
    assert.strictEqual(parsedLint.values.templateStyle, "blocks");

    const plugin = createMixVitePlugin();
    assert.strictEqual(typeof plugin.configResolved, "function");
    plugin.configResolved({ mode: "production" });
  });

  it("cli build mode elimination: strips inactive dev and dump branches when building in production mode", () => {
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cli-mode-"));
    const srcDir = path.join(fixtureDir, "src");
    const outDir = path.join(fixtureDir, "dist");
    fs.mkdirSync(srcDir, { recursive: true });

    const componentSource = [
      "<script>",
      "  const label = signal('ok');",
      "</script>",
      "<div>",
      "  {dev}<span>DEV_ONLY_MARKER</span>{enddev}",
      "  {production}<span>PROD_ONLY_MARKER</span>{endproduction}",
      "  {dump label()}",
      "</div>"
    ].join("\n");

    fs.writeFileSync(path.join(srcDir, "main.mix"), componentSource, "utf-8");

    try {
      const prodBuild = build({
        inDir: srcDir,
        outDir,
        mode: "production",
        minify: false,
        silent: true
      });
      assert.strictEqual(prodBuild.success, true);

      // The client build emits hashed modules; the import map of index.html names the entry file.
      const indexHtml = fs.readFileSync(path.join(outDir, "index.html"), "utf-8");
      const importMapStart = indexHtml.indexOf('<script type="importmap">') + '<script type="importmap">'.length;
      const importMap = JSON.parse(indexHtml.slice(importMapStart, indexHtml.indexOf("</script>", importMapStart)));
      const hashedEntryUrl = importMap.imports["/assets/main.js"];
      assert.ok(hashedEntryUrl, "The import map must list /assets/main.js");
      const emittedJs = fs.readFileSync(path.join(outDir, ...hashedEntryUrl.slice(1).split("/")), "utf-8");
      assert.strictEqual(emittedJs.includes("DEV_ONLY_MARKER"), false);
      assert.ok(emittedJs.includes("PROD_ONLY_MARKER"));
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it("cli lint template-style: rejects disallowed directive forms at their exact source span", async () => {
    const blockSource = [
      "<script>",
      "  const ready = signal(true);",
      "</script>",
      "<section>",
      "  {if ready()}<span>Ready</span>{endif}",
      "</section>"
    ].join("\n");

    const blockIssuesInComponentsMode = lintSource(blockSource, "BlockExample.mix", "components");
    const blockStyleIssues = blockIssuesInComponentsMode.filter((issue) => issue.rule === "template-style");
    assert.strictEqual(blockStyleIssues.length, 1);
    assert.strictEqual(blockStyleIssues[0].severity, "error");
    assert.strictEqual(blockStyleIssues[0].line, 5);
    assert.strictEqual(blockStyleIssues[0].col, 3);

    assert.strictEqual(
      lintSource(blockSource, "BlockExample.mix", "blocks").filter((issue) => issue.rule === "template-style").length,
      0
    );
    assert.strictEqual(
      lintSource(blockSource, "BlockExample.mix", "hybrid").filter((issue) => issue.rule === "template-style").length,
      0
    );

    const componentSource = [
      "<script>",
      '  import { If } from "@dotmix/runtime/directives";',
      '  import { Can } from "@dotmix/runtime/permissions";',
      "  const ready = signal(true);",
      "  const task = { id: 1 };",
      "</script>",
      "<section>",
      "  <If condition={ready()}><span>Ready</span></If>",
      '  <Can I="read" this={task}><span>Allowed</span></Can>',
      "</section>"
    ].join("\n");

    const compIssuesInBlocksMode = lintSource(componentSource, "ComponentExample.mix", "blocks");
    const compStyleIssues = compIssuesInBlocksMode.filter((issue) => issue.rule === "template-style");
    assert.strictEqual(compStyleIssues.length, 1);
    assert.strictEqual(compStyleIssues[0].severity, "error");
    assert.strictEqual(compStyleIssues[0].line, 8);
    assert.strictEqual(compStyleIssues[0].col, 3);

    const lintFixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-cli-lint-style-"));
    fs.writeFileSync(path.join(lintFixtureDir, "App.mix"), blockSource, "utf-8");
    try {
      const lintResult = runLint(lintFixtureDir, false, "components");
      assert.strictEqual(lintResult.success, false);
      assert.strictEqual(lintResult.issues.some((issue) => issue.rule === "template-style"), true);

      const exitCode = await lintCommand({
        command: "lint",
        positional: [lintFixtureDir],
        values: { templateStyle: "components", silent: true }
      });
      assert.strictEqual(exitCode, 1);
    } finally {
      fs.rmSync(lintFixtureDir, { recursive: true, force: true });
    }
  });

  it("language server directives: generates completions and hover dynamically from the directive registry", () => {
    const service = new MixLanguageService();
    const text = [
      "<script>",
      '  import { Switch, Case, Default } from "@dotmix/runtime/directives";',
      "</script>",
      "<Switch on={status()}>",
      '  <Case is="loading"><span>Loading</span></Case>',
      "</Switch>",
      "{if ready()}<span>Ok</span>{endif}",
      '<button title="Save" title:if={canSave()}>Save</button>'
    ].join("\n");
    const fileUri = pathToFileURL(path.join(process.cwd(), "Sample.mix")).href;

    const completionItems = service.doComplete(fileUri, text, { line: 3, character: 8 });
    const completionLabels = new Set(completionItems.map((item) => item.label));

    for (const spec of DIRECTIVE_SPECS) {
      assert.ok(completionLabels.has(spec.blockOpen), `Missing block opener completion: ${spec.blockOpen}`);
      assert.ok(completionLabels.has(spec.componentName), `Missing component completion: ${spec.componentName}`);
    }
    for (const attrSpec of ATTRIBUTE_DIRECTIVE_SPECS) {
      assert.ok(completionLabels.has(attrSpec.id), `Missing attribute directive completion: ${attrSpec.id}`);
    }

    const switchHover = service.doHover(fileUri, text, { line: 3, character: 2 });
    assert.ok(switchHover);
    assert.ok(switchHover.contents.value.includes("Switch"));

    const onPropHover = service.doHover(fileUri, text, { line: 3, character: 9 });
    assert.ok(onPropHover);
    assert.ok(onPropHover.contents.value.includes("Switch.on"));

    const ifBlockHover = service.doHover(fileUri, text, { line: 6, character: 2 });
    assert.ok(ifBlockHover);
    assert.ok(ifBlockHover.contents.value.includes("If"));

    const attrModHover = service.doHover(fileUri, text, { line: 7, character: 23 });
    assert.ok(attrModHover);
    assert.ok(attrModHover.contents.value.includes("attr:if"));
  });
});
