/**
 * @dotmix/cli — Configuration Loader and Precedence Resolver.
 * Discovers and validates mix.config.ts / mix.config.mjs / mix.config.js.
 */

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DiagnosticCodes, MixDiagnosticError } from "@dotmix/diagnostics";
import { transpileSourceModule } from "@dotmix/compiler-semantic";
import type { I18nConfig } from "@dotmix/router";
import type { ParsedCliArgs } from "./args.js";
import { parsePrerenderRoutes } from "./prerender.js";
import {
  validateCspConfig,
  validateI18nConfig,
  validateSeoConfig,
  validateSiteConfig,
  type CspConfig,
  type SeoConfig,
  type SiteConfig,
  type StaticBuildConfig
} from "./config-schema.js";

export type {
  CspConfig,
  RobotsConfig,
  SeoConfig,
  SiteConfig,
  SitemapConfig,
  StaticBuildConfig
} from "./config-schema.js";

export interface MixConfig {
  srcDir?: string;
  outDir?: string;
  base?: string;
  site?: SiteConfig;
  i18n?: I18nConfig;
  seo?: SeoConfig;
  csp?: CspConfig;
  dev?: {
    port?: number;
    host?: string;
    open?: boolean;
    cors?: boolean;
  };
  preview?: {
    port?: number;
    host?: string;
    open?: boolean;
  };
  build?: {
    clean?: boolean;
    sourcemap?: boolean;
    prerender?: readonly string[];
    static?: boolean | StaticBuildConfig;
  };
}

export interface LoadedConfigResult {
  readonly config: MixConfig;
  readonly configPath: string | null;
}

export interface ResolvedCommandOptions {
  readonly config: MixConfig;
  readonly configPath: string | null;
  readonly build: {
    readonly inDir: string;
    readonly outDir: string;
    readonly target: "client" | "ssr";
    readonly isStatic: boolean;
    readonly prerenderBrowser: boolean;
    readonly clean: boolean;
    readonly sourcemap: boolean;
    readonly analyze: boolean;
    readonly mode: string;
    readonly base: string | undefined;
    readonly prerenderRoutes: readonly string[];
  };
  readonly dev: {
    readonly rootDir: string;
    readonly port: number;
    readonly host: string;
    readonly open: boolean;
    readonly cors: boolean;
    readonly mode: string;
  };
  readonly preview: {
    readonly dir: string;
    readonly port: number;
    readonly host: string;
    readonly open: boolean;
  };
  readonly check: {
    readonly target: string | undefined;
  };
}

function createConfigDiagnostic(configPath: string, messageText: string): MixDiagnosticError {
  return new MixDiagnosticError({
    code: DiagnosticCodes.MIX_ERR_CONFIG_INVALID,
    severity: "error",
    message: `${configPath}: ${messageText}`,
    span: {
      file: configPath,
      start: { line: 1, column: 1, offset: 0 },
      end: { line: 1, column: 1, offset: 0 }
    }
  });
}

/**
 * Discovers the configuration file in the specified project directory.
 * Throws MIX_ERR_CONFIG_INVALID if more than one configuration file exists.
 */
export function discoverConfigFile(projectDirectory: string): string | null {
  const candidateExtensions = [".ts", ".mjs", ".js"];
  const existingFiles: string[] = [];

  for (const extension of candidateExtensions) {
    const candidatePath = path.join(projectDirectory, `mix.config${extension}`);
    if (fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()) {
      existingFiles.push(candidatePath);
    }
  }

  if (existingFiles.length > 1) {
    const filenames = existingFiles.map((fullPath) => path.basename(fullPath)).join(", ");
    throw createConfigDiagnostic(
      existingFiles[0]!,
      `Multiple configuration files found in ${projectDirectory} (${filenames}). Specify only one configuration file.`
    );
  }

  return existingFiles[0] ?? null;
}

/**
 * Validates the loaded configuration object against the MixConfig schema.
 */
