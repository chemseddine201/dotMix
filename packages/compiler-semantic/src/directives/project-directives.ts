/**
 * @dotmix/compiler-semantic/directives/project-directives — Virtual TypeScript projection utilities for directive AST nodes.
 */

import type { SourceSpan, TemplateNode } from "@dotmix/ast";
import { projectAuthUserBinding } from "./project-auth.js";

export interface AuthProviderExpr {
  readonly raw: string;
  readonly startOffset: number;
}

export interface ProjectionCallbacks {
  appendInternal(text: string): void;
  appendVerbatim(text: string, srcStart: number): void;
  appendOrigin?: ((text: string, originSpan: SourceSpan) => void) | undefined;
  emitTemplateChecks(nodes: readonly TemplateNode[], inSvg: boolean): void;
  nextInternalId?: (() => number) | undefined;
  readonly activeAuthProviderExpr?: AuthProviderExpr | undefined;
  /** Called for each auth binding typed through Register.auth (no same-file provider). */
  readonly recordRegisteredAuthBinding?: ((bindingName: string) => void) | undefined;
}

let fallbackInternalId = 0;

function emitVoidExpr(callbacks: ProjectionCallbacks, raw: string | null | undefined, startOffset: number): void {
  if (!raw) return;
  callbacks.appendInternal("  void (");
  callbacks.appendVerbatim(raw, startOffset);
  callbacks.appendInternal(");\n");
}

function emitScopedBody(
  callbacks: ProjectionCallbacks,
  ident: string | null | undefined,
  nodes: readonly TemplateNode[],
  inSvg: boolean
): void {
  if (ident) {
    callbacks.appendInternal(`  {\n    const ${ident} = undefined as unknown;\n`);
    callbacks.emitTemplateChecks(nodes, inSvg);
    callbacks.appendInternal("  }\n");
  } else {
    callbacks.emitTemplateChecks(nodes, inSvg);
  }
}

