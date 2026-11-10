/**
 * @mix/compiler-codegen/generator — Main `generate()` pipeline combining CSS compilation, script transpilation, and DOM codegen.
 */

import {
  extractAndTranspileScript,
  generateSourceMap,
  type ComponentDescriptor,
  type SourceMapV3,
  type SpanEntry
} from "@mix/compiler-semantic";
import { compileCss, preprocessCss } from "@mix/compiler-css";
import {
  AUTO_IMPORTABLE_RUNTIME_PRIMITIVES,
  sanitizeComponentIdentifier,
  indentLines,
  type CodegenOptions,
  type CodegenResult
} from "./types.js";
import { CodegenContext } from "./context.js";

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
