/**
 * @dotmix/cli — Zero-Dependency Argument Parser via node:util.parseArgs
 */

import { parseArgs } from "node:util";

export interface CliValues {
  help?: boolean | undefined;
  version?: boolean | undefined;
  debug?: boolean | undefined;
  json?: boolean | undefined;
  silent?: boolean | undefined;
  template?: string | undefined;
  target?: string | undefined;
  port?: string | undefined;
  host?: string | undefined;
  open?: boolean | undefined;
  cors?: boolean | undefined;
  sourcemap?: boolean | undefined;
  clean?: boolean | undefined;
  analyze?: boolean | undefined;
  watch?: boolean | undefined;
  format?: string | undefined;
  fix?: boolean | undefined;
  coverage?: boolean | undefined;
  browser?: boolean | undefined;
  git?: boolean | undefined;
  install?: boolean | undefined;
  packageManager?: string | undefined;
  dryRun?: boolean | undefined;
  registry?: string | undefined;
  codemod?: boolean | undefined;
  js?: boolean | undefined;
  ts?: boolean | undefined;
  scss?: boolean | undefined;
  less?: boolean | undefined;
  css?: boolean | undefined;
  sass?: boolean | undefined;
  pcss?: boolean | undefined;
  route?: string | undefined;
  mode?: string | undefined;
  templateStyle?: string | undefined;
  base?: string | undefined;
  prerender?: string | undefined;
}

export interface ParsedCliArgs {
  readonly command: string;
  readonly positional: string[];
  readonly values: CliValues;
}

function boolOpt(val: unknown): boolean | undefined {
  return typeof val === "boolean" ? val : undefined;
}

function strOpt(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

export function parseCliArguments(argv: string[]): ParsedCliArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      debug: { type: "boolean" },
      json: { type: "boolean" },
      silent: { type: "boolean" },
      template: { type: "string" },
      target: { type: "string", short: "d" },
      port: { type: "string", short: "p" },
      host: { type: "string" },
      open: { type: "boolean" },
      cors: { type: "boolean" },
      sourcemap: { type: "boolean" },
      clean: { type: "boolean" },
      analyze: { type: "boolean" },
      watch: { type: "boolean", short: "w" },
      format: { type: "string" },
      fix: { type: "boolean" },
      coverage: { type: "boolean" },
      browser: { type: "boolean" },
      git: { type: "boolean" },
      install: { type: "boolean" },
      "package-manager": { type: "string" },
      "dry-run": { type: "boolean" },
      registry: { type: "string" },
      route: { type: "string" },
      codemod: { type: "boolean" },
      js: { type: "boolean" },
      javascript: { type: "boolean" },
      ts: { type: "boolean" },
      typescript: { type: "boolean" },
      scss: { type: "boolean" },
      less: { type: "boolean" },
      css: { type: "boolean" },
      sass: { type: "boolean" },
      pcss: { type: "boolean" },
      mode: { type: "string" },
      "template-style": { type: "string" },
      base: { type: "string" },
      prerender: { type: "string" }
    },
    strict: false,
    allowPositionals: true,
    allowNegative: true
  });

  const command = positionals[0] || (values.help ? "help" : values.version ? "version" : "help");
  const positionalArgs = positionals.slice(1);

  const resValues: CliValues = {
    help: boolOpt(values.help),
    version: boolOpt(values.version),
    debug: boolOpt(values.debug),
    json: boolOpt(values.json),
    silent: boolOpt(values.silent),
    template: strOpt(values.template),
    target: strOpt(values.target),
    port: strOpt(values.port),
    host: strOpt(values.host),
    open: boolOpt(values.open),
    cors: boolOpt(values.cors),
    sourcemap: boolOpt(values.sourcemap),
    clean: boolOpt(values.clean),
    analyze: boolOpt(values.analyze),
    watch: boolOpt(values.watch),
    format: strOpt(values.format),
    fix: boolOpt(values.fix),
    coverage: boolOpt(values.coverage),
    browser: boolOpt(values.browser),
    git: boolOpt(values.git),
    install: boolOpt(values.install),
    packageManager: strOpt(values["package-manager"]),
    dryRun: boolOpt(values["dry-run"]),
    registry: strOpt(values.registry),
    route: strOpt(values.route),
    codemod: boolOpt(values.codemod),
    js: boolOpt(values.js) ?? boolOpt(values.javascript),
    ts: boolOpt(values.ts) ?? boolOpt(values.typescript),
    scss: boolOpt(values.scss),
    less: boolOpt(values.less),
    css: boolOpt(values.css),
    sass: boolOpt(values.sass),
    pcss: boolOpt(values.pcss),
    mode: strOpt(values.mode),
    templateStyle: strOpt(values["template-style"]),
    base: strOpt(values.base),
    prerender: strOpt(values.prerender)
  };

  return {
    command,
    positional: positionalArgs,
    values: resValues
  };
}
