/**
 * @dotmix/compiler-codegen/directives/emit-control — Client codegen for conditionals, switch, extended loops, and bounded for loops.
 */

import type {
  EachExtNode,
  ForBlockNode,
  IsEmptyBlockNode,
  IsSetBlockNode,
  SwitchBlockNode,
  TemplateNode,
  TemplateRenderFunctionNode,
  UnlessBlockNode
} from "@dotmix/ast";
import { indentLines } from "../types.js";
import type { CodegenContext } from "../context.js";

export function emitFragRenderFn(
  ctx: CodegenContext,
  nodes: readonly TemplateNode[],
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean,
  fragPrefix: string = "branchFrag",
  paramList: readonly string[] = []
): string {
  const fragVar = ctx.nextId(fragPrefix);
  const voidStmts = paramList.map((paramName) => `void ${paramName};`);
  const bodyLines = [
    ...voidStmts,
    `const ${fragVar} = document.createDocumentFragment();`,
    ...ctx.emitTemplateNodes(nodes, fragVar, loopGetters, inSvg),
    `return [...${fragVar}.childNodes];`
  ];
  return `(${paramList.join(", ")}) => {\n${indentLines(bodyLines.join("\n"), 2)}\n}`;
}

export function emitUnlessBlock(
  ctx: CodegenContext,
  node: UnlessBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const condJs = ctx.emitExpr(node.rawCondition, node.condition, loopGetters);
  const renderFn = emitFragRenderFn(ctx, node.consequent, loopGetters, inSvg);
  const elseFn = node.alternate ? emitFragRenderFn(ctx, node.alternate, loopGetters, inSvg, "elseFrag") : "null";
  return [
    `__createConditional(${parentVar}, [`,
    `  {`,
    `    condition: () => !(${condJs}),`,
    `    render: ${indentLines(renderFn, 4).trimStart()}`,
    `  }`,
    `], ${elseFn});`
  ];
}

export function emitIsSetBlock(
  ctx: CodegenContext,
  node: IsSetBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const isSetHelper = ctx.useHelper("__mixIsSet");
  const valJs = ctx.emitExpr(node.rawValue, node.value, loopGetters);
  let branchGetters = loopGetters;
  let preamble = "";
  if (node.asIdentifier) {
    const getterVar = ctx.nextId(`get_${node.asIdentifier}`);
    const nextMap = new Map(loopGetters);
    nextMap.set(node.asIdentifier, getterVar);
    branchGetters = nextMap;
    preamble = `const ${getterVar} = () => (${valJs});\n`;
  }
  const fragVar = ctx.nextId("branchFrag");
  const bodyLines = [
    `const ${fragVar} = document.createDocumentFragment();`,
    ...ctx.emitTemplateNodes(node.consequent, fragVar, branchGetters, inSvg),
    `return [...${fragVar}.childNodes];`
  ];
  const renderFn = `() => {\n${indentLines(preamble + bodyLines.join("\n"), 2)}\n}`;
  const elseFn = node.alternate ? emitFragRenderFn(ctx, node.alternate, loopGetters, inSvg, "elseFrag") : "null";
  return [
    `__createConditional(${parentVar}, [`,
    `  {`,
    `    condition: () => ${isSetHelper}(${valJs}),`,
    `    render: ${indentLines(renderFn, 4).trimStart()}`,
    `  }`,
    `], ${elseFn});`
  ];
}

export function emitIsEmptyBlock(
  ctx: CodegenContext,
  node: IsEmptyBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const isEmptyHelper = ctx.useHelper("__mixIsEmpty");
  const valJs = ctx.emitExpr(node.rawValue, node.value, loopGetters);
  const renderFn = emitFragRenderFn(ctx, node.consequent, loopGetters, inSvg);
  const elseFn = node.alternate ? emitFragRenderFn(ctx, node.alternate, loopGetters, inSvg, "elseFrag") : "null";
  return [
    `__createConditional(${parentVar}, [`,
    `  {`,
    `    condition: () => ${isEmptyHelper}(${valJs}),`,
    `    render: ${indentLines(renderFn, 4).trimStart()}`,
    `  }`,
    `], ${elseFn});`
  ];
}

export function emitSwitchBlock(
  ctx: CodegenContext,
  node: SwitchBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const switchHelper = ctx.useHelper("__mixSwitch");
  const subjArg = node.subject ? `() => (${ctx.emitExpr(node.rawSubject ?? "", node.subject, loopGetters)})` : "null";
  const caseEntries = node.cases.map((caseBranch) => {
    const renderFn = emitFragRenderFn(ctx, caseBranch.body, loopGetters, inSvg, "caseFrag");
    if (caseBranch.kind === "condition" && caseBranch.condition) {
      const condJs = ctx.emitExpr(caseBranch.rawCondition ?? "", caseBranch.condition, loopGetters);
      return [
        `{`,
        `  kind: "condition",`,
        `  condition: () => (${condJs}),`,
        `  render: ${indentLines(renderFn, 2).trimStart()}`,
        `}`
      ].join("\n");
    }
    const candidateExprs = caseBranch.values.map((exprAst, idx) =>
      `(${ctx.emitExpr(caseBranch.rawValues[idx] ?? "", exprAst, loopGetters)})`
    );
    return [
      `{`,
      `  kind: "values",`,
      `  values: () => [${candidateExprs.join(", ")}],`,
      `  render: ${indentLines(renderFn, 2).trimStart()}`,
      `}`
    ].join("\n");
  });
  const defaultFn = node.defaultBranch
    ? emitFragRenderFn(ctx, node.defaultBranch, loopGetters, inSvg, "defaultFrag")
    : "null";
  return [
    `${switchHelper}(`,
    `  ${parentVar},`,
    `  ${subjArg},`,
    `  [`,
    indentLines(caseEntries.join(",\n"), 4),
    `  ],`,
    `  ${defaultFn}`,
    `);`
  ];
}