export function projectDirectiveTemplateNode(
  node: TemplateNode,
  inSvg: boolean,
  callbacks: ProjectionCallbacks
): boolean {
  const fallbackSpan: SourceSpan = node.span;
  const startOf = (expr: { start?: number } | null | undefined): number =>
    expr?.start ?? fallbackSpan.start.offset;
  const emitOrigin = (text: string, originSpan: SourceSpan): void => {
    if (callbacks.appendOrigin) callbacks.appendOrigin(text, originSpan);
    else callbacks.appendInternal(text);
  };
  const getNextId = (): number =>
    callbacks.nextInternalId ? callbacks.nextInternalId() : fallbackInternalId++;

  switch (node.type) {
    case "UnlessBlock":
      emitVoidExpr(callbacks, node.rawCondition, startOf(node.condition));
      callbacks.emitTemplateChecks(node.consequent, inSvg);
      if (node.alternate) callbacks.emitTemplateChecks(node.alternate, inSvg);
      return true;
    case "IsSetBlock": {
      const issetId = getNextId();
      const issetBinding = `__mix_isset_value_${issetId}`;
      callbacks.appendInternal(`  {\n    const ${issetBinding} = (`);
      callbacks.appendVerbatim(node.rawValue, startOf(node.value));
      callbacks.appendInternal(`);\n    if (${issetBinding} !== null && ${issetBinding} !== undefined) {\n`);
      if (node.asIdentifier) {
        callbacks.appendInternal("      const ");
        emitOrigin(node.asIdentifier, node.span);
        callbacks.appendInternal(` = ${issetBinding};\n      void ${node.asIdentifier};\n`);
      }
      callbacks.emitTemplateChecks(node.consequent, inSvg);
      callbacks.appendInternal("    }\n  }\n");
      if (node.alternate) callbacks.emitTemplateChecks(node.alternate, inSvg);
      return true;
    }
    case "SessionBlock":
      emitVoidExpr(callbacks, node.rawKey, startOf(node.key));
      emitScopedBody(callbacks, node.asIdentifier, node.consequent, inSvg);
      if (node.alternate) callbacks.emitTemplateChecks(node.alternate, inSvg);
      return true;
    case "IsEmptyBlock":
      emitVoidExpr(callbacks, node.rawValue, startOf(node.value));
      callbacks.emitTemplateChecks(node.consequent, inSvg);
      if (node.alternate) callbacks.emitTemplateChecks(node.alternate, inSvg);
      return true;
    case "SwitchBlock":
      emitVoidExpr(callbacks, node.rawSubject, startOf(node.subject));
      for (const caseBranch of node.cases) {
        emitVoidExpr(callbacks, caseBranch.rawCondition, startOf(caseBranch.condition));
        for (let idx = 0; idx < caseBranch.rawValues.length; idx++) {
          emitVoidExpr(callbacks, caseBranch.rawValues[idx], startOf(caseBranch.values[idx]));
        }
        callbacks.emitTemplateChecks(caseBranch.body, inSvg);
      }
      if (node.defaultBranch) callbacks.emitTemplateChecks(node.defaultBranch, inSvg);
      return true;
    case "EachExtBlock": {
      const indexName = node.indexIdentifier ?? "__idx";
      callbacks.appendInternal(`  {\n    const ${indexName}: number = 0;\n    void ${indexName};\n    for (const `);
      emitOrigin(node.itemIdentifier, node.span);
      callbacks.appendInternal(" of (");
      callbacks.appendVerbatim(node.rawCollection, startOf(node.collection));
      callbacks.appendInternal(`)) {\n      void ${node.itemIdentifier};\n`);
      if (node.rawKeyExpression) {
        callbacks.appendInternal("      void (");
        callbacks.appendVerbatim(node.rawKeyExpression, startOf(node.keyExpression));
        callbacks.appendInternal(");\n");
      }
      for (const control of node.controls) {
        emitVoidExpr(callbacks, control.rawCondition, startOf(control.condition));
      }
      callbacks.emitTemplateChecks(node.children, inSvg);
      callbacks.appendInternal("    }\n  }\n");
      emitVoidExpr(callbacks, node.rawRenderComponent, startOf(node.renderComponent));
      callbacks.emitTemplateChecks(node.empty, inSvg);
      return true;
    }
    case "ForBlock":
      emitVoidExpr(callbacks, node.rawFrom, startOf(node.from));
      emitVoidExpr(callbacks, node.rawTo, startOf(node.to));
      emitVoidExpr(callbacks, node.rawStep, startOf(node.step));
      emitVoidExpr(callbacks, node.rawTimes, startOf(node.times));
      emitScopedBody(callbacks, node.itemIdentifier, node.children, inSvg);
      return true;
    case "AuthBlock": {
      emitVoidExpr(callbacks, node.rawGuard, startOf(node.guard));
      if (node.asIdentifier) {
        projectAuthUserBinding(node, node.asIdentifier, inSvg, callbacks, getNextId());
      } else {
        callbacks.emitTemplateChecks(node.consequent, inSvg);
      }
      if (node.alternate) callbacks.emitTemplateChecks(node.alternate, inSvg);
      return true;
    }
    case "GuestBlock":
    case "EnvGate":
      callbacks.emitTemplateChecks(node.consequent, inSvg);
      if (node.alternate) callbacks.emitTemplateChecks(node.alternate, inSvg);
      return true;
    case "CanChain":
      for (const branch of node.branches) {
        emitVoidExpr(callbacks, branch.rawAction, startOf(branch.action));
        emitVoidExpr(callbacks, branch.rawSubject, startOf(branch.subject));
        callbacks.emitTemplateChecks(branch.body, inSvg);
      }
      if (node.alternate) callbacks.emitTemplateChecks(node.alternate, inSvg);
      return true;
    case "CannotBlock":
    case "CanAnyBlock":
      callbacks.emitTemplateChecks(node.consequent, inSvg);
      if (node.alternate) callbacks.emitTemplateChecks(node.alternate, inSvg);
      return true;
    case "ContextBlock":
      emitVoidExpr(callbacks, node.rawContextExpr, startOf(node.contextExpr));
      emitScopedBody(callbacks, node.asIdentifier, node.consequent, inSvg);
      if (node.alternate) callbacks.emitTemplateChecks(node.alternate, inSvg);
      return true;
    case "FieldError":
    case "FormErrors":
      emitVoidExpr(callbacks, node.rawFormExpr, startOf(node.formExpr));
      emitScopedBody(callbacks, node.asIdentifier, node.children, inSvg);
      return true;
    case "FieldValid":
    case "Once":
    case "Memo":
    case "Section":
    case "HasSection":
    case "SectionMissing":
    case "StackPush":
    case "Partial":
      callbacks.emitTemplateChecks(node.children, inSvg);
      return true;
    case "KeepAliveBlock": {
      const keepAliveId = getNextId();
      const activeKeyBinding = `__mix_keepalive_key_${keepAliveId}`;
      callbacks.appendInternal(`  {\n    const ${activeKeyBinding} = (`);
      callbacks.appendVerbatim(node.rawActiveKey, startOf(node.activeKey));
      callbacks.appendInternal(`);\n    void ${activeKeyBinding};\n`);
      emitVoidExpr(callbacks, node.rawMax, startOf(node.max));
      if (node.asIdentifier) {
        callbacks.appendInternal("    {\n      const ");
        emitOrigin(node.asIdentifier, node.span);
        callbacks.appendInternal(
          ` = undefined as unknown as (typeof ${activeKeyBinding} extends () => infer __MixKeepAliveKey ? (__MixKeepAliveKey extends string ? __MixKeepAliveKey : string) : (typeof ${activeKeyBinding} extends string ? typeof ${activeKeyBinding} : string));\n      void ${node.asIdentifier};\n`
        );
        callbacks.emitTemplateChecks(node.children, inSvg);
        callbacks.appendInternal("    }\n");
      } else {
        callbacks.emitTemplateChecks(node.children, inSvg);
      }
      callbacks.appendInternal("  }\n");
      return true;
    }
    case "Yield":
      callbacks.emitTemplateChecks(node.fallback, inSvg);
      return true;
    case "Include":
    case "IncludeFirst":
      callbacks.emitTemplateChecks(node.pending, inSvg);
      callbacks.emitTemplateChecks(node.fallback, inSvg);
      return true;
    case "Lazy":
      callbacks.emitTemplateChecks(node.children, inSvg);
      callbacks.emitTemplateChecks(node.fallback, inSvg);
      return true;
    default:
      return false;
  }
}
