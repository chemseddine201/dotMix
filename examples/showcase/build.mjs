import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "src");
const distDir = path.join(__dirname, "dist");
const runtimeUrl = pathToFileURL(
  path.resolve(__dirname, "../../packages/runtime/dist/index.js")
).href;
const routerUrl = pathToFileURL(
  path.resolve(__dirname, "../../packages/router/dist/index.js")
).href;

function scanSourceFiles(dir, base = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      result.push(...scanSourceFiles(path.join(dir, entry.name), rel));
    } else if (entry.name.endsWith(".mix") || entry.name.endsWith(".tix")) {
      result.push(rel);
    }
  }
  return result;
}

export function buildShowcase(options = {}) {
  const outDir = options.outDir ?? distDir;
  fs.mkdirSync(outDir, { recursive: true });

  const files = scanSourceFiles(srcDir).sort();
  const compiledArtifacts = new Map();

  for (const file of files) {
    const fullPath = path.join(srcDir, file);
    const source = fs.readFileSync(fullPath, "utf8");
    const ast = parse(source, { filename: file });
    const descriptor = analyze(ast, {
      filename: file,
      source,
      throwOnError: true
    });

    if (file.endsWith(".tix")) {
      const tc = typecheckTix(descriptor, source, { throwOnError: true });
      if (tc.diagnostics.length > 0) {
        throw new Error(`Typecheck failed for ${file}`);
      }
    }

    const codegen = generate(descriptor, {
      filename: file,
      runtimeImportPath: options.runtimeImportPath ?? runtimeUrl,
      sourceMap: true
    });

    const jsFilename = `${file}.js`;
    const jsPath = path.join(outDir, jsFilename);
    fs.mkdirSync(path.dirname(jsPath), { recursive: true });
    fs.writeFileSync(jsPath, codegen.js, "utf8");

    if (codegen.css) {
      fs.writeFileSync(path.join(outDir, `${file}.css`), codegen.css, "utf8");
    }
    if (codegen.map) {
      fs.writeFileSync(
        path.join(outDir, `${jsFilename}.map`),
        JSON.stringify(codegen.map, null, 2),
        "utf8"
      );
    }

    compiledArtifacts.set(file, {
      file,
      jsPath,
      ast,
      descriptor,
      codegen
    });
  }

  // Also support any helper .js modules if needed
  const plainJsFiles = fs.existsSync(srcDir)
    ? fs.readdirSync(srcDir).filter((f) => f.endsWith(".js"))
    : [];
  for (const f of plainJsFiles) {
    let content = fs.readFileSync(path.join(srcDir, f), "utf8");
    const runtimeTarget = options.runtimeImportPath ?? runtimeUrl;
    const routerTarget = options.routerImportPath ?? (options.runtimeImportPath ? "/router/index.js" : routerUrl);
    content = content
      .replaceAll('from "@mix/runtime"', `from "${runtimeTarget}"`)
      .replaceAll('from "@mix/router"', `from "${routerTarget}"`)
      .replaceAll('from "/runtime/index.js"', `from "${runtimeTarget}"`)
      .replaceAll('from "/router/index.js"', `from "${routerTarget}"`);
    fs.writeFileSync(path.join(outDir, f), content, "utf8");
    compiledArtifacts.set(f, { file: f });
  }

  return compiledArtifacts;
}

if (import.meta.url === pathToFileURL(globalThis.process?.argv?.[1] ?? "").href) {
  const artifacts = buildShowcase();
  globalThis.console.log(`Built ${artifacts.size} Mix/Tix showcase components to ${distDir}`);
}
