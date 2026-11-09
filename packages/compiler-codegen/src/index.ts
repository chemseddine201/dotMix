/**
 * @mix/compiler-codegen — Ahead-of-Time direct DOM JavaScript code generator (Phase Gate 5).
 *
 * Compiles a validated `ComponentDescriptor` into readable, deterministic ES2023 JavaScript
 * that binds fine-grained reactive primitives directly to surgical DOM operations with
 * zero Virtual DOM overhead.
 */

import type {
  TemplateNode,
  ElementNode,
  ComponentCallNode,
  DynamicElementNode,
  IfBlockNode,
  EachBlockNode,
  SlotOutletNode,
  AwaitBlockNode,
  AttributeNode,
  ESTreeNode
} from "@mix/ast";
import {
  extractAndTranspileScript,
  transformExpressionAstToJs,
  generateSourceMap,
  type ComponentDescriptor,
  type SourceMapV3,
  type SpanEntry
} from "@mix/compiler-semantic";
import { compileCss, preprocessCss } from "@mix/compiler-css";

export interface CodegenOptions {
  filename?: string;
  componentName?: string;
  runtimeImportPath?: string;
  sourceMap?: boolean;
  hmr?: boolean;
  scopeId?: string;
  resolveStyle?: (src: string, fromFile: string) => string;
}

export interface CodegenResult {
  readonly js: string;
  readonly code: string;
  readonly css?: string;
  readonly scopeId?: string;
  readonly scopeAttribute?: string;
  readonly map?: SourceMapV3;
  readonly styleDependencies?: readonly string[];
}

const SVG_TAGS = new Set([
  "svg",
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
  "ellipse",
  "g",
  "defs",
  "use",
  "text",
  "tspan",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "pattern",
  "symbol"
]);

const AUTO_IMPORTABLE_RUNTIME_PRIMITIVES = [
  "signal",
  "computed",
  "createEffect",
  "batch",
  "onCleanup",
  "createRoot",
  "createRef",
  "defineProps",
  "createCancellationSource",
  "createResource",
  "createContext",
  "useContext",
  "provideContext",
  "setContext",
  "getContext",
  "createTrustedHtml",
  "setSanitizerProvider"
] as const;

function sanitizeComponentIdentifier(rawName: string): string {
  const base = rawName
    .replace(/^.*[/\\]/, "")
    .replace(/\.(mix|tix|js|ts)$/i, "")
    .replace(/[^A-Za-z0-9_$]/g, "_");
  if (!base || /^[0-9]/.test(base)) {
    return `MixComponent_${base || "Anonymous"}`;
  }
  return base[0]!.toUpperCase() + base.slice(1);
}

function indentLines(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line.trim().length > 0 ? pad + line : ""))
    .join("\n");
}

