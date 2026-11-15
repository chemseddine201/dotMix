/**
 * @dotmix/compiler-ssr/directives/emit-ssr-blocks — SSR codegen for control flow, switch, loops, auth/can, env, and context.
 */

import type {
  AuthBlockNode,
  CanAnyBlockNode,
  CanChainNode,
  CannotBlockNode,
  ContextBlockNode,
  EachExtNode,
  EnvGateNode,
  ForBlockNode,
  GuestBlockNode,
  IsEmptyBlockNode,
  IsSetBlockNode,
  SwitchBlockNode,
  TemplateNode,
  TemplateRenderFunctionNode,
  UnlessBlockNode
} from "@dotmix/ast";
import type { SsrEmitContext } from "./emit-ssr-attrs.js";

function emitBranchList(
  ctx: SsrEmitContext,
  nodes: readonly TemplateNode[],
  shadowed: ReadonlySet<string>
): void {
  for (const child of nodes) {
    ctx.emitNode(child, shadowed);
  }
}

export function emitSsrUnless(ctx: SsrEmitContext, node: UnlessBlockNode, shadowed: ReadonlySet<string>): void {
  const id = ctx.nextMarkerId();
  if (ctx.includeMarkers) ctx.pushCode(`__html += "<!--mix:unless:${id}-->";\n`);
  const condExpr = ctx.transformExpr(node.rawCondition, node.condition, shadowed);
  ctx.pushCode(`if (!(${condExpr})) {\n`);
  emitBranchList(ctx, node.consequent, shadowed);
  if (node.alternate) {
    ctx.pushCode(`} else {\n`);
    emitBranchList(ctx, node.alternate, shadowed);
  }
  ctx.pushCode(`}\n`);
  if (ctx.includeMarkers) ctx.pushCode(`__html += "<!--/mix:unless:${id}-->";\n`);
}

export function emitSsrIsSet(ctx: SsrEmitContext, node: IsSetBlockNode, shadowed: ReadonlySet<string>): void {
  const id = ctx.nextMarkerId();
  const valExpr = ctx.transformExpr(node.rawValue, node.value, shadowed);
  const boundVar = node.asIdentifier ?? `__isset_${id}`;
  const nextShadowed = new Set(shadowed);
  if (node.asIdentifier) nextShadowed.add(node.asIdentifier);
  ctx.pushCode(`{\n  const ${boundVar} = (${valExpr});\n`);
  ctx.pushCode(`  if (${boundVar} !== null && ${boundVar} !== undefined) {\n`);
  emitBranchList(ctx, node.consequent, nextShadowed);
  if (node.alternate) {
    ctx.pushCode(`  } else {\n`);
    emitBranchList(ctx, node.alternate, shadowed);
  }
  ctx.pushCode(`  }\n}\n`);
}

export function emitSsrIsEmpty(ctx: SsrEmitContext, node: IsEmptyBlockNode, shadowed: ReadonlySet<string>): void {
  ctx.requireHelper("isEmpty");
  const valExpr = ctx.transformExpr(node.rawValue, node.value, shadowed);
  ctx.pushCode(`if (__mixSsrIsEmpty(${valExpr})) {\n`);
  emitBranchList(ctx, node.consequent, shadowed);
  if (node.alternate) {
    ctx.pushCode(`} else {\n`);
    emitBranchList(ctx, node.alternate, shadowed);
  }
  ctx.pushCode(`}\n`);
}

export function emitSsrSwitch(ctx: SsrEmitContext, node: SwitchBlockNode, shadowed: ReadonlySet<string>): void {
  const id = ctx.nextMarkerId();
  if (ctx.includeMarkers) ctx.pushCode(`__html += "<!--mix:switch:${id}-->";\n`);
  const subjExpr = node.subject ? ctx.transformExpr(node.rawSubject ?? "", node.subject, shadowed) : "undefined";
  ctx.pushCode(`{\n  const __swSubj = (${subjExpr});\n`);
  for (let i = 0; i < node.cases.length; i++) {
    const branch = node.cases[i]!;
    const kw = i === 0 ? "if" : "} else if";
    if (branch.kind === "condition" && branch.condition) {
      const condExpr = ctx.transformExpr(branch.rawCondition ?? "", branch.condition, shadowed);
      ctx.pushCode(`  ${kw} (${condExpr}) {\n`);
    } else {
      const checks = branch.values.map((exprAst, idx) =>
        `Object.is(__swSubj, (${ctx.transformExpr(branch.rawValues[idx] ?? "", exprAst, shadowed)}))`
      );
      ctx.pushCode(`  ${kw} (${checks.length > 0 ? checks.join(" || ") : "false"}) {\n`);
    }
    emitBranchList(ctx, branch.body, shadowed);
  }
  if (node.defaultBranch) {
    ctx.pushCode(node.cases.length > 0 ? `  } else {\n` : `  {\n`);
    emitBranchList(ctx, node.defaultBranch, shadowed);
  }
  if (node.cases.length > 0 || node.defaultBranch) {
    ctx.pushCode(`  }\n`);
  }
  ctx.pushCode(`}\n`);
  if (ctx.includeMarkers) ctx.pushCode(`__html += "<!--/mix:switch:${id}-->";\n`);
}

