import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { URL } from "node:url";
import { toLoaderDirectoryUrl, toLoaderFileUrl } from "../support/module-urls.mjs";
import {
  buildProject,
  createBuildProject,
  findHashedModule,
  listFiles,
  readImportMap,
  removeProject
} from "./build-project.mjs";

const sourceFiles = {
  "main.js": `export async function shareThroughStore() {
  const pageA = await import("./pages/PageA.js");
  const pageB = await import("./pages/PageB.js");
  pageA.selectAccount("ada");
  return pageB.readSelectedAccount();
}
`,
  "stores/accountStore.js": `import { signal } from "@dotmix/runtime";
export const selectedAccount = signal(null);
`,
  "pages/PageA.js": `import { selectedAccount } from "../stores/accountStore.js";
export function selectAccount(accountName) {
  selectedAccount.set(accountName);
}
`,
  "pages/PageB.js": `import { selectedAccount } from "../stores/accountStore.js";
export function readSelectedAccount() {
  return selectedAccount();
}
`
};

test("a store imported by two lazy pages is emitted once and shared as one instance", async () => {
  const projectDirectory = createBuildProject(sourceFiles);
  try {
    buildProject(projectDirectory);
    const distDirectory = path.join(projectDirectory, "dist");

    const storeFiles = listFiles(path.join(distDirectory, "assets")).filter((filePath) =>
      path.basename(filePath).startsWith("accountStore")
    );
    assert.equal(storeFiles.length, 1, `Expected one emitted store file, got: ${storeFiles.join(", ")}`);
    for (const filePath of listFiles(path.join(distDirectory, "assets"))) {
      if (!filePath.endsWith(".js") || filePath === storeFiles[0]) continue;
      assert.equal(
        fs.readFileSync(filePath, "utf-8").includes("signal(null)"),
        false,
        `${filePath} must import the store instead of inlining it`
      );
    }

    const importMap = readImportMap(distDirectory);
    register(new URL("./import-map-hooks.mjs", import.meta.url), {
      data: { distDirectoryUrl: toLoaderDirectoryUrl(distDirectory), imports: importMap.imports }
    });
    const entryModule = await import(toLoaderFileUrl(findHashedModule(distDirectory, "main.js")));
    assert.equal(await entryModule.shareThroughStore(), "ada");
  } finally {
    removeProject(projectDirectory);
  }
});
