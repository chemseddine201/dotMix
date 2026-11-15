/**
 * @dotmix/cli — Dev Server Specifier Rewriter, Module Resolution & HTML/CSS Injection
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rewriteJsModuleSpecifiers } from "@dotmix/compiler-semantic";
import { STYLE_FILE_REGEX } from "./scanner.js";
import type { ModuleGraph } from "./module-graph.js";
import { HMR_CLIENT_SCRIPT } from "./hmr-client/client.js";
import { normalizeDriveLetter } from "./normalize-path.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_PACKAGES_DIR = normalizeDriveLetter(path.resolve(__dirname, "../.."));

export const HMR_CLIENT_SOURCE = HMR_CLIENT_SCRIPT;

export function createHotMetaShim(fileId: string): string {
  return `if (typeof import.meta !== "undefined" && !import.meta.hot) {
  import.meta.hot = {
    data: {},
    accept(cb) {
      if (typeof window !== "undefined") {
        window.__mix_hot_boundaries = window.__mix_hot_boundaries || new Map();
        window.__mix_hot_boundaries.set(${JSON.stringify(fileId)}, cb);
      }
    },
    dispose(cb) {
      if (typeof window !== "undefined") {
        window.__mix_hot_disposers = window.__mix_hot_disposers || new Map();
        window.__mix_hot_disposers.set(${JSON.stringify(fileId)}, cb);
      }
    },
    invalidate() {
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    }
  };
}\n`;
}

/**
 * Resolves a project-relative candidate module path to its backing source file on disk,
 * including `.js` -> `.ts`/`.tix`/`.mix` mapping for NodeNext imports and transpiled modules.
 */
export function resolveDevSourceFile(candidateBase: string): string | null {
  const normalizedBase = normalizeDriveLetter(candidateBase);
  const candidates = [normalizedBase];
  if (/\.js$/i.test(normalizedBase)) {
    const stem = normalizedBase.slice(0, -3);
    candidates.push(`${stem}.ts`, `${stem}.tix`, `${stem}.mix`);
  }
  candidates.push(
    `${normalizedBase}.ts`,
    `${normalizedBase}.js`,
    `${normalizedBase}.tix`,
    `${normalizedBase}.mix`,
    path.join(normalizedBase, "index.ts"),
    path.join(normalizedBase, "index.js"),
    path.join(normalizedBase, "index.tix"),
    path.join(normalizedBase, "index.mix")
  );
  for (const candRaw of candidates) {
    const cand = normalizeDriveLetter(candRaw);
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
      return cand;
    }
  }
  return null;
}

/**
 * Rewrites bare `@dotmix/*` specifiers and relative imports in served JS modules for direct browser ES module execution.
 */
export function rewriteModuleImportsForDev(
  code: string,
  fromFileAbs: string | null,
  rootDir: string,
  moduleGraph?: ModuleGraph
): string {
  const normRootDir = normalizeDriveLetter(path.resolve(rootDir));
  const normFromFileAbs = fromFileAbs ? normalizeDriveLetter(path.resolve(fromFileAbs)) : null;

  const rewriteSpec = (spec: string): string => {
    // 1. Virtual ?mix-css module emitted by @dotmix/vite-plugin with an absolute path
    if (spec.includes("?mix-css")) {
      const [filePart, queryPart] = spec.split("?");
      if (filePart && path.isAbsolute(filePart)) {
        const normFilePart = normalizeDriveLetter(filePart);
        const rel = path.relative(normRootDir, normFilePart).split(path.sep).join("/");
        if (moduleGraph && normFromFileAbs) {
          moduleGraph.addEdge(normFromFileAbs, normFilePart);
        }
        return `/${rel}?${queryPart ?? "mix-css=1"}`;
      }
      return spec;
    }

    // 2. Bare @dotmix/<pkg>/<subpath> specifier
    if (spec.startsWith("@dotmix/")) {
      const sub = spec.slice("@dotmix/".length);
      if (sub.endsWith(".js")) {
        return `/@modules/@dotmix/${sub}`;
      }
      return `/@modules/@dotmix/${sub}/index.js`;
    }

    // 3. Relative imports inside project source files
    if ((spec.startsWith("./") || spec.startsWith("../")) && normFromFileAbs) {
      // Normalize compiled .tix.js / .mix.js back to source .tix / .mix in dev server
      const cleanSpec = spec.replace(/\.(tix|mix)\.js$/i, ".$1");
      const baseDir = path.dirname(normFromFileAbs);
      const candidateBase = normalizeDriveLetter(path.resolve(baseDir, cleanSpec));

      if (STYLE_FILE_REGEX.test(cleanSpec)) {
        const rel = path.relative(normRootDir, candidateBase).split(path.sep).join("/");
        if (moduleGraph && normFromFileAbs) {
          moduleGraph.addEdge(normFromFileAbs, candidateBase);
        }
        return `/${rel}?import`;
      }

      const resolvedTarget = resolveDevSourceFile(candidateBase);
      if (resolvedTarget && resolvedTarget.startsWith(normRootDir)) {
        const rel = path.relative(normRootDir, resolvedTarget).split(path.sep).join("/");
        if (moduleGraph && normFromFileAbs) {
          moduleGraph.addEdge(normFromFileAbs, resolvedTarget);
          const node = moduleGraph.getNode(resolvedTarget);
          if (node && node.version > 0) {
            return `/${rel}?v=${node.version}`;
          }
        }
        return `/${rel}`;
      }
    }

    return spec;
  };

  const rewritten = rewriteJsModuleSpecifiers(code, rewriteSpec);

  if (normFromFileAbs) {
    const relId = "/" + path.relative(normRootDir, normFromFileAbs).split(path.sep).join("/");
    return `${createHotMetaShim(relId)}${rewritten}`;
  }
  return rewritten;
}

