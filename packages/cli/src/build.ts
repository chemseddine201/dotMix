/**
 * @mix/cli — `mix build` (AOT compiler build runner)
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "@mix/compiler-frontend";
import { analyze, projectTypeScript } from "@mix/compiler-semantic";
import { generate } from "@mix/compiler-codegen";

export interface BuildOptions {
  inDir?: string | undefined;
  outDir?: string | undefined;
  silent?: boolean | undefined;
}

export interface BuildResult {
  success: boolean;
  compiledFiles: string[];
}

function findMixFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMixFiles(fullPath));
    } else if (entry.isFile()) {
      if (entry.name.endsWith(".mix") || entry.name.endsWith(".tix")) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

export function build(options: BuildOptions = {}): BuildResult {
  const inDir = path.resolve(options.inDir ?? "src");
  const outDir = path.resolve(options.outDir ?? "dist");
  const files = findMixFiles(inDir);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const compiledFiles: string[] = [];

  for (const file of files) {
    const filename = path.basename(file);
    const source = fs.readFileSync(file, "utf-8");
    const readExternalStyle = (relPath: string): string => {
      const resolved = path.resolve(path.dirname(file), relPath);
      return fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf-8") : "";
    };
    const ast = parse(source, { filename, readFile: readExternalStyle });
    const desc = analyze(ast, { filename, source });
    const codegen = generate(desc, {
      filename,
      resolveStyle: (src: string) => readExternalStyle(src),
    });

    const baseName = filename.replace(/\.(mix|tix)$/, "");
    const jsPath = path.join(outDir, `${baseName}.js`);
    fs.writeFileSync(jsPath, codegen.js, "utf-8");
    compiledFiles.push(jsPath);

    if (codegen.css) {
      const cssPath = path.join(outDir, `${baseName}.css`);
      fs.writeFileSync(cssPath, codegen.css, "utf-8");
      compiledFiles.push(cssPath);
    }

    if (filename.endsWith(".tix")) {
      const proj = projectTypeScript(desc.ast, source, filename);
      const dtsPath = path.join(outDir, `${baseName}.d.ts`);
      fs.writeFileSync(dtsPath, proj.code, "utf-8");
      compiledFiles.push(dtsPath);
    }
  }

  return {
    success: true,
    compiledFiles,
  };
}
