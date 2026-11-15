import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const requireFromTest = createRequire(import.meta.url);
const initTypeScriptPlugin = requireFromTest("../../editors/vscode-mix/typescript-plugin/index.cjs");

const MAIN_SOURCE = [
  'import App from "./App.tix";',
  "const component: (props: Record<string, unknown>) => Node | readonly Node[] = App;",
  "export { component };",
  "",
].join("\n");

const APP_SOURCE = [
  'import "./App.css";',
  'import { signal } from "@dotmix/runtime";',
  "",
  "export default function App() {",
  "  const count = signal(0);",
  "  return <button onClick={() => count.set(count() + 1)}>{count()}</button>;",
  "}",
  "",
].join("\n");

/** A language service host that resolves modules like the TypeScript server does. */
function createLanguageService(projectDirectory) {
  const mainFile = `${projectDirectory}/src/main.ts`;
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
    strict: true,
    noEmit: true,
  };
  const host = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [mainFile],
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) =>
      fs.existsSync(fileName) ? ts.ScriptSnapshot.fromString(fs.readFileSync(fileName, "utf8")) : undefined,
    getCurrentDirectory: () => projectDirectory,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    resolveModuleNameLiterals: (moduleLiterals, containingFile, _redirectedReference, options) =>
      moduleLiterals.map((moduleLiteral) => ts.resolveModuleName(moduleLiteral.text, containingFile, options, ts.sys)),
  };
  const languageService = ts.createLanguageService(host);
  return { host, languageService, mainFile };
}

describe("VS Code extension TypeScript plugin: .tix imports in .ts files", () => {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mix-ts-plugin-")).split(path.sep).join("/");
  fs.mkdirSync(`${projectDirectory}/src`);
  fs.writeFileSync(`${projectDirectory}/src/main.ts`, MAIN_SOURCE);
  fs.writeFileSync(`${projectDirectory}/src/App.tix`, APP_SOURCE);

  it("without the plugin, TypeScript cannot resolve the component import", () => {
    const { languageService, mainFile } = createLanguageService(projectDirectory);
    const diagnosticCodes = languageService.getSemanticDiagnostics(mainFile).map((diagnostic) => diagnostic.code);
    assert.ok(diagnosticCodes.includes(2307), `expected TS2307, got ${diagnosticCodes.join(", ")}`);
  });

  it("with the plugin, the import resolves, type-checks and go-to-definition opens the component", () => {
    const { host, languageService, mainFile } = createLanguageService(projectDirectory);
    const pluginLanguageService = initTypeScriptPlugin({ typescript: ts }).create({ languageServiceHost: host, languageService });

    const diagnostics = pluginLanguageService.getSemanticDiagnostics(mainFile);
    assert.deepEqual(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")), []);

    // Ctrl+click on the import path opens the component file.
    const pathDefinition = pluginLanguageService.getDefinitionAndBoundSpan(mainFile, MAIN_SOURCE.indexOf("./App.tix") + 2);
    assert.ok(pathDefinition?.definitions?.some((definition) => definition.fileName.endsWith("/src/App.tix")));

    // Ctrl+click on the imported name lands on the `export default` line of the real file.
    const nameDefinition = pluginLanguageService.getDefinitionAndBoundSpan(mainFile, MAIN_SOURCE.indexOf("= App;") + 3);
    const componentDefinition = nameDefinition?.definitions?.find((definition) => definition.fileName.endsWith("/src/App.tix"));
    assert.ok(componentDefinition, "the imported name must resolve into App.tix");
    const componentSourceFile = pluginLanguageService.getProgram().getSourceFile(componentDefinition.fileName);
    const definitionLine = componentSourceFile.getLineAndCharacterOfPosition(componentDefinition.textSpan.start).line;
    const exportDefaultLine = APP_SOURCE.slice(0, APP_SOURCE.indexOf("export default")).split("\n").length - 1;
    assert.equal(definitionLine, exportDefaultLine);
  });
});
