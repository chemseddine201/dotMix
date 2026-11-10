import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliBinPath = path.resolve(__dirname, "../../packages/cli/dist/bin.js");

describe("Gate 29 (T-29.3): Formatted CLI Diagnostics (Code Frame, file:line:col, Error Code, Docs Link & No Raw Stack Trace)", () => {
  it("1. `mix check` and `mix build` on a broken component print code frame, file:line:col, error code, and docs link with zero raw stack trace", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-diag-format-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const brokenFile = path.join(srcDir, "Broken.mix");
    fs.writeFileSync(
      brokenFile,
      `<script>
  const count = signal(0);
</script>
<div class="broken-card">
  <span>{count() + }</span>
</div>
`,
      "utf-8"
    );

    try {
      for (const cmdArgs of [
        ["check", brokenFile],
        ["build", srcDir, path.join(tmpDir, "dist")]
      ]) {
        const proc = spawnSync(
          globalThis.process.execPath,
          [cliBinPath, ...cmdArgs],
          { cwd: tmpDir, encoding: "utf-8" }
        );

        assert.strictEqual(proc.status, 1, `Expected exit code 1 for ${cmdArgs.join(" ")}`);
        const combined = `${proc.stdout}\n${proc.stderr}`;

        // 1. Error code & file:line:col
        assert.ok(
          combined.includes("MIX_ERR_PARSE_SYNTAX"),
          `Expected diagnostic code MIX_ERR_PARSE_SYNTAX in output:\n${combined}`
        );
        assert.ok(
          /Broken\.mix:5:\d+/.test(combined),
          `Expected Broken.mix:5:<col> location in output:\n${combined}`
        );

        // 2. Source code frame with line number, pipe, and caret underline
        assert.ok(
          combined.includes("5 |   <span>{count() + }</span>") && combined.includes("^"),
          `Expected formatted code frame with line 5 and caret in output:\n${combined}`
        );

        // 3. Docs link
        assert.ok(
          combined.includes("https://mix-framework.dev/docs/errors#MIX_ERR_PARSE_SYNTAX"),
          `Expected docs link for MIX_ERR_PARSE_SYNTAX in output:\n${combined}`
        );

        // 4. Never prints a raw stack trace without --debug
        assert.strictEqual(
          /\bat\s+[A-Za-z0-9_$.]+\s+\(/.test(combined),
          false,
          `CLI must never print a raw stack trace without --debug, got:\n${combined}`
        );
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("2. Passing `--debug` restores the stack trace when diagnosing a broken component", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-diag-debug-"));
    const brokenFile = path.join(tmpDir, "Broken.mix");
    fs.writeFileSync(
      brokenFile,
      `<div><span>{broken + }</span></div>\n`,
      "utf-8"
    );

    try {
      const proc = spawnSync(
        globalThis.process.execPath,
        [cliBinPath, "check", brokenFile, "--debug"],
        { cwd: tmpDir, encoding: "utf-8" }
      );

      assert.strictEqual(proc.status, 1);
      const combined = `${proc.stdout}\n${proc.stderr}`;
      assert.ok(
        /\bat\s+/.test(combined),
        `Expected --debug to include stack trace frames ('at ...'), got:\n${combined}`
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