class CodegenContext {
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
        return this.emitElement(node, parentVar, loopGetters, inSvg);
      }

      case "DynamicElement": {
        return this.emitDynamicElement(node, parentVar, loopGetters, inSvg);
      }

      case "ComponentCall": {
        return this.emitComponentCall(node, parentVar, loopGetters);
      }

      case "IfBlock": {
        return this.emitIfBlock(node, parentVar, loopGetters, inSvg);
      }

      case "EachBlock": {
        return this.emitEachBlock(node, parentVar, loopGetters, inSvg);
      }

      case "SlotOutlet": {
        return this.emitSlotOutlet(node, parentVar, loopGetters, inSvg);
      }

      case "AwaitBlock": {
        return this.emitAwaitBlock(node, parentVar, loopGetters, inSvg);
      }
    }
  }

  private emitAwaitBlock(
    node: AwaitBlockNode,
    parentVar: string,
    loopGetters: ReadonlyMap<string, string>,
    inSvg: boolean
  ): string[] {
    const exprJs = this.emitExpr(
      node.rawExpression,
      node.expression,
      loopGetters
    );

    const pendingFrag = this.nextId("pendingFrag");
    const pendingLines = [
      `const ${pendingFrag} = document.createDocumentFragment();`,
      ...this.emitTemplateNodes(node.pending, pendingFrag, loopGetters, inSvg),
      `return [...${pendingFrag}.childNodes];`
    ];

    const thenValGetter = this.nextId("get_thenVal");
    const thenLoopGetters = new Map(loopGetters);
    if (node.thenIdentifier) {
      thenLoopGetters.set(node.thenIdentifier, thenValGetter);
    }
    const thenFrag = this.nextId("thenFrag");
    const thenLines = [
      `const ${thenFrag} = document.createDocumentFragment();`,
      ...this.emitTemplateNodes(node.thenBranch, thenFrag, thenLoopGetters, inSvg),
      `return [...${thenFrag}.childNodes];`
    ];

    let catchCode = "null";
    if (node.catchBranch.length > 0) {
      const catchErrGetter = this.nextId("get_catchErr");
      const catchLoopGetters = new Map(loopGetters);
      if (node.catchIdentifier) {
        catchLoopGetters.set(node.catchIdentifier, catchErrGetter);
      }
      const catchFrag = this.nextId("catchFrag");
      const catchLines = [
        `const ${catchFrag} = document.createDocumentFragment();`,
        ...this.emitTemplateNodes(node.catchBranch, catchFrag, catchLoopGetters, inSvg),
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

  private emitSlotOutlet(
    node: SlotOutletNode,
    parentVar: string,
    loopGetters: ReadonlyMap<string, string>,
    inSvg: boolean
  ): string[] {
    const fallbackFragVar = this.nextId("fallbackFrag");
    let fallbackCode = "null";
    if (node.fallback.length > 0) {
      const fallbackLines = [
        `const ${fallbackFragVar} = document.createDocumentFragment();`,
        ...this.emitTemplateNodes(node.fallback, fallbackFragVar, loopGetters, inSvg),
        `return [...${fallbackFragVar}.childNodes];`
      ];
      fallbackCode = `() => {\n${indentLines(fallbackLines.join("\n"), 2)}\n}`;
    }
    const nameArg = node.name ? JSON.stringify(node.name) : "null";
    return [
      `__renderSlot(${parentVar}, ${nameArg}, ${fallbackCode});`
    ];
  }

  private emitElement(
    node: ElementNode,
    parentVar: string,
    loopGetters: ReadonlyMap<string, string>,
    inSvg: boolean
  ): string[] {
    const elVar = this.nextId("el");
    const isSvg = inSvg || SVG_TAGS.has(node.tag);
    const createFn = isSvg ? "__createSvgElement" : "__createElement";
    const scopeArg = this.scopeAttr ? `, ${JSON.stringify(this.scopeAttr)}` : "";

    const lines: string[] = [
      `const ${elVar} = ${createFn}(${JSON.stringify(node.tag)}${scopeArg});`
    ];
    lines.push(...this.emitElementAttributes(node.attributes, elVar, loopGetters));
    lines.push(...this.emitTemplateNodes(node.children, elVar, loopGetters, isSvg));
    lines.push(`__insertNode(${parentVar}, ${elVar});`);
    return lines;
  }

  private emitDynamicElement(
    node: DynamicElementNode,
    parentVar: string,
    loopGetters: ReadonlyMap<string, string>,
    inSvg: boolean
  ): string[] {
    const dynVar = this.nextId("dyn");
    const setupParam = this.nextId("setupEl");
    const tagExpr = this.emitExpr(
      node.rawTagExpression,
      node.tagExpression,
      loopGetters
    );
    const scopeArg = this.scopeAttr ? `, ${JSON.stringify(this.scopeAttr)}` : "";

    const setupLines: string[] = [
      ...this.emitElementAttributes(node.attributes, setupParam, loopGetters),
      ...this.emitTemplateNodes(node.children, setupParam, loopGetters, inSvg)
    ];

    return [
      `const ${dynVar} = __createDynamicElement(() => (${tagExpr}), (${setupParam}) => {`,
      indentLines(setupLines.join("\n"), 2),
      `}${scopeArg});`,
      `__insertNode(${parentVar}, ${dynVar});`
    ];
  }

  private emitComponentCall(
    node: ComponentCallNode,
    parentVar: string,
    loopGetters: ReadonlyMap<string, string>
  ): string[] {
    const propEntries: string[] = [];
    for (const attr of node.attributes) {
      if (attr.type === "StaticAttribute") {
        const val = JSON.stringify(attr.value);
        propEntries.push(`${JSON.stringify(attr.name)}: ${val}`);
      } else if (attr.type === "DynamicAttribute") {
        const jsExpr = this.emitExpr(
          attr.rawExpression,
          attr.expression,
          loopGetters
        );
        propEntries.push(
          `get ${JSON.stringify(attr.name)}() { return (${jsExpr}); }`
        );
      } else if (attr.type === "RefBinding") {
        const jsExpr = this.emitExpr(
          attr.rawTarget,
          attr.target,
          loopGetters
        );
        propEntries.push(`ref: (${jsExpr})`);
      } else if (attr.type === "EventBinding") {
        const jsExpr = this.emitExpr(
          attr.rawHandler,
          attr.handler,
          loopGetters
        );
        const propName =
          "on" +
          attr.name[0]!.toUpperCase() +
          attr.name.slice(1);
        propEntries.push(`${JSON.stringify(propName)}: (${jsExpr})`);
      }
    }

    if (node.children.length > 0) {
      const defaultChildren: TemplateNode[] = [];
      const namedSlots = new Map<string, TemplateNode[]>();

      for (const child of node.children) {
        let slotName: string | null = null;
        if (child.type === "Element" || child.type === "ComponentCall" || child.type === "DynamicElement") {
          const slotAttr = child.attributes.find((a) => a.type === "StaticAttribute" && a.name === "slot");
          if (slotAttr && slotAttr.type === "StaticAttribute") {
            slotName = slotAttr.value;
          }
        }
        if (slotName) {
          if (!namedSlots.has(slotName)) namedSlots.set(slotName, []);
          namedSlots.get(slotName)!.push(child);
        } else {
          defaultChildren.push(child);
        }
      }

      const slotEntries: string[] = [];

      if (defaultChildren.length > 0) {
        const defaultFrag = this.nextId("slot_default");
        const defaultLines = [
          `const ${defaultFrag} = document.createDocumentFragment();`,
          ...this.emitTemplateNodes(defaultChildren, defaultFrag, loopGetters),
          `return [...${defaultFrag}.childNodes];`
        ];
        const defaultRenderCode = `() => {\n${indentLines(defaultLines.join("\n"), 2)}\n}`;
        propEntries.push(`children: ${defaultRenderCode}`);
        slotEntries.push(`default: ${defaultRenderCode}`);
      }

      for (const [name, slotNodes] of namedSlots.entries()) {
        const slotFrag = this.nextId(`slot_${name}`);
        const slotLines = [
          `const ${slotFrag} = document.createDocumentFragment();`,
          ...this.emitTemplateNodes(slotNodes, slotFrag, loopGetters),
          `return [...${slotFrag}.childNodes];`
        ];
        slotEntries.push(`${JSON.stringify(name)}: () => {\n${indentLines(slotLines.join("\n"), 2)}\n}`);
      }

      if (slotEntries.length > 0) {
        propEntries.push(`slots: { ${slotEntries.join(", ")} }`);
      }
    }

    const propsObj =
      propEntries.length > 0 ? `{ ${propEntries.join(", ")} }` : "{}";
    return [`__mountComponent(${node.name}, ${propsObj}, ${parentVar});`];
  }

  private emitIfBlock(
    node: IfBlockNode,
    parentVar: string,
    loopGetters: ReadonlyMap<string, string>,
    inSvg: boolean
  ): string[] {
    const branches: Array<{ condExpr: string; children: readonly TemplateNode[] }> = [];
    let elseChildren: readonly TemplateNode[] | null = null;

    let curr: IfBlockNode | null = node;
    while (curr !== null) {
      const condExpr = this.emitExpr(
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
      const fragVar = this.nextId("branchFrag");
      const bodyLines = [
        `const ${fragVar} = document.createDocumentFragment();`,
        ...this.emitTemplateNodes(b.children, fragVar, loopGetters, inSvg),
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
      const elseFragVar = this.nextId("elseFrag");
      const elseBodyLines = [
        `const ${elseFragVar} = document.createDocumentFragment();`,
        ...this.emitTemplateNodes(elseChildren, elseFragVar, loopGetters, inSvg),
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

  private emitEachBlock(
    node: EachBlockNode,
    parentVar: string,
    loopGetters: ReadonlyMap<string, string>,
    inSvg: boolean
  ): string[] {
    const collectionJs = this.emitExpr(
      node.rawCollection,
      node.collection,
      loopGetters
    );
    const itemIdent = node.itemIdentifier;
    const indexIdent = node.indexIdentifier ?? this.nextId("unusedIdx");

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
        : this.emitExpr(
            node.rawKeyExpression,
            node.keyExpression,
            keyLoopGetters
          );

    const itemGetterVar = this.nextId(`get_${itemIdent}`);
    const indexGetterVar = this.nextId(`get_${indexIdent}`);
    const nextLoopGetters = new Map(loopGetters);
    nextLoopGetters.set(itemIdent, itemGetterVar);
    if (node.indexIdentifier) {
      nextLoopGetters.set(node.indexIdentifier, indexGetterVar);
    }

    const rowFragVar = this.nextId("rowFrag");
    const rowLines = [
      `const ${rowFragVar} = document.createDocumentFragment();`,
      ...this.emitTemplateNodes(node.children, rowFragVar, nextLoopGetters, inSvg),
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
}

export function generate(
  descriptor: ComponentDescriptor,
  options?: CodegenOptions
): CodegenResult {
  const filename = options?.filename ?? descriptor.filename ?? "Component.mix";
  const componentName = sanitizeComponentIdentifier(
    options?.componentName ?? filename
  );
  const runtimeImportPath = options?.runtimeImportPath ?? "@mix/runtime";
  const hmrEnabled = options?.hmr ?? false;

  // 1. Compile component <style> or external CSS imports if present
  let compiledCss: string | undefined;
  let scopeId: string | undefined;
  let scopeAttribute: string | undefined;

  let rawCssToCompile = "";
  let isScoped = true;
  const styleDependencies: string[] = [];

  if (descriptor.ast.style) {
    isScoped = descriptor.ast.style.scoped;
    if (descriptor.ast.style.content && descriptor.ast.style.content.trim().length > 0) {
      rawCssToCompile = descriptor.ast.style.content;
    } else if (descriptor.ast.style.src && options?.resolveStyle) {
      const srcPath = descriptor.ast.style.src;
      const content = options.resolveStyle(srcPath, filename);
      const pre = preprocessCss(content, {
        filename: srcPath,
        readFile: (rel, from) => options.resolveStyle!(rel, from)
      });
      rawCssToCompile = pre.code;
      styleDependencies.push(...pre.dependencies);
    }
  }

  if (!rawCssToCompile && descriptor.cssImports && descriptor.cssImports.length > 0 && options?.resolveStyle) {
    const pieces: string[] = [];
    for (const cssFile of descriptor.cssImports) {
      const content = options.resolveStyle(cssFile, filename);
      if (content) {
        const pre = preprocessCss(content, {
          filename: cssFile,
          readFile: (rel, from) => options.resolveStyle!(rel, from)
        });
        pieces.push(pre.code);
        styleDependencies.push(...pre.dependencies);
      }
    }
    if (pieces.length > 0) {
      rawCssToCompile = pieces.join("\n");
    }
  }

  if (rawCssToCompile.trim().length > 0) {
    const cssResult = compileCss(rawCssToCompile, {
      filename,
      scoped: isScoped,
      ...(options?.scopeId !== undefined ? { scopeId: options.scopeId } : {}),
      baseOffset: descriptor.ast.style?.span.start.offset ?? 0,
      baseLine: descriptor.ast.style?.span.start.line ?? 1
    });
    compiledCss = cssResult.code;
    scopeId = cssResult.scopeId;
    if (isScoped) {
      scopeAttribute = cssResult.scopeAttribute;
    }
  }

  // 2. Separate and transpile <script> imports and body statements
  let userImportsCode = "";
  let userBodyCode = "";
  let userPostambleCode = "";

  if (descriptor.ast.script) {
    const isTs =
      descriptor.ast.script.lang === "ts" || filename.endsWith(".tix");
    const separated = extractAndTranspileScript(
      descriptor.ast.script.content,
      isTs
    );
    userImportsCode = separated.importsCode;
    if (runtimeImportPath !== "@mix/runtime" && userImportsCode.length > 0) {
      userImportsCode = userImportsCode
        .replaceAll('"@mix/runtime"', JSON.stringify(runtimeImportPath))
        .replaceAll("'@mix/runtime'", JSON.stringify(runtimeImportPath));
    }
    userBodyCode = separated.bodyCode;
    if (descriptor.ast.script.postamble) {
      userPostambleCode = extractAndTranspileScript(
        descriptor.ast.script.postamble,
        isTs
      ).bodyCode;
    }
  }

  // 3. Build runtime import header (avoiding duplicate bindings already imported by user)
  const runtimeImports: string[] = [];
  for (const prim of AUTO_IMPORTABLE_RUNTIME_PRIMITIVES) {
    if (!descriptor.imports.has(prim)) {
      runtimeImports.push(prim);
    }
  }
  runtimeImports.push(
    "withComponentProps as __withComponentProps",
    "createElement as __createElement",
    "createSvgElement as __createSvgElement",
    "createTextNode as __createTextNode",
    "createComment as __createComment",
    "setText as __setText",
    "setAttribute as __setAttribute",
    "addEventListener as __addEventListener",
    "bindRef as __bindRef",
    "insertNode as __insertNode",
    "injectStylesheet as __injectStylesheet",
    "createConditional as __createConditional",
    "createDynamicElement as __createDynamicElement",
    "createKeyedEach as __createKeyedEach",
    "mountComponent as __mountComponent",
    "renderSlot as __renderSlot",
    "bindValue as __bindValue",
    "bindChecked as __bindChecked",
    "createAwaitBlock as __createAwaitBlock",
    "createHmrScope as __createHmrScope"
  );

  // 4. Emit template DOM construction instructions
  const hmrFunctionSet = new Set(descriptor.functions);
  const ctx = new CodegenContext(scopeAttribute, hmrEnabled, hmrFunctionSet);
  const rootFragVar = "__root";
  const templateLines = ctx.emitTemplateNodes(
    descriptor.ast.template,
    rootFragVar,
    new Map(),
    false
  );

  const functionBodyLines: string[] = [];
  if (compiledCss !== undefined && scopeId !== undefined) {
    functionBodyLines.push(
      `__injectStylesheet(${JSON.stringify(scopeId)}, ${JSON.stringify(compiledCss)});`
    );
  }
  if (userBodyCode.length > 0) {
    functionBodyLines.push(userBodyCode);
  }

  if (hmrEnabled) {
    const scopeKeys = [
      ...descriptor.signals,
      ...descriptor.computeds,
      ...descriptor.refs,
      ...descriptor.props
    ];
    const methodEntries = descriptor.functions.map(
      (fnName) => `${fnName}: (__scope, ...__args) => ${fnName}(...__args)`
    );
    const sig = scopeKeys.slice().sort().join(",");
    functionBodyLines.push(
      `const __hmr = __createHmrScope(${JSON.stringify(filename)}, { ${scopeKeys.join(", ")} }, { ${methodEntries.join(", ")} }, ${JSON.stringify(sig)});`,
      `void __hmr;`
    );
  }

  functionBodyLines.push(
    `const ${rootFragVar} = document.createDocumentFragment();`,
    ...templateLines,
    `return [...${rootFragVar}.childNodes];`
  );

  const moduleLines: string[] = [
    `import { ${runtimeImports.join(", ")} } from ${JSON.stringify(runtimeImportPath)};`
  ];
  if (userImportsCode.length > 0) {
    moduleLines.push(userImportsCode);
  }
  moduleLines.push(
    "",
    `export function ${componentName}(__props = {}) {`,
    `  return __withComponentProps(__props, () => {`,
    indentLines(functionBodyLines.join("\n"), 4),
    `  });`,
    `}`,
    `export default ${componentName};`
  );
  if (userPostambleCode.length > 0) {
    moduleLines.push(userPostambleCode);
  }
  moduleLines.push("");

  const jsCode = moduleLines.join("\n");

  // 5. Generate SourceMapV3 if requested (default: true)
  let map: SourceMapV3 | undefined;
  if (options?.sourceMap !== false) {
    const spanTable: SpanEntry[] = [
      {
        genStart: 0,
        genEnd: jsCode.length,
        srcStart: descriptor.ast.span.start.offset,
        srcEnd: descriptor.ast.span.end.offset,
        kind: "origin"
      }
    ];
    map = generateSourceMap(
      filename,
      "",
      jsCode,
      spanTable
    );
  }

  return Object.freeze({
    js: jsCode,
    code: jsCode,
    ...(compiledCss !== undefined ? { css: compiledCss } : {}),
    ...(scopeId !== undefined ? { scopeId } : {}),
    ...(scopeAttribute !== undefined ? { scopeAttribute } : {}),
    ...(map !== undefined ? { map } : {}),
    ...(styleDependencies.length > 0 ? { styleDependencies: Object.freeze(styleDependencies) } : {})
  });
}
