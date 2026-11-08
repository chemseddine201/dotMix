#!/usr/bin/env node

/**
 * Mix / Tix Showcase Application Build Script
 */

import { readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";

const rootDir = resolve("examples/showcase");
const srcDir = join(rootDir, "src");
const distDir = join(rootDir, "dist");

mkdirSync(distDir, { recursive: true });

console.log("================================================================================");
console.log(" Building Mix / Tix Showcase Application");
console.log("================================================================================");

const startTime = performance.now();
const files = readdirSync(srcDir);
const mixFiles = files.filter((f) => f.endsWith(".mix") || f.endsWith(".tix"));

let combinedCss = `/* Mix / Tix Framework v1.0.0-rc.1 Showcase CSS Bundle */\n\n`;
let compiledCount = 0;

for (const file of mixFiles) {
  const filePath = join(srcDir, file);
  const source = readFileSync(filePath, "utf8");
  const componentName = file.replace(/\.(mix|tix)$/, "");

  const ast = parse(source, file);
  const descriptor = analyze(ast);

  if (descriptor.diagnostics.length > 0) {
    for (const d of descriptor.diagnostics) {
      console.warn(`[${d.severity}] ${file}: ${d.message}`);
    }
  }

  const result = generate(descriptor, {
    componentName,
    filename: file,
    source
  });

  // Write compiled JS
  writeFileSync(join(distDir, `${componentName}.js`), result.code, "utf8");

  // Write compiled CSS
  if (result.css) {
    writeFileSync(join(distDir, `${componentName}.css`), result.css, "utf8");
    combinedCss += `/* --- Component: ${componentName} --- */\n${result.css}\n\n`;
  }

  // Write SourceMap
  if (result.sourceMap) {
    writeFileSync(join(distDir, `${componentName}.js.map`), JSON.stringify(result.sourceMap, null, 2), "utf8");
  }

  compiledCount++;
  console.log(`✓ Compiled: ${file} -> dist/${componentName}.js`);
}

// Copy main.js to dist
const mainSrc = join(srcDir, "main.js");
const mainDist = join(distDir, "main.js");
copyFileSync(mainSrc, mainDist);
console.log(`✓ Copied:   main.js -> dist/main.js`);

// Write concatenated bundle.css
const bundleCssPath = join(distDir, "bundle.css");
writeFileSync(bundleCssPath, combinedCss, "utf8");
console.log(`✓ Bundled:  dist/bundle.css`);

const elapsed = (performance.now() - startTime).toFixed(2);
console.log("--------------------------------------------------------------------------------");
console.log(`Build complete! ${compiledCount} components compiled in ${elapsed}ms.`);
console.log("================================================================================");

