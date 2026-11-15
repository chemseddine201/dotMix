export type TokenKind =
  | "plain"
  | "comment"
  | "string"
  | "number"
  | "keyword"
  | "directive"
  | "tag"
  | "attr"
  | "punct";

export interface CodeToken {
  id: number;
  kind: TokenKind;
  text: string;
}

export type CodeLanguage = "tix" | "mix" | "ts" | "css" | "bash" | "text";

const JS_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "from",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "of",
  "readonly",
  "return",
  "switch",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "var",
  "void",
  "while"
]);

const BASH_KEYWORDS = new Set([
  "build",
  "cd",
  "check",
  "create",
  "dev",
  "mix",
  "node",
  "npm",
  "npx",
  "tsc"
]);

const DIRECTIVE_RE =
  /^\{(if|elseif|else|endif|unless|endunless|each|endeach|for|endfor|switch|case|default|endswitch|await|then|catch|endawait|can|cannot|elsecan|endcan|auth|guest|endauth|push|endpush|section|endsection|stack|yield|once|endonce|include|includefirst|includeif|includewhen|raw|csrf|honeypot|method|error|lazy|endlazy|defer|enddefer|preload|asset|env|production|development)\b\}?/;

export function inferLanguage(title?: string, explicit?: string): CodeLanguage {
  const candidate = (explicit ?? "").toLowerCase();
  if (candidate === "tix" || candidate === "mix" || candidate === "ts" || candidate === "css" || candidate === "bash" || candidate === "text") {
    return candidate;
  }
  const lower = (title ?? "").toLowerCase();
  if (lower.endsWith(".tix") || lower.endsWith(".mix")) {
    return lower.endsWith(".mix") ? "mix" : "tix";
  }
  if (lower.endsWith(".css")) {
    return "css";
  }
  if (lower.endsWith(".ts") || lower.endsWith(".js") || lower.endsWith(".mjs") || lower === "server" || lower === "edge" || lower === "custom element" || lower === "tc39 signals") {
    return "ts";
  }
  if (lower.includes("terminal") || lower.includes("cli") || lower.includes("shell")) {
    return "bash";
  }
  return "tix";
}

function readQuoted(code: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < code.length) {
    const ch = code[index];
    if (ch === "\\") {
      index += 2;
      continue;
    }
    if (ch === quote) {
      return index + 1;
    }
    if (quote !== "`" && ch === "\n") {
      return index;
    }
    index += 1;
  }
  return code.length;
}

function readBlockComment(code: string, start: number): number {
  const end = code.indexOf("*/", start + 2);
  return end === -1 ? code.length : end + 2;
}

function readLineComment(code: string, start: number): number {
  const nl = code.indexOf("\n", start);
  return nl === -1 ? code.length : nl;
}

function isIdentChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

export function tokenizeCode(code: string, language: CodeLanguage): CodeToken[] {
  if (code.length === 0) {
    return [];
  }
  if (language === "text") {
    return [{ id: 1, kind: "plain", text: code }];
  }

  const tokens: CodeToken[] = [];
  let plainBuffer = "";
  let nextId = 1;
  let pos = 0;
  let inTag = false;
  let tagExprDepth = 0;

  const flushPlain = (): void => {
    if (plainBuffer.length > 0) {
      tokens.push({ id: nextId++, kind: "plain", text: plainBuffer });
      plainBuffer = "";
    }
  };

  const push = (kind: TokenKind, text: string): void => {
    if (kind === "plain") {
      plainBuffer += text;
      return;
    }
    flushPlain();
    tokens.push({ id: nextId++, kind, text });
  };

  while (pos < code.length) {
    const rest = code.slice(pos);
    const ch = code[pos];

    if (language !== "css" && language !== "bash" && rest.startsWith("//")) {
      const end = readLineComment(code, pos);
      push("comment", code.slice(pos, end));
      pos = end;
      continue;
    }

    if (rest.startsWith("/*")) {
      const end = readBlockComment(code, pos);
      push("comment", code.slice(pos, end));
      pos = end;
      continue;
    }

    if (language === "bash" && ch === "#" && (pos === 0 || /\s/.test(code[pos - 1] ?? ""))) {
      const end = readLineComment(code, pos);
      push("comment", code.slice(pos, end));
      pos = end;
      continue;
    }

    if (ch === '"' || ch === "'" || (language !== "css" && ch === "`")) {
      const end = readQuoted(code, pos, ch);
      push("string", code.slice(pos, end));
      pos = end;
      continue;
    }

    if (language === "tix" || language === "mix") {
      const directiveMatch = DIRECTIVE_RE.exec(rest);
      if (directiveMatch) {
        push("directive", directiveMatch[0]);
        pos += directiveMatch[0].length;
        continue;
      }

      const tagMatch = /^(<\/?)([A-Za-z][A-Za-z0-9._-]*)/.exec(rest);
      if (tagMatch && !isIdentChar(code[pos - 1])) {
        push("punct", tagMatch[1]);
        push("tag", tagMatch[2]);
        pos += tagMatch[0].length;
        inTag = true;
        tagExprDepth = 0;
        continue;
      }
    }

    if (inTag) {
      if (ch === "{") {
        tagExprDepth += 1;
        push("punct", ch);
        pos += 1;
        continue;
      }
      if (ch === "}" && tagExprDepth > 0) {
        tagExprDepth -= 1;
        push("punct", ch);
        pos += 1;
        continue;
      }
      if (tagExprDepth === 0) {
        if (rest.startsWith("/>")) {
          push("punct", "/>");
          pos += 2;
          inTag = false;
          continue;
        }
        if (ch === ">") {
          push("punct", ">");
          pos += 1;
          inTag = false;
          continue;
        }
        const attrMatch = /^([a-zA-Z_:][a-zA-Z0-9_.:-]*)(?=\s*=)/.exec(rest);
        if (attrMatch && !isIdentChar(code[pos - 1])) {
          const name = attrMatch[1];
          const isDirAttr =
            name.includes(":if") ||
            name.includes(":unless") ||
            name.includes(":match") ||
            name.includes(":else") ||
            name.includes(":case-") ||
            name.startsWith("on:") ||
            name.startsWith("class:") ||
            name.startsWith("style:");
          push(isDirAttr ? "directive" : "attr", name);
          pos += name.length;
          continue;
        }
      }
    }

    if (language === "css") {
      const cssDir = /^(@[a-z-]+|:global\b|:deep\b)/.exec(rest);
      if (cssDir) {
        push("directive", cssDir[1]);
        pos += cssDir[1].length;
        continue;
      }
      const hexMatch = /^#[0-9a-fA-F]{3,8}\b/.exec(rest);
      if (hexMatch) {
        push("number", hexMatch[0]);
        pos += hexMatch[0].length;
        continue;
      }
    }

    const numMatch = /^(0x[0-9a-fA-F]+|\d+(?:\.\d+)?)/.exec(rest);
    if (numMatch && !isIdentChar(code[pos - 1])) {
      push("number", numMatch[0]);
      pos += numMatch[0].length;
      continue;
    }

    const identMatch = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(rest);
    if (identMatch) {
      const word = identMatch[0];
      if (language === "bash" && BASH_KEYWORDS.has(word)) {
        push("keyword", word);
      } else if (language !== "css" && language !== "bash" && JS_KEYWORDS.has(word)) {
        push("keyword", word);
      } else {
        push("plain", word);
      }
      pos += word.length;
      continue;
    }

    push("plain", ch);
    pos += 1;
  }

  flushPlain();
  return tokens;
}

