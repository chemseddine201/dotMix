/**
 * @dotmix/compiler-codegen/context — Stateful codegen context for unique DOM identifiers, expression emission, and attributes.
 */

import type {
  TemplateNode,
  AttributeNode,
  ESTreeNode
} from "@dotmix/ast";
import { hasBareGetterRef, transformExpressionAstToJs, transformWithBareGetters } from "@dotmix/compiler-semantic";
import { emitDirectiveTemplateNode, emitElementDirectiveAttributes, hasElementDirectiveModifiers } from "./directives/index.js";
import {
  emitElement,
  emitDynamicElement,
  emitComponentCall,
  emitSlotOutlet
} from "./emit-elements.js";
import {
  emitIfBlock,
  emitEachBlock,
  emitAwaitBlock
} from "./emit-blocks.js";

export interface EmittedExprAnchor {
  readonly raw: string;
  readonly emitted: string;
  readonly srcOffset: number;
}

export const EXPR_MARK_START = "\uE000";
export const EXPR_MARK_MID = "\uE001";
export const EXPR_MARK_END = "\uE002";

export class CodegenContext {
  private counter = 0;
  readonly scopeAttr: string | undefined;
  readonly hmrEnabled: boolean;
  readonly hmrFunctions: ReadonlySet<string>;
  readonly mode: string;
  readonly filename: string;
  readonly trackSourceMaps: boolean;
  readonly exprAnchors: EmittedExprAnchor[] = [];
  readonly usedDirectiveHelpers = new Set<string>();

  constructor(
    scopeAttr: string | undefined,
    hmrEnabled: boolean,
    hmrFunctions: ReadonlySet<string>,
    mode: string = "development",
    filename: string = "Component.mix",
    trackSourceMaps: boolean = false
  ) {
    this.scopeAttr = scopeAttr;
    this.hmrEnabled = hmrEnabled;
    this.hmrFunctions = hmrFunctions;
    this.mode = mode;
    this.filename = filename;
    this.trackSourceMaps = trackSourceMaps;
  }

  markExprSpan(emittedJs: string, raw: string, srcOffset: number): string {
    if (!this.trackSourceMaps || srcOffset < 0 || emittedJs.length === 0) {
      return emittedJs;
    }
    const id = this.exprAnchors.length;
    this.exprAnchors.push({ raw, emitted: emittedJs, srcOffset });
    return `${EXPR_MARK_START}${id}${EXPR_MARK_MID}${emittedJs}${EXPR_MARK_END}`;
  }

  formatDevFile(): string {
    const norm = this.filename.replace(/\\/g, "/");
    if (norm.includes("/src/")) {
      return "src/" + norm.split("/src/")[1];
    }
    return norm.split("/").pop() ?? this.filename;
  }

  useHelper(importSpec: string): string {
    this.usedDirectiveHelpers.add(importSpec);
    const asIndex = importSpec.indexOf(" as ");
    return asIndex !== -1 ? importSpec.slice(asIndex + 4) : importSpec;
  }

  nextId(prefix: string): string {
    this.counter++;
    return `__${prefix}_${this.counter}`;
  }

  emitExpr(
    rawExpression: string,
    expressionAst: ESTreeNode,
    loopGetters: ReadonlyMap<string, string>
  ): string {
    const jsExpr = hasBareGetterRef(expressionAst)
      ? transformWithBareGetters(rawExpression, expressionAst, loopGetters)
      : transformExpressionAstToJs(rawExpression, expressionAst, loopGetters);
    const srcOffset = expressionAst.loc?.start.offset ?? expressionAst.start ?? -1;
    return this.markExprSpan(jsExpr, rawExpression, srcOffset);
  }

  emitEventHandler(
    attr: Extract<AttributeNode, { type: "EventBinding" }>,
    targetVar: string,
    loopGetters: ReadonlyMap<string, string>
  ): string {
    const expr = attr.handler;
    const raw = attr.rawHandler.trim();

    const jsExpr = this.emitExpr(raw, expr, loopGetters);
    if (
      expr.type === "Identifier" ||
      expr.type === "MemberExpression" ||
      expr.type === "ArrowFunctionExpression" ||
      expr.type === "FunctionExpression"
    ) {
      return [
        `__addEventListener(${targetVar}, ${JSON.stringify(attr.name)}, ($event) => {`,
        `  const __handler = (${jsExpr});`,
        `  return typeof __handler === "function" ? __handler($event) : __handler;`,
        `});`
      ].join("\n");
    }

    return [
      `__addEventListener(${targetVar}, ${JSON.stringify(attr.name)}, ($event) => {`,
      `  const event = $event;`,
      `  void event;`,
      `  return (${jsExpr});`,
      `});`
    ].join("\n");
  }