/**
 * Resolves a `/@modules/@dotmix/<pkg>/<rest>` request path to the real emitted `.js` file on disk.
 */
export function resolveMixModuleFile(moduleSubpath: string, rootDir: string): string | null {
  const normRootDir = normalizeDriveLetter(path.resolve(rootDir));
  const parts = moduleSubpath.replace(/^\/+/, "").split("/");
  if (parts[0] === "@dotmix") {
    parts.shift();
  }
  const pkgFolder = parts.shift();
  if (!pkgFolder) return null;
  const rest = parts.join("/") || "index.js";

  const candidatePkgDirs = [
    path.join(normRootDir, "node_modules", "@dotmix", pkgFolder),
    path.join(MONOREPO_PACKAGES_DIR, pkgFolder)
  ];

  for (const pkgDir of candidatePkgDirs) {
    const distCandidate = normalizeDriveLetter(path.resolve(pkgDir, "dist", rest));
    if (fs.existsSync(distCandidate) && fs.statSync(distCandidate).isFile()) {
      return distCandidate;
    }
    const distJs = `${distCandidate}.js`;
    if (fs.existsSync(distJs) && fs.statSync(distJs).isFile()) {
      return distJs;
    }
    const indexCandidate = normalizeDriveLetter(path.join(distCandidate, "index.js"));
    if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
      return indexCandidate;
    }
  }

  return null;
}

export const resolveMixPackageRequest = resolveMixModuleFile;

export function getOrSynthesizeIndexHtml(rootDir: string): string {
  const indexHtmlPath = path.join(rootDir, "index.html");
  let html: string;
  if (fs.existsSync(indexHtmlPath)) {
    html = fs.readFileSync(indexHtmlPath, "utf-8");
  } else {
    html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Mix App</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.mix"></script>
</body>
</html>`;
  }

  if (!html.includes("/@dotmix/hmr-client.js")) {
    if (html.includes("</head>")) {
      html = html.replace("</head>", `  <script type="module" src="/@dotmix/hmr-client.js"></script>\n</head>`);
    } else {
      html = `<script type="module" src="/@dotmix/hmr-client.js"></script>\n` + html;
    }
  }

  return html;
}

export function createStyleInjectorJs(id: string, cssCode: string): string {
  return `const __id = ${JSON.stringify(id)};
const __css = ${JSON.stringify(cssCode)};
if (typeof document !== "undefined" && document.head) {
  let el = document.head.querySelector('style[data-mix-file="' + __id + '"]') ||
           document.head.querySelector('style[data-mix-dev-id="' + __id + '"]');
  if (!el) {
    el = document.createElement("style");
    el.setAttribute("data-mix-file", __id);
    el.setAttribute("data-mix-dev-id", __id);
    document.head.appendChild(el);
  }
  el.textContent = __css;
}
export default __css;
`;
}
