/**
 * @dotmix/compiler-codegen/generator — Main `generate()` pipeline combining CSS compilation, script transpilation, and DOM codegen.
 */

import {
  extractAndTranspileScript,
  generateSourceMap,
  buildComponentSpanTable,
  type TemplateExpressionSpan,
  stripDirectiveImportsFromJs,
  type ComponentDescriptor,
  type SourceMapV3
} from "@dotmix/compiler-semantic";
import type { TemplateNode } from "@dotmix/ast";
import { compileCss, preprocessCss, computeScopeHash } from "@dotmix/compiler-css";
import {
  AUTO_IMPORTABLE_RUNTIME_PRIMITIVES,
  sanitizeComponentIdentifier,
  indentLines,
  type CodegenOptions,
  type CodegenResult
} from "./types.js";
import { CodegenContext } from "./context.js";

/**
 * True when `specifier` is one of the component's own stylesheets: a file in the component's folder
 * (`./Card.scss`, `./Card.header.less`). Those are scoped to the component. A stylesheet from another
 * folder (`./styles/global.scss`, `../shared/reset.css`) is global and compiled without scoping.
 */
export function isComponentStylesheet(specifier: string): boolean {
  const withoutQuery = specifier.split("?")[0] ?? specifier;
  return withoutQuery.startsWith("./") && !withoutQuery.slice(2).includes("/");
}

