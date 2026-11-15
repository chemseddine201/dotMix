/**
 * Node module hooks that resolve modules of a built dist/ folder the way a browser does with the
 * import map of dist/index.html: URLs are resolved against the site root (dist/ = "/"), then mapped.
 */
import { URL } from "node:url";

let distDirectoryUrl = "";
let importMapEntries = {};

const SITE_ORIGIN = "http://dotmix.test";

export async function initialize(data) {
  distDirectoryUrl = data.distDirectoryUrl;
  importMapEntries = data.imports;
}

function toSitePath(fileUrl) {
  return `/${fileUrl.slice(distDirectoryUrl.length)}`;
}

export async function resolve(specifier, context, nextResolve) {
  const parentUrl = context.parentURL ?? "";
  if (!parentUrl.startsWith(distDirectoryUrl)) {
    return nextResolve(specifier, context);
  }
  let sitePath;
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    sitePath = new URL(specifier, `${SITE_ORIGIN}${toSitePath(parentUrl)}`).pathname;
    sitePath = importMapEntries[sitePath] ?? sitePath;
  } else if (importMapEntries[specifier]) {
    sitePath = importMapEntries[specifier];
  } else {
    throw new Error(`Bare specifier "${specifier}" is not in the import map (imported by ${parentUrl}).`);
  }
  return { url: `${distDirectoryUrl}${sitePath.slice(1)}`, shortCircuit: true };
}
