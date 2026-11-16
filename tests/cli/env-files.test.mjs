import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { loadPublicEnv } from "../../packages/cli/dist/env-files.js";

describe("CLI environment file loading", () => {
  it("loads .env files in precedence order and exposes only MIX_PUBLIC_ keys", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-env-files-"));
    const previousPublic = process.env.MIX_PUBLIC_FROM_PROCESS;
    const previousOverride = process.env.MIX_PUBLIC_SHARED;
    const previousSecret = process.env.PRIVATE_PROCESS_SECRET;
    try {
      fs.writeFileSync(
        path.join(tempDir, ".env"),
        [
          "# Comment line",
          "MIX_PUBLIC_BASE=base-value",
          "MIX_PUBLIC_SHARED=from-env",
          "MIX_PUBLIC_QUOTED=\"hello # quoted\"",
          "MIX_PUBLIC_SINGLE='single value'",
          "MIX_PUBLIC_INLINE=plain-value # trailing comment",
          "SECRET_KEY=never-expose",
          ""
        ].join("\n"),
        "utf8"
      );
      fs.writeFileSync(
        path.join(tempDir, ".env.local"),
        [
          "MIX_PUBLIC_SHARED=from-env-local",
          "LOCAL_SECRET=hidden-local"
        ].join("\n"),
        "utf8"
      );
      fs.writeFileSync(
        path.join(tempDir, ".env.production"),
        [
          "MIX_PUBLIC_SHARED=from-env-production",
          "MIX_PUBLIC_MODE_ONLY=prod-mode",
          "MODE_SECRET=hidden-prod"
        ].join("\n"),
        "utf8"
      );
      fs.writeFileSync(
        path.join(tempDir, ".env.production.local"),
        [
          "MIX_PUBLIC_SHARED=from-env-production-local"
        ].join("\n"),
        "utf8"
      );

      delete process.env.MIX_PUBLIC_FROM_PROCESS;
      delete process.env.MIX_PUBLIC_SHARED;
      process.env.PRIVATE_PROCESS_SECRET = "should-not-leak";

      const loaded = loadPublicEnv(tempDir, "production");
      assert.equal(loaded.MIX_PUBLIC_BASE, "base-value");
      assert.equal(loaded.MIX_PUBLIC_SHARED, "from-env-production-local");
      assert.equal(loaded.MIX_PUBLIC_QUOTED, "hello # quoted");
      assert.equal(loaded.MIX_PUBLIC_SINGLE, "single value");
      assert.equal(loaded.MIX_PUBLIC_INLINE, "plain-value");
      assert.equal(loaded.MIX_PUBLIC_MODE_ONLY, "prod-mode");
      assert.equal("SECRET_KEY" in loaded, false);
      assert.equal("LOCAL_SECRET" in loaded, false);
      assert.equal("MODE_SECRET" in loaded, false);
      assert.equal("PRIVATE_PROCESS_SECRET" in loaded, false);

      process.env.MIX_PUBLIC_SHARED = "from-process-env";
      process.env.MIX_PUBLIC_FROM_PROCESS = "process-extra";
      const withProcessEnv = loadPublicEnv(tempDir, "production");
      assert.equal(withProcessEnv.MIX_PUBLIC_SHARED, "from-process-env");
      assert.equal(withProcessEnv.MIX_PUBLIC_FROM_PROCESS, "process-extra");
    } finally {
      if (previousPublic === undefined) delete process.env.MIX_PUBLIC_FROM_PROCESS;
      else process.env.MIX_PUBLIC_FROM_PROCESS = previousPublic;
      if (previousOverride === undefined) delete process.env.MIX_PUBLIC_SHARED;
      else process.env.MIX_PUBLIC_SHARED = previousOverride;
      if (previousSecret === undefined) delete process.env.PRIVATE_PROCESS_SECRET;
      else process.env.PRIVATE_PROCESS_SECRET = previousSecret;
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

