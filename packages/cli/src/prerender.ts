/**
 * @dotmix/cli — Static HTML pre-rendering via the built-in headless Chrome CDP client.
 */

import fs from "node:fs";
import path from "node:path";
import { createPreviewServer } from "./commands/preview.js";
import { launchBrowser, type CdpBrowser } from "./browser/cdp.js";
import { normalizeBasePath } from "./production-shell.js";

export interface PrerenderOptions {
  readonly projectDirectory: string;
  readonly outputDirectory: string;
  readonly routes: readonly string[];
  readonly base?: string | undefined;
}

const SETTLE_IDLE_MS = 300;
const SETTLE_TIMEOUT_MS = 10000;

/** Parses and validates the comma-separated static route list supplied to `--prerender`. */
export function parsePrerenderRoutes(rawRoutes: string): string[] {
  const routes = rawRoutes
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (routes.length === 0) {
    throw new Error("--prerender requires at least one static route path (for example --prerender /,/about).");
  }
  const seen = new Set<string>();
  const uniqueRoutes: string[] = [];
  for (const routePath of routes) {
    if (!routePath.startsWith("/") || routePath.includes(":") || routePath.includes("*")) {
      throw new Error(
        `Invalid prerender route '${routePath}': routes must be static paths starting with '/' without params or '*'.`
      );
    }
    if (!seen.has(routePath)) {
      seen.add(routePath);
      uniqueRoutes.push(routePath);
    }
  }
  return uniqueRoutes;
}

/** Reads the mount element id from the project's source index.html, defaulting to `"app"`. */
export function detectMountContainerId(projectDirectory: string): string {
  const indexPath = path.join(projectDirectory, "index.html");
  if (!fs.existsSync(indexPath)) {
    return "app";
  }
  const html = fs.readFileSync(indexPath, "utf-8");
  const lowerHtml = html.toLowerCase();
  const bodyStart = lowerHtml.indexOf("<body");
  if (bodyStart === -1) {
    return "app";
  }
  const bodyOpenEnd = html.indexOf(">", bodyStart);
  if (bodyOpenEnd === -1) {
    return "app";
  }
  let cursor = bodyOpenEnd + 1;
  while (cursor < html.length) {
    const ltIndex = html.indexOf("<", cursor);
    if (ltIndex === -1) break;
    if (html.startsWith("<!--", ltIndex)) {
      const commentEnd = html.indexOf("-->", ltIndex + 4);
      cursor = commentEnd === -1 ? html.length : commentEnd + 3;
      continue;
    }
    if (html[ltIndex + 1] === "/") {
      const closeTagEnd = html.indexOf(">", ltIndex + 2);
      cursor = closeTagEnd === -1 ? html.length : closeTagEnd + 1;
      continue;
    }
    const gtIndex = html.indexOf(">", ltIndex + 1);
    if (gtIndex === -1) break;
    const tagContent = html.slice(ltIndex + 1, gtIndex);
    const spaceOffset = tagContent.search(/[\s/]/);
    const tagName = (spaceOffset === -1 ? tagContent : tagContent.slice(0, spaceOffset)).toLowerCase();
    if (tagName === "script" || tagName === "noscript" || tagName === "style") {
      const endTag = lowerHtml.indexOf(`</${tagName}`, gtIndex + 1);
      const afterEndTag = endTag === -1 ? -1 : html.indexOf(">", endTag + 2 + tagName.length);
      cursor = afterEndTag === -1 ? html.length : afterEndTag + 1;
      continue;
    }
    const idAttrMatch = /\bid\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s"'=<>`]+))/i.exec(tagContent);
    if (idAttrMatch) {
      const matchedId = idAttrMatch[1] ?? idAttrMatch[2] ?? idAttrMatch[3];
      if (matchedId) return matchedId;
    }
    cursor = gtIndex + 1;
  }
  return "app";
}

