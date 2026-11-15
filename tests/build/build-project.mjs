import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "../../packages/cli/dist/index.js";

/**
 * Writes a temporary project (src/ files plus an optional index.html) and returns its folder.
 * `sourceFiles` maps paths relative to src/ to their contents.
 */
export function createBuildProject(sourceFiles) {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-build-"));
  for (const [relativePath, contents] of Object.entries(sourceFiles)) {
    const absolutePath = path.join(projectDirectory, "src", relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents, "utf-8");
  }
  return projectDirectory;
}

export function buildProject(projectDirectory, options = {}) {
  return build({
    inDir: path.join(projectDirectory, "src"),
    outDir: path.join(projectDirectory, "dist"),
    clean: true,
    silent: true,
    ...options
  });
}

export function removeProject(projectDirectory) {
  fs.rmSync(projectDirectory, { recursive: true, force: true });
}

export function listFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** The import map of dist/index.html. */
export function readImportMap(distDirectory) {
  const indexHtml = fs.readFileSync(path.join(distDirectory, "index.html"), "utf-8");
  const openingTag = '<script type="importmap">';
  const start = indexHtml.indexOf(openingTag);
  if (start < 0) return { imports: {} };
  const end = indexHtml.indexOf("</script>", start);
  return JSON.parse(indexHtml.slice(start + openingTag.length, end));
}

/** The href values of the <link rel="modulepreload"> tags of dist/index.html. */
export function readModulePreloadHrefs(distDirectory) {
  const indexHtml = fs.readFileSync(path.join(distDirectory, "index.html"), "utf-8");
  const hrefs = [];
  let searchFrom = 0;
  for (;;) {
    const tagStart = indexHtml.indexOf('<link rel="modulepreload" href="', searchFrom);
    if (tagStart < 0) break;
    const hrefStart = tagStart + '<link rel="modulepreload" href="'.length;
    const hrefEnd = indexHtml.indexOf('"', hrefStart);
    hrefs.push(indexHtml.slice(hrefStart, hrefEnd));
    searchFrom = hrefEnd;
  }
  return hrefs;
}

/** The path (relative to dist/) of the emitted module whose unhashed name is `relativeModulePath`. */
export function findHashedModule(distDirectory, relativeModulePath) {
  const importMap = readImportMap(distDirectory);
  const hashedUrl = importMap.imports[`/assets/${relativeModulePath}`];
  if (hashedUrl) {
    return path.join(distDirectory, ...hashedUrl.slice(1).split("/"));
  }
  const moduleDirectory = path.join(distDirectory, "assets", path.dirname(relativeModulePath));
  const moduleName = path.basename(relativeModulePath, ".js");
  const hashedFile = fs.existsSync(moduleDirectory)
    ? fs.readdirSync(moduleDirectory).find((fileName) => fileName.startsWith(`${moduleName}-`) && fileName.endsWith(".js"))
    : undefined;
  if (!hashedFile) {
    throw new Error(`No emitted module for ${relativeModulePath}: ${JSON.stringify(importMap)}`);
  }
  return path.join(moduleDirectory, hashedFile);
}
