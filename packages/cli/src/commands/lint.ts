/**
 * @dotmix/cli — `mix lint` Command
 * Static analysis, unused import detection, slot consistency, and deprecated syntax audit.
 * Automated migration of legacy control-flow syntax with --fix.
 */

import fs from "node:fs";
import path from "node:path";
import type { SourceSpan } from "@dotmix/diagnostics";
import type { ParsedCliArgs } from "../args.js";
import { colors, banner } from "../terminal.js";
import { scanInputDirectory } from "../scanner.js";
import {
  isValidTemplateStyle,
  lintTemplateStyle,
  type TemplateStyle
} from "../directives/lint-template-style.js";

export type { TemplateStyle };
export { isValidTemplateStyle, lintTemplateStyle };

export interface LintIssue {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly severity: "error" | "warning";
  readonly rule: string;
  readonly message: string;
  readonly fixable: boolean;
  readonly span?: SourceSpan | undefined;
}

export interface LintResult {
  readonly success: boolean;
  readonly issues: readonly LintIssue[];
  readonly fixedCount: number;
}

export function lintSource(
  source: string,
  filename: string,
  templateStyle: TemplateStyle = "hybrid"
): LintIssue[] {
  const issues: LintIssue[] = [];
  const lines = source.split("\n");

  // 1. Check for deprecated control flow: {#if}, {:else}, {/if}, {#each}, {/each}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (/\{#(if|each)\b/.test(line)) {
      const match = line.match(/\{#(if|each)\b/)!;
      issues.push({
        file: filename,
        line: i + 1,
        col: (match.index ?? 0) + 1,
        severity: "warning",
        rule: "deprecated-control-flow",
        message: `Deprecated '{#${match[1]}}' syntax. Use canonical '{${match[1]}}' instead.`,
        fixable: true,
      });
    }

    if (/\{:(else|elseif)\b/.test(line)) {
      const match = line.match(/\{:(else|elseif)\b/)!;
      issues.push({
        file: filename,
        line: i + 1,
        col: (match.index ?? 0) + 1,
        severity: "warning",
        rule: "deprecated-control-flow",
        message: `Deprecated '{:${match[1]}}' syntax. Use canonical '{${match[1]}}' instead.`,
        fixable: true,
      });
    }

    if (/\{\/(if|each)\}/.test(line)) {
      const match = line.match(/\{\/(if|each)\}/)!;
      const canonical = match[1] === "if" ? "endif" : "endeach";
      issues.push({
        file: filename,
        line: i + 1,
        col: (match.index ?? 0) + 1,
        severity: "warning",
        rule: "deprecated-control-flow",
        message: `Deprecated '{/${match[1]}}' syntax. Use canonical '{${canonical}}' instead.`,
        fixable: true,
      });
    }

    // 2. Check for invalid JSX-style inline conditionals: {cond && <el ...>}
    if (/\{[^{}]*&&\s*<[a-zA-Z$]/.test(line)) {
      const match = line.match(/\{[^{}]*&&\s*<[a-zA-Z$]/)!;
      issues.push({
        file: filename,
        line: i + 1,
        col: (match.index ?? 0) + 1,
        severity: "error",
        rule: "no-jsx-conditional",
        message: "JSX-style '{condition && <Element/>}' is prohibited in dotMix templates. Use '{if condition} ... {endif}' instead.",
        fixable: false,
      });
    }
  }

  // 3. Check for unused component imports
  const importRegex = /import\s+([A-Z][a-zA-Z0-9]*)\s+from\s+["'][^"']+\.(?:mix|tix)["']/g;
  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(source)) !== null) {
    const compName = importMatch[1]!;
    // Search if compName is referenced in template as <CompName or in script
    const afterImport = source.slice(importMatch.index + importMatch[0].length);
    const tagRegex = new RegExp(`(?:<${compName}\\b|\\b${compName}\\b)`);
    if (!tagRegex.test(afterImport)) {
      // Find line number
      const before = source.slice(0, importMatch.index);
      const lineNum = before.split("\n").length;
      issues.push({
        file: filename,
        line: lineNum,
        col: 1,
        severity: "warning",
        rule: "unused-component-import",
        message: `Imported component '${compName}' is never used in template or script.`,
        fixable: false,
      });
    }
  }

  if (templateStyle !== "hybrid") {
    issues.push(...lintTemplateStyle(source, filename, templateStyle));
  }

  return issues;
}

export function fixSource(source: string): { fixedText: string; fixedCount: number } {
  let fixedText = source;
  let fixedCount = 0;

  // {#if expr} -> {if expr}
  fixedText = fixedText.replace(/\{#if\s+([^}]+)\}/g, (_, expr) => {
    fixedCount++;
    return `{if ${expr}}`;
  });

  // {:elseif expr} -> {elseif expr}
  fixedText = fixedText.replace(/\{:elseif\s+([^}]+)\}/g, (_, expr) => {
    fixedCount++;
    return `{elseif ${expr}}`;
  });

  // {:else} -> {else}
  fixedText = fixedText.replace(/\{:else\}/g, () => {
    fixedCount++;
    return `{else}`;
  });

  // {/if} -> {endif}
  fixedText = fixedText.replace(/\{\/if\}/g, () => {
    fixedCount++;
    return `{endif}`;
  });

  // {#each items as item, idx} -> {each (item, idx) in items}
  fixedText = fixedText.replace(/\{#each\s+([^ ]+)\s+as\s+([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)(?:\s*\([^)]*\))?\}/g, (_, list, item, idx) => {
    fixedCount++;
    return `{each (${item}, ${idx}) in ${list}}`;
  });

  // {#each items as item} -> {each item in items}
  fixedText = fixedText.replace(/\{#each\s+([^ ]+)\s+as\s+([a-zA-Z0-9_]+)(?:\s*\([^)]*\))?\}/g, (_, list, item) => {
    fixedCount++;
    return `{each ${item} in ${list}}`;
  });

  // {/each} -> {endeach}
  fixedText = fixedText.replace(/\{\/each\}/g, () => {
    fixedCount++;
    return `{endeach}`;
  });

  return { fixedText, fixedCount };
}

export function runLint(
  targetDir: string,
  shouldFix: boolean,
  templateStyle: TemplateStyle = "hybrid"
): LintResult {
  const { mixFiles } = scanInputDirectory(targetDir);
  const allIssues: LintIssue[] = [];
  let totalFixed = 0;

  for (const file of mixFiles) {
    const raw = fs.readFileSync(file, "utf-8");
    if (shouldFix) {
      const { fixedText, fixedCount } = fixSource(raw);
      if (fixedCount > 0) {
        fs.writeFileSync(file, fixedText, "utf-8");
        totalFixed += fixedCount;
      }
    }

    const currentSource = shouldFix ? fs.readFileSync(file, "utf-8") : raw;
    const issues = lintSource(currentSource, file, templateStyle);
    allIssues.push(...issues);
  }

  const hasErrors = allIssues.some((i) => i.severity === "error");
  return {
    success: !hasErrors,
    issues: allIssues,
    fixedCount: totalFixed,
  };
}

export async function lintCommand(parsed: ParsedCliArgs): Promise<number> {
  const targetDir = path.resolve(parsed.positional[0] || "src");
  const shouldFix = parsed.values.fix ?? false;
  const rawStyle = parsed.values.templateStyle ?? "hybrid";

  if (!isValidTemplateStyle(rawStyle)) {
    console.error(colors.red(`[ERROR] Invalid '--template-style' value '${rawStyle}'. Expected 'blocks', 'components', or 'hybrid'.`));
    return 2;
  }

  if (!fs.existsSync(targetDir)) {
    console.error(colors.red(`[ERROR] Directory '${targetDir}' not found.`));
    return 1;
  }

  const result = runLint(targetDir, shouldFix, rawStyle);

  if (parsed.values.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.success ? 0 : 1;
  }

  if (!parsed.values.silent) {
    console.log(banner("Linter & Static Analysis", `Scanning files in ${colors.cyan(path.relative(process.cwd(), targetDir) || ".")}`));

    if (result.fixedCount > 0) {
      console.log(`  ${colors.green("✓")} Automatically fixed ${colors.bold(String(result.fixedCount))} syntax issue(s).\n`);
    }

    if (result.issues.length === 0) {
      console.log(`  ${colors.green("✓")} 0 lint errors, 0 warnings. Code is clean and canonical.\n`);
      return 0;
    }

    for (const issue of result.issues) {
      const relFile = path.relative(process.cwd(), issue.file);
      const loc = colors.dim(`${relFile}:${issue.line}:${issue.col}`);
      const badge =
        issue.severity === "error"
          ? colors.red("error")
          : colors.yellow("warning");
      const rule = colors.dim(`[${issue.rule}]`);
      console.log(`  ${badge}  ${loc}  ${issue.message} ${rule}`);
    }

    const errorCount = result.issues.filter((i) => i.severity === "error").length;
    const warnCount = result.issues.filter((i) => i.severity === "warning").length;
    console.log(`\n  Found ${colors.bold(String(errorCount))} error(s) and ${colors.bold(String(warnCount))} warning(s).\n`);
  }

  return result.success ? 0 : 1;
}