function buildPrerenderCaptureExpression(mountId: string, routePath: string): string {
  const docPrefixLiteral = JSON.stringify("<!DOCTYPE html>\n");
  return `(() => {
  const mountId = ${JSON.stringify(mountId)};
  const routeLabel = ${JSON.stringify(routePath)};
  const idleMs = ${SETTLE_IDLE_MS};
  const capMs = ${SETTLE_TIMEOUT_MS};
  const findTarget = () =>
    document.getElementById(mountId) ||
    document.getElementById("app") ||
    document.getElementById("root");
  const hasContent = () => {
    const target = findTarget();
    return Boolean(target && (target.children.length > 0 || (target.textContent || "").trim().length > 0));
  };
  return new Promise((resolve, reject) => {
    let settleTimer = null;
    let finished = false;
    const finalize = () => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      clearTimeout(settleTimer);
      clearTimeout(capTimer);
      const target = findTarget();
      if (!target) {
        reject(new Error("Mount container #" + mountId + " not found on route " + routeLabel));
        return;
      }
      target.setAttribute("data-mix-prerendered", "");
      restoreShellAttributes().then(
        () => resolve(${docPrefixLiteral} + document.documentElement.outerHTML),
        reject
      );
    };
    // Attributes the app sets on <html>/<body> at runtime (theme, cursor, motion classes) describe a
    // booted client. Saved into static HTML they would apply before any script runs, so the saved page
    // keeps the shell's own <html>/<body> attributes; the shell's scripts set the rest again on load.
    // Until all routes finish no file is written, so the server still returns the original shell.
    const restoreShellAttributes = async () => {
      const response = await fetch(location.href, { cache: "no-store" });
      const shell = new DOMParser().parseFromString(await response.text(), "text/html");
      for (const [liveElement, shellElement] of [
        [document.documentElement, shell.documentElement],
        [document.body, shell.body]
      ]) {
        for (const name of liveElement.getAttributeNames()) {
          if (!shellElement.hasAttribute(name)) liveElement.removeAttribute(name);
        }
        for (const name of shellElement.getAttributeNames()) {
          liveElement.setAttribute(name, shellElement.getAttribute(name));
        }
      }
    };
    const capTimer = setTimeout(() => {
      if (hasContent()) {
        finalize();
      } else if (!finished) {
        finished = true;
        observer.disconnect();
        clearTimeout(settleTimer);
        reject(new Error("Timed out waiting for mount content in #" + mountId + " on route " + routeLabel));
      }
    }, capMs);
    const scheduleSettle = () => {
      if (finished) return;
      clearTimeout(settleTimer);
      if (!hasContent()) return;
      settleTimer = setTimeout(finalize, idleMs);
    };
    const observer = new MutationObserver(() => scheduleSettle());
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
    scheduleSettle();
  });
})()`;
}

function resolveRouteUrlPath(routePath: string, basePath: string): string {
  if (basePath === "/" || basePath === "./") {
    return routePath;
  }
  const trimmedBase = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  return routePath === "/" ? `${trimmedBase}/` : `${trimmedBase}${routePath}`;
}

function resolvePrerenderOutputPath(outputDirectory: string, routePath: string): string {
  const trimmedSegments = routePath.replace(/^\/+|\/+$/g, "");
  return trimmedSegments.length === 0
    ? path.join(outputDirectory, "index.html")
    : path.join(outputDirectory, ...trimmedSegments.split("/"), "index.html");
}

/**
 * Serves `options.outputDirectory`, renders each static route in headless Chrome via CDP,
 * and saves the settled HTML into `dist/`. Throws if Chrome is missing or any route logs errors.
 */
export async function prerenderRoutes(options: PrerenderOptions): Promise<readonly string[]> {
  const mountId = detectMountContainerId(options.projectDirectory);
  const basePath = normalizeBasePath(options.base);
  const server = await createPreviewServer({
    dir: options.outputDirectory,
    port: 0,
    host: "127.0.0.1",
    silent: true
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 4173;
  let browser: CdpBrowser | null = null;
  const renderedHtmlByRoute = new Map<string, string>();

  try {
    browser = await launchBrowser();
    for (const routePath of options.routes) {
      const page = await browser.newPage();
      try {
        const routeUrl = `http://127.0.0.1:${port}${resolveRouteUrlPath(routePath, basePath)}`;
        await page.goto(routeUrl);
        const capturedHtml = await page.evaluate<string>(buildPrerenderCaptureExpression(mountId, routePath));
        const consoleErrors = page.getConsoleErrors();
        if (consoleErrors.length > 0) {
          throw new Error(`Prerender failed on route '${routePath}': ${consoleErrors.join("; ")}`);
        }
        renderedHtmlByRoute.set(routePath, capturedHtml);
      } finally {
        await page.close();
      }
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // Write captured pages only after all routes finish so earlier routes never pollute subsequent SPA boots.
  const writtenFiles: string[] = [];
  for (const [routePath, html] of renderedHtmlByRoute) {
    const outFilePath = resolvePrerenderOutputPath(options.outputDirectory, routePath);
    fs.mkdirSync(path.dirname(outFilePath), { recursive: true });
    fs.writeFileSync(outFilePath, html, "utf-8");
    writtenFiles.push(outFilePath);
  }
  return writtenFiles;
}

