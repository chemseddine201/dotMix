import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

export function collectC1Files() {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".history" ||
        entry.name === ".git"
      ) {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith(".tix") || entry.name.endsWith(".mix")) {
        files.push(full);
      }
    }
  }
  walk(REPO_ROOT);
  files.sort();
  return files;
}

export function loadC2Expressions() {
  const raw = fs.readFileSync(path.join(__dirname, "expressions.json"), "utf8");
  return JSON.parse(raw);
}

export function loadC3Invalid() {
  const raw = fs.readFileSync(path.join(__dirname, "invalid.json"), "utf8");
  return JSON.parse(raw);
}

const OPAQUE_FIELDS = new Set([
  "typeAnnotation",
  "typeParameters",
  "typeArguments",
  "returnType"
]);

const TS_EXPRESSION_WRAPPERS = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion"
]);

function isAstNode(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.type === "string" &&
    typeof value.start === "number" &&
    typeof value.end === "number"
  );
}

/**
 * Normalizes an AST (ComponentNode, Program, or ESTreeNode) according to Gate 43 R4 & R5 rules:
 * - For `typeAnnotation`, `typeParameters`, `typeArguments`, `returnType`: opaque root { type, start, end }.
 * - For any `TS*` node other than the 4 expression wrappers: opaque root { type, start, end }.
 * - For the 4 expression wrappers: full match on type/start/end/range/loc/expression, opaque root on typeAnnotation.
 * - For R5 TS-only declarations (`import type`, `export type`, `declare`): opaque root { type, start, end }.
 */
export function normalizeForR4(value, { scriptProgram = false } = {}) {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (value instanceof RegExp) {
    return { __regexp__: true, source: value.source, flags: value.flags };
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForR4(item, { scriptProgram }));
  }

  if (isAstNode(value)) {
    if (value.type.startsWith("TS") && !TS_EXPRESSION_WRAPPERS.has(value.type)) {
      return { type: value.type, start: value.start, end: value.end };
    }
    if (scriptProgram) {
      if (
        (value.type === "ImportDeclaration" && value.importKind === "type") ||
        (value.type === "ExportNamedDeclaration" && value.exportKind === "type") ||
        value.declare === true
      ) {
        return { type: value.type, start: value.start, end: value.end };
      }
      if (
        value.type === "ExportNamedDeclaration" &&
        value.declaration &&
        typeof value.declaration === "object" &&
        ((typeof value.declaration.type === "string" && value.declaration.type.startsWith("TS")) ||
          value.declaration.declare === true)
      ) {
        return {
          type: value.type,
          start: value.start,
          end: value.end,
          declaration: {
            type: value.declaration.type,
            start: value.declaration.start,
            end: value.declaration.end
          }
        };
      }
    }

    const out = {};
    for (const key of Object.keys(value)) {
      const prop = value[key];
      if (OPAQUE_FIELDS.has(key) && isAstNode(prop)) {
        out[key] = { type: prop.type, start: prop.start, end: prop.end };
      } else {
        out[key] = normalizeForR4(prop, { scriptProgram });
      }
    }
    return out;
  }

  const out = {};
  for (const key of Object.keys(value)) {
    out[key] = normalizeForR4(value[key], { scriptProgram });
  }
  return out;
}

export const R6_REQUIRED_LABELS = new Set([
  "eof",
  "{",
  "}",
  "[",
  "]",
  "(",
  ")",
  ",",
  "name",
  "string",
  "in",
  "as",
  "import"
]);

export function tokenizeAll(createTokenizerFn, input) {
  const tokenizer = createTokenizerFn(input);
  const tokens = [];
  while (true) {
    const tok = tokenizer.getToken();
    tokens.push({
      label: tok.type.label,
      value: tok.value,
      start: tok.start,
      end: tok.end
    });
    if (tok.type.label === "eof") {
      break;
    }
  }
  return tokens;
}

export function normalizeTokenForR6(tok) {
  if (R6_REQUIRED_LABELS.has(tok.label)) {
    return { label: tok.label, value: tok.value, start: tok.start, end: tok.end };
  }
  return { label: "<other>", start: tok.start, end: tok.end };
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (value === undefined) return '{"__undefined__":true}';
  const t = typeof value;
  if (t === "boolean" || t === "string") return JSON.stringify(value);
  if (t === "number") {
    if (Object.is(value, -0)) return '{"__neg_zero__":true}';
    if (!Number.isFinite(value)) return JSON.stringify({ __non_finite__: String(value) });
    return JSON.stringify(value);
  }
  if (t === "bigint") return JSON.stringify({ __bigint__: value.toString() });
  if (Array.isArray(value)) {
    return "[" + value.map((item) => canonicalJson(item)).join(",") + "]";
  }
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

export function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function loadOracle() {
  const raw = fs.readFileSync(path.join(__dirname, "oracle.json"), "utf8");
  return JSON.parse(raw);
}

export function extractHeaderSlices(source) {
  const slices = [];
  const headerRe = /\{(?:#?each|for|switch|case|with|let|hydrate|defer)\b/g;
  let m;
  while ((m = headerRe.exec(source)) !== null) {
    const start = m.index + m[0].length;
    slices.push(source.slice(start, Math.min(source.length, start + 240)));
  }
  return slices;
}

export function isOurOwnMessage(msg) {
  return (
    typeof msg === "string" &&
    !msg.startsWith("Invalid expression syntax:") &&
    !msg.startsWith("Script syntax error:")
  );
}

