/**
 * @mix/cli — `mix build` (AOT compiler build runner)
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@mix/compiler-frontend";
import { analyze, projectTypeScript, transpileSourceModule } from "@mix/compiler-semantic";
import { generate } from "@mix/compiler-codegen";
import { compileCss, preprocessCss } from "@mix/compiler-css";

export interface BuildOptions {
  inDir?: string | undefined;
  outDir?: string | undefined;
  silent?: boolean | undefined;
}

export interface BuildResult {
  success: boolean;
  compiledFiles: string[];
  watchedFiles: string[];
}

interface ScannedSources {
  mixFiles: string[];
  scriptFiles: string[];
  styleFiles: string[];
}

const STYLE_FILE_REGEX = /\.(css|scss|sass|less|styl|stylus|pcss|postcss)$/i;

function scanInputDirectory(dir: string): ScannedSources {
  const mixFiles: string[] = [];
  const scriptFiles: string[] = [];
  const styleFiles: string[] = [];

  if (!fs.existsSync(dir)) {
    return { mixFiles, scriptFiles, styleFiles };
  }

  function walk(current: string): void {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
        continue;
      }
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".mix") || entry.name.endsWith(".tix")) {
          mixFiles.push(fullPath);
        } else if (
          (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) &&
          !entry.name.endsWith(".d.ts")
        ) {
          scriptFiles.push(fullPath);
        } else if (STYLE_FILE_REGEX.test(entry.name)) {
          styleFiles.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return { mixFiles, scriptFiles, styleFiles };
}

export function build(options: BuildOptions = {}): BuildResult {
  const inDir = path.resolve(options.inDir ?? "src");
  const outDir = path.resolve(options.outDir ?? "dist");
  const { mixFiles, scriptFiles, styleFiles } = scanInputDirectory(inDir);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const compiledFiles: string[] = [];
  const watchedFilesSet = new Set<string>();
  const emittedCssPaths = new Set<string>();

  for (const file of mixFiles) {
    watchedFilesSet.add(file);
    const filename = path.basename(file);
    const relPath = path.relative(inDir, file);
    const relBase = relPath.replace(/\.(mix|tix)$/i, "");
    const source = fs.readFileSync(file, "utf-8");
    const readExternalStyle = (relStylePath: string, fromFile?: string): string => {
      const baseDir = fromFile && path.isAbsolute(fromFile)
        ? path.dirname(fromFile)
        : fromFile
          ? path.dirname(path.resolve(path.dirname(file), fromFile))
          : path.dirname(file);
      const resolved = path.resolve(baseDir, relStylePath);
      if (fs.existsSync(resolved)) {
        watchedFilesSet.add(resolved);
        return fs.readFileSync(resolved, "utf-8");
      }
      return "";
    };
    const ast = parse(source, { filename, readFile: (rel) => readExternalStyle(rel) });
    const desc = analyze(ast, { filename, source });
    const codegen = generate(desc, {
      filename,
      resolveStyle: (src: string, fromFile: string) => readExternalStyle(src, fromFile),
    });
    if (codegen.styleDependencies) {
      for (const dep of codegen.styleDependencies) {
        watchedFilesSet.add(dep);
      }
    }

    // Normalize relative .tix.js / .mix.js specifiers to .js so output matches <relBase>.js
    const normalizedJs = codegen.js.replace(/\.(tix|mix)\.js(["'])/g, ".js$2");

    const jsPath = path.join(outDir, `${relBase}.js`);
    fs.mkdirSync(path.dirname(jsPath), { recursive: true });
    fs.writeFileSync(jsPath, normalizedJs, "utf-8");
    compiledFiles.push(jsPath);

    if (codegen.css) {
      const cssPath = path.join(outDir, `${relBase}.css`);
      fs.mkdirSync(path.dirname(cssPath), { recursive: true });
      fs.writeFileSync(cssPath, codegen.css, "utf-8");
      compiledFiles.push(cssPath);
      emittedCssPaths.add(path.resolve(cssPath));
    }

    if (filename.endsWith(".tix")) {
      const proj = projectTypeScript(desc.ast, source, filename);
      const dtsPath = path.join(outDir, `${relBase}.d.ts`);
      fs.mkdirSync(path.dirname(dtsPath), { recursive: true });
      fs.writeFileSync(dtsPath, proj.code, "utf-8");
      compiledFiles.push(dtsPath);
    }
  }

  for (const scriptFile of scriptFiles) {
    const relPath = path.relative(inDir, scriptFile);
    const relBase = relPath.replace(/\.(ts|js)$/i, "");
    const source = fs.readFileSync(scriptFile, "utf-8");
    const jsCode = transpileSourceModule(source, scriptFile.endsWith(".ts"));
    const jsPath = path.join(outDir, `${relBase}.js`);
    fs.mkdirSync(path.dirname(jsPath), { recursive: true });
    fs.writeFileSync(jsPath, jsCode, "utf-8");
    compiledFiles.push(jsPath);
  }

  for (const styleFile of styleFiles) {
    watchedFilesSet.add(styleFile);
    const relPath = path.relative(inDir, styleFile);
    const relBase = relPath.replace(STYLE_FILE_REGEX, "");
    const cssPath = path.resolve(outDir, `${relBase}.css`);
    if (emittedCssPaths.has(cssPath)) {
      continue;
    }
    const rawCss = fs.readFileSync(styleFile, "utf-8");
    if (rawCss.trim().length > 0) {
      const pre = preprocessCss(rawCss, {
        filename: styleFile
      });
      for (const dep of pre.dependencies) {
        watchedFilesSet.add(dep);
      }
      const compiled = compileCss(pre.code, {
        filename: path.basename(styleFile),
        scoped: false
      });
      fs.mkdirSync(path.dirname(cssPath), { recursive: true });
      fs.writeFileSync(cssPath, compiled.code, "utf-8");
      compiledFiles.push(cssPath);
      emittedCssPaths.add(cssPath);
    }
  }

  return {
    success: true,
    compiledFiles,
    watchedFiles: [...watchedFilesSet],
  };
}
