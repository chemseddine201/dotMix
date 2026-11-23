/**
 * @dotmix/cli — production shell for `mix build`.
 * Writes dist/index.html, copies the runtime packages the bundle imports into dist/vendor with an
 * import map, and copies the project's public/ directory, so dist/ can be deployed as a static site.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listDynamicImportSpecifiers, listStaticImportSpecifiers } from "@dotmix/compiler-semantic";
import { copyPublicDirectory, listFilesRecursively } from "./public-files.js";

const VENDOR_DIRECTORY_NAME = "vendor";
const RUNTIME_PACKAGE_SCOPE = "@dotmix/";
const SOURCE_ENTRY_SCRIPT_PATTERN =
  /[ \t]*<script\b[^>]*\bsrc=["'](?:\.?\/)?src\/[^"']*["'][^>]*>\s*<\/script>[ \t]*\r?\n?/gi;

export interface ProductionShellOptions {
  readonly projectDirectory: string;
  readonly outputDirectory: string;
  readonly basePath: string;
  /** URL of the entry module (with base). */
  readonly entryModuleUrl: string | undefined;
  /** URLs (with base) preloaded with <link rel="modulepreload">. */
  readonly modulePreloadUrls: readonly string[];
  /** Import map entries of the application modules (unhashed URL to hashed URL). */
  readonly moduleImportMap: Readonly<Record<string, string>>;
  /** Stylesheet path relative to dist/. */
  readonly stylesheetFile: string | undefined;
  /** Emitted application modules, scanned for the runtime packages they import. */
  readonly moduleFilePaths: readonly string[];
}

export interface ProductionShellResult {
  readonly indexHtmlPath: string;
  readonly writtenFiles: readonly string[];
}

type ExportTarget = string | { readonly [condition: string]: ExportTarget } | null;

interface RuntimePackageManifest {
  readonly name: string;
  readonly main?: string;
  readonly module?: string;
  readonly exports?: ExportTarget;
}

