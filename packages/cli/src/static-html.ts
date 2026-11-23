/**
 * @dotmix/cli — Static HTML shell assembler for `mix build --static`.
 */

import fs from "node:fs";
import path from "node:path";
import type { UniversalHeadCollector } from "@dotmix/runtime";

export interface StaticHtmlOptions {
  readonly sourceIndexHtml: string;
  readonly mountId: string;
  readonly bodyHtml: string;
  readonly headCollector: UniversalHeadCollector;
  readonly basePath: string;
  readonly stylesheetFile: string | undefined;
  readonly mode: "zero-js" | "islands" | "hydrate";
  readonly importMapEntries: Readonly<Record<string, string>>;
  readonly modulePreloadUrls: readonly string[];
  readonly entryModuleUrl: string | undefined;
}

function escapeHtmlAttr(val: string): string {
  return val
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function applyElementAttrsToOpenTag(
  html: string,
  tagName: string,
  attrs: Readonly<Record<string, string>>
): string {
  if (Object.keys(attrs).length === 0) return html;
  const lower = html.toLowerCase();
  const openIdx = lower.indexOf(`<${tagName.toLowerCase()}`);
  if (openIdx === -1) return html;
  const gtIdx = html.indexOf(">", openIdx);
  if (gtIdx === -1) return html;

  let openTag = html.slice(openIdx, gtIdx);
  for (const [k, v] of Object.entries(attrs)) {
    const attrPattern = new RegExp(`\\s${k}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, "i");
    const replacement = ` ${k}="${escapeHtmlAttr(v)}"`;
    if (attrPattern.test(openTag)) {
      openTag = openTag.replace(attrPattern, replacement);
    } else {
      openTag += replacement;
    }
  }
  return html.slice(0, openIdx) + openTag + html.slice(gtIdx);
}

function stripTagsByPrefix(html: string, openTagPrefix: string, closeTag?: string): string {
  const lower = html.toLowerCase();
  const target = openTagPrefix.toLowerCase();
  let out = "";
  let pos = 0;

  while (pos < html.length) {
    const idx = lower.indexOf(target, pos);
    if (idx === -1) {
      out += html.slice(pos);
      break;
    }
    const nextChar = html[idx + target.length];
    if (nextChar !== ">" && nextChar !== " " && nextChar !== "\t" && nextChar !== "\n") {
      out += html.slice(pos, idx + target.length);
      pos = idx + target.length;
      continue;
    }
    out += html.slice(pos, idx);
    if (closeTag) {
      const endClose = lower.indexOf(closeTag.toLowerCase(), idx);
      pos = endClose === -1 ? html.length : endClose + closeTag.length;
    } else {
      const gt = html.indexOf(">", idx);
      pos = gt === -1 ? html.length : gt + 1;
    }
  }
  return out;
}

function injectIntoMountContainer(html: string, mountId: string, innerHtml: string, isHydrate: boolean): string {
  const idTokenDouble = `id="${mountId}"`;
  const idTokenSingle = `id='${mountId}'`;
  let idIdx = html.indexOf(idTokenDouble);
  if (idIdx === -1) idIdx = html.indexOf(idTokenSingle);
  if (idIdx === -1) {
    return html.replace("</body>", `<div id="${mountId}"${isHydrate ? ' data-mix-ssr="1"' : ""}>${innerHtml}</div>\n</body>`);
  }
  const openStart = html.lastIndexOf("<", idIdx);
  const openEnd = html.indexOf(">", idIdx);
  if (openStart === -1 || openEnd === -1) return html;

  let openTag = html.slice(openStart, openEnd);
  if (isHydrate && !openTag.includes("data-mix-ssr")) {
    openTag += ' data-mix-ssr="1"';
  }
  const closeStart = html.indexOf("</div>", openEnd + 1);
  if (closeStart === -1) return html;
  return html.slice(0, openStart) + openTag + ">" + innerHtml + html.slice(closeStart);
}

export function loadBaseIndexHtml(projectDirectory: string): string {
  const sourceIndexPath = path.join(projectDirectory, "index.html");
  if (fs.existsSync(sourceIndexPath)) {
    return fs.readFileSync(sourceIndexPath, "utf-8");
  }
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    "  <title>dotMix App</title>",
    "</head>",
    "<body>",
    '  <div id="app"></div>',
    "</body>",
    "</html>"
  ].join("\n");
}

export function assembleStaticHtmlPage(options: StaticHtmlOptions): string {
  let html = options.sourceIndexHtml.replace(
    /[ \t]*<script\b[^>]*\bsrc=["'](?:\.?\/)?src\/[^"']*["'][^>]*>\s*<\/script>[ \t]*\r?\n?/gi,
    ""
  );

  const collectedHtml = options.headCollector.renderToHeadHtml();
  if (collectedHtml.includes("<title>")) {
    html = stripTagsByPrefix(html, "<title", "</title>");
  }

  html = applyElementAttrsToOpenTag(html, "html", options.headCollector.getHtmlAttrs());
  html = applyElementAttrsToOpenTag(html, "body", options.headCollector.getBodyAttrs());

  const headInjections: string[] = [];
  if (collectedHtml.length > 0) {
    headInjections.push(collectedHtml);
  }
  if (options.stylesheetFile) {
    headInjections.push(`<link rel="stylesheet" href="${options.basePath}${options.stylesheetFile}" />`);
  }

  if (options.mode === "islands") {
    if (Object.keys(options.importMapEntries).length > 0) {
      headInjections.push(`<script type="importmap">${JSON.stringify({ imports: options.importMapEntries })}</script>`);
    }
    const runtimeSpec = options.importMapEntries["@dotmix/runtime"] ?? "@dotmix/runtime";
    headInjections.push(
      `<script type="module">import{hydrateIslands}from${JSON.stringify(runtimeSpec)};hydrateIslands();</script>`
    );
  } else if (options.mode === "hydrate") {
    if (Object.keys(options.importMapEntries).length > 0) {
      headInjections.push(`<script type="importmap">${JSON.stringify({ imports: options.importMapEntries })}</script>`);
    }
    for (const preloadUrl of options.modulePreloadUrls) {
      headInjections.push(`<link rel="modulepreload" href="${preloadUrl}">`);
    }
    if (options.entryModuleUrl) {
      headInjections.push(`<script type="module" src="${options.entryModuleUrl}"></script>`);
    }
  }

  if (headInjections.length > 0) {
    const block = headInjections.map((t) => `  ${t}\n`).join("");
    html = html.includes("</head>") ? html.replace("</head>", `${block}</head>`) : `${block}${html}`;
  }

  return injectIntoMountContainer(html, options.mountId, options.bodyHtml, options.mode === "hydrate");
}