export function validateMixConfig(rawInput: unknown, configPath: string): MixConfig {
  if (typeof rawInput !== "object" || rawInput === null || Array.isArray(rawInput)) {
    throw createConfigDiagnostic(configPath, "expected a configuration object");
  }

  const rootRecord = rawInput as Record<string, unknown>;
  const allowedRootProperties = new Set(["srcDir", "outDir", "base", "site", "i18n", "seo", "csp", "dev", "preview", "build"]);

  for (const propertyKey of Object.keys(rootRecord)) {
    if (!allowedRootProperties.has(propertyKey)) {
      throw createConfigDiagnostic(configPath, `${propertyKey}: unknown configuration property`);
    }
  }

  if (rootRecord.srcDir !== undefined && typeof rootRecord.srcDir !== "string") {
    throw createConfigDiagnostic(configPath, "srcDir: expected a string");
  }
  if (rootRecord.outDir !== undefined && typeof rootRecord.outDir !== "string") {
    throw createConfigDiagnostic(configPath, "outDir: expected a string");
  }
  if (rootRecord.base !== undefined && typeof rootRecord.base !== "string") {
    throw createConfigDiagnostic(configPath, "base: expected a string");
  }
  if (rootRecord.site !== undefined) {
    validateSiteConfig(rootRecord.site, configPath);
  }
  if (rootRecord.i18n !== undefined) {
    validateI18nConfig(rootRecord.i18n, configPath);
  }
  if (rootRecord.seo !== undefined) {
    validateSeoConfig(rootRecord.seo, configPath);
  }
  if (rootRecord.csp !== undefined) {
    validateCspConfig(rootRecord.csp, configPath);
  }

  if (rootRecord.dev !== undefined) {
    if (typeof rootRecord.dev !== "object" || rootRecord.dev === null || Array.isArray(rootRecord.dev)) {
      throw createConfigDiagnostic(configPath, "dev: expected an object");
    }
    const devRecord = rootRecord.dev as Record<string, unknown>;
    const allowedDevProperties = new Set(["port", "host", "open", "cors"]);
    for (const devKey of Object.keys(devRecord)) {
      if (!allowedDevProperties.has(devKey)) {
        throw createConfigDiagnostic(configPath, `dev.${devKey}: unknown configuration property`);
      }
    }
    if (devRecord.port !== undefined && (typeof devRecord.port !== "number" || Number.isNaN(devRecord.port))) {
      throw createConfigDiagnostic(configPath, "dev.port: expected a number");
    }
    if (devRecord.host !== undefined && typeof devRecord.host !== "string") {
      throw createConfigDiagnostic(configPath, "dev.host: expected a string");
    }
    if (devRecord.open !== undefined && typeof devRecord.open !== "boolean") {
      throw createConfigDiagnostic(configPath, "dev.open: expected a boolean");
    }
    if (devRecord.cors !== undefined && typeof devRecord.cors !== "boolean") {
      throw createConfigDiagnostic(configPath, "dev.cors: expected a boolean");
    }
  }

  if (rootRecord.preview !== undefined) {
    if (typeof rootRecord.preview !== "object" || rootRecord.preview === null || Array.isArray(rootRecord.preview)) {
      throw createConfigDiagnostic(configPath, "preview: expected an object");
    }
    const previewRecord = rootRecord.preview as Record<string, unknown>;
    const allowedPreviewProperties = new Set(["port", "host", "open"]);
    for (const previewKey of Object.keys(previewRecord)) {
      if (!allowedPreviewProperties.has(previewKey)) {
        throw createConfigDiagnostic(configPath, `preview.${previewKey}: unknown configuration property`);
      }
    }
    if (previewRecord.port !== undefined && (typeof previewRecord.port !== "number" || Number.isNaN(previewRecord.port))) {
      throw createConfigDiagnostic(configPath, "preview.port: expected a number");
    }
    if (previewRecord.host !== undefined && typeof previewRecord.host !== "string") {
      throw createConfigDiagnostic(configPath, "preview.host: expected a string");
    }
    if (previewRecord.open !== undefined && typeof previewRecord.open !== "boolean") {
      throw createConfigDiagnostic(configPath, "preview.open: expected a boolean");
    }
  }

  if (rootRecord.build !== undefined) {
    if (typeof rootRecord.build !== "object" || rootRecord.build === null || Array.isArray(rootRecord.build)) {
      throw createConfigDiagnostic(configPath, "build: expected an object");
    }
    const buildRecord = rootRecord.build as Record<string, unknown>;
    const allowedBuildProperties = new Set(["clean", "sourcemap", "prerender", "static"]);
    for (const buildKey of Object.keys(buildRecord)) {
      if (!allowedBuildProperties.has(buildKey)) {
        throw createConfigDiagnostic(configPath, `build.${buildKey}: unknown configuration property`);
      }
    }
    if (buildRecord.clean !== undefined && typeof buildRecord.clean !== "boolean") {
      throw createConfigDiagnostic(configPath, "build.clean: expected a boolean");
    }
    if (buildRecord.sourcemap !== undefined && typeof buildRecord.sourcemap !== "boolean") {
      throw createConfigDiagnostic(configPath, "build.sourcemap: expected a boolean");
    }
    if (buildRecord.prerender !== undefined) {
      if (!Array.isArray(buildRecord.prerender)) {
        throw createConfigDiagnostic(configPath, "build.prerender: expected an array of strings");
      }
      for (let index = 0; index < buildRecord.prerender.length; index++) {
        if (typeof buildRecord.prerender[index] !== "string") {
          throw createConfigDiagnostic(configPath, `build.prerender[${index}]: expected a string`);
        }
      }
    }
  }

  return rawInput as MixConfig;
}

/**
 * Loads and validates the configuration file for a project directory.
 */
