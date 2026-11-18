/**
 * @dotmix/cli/directives/lint-template-style — AST-based `--template-style` linter.
 * Zero regular expressions: inspects parsed AST node `form` and import-bound directive components via the canonical registry.
 */

import { walk, type ASTNode } from "@dotmix/ast";
import { parse } from "@dotmix/compiler-frontend";
import {
  analyze,
  DIRECTIVE_SPECS,
  getBranchComponentSpecs,
  getComponentDirectiveSpec,
  isDirectiveComponentName,
  isValidDirectiveImportSource,
  type DirectiveSpec
} from "@dotmix/compiler-semantic";
import type { SourceSpan } from "@dotmix/diagnostics";

export type TemplateStyle = "blocks" | "components" | "hybrid";

export interface TemplateStyleIssue {
  readonly file: string;
  readonly line: number;
  readonly col: number;
  readonly severity: "error" | "warning";
  readonly rule: "template-style";
  readonly message: string;
  readonly fixable: false;
  readonly span: SourceSpan;
}

const VALID_STYLES: ReadonlySet<string> = new Set(["blocks", "components", "hybrid"]);

export function isValidTemplateStyle(value: string): value is TemplateStyle {
  return VALID_STYLES.has(value);
}

const DIRECTIVE_IR_KIND_SET: ReadonlySet<string> = new Set([
  "IfBlock",
  "EachBlock",
  "AwaitBlock",
  ...DIRECTIVE_SPECS.map((s) => s.irKind)
]);

function resolveSpecForIrNode(node: ASTNode): DirectiveSpec | undefined {
  if (node.type === "EnvGate") {
    return DIRECTIVE_SPECS.find((s) => s.id === node.mode);
  }
  if (node.type === "StackPush") {
    return DIRECTIVE_SPECS.find((s) => s.id === node.operation);
  }
  return DIRECTIVE_SPECS.find((s) => s.irKind === node.type);
}

function getDirectiveForm(node: ASTNode): "block" | "component" | null {
  if (!DIRECTIVE_IR_KIND_SET.has(node.type)) {
    return null;
  }
  if ("form" in node && (node.form === "block" || node.form === "component")) {
    return node.form;
  }
  if (node.type === "IfBlock" || node.type === "EachBlock" || node.type === "AwaitBlock") {
    return "block";
  }
  return null;
}

export function lintTemplateStyle(
  source: string,
  filename: string,
  style: TemplateStyle
): TemplateStyleIssue[] {
  if (style === "hybrid") {
    return [];
  }

  const issues: TemplateStyleIssue[] = [];
  let ast: ReturnType<typeof parse>;
  let desc: ReturnType<typeof analyze>;

  try {
    ast = parse(source, { filename });
    desc = analyze(ast, {
      filename,
      source,
      throwOnError: false,
      warnLegacyControlFlow: false
    });
  } catch {
    return issues;
  }

  walk(desc.ast, {
    enter(node: ASTNode, parent: ASTNode | null): void {
      if (node.type === "IfBlock" && parent?.type === "IfBlock") {
        // Do not double-report chained {elseif} nodes belonging to an already-visited {if} chain.
        return;
      }

      const form = getDirectiveForm(node);
      if (form !== null) {
        if (style === "components" && form === "block") {
          const spec = resolveSpecForIrNode(node);
          const blockLabel = spec ? `{${spec.blockOpen}}` : node.type;
          const compLabel = spec ? `<${spec.componentName}>` : "component form";
          issues.push({
            file: filename,
            line: node.span.start.line,
            col: node.span.start.column,
            severity: "error",
            rule: "template-style",
            message: `Block directive '${blockLabel}' is disallowed under '--template-style components'. Use '${compLabel}' instead.`,
            fixable: false,
            span: node.span
          });
        } else if (style === "blocks" && form === "component") {
          const spec = resolveSpecForIrNode(node);
          const compLabel = spec ? `<${spec.componentName}>` : node.type;
          const blockLabel = spec ? `{${spec.blockOpen}}` : "block form";
          issues.push({
            file: filename,
            line: node.span.start.line,
            col: node.span.start.column,
            severity: "error",
            rule: "template-style",
            message: `Component directive '${compLabel}' is disallowed under '--template-style blocks'. Use '${blockLabel}' instead.`,
            fixable: false,
            span: node.span
          });
        }
        return;
      }

      if (style === "blocks" && node.type === "ComponentCall") {
        if (!isDirectiveComponentName(node.name)) {
          return;
        }
        const importSource = desc.imports.get(node.name);
        if (!importSource || !isValidDirectiveImportSource(node.name, importSource)) {
          return;
        }

        const mainSpec = getComponentDirectiveSpec(node.name);
        if (mainSpec) {
          // Real runtime components (<Can> without branch children, <KeepAlive>) are exceptions (G5).
          if (mainSpec.isRuntimeComponent) {
            return;
          }
          issues.push({
            file: filename,
            line: node.span.start.line,
            col: node.span.start.column,
            severity: "error",
            rule: "template-style",
            message: `Component directive '<${node.name}>' is disallowed under '--template-style blocks'. Use '{${mainSpec.blockOpen}}' instead.`,
            fixable: false,
            span: node.span
          });
          return;
        }

        const branchSpecs = getBranchComponentSpecs(node.name);
        if (branchSpecs.length > 0 && parent?.type !== "ComponentCall") {
          const marker = branchSpecs[0]?.blockMarker;
          const hint = marker ? `{${marker}}` : "block form";
          issues.push({
            file: filename,
            line: node.span.start.line,
            col: node.span.start.column,
            severity: "error",
            rule: "template-style",
            message: `Component directive '<${node.name}>' is disallowed under '--template-style blocks'. Use '${hint}' instead.`,
            fixable: false,
            span: node.span
          });
        }
      }
    }
  });

  return issues;
}
