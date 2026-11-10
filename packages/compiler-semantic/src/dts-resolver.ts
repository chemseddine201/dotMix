/**
 * @mix/compiler-semantic/dts-resolver — Package .d.ts resolution, caching, and virtual ambient declarations.
 */

import * as ts from "typescript";

export function posixDirname(p: string): string {
  const norm = p.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return norm.slice(0, idx);
}

export const IMMUTABLE_DTS_SOURCE_FILE_CACHE = new Map<string, ts.SourceFile>();
export const MIX_PACKAGE_DTS_CACHE = new Map<string, string>();

export function resolveMixPackageDts(
  modName: string,
  containingFile: string,
  baseDir?: string
): string | undefined {
  if (!modName.startsWith("@mix/") && !modName.startsWith("mix-helpers")) return undefined;
  const cached = MIX_PACKAGE_DTS_CACHE.get(modName);
  if (cached && ts.sys.fileExists(cached)) {
    return cached;
  }

  let pkgShort: string;
  let subpath: string;
  if (modName.startsWith("@mix/")) {
    const parts = modName.split("/");
    if (parts.length < 2) return undefined;
    pkgShort = parts[1]!;
    subpath = parts.length > 2 ? `./${parts.slice(2).join("/")}` : ".";
  } else {
    pkgShort = "helpers";
    const parts = modName.split("/");
    subpath = parts.length > 1 ? `./${parts.slice(1).join("/")}` : ".";
  }

  const searchStarts = [
    baseDir,
    posixDirname(containingFile),
    ts.sys.getCurrentDirectory(),
    posixDirname(ts.sys.getExecutingFilePath())
  ].filter((s): s is string => Boolean(s && s !== "."));

  for (const startDir of searchStarts) {
    let curr = ts.sys.resolvePath(startDir).replace(/\\/g, "/");
    for (let depth = 0; depth < 10; depth++) {
      const candidatePkgPaths = [
        `${curr}/packages/${pkgShort}/package.json`,
        `${curr}/node_modules/@mix/${pkgShort}/package.json`,
        `${curr}/node_modules/mix-helpers/package.json`
      ];
      for (const pkgJsonPath of candidatePkgPaths) {
        if (ts.sys.fileExists(pkgJsonPath)) {
          const rawJson = ts.sys.readFile(pkgJsonPath);
          if (rawJson) {
            try {
              const pkgJson = JSON.parse(rawJson) as {
                types?: string;
                exports?: Record<string, string | { types?: string; default?: string }>;
              };
              const pkgDir = posixDirname(pkgJsonPath);
              let relTypes: string | undefined;
              const expEntry = pkgJson.exports?.[subpath];
              if (expEntry && typeof expEntry === "object" && expEntry.types) {
                relTypes = expEntry.types;
              } else if (subpath === "." && pkgJson.types) {
                relTypes = pkgJson.types;
              }
              if (relTypes) {
                const resolvedDts = ts.sys.resolvePath(`${pkgDir}/${relTypes}`).replace(/\\/g, "/");
                if (ts.sys.fileExists(resolvedDts)) {
                  MIX_PACKAGE_DTS_CACHE.set(modName, resolvedDts);
                  return resolvedDts;
                }
              }
            } catch {
              // Ignore malformed package.json
            }
          }
        }
      }
      const parent = posixDirname(curr);
      if (parent === curr) break;
      curr = parent;
    }
  }

  return undefined;
}

export const VIRTUAL_AMBIENT_RUNTIME_DTS = `
declare module "*.css" {
  const css: string;
  export default css;
}

declare module "*.scss" {
  const css: string;
  export default css;
}

declare module "*.sass" {
  const css: string;
  export default css;
}

declare module "*.less" {
  const css: string;
  export default css;
}

declare module "*.styl" {
  const css: string;
  export default css;
}

declare module "*.stylus" {
  const css: string;
  export default css;
}

declare module "*.pcss" {
  const css: string;
  export default css;
}

declare module "*.postcss" {
  const css: string;
  export default css;
}

declare function signal<T>(initialValue: T): { (): T; set(next: T | ((prev: T) => T)): T; peek(): T };
declare function computed<T>(fn: () => T): { (): T; peek(): T };
declare function createEffect(fn: () => void | (() => void)): void;
declare function createRef<T = Element>(initial?: T | null): { current: T | null };
declare function defineProps<P>(defaults?: Partial<P>): P;
interface Context<T> { readonly id: symbol; readonly defaultValue: T; }
declare function createContext<T>(defaultValue?: T): Context<T>;
declare function useContext<T>(ctx: Context<T>): T;
declare function provideContext<T>(ctx: Context<T>, value: T): void;
`;
