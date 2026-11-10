/**
 * @mix/cli — Dev Server Specifier Rewriter, Module Resolution & HTML/CSS Injection
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STYLE_FILE_REGEX } from "./scanner.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO_PACKAGES_DIR = path.resolve(__dirname, "../..");

export const HMR_CLIENT_SOURCE = `// @mix/cli HMR Client
(() => {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return;
  const source = new EventSource("/__mix_hmr");
  source.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload && payload.type === "update") {
        window.dispatchEvent(new CustomEvent("mix:hmr-update", { detail: payload }));
        if (payload.cssUpdated) {
          import(payload.file + "?mix-css=1&t=" + payload.timestamp).catch(() => {});
        }
        import(payload.file + "?t=" + payload.timestamp).catch(() => {
          window.location.reload();
        });
      }
    } catch {
      // Ignore malformed HMR packets
    }
  });
})();
`;

/**
 * Rewrites bare `@mix/*` specifiers and relative imports in served JS modules for direct browser ES module execution.
 */
export function rewriteModuleImportsForDev(
  code: string,
  fromFileAbs: string | null,
  rootDir: string
): string {
  const rewriteSpec = (spec: string): string => {
    // 1. Virtual ?mix-css module emitted by @mix/vite-plugin with an absolute path
    if (spec.includes("?mix-css")) {
      const [filePart, queryPart] = spec.split("?");
      if (filePart && path.isAbsolute(filePart)) {
        const rel = path.relative(rootDir, filePart).split(path.sep).join("/");
        return `/${rel}?${queryPart ?? "mix-css=1"}`;
      }
      return spec;
    }

    // 2. Bare @mix/<pkg> or mix-helpers/<subpath> specifier
    if (spec.startsWith("@mix/")) {
      const sub = spec.slice("@mix/".length);
      if (sub.endsWith(".js")) {
        return `/@modules/@mix/${sub}`;
      }
      return `/@modules/@mix/${sub}/index.js`;
    }
    if (spec === "mix-helpers" || spec.startsWith("mix-helpers/")) {
      const sub = spec === "mix-helpers" ? "helpers" : `helpers/${spec.slice("mix-helpers/".length)}`;
      if (sub.endsWith(".js")) {
        return `/@modules/@mix/${sub}`;
      }
      return `/@modules/@mix/${sub}/index.js`;
    }

    // 3. Relative imports inside project source files
    if ((spec.startsWith("./") || spec.startsWith("../")) && fromFileAbs) {
      // Normalize compiled .tix.js / .mix.js back to source .tix / .mix in dev server
      const cleanSpec = spec.replace(/\.(tix|mix)\.js$/i, ".$1");
      const baseDir = path.dirname(fromFileAbs);
      const candidateBase = path.resolve(baseDir, cleanSpec);

      if (STYLE_FILE_REGEX.test(cleanSpec)) {
        const rel = path.relative(rootDir, candidateBase).split(path.sep).join("/");
        return `/${rel}?import`;
      }

      const candidates = [
        candidateBase,
        `${candidateBase}.ts`,
        `${candidateBase}.js`,
        `${candidateBase}.tix`,
        `${candidateBase}.mix`,
        path.join(candidateBase, "index.ts"),
        path.join(candidateBase, "index.js")
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
          if (cand.startsWith(rootDir)) {
            const rel = path.relative(rootDir, cand).split(path.sep).join("/");
            return `/${rel}`;
          }
        }
      }
    }

    return spec;
  };

  return code
    .replace(
      /((?:import|export)\s+(?:[^"']*?\s+from\s+)?["'])([^"']+)(["'])/g,
      (_, prefix: string, spec: string, suffix: string) => `${prefix}${rewriteSpec(spec)}${suffix}`
    )
    .replace(
      /(import\s*\(\s*["'])([^"']+)(["']\s*\))/g,
      (_, prefix: string, spec: string, suffix: string) => `${prefix}${rewriteSpec(spec)}${suffix}`
    );
}

/**
 * Resolves a `/@modules/@mix/<pkg>/<rest>` request path to the real emitted `.js` file on disk.
 */
export function resolveMixModuleFile(moduleSubpath: string, rootDir: string): string | null {
  const parts = moduleSubpath.replace(/^\/+/, "").split("/");
  if (parts[0] === "@mix") {
    parts.shift();
  }
  const pkgFolder = parts.shift();
  if (!pkgFolder) return null;
  const rest = parts.join("/") || "index.js";

  const candidatePkgDirs = [
    path.join(rootDir, "node_modules", "@mix", pkgFolder),
    path.join(rootDir, "node_modules", pkgFolder === "helpers" ? "mix-helpers" : pkgFolder),
    path.join(MONOREPO_PACKAGES_DIR, pkgFolder)
  ];

  for (const pkgDir of candidatePkgDirs) {
    const distCandidate = path.resolve(pkgDir, "dist", rest);
    if (fs.existsSync(distCandidate) && fs.statSync(distCandidate).isFile()) {
      return distCandidate;
    }
    if (fs.existsSync(`${distCandidate}.js`) && fs.statSync(`${distCandidate}.js`).isFile()) {
      return `${distCandidate}.js`;
    }
    const indexCandidate = path.join(distCandidate, "index.js");
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

  if (!html.includes("/@mix/hmr-client.js")) {
    if (html.includes("</head>")) {
      html = html.replace("</head>", `  <script type="module" src="/@mix/hmr-client.js"></script>\n</head>`);
    } else {
      html = `<script type="module" src="/@mix/hmr-client.js"></script>\n` + html;
    }
  }

  return html;
}

export function createStyleInjectorJs(id: string, cssCode: string): string {
  return `const __id = ${JSON.stringify(id)};
const __css = ${JSON.stringify(cssCode)};
if (typeof document !== "undefined" && document.head) {
  let el = document.head.querySelector('style[data-mix-dev-id="' + __id + '"]');
  if (!el) {
    el = document.createElement("style");
    el.setAttribute("data-mix-dev-id", __id);
    document.head.appendChild(el);
  }
  el.textContent = __css;
}
export default __css;
`;
}