export async function loadMixConfig(projectDirectory: string): Promise<LoadedConfigResult> {
  const configPath = discoverConfigFile(projectDirectory);
  if (!configPath) {
    return { config: {}, configPath: null };
  }

  let rawConfig: unknown;

  if (configPath.endsWith(".ts")) {
    const sourceCode = fs.readFileSync(configPath, "utf-8");
    const transpiledCode = transpileSourceModule(sourceCode, true);
    const uniqueToken = Math.random().toString(36).slice(2);
    const temporarySiblingPath = path.join(
      path.dirname(configPath),
      `.mix.config.${Date.now()}.${uniqueToken}.mjs`
    );

    fs.writeFileSync(temporarySiblingPath, transpiledCode, "utf-8");
    try {
      const moduleUrl = `${pathToFileURL(temporarySiblingPath).href}?timestamp=${Date.now()}`;
      const importedModule = await import(moduleUrl);
      rawConfig = importedModule && typeof importedModule === "object" && "default" in importedModule
        ? importedModule.default
        : importedModule;
    } catch (evaluationError) {
      const message = evaluationError instanceof Error ? evaluationError.message : String(evaluationError);
      throw createConfigDiagnostic(configPath, message);
    } finally {
      try {
        if (fs.existsSync(temporarySiblingPath)) {
          fs.unlinkSync(temporarySiblingPath);
        }
      } catch {
        // Silently ignore unlink errors during cleanup
      }
    }
  } else {
    try {
      const moduleUrl = `${pathToFileURL(path.resolve(configPath)).href}?timestamp=${Date.now()}`;
      const importedModule = await import(moduleUrl);
      rawConfig = importedModule && typeof importedModule === "object" && "default" in importedModule
        ? importedModule.default
        : importedModule;
    } catch (evaluationError) {
      const message = evaluationError instanceof Error ? evaluationError.message : String(evaluationError);
      throw createConfigDiagnostic(configPath, message);
    }
  }

  const validatedConfig = validateMixConfig(rawConfig, configPath);
  return { config: validatedConfig, configPath };
}

/**
 * Resolves CLI arguments and loaded configuration into normalized command options.
 * Precedence rule: CLI flags/positionals > config file > framework defaults.
 */
export async function resolveCommandOptions(
  parsed: ParsedCliArgs,
  projectDirectory: string = process.cwd()
): Promise<ResolvedCommandOptions> {
  const { config, configPath } = await loadMixConfig(projectDirectory);

  const resolvedBuildInDir = parsed.positional[0] || config.srcDir || "src";
  const resolvedBuildOutDir = parsed.positional[1] || config.outDir || "dist";
  const resolvedTarget = (parsed.values.target as "client" | "ssr") || "client";
  const resolvedClean = parsed.values.clean !== undefined ? parsed.values.clean : (config.build?.clean ?? false);
  const resolvedSourcemap = parsed.values.sourcemap !== undefined
    ? parsed.values.sourcemap
    : (config.build?.sourcemap ?? false);
  const resolvedBase = parsed.values.base !== undefined ? parsed.values.base : config.base;
  const resolvedPrerenderRoutes = parsed.values.prerender !== undefined
    ? parsePrerenderRoutes(parsed.values.prerender)
    : (config.build?.prerender ?? []);
  const resolvedIsStatic = parsed.values.static !== undefined
    ? parsed.values.static
    : Boolean(config.build?.static);
  const resolvedPrerenderBrowser = Boolean(parsed.values.prerenderBrowser);

  const resolvedDevRootDir = parsed.positional[0] || ".";
  const resolvedDevPort = parsed.values.port
    ? parseInt(parsed.values.port, 10)
    : (config.dev?.port ?? 3000);
  const resolvedDevHost = parsed.values.host || config.dev?.host || "localhost";
  const resolvedDevOpen = parsed.values.open !== undefined ? parsed.values.open : (config.dev?.open ?? false);
  const resolvedDevCors = parsed.values.cors !== undefined ? parsed.values.cors : (config.dev?.cors ?? false);
  const resolvedDevMode = parsed.values.mode || "development";

  const resolvedPreviewDir = parsed.positional[0] || parsed.values.target || config.outDir || "dist";
  const resolvedPreviewPort = parsed.values.port
    ? parseInt(parsed.values.port, 10)
    : (config.preview?.port ?? 4173);
  const resolvedPreviewHost = parsed.values.host || config.preview?.host || "localhost";
  const resolvedPreviewOpen = parsed.values.open !== undefined ? parsed.values.open : (config.preview?.open ?? false);

  const resolvedCheckTarget = parsed.positional[0] || config.srcDir || undefined;

  return {
    config,
    configPath,
    build: {
      inDir: resolvedBuildInDir,
      outDir: resolvedBuildOutDir,
      target: resolvedTarget,
      isStatic: resolvedIsStatic,
      prerenderBrowser: resolvedPrerenderBrowser,
      clean: resolvedClean,
      sourcemap: resolvedSourcemap,
      analyze: Boolean(parsed.values.analyze),
      mode: parsed.values.mode || "production",
      base: resolvedBase,
      prerenderRoutes: resolvedPrerenderRoutes
    },
    dev: {
      rootDir: resolvedDevRootDir,
      port: resolvedDevPort,
      host: resolvedDevHost,
      open: resolvedDevOpen,
      cors: resolvedDevCors,
      mode: resolvedDevMode
    },
    preview: {
      dir: resolvedPreviewDir,
      port: resolvedPreviewPort,
      host: resolvedPreviewHost,
      open: resolvedPreviewOpen
    },
    check: {
      target: resolvedCheckTarget
    }
  };
}