export function generate(
  descriptor: ComponentDescriptor,
  options?: CodegenOptions
): CodegenResult {
  const filename = options?.filename ?? descriptor.filename ?? "Component.mix";
  const componentName = sanitizeComponentIdentifier(
    options?.componentName ?? filename
  );
  // Emitted verbatim: the specifier is the runtime module's identity (see CodegenOptions.runtimeImportPath).
  const runtimeImportPath = options?.runtimeImportPath ?? "@dotmix/runtime";
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

  let rawGlobalCss = "";
  if (descriptor.cssImports && descriptor.cssImports.length > 0 && options?.resolveStyle) {
    const hasStyleBlock = rawCssToCompile.length > 0;
    const componentPieces: string[] = [];
    const globalPieces: string[] = [];
    for (const cssFile of descriptor.cssImports) {
      const isOwnStylesheet = isComponentStylesheet(cssFile);
      // A <style> block replaces the component's own stylesheet; global stylesheets always apply.
      if (isOwnStylesheet && hasStyleBlock) continue;
      const content = options.resolveStyle(cssFile, filename);
      if (content) {
        const pre = preprocessCss(content, {
          filename: cssFile,
          readFile: (rel, from) => options.resolveStyle!(rel, from)
        });
        (isOwnStylesheet ? componentPieces : globalPieces).push(pre.code);
        styleDependencies.push(...pre.dependencies);
      }
    }
    if (componentPieces.length > 0) {
      rawCssToCompile = componentPieces.join("\n");
    }
    if (globalPieces.length > 0) {
      rawGlobalCss = globalPieces.join("\n");
    }
  }

  if (rawCssToCompile.trim().length > 0) {
    const normFile = filename.replace(/\\/g, "/");
    const cssResult = compileCss(rawCssToCompile, {
      filename,
      scoped: isScoped,
      ...(options?.scopeId !== undefined
        ? { scopeId: options.scopeId }
        : hmrEnabled
          ? { scopeHash: computeScopeHash(normFile) }
          : {}),
      baseOffset: descriptor.ast.style?.span.start.offset ?? 0,
      baseLine: descriptor.ast.style?.span.start.line ?? 1
    });
    compiledCss = cssResult.code;
    scopeId = cssResult.scopeId;
    if (isScoped) {
      scopeAttribute = cssResult.scopeAttribute;
    }
  }

  let globalCss: string | undefined;
  if (rawGlobalCss.trim().length > 0) {
    globalCss = compileCss(rawGlobalCss, { filename, scoped: false }).code;
    compiledCss = compiledCss === undefined ? globalCss : `${globalCss}\n${compiledCss}`;
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
    userImportsCode = stripDirectiveImportsFromJs(
      separated.importsCode,
      !descriptor.hasPlainCanComponent,
      isTs ? '"use strict";' : ""
    );
    if (runtimeImportPath !== "@dotmix/runtime" && userImportsCode.length > 0) {
      if (runtimeImportPath.endsWith("/index.js")) {
        const runtimeDistRoot = runtimeImportPath.slice(0, -"/index.js".length);
        for (const subpath of ["directives", "forms", "permissions", "core", "dom", "platform", "security", "typecheck"]) {
          const packageSpecifier = `@dotmix/runtime/${subpath}`;
          const targetSpecifier = JSON.stringify(`${runtimeDistRoot}/${subpath}/index.js`);
          userImportsCode = userImportsCode
            .replaceAll(`"${packageSpecifier}"`, targetSpecifier)
            .replaceAll(`'${packageSpecifier}'`, targetSpecifier);
        }
      }
      userImportsCode = userImportsCode
        .replaceAll('"@dotmix/runtime"', JSON.stringify(runtimeImportPath))
        .replaceAll("'@dotmix/runtime'", JSON.stringify(runtimeImportPath));
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
    "createAwaitBlock as __createAwaitBlock"
  );
  if (hmrEnabled) {
    runtimeImports.push(
      "hmrSeedSignal as __hmrSeedSignal",
      "hmrTrackSignal as __hmrTrackSignal",
      "hmrSwapComponent as __hmrSwapComponent",
      "getActiveInstanceKey as __getActiveInstanceKey"
    );
  }

  // 4. Emit template DOM construction instructions
  const hmrFunctionSet = new Set(descriptor.functions);
  const ctx = new CodegenContext(
    scopeAttribute,
    hmrEnabled,
    hmrFunctionSet,
    options?.mode ?? "development"
  );
  const rootFragVar = "__root";
  const templateLines = ctx.emitTemplateNodes(
    descriptor.ast.template,
    rootFragVar,
    new Map(),
    false
  );
  for (const helperSpec of ctx.usedDirectiveHelpers) {
    runtimeImports.push(helperSpec);
  }

  const functionBodyLines: string[] = [];
  if (hmrEnabled) {
    functionBodyLines.push(`const __hmrInstanceKey = __getActiveInstanceKey();`);
  }
  if (!hmrEnabled && compiledCss !== undefined && scopeId !== undefined) {
    functionBodyLines.push(
      `__injectStylesheet(${JSON.stringify(scopeId)}, ${JSON.stringify(compiledCss)});`
    );
  }
  if (userBodyCode.length > 0) {
    functionBodyLines.push(userBodyCode);
  }
  if (hmrEnabled && descriptor.signals.length > 0) {
    for (const sig of descriptor.signals) {
      functionBodyLines.push(
        `if (typeof ${sig} === "function") {`,
        `  const __savedVal = __hmrSeedSignal(__hmrInstanceKey, ${JSON.stringify(sig)}, undefined);`,
        `  if (__savedVal !== undefined) {`,
        `    if (typeof ${sig}.set === "function") {`,
        `      ${sig}.set(__savedVal);`,
        `    } else if (typeof set${sig.charAt(0).toUpperCase() + sig.slice(1)} === "function") {`,
        `      set${sig.charAt(0).toUpperCase() + sig.slice(1)}(__savedVal);`,
        `    }`,
        `  }`,
        `  __hmrTrackSignal(__hmrInstanceKey, ${JSON.stringify(sig)}, () => ${sig}());`,
        `}`
      );
    }
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
  if (hmrEnabled) {
    const normFile = filename.replace(/\\/g, "/");
    const modId = normFile.includes("/src/")
      ? "/src/" + normFile.split("/src/")[1]
      : "/" + (normFile.split("/").pop() ?? "Component.mix");
    moduleLines.push(
      `${componentName}.__mix_hmr_id = ${JSON.stringify(modId)};`,
      `if (typeof import.meta !== "undefined" && import.meta.hot) {`,
      `  /* import.meta.hot.accept() */`,
      `  import.meta.hot.accept((__newMod) => {`,
      `    if (__newMod && __newMod.${componentName}) {`,
      `      __hmrSwapComponent(${JSON.stringify(modId)}, __newMod.${componentName});`,
      `    }`,
      `  });`,
      `}`
    );
  }
  if (userPostambleCode.length > 0) {
    moduleLines.push(userPostambleCode);
  }
  moduleLines.push("");

  const jsCode = moduleLines.join("\n");

  // 5. Generate SourceMapV3 if requested (default: true)
  let map: SourceMapV3 | undefined;
  if (options?.sourceMap !== false) {
    const originalSource = options?.source ?? "";
    const templateExpressions: TemplateExpressionSpan[] = [];

    const collectExpressions = (nodes: readonly TemplateNode[]): void => {
      for (const node of nodes) {
        if (node.type === "Interpolation") {
          const raw = node.rawExpression;
          const nodeSlice = originalSource.slice(node.span.start.offset, node.span.end.offset);
          const rawIndex = nodeSlice.indexOf(raw);
          const startOffset = node.span.start.offset + (rawIndex !== -1 ? rawIndex : 0);
          templateExpressions.push({ raw, startOffset });
        } else if ("children" in node && Array.isArray((node as { children?: readonly TemplateNode[] }).children)) {
          collectExpressions((node as { children: readonly TemplateNode[] }).children);
        } else if (node.type === "IfBlock") {
          collectExpressions(node.consequent);
          if (node.alternate) {
            collectExpressions(Array.isArray(node.alternate) ? node.alternate : [node.alternate]);
          }
        } else if (node.type === "EachBlock") {
          collectExpressions(node.children);
          if (node.empty) collectExpressions(node.empty);
        }
      }
    };
    collectExpressions(descriptor.ast.template);

    let spanTable = buildComponentSpanTable(
      originalSource,
      jsCode,
      descriptor.ast.script?.content,
      descriptor.ast.script?.contentSpan.start.offset,
      templateExpressions
    );

    if (spanTable.length === 0) {
      spanTable = [
        {
          genStart: 0,
          genEnd: jsCode.length,
          srcStart: descriptor.ast.span.start.offset,
          srcEnd: descriptor.ast.span.end.offset,
          kind: "origin"
        }
      ];
    }

    map = generateSourceMap(
      filename,
      originalSource,
      jsCode,
      spanTable
    );
  }

  return Object.freeze({
    js: jsCode,
    code: jsCode,
    ...(compiledCss !== undefined ? { css: compiledCss } : {}),
    ...(globalCss !== undefined ? { globalCss } : {}),
    ...(scopeId !== undefined ? { scopeId } : {}),
    ...(scopeAttribute !== undefined ? { scopeAttribute } : {}),
    ...(map !== undefined ? { map } : {}),
    ...(styleDependencies.length > 0 ? { styleDependencies: Object.freeze(styleDependencies) } : {})
  });
}