export function emitSsrEachExt(ctx: SsrEmitContext, node: EachExtNode, shadowed: ReadonlySet<string>): void {
  const id = ctx.nextMarkerId();
  if (ctx.includeMarkers) ctx.pushCode(`__html += "<!--mix:each:${id}-->";\n`);
  const collExpr = ctx.transformExpr(node.rawCollection, node.collection, shadowed);
  let itemsCode = `(${collExpr}) || []`;
  if (node.rawSkipExpression || node.rawStopExpression) {
    ctx.requireHelper("eachPipeline");
    const optParts: string[] = [];
    if (node.rawSkipExpression) optParts.push(`skip: (${node.rawSkipExpression})`);
    if (node.rawStopExpression) optParts.push(`stop: (${node.rawStopExpression})`);
    itemsCode = `__mixSsrEachPipeline((${collExpr}) || [], { ${optParts.join(", ")} })`;
  }

  const indexVar = node.indexIdentifier || `__idx_${id}`;
  const nextShadowed = new Set(shadowed);
  nextShadowed.add(node.itemIdentifier);
  if (node.indexIdentifier) nextShadowed.add(node.indexIdentifier);
  const keyExpr = node.keyExpression
    ? ctx.transformExpr(node.rawKeyExpression ?? "", node.keyExpression, nextShadowed)
    : indexVar;

  ctx.pushCode(`{\n  const __list = ${itemsCode};\n`);
  if (node.empty.length > 0) {
    ctx.pushCode(`  if (__list.length === 0) {\n`);
    emitBranchList(ctx, node.empty, shadowed);
    ctx.pushCode(`  } else {\n`);
  }
  ctx.pushCode(`  let ${indexVar} = 0;\n`);
  ctx.pushCode(`  for (const ${node.itemIdentifier} of __list) {\n`);
  ctx.pushCode(`    const __key = (${keyExpr});\n`);
  if (ctx.includeMarkers) ctx.pushCode(`    __html += "<!--mix:item:" + __key + "-->";\n`);
  if (node.renderComponent) {
    const compExpr = ctx.transformExpr(node.rawRenderComponent ?? "", node.renderComponent, shadowed);
    const propKey = JSON.stringify(node.renderPropName ?? "item");
    ctx.pushCode(`    if (typeof ${compExpr} === "function") {\n`);
    ctx.pushCode(`      const __rowProps = { ${propKey}: ${node.itemIdentifier} };\n`);
    ctx.pushCode(`      __html += ${compExpr}.renderToString ? ${compExpr}.renderToString(__rowProps) : String(${compExpr}(__rowProps) ?? "");\n`);
    ctx.pushCode(`    }\n`);
  } else {
    emitBranchList(ctx, node.children, nextShadowed);
  }
  if (ctx.includeMarkers) ctx.pushCode(`    __html += "<!--/mix:item:" + __key + "-->";\n`);
  ctx.pushCode(`    ${indexVar}++;\n  }\n`);
  if (node.empty.length > 0) {
    ctx.pushCode(`  }\n`);
  }
  ctx.pushCode(`}\n`);
  if (ctx.includeMarkers) ctx.pushCode(`__html += "<!--/mix:each:${id}-->";\n`);
}

export function emitSsrFor(ctx: SsrEmitContext, node: ForBlockNode, shadowed: ReadonlySet<string>): void {
  const id = ctx.nextMarkerId();
  const iterVar = node.itemIdentifier ?? `__forIdx_${id}`;
  const nextShadowed = new Set(shadowed);
  if (node.itemIdentifier) nextShadowed.add(node.itemIdentifier);

  let rangeExpr: string;
  if (node.variant === "range" && node.from && node.to) {
    ctx.requireHelper("forRange");
    const fromJs = ctx.transformExpr(node.rawFrom ?? "", node.from, shadowed);
    const toJs = ctx.transformExpr(node.rawTo ?? "", node.to, shadowed);
    const stepArg = node.step ? `, (${ctx.transformExpr(node.rawStep ?? "", node.step, shadowed)})` : "";
    rangeExpr = `__mixSsrForRange((${fromJs}), (${toJs})${stepArg})`;
  } else {
    ctx.requireHelper("forTimes");
    const timesJs = node.times ? ctx.transformExpr(node.rawTimes ?? "", node.times, shadowed) : "0";
    rangeExpr = `__mixSsrForTimes((${timesJs}))`;
  }

  ctx.pushCode(`for (const ${iterVar} of ${rangeExpr}) {\n`);
  emitBranchList(ctx, node.children, nextShadowed);
  ctx.pushCode(`}\n`);
}

