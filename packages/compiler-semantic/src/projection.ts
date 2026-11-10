/**
 * @mix/compiler-semantic/projection — Virtual .tix.ts TypeScript projection and module surface extractor.
 */

import * as ts from "typescript";
import { deepFreeze, SVG_ELEMENTS } from "@mix/ast";
import type {
  ComponentNode,
  TemplateNode,
  ElementNode,
  ComponentCallNode,
  DynamicElementNode,
  SourceSpan
} from "@mix/ast";
import { generateSourceMap } from "./sourcemap.js";
import type { SpanEntry, TypeProjectionResult } from "./types.js";

/**
 * Projects a `.tix` ComponentNode into a virtual `.tix.ts` file with a 100% byte-covered
 * `SourceMapSpanTable` (`verbatim | origin | internal`) per D-106, R-TC-01..03, and R-SP-01..05.
 */
export function projectTypeScript(
  ast: ComponentNode,
  originalSource?: string,
  filename: string = ast.span.file ?? "Component.tix"
): TypeProjectionResult {
  const chunks: string[] = [];
  const spanTable: SpanEntry[] = [];
  let cursor = 0;

  function appendInternal(text: string): void {
    if (text.length === 0) return;
    const start = cursor;
    cursor += text.length;
    chunks.push(text);
    spanTable.push({
      genStart: start,
      genEnd: cursor,
      srcStart: 0,
      srcEnd: 0,
      kind: "internal"
    });
  }

  function appendVerbatim(text: string, srcStart: number): void {
    if (text.length === 0) return;
    const start = cursor;
    cursor += text.length;
    chunks.push(text);
    spanTable.push({
      genStart: start,
      genEnd: cursor,
      srcStart,
      srcEnd: srcStart + text.length,
      kind: "verbatim"
    });
  }

  function appendOrigin(text: string, originSpan: SourceSpan): void {
    if (text.length === 0) return;
    const start = cursor;
    cursor += text.length;
    chunks.push(text);
    spanTable.push({
      genStart: start,
      genEnd: cursor,
      srcStart: originSpan.start.offset,
      srcEnd: originSpan.end.offset,
      kind: "origin"
    });
  }

  appendInternal(
    `import { VerifyProps, VerifyRef, ElementOf, SvgElementOf, AnyElement } from "@mix/runtime/typecheck";\n`
  );

  if (ast.script) {
    appendVerbatim(ast.script.content, ast.script.contentSpan.start.offset);
    appendInternal("\n");
  }

  appendInternal(`export function __mixTypecheckTemplate(): void {\n`);

  function emitAttributeChecks(
    ownerNode: ElementNode | ComponentCallNode | DynamicElementNode,
    inSvg: boolean
  ): void {
    if (ownerNode.type === "ComponentCall") {
      // R-TC-02: Emit VerifyProps(Comp, { ... }) with fresh object literal and verbatim prop expressions
      appendOrigin(`  VerifyProps(${ownerNode.name}, { `, ownerNode.span);
      let firstProp = true;
      for (const attr of ownerNode.attributes) {
        if (attr.type === "StaticAttribute") {
          if (!firstProp) appendInternal(", ");
          firstProp = false;
          // Emit attribute name verbatim so misspelled prop names map directly to the attribute span!
          appendVerbatim(attr.name, attr.span.start.offset);
          const isBooleanShorthand =
            attr.value === "" && attr.span.end.offset - attr.span.start.offset === attr.name.length;
          appendOrigin(`: ${isBooleanShorthand ? "true" : JSON.stringify(attr.value)}`, attr.span);
        } else if (attr.type === "DynamicAttribute") {
          if (!firstProp) appendInternal(", ");
          firstProp = false;
          appendVerbatim(attr.name, attr.span.start.offset);
          if (attr.templateValue) {
            appendInternal(": (() => {\n");
            emitTemplateChecks(attr.templateValue, inSvg);
            appendInternal("  }) as any");
          } else {
            appendInternal(": (");
            const exprStart = attr.expression.start ?? attr.span.start.offset;
            appendVerbatim(attr.rawExpression, exprStart);
            appendInternal(")");
          }
        } else if (attr.type === "EventBinding") {
          if (!firstProp) appendInternal(", ");
          firstProp = false;
          const propName = "on" + attr.name[0]!.toUpperCase() + attr.name.slice(1);
          appendOrigin(`${propName}: (`, attr.span);
          const exprStart = attr.handler.start ?? attr.span.start.offset;
          appendVerbatim(attr.rawHandler, exprStart);
          appendInternal(")");
        }
      }
      appendOrigin(` });\n`, ownerNode.span);
    }

    for (const attr of ownerNode.attributes) {
      if (attr.type === "RefBinding") {
        // R-TC-01: VerifyRef(ref, ElementOf("tag") | SvgElementOf("tag") | AnyElement())
        const exprStart = attr.target.start ?? attr.span.start.offset;
        appendOrigin(`  VerifyRef(`, attr.span);
        appendVerbatim(attr.rawTarget, exprStart);
        if (ownerNode.type === "DynamicElement") {
          appendOrigin(`, AnyElement());\n`, attr.span);
        } else if (ownerNode.type === "Element") {
          if (inSvg || SVG_ELEMENTS.has(ownerNode.tag)) {
            appendOrigin(`, SvgElementOf(${JSON.stringify(ownerNode.tag)}));\n`, attr.span);
          } else {
            appendOrigin(`, ElementOf(${JSON.stringify(ownerNode.tag)}));\n`, attr.span);
          }
        } else {
          appendOrigin(`, AnyElement());\n`, attr.span);
        }
      } else if (attr.type === "DynamicAttribute" && ownerNode.type !== "ComponentCall") {
        if (attr.templateValue) {
          emitTemplateChecks(attr.templateValue, inSvg);
        } else {
          const exprStart = attr.expression.start ?? attr.span.start.offset;
          appendInternal("  void (");
          appendVerbatim(attr.rawExpression, exprStart);
          appendInternal(");\n");
        }
      } else if (attr.type === "DirectiveAttribute") {
        const exprStart = attr.expression.start ?? attr.span.start.offset;
        appendInternal("  void (");
        appendVerbatim(attr.rawExpression, exprStart);
        appendInternal(");\n");
      } else if (attr.type === "EventBinding" && ownerNode.type !== "ComponentCall") {
        const exprStart = attr.handler.start ?? attr.span.start.offset;
        appendInternal("  void (");
        appendVerbatim(attr.rawHandler, exprStart);
        appendInternal(");\n");
      } else if (attr.type === "BindBinding") {
        const exprStart = attr.target.start ?? attr.span.start.offset;
        appendInternal("  void (");
        appendVerbatim(attr.rawTarget, exprStart);
        appendInternal(");\n");
      }
    }
  }

  function emitTemplateChecks(nodes: readonly TemplateNode[], inSvg: boolean): void {
    for (const node of nodes) {
      switch (node.type) {
        case "Element": {
          const nextSvg = inSvg || node.tag === "svg";
          emitAttributeChecks(node, nextSvg);
          emitTemplateChecks(node.children, nextSvg);
          break;
        }
        case "ComponentCall": {
          emitAttributeChecks(node, inSvg);
          emitTemplateChecks(node.children, inSvg);
          break;
        }
        case "DynamicElement": {
          const tagStart = node.tagExpression.start ?? node.span.start.offset;
          appendInternal("  void (");
          appendVerbatim(node.rawTagExpression, tagStart);
          appendInternal(");\n");
          emitAttributeChecks(node, inSvg);
          emitTemplateChecks(node.children, inSvg);
          break;
        }
        case "Interpolation": {
          const exprStart = node.expression.start ?? node.span.start.offset;
          appendInternal("  void (");
          appendVerbatim(node.rawExpression, exprStart);
          appendInternal(");\n");
          break;
        }
        case "IfBlock": {
          const condStart = node.condition.start ?? node.span.start.offset;
          appendInternal("  if (");
          appendVerbatim(node.rawCondition, condStart);
          appendInternal(") {\n");
          emitTemplateChecks(node.consequent, inSvg);
          appendInternal("  }\n");
          if (node.alternate) {
            if (Array.isArray(node.alternate)) {
              appendInternal("  else {\n");
              emitTemplateChecks(node.alternate, inSvg);
              appendInternal("  }\n");
            } else {
              emitTemplateChecks([node.alternate as TemplateNode], inSvg);
            }
          }
          break;
        }
        case "EachBlock": {
          const colStart = node.collection.start ?? node.span.start.offset;
          const keyStart = node.keyExpression.start ?? node.span.start.offset;
          const idxName = node.indexIdentifier ?? "__idx";
          appendInternal(`  {\n    const ${idxName}: number = 0;\n    void ${idxName};\n    for (const `);
          appendOrigin(node.itemIdentifier, node.span);
          appendInternal(" of (");
          appendVerbatim(node.rawCollection, colStart);
          appendInternal(")) {\n      void (");
          appendVerbatim(node.rawKeyExpression, keyStart);
          appendInternal(");\n");
          emitTemplateChecks(node.children, inSvg);
          appendInternal("    }\n  }\n");
          break;
        }
        case "Text":
        case "Comment":
          break;
        case "SlotOutlet": {
          emitTemplateChecks(node.fallback, inSvg);
          break;
        }
        case "AwaitBlock": {
          const exprStart = node.expression.start ?? node.span.start.offset;
          appendInternal("  void (");
          appendVerbatim(node.rawExpression, exprStart);
          appendInternal(");\n");
          emitTemplateChecks(node.pending, inSvg);
          if (node.thenIdentifier) {
            appendInternal(`  {\n    const ${node.thenIdentifier} = {} as any;\n`);
            emitTemplateChecks(node.thenBranch, inSvg);
            appendInternal("  }\n");
          } else {
            emitTemplateChecks(node.thenBranch, inSvg);
          }
          if (node.catchIdentifier) {
            appendInternal(`  {\n    const ${node.catchIdentifier} = {} as any;\n`);
            emitTemplateChecks(node.catchBranch, inSvg);
            appendInternal("  }\n");
          } else {
            emitTemplateChecks(node.catchBranch, inSvg);
          }
          break;
        }
      }
    }
  }

  emitTemplateChecks(ast.template, false);
  appendInternal("}\n");

  // Emit default export for the projected component so sibling .tix imports resolve its props contract
  const scriptAnalysis = analyzeScriptForComponentExport(ast.script?.content ?? "");
  if (!scriptAnalysis.hasDefaultExport) {
    if (scriptAnalysis.propsVarName) {
      appendInternal(
        `export default null as unknown as (_props: typeof ${scriptAnalysis.propsVarName}) => unknown;\n`
      );
    } else {
      appendInternal(`export default null as unknown as (_props?: Record<string, unknown>) => unknown;\n`);
    }
  }

  const code = chunks.join("");
  const virtualFilename = filename.endsWith(".ts") ? filename : `${filename}.ts`;
  const sourceMap = generateSourceMap(filename, originalSource ?? "", code, spanTable);

  return deepFreeze({
    code,
    virtualFilename,
    spanTable,
    sourceMap
  });
}

