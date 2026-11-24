/**
 * @dotmix/cli — Temporary Node SSR module compiler and @dotmix/* specifier resolver for static builds.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "@dotmix/compiler-frontend";
import {
  analyze,
  listStaticImportSpecifiers,
  replaceImportMetaEnv,
  rewriteJsModuleSpecifiers,
  transpileSourceModule
} from "@dotmix/compiler-semantic";
import { compileToSsr } from "@dotmix/compiler-ssr";
import { compileCss, preprocessCss } from "@dotmix/compiler-css";
import { removeSideEffectImports } from "@dotmix/compiler-semantic";
import { buildImportMetaEnvValues } from "./env-files.js";
import { scanInputDirectory, STYLE_FILE_REGEX } from "./scanner.js";

export interface CompiledSsrWorkspace {
  readonly tmpDir: string;
  readonly moduleKeys: ReadonlySet<string>;
  readonly staticImportGraph: ReadonlyMap<string, readonly string[]>;
  cleanup(): void;
}

function toPosixPath(p: string): string {
  return p.split(path.sep).join("/");
}

function toEmittedModuleSpecifier(specifier: string): string {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) return specifier;
  for (const suffix of [".tix.js", ".mix.js", ".tix", ".mix", ".ts"]) {
    if (specifier.endsWith(suffix) && !specifier.endsWith(".d.ts")) {
      return `${specifier.slice(0, -suffix.length)}.js`;
    }
  }
  return specifier;
}

function findPackageRoot(packageName: string, startDir: string): string | null {
  let curr = path.resolve(startDir);
  for (;;) {
    const nmCandidate = path.join(curr, "node_modules", ...packageName.split("/"));
    if (fs.existsSync(path.join(nmCandidate, "package.json"))) {
      return fs.realpathSync(nmCandidate);
    }
    const short = packageName.split("/")[1];
    if (short) {
      const wsCandidate = path.join(curr, "packages", short);
      if (fs.existsSync(path.join(wsCandidate, "package.json"))) {
        return fs.realpathSync(wsCandidate);
      }
    }
    const parent = path.dirname(curr);
    if (parent === curr) return null;
    curr = parent;
  }
}

function resolveExportString(target: unknown): string | null {
  if (typeof target === "string") return target;
  if (!target || typeof target !== "object") return null;
  const rec = target as Record<string, unknown>;
  for (const cond of ["import", "node", "default"]) {
    const res = resolveExportString(rec[cond]);
    if (res) return res;
  }
  return null;
}

function resolveDotmixPackageSpecifier(specifier: string, projectDir: string): string {
  if (!specifier.startsWith("@dotmix/")) return specifier;
  const parts = specifier.split("/");
  const pkgName = parts.slice(0, 2).join("/");
  const subpath = parts.length > 2 ? `./${parts.slice(2).join("/")}` : ".";
  const pkgRoot =
    findPackageRoot(pkgName, projectDir) ??
    findPackageRoot(pkgName, path.dirname(fileURLToPath(import.meta.url)));
  if (!pkgRoot) return specifier;

  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf-8")) as {
    main?: string;
    exports?: Record<string, unknown>;
  };
  let relTarget: string | null = null;
  if (pkgJson.exports && typeof pkgJson.exports === "object") {
    relTarget = resolveExportString(pkgJson.exports[subpath]);
  }
  if (!relTarget && subpath === ".") {
    relTarget = pkgJson.main ?? "dist/index.js";
  }
  if (!relTarget) return specifier;
  return pathToFileURL(path.resolve(pkgRoot, relTarget)).href;
}

export function compileSsrWorkspace(
  inDir: string,
  outDir: string,
  mode: string
): CompiledSsrWorkspace {
  const projectDir = path.dirname(inDir);
  const tmpDir = path.join(outDir, ".mix-ssr-tmp");
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ type: "module" }), "utf-8");

  const envValues = buildImportMetaEnvValues(projectDir, mode);
  const { mixFiles, scriptFiles } = scanInputDirectory(inDir);
  const moduleKeys = new Set<string>();
  const staticImportGraph = new Map<string, string[]>();

  const toModuleKey = (absPath: string): string =>
    `${toPosixPath(path.relative(inDir, absPath)).slice(0, -path.extname(absPath).length)}.js`;

  const rewriteSpecifiers = (code: string): string =>
    rewriteJsModuleSpecifiers(code, (spec) => {
      if (spec.startsWith("@dotmix/")) {
        return resolveDotmixPackageSpecifier(spec, projectDir);
      }
      return toEmittedModuleSpecifier(spec);
    });

  for (const file of mixFiles) {
    const filename = path.basename(file);
    const source = fs.readFileSync(file, "utf-8");
    const readExternalStyle = (relPath: string, fromFile?: string): string => {
      const baseDir = fromFile && path.isAbsolute(fromFile)
        ? path.dirname(fromFile)
        : path.dirname(file);
      const resolved = path.resolve(baseDir, relPath);
      return fs.existsSync(resolved) ? fs.readFileSync(resolved, "utf-8") : "";
    };
    const ast = parse(source, { filename, readFile: (rel) => readExternalStyle(rel) });
    const desc = analyze(ast, { filename, source });

    let cssResult: ReturnType<typeof compileCss> | undefined;
    if (ast.style && ast.style.content.trim().length > 0) {
      const pre = preprocessCss(ast.style.content, { filename });
      cssResult = compileCss(pre.code, { filename, scoped: ast.style.scoped });
    }

    const moduleKey = toModuleKey(file);
    const relSourceName = moduleKey.replace(/\.js$/, path.extname(file));
    const ssr = compileToSsr(desc, cssResult, { mode, filename: relSourceName, source });
    moduleKeys.add(moduleKey);

    const stripped = removeSideEffectImports(ssr.code, (s) => STYLE_FILE_REGEX.test(s));
    const withEnv = replaceImportMetaEnv(stripped, envValues);
    const rewritten = rewriteSpecifiers(withEnv);
    const wrapped = [
      rewritten,
      `renderToString.__mixModuleKey = ${JSON.stringify(moduleKey)};`,
      `renderToString.__mixHydrationMeta = ${JSON.stringify(ssr.hydrationMeta ?? { isInteractive: false, islandSpecifiers: [] })};`,
      `export default renderToString;`
    ].join("\n");

    const relDeps = listStaticImportSpecifiers(stripped)
      .filter((s) => s.startsWith("./") || s.startsWith("../"))
      .filter((s) => !STYLE_FILE_REGEX.test(s))
      .map((s) => path.posix.normalize(path.posix.join(path.posix.dirname(moduleKey), toEmittedModuleSpecifier(s))));
    staticImportGraph.set(moduleKey, relDeps);

    const diskPath = path.join(tmpDir, ...moduleKey.split("/"));
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, wrapped, "utf-8");
  }

  for (const scriptFile of scriptFiles) {
    const source = fs.readFileSync(scriptFile, "utf-8");
    const moduleKey = toModuleKey(scriptFile);
    moduleKeys.add(moduleKey);

    const transpiled = transpileSourceModule(source, scriptFile.endsWith(".ts"));
    const stripped = removeSideEffectImports(transpiled, (s) => STYLE_FILE_REGEX.test(s));
    const withEnv = replaceImportMetaEnv(stripped, envValues);
    const rewritten = rewriteSpecifiers(withEnv);

    const relDeps = listStaticImportSpecifiers(stripped)
      .filter((s) => s.startsWith("./") || s.startsWith("../"))
      .filter((s) => !STYLE_FILE_REGEX.test(s))
      .map((s) => path.posix.normalize(path.posix.join(path.posix.dirname(moduleKey), toEmittedModuleSpecifier(s))));
    staticImportGraph.set(moduleKey, relDeps);

    const diskPath = path.join(tmpDir, ...moduleKey.split("/"));
    fs.mkdirSync(path.dirname(diskPath), { recursive: true });
    fs.writeFileSync(diskPath, rewritten, "utf-8");
  }

  return {
    tmpDir,
    moduleKeys,
    staticImportGraph,
    cleanup(): void {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  };
}