  emitElementAttributes(
    attributes: readonly AttributeNode[],
    elVar: string,
    loopGetters: ReadonlyMap<string, string>
  ): string[] {
    if (hasElementDirectiveModifiers(attributes)) {
      return emitElementDirectiveAttributes(this, attributes, elVar, loopGetters);
    }
    const lines: string[] = [];

    for (const attr of attributes) {
      switch (attr.type) {
        case "StaticAttribute": {
          const valLiteral = JSON.stringify(attr.value);
          lines.push(
            `__setAttribute(${elVar}, ${JSON.stringify(attr.name)}, ${valLiteral});`
          );
          break;
        }
        case "DynamicAttribute": {
          const jsExpr = this.emitExpr(
            attr.rawExpression,
            attr.expression,
            loopGetters
          );
          lines.push(
            `createEffect(() => { __setAttribute(${elVar}, ${JSON.stringify(attr.name)}, (${jsExpr})); });`
          );
          break;
        }
        case "DirectiveAttribute": {
          const jsExpr = this.emitExpr(
            attr.rawExpression,
            attr.expression,
            loopGetters
          );
          lines.push(
            `createEffect(() => { __setAttribute(${elVar}, ${JSON.stringify(attr.name)}, (${jsExpr})); });`
          );
          break;
        }
        case "EventBinding": {
          lines.push(this.emitEventHandler(attr, elVar, loopGetters));
          break;
        }
        case "RefBinding": {
          const jsExpr = this.emitExpr(
            attr.rawTarget,
            attr.target,
            loopGetters
          );
          lines.push(`__bindRef(${elVar}, (${jsExpr}));`);
          break;
        }
        case "BindBinding": {
          const jsTarget = this.emitExpr(
            attr.rawTarget,
            attr.target,
            loopGetters
          );
          if (attr.name === "checked") {
            lines.push(
              `__bindChecked(${elVar}, () => (typeof (${jsTarget}) === "function" ? (${jsTarget})() : (${jsTarget})), (__v) => { if (typeof (${jsTarget})?.set === "function") { (${jsTarget}).set(__v); } else { (${jsTarget}) = __v; } });`
            );
          } else {
            lines.push(
              `__bindValue(${elVar}, () => (typeof (${jsTarget}) === "function" ? (${jsTarget})() : (${jsTarget})), (__v) => { if (typeof (${jsTarget})?.set === "function") { (${jsTarget}).set(__v); } else { (${jsTarget}) = __v; } });`
            );
          }
          break;
        }
      }
    }

    return lines;
  }

  emitTemplateNodes(
    nodes: readonly TemplateNode[],
    parentVar: string,
    loopGetters: ReadonlyMap<string, string>,
    inSvg: boolean = false
  ): string[] {
    const lines: string[] = [];
    for (const node of nodes) {
      lines.push(...this.emitTemplateNode(node, parentVar, loopGetters, inSvg));
    }
    return lines;
  }

  emitTemplateNode(
    node: TemplateNode,
    parentVar: string,
    loopGetters: ReadonlyMap<string, string>,
    inSvg: boolean
  ): string[] {
    switch (node.type) {
      case "Text": {
        const textVar = this.nextId("txt");
        return [
          `const ${textVar} = __createTextNode(${JSON.stringify(node.value)});`,
          `__insertNode(${parentVar}, ${textVar});`
        ];
      }

      case "Comment": {
        const commentVar = this.nextId("cmt");
        return [
          `const ${commentVar} = __createComment(${JSON.stringify(node.value)});`,
          `__insertNode(${parentVar}, ${commentVar});`
        ];
      }

      case "Interpolation": {
        const textVar = this.nextId("interp");
        const jsExpr = this.emitExpr(
          node.rawExpression,
          node.expression,
          loopGetters
        );
        return [
          `const ${textVar} = __createTextNode("");`,
          `__insertNode(${parentVar}, ${textVar});`,
          `createEffect(() => { __setText(${textVar}, (${jsExpr})); });`
        ];
      }

      case "Element": {
        return emitElement(this, node, parentVar, loopGetters, inSvg);
      }

      case "DynamicElement": {
        return emitDynamicElement(this, node, parentVar, loopGetters, inSvg);
      }

      case "ComponentCall": {
        return emitComponentCall(this, node, parentVar, loopGetters);
      }

      case "IfBlock": {
        return emitIfBlock(this, node, parentVar, loopGetters, inSvg);
      }

      case "EachBlock": {
        return emitEachBlock(this, node, parentVar, loopGetters, inSvg);
      }

      case "SlotOutlet": {
        return emitSlotOutlet(this, node, parentVar, loopGetters, inSvg);
      }

      case "AwaitBlock": {
        return emitAwaitBlock(this, node, parentVar, loopGetters, inSvg);
      }

      default: {
        return emitDirectiveTemplateNode(this, node, parentVar, loopGetters, inSvg);
      }
    }
  }
}
