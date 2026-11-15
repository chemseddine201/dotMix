/* global setTimeout */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createDevServer } from "../../node_modules/@dotmix/cli/dist/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, "fixtures/test-app");

describe("Gate 36 (T-36.0): Watcher Idle Reads Invariant (D-156)", () => {
  it("idle server makes zero file-content reads for 3 seconds", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-watcher-test-"));
    fs.cpSync(fixtureDir, tmpDir, { recursive: true });

    let contentReads = 0;
    let counting = false;

    const origReadFileSync = fs.readFileSync;
    const origReadFile = fs.readFile;

    fs.readFileSync = function (targetPath, ...args) {
      if (counting && typeof targetPath === "string" && targetPath.startsWith(tmpDir)) {
        contentReads++;
      }
      return origReadFileSync.apply(this, [targetPath, ...args]);
    };

    fs.readFile = function (targetPath, ...args) {
      if (counting && typeof targetPath === "string" && targetPath.startsWith(tmpDir)) {
        contentReads++;
      }
      return origReadFile.apply(this, [targetPath, ...args]);
    };

    let server;
    try {
      server = await createDevServer({
        rootDir: tmpDir,
        port: 0,
        silent: true
      });

      // Let initial startup settle for 500ms
      await new Promise((r) => setTimeout(r, 500));

      // Begin counting idle file reads
      counting = true;
      contentReads = 0;

      // Wait 3 seconds
      await new Promise((r) => setTimeout(r, 3000));

      counting = false;

      // Assert zero content reads on idle server
      assert.strictEqual(
        contentReads,
        0,
        `Expected 0 file content reads while idle for 3s, but observed ${contentReads} reads`
      );
    } finally {
      counting = false;
      fs.readFileSync = origReadFileSync;
      fs.readFile = origReadFile;
      if (server) await server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
