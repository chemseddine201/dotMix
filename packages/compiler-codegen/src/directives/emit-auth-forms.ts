/**
 * @dotmix/compiler-codegen/directives/emit-auth-forms — Client codegen for auth, authorization, env, context, and form/CSRF/method directives.
 */

import type {
  AuthBlockNode,
  CanAnyBlockNode,
  CanBranch,
  CanChainNode,
  CannotBlockNode,
  ContextBlockNode,
  CsrfNode,
  EnvGateNode,
  FieldErrorNode,
  FieldValidNode,
  FormErrorsNode,
  GuestBlockNode,
  MethodNode
} from "@dotmix/ast";
import { indentLines } from "../types.js";
import type { CodegenContext } from "../context.js";
import { emitFragRenderFn } from "./emit-control.js";

function emitBoundFragRender(
  ctx: CodegenContext,
  asIdentifier: string | null,
  nodes: AuthBlockNode["consequent"],
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean,
  getterPrefix: string,
  fragPrefix: string
): string {
  const paramVar = ctx.nextId(getterPrefix);
  const nextGetters = new Map(loopGetters);
  if (asIdentifier) {
    nextGetters.set(asIdentifier, paramVar);
  }
  return emitFragRenderFn(ctx, nodes, nextGetters, inSvg, fragPrefix, [paramVar]);
}

function buildCanPropsLiteral(
  ctx: CodegenContext,
  branch: CanBranch,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean,
  fallbackExpr: string | null,
  notFlag: boolean = false
): string {
  const actionJs = ctx.emitExpr(branch.rawAction, branch.action, loopGetters);
  const props: string[] = [`I: (${actionJs})`];
  if (branch.subject) {
    props.push(`get this() { return (${ctx.emitExpr(branch.rawSubject ?? "", branch.subject, loopGetters)}); }`);
  } else if (branch.subjectType) {
    props.push(`a: (${ctx.emitExpr(branch.rawSubjectType ?? "", branch.subjectType, loopGetters)})`);
  }
  if (branch.field) {
    props.push(`field: (${ctx.emitExpr(branch.rawField ?? "", branch.field, loopGetters)})`);
  }
  if (notFlag) {
    props.push(`not: true`);
  }
  const childRender = emitFragRenderFn(ctx, branch.body, loopGetters, inSvg, "canFrag");
  props.push(`children: ${childRender}`);
  if (fallbackExpr) {
    props.push(`fallback: ${fallbackExpr}`);
  }
  return `{ ${props.join(", ")} }`;
}

export function emitAuthBlock(
  ctx: CodegenContext,
  node: AuthBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const authHelper = ctx.useHelper("__mixAuth");
  const optFields: string[] = [];
  if (node.guard) {
    optFields.push(`guard: (${ctx.emitExpr(node.rawGuard ?? "", node.guard, loopGetters)})`);
  }
  if (node.roles.length > 0) {
    const roleExprs = node.roles.map((roleAst, idx) =>
      `(${ctx.emitExpr(node.rawRoles[idx] ?? "", roleAst, loopGetters)})`
    );
    optFields.push(`roles: [${roleExprs.join(", ")}]`);
  } else if (node.roleExpression) {
    const roleJs = ctx.emitExpr(node.rawRoleExpression ?? "", node.roleExpression, loopGetters);
    optFields.push(`roles: Array.isArray(${roleJs}) ? (${roleJs}) : [${roleJs}]`);
  }
  const renderFn = emitBoundFragRender(ctx, node.asIdentifier, node.consequent, loopGetters, inSvg, "get_authUser", "authFrag");
  const elseFn = node.alternate ? emitFragRenderFn(ctx, node.alternate, loopGetters, inSvg, "elseFrag") : "null";
  return [
    `${authHelper}(`,
    `  ${parentVar},`,
    `  { ${optFields.join(", ")} },`,
    `  ${indentLines(renderFn, 2).trimStart()},`,
    `  ${elseFn}`,
    `);`
  ];
}

export function emitGuestBlock(
  ctx: CodegenContext,
  node: GuestBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const guestHelper = ctx.useHelper("__mixGuest");
  const guardArg = node.guard ? `(${ctx.emitExpr(node.rawGuard ?? "", node.guard, loopGetters)})` : "undefined";
  const renderFn = emitFragRenderFn(ctx, node.consequent, loopGetters, inSvg, "guestFrag");
  const elseFn = node.alternate ? emitFragRenderFn(ctx, node.alternate, loopGetters, inSvg, "elseFrag") : "null";
  return [
    `${guestHelper}(${parentVar}, ${guardArg}, ${indentLines(renderFn, 2).trimStart()}, ${elseFn});`
  ];
}

export function emitCanChain(
  ctx: CodegenContext,
  node: CanChainNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  if (node.branches.length === 0) return [];
  const canComp = ctx.useHelper("Can as __Can");
  let fallbackExpr: string | null = node.alternate
    ? emitFragRenderFn(ctx, node.alternate, loopGetters, inSvg, "canElseFrag")
    : null;

  for (let i = node.branches.length - 1; i >= 1; i--) {
    const branch = node.branches[i]!;
    const propsLiteral = buildCanPropsLiteral(ctx, branch, loopGetters, inSvg, fallbackExpr);
    fallbackExpr = `() => ${canComp}(${propsLiteral})`;
  }

  const rootProps = buildCanPropsLiteral(ctx, node.branches[0]!, loopGetters, inSvg, fallbackExpr);
  return [`__mountComponent(${canComp}, ${rootProps}, ${parentVar});`];
}

