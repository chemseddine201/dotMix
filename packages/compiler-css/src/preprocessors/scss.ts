/**
 * @mix/compiler-css/preprocessors/scss — SCSS/Sass variable (`$var`) and `@mixin`/`@include` preprocessor stage.
 */

import { replaceVariablesInText, type MixinDefinition } from "../import-resolver.js";
import { flattenNestedCss } from "./postcss.js";

export function extractAndExpandScssVariablesAndMixins(source: string): string {
  const vars = new Map<string, string>();
  const mixins = new Map<string, MixinDefinition>();

  // 1. Extract `@mixin name($p: default, ...) { ... }`
  let current = "";
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("@mixin", i) && (i === 0 || /\s|;|\}/.test(source[i - 1]!))) {
      let pos = i + 6;
      while (pos < source.length && /\s/.test(source[pos]!)) pos++;
      const nameMatch = /^([A-Za-z_-][A-Za-z0-9_-]*)/.exec(source.slice(pos));
      if (nameMatch) {
        const mixinName = nameMatch[1]!;
        pos += mixinName.length;
        while (pos < source.length && /\s/.test(source[pos]!)) pos++;
        const params: Array<{ name: string; defaultValue: string }> = [];
        if (source[pos] === "(") {
          const openParen = pos;
          let pDepth = 1;
          pos++;
          while (pos < source.length && pDepth > 0) {
            if (source[pos] === "(") pDepth++;
            else if (source[pos] === ")") pDepth--;
            pos++;
          }
          const rawParamList = source.slice(openParen + 1, pos - 1).trim();
          if (rawParamList.length > 0) {
            for (const part of rawParamList.split(",")) {
              const [rawName, rawDef] = part.split(":");
              const cleanName = (rawName ?? "").trim().replace(/^\$/, "");
              if (cleanName) {
                params.push({
                  name: cleanName,
                  defaultValue: (rawDef ?? "").trim()
                });
              }
            }
          }
        }
        while (pos < source.length && /\s/.test(source[pos]!)) pos++;
        if (source[pos] === "{") {
          const openBrace = pos;
          let bDepth = 1;
          pos++;
          while (pos < source.length && bDepth > 0) {
            if (source[pos] === "{") bDepth++;
            else if (source[pos] === "}") bDepth--;
            pos++;
          }
          const body = source.slice(openBrace + 1, pos - 1).trim();
          mixins.set(mixinName, { params, body });
          i = pos;
          continue;
        }
      }
    }
    current += source[i]!;
    i++;
  }

  // 2. Extract `$var: value;` declarations
  const varDeclRegex = /\$([A-Za-z_-][A-Za-z0-9_-]*)\s*:\s*([^;{}]+);/g;
  current = current.replace(varDeclRegex, (_m, name: string, rawVal: string) => {
    const cleanVal = replaceVariablesInText(rawVal.trim().replace(/\s*!default$/, ""), vars, "$");
    vars.set(name, cleanVal);
    return "";
  });

  // 3. Expand `@include name(args);`
  const includeRegex = /@include\s+([A-Za-z_-][A-Za-z0-9_-]*)\s*(?:\(([^)]*)\))?\s*;/g;
  current = current.replace(includeRegex, (_m, name: string, rawArgs?: string) => {
    const def = mixins.get(name);
    if (!def) return "";
    const localVars = new Map(vars);
    const argList = rawArgs && rawArgs.trim().length > 0
      ? rawArgs.split(",").map((a) => a.trim())
      : [];
    def.params.forEach((param, idx) => {
      const val = argList[idx] !== undefined && argList[idx] !== "" ? argList[idx]! : param.defaultValue;
      localVars.set(param.name, replaceVariablesInText(val, vars, "$"));
    });
    return replaceVariablesInText(def.body, localVars, "$");
  });

  // 4. Replace remaining `$var` references
  return replaceVariablesInText(current, vars, "$");
}

export function preprocessScss(source: string): string {
  const expanded = extractAndExpandScssVariablesAndMixins(source);
  return flattenNestedCss(expanded);
}
