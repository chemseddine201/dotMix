/**
 * @mix/compiler-codegen/emit-blocks — Control-flow block emitters (`IfBlock`, `EachBlock`, `AwaitBlock`).
 */

import type {
  TemplateNode,
  IfBlockNode,
  EachBlockNode,
  AwaitBlockNode
} from "@mix/ast";
import { indentLines } from "./types.js";
import type { CodegenContext } from "./context.js";

export function emitAwaitBlock(
  ctx: CodegenContext,
  node: AwaitBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const exprJs = ctx.emitExpr(
    node.rawExpression,
    node.expression,
    loopGetters
  );

  const pendingFrag = ctx.nextId("pendingFrag");
  const pendingLines = [
    `const ${pendingFrag} = document.createDocumentFragment();`,
    ...ctx.emitTemplateNodes(node.pending, pendingFrag, loopGetters, inSvg),
    `return [...${pendingFrag}.childNodes];`
  ];

  const thenValGetter = ctx.nextId("get_thenVal");
  const thenLoopGetters = new Map(loopGetters);
  if (node.thenIdentifier) {
    thenLoopGetters.set(node.thenIdentifier, thenValGetter);
  }
  const thenFrag = ctx.nextId("thenFrag");
  const thenLines = [
    `const ${thenFrag} = document.createDocumentFragment();`,
    ...ctx.emitTemplateNodes(node.thenBranch, thenFrag, thenLoopGetters, inSvg),
    `return [...${thenFrag}.childNodes];`
  ];

  let catchCode = "null";
  if (node.catchBranch.length > 0) {
    const catchErrGetter = ctx.nextId("get_catchErr");
    const catchLoopGetters = new Map(loopGetters);
    if (node.catchIdentifier) {
      catchLoopGetters.set(node.catchIdentifier, catchErrGetter);
    }
    const catchFrag = ctx.nextId("catchFrag");
    const catchLines = [
      `const ${catchFrag} = document.createDocumentFragment();`,
      ...ctx.emitTemplateNodes(node.catchBranch, catchFrag, catchLoopGetters, inSvg),
      `return [...${catchFrag}.childNodes];`
    ];
    catchCode = `(${catchErrGetter}) => {\n  void ${catchErrGetter};\n${indentLines(catchLines.join("\n"), 2)}\n}`;
  }

  return [
    `__createAwaitBlock(`,
    `  ${parentVar},`,
    `  () => (${exprJs}),`,
    `  () => {\n${indentLines(pendingLines.join("\n"), 4)}\n  },`,
    `  (${thenValGetter}) => {\n    void ${thenValGetter};\n${indentLines(thenLines.join("\n"), 4)}\n  },`,
    `  ${catchCode}`,
    `);`
  ];
}

export function emitIfBlock(
  ctx: CodegenContext,
  node: IfBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const branches: Array<{ condExpr: string; children: readonly TemplateNode[] }> = [];
  let elseChildren: readonly TemplateNode[] | null = null;

  let curr: IfBlockNode | null = node;
  while (curr !== null) {
    const condExpr = ctx.emitExpr(
      curr.rawCondition,
      curr.condition,
      loopGetters
    );
    branches.push({ condExpr, children: curr.consequent });
    if (curr.alternate === null) {
      curr = null;
    } else if (Array.isArray(curr.alternate)) {
      elseChildren = curr.alternate as readonly TemplateNode[];
      curr = null;
    } else {
      curr = curr.alternate as IfBlockNode;
    }
  }

  const branchStrings = branches.map((b) => {
    const fragVar = ctx.nextId("branchFrag");
    const bodyLines = [
      `const ${fragVar} = document.createDocumentFragment();`,
      ...ctx.emitTemplateNodes(b.children, fragVar, loopGetters, inSvg),
      `return [...${fragVar}.childNodes];`
    ];
    return [
      `{`,
      `  condition: () => (${b.condExpr}),`,
      `  render: () => {`,
      indentLines(bodyLines.join("\n"), 4),
      `  }`,
      `}`
    ].join("\n");
  });

  let elseString = "null";
  if (elseChildren !== null) {
    const elseFragVar = ctx.nextId("elseFrag");
    const elseBodyLines = [
      `const ${elseFragVar} = document.createDocumentFragment();`,
      ...ctx.emitTemplateNodes(elseChildren, elseFragVar, loopGetters, inSvg),
      `return [...${elseFragVar}.childNodes];`
    ];
    elseString = [
      `() => {`,
      indentLines(elseBodyLines.join("\n"), 2),
      `}`
    ].join("\n");
  }

  return [
    `__createConditional(${parentVar}, [`,
    indentLines(branchStrings.join(",\n"), 2),
    `], ${elseString});`
  ];
}

export function emitEachBlock(
  ctx: CodegenContext,
  node: EachBlockNode,
  parentVar: string,
  loopGetters: ReadonlyMap<string, string>,
  inSvg: boolean
): string[] {
  const collectionJs = ctx.emitExpr(
    node.rawCollection,
    node.collection,
    loopGetters
  );
  const itemIdent = node.itemIdentifier;
  const indexIdent = node.indexIdentifier ?? ctx.nextId("unusedIdx");

  // Inside keyFn `(item, idx) => keyExpr`, item and idx are plain parameters
  // while outer loopGetters (if nested inside another #each) remain active
  const keyLoopGetters = new Map(loopGetters);
  keyLoopGetters.delete(itemIdent);
  if (node.indexIdentifier) {
    keyLoopGetters.delete(node.indexIdentifier);
  }
  const keyJs =
    node.rawKeyExpression.trim() === itemIdent
      ? `(${itemIdent}?.id ?? ${itemIdent}?.key ?? ${itemIdent})`
      : ctx.emitExpr(
          node.rawKeyExpression,
          node.keyExpression,
          keyLoopGetters
        );

  const itemGetterVar = ctx.nextId(`get_${itemIdent}`);
  const indexGetterVar = ctx.nextId(`get_${indexIdent}`);
  const nextLoopGetters = new Map(loopGetters);
  nextLoopGetters.set(itemIdent, itemGetterVar);
  if (node.indexIdentifier) {
    nextLoopGetters.set(node.indexIdentifier, indexGetterVar);
  }

  const rowFragVar = ctx.nextId("rowFrag");
  const rowLines = [
    `const ${rowFragVar} = document.createDocumentFragment();`,
    ...ctx.emitTemplateNodes(node.children, rowFragVar, nextLoopGetters, inSvg),
    `return [...${rowFragVar}.childNodes];`
  ];

  return [
    `__createKeyedEach(`,
    `  ${parentVar},`,
    `  () => (${collectionJs}),`,
    `  (${itemIdent}, ${indexIdent}) => (${keyJs}),`,
    `  (${itemGetterVar}, ${indexGetterVar}) => {`,
    `    void ${itemGetterVar}; void ${indexGetterVar};`,
    indentLines(rowLines.join("\n"), 4),
    `  }`,
    `);`
  ];
}