export function analyzeScriptForComponentExport(scriptCode: string): {
  hasDefaultExport: boolean;
  propsVarName: string | null;
} {
  if (!scriptCode.trim()) {
    return { hasDefaultExport: false, propsVarName: null };
  }
  const sf = ts.createSourceFile("script.ts", scriptCode, ts.ScriptTarget.ES2023, true, ts.ScriptKind.TS);
  let hasDefaultExport = false;
  let propsVarName: string | null = null;

  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt)) {
      hasDefaultExport = true;
    } else if (ts.canHaveModifiers(stmt)) {
      const mods = ts.getModifiers(stmt);
      if (
        mods &&
        mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
        mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)
      ) {
        hasDefaultExport = true;
      }
    }

    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (
          ts.isIdentifier(decl.name) &&
          decl.initializer &&
          ts.isCallExpression(decl.initializer) &&
          ts.isIdentifier(decl.initializer.expression) &&
          decl.initializer.expression.text === "defineProps"
        ) {
          propsVarName = decl.name.text;
        }
      }
    }
  }

  return { hasDefaultExport, propsVarName };
}

export function extractTixModuleSurface(rawSrc: string): string {
  const scriptOpenIdx = rawSrc.indexOf("<script");
  const scriptCloseIdx = rawSrc.lastIndexOf("</script>");
  if (scriptOpenIdx !== -1 && scriptCloseIdx !== -1 && scriptCloseIdx > scriptOpenIdx) {
    const openTagEnd = rawSrc.indexOf(">", scriptOpenIdx);
    if (openTagEnd !== -1 && openTagEnd < scriptCloseIdx) {
      const scriptBody = rawSrc.slice(openTagEnd + 1, scriptCloseIdx);
      const analysis = analyzeScriptForComponentExport(scriptBody);
      let exportLine = "";
      if (!analysis.hasDefaultExport) {
        exportLine = analysis.propsVarName
          ? `\nexport default null as unknown as (_props: typeof ${analysis.propsVarName}) => unknown;\n`
          : `\nexport default null as unknown as (_props?: Record<string, unknown>) => unknown;\n`;
      }
      return `${scriptBody}\n${exportLine}`;
    }
  }

  // Functional component syntax: use TypeScript's lexical scanner to locate `export default function ... (...) {`
  const scanner = ts.createScanner(ts.ScriptTarget.ES2023, true, ts.LanguageVariant.Standard, rawSrc);
  let tok = scanner.scan();
  while (tok !== ts.SyntaxKind.EndOfFileToken) {
    if (tok === ts.SyntaxKind.ExportKeyword) {
      tok = scanner.scan();
      if (tok === ts.SyntaxKind.DefaultKeyword) {
        tok = scanner.scan();
        if (tok === ts.SyntaxKind.AsyncKeyword) {
          tok = scanner.scan();
        }
        if (tok === ts.SyntaxKind.FunctionKeyword) {
          tok = scanner.scan();
          if (tok === ts.SyntaxKind.Identifier) {
            tok = scanner.scan();
          }
          // Skip optional type parameters `<...>`
          if (tok === ts.SyntaxKind.LessThanToken) {
            let angleDepth = 1;
            tok = scanner.scan();
            while (tok !== ts.SyntaxKind.EndOfFileToken && angleDepth > 0) {
              if (tok === ts.SyntaxKind.LessThanToken) angleDepth++;
              else if (tok === ts.SyntaxKind.GreaterThanToken) angleDepth--;
              tok = scanner.scan();
            }
          }
          if (tok === ts.SyntaxKind.OpenParenToken) {
            const openParenStart = scanner.getTokenPos();
            let parenDepth = 1;
            tok = scanner.scan();
            while (tok !== ts.SyntaxKind.EndOfFileToken && parenDepth > 0) {
              if (tok === ts.SyntaxKind.OpenParenToken) parenDepth++;
              else if (tok === ts.SyntaxKind.CloseParenToken) parenDepth--;
              if (parenDepth === 0) break;
              tok = scanner.scan();
            }
            const closeParenEnd = scanner.getTextPos();
            const rawParams = rawSrc.slice(openParenStart + 1, closeParenEnd - 1).trim();
            while (tok !== ts.SyntaxKind.EndOfFileToken && tok !== ts.SyntaxKind.OpenBraceToken) {
              tok = scanner.scan();
            }
            if (tok === ts.SyntaxKind.OpenBraceToken) {
              const beforeParams = rawSrc.slice(0, openParenStart);
              const normalizedParams =
                rawParams.length === 0
                  ? "_props?: Record<string, unknown>"
                  : rawParams.includes(":")
                    ? rawParams
                    : `${rawParams}?: Record<string, unknown>`;
              return `${beforeParams}(${normalizedParams}): unknown { return null; }\n`;
            }
          }
        }
      }
      continue;
    }
    tok = scanner.scan();
  }

  return `${rawSrc}\nexport default null as unknown as (props?: Record<string, unknown>) => unknown;\n`;
}
