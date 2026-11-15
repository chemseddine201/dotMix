// Module URLs exactly as Node's ES module loader computes them.
//
// Node identifies a module by its resolved URL. The resolver follows symlinks and junctions with
// fs.realpathSync and keeps the casing of the path it was given, so "file:///g:/..." and
// "file:///G:/..." can be two modules with two states. Every @dotmix package reaches its
// dependencies through this same resolver, so tests that take their URLs from here share one
// instance of each package on any machine, folder, drive-letter casing or OS.
// Never build these URLs from path.resolve() or change their casing by hand.

import fs from "node:fs";
import { pathToFileURL } from "node:url";

/** The URL Node resolves for a package specifier, e.g. "@dotmix/runtime" or "@dotmix/runtime/directives". */
export function resolvePackageUrl(specifier) {
  return import.meta.resolve(specifier);
}

/** The URL Node's loader gives a file it imports (the same fs.realpathSync the loader applies). */
export function toLoaderFileUrl(filePath) {
  return pathToFileURL(fs.realpathSync(filePath)).href;
}

/** The loader URL of a directory, with a trailing slash, for prefix checks against module URLs. */
export function toLoaderDirectoryUrl(directoryPath) {
  const directoryUrl = toLoaderFileUrl(directoryPath);
  return directoryUrl.endsWith("/") ? directoryUrl : `${directoryUrl}/`;
}

/** The runtime URL for `generate({ runtimeImportPath })` and for importing the runtime in tests. */
export const runtimeUrl = resolvePackageUrl("@dotmix/runtime");
