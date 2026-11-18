/**
 * @dotmix/cli — `mix create` and `mix init` Command
 */

import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { create as runCreate, type CreateOptions, type TemplateVariant, detectPackageManager } from "../create.js";
import type { ParsedCliArgs } from "../args.js";
import { colors } from "../terminal.js";

export async function createCommand(parsed: ParsedCliArgs): Promise<number> {
  let projectName = parsed.positional[0];
  let template: TemplateVariant = "standard";
  let typescript = !parsed.values.js;
  let styleFormat: CreateOptions["styleFormat"] = "scss";
  let git = Boolean(parsed.values.git);
  let install = Boolean(parsed.values.install);
  const packageManager = parsed.values.packageManager;

  // Interactive wizard when in interactive TTY and no project name provided
  if (!projectName && process.stdin.isTTY && !parsed.values.json && !parsed.values.silent) {
    const rl = readline.createInterface({ input, output });
    try {
      const nameAnswer = await rl.question(colors.bold("Project name (my-mix-app): "));
      projectName = nameAnswer.trim() || "my-mix-app";

      const templateAnswer = await rl.question(colors.bold("Template [minimal | standard | showcase | sync-crdt] (standard): "));
      const tNorm = templateAnswer.trim().toLowerCase();
      if (tNorm === "minimal" || tNorm === "showcase" || tNorm === "sync-crdt") {
        template = tNorm;
      }

      const langAnswer = await rl.question(colors.bold("Use TypeScript? (Y/n): "));
      typescript = langAnswer.trim().toLowerCase() !== "n";

      const styleAnswer = await rl.question(colors.bold("Style format [scss | less | css | sass | pcss] (scss): "));
      const sNorm = styleAnswer.trim().toLowerCase();
      if (sNorm === "less" || sNorm === "css" || sNorm === "sass" || sNorm === "pcss") {
        styleFormat = sNorm;
      }

      const gitAnswer = await rl.question(colors.bold("Initialize Git repository? (Y/n): "));
      git = gitAnswer.trim().toLowerCase() !== "n";

      const installAnswer = await rl.question(colors.bold("Install dependencies? (y/N): "));
      install = installAnswer.trim().toLowerCase() === "y";
    } finally {
      rl.close();
    }
  }

  if (!projectName) {
    projectName = "my-mix-app";
  }

  if (parsed.values.template) {
    const t = parsed.values.template.toLowerCase();
    if (t === "minimal" || t === "standard" || t === "showcase" || t === "sync-crdt") {
      template = t as TemplateVariant;
    }
  }

  if (parsed.values.less) styleFormat = "less";
  else if (parsed.values.css) styleFormat = "css";
  else if (parsed.values.sass) styleFormat = "sass";
  else if (parsed.values.pcss) styleFormat = "pcss";

  let targetDir: string | undefined;
  if (parsed.values.target) {
    const baseTarget = path.resolve(parsed.values.target);
    targetDir = path.basename(baseTarget) === projectName ? baseTarget : path.join(baseTarget, projectName);
  }

  const res = runCreate({
    projectName,
    targetDir,
    typescript,
    styleFormat,
    template,
    git,
    install,
    packageManager
  });

  if (parsed.values.json) {
    console.log(JSON.stringify({
      success: true,
      projectName,
      template,
      targetDir: res.targetDir,
      filesCount: res.createdFiles.length,
      git: res.gitInitialized,
      installed: res.dependenciesInstalled
    }));
    return 0;
  }

  if (!parsed.values.silent) {
    const pm = packageManager || detectPackageManager();
    console.log(`\n${colors.green("✓")} Created ${template} Mix project '${projectName}' in ${res.targetDir}`);
    console.log(`  Scaffolded ${res.createdFiles.length} files (${typescript ? "TypeScript .tix" : "JavaScript .mix"}, ${template === "minimal" || template === "sync-crdt" ? "inline CSS" : styleFormat.toUpperCase() + " styles"}).`);
    if (res.gitInitialized) {
      console.log(`  ${colors.green("✓")} Initialized Git repository.`);
    }
    if (res.dependenciesInstalled) {
      console.log(`  ${colors.green("✓")} Installed dependencies with ${pm}.`);
    }
    console.log(`\nNext steps:\n  cd ${path.relative(process.cwd(), res.targetDir) || "."}\n  ${pm} install\n  ${pm} run dev\n`);
  }
  return 0;
}
