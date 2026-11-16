/**
 * @dotmix/compiler-semantic/build-transforms/import-meta-env — TypeScript AST transform replacing
 * `import.meta.env` accesses with build-time constants and public environment values.
 */

import * as ts from "typescript";

export interface ImportMetaEnvValues {
  readonly mode: string;
  readonly dev: boolean;
  readonly prod: boolean;
  readonly publicEnv: Readonly<Record<string, string>>;
}

const PUBLIC_ENV_PREFIX = "MIX_PUBLIC_";

function isImportMetaNode(node: ts.Node): boolean {
  return (
    ts.isMetaProperty(node) &&
    node.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.name.text === "meta"
  );
}

function isImportMetaEnvNode(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    isImportMetaNode(node.expression) &&
    node.name.text === "env"
  );
}

function isWriteTarget(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    parent !== undefined &&
    ts.isBinaryExpression(parent) &&
    parent.left === node &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

function buildSerializedBareEnv(values: ImportMetaEnvValues): string {
  const exposedEntries: Record<string, string | boolean> = {
    MODE: values.mode,
    DEV: values.dev,
    PROD: values.prod
  };
  for (const [key, entryValue] of Object.entries(values.publicEnv)) {
    if (key.startsWith(PUBLIC_ENV_PREFIX)) {
      exposedEntries[key] = entryValue;
    }
  }
  return `(${JSON.stringify(exposedEntries)})`;
}

function resolveEnvPropertyLiteral(key: string, values: ImportMetaEnvValues): string | null {
  if (key === "MODE") return JSON.stringify(values.mode);
  if (key === "DEV") return values.dev ? "true" : "false";
  if (key === "PROD") return values.prod ? "true" : "false";
  if (key.startsWith(PUBLIC_ENV_PREFIX)) {
    return Object.prototype.hasOwnProperty.call(values.publicEnv, key)
      ? JSON.stringify(values.publicEnv[key])
      : "undefined";
  }
  return null;
}

/**
 * Replaces `import.meta.env`, `import.meta.env.MODE`, `.DEV`, `.PROD`, and `.MIX_PUBLIC_*`
 * in compiled JavaScript using the TypeScript AST so strings, comments, and unrelated code remain byte-exact.
 */
export function replaceImportMetaEnv(sourceCode: string, values: ImportMetaEnvValues): string {
  if (!sourceCode.includes("import") || !sourceCode.includes("env")) {
    return sourceCode;
  }

  const sourceFile = ts.createSourceFile("module.js", sourceCode, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS);
  const replacements: Array<{ readonly start: number; readonly end: number; readonly text: string }> = [];
  let cachedBareEnv: string | null = null;
  const getBareEnvText = (): string => {
    if (cachedBareEnv === null) {
      cachedBareEnv = buildSerializedBareEnv(values);
    }
    return cachedBareEnv;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isImportMetaEnvNode(node.expression) && !isWriteTarget(node)) {
      const replacement = resolveEnvPropertyLiteral(node.name.text, values);
      if (replacement !== null) {
        replacements.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          text: replacement
        });
        return;
      }
    }

    if (
      ts.isElementAccessExpression(node) &&
      isImportMetaEnvNode(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      !isWriteTarget(node)
    ) {
      const replacement = resolveEnvPropertyLiteral(node.argumentExpression.text, values);
      if (replacement !== null) {
        replacements.push({
          start: node.getStart(sourceFile),
          end: node.getEnd(),
          text: replacement
        });
        return;
      }
    }

    if (isImportMetaEnvNode(node) && !isWriteTarget(node)) {
      replacements.push({
        start: node.getStart(sourceFile),
        end: node.getEnd(),
        text: getBareEnvText()
      });
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  if (replacements.length === 0) {
    return sourceCode;
  }

  replacements.sort((left, right) => left.start - right.start);
  let rewrittenCode = sourceCode;
  for (let index = replacements.length - 1; index >= 0; index--) {
    const splice = replacements[index]!;
    rewrittenCode =
      rewrittenCode.slice(0, splice.start) +
      splice.text +
      rewrittenCode.slice(splice.end);
  }
  return rewrittenCode;
}

