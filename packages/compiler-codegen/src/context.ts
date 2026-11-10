/**
 * @mix/compiler-codegen/context — Stateful codegen context for unique DOM identifiers, expression emission, and attributes.
 */

import type {
  TemplateNode,
  AttributeNode,
  ESTreeNode
} from "@mix/ast";
import { transformExpressionAstToJs } from "@mix/compiler-semantic";
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

export class CodegenContext {
  private counter = 0;
  readonly scopeAttr: string | undefined;
  readonly hmrEnabled: boolean;
  readonly hmrFunctions: ReadonlySet<string>;

  constructor(
    scopeAttr: string | undefined,
    hmrEnabled: boolean,
    hmrFunctions: ReadonlySet<string>
  ) {
    this.scopeAttr = scopeAttr;
    this.hmrEnabled = hmrEnabled;
    this.hmrFunctions = hmrFunctions;
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
    return transformExpressionAstToJs(rawExpression, expressionAst, loopGetters);
  }

  emitEventHandler(
    attr: Extract<AttributeNode, { type: "EventBinding" }>,
    targetVar: string,
    loopGetters: ReadonlyMap<string, string>
  ): string {
    const expr = attr.handler;
    const raw = attr.rawHandler.trim();

    if (
      this.hmrEnabled &&
      expr.type === "Identifier" &&
      typeof expr.name === "string" &&
      this.hmrFunctions.has(expr.name)
    ) {
      return `__addEventListener(${targetVar}, ${JSON.stringify(attr.name)}, __hmr.trampoline(${JSON.stringify(expr.name)}));`;
    }

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
    }
  }
}