export function emitEachExtBlock(
  ctx: CodegenContext,
  node: EachExtNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const collJs = ctx.emitExpr(node.rawCollection, node.collection, loopGetters);
  const itemIdent = node.itemIdentifier;
  const idxParam = ctx.nextId("eachIdx");

  let itemsFnExpr = `() => (${collJs})`;
  if (node.rawSkipExpression || node.rawStopExpression) {
    const pipelineHelper = ctx.useHelper("__mixEachPipeline");
    const optFields: string[] = [];
    if (node.rawSkipExpression) {
      optFields.push(`skip: (${node.rawSkipExpression})`);
    }
    if (node.rawStopExpression) {
      optFields.push(`stop: (${node.rawStopExpression})`);
    }
    itemsFnExpr = `() => ${pipelineHelper}((${collJs}) ?? [], { ${optFields.join(", ")} })`;
  }

  const keyLoopGetters = new Map(loopGetters);
  keyLoopGetters.delete(itemIdent);
  if (node.indexIdentifier) keyLoopGetters.delete(node.indexIdentifier);

  const keyJs =
    !node.keyExpression || (node.rawKeyExpression && node.rawKeyExpression.trim() === itemIdent)
      ? `(${itemIdent}?.id ?? ${itemIdent}?.key ?? ${itemIdent})`
      : ctx.emitExpr(node.rawKeyExpression ?? "", node.keyExpression, keyLoopGetters);

  const itemGetterVar = ctx.nextId(`get_${itemIdent}`);
  const indexGetterVar = ctx.nextId("get_eachIdx");
  const nextLoopGetters = new Map(loopGetters);
  nextLoopGetters.set(itemIdent, itemGetterVar);
  if (node.indexIdentifier) {
    nextLoopGetters.set(node.indexIdentifier, indexGetterVar);
  }

  const rowFragVar = ctx.nextId("rowFrag");
  const rowContentLines = node.renderComponent
    ? [
        `__mountComponent(${ctx.emitExpr(node.rawRenderComponent ?? "", node.renderComponent, loopGetters)}, { ${JSON.stringify(node.renderPropName ?? "item")}: ${itemGetterVar}() }, ${rowFragVar});`
      ]
    : ctx.emitTemplateNodes(node.children, rowFragVar, nextLoopGetters, inSvg);

  const rowLines = [
    `const ${rowFragVar} = document.createDocumentFragment();`,
    ...rowContentLines,
    `return [...${rowFragVar}.childNodes];`
  ];

  if (node.empty.length > 0) {
    const emptyHelper = ctx.useHelper("__mixEachWithEmpty");
    const emptyFn = emitFragRenderFn(ctx, node.empty, loopGetters, inSvg, "emptyFrag");
    return [
      `${emptyHelper}(`,
      `  ${parentVar},`,
      `  ${itemsFnExpr},`,
      `  (${itemIdent}, ${idxParam}) => (${keyJs}),`,
      `  (${itemGetterVar}, ${indexGetterVar}) => {`,
      `    void ${itemGetterVar}; void ${indexGetterVar};`,
      indentLines(rowLines.join("\n"), 4),
      `  },`,
      `  ${emptyFn}`,
      `);`
    ];
  }

  return [
    `__createKeyedEach(`,
    `  ${parentVar},`,
    `  ${itemsFnExpr},`,
    `  (${itemIdent}, ${idxParam}) => (${keyJs}),`,
    `  (${itemGetterVar}, ${indexGetterVar}) => {`,
    `    void ${itemGetterVar}; void ${indexGetterVar};`,
    indentLines(rowLines.join("\n"), 4),
    `  }`,
    `);`
  ];
}

export function emitForBlock(
  ctx: CodegenContext,
  node: ForBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const forHelper = ctx.useHelper("__mixFor");
  let specLiteral: string;
  if (node.variant === "range" && node.from && node.to) {
    const fromJs = ctx.emitExpr(node.rawFrom ?? "", node.from, loopGetters);
    const toJs = ctx.emitExpr(node.rawTo ?? "", node.to, loopGetters);
    const stepPart = node.step ? `, step: () => (${ctx.emitExpr(node.rawStep ?? "", node.step, loopGetters)})` : "";
    specLiteral = `{ kind: "range", from: () => (${fromJs}), to: () => (${toJs})${stepPart} }`;
  } else {
    const timesJs = node.times ? ctx.emitExpr(node.rawTimes ?? "", node.times, loopGetters) : "0";
    specLiteral = `{ kind: "times", count: () => (${timesJs}) }`;
  }

  const iterName = node.itemIdentifier ?? "forIndex";
  const iterGetterVar = ctx.nextId(`get_${iterName}`);
  const nextGetters = new Map(loopGetters);
  if (node.itemIdentifier) {
    nextGetters.set(node.itemIdentifier, iterGetterVar);
  }
  const renderFn = emitFragRenderFn(ctx, node.children, nextGetters, inSvg, "forRowFrag", [iterGetterVar]);
  return [
    `${forHelper}(`,
    `  ${parentVar},`,
    `  ${specLiteral},`,
    `  ${indentLines(renderFn, 2).trimStart()}`,
    `);`
  ];
}

export function emitTemplateRenderFunctionFallback(
  ctx: CodegenContext,
  node: TemplateRenderFunctionNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  return ctx.emitTemplateNodes(node.body, parentVar, loopGetters, inSvg);
}