export function normalizeBasePath(basePath: string | undefined): string {
  const trimmedBase = (basePath ?? "/").trim();
  if (trimmedBase === "" || trimmedBase === "/") return "/";
  const withLeadingSlash = trimmedBase.startsWith("/") || trimmedBase.startsWith(".") ? trimmedBase : `/${trimmedBase}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export function writeProductionShell(options: ProductionShellOptions): ProductionShellResult {
  const writtenFiles = copyPublicDirectory(options.projectDirectory, options.outputDirectory);
  const importMapEntries: Record<string, string> = { ...options.moduleImportMap };
  const pendingPackageNames = collectRuntimePackageNames(options.moduleFilePaths);
  const vendoredPackageNames = new Set<string>();

  while (pendingPackageNames.length > 0) {
    const packageName = pendingPackageNames.pop()!;
    if (vendoredPackageNames.has(packageName)) continue;
    vendoredPackageNames.add(packageName);
    // The project's own install wins; the copy installed next to the CLI is the fallback.
    const packageDirectory = findPackageDirectory(packageName, options.projectDirectory)
      ?? findPackageDirectory(packageName, path.dirname(fileURLToPath(import.meta.url)));
    if (!packageDirectory) {
      throw new Error(`Cannot find package "${packageName}" from ${options.projectDirectory}. Install it before running mix build.`);
    }
    const packageHash = computePackageModulesHash(packageDirectory);
    const vendorDirectory = path.join(options.outputDirectory, VENDOR_DIRECTORY_NAME, packageHash, ...packageName.split("/"));
    const copiedFiles = copyPackageModules(packageDirectory, vendorDirectory);
    writtenFiles.push(...copiedFiles);
    pendingPackageNames.push(...collectRuntimePackageNames(copiedFiles));
    const manifest = JSON.parse(fs.readFileSync(path.join(packageDirectory, "package.json"), "utf-8")) as RuntimePackageManifest;
    const vendorUrl = `${options.basePath}${VENDOR_DIRECTORY_NAME}/${packageHash}/${packageName}/`;
    Object.assign(importMapEntries, createImportMapEntries(packageName, manifest, vendorUrl));
  }

  const indexHtmlPath = path.join(options.outputDirectory, "index.html");
  fs.writeFileSync(indexHtmlPath, createIndexHtml(options, importMapEntries), "utf-8");
  writtenFiles.push(indexHtmlPath);
  return { indexHtmlPath, writtenFiles };
}

function createIndexHtml(options: ProductionShellOptions, importMapEntries: Record<string, string>): string {
  const sourceIndexPath = path.join(options.projectDirectory, "index.html");
  const sourceHtml = fs.existsSync(sourceIndexPath)
    ? fs.readFileSync(sourceIndexPath, "utf-8")
    : [
        "<!DOCTYPE html>",
        "<html lang=\"en\">",
        "<head>",
        "  <meta charset=\"UTF-8\" />",
        "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
        "  <title>Mix App</title>",
        "</head>",
        "<body>",
        "  <div id=\"app\"></div>",
        "</body>",
        "</html>",
      ].join("\n");

  const headTags: string[] = [];
  if (options.stylesheetFile) {
    headTags.push(`<link rel="stylesheet" href="${options.basePath}${options.stylesheetFile}" />`);
  }
  if (Object.keys(importMapEntries).length > 0) {
    headTags.push(`<script type="importmap">${JSON.stringify({ imports: importMapEntries })}</script>`);
  }
  for (const preloadUrl of options.modulePreloadUrls) {
    headTags.push(`<link rel="modulepreload" href="${preloadUrl}">`);
  }
  if (options.entryModuleUrl) {
    headTags.push(`<script type="module" src="${options.entryModuleUrl}"></script>`);
  }

  const htmlWithoutSourceEntry = sourceHtml.replace(SOURCE_ENTRY_SCRIPT_PATTERN, "");
  const injectedTags = headTags.map((tag) => `  ${tag}\n`).join("");
  return htmlWithoutSourceEntry.includes("</head>")
    ? htmlWithoutSourceEntry.replace("</head>", `${injectedTags}</head>`)
    : `${injectedTags}${htmlWithoutSourceEntry}`;
}

function collectRuntimePackageNames(moduleFilePaths: readonly string[]): string[] {
  const packageNames = new Set<string>();
  for (const moduleFilePath of moduleFilePaths) {
    if (!moduleFilePath.endsWith(".js") && !moduleFilePath.endsWith(".mjs")) continue;
    const moduleSource = fs.readFileSync(moduleFilePath, "utf-8");
    const specifiers = [...listStaticImportSpecifiers(moduleSource), ...listDynamicImportSpecifiers(moduleSource)];
    for (const specifier of specifiers) {
      if (!specifier.startsWith(RUNTIME_PACKAGE_SCOPE)) continue;
      const packageName = specifier.split("/").slice(0, 2).join("/");
      if (packageName.length > RUNTIME_PACKAGE_SCOPE.length) packageNames.add(packageName);
    }
  }
  return [...packageNames];
}

function findPackageDirectory(packageName: string, startDirectory: string): string | null {
  let currentDirectory = path.resolve(startDirectory);
  for (;;) {
    const candidateDirectory = path.join(currentDirectory, "node_modules", ...packageName.split("/"));
    if (fs.existsSync(path.join(candidateDirectory, "package.json"))) {
      return fs.realpathSync(candidateDirectory);
    }
    const pkgShort = packageName.split("/")[1];
    if (pkgShort) {
      const workspaceCandidate = path.join(currentDirectory, "packages", pkgShort);
      if (fs.existsSync(path.join(workspaceCandidate, "package.json"))) {
        return fs.realpathSync(workspaceCandidate);
      }
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return null;
    currentDirectory = parentDirectory;
  }
}

function computePackageModulesHash(packageDirectory: string): string {
  const distributionDirectory = path.join(packageDirectory, "dist");
  if (!fs.existsSync(distributionDirectory)) {
    throw new Error(`Package at ${packageDirectory} has no dist/ directory. Build it before running mix build.`);
  }
  const hasher = crypto.createHash("sha256");
  const files = listFilesRecursively(distributionDirectory)
    .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
    .sort();
  for (const file of files) {
    hasher.update(path.relative(distributionDirectory, file).split(path.sep).join("/"));
    hasher.update("\0");
    hasher.update(fs.readFileSync(file));
  }
  return hasher.digest("hex").slice(0, 8);
}

function copyPackageModules(packageDirectory: string, vendorDirectory: string): string[] {
  const distributionDirectory = path.join(packageDirectory, "dist");
  if (!fs.existsSync(distributionDirectory)) {
    throw new Error(`Package at ${packageDirectory} has no dist/ directory. Build it before running mix build.`);
  }
  const copiedFiles: string[] = [];
  for (const sourceFile of listFilesRecursively(distributionDirectory)) {
    if (!sourceFile.endsWith(".js") && !sourceFile.endsWith(".mjs")) continue;
    const targetFile = path.join(vendorDirectory, "dist", path.relative(distributionDirectory, sourceFile));
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);
    copiedFiles.push(targetFile);
  }
  return copiedFiles;
}

function createImportMapEntries(packageName: string, manifest: RuntimePackageManifest, vendorUrl: string): Record<string, string> {
  const importMapEntries: Record<string, string> = {};
  const toVendorUrl = (packageRelativePath: string): string => `${vendorUrl}${packageRelativePath.replace(/^\.?\//, "")}`;
  const exportsField = manifest.exports;
  if (exportsField && typeof exportsField === "object" && Object.keys(exportsField).some((key) => key.startsWith("."))) {
    for (const [subpath, exportTarget] of Object.entries(exportsField)) {
      const resolvedTarget = resolveExportTarget(exportTarget);
      if (!resolvedTarget || subpath.includes("*") || subpath.endsWith(".json")) continue;
      const specifier = subpath === "." ? packageName : `${packageName}/${subpath.replace(/^\.\//, "")}`;
      importMapEntries[specifier] = toVendorUrl(resolvedTarget);
    }
    return importMapEntries;
  }
  const rootTarget = resolveExportTarget(exportsField ?? null) ?? manifest.module ?? manifest.main ?? "dist/index.js";
  importMapEntries[packageName] = toVendorUrl(rootTarget);
  importMapEntries[`${packageName}/`] = vendorUrl;
  return importMapEntries;
}

function resolveExportTarget(exportTarget: ExportTarget | undefined): string | null {
  if (typeof exportTarget === "string") return exportTarget;
  if (!exportTarget) return null;
  for (const condition of ["browser", "import", "default"]) {
    const resolvedTarget = resolveExportTarget(exportTarget[condition]);
    if (resolvedTarget) return resolvedTarget;
  }
  return null;
}