export function emitSsrAuth(ctx: SsrEmitContext, node: AuthBlockNode, shadowed: ReadonlySet<string>): void {
  const guardArg = node.guard ? `(${ctx.transformExpr(node.rawGuard ?? "", node.guard, shadowed)})` : "undefined";
  const rolesArray =
    node.roles.length > 0
      ? `[${node.roles.map((astItem, idx) => `(${ctx.transformExpr(node.rawRoles[idx] ?? "", astItem, shadowed)})`).join(", ")}]`
      : node.roleExpression
        ? `((__r) => Array.isArray(__r) ? __r : [__r])(${ctx.transformExpr(node.rawRoleExpression ?? "", node.roleExpression, shadowed)})`
        : "null";
  const userVar = node.asIdentifier ?? `__authUser_${ctx.nextMarkerId()}`;
  const nextShadowed = new Set(shadowed);
  if (node.asIdentifier) nextShadowed.add(node.asIdentifier);

  ctx.pushCode(`{\n  const __auth = __ctx?.auth;\n`);
  ctx.pushCode(`  const ${userVar} = __auth && typeof __auth.user === "function" ? __auth.user(${guardArg}) : __ctx?.user;\n`);
  ctx.pushCode(`  const __roles = ${rolesArray};\n`);
  ctx.pushCode(`  const __authed = ${userVar} !== null && ${userVar} !== undefined && (!__roles || (__auth && typeof __auth.hasAnyRole === "function" && __auth.hasAnyRole(${userVar}, __roles, ${guardArg})));\n`);
  ctx.pushCode(`  if (__authed) {\n`);
  emitBranchList(ctx, node.consequent, nextShadowed);
  if (node.alternate) {
    ctx.pushCode(`  } else {\n`);
    emitBranchList(ctx, node.alternate, shadowed);
  }
  ctx.pushCode(`  }\n}\n`);
}

export function emitSsrGuest(ctx: SsrEmitContext, node: GuestBlockNode, shadowed: ReadonlySet<string>): void {
  const guardArg = node.guard ? `(${ctx.transformExpr(node.rawGuard ?? "", node.guard, shadowed)})` : "undefined";
  ctx.pushCode(`{\n  const __isGuest = __ctx?.auth && typeof __ctx.auth.guest === "function" ? __ctx.auth.guest(${guardArg}) : (__ctx?.user === null || __ctx?.user === undefined);\n`);
  ctx.pushCode(`  if (__isGuest) {\n`);
  emitBranchList(ctx, node.consequent, shadowed);
  if (node.alternate) {
    ctx.pushCode(`  } else {\n`);
    emitBranchList(ctx, node.alternate, shadowed);
  }
  ctx.pushCode(`  }\n}\n`);
}

export function emitSsrCanChain(ctx: SsrEmitContext, node: CanChainNode, shadowed: ReadonlySet<string>): void {
  ctx.pushCode(`{\n  const __ability = __ctx?.ability;\n  let __canMatched = false;\n`);
  for (let i = 0; i < node.branches.length; i++) {
    const branch = node.branches[i]!;
    const actionJs = ctx.transformExpr(branch.rawAction, branch.action, shadowed);
    const subjJs = branch.subject
      ? ctx.transformExpr(branch.rawSubject ?? "", branch.subject, shadowed)
      : branch.subjectType
        ? ctx.transformExpr(branch.rawSubjectType ?? "", branch.subjectType, shadowed)
        : `"all"`;
    const fieldArg = branch.field ? `, (${ctx.transformExpr(branch.rawField ?? "", branch.field, shadowed)})` : "";
    const kw = i === 0 ? "if" : "} else if";
    ctx.pushCode(`  ${kw} (__ability && typeof __ability.can === "function" && __ability.can((${actionJs}), (${subjJs})${fieldArg})) {\n`);
    ctx.pushCode(`    __canMatched = true;\n`);
    emitBranchList(ctx, branch.body, shadowed);
  }
  if (node.branches.length > 0) ctx.pushCode(`  }\n`);
  if (node.alternate) {
    ctx.pushCode(`  if (!__canMatched) {\n`);
    emitBranchList(ctx, node.alternate, shadowed);
    ctx.pushCode(`  }\n`);
  }
  ctx.pushCode(`}\n`);
}

