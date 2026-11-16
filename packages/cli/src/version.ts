/**
 * The version of this CLI, read from its own package.json. Every `@dotmix/*` package is released in
 * lockstep with it, so it is also the version new projects pin for the framework packages.
 */

import { readFileSync } from "node:fs";

interface PackageManifest {
  readonly version: string;
}

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf-8")) as PackageManifest;

export const DOTMIX_VERSION: string = manifest.version;
