/**
 * @mix/compiler-css/preprocessors/less — Less variable (`@var`) and parametric mixin (`.name(@p)`) preprocessor stage.
 */

import { replaceVariablesInText, type MixinDefinition } from "../import-resolver.js";
import { flattenNestedCss } from "./postcss.js";

export const RESERVED_CSS_ATRULES = new Set([
  "media",
  "keyframes",
  "-webkit-keyframes",
  "-moz-keyframes",
  "supports",
  "font-face",
  "layer",
  "container",
  "page",
  "namespace",
  "property",
  "counter-style",
  "import",
  "use",
  "forward",
  "charset",
  "mixin",
  "include"
]);

export function extractAndExpandLessVariablesAndMixins(source: string): string {
  const vars = new Map<string, string>();
  const mixins = new Map<string, MixinDefinition>();

  // 1. Extract parametric mixins `.name(@p: default, ...) { ... }`
  let current = "";
  let i = 0;
  while (i < source.length) {
    const slice = source.slice(i);
    const mixinMatch = /^\.([A-Za-z_-][A-Za-z0-9_-]*)\s*\(([^)]*)\)\s*\{/.exec(slice);
    if (mixinMatch) {
      const mixinName = mixinMatch[1]!;
      const rawParamList = mixinMatch[2]!.trim();
      const params: Array<{ name: string; defaultValue: string }> = [];
      if (rawParamList.length > 0) {
        for (const part of rawParamList.split(",")) {
          const [rawName, rawDef] = part.split(":");
          const cleanName = (rawName ?? "").trim().replace(/^@/, "");
          if (cleanName) {
            params.push({
              name: cleanName,
              defaultValue: (rawDef ?? "").trim()
            });
          }
        }
      }
      let pos = i + mixinMatch[0].length;
      const openBraceEnd = pos;
      let bDepth = 1;
      while (pos < source.length && bDepth > 0) {
        if (source[pos] === "{") bDepth++;
        else if (source[pos] === "}") bDepth--;
        pos++;
      }
      const body = source.slice(openBraceEnd, pos - 1).trim();
      mixins.set(mixinName, { params, body });
      i = pos;
      continue;
    }
    current += source[i]!;
    i++;
  }

  // 2. Extract `@var: value;` declarations (ignoring reserved CSS at-rules)
  const varDeclRegex = /@([A-Za-z_-][A-Za-z0-9_-]*)\s*:\s*([^;{}]+);/g;
  current = current.replace(varDeclRegex, (fullMatch, name: string, rawVal: string) => {
    if (RESERVED_CSS_ATRULES.has(name.toLowerCase())) {
      return fullMatch;
    }
    const cleanVal = replaceVariablesInText(rawVal.trim(), vars, "@");
    vars.set(name, cleanVal);
    return "";
  });

  // 3. Expand `.mixinName(args);` calls
  const callRegex = /\.([A-Za-z_-][A-Za-z0-9_-]*)\s*\(([^)]*)\)\s*;/g;
  current = current.replace(callRegex, (fullMatch, name: string, rawArgs: string) => {
    const def = mixins.get(name);
    if (!def) return fullMatch;
    const localVars = new Map(vars);
    const argList = rawArgs.trim().length > 0
      ? rawArgs.split(",").map((a) => a.trim())
      : [];
    def.params.forEach((param, idx) => {
      const val = argList[idx] !== undefined && argList[idx] !== "" ? argList[idx]! : param.defaultValue;
      localVars.set(param.name, replaceVariablesInText(val, vars, "@"));
    });
    return replaceVariablesInText(def.body, localVars, "@");
  });

  // 4. Replace remaining `@var` references
  return replaceVariablesInText(current, vars, "@");
}

export function preprocessLess(source: string): string {
  const expanded = extractAndExpandLessVariablesAndMixins(source);
  return flattenNestedCss(expanded);
}
