/**
 * @dotmix/cli — `mix check` Command
 */

import type { ParsedCliArgs } from "../args.js";
import { resolveCommandOptions } from "../config.js";
import { check as runCheck } from "../check.js";
import { colors } from "../terminal.js";

export async function checkCommand(parsed: ParsedCliArgs): Promise<number> {
  const options = await resolveCommandOptions(parsed, process.cwd());
  const target = options.check.target;
  const isJson = parsed.values.format === "json" || Boolean(parsed.values.json);
  const checkOpts: Record<string, unknown> = { debug: parsed.values.debug, silent: isJson };
  if (target) {
    if (target.endsWith(".mix") || target.endsWith(".tix")) {
      checkOpts.files = [target];
    } else {
      checkOpts.dir = target;
    }
  }

  const res = runCheck(checkOpts);

  if (isJson) {
    console.log(JSON.stringify({
      success: res.success,
      warningsCount: res.warningsCount,
      errorsCount: res.success ? 0 : 1,
      diagnostics: []
    }));
    return res.success ? 0 : 1;
  }

  if (!res.success) {
    return 1;
  }

  if (!parsed.values.silent) {
    console.log(`\n${colors.green("✓")} Mix check passed with 0 errors (${res.warningsCount} warnings).`);
  }
  return 0;
}
