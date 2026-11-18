/**
 * @dotmix/cli — Comprehensive Project Template Generator (`mix create` / `mix init`)
 *
 * Implements &:
 * - Templates: `minimal`, `standard` (default), `showcase`, `sync-crdt`
 * - Stylesheet preprocessors: scss, sass, less, pcss, css
 * - Package managers: auto-detection or override (pnpm, npm, yarn, bun)
 * - Git repository initialization: `--git` (runs exclusively in target dir)
 * - Automated dependency installation: `--install`
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createSyncCrdtProject } from "./sync-template.js";
import { renderStylesheet, stylesheetImportLine } from "./stylesheet-template.js";
import { DOTMIX_VERSION } from "./version.js";

export type TemplateVariant = "minimal" | "standard" | "showcase" | "sync-crdt";
export type StyleFormat = "scss" | "sass" | "less" | "pcss" | "css";
export type PackageManager = "pnpm" | "npm" | "yarn" | "bun";

export interface CreateOptions {
  projectName: string;
  targetDir?: string | undefined;
  typescript?: boolean | undefined;
  styleFormat?: StyleFormat | undefined;
  template?: TemplateVariant | undefined;
  git?: boolean | undefined;
  install?: boolean | undefined;
  packageManager?: PackageManager | string | undefined;
}

export interface CreateResult {
  readonly success: boolean;
  readonly targetDir: string;
  readonly createdFiles: readonly string[];
  readonly gitInitialized?: boolean | undefined;
  readonly dependenciesInstalled?: boolean | undefined;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_ROOT = path.resolve(__dirname, "../templates");

function walkTemplateDir(dir: string, baseRel = ""): Array<{ absPath: string; relPath: string }> {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const results: Array<{ absPath: string; relPath: string }> = [];

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    const relPath = baseRel ? `${baseRel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...walkTemplateDir(absPath, relPath));
    } else if (entry.isFile()) {
      results.push({ absPath, relPath });
    }
  }
  return results;
}

function applyTemplateTokens(
  content: string,
  tokens: { projectName: string; styleExt: string; compExt: string }
): string {
  return content
    .replaceAll("{{projectName}}", tokens.projectName)
    .replaceAll("{{styleExt}}", tokens.styleExt)
    .replaceAll("{{compExt}}", tokens.compExt)
    .replaceAll("{{dotmixVersion}}", DOTMIX_VERSION);
}

export function detectPackageManager(): PackageManager {
  const ua = process.env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  if (ua.startsWith("bun")) return "bun";
  return "npm";
}

function createMinimalProject(
  targetDir: string,
  projectName: string,
  isTs: boolean,
  styleExt: StyleFormat
): string[] {
  const compExt = isTs ? "tix" : "mix";
  const scriptExt = isTs ? "ts" : "js";
  const created: string[] = [];

  const pkgJson = {
    name: projectName,
    version: "0.1.0",
    type: "module",
    scripts: {
      dev: "mix dev",
      build: "mix build src dist",
      check: "mix check src",
      test: "mix test"
    },
    dependencies: {
      "@dotmix/runtime": DOTMIX_VERSION
    },
    devDependencies: {
      "@dotmix/cli": DOTMIX_VERSION
    }
  };

  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${projectName}</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.${scriptExt}"></script>
</body>
</html>
`;

  const mainSource = `import { mount } from "@dotmix/runtime";
import App from "./App.${compExt}";

const root = document.getElementById("app");
if (root) {
  mount(App, root);
}
`;

  const appComponent = `${stylesheetImportLine("App", styleExt)}
export default function App() {
  return (
    <div class="app-container">
      <h1>Welcome to ${projectName}</h1>
      <p>Minimal dotMix application</p>
    </div>
  );
}
`;
  const appStylesheet = renderStylesheet(styleExt, [
    {
      selector: ".app-container",
      declarations: [
        ["font-family", "system-ui, sans-serif"],
        ["padding", "2rem"],
        ["text-align", "center"]
      ]
    }
  ]);

  const files: Record<string, string> = {
    "package.json": JSON.stringify(pkgJson, null, 2) + "\n",
    "index.html": indexHtml,
    [`src/main.${scriptExt}`]: mainSource,
    [`src/App.${compExt}`]: appComponent,
    [`src/App.${styleExt}`]: appStylesheet
  };

  if (isTs) {
    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true
      },
      include: ["src/**/*"]
    };
    files["tsconfig.json"] = JSON.stringify(tsconfig, null, 2) + "\n";
    // Lets TypeScript accept .tix/.mix component imports and stylesheet imports in .ts files.
    files["src/env.d.ts"] = "/// <reference types=\"@dotmix/runtime/client\" />\n";
  }

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
    created.push(fullPath);
  }

  return created;
}

export function create(options: CreateOptions): CreateResult {
  const targetDir = path.resolve(options.targetDir || options.projectName);
  const styleExt = options.styleFormat ?? "scss";
  const isTs = options.typescript !== false;
  const compExt = isTs ? "tix" : "mix";
  const template = options.template ?? "standard";

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const createdFiles: string[] = [];

  if (template === "minimal") {
    createdFiles.push(...createMinimalProject(targetDir, options.projectName, isTs, styleExt));
  } else if (template === "sync-crdt") {
    createdFiles.push(...createSyncCrdtProject(targetDir, options.projectName, isTs));
  } else {
    // Standard and Showcase templates
    const tokens = {
      projectName: options.projectName,
      styleExt,
      compExt
    };

    const sources: Array<{ dir: string; mapRelPath: (rel: string) => string }> = [
      {
        dir: path.join(TEMPLATES_ROOT, "shared"),
        mapRelPath: (rel) => rel.replace(/\.tpl$/, "")
      },
      {
        dir: path.join(TEMPLATES_ROOT, isTs ? "ts" : "js"),
        mapRelPath: (rel) => rel
      },
      {
        dir: path.join(TEMPLATES_ROOT, "styles", styleExt === "css" ? "css" : "preproc"),
        mapRelPath: (rel) => rel.replace(/\.style$/, `.${styleExt}`)
      }
    ];

    for (const sourceGroup of sources) {
      const templateFiles = walkTemplateDir(sourceGroup.dir);
      for (const tFile of templateFiles) {
        const destRel = sourceGroup.mapRelPath(tFile.relPath);
        const destAbs = path.join(targetDir, destRel);
        fs.mkdirSync(path.dirname(destAbs), { recursive: true });
        const raw = fs.readFileSync(tFile.absPath, "utf-8");
        const rendered = applyTemplateTokens(raw, tokens);
        fs.writeFileSync(destAbs, rendered, "utf-8");
        createdFiles.push(destAbs);
      }
    }
  }

  let gitInitialized = false;
  if (options.git) {
    try {
      spawnSync("git", ["init"], { cwd: targetDir, stdio: "ignore" });
      gitInitialized = fs.existsSync(path.join(targetDir, ".git"));
    } catch {
      gitInitialized = false;
    }
  }

  let dependenciesInstalled = false;
  if (options.install) {
    const pm = options.packageManager || detectPackageManager();
    try {
      spawnSync(pm, ["install"], { cwd: targetDir, stdio: "ignore" });
      dependenciesInstalled = true;
    } catch {
      dependenciesInstalled = false;
    }
  }

  return {
    success: true,
    targetDir,
    createdFiles,
    gitInitialized,
    dependenciesInstalled
  };
}