export function emitCannotBlock(
  ctx: CodegenContext,
  node: CannotBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const canComp = ctx.useHelper("Can as __Can");
  const branch: CanBranch = {
    action: node.action,
    rawAction: node.rawAction,
    subject: node.subject,
    rawSubject: node.rawSubject,
    subjectType: node.subjectType,
    rawSubjectType: node.rawSubjectType,
    field: node.field,
    rawField: node.rawField,
    body: node.consequent,
    span: node.span
  };
  const fallbackExpr = node.alternate
    ? emitFragRenderFn(ctx, node.alternate, loopGetters, inSvg, "cannotElseFrag")
    : null;
  const propsLiteral = buildCanPropsLiteral(ctx, branch, loopGetters, inSvg, fallbackExpr, true);
  return [`__mountComponent(${canComp}, ${propsLiteral}, ${parentVar});`];
}

export function emitCanAnyBlock(
  ctx: CodegenContext,
  node: CanAnyBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const canAnyHelper = ctx.useHelper("__mixCanAny");
  const actionsJs = ctx.emitExpr(node.rawActions, node.actions, loopGetters);
  const subjectJs = node.subject
    ? `() => (${ctx.emitExpr(node.rawSubject ?? "", node.subject, loopGetters)})`
    : node.subjectType
      ? `() => (${ctx.emitExpr(node.rawSubjectType ?? "", node.subjectType, loopGetters)})`
      : "() => \"all\"";
  const renderFn = emitFragRenderFn(ctx, node.consequent, loopGetters, inSvg, "canAnyFrag");
  const elseFn = node.alternate ? emitFragRenderFn(ctx, node.alternate, loopGetters, inSvg, "elseFrag") : "null";
  return [
    `${canAnyHelper}(${parentVar}, () => (${actionsJs}), ${subjectJs}, undefined, ${indentLines(renderFn, 2).trimStart()}, ${elseFn});`
  ];
}

export function emitEnvGate(
  ctx: CodegenContext,
  node: EnvGateNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  let isActive = false;
  if (node.mode === "dev") {
    isActive = ctx.mode === "development";
  } else if (node.mode === "production") {
    isActive = ctx.mode === "production";
  } else {
    isActive = node.environments.includes(ctx.mode);
  }
  if (isActive) {
    return ctx.emitTemplateNodes(node.consequent, parentVar, loopGetters, inSvg);
  }
  if (node.alternate) {
    return ctx.emitTemplateNodes(node.alternate, parentVar, loopGetters, inSvg);
  }
  return [];
}

export function emitContextBlock(
  ctx: CodegenContext,
  node: ContextBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const readCtxHelper = ctx.useHelper("__mixReadContext");
  const ctxExprJs = ctx.emitExpr(node.rawContextExpr, node.contextExpr, loopGetters);
  const renderFn = emitBoundFragRender(ctx, node.asIdentifier, node.consequent, loopGetters, inSvg, "get_ctxVal", "ctxFrag");
  const elseFn = node.alternate ? emitFragRenderFn(ctx, node.alternate, loopGetters, inSvg, "elseFrag") : "null";
  return [
    `${readCtxHelper}(${parentVar}, (${ctxExprJs}), ${indentLines(renderFn, 2).trimStart()}, ${elseFn});`
  ];
}

export function emitFieldError(
  ctx: CodegenContext,
  node: FieldErrorNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const errHelper = ctx.useHelper("__mixBindFieldError");
  const formJs = ctx.emitExpr(node.rawFormExpr, node.formExpr, loopGetters);
  const fieldJs = ctx.emitExpr(node.rawFieldName, node.fieldName, loopGetters);
  const renderArg =
    node.children.length > 0
      ? emitBoundFragRender(ctx, node.asIdentifier, node.children, loopGetters, inSvg, "get_fieldErr", "errFrag")
      : "null";
  return [`${errHelper}(${parentVar}, (${formJs}), (${fieldJs}), ${renderArg});`];
}

export function emitFormErrors(
  ctx: CodegenContext,
  node: FormErrorsNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const errsHelper = ctx.useHelper("__mixBindFormErrors");
  const formJs = ctx.emitExpr(node.rawFormExpr, node.formExpr, loopGetters);
  const renderFn = emitBoundFragRender(ctx, node.asIdentifier, node.children, loopGetters, inSvg, "get_formErrs", "errsFrag");
  return [`${errsHelper}(${parentVar}, (${formJs}), ${indentLines(renderFn, 2).trimStart()});`];
}

export function emitFieldValid(
  ctx: CodegenContext,
  node: FieldValidNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const validHelper = ctx.useHelper("__mixBindFieldValid");
  const formJs = ctx.emitExpr(node.rawFormExpr, node.formExpr, loopGetters);
  const fieldJs = ctx.emitExpr(node.rawFieldName, node.fieldName, loopGetters);
  const renderFn = emitFragRenderFn(ctx, node.children, loopGetters, inSvg, "validFrag");
  return [`${validHelper}(${parentVar}, (${formJs}), (${fieldJs}), ${indentLines(renderFn, 2).trimStart()});`];
}

export function emitCsrf(
  ctx: CodegenContext,
  _node: CsrfNode,
  parentVar: string
): string[] {
  const csrfHelper = ctx.useHelper("__mixCsrfInput");
  return [`${csrfHelper}(${parentVar});`];
}

export function emitMethod(
  ctx: CodegenContext,
  node: MethodNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>
): string[] {
  const methodHelper = ctx.useHelper("__mixMethodInput");
  const methodJs = ctx.emitExpr(node.rawValue, node.value, loopGetters);
  return [`${methodHelper}(${parentVar}, (${methodJs}));`];
}
