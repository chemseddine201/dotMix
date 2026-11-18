/**
 * VS Code Extension Test Suite — editors/vscode-mix & Standalone LSP Daemon
 *
 * Verifies:
 * 1. Extension manifest (package.json): languages, grammars, snippets, commands, configuration
 * 2. TextMate grammar (mix.tmLanguage.json): repository patterns, control flow, dynamic tags, functional components
 * 3. Language configuration (language-configuration.json): comments, brackets, pairs, indentation regexes
 * 4. Code snippets (snippets/mix.snippets.json): schema, prefixes, bodies, and tabstops
 * 5. Extension controller & providers (dist/extension.js): hover, completions, definitions, diagnostics
 * 6. Standalone LSP stdio server (packages/language-server/bin/dotmix-lsp.js): JSON-RPC protocol round-trip
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");
const extDir = path.join(rootDir, "editors/vscode-mix");

describe("VS Code Extension: dotMix (Mix & Tix) Language Support", () => {
  const pkgPath = path.join(extDir, "package.json");
  const mixGrammarPath = path.join(extDir, "syntaxes/mix.tmLanguage.json");
  const tixGrammarPath = path.join(extDir, "syntaxes/tix.tmLanguage.json");
  const configPath = path.join(extDir, "language-configuration.json");
  const snippetsPath = path.join(extDir, "snippets/mix.snippets.json");
  const extensionJsPath = path.join(extDir, "dist/extension.js");

  test("1. Manifest validation (package.json)", () => {
    assert.ok(fs.existsSync(pkgPath), "package.json must exist in editors/vscode-mix");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

    assert.strictEqual(pkg.name, "vscode-mix");
    assert.strictEqual(pkg.publisher, "dotmix");
    assert.strictEqual(pkg.type, "module");
    assert.strictEqual(pkg.main, "./dist/extension.js");
    assert.ok(pkg.engines?.vscode);

    // Languages
    const languages = pkg.contributes?.languages || [];
    assert.strictEqual(languages.length, 2);
    const mixLang = languages.find((l) => l.id === "mix");
    const tixLang = languages.find((l) => l.id === "tix");
    assert.ok(mixLang && mixLang.extensions.includes(".mix"));
    assert.ok(tixLang && tixLang.extensions.includes(".tix"));

    // Grammars
    const grammars = pkg.contributes?.grammars || [];
    assert.ok(grammars.some((g) => g.language === "mix" && g.scopeName === "source.mix"));
    assert.ok(grammars.some((g) => g.language === "tix" && g.scopeName === "source.tix"));

    // Snippets
    const snippets = pkg.contributes?.snippets || [];
    assert.ok(snippets.some((s) => s.language === "mix" && s.path.includes("snippets")));
    assert.ok(snippets.some((s) => s.language === "tix" && s.path.includes("snippets")));

    // Commands
    const commands = pkg.contributes?.commands || [];
    assert.ok(commands.some((c) => c.command === "mix.restartServer"));
    assert.ok(commands.some((c) => c.command === "mix.checkWorkspace"));
    assert.ok(commands.some((c) => c.command === "mix.showOutput"));

    // Configuration
    const props = pkg.contributes?.configuration?.properties || {};
    assert.ok("mix.diagnostics.enable" in props);
    assert.ok("mix.hover.enable" in props);
    assert.ok("mix.completions.enable" in props);
    assert.ok("mix.trace.server" in props);
  });

  test("2. TextMate grammar validation (mix.tmLanguage.json & tix.tmLanguage.json)", () => {
    assert.ok(fs.existsSync(mixGrammarPath), "mix.tmLanguage.json must exist");
    assert.ok(fs.existsSync(tixGrammarPath), "tix.tmLanguage.json must exist");

    const mixGrammar = JSON.parse(fs.readFileSync(mixGrammarPath, "utf-8"));
    const tixGrammar = JSON.parse(fs.readFileSync(tixGrammarPath, "utf-8"));

    assert.strictEqual(mixGrammar.scopeName, "source.mix");
    assert.strictEqual(tixGrammar.scopeName, "source.tix");

    for (const [name, grammar] of [["mix", mixGrammar], ["tix", tixGrammar]]) {
      assert.ok(grammar.repository, `${name} must have repository`);

      // Required repository keys specification
      assert.ok(grammar.repository["control-flow"], `${name} must contain control-flow repo`);
      assert.ok(grammar.repository["dynamic-element"], `${name} must contain dynamic-element repo`);
      assert.ok(grammar.repository["script-tag"], `${name} must contain script-tag repo`);
      assert.ok(grammar.repository["style-tag"], `${name} must contain style-tag repo`);
      assert.ok(grammar.repository["comments"], `${name} must contain comments repo`);
      assert.ok(grammar.repository["interpolations"], `${name} must contain interpolations repo`);
      assert.ok(grammar.repository["html-tags"], `${name} must contain html-tags repo`);
      assert.ok(grammar.repository["functional-js-ts"], `${name} must contain functional-js-ts repo`);

      // Dynamic elements pattern check
      const dynElementPattern = grammar.repository["dynamic-element"].patterns.find((p) =>
        p.match?.includes("<\\/?\\$[a-zA-Z0-9_$.]+")
      );
      assert.ok(dynElementPattern, `${name} must support <$tagName> dynamic element pattern`);

      // Control flow pattern check
      const controlFlowPattern = grammar.repository["control-flow"].patterns.find((p) =>
        p.match?.includes("if|elseif|else|endif|each|endeach")
      );
      assert.ok(controlFlowPattern, `${name} must support clean curly control flow keywords`);

      // Guard against /* in template text being matched as a root-level JS comment
      const rootCommentPatterns = grammar.repository["comments"].patterns || [];
      const hasRootJsBlockComment = rootCommentPatterns.some((p) => p.begin === "/\\*");
      assert.strictEqual(
        hasRootJsBlockComment,
        false,
        `${name} must not have root-level /* block comments that clash with HTML template paths like /reports/*`
      );

      // Verify delegation to source.tsx for full TypeScript/JSX expression & generic support
      const functionalPatterns = grammar.repository["functional-js-ts"].patterns || [];
      const hasTsx = functionalPatterns.some((p) => p.include === "source.tsx");
      assert.ok(hasTsx, `${name} must include source.tsx for full JSX and TypeScript grammar support`);

      // Verify injections into TSX / JSX scopes for dynamic tags and control flow
      assert.ok(grammar.injections, `${name} must define injections for embedding inside JSX`);
    }

    // Verify package.json grammar contribution has embeddedLanguages and unbalancedBracketScopes
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    for (const g of pkg.contributes?.grammars || []) {
      assert.ok(g.embeddedLanguages, `${g.language} must declare embeddedLanguages`);
      assert.strictEqual(g.embeddedLanguages["source.tsx"], "typescriptreact");
      assert.ok(g.unbalancedBracketScopes, `${g.language} must declare unbalancedBracketScopes`);
      assert.ok(
        g.unbalancedBracketScopes.includes("storage.type.function.arrow") ||
        g.unbalancedBracketScopes.includes("storage.type.function.arrow.ts"),
        `${g.language} must mark arrow functions in unbalancedBracketScopes`
      );
    }
  });

  test("3. Language configuration validation (React/Vue-style clean brackets)", () => {
    assert.ok(fs.existsSync(configPath), "language-configuration.json must exist");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    assert.strictEqual(config.comments?.lineComment, "//");
    assert.deepStrictEqual(config.comments?.blockComment, ["/*", "*/"]);

    // React/Vue style brackets: ONLY {}, [], () to prevent < > from clashing with props and arrow functions
    assert.deepStrictEqual(config.brackets, [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"]
    ]);

    // Ensure colorizedBracketPairs is explicitly defined without angle brackets
    assert.deepStrictEqual(config.colorizedBracketPairs, [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"]
    ]);

    // Ensure < > is not in brackets
    const hasAngleBrackets = (config.brackets || []).some(
      ([open, close]) => open === "<" || close === ">"
    );
    assert.strictEqual(hasAngleBrackets, false, "Angle brackets < > must not be in brackets");

    assert.ok(Array.isArray(config.autoClosingPairs));
    assert.ok(Array.isArray(config.surroundingPairs));

    // Indentation regular expressions
    assert.ok(config.indentationRules?.increaseIndentPattern);
    assert.ok(config.indentationRules?.decreaseIndentPattern);

    const incRegex = new RegExp(config.indentationRules.increaseIndentPattern);
    const decRegex = new RegExp(config.indentationRules.decreaseIndentPattern);

    assert.ok(incRegex.test("{if count() > 0}"));
    assert.ok(incRegex.test("{each (item, idx) in items}"));
    assert.ok(incRegex.test("<div class=\"card\">"));
    assert.ok(decRegex.test("{endif}"));
    assert.ok(decRegex.test("{endeach}"));
    assert.ok(decRegex.test("</div>"));
  });

  test("4. Code snippets validation (mix.snippets.json)", () => {
    assert.ok(fs.existsSync(snippetsPath), "mix.snippets.json must exist");
    const snippets = JSON.parse(fs.readFileSync(snippetsPath, "utf-8"));

    const keys = Object.keys(snippets);
    assert.ok(keys.length >= 10, `Expected at least 10 snippets, found ${keys.length}`);

    // Check essential snippets
    const hasTixComp = keys.some((k) => {
      const s = snippets[k];
      return Array.isArray(s.prefix) ? s.prefix.includes("tix-comp") : s.prefix === "tix-comp";
    });
    assert.ok(hasTixComp, "Must provide tix-comp snippet");

    const hasSignal = keys.some((k) => {
      const s = snippets[k];
      return Array.isArray(s.prefix) ? s.prefix.includes("signal") : s.prefix === "signal";
    });
    assert.ok(hasSignal, "Must provide signal snippet");

    const hasIf = keys.some((k) => {
      const s = snippets[k];
      return Array.isArray(s.prefix) ? s.prefix.includes("if") : s.prefix === "if";
    });
    assert.ok(hasIf, "Must provide if snippet");

    const hasEach = keys.some((k) => {
      const s = snippets[k];
      return Array.isArray(s.prefix) ? s.prefix.includes("each") : s.prefix === "each";
    });
    assert.ok(hasEach, "Must provide each snippet");

    const hasCan = keys.some((k) => {
      const s = snippets[k];
      return Array.isArray(s.prefix) ? s.prefix.includes("can") : s.prefix === "can";
    });
    assert.ok(hasCan, "Must provide can snippet");
  });

  test("5. Extension Controller and Provider Integration (dist/extension.js)", async () => {
    assert.ok(fs.existsSync(extensionJsPath), "dist/extension.js must exist");

    class MockUri {
      constructor(str) { this._str = str; }
      static parse(val) { return new MockUri(val); }
      static file(p) { return new MockUri("file:///" + p.replace(/\\/g, "/")); }
      toString() { return this._str; }
    }

    class MockPosition {
      constructor(line, character) {
        this.line = line;
        this.character = character;
      }
    }

    class MockRange {
      constructor(startLineOrPos, startCharOrEndPos, endLine, endChar) {
        if (typeof startLineOrPos === "object" && typeof startCharOrEndPos === "object") {
          this.start = startLineOrPos;
          this.end = startCharOrEndPos;
        } else {
          this.start = new MockPosition(startLineOrPos, startCharOrEndPos);
          this.end = new MockPosition(endLine, endChar);
        }
      }
    }

    class MockLocation {
      constructor(uri, range) {
        this.uri = uri;
        this.range = range;
      }
    }

    const MockDiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
    const MockCompletionItemKind = {
      Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5,
      Class: 6, Interface: 7, Module: 8, Property: 9, Keyword: 13, Snippet: 14,
    };

    class MockDiagnostic {
      constructor(range, message, severity) {
        this.range = range;
        this.message = message;
        this.severity = severity ?? MockDiagnosticSeverity.Error;
        this.source = undefined;
        this.code = undefined;
      }
    }

    class MockMarkdownString {
      constructor(value) { this.value = value || ""; }
    }

    class MockSnippetString {
      constructor(value) { this.value = value || ""; }
    }

    class MockCompletionItem {
      constructor(label, kind) {
        this.label = label;
        this.kind = kind;
        this.detail = undefined;
        this.documentation = undefined;
        this.insertText = undefined;
      }
    }

    class MockHover {
      constructor(contents, range) {
        this.contents = contents;
        this.range = range;
      }
    }

    class MockDiagnosticCollection {
      constructor(name) {
        this.name = name;
        this._map = new Map();
      }
      set(uri, diags) { this._map.set(uri.toString(), diags); }
      get(uri) { return this._map.get(uri.toString()) || []; }
      delete(uri) { this._map.delete(uri.toString()); }
      clear() { this._map.clear(); }
      dispose() { this.clear(); }
    }

    globalThis.__mock_vscode__ = {
      Uri: MockUri,
      Position: MockPosition,
      Range: MockRange,
      Location: MockLocation,
      Diagnostic: MockDiagnostic,
      DiagnosticSeverity: MockDiagnosticSeverity,
      CompletionItemKind: MockCompletionItemKind,
      MarkdownString: MockMarkdownString,
      SnippetString: MockSnippetString,
      CompletionItem: MockCompletionItem,
      Hover: MockHover,
      languages: {
        createDiagnosticCollection: (name) => new MockDiagnosticCollection(name),
        registerHoverProvider: () => ({ dispose: () => {} }),
        registerCompletionItemProvider: () => ({ dispose: () => {} }),
        registerDefinitionProvider: () => ({ dispose: () => {} }),
      },
      workspace: {
        workspaceFolders: [],
        getConfiguration: () => ({
          get: (key, def) => def,
        }),
        findFiles: async () => [],
        openTextDocument: async (uri) => ({
          uri,
          languageId: "mix",
          getText: () => "",
        }),
        onDidChangeTextDocument: () => ({ dispose: () => {} }),
        onDidOpenTextDocument: () => ({ dispose: () => {} }),
        onDidSaveTextDocument: () => ({ dispose: () => {} }),
        onDidCloseTextDocument: () => ({ dispose: () => {} }),
        onDidCreateFiles: () => ({ dispose: () => {} }),
        onDidDeleteFiles: () => ({ dispose: () => {} }),
      },
      window: {
        visibleTextEditors: [],
        createOutputChannel: (name) => ({
          name,
          append: () => {},
          appendLine: () => {},
          clear: () => {},
          show: () => {},
          dispose: () => {},
        }),
        showInformationMessage: async (msg) => msg,
      },
      commands: {
        registerCommand: () => ({ dispose: () => {} }),
      },
    };

    const { DotMixExtensionController, setVsCode } = await import(pathToFileURL(extensionJsPath).href);
    setVsCode(globalThis.__mock_vscode__);

    const controller = new DotMixExtensionController();
    assert.ok(controller, "DotMixExtensionController must instantiate");

    const service = controller.getService();
    assert.ok(service, "Language service must be initialized");

    // Test component source
    const componentSource = `
<script>
  import MetricCard from "./MetricCard.tix";
  const count = signal(42);
</script>

<div class="card">
  <MetricCard value={count} />
  <span>{count()}</span>
</div>
`;
    const uri = "file:///app/src/Dashboard.mix";

    // 5a. Hover Provider
    const countPos = { line: 8, character: 9 };
    const mockDoc = {
      languageId: "mix",
      uri: { toString: () => uri },
      getText: () => componentSource,
    };

    const hover = controller.provideHover(mockDoc, countPos);
    assert.ok(hover, "Hover must resolve for reactive count signal");
    assert.ok(hover.contents?.value?.includes("count"));

    // 5b. Completion Provider
    const completions = controller.provideCompletionItems(mockDoc, countPos);
    assert.ok(completions.length > 0, "Completions must return symbols and keywords");
    assert.ok(completions.some((c) => c.label === "count"), "Expected 'count' in completions");
    assert.ok(completions.some((c) => c.label === "if"), "Expected 'if' keyword in completions");

    // 5c. Definition Provider
    const cardPos = { line: 7, character: 5 }; // on MetricCard
    const def = controller.provideDefinition(mockDoc, cardPos);
    assert.ok(def, "Definition must resolve for <MetricCard /> tag");
    assert.strictEqual(def.uri.toString(), "file:///app/src/MetricCard.tix");

    // 5d. Diagnostics
    controller.updateDiagnostics(mockDoc);
    const diags = controller.getDiagnosticCollection().get(mockDoc.uri);
    assert.ok(Array.isArray(diags), "Diagnostics collection must hold array for document");

    controller.deactivate();
  });

  test("6. Standalone LSP stdio server protocol round-trip (packages/language-server/bin/dotmix-lsp.js)", async () => {
    const lspBinPath = path.join(rootDir, "packages/language-server/bin/dotmix-lsp.js");
    assert.ok(fs.existsSync(lspBinPath), "dotmix-lsp.js must exist");

    const { createLspServer } = await import(pathToFileURL(lspBinPath).href);

    // Create mock stdio streams
    class MockStream extends EventEmitter {
      write(chunk) {
        this.emit("data", Buffer.from(chunk));
        return true;
      }
    }

    const mockIn = new MockStream();
    const mockOut = new MockStream();

    const responses = [];
    mockOut.on("data", (chunk) => {
      const str = chunk.toString("utf-8");
      const parts = str.split("\r\n\r\n");
      for (let i = 1; i < parts.length; i++) {
        const body = parts[i]?.trim();
        if (body) {
          try {
            responses.push(JSON.parse(body));
          } catch {
            // Ignore non-json chunk fragments
          }
        }
      }
    });

    const server = createLspServer(mockIn, mockOut);

    function sendLsp(msg) {
      const json = JSON.stringify(msg);
      const byteLen = Buffer.byteLength(json, "utf-8");
      mockIn.write(`Content-Length: ${byteLen}\r\n\r\n${json}`);
    }

    // 6a. initialize handshake
    sendLsp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { rootUri: "file:///workspace" },
    });

    const initResp = responses.find((r) => r.id === 1);
    assert.ok(initResp, "Server must respond to initialize");
    assert.ok(initResp.result?.capabilities?.hoverProvider);
    assert.ok(initResp.result?.capabilities?.completionProvider);
    assert.ok(initResp.result?.capabilities?.definitionProvider);

    // 6b. textDocument/didOpen
    const docSource = "<script>const status = signal('active');</script><div>{status()}</div>";
    const docUri = "file:///workspace/Status.mix";

    sendLsp({
      jsonrpc: "2.0",
      method: "textDocument/didOpen",
      params: {
        textDocument: {
          uri: docUri,
          languageId: "mix",
          version: 1,
          text: docSource,
        },
      },
    });

    // Verify publishDiagnostics was emitted
    const diagNotif = responses.find(
      (r) => r.method === "textDocument/publishDiagnostics" && r.params?.uri === docUri
    );
    assert.ok(diagNotif, "Server must publish diagnostics on document open");

    // 6c. textDocument/hover
    sendLsp({
      jsonrpc: "2.0",
      id: 2,
      method: "textDocument/hover",
      params: {
        textDocument: { uri: docUri },
        position: { line: 0, character: 15 }, // on 'status'
      },
    });

    const hoverResp = responses.find((r) => r.id === 2);
    assert.ok(hoverResp, "Server must respond to hover request");
    assert.ok(hoverResp.result?.contents?.value?.includes("status"));

    // 6d. textDocument/completion
    sendLsp({
      jsonrpc: "2.0",
      id: 3,
      method: "textDocument/completion",
      params: {
        textDocument: { uri: docUri },
        position: { line: 0, character: 50 },
      },
    });

    const compResp = responses.find((r) => r.id === 3);
    assert.ok(compResp, "Server must respond to completion request");
    assert.ok(compResp.result?.items?.some((i) => i.label === "status"));

    // 6e. shutdown
    sendLsp({
      jsonrpc: "2.0",
      id: 4,
      method: "shutdown",
      params: {},
    });

    const shutdownResp = responses.find((r) => r.id === 4);
    assert.ok(shutdownResp, "Server must respond to shutdown request");

    server.close();
  });
});
