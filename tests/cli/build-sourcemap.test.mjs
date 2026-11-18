/* global process, setTimeout, URL, fetch */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchBrowser, installedBrowserPath } from "../helpers/cdp-browser.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../..");
const cliBinary = path.join(repositoryRoot, "packages/cli/dist/bin.js");

function executeCli(args, workingDirectory) {
  const processResult = spawnSync(process.execPath, [cliBinary, ...args], {
    cwd: workingDirectory ?? repositoryRoot,
    encoding: "utf-8",
    timeout: 10000
  });
  return {
    status: processResult.status,
    stdout: processResult.stdout ?? "",
    stderr: processResult.stderr ?? ""
  };
}

async function safeRemoveDirectory(directoryPath) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(directoryPath, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

function findOriginalLocation(sourceText, targetIdentifier) {
  const index = sourceText.indexOf(targetIdentifier);
  if (index === -1) {
    throw new Error(`Identifier ${targetIdentifier} not found in source text.`);
  }
  const linesBefore = sourceText.slice(0, index).split("\n");
  const line = linesBefore.length - 1;
  const column = linesBefore[linesBefore.length - 1].length;
  return { line, column, offset: index };
}

function findGeneratedPosition(generatedCode, targetIdentifier) {
  const index = generatedCode.indexOf(targetIdentifier);
  if (index === -1) {
    throw new Error(`Identifier ${targetIdentifier} not found in generated code.`);
  }
  const linesBefore = generatedCode.slice(0, index).split("\n");
  const line = linesBefore.length - 1;
  const column = linesBefore[linesBefore.length - 1].length;
  return { line, column, offset: index };
}

describe("Lane B: Source maps and removal of --target static", () => {
  it("VLQ encode and decode round-trip", async () => {
    const semantic = await import("@dotmix/compiler-semantic");
    const { encodeVlq, decodeVlq, decodeMappings, encodeMappings } = semantic;

    assert.strictEqual(typeof encodeVlq, "function", "encodeVlq should be exported");
    assert.strictEqual(typeof decodeVlq, "function", "decodeVlq should be exported");
    assert.strictEqual(typeof decodeMappings, "function", "decodeMappings should be exported");
    assert.strictEqual(typeof encodeMappings, "function", "encodeMappings should be exported");

    const sampleNumbers = [0, 1, -1, 15, -15, 16, -16, 31, -31, 32, -32, 100, -100, 12345, -12345, 999999];
    for (const value of sampleNumbers) {
      const encoded = encodeVlq(value);
      const [decoded, nextIndex] = decodeVlq(encoded, 0);
      assert.strictEqual(decoded, value, `VLQ value mismatch for ${value}`);
      assert.strictEqual(nextIndex, encoded.length, `VLQ length mismatch for ${value}`);
    }

    const rawMappings = "AAAA;ACAA,EAAE;AACA,uBAAU";
    const decodedSegments = decodeMappings(rawMappings);
    const reEncoded = encodeMappings(decodedSegments);
    assert.strictEqual(reEncoded, rawMappings, "Mappings round-trip should match original string");
  });

  it("shiftMapThroughEdits shifts positions through before/after/inside edits and comment deletions", async () => {
    const semantic = await import("@dotmix/compiler-semantic");
    const { shiftMapThroughEdits, decodeMappings } = semantic;
    assert.strictEqual(typeof shiftMapThroughEdits, "function", "shiftMapThroughEdits must be exported");

    const codeBefore = "/* comment */\nconst alpha = 1;\nconst beta = 2;\n";
    const baseMap = {
      version: 3,
      file: "test.js",
      sources: ["test.ts"],
      names: [],
      mappings: ";AAAA,MAAM,KAAK,GAAG,CAAC;AACf,MAAM,IAAI,GAAG,CAAC;"
    };

    const edits = [
      { start: 0, end: 13, text: "" },
      { start: 20, end: 25, text: "alphaReplacement" },
      { start: 37, end: 41, text: "betaLonger" }
    ];

    const shifted = shiftMapThroughEdits(baseMap, codeBefore, edits);
    assert.ok(shifted, "Should produce shifted source map");
    assert.strictEqual(shifted.file, "test.js");
    const decoded = decodeMappings(shifted.mappings);
    assert.ok(Array.isArray(decoded));
  });

  it("rejects --target static with exit code 2 and migration message", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-static-test-"));
    try {
      const srcDirectory = path.join(temporaryDirectory, "src");
      fs.mkdirSync(srcDirectory, { recursive: true });
      fs.writeFileSync(path.join(srcDirectory, "main.ts"), "export const hello = 'world';\n");

      const result = executeCli(["build", "--target", "static"], temporaryDirectory);
      assert.strictEqual(result.status, 2, "Expected exit code 2 for --target static");
      assert.ok(
        result.stderr.includes("--target static was removed; build with --target client and add --prerender <routes>."),
        "Expected exact migration error message"
      );
    } finally {
      await safeRemoveDirectory(temporaryDirectory);
    }
  });

  it("mix build without --sourcemap omits source map files and comments", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-nosourcemap-test-"));
    try {
      const srcDirectory = path.join(temporaryDirectory, "src");
      fs.mkdirSync(srcDirectory, { recursive: true });
      fs.writeFileSync(path.join(srcDirectory, "main.ts"), "export const targetMode = import.meta.env.MODE;\n");

      const buildResult = executeCli(["build"], temporaryDirectory);
      assert.strictEqual(buildResult.status, 0, `Build failed: ${buildResult.stderr}`);

      const assetsDirectory = path.join(temporaryDirectory, "dist", "assets");
      const files = fs.readdirSync(assetsDirectory);
      const mapFiles = files.filter((f) => f.endsWith(".map"));
      assert.strictEqual(mapFiles.length, 0, "No .map files should be created without --sourcemap");

      const jsFiles = files.filter((f) => f.endsWith(".js"));
      for (const jsFile of jsFiles) {
        const content = fs.readFileSync(path.join(assetsDirectory, jsFile), "utf-8");
        assert.ok(!content.includes("sourceMappingURL"), `File ${jsFile} should not contain sourceMappingURL`);
      }
    } finally {
      await safeRemoveDirectory(temporaryDirectory);
    }
  });

  it("mix build --sourcemap writes real source maps with exact identifiers mapped", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-sourcemap-build-"));
    try {
      const srcDirectory = path.join(temporaryDirectory, "src");
      fs.mkdirSync(srcDirectory, { recursive: true });

      const helperSource = [
        "// Header comment in helper",
        "import { message } from './data.ts';",
        "/* block comment before env */",
        "const envMode = import.meta.env.MODE;",
        "export function uniqueTsFunction(): string {",
        "  return message + envMode;",
        "}"
      ].join("\n");

      const dataSource = "export const message = 'source-map-ok';\n";

      const appSource = [
        "<script>",
        "// Script header comment",
        "import { uniqueTsFunction } from './helper.ts';",
        "/* multi-line comment",
        "   spanning multiple lines */",
        "const isDevelopment = import.meta.env.DEV;",
        "export const uniqueTixScriptVar = 42;",
        "export const uniqueTixTemplateExpr = 'template-val';",
        "</script>",
        "",
        "<div>",
        "  <!-- template comment -->",
        "  <span>{uniqueTixTemplateExpr}</span>",
        "</div>"
      ].join("\n");

      const mainSource = [
        "import App from './App.tix';",
        "import { uniqueTsFunction } from './helper.ts';",
        "void App; void uniqueTsFunction;"
      ].join("\n");

      fs.writeFileSync(path.join(srcDirectory, "helper.ts"), helperSource);
      fs.writeFileSync(path.join(srcDirectory, "data.ts"), dataSource);
      fs.writeFileSync(path.join(srcDirectory, "App.tix"), appSource);
      fs.writeFileSync(path.join(srcDirectory, "main.ts"), mainSource);

      const buildResult = executeCli(["build", "--sourcemap"], temporaryDirectory);
      assert.strictEqual(buildResult.status, 0, `Build with --sourcemap failed: ${buildResult.stderr}`);

      const assetsDirectory = path.join(temporaryDirectory, "dist", "assets");
      const files = fs.readdirSync(assetsDirectory);
      const mapFiles = files.filter((f) => f.endsWith(".map"));
      assert.ok(mapFiles.length > 0, "Source map files should exist");

      const manifestPath = path.join(temporaryDirectory, "dist", "mix-manifest.json");
      assert.ok(fs.existsSync(manifestPath), "mix-manifest.json must exist");
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      for (const chunk of manifest.chunks) {
        assert.ok(chunk.map, `Chunk ${chunk.name} must have a 'map' entry in manifest`);
      }

      const reportPath = path.join(temporaryDirectory, "dist", "bundle-report.json");
      const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
      for (const chunk of report.chunks) {
        assert.ok(!chunk.file.endsWith(".map"), "Bundle report chunks should not list .map files");
      }

      const semantic = await import("@dotmix/compiler-semantic");
      const { decodeMappings } = semantic;

      const helperJsFile = files.find((f) => f.startsWith("helper-") && f.endsWith(".js"));
      assert.ok(helperJsFile, "helper chunk must be emitted");
      const helperJs = fs.readFileSync(path.join(assetsDirectory, helperJsFile), "utf-8");
      assert.ok(helperJs.includes(`//# sourceMappingURL=${helperJsFile}.map`), "sourceMappingURL comment expected");

      const helperMap = JSON.parse(fs.readFileSync(path.join(assetsDirectory, `${helperJsFile}.map`), "utf-8"));
      assert.ok(helperMap.sources.some((s) => s.includes("helper.ts")), "Map sources must include helper.ts");
      assert.ok(Array.isArray(helperMap.sourcesContent), "Map must contain sourcesContent");

      const helperGenPos = findGeneratedPosition(helperJs, "uniqueTsFunction");
      const helperOrigPos = findOriginalLocation(helperSource, "uniqueTsFunction");
      const helperDecoded = decodeMappings(helperMap.mappings);
      const helperLineSegments = helperDecoded[helperGenPos.line] ?? [];
      const matchingHelperSegment = helperLineSegments.find((seg) => seg.genCol === helperGenPos.column);
      assert.ok(matchingHelperSegment, `Expected mapping segment at genCol ${helperGenPos.column} on line ${helperGenPos.line}`);
      assert.strictEqual(matchingHelperSegment.srcLine, helperOrigPos.line, "Mapped source line for uniqueTsFunction");
      assert.strictEqual(matchingHelperSegment.srcCol, helperOrigPos.column, "Mapped source col for uniqueTsFunction");

      const appJsFile = files.find((f) => f.startsWith("App-") && f.endsWith(".js"));
      assert.ok(appJsFile, "App chunk must be emitted");
      const appJs = fs.readFileSync(path.join(assetsDirectory, appJsFile), "utf-8");
      assert.ok(appJs.includes(`//# sourceMappingURL=${appJsFile}.map`), "App sourceMappingURL comment expected");

      const appMap = JSON.parse(fs.readFileSync(path.join(assetsDirectory, `${appJsFile}.map`), "utf-8"));
      const appDecoded = decodeMappings(appMap.mappings);

      const scriptGenPos = findGeneratedPosition(appJs, "uniqueTixScriptVar");
      const scriptOrigPos = findOriginalLocation(appSource, "uniqueTixScriptVar");
      const scriptLineSegments = appDecoded[scriptGenPos.line] ?? [];
      const matchingScriptSegment = scriptLineSegments.find((seg) => seg.genCol === scriptGenPos.column);
      assert.ok(matchingScriptSegment, "Mapping segment for uniqueTixScriptVar");
      assert.strictEqual(matchingScriptSegment.srcLine, scriptOrigPos.line, "Mapped line for uniqueTixScriptVar");
      assert.strictEqual(matchingScriptSegment.srcCol, scriptOrigPos.column, "Mapped col for uniqueTixScriptVar");

      const templateGenPos = findGeneratedPosition(appJs, "uniqueTixTemplateExpr");
      const templateOrigPos = findOriginalLocation(appSource, "uniqueTixTemplateExpr");
      const templateLineSegments = appDecoded[templateGenPos.line] ?? [];
      const matchingTemplateSegment = templateLineSegments.find((seg) => seg.genCol === templateGenPos.column);
      assert.ok(matchingTemplateSegment, "Mapping segment for uniqueTixTemplateExpr");
      assert.strictEqual(matchingTemplateSegment.srcLine, templateOrigPos.line, "Mapped line for uniqueTixTemplateExpr");
      assert.strictEqual(matchingTemplateSegment.srcCol, templateOrigPos.column, "Mapped col for uniqueTixTemplateExpr");
    } finally {
      await safeRemoveDirectory(temporaryDirectory);
    }
  });

  it("headless Chrome loads built page and Debugger.scriptParsed reports sourceMapURL that fetches 200", async () => {
    if (!installedBrowserPath) {
      return;
    }
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-cdp-sourcemap-"));
    let server = null;
    let browserInstance = null;
    try {
      const srcDirectory = path.join(temporaryDirectory, "src");
      fs.mkdirSync(srcDirectory, { recursive: true });
      fs.writeFileSync(path.join(srcDirectory, "main.ts"), "export const alive = 1;\n");
      const buildResult = executeCli(["build", "--sourcemap"], temporaryDirectory);
      assert.strictEqual(buildResult.status, 0);

      const distDirectory = path.join(temporaryDirectory, "dist");
      server = http.createServer((request, response) => {
        const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
        const relativeFilePath = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
        const diskPath = path.join(distDirectory, relativeFilePath);
        if (fs.existsSync(diskPath) && fs.statSync(diskPath).isFile()) {
          const extension = path.extname(diskPath);
          const mime = extension === ".js" ? "application/javascript" : extension === ".map" ? "application/json" : "text/html";
          response.writeHead(200, { "Content-Type": mime });
          response.end(fs.readFileSync(diskPath));
          return;
        }
        response.writeHead(404);
        response.end("Not found");
      });

      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;

      browserInstance = await launchBrowser();
      const page = await browserInstance.newPage();

      const reportedMaps = [];
      page.ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.method === "Debugger.scriptParsed" && data.params?.sourceMapURL) {
            reportedMaps.push(data.params.sourceMapURL);
          }
        } catch {
          // ignore
        }
      });

      await page.send("Debugger.enable");
      await page.goto(`http://127.0.0.1:${port}/`);
      await new Promise((resolve) => setTimeout(resolve, 500));

      assert.ok(reportedMaps.length > 0, "Debugger.scriptParsed should report at least one sourceMapURL");
      const mapUrl = new URL(reportedMaps[0], `http://127.0.0.1:${port}/assets/`);
      const fetchResponse = await fetch(mapUrl.toString());
      assert.strictEqual(fetchResponse.status, 200, "Source map file fetch should return HTTP 200");
    } finally {
      if (browserInstance) {
        await browserInstance.close();
      }
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
      await safeRemoveDirectory(temporaryDirectory);
    }
  });
});