export function emitSsrCannot(ctx: SsrEmitContext, node: CannotBlockNode, shadowed: ReadonlySet<string>): void {
  const actionJs = ctx.transformExpr(node.rawAction, node.action, shadowed);
  const subjJs = node.subject
    ? ctx.transformExpr(node.rawSubject ?? "", node.subject, shadowed)
    : node.subjectType
      ? ctx.transformExpr(node.rawSubjectType ?? "", node.subjectType, shadowed)
      : `"all"`;
  const fieldArg = node.field ? `, (${ctx.transformExpr(node.rawField ?? "", node.field, shadowed)})` : "";
  ctx.pushCode(`{\n  const __allowed = Boolean(__ctx?.ability && typeof __ctx.ability.can === "function" && __ctx.ability.can((${actionJs}), (${subjJs})${fieldArg}));\n`);
  ctx.pushCode(`  if (!__allowed) {\n`);
  emitBranchList(ctx, node.consequent, shadowed);
  if (node.alternate) {
    ctx.pushCode(`  } else {\n`);
    emitBranchList(ctx, node.alternate, shadowed);
  }
  ctx.pushCode(`  }\n}\n`);
}

export function emitSsrCanAny(ctx: SsrEmitContext, node: CanAnyBlockNode, shadowed: ReadonlySet<string>): void {
  const actionsJs = ctx.transformExpr(node.rawActions, node.actions, shadowed);
  const subjJs = node.subject
    ? ctx.transformExpr(node.rawSubject ?? "", node.subject, shadowed)
    : node.subjectType
      ? ctx.transformExpr(node.rawSubjectType ?? "", node.subjectType, shadowed)
      : `"all"`;
  ctx.pushCode(`{\n  const __ab = __ctx?.ability;\n  const __acts = (${actionsJs}) || [];\n  const __subj = (${subjJs});\n`);
  ctx.pushCode(`  const __anyOk = Boolean(__ab && typeof __ab.can === "function" && __acts.some((act) => __ab.can(act, __subj)));\n`);
  ctx.pushCode(`  if (__anyOk) {\n`);
  emitBranchList(ctx, node.consequent, shadowed);
  if (node.alternate) {
    ctx.pushCode(`  } else {\n`);
    emitBranchList(ctx, node.alternate, shadowed);
  }
  ctx.pushCode(`  }\n}\n`);
}

export function emitSsrEnvGate(ctx: SsrEmitContext, node: EnvGateNode, shadowed: ReadonlySet<string>): void {
  const isActive =
    node.mode === "dev"
      ? ctx.mode === "development"
      : node.mode === "production"
        ? ctx.mode === "production"
        : node.environments.includes(ctx.mode);
  if (isActive) {
    emitBranchList(ctx, node.consequent, shadowed);
  } else if (node.alternate) {
    emitBranchList(ctx, node.alternate, shadowed);
  }
}

export function emitSsrContextBlock(ctx: SsrEmitContext, node: ContextBlockNode, shadowed: ReadonlySet<string>): void {
  const ctxExpr = ctx.transformExpr(node.rawContextExpr, node.contextExpr, shadowed);
  const boundVar = node.asIdentifier ?? `__ctxVal_${ctx.nextMarkerId()}`;
  const nextShadowed = new Set(shadowed);
  if (node.asIdentifier) nextShadowed.add(node.asIdentifier);
  ctx.pushCode(`{\n  const __ctxKey = (${ctxExpr});\n`);
  ctx.pushCode(`  const ${boundVar} = typeof __ctx?.getContext === "function" ? __ctx.getContext(__ctxKey) : __ctxKey?.defaultValue;\n`);
  ctx.pushCode(`  if (${boundVar} !== null && ${boundVar} !== undefined) {\n`);
  emitBranchList(ctx, node.consequent, nextShadowed);
  if (node.alternate) {
    ctx.pushCode(`  } else {\n`);
    emitBranchList(ctx, node.alternate, shadowed);
  }
  ctx.pushCode(`  }\n}\n`);
}

export function emitSsrRenderFunctionFallback(ctx: SsrEmitContext, node: TemplateRenderFunctionNode, shadowed: ReadonlySet<string>): void {
  emitBranchList(ctx, node.body, shadowed);
}
