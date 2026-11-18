/**
 * @dotmix/cli — Atomic Architectural Code Generator (`mix add` / `mix generate`)
 */

import fs from "node:fs";
import path from "node:path";
import type { ParsedCliArgs } from "../args.js";
import { colors } from "../terminal.js";
import { syncCollectionSource } from "../sync-template.js";
import {
  renderStylesheet,
  stylesheetImportLine,
  type StylesheetFormat,
  type StylesheetRule
} from "../stylesheet-template.js";

/** The sibling stylesheet format chosen by --scss, --sass, --less or --pcss (plain CSS otherwise). */
function selectStylesheetFormat(parsed: ParsedCliArgs): StylesheetFormat {
  if (parsed.values.scss) return "scss";
  if (parsed.values.sass) return "sass";
  if (parsed.values.less) return "less";
  if (parsed.values.pcss) return "pcss";
  return "css";
}

/** Writes `<directory>/<baseName>.<format>` next to the component and returns its path. */
function writeSiblingStylesheet(
  componentPath: string,
  format: StylesheetFormat,
  rule: StylesheetRule
): string {
  const stylesheetPath = path.join(
    path.dirname(componentPath),
    `${path.basename(componentPath, path.extname(componentPath))}.${format}`
  );
  fs.writeFileSync(stylesheetPath, renderStylesheet(format, [rule]), "utf-8");
  return stylesheetPath;
}

function toPascal(str: string): string {
  const clean = str.replace(/[^a-zA-Z0-9]/g, " ");
  return clean
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function toCamel(str: string): string {
  const p = toPascal(str);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

function toKebab(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]/g, "-")
    .toLowerCase();
}

function isTypeScriptProject(cwd: string): boolean {
  return fs.existsSync(path.join(cwd, "tsconfig.json"));
}

function updateRoutesWithoutRegex(routesFilePath: string, pageName: string, compExt: string, explicitRoute?: string): boolean {
  if (!fs.existsSync(routesFilePath)) return false;

  const content = fs.readFileSync(routesFilePath, "utf-8");
  const importStatement = `import ${pageName} from "./pages/${pageName}.${compExt}";\n`;

  // Avoid duplicate registration
  if (content.includes(pageName)) {
    return false;
  }

  const routePath = explicitRoute ?? `/${toKebab(pageName.replace(/Page$/, ""))}`;
  const routeEntry = `  { path: "${routePath}", component: ${pageName} },\n`;

  // Insert import at the beginning
  let updated = importStatement + content;

  // Insert route entry inside routes array without regular expressions
  const routesDeclIdx = updated.indexOf("routes");
  if (routesDeclIdx !== -1) {
    const bracketOpenIdx = updated.indexOf("[", routesDeclIdx);
    if (bracketOpenIdx !== -1) {
      const bracketCloseIdx = updated.lastIndexOf("]");
      if (bracketCloseIdx > bracketOpenIdx) {
        updated =
          updated.slice(0, bracketCloseIdx) +
          routeEntry +
          updated.slice(bracketCloseIdx);
        fs.writeFileSync(routesFilePath, updated, "utf-8");
        return true;
      }
    }
  }

  return false;
}

export async function addCommand(parsed: ParsedCliArgs): Promise<number> {
  const type = parsed.positional[0]?.toLowerCase();
  const rawName = parsed.positional[1];

  if (!type || !rawName) {
    console.error(colors.yellow("Usage: mix add <component|page|layout|store|permission|sync> <Name>"));
    return 2;
  }

  if (type === "sync") {
    //: synced collection module; uses only the public syncCollection API.
    const syncCwd = process.cwd();
    const syncIsTs = isTypeScriptProject(syncCwd);
    const syncName = toPascal(rawName);
    const syncPath = path.join(syncCwd, `src/sync/${syncName}Collection.${syncIsTs ? "ts" : "js"}`);
    if (fs.existsSync(syncPath)) {
      console.error(colors.red(`${path.relative(syncCwd, syncPath)} already exists.`));
      return 1;
    }
    fs.mkdirSync(path.dirname(syncPath), { recursive: true });
    fs.writeFileSync(syncPath, syncCollectionSource(syncName, syncIsTs), "utf-8");
    const pkgPath = path.join(syncCwd, "package.json");
    const pkg = fs.existsSync(pkgPath) ? (JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { dependencies?: Record<string, string> }) : {};
    const hasSyncDependency = Boolean(pkg.dependencies?.["@dotmix/sync"]);
    if (parsed.values.json) {
      console.log(JSON.stringify({ success: true, type, name: rawName, files: [syncPath], syncDependency: hasSyncDependency }));
      return 0;
    }
    if (!parsed.values.silent) {
      console.log(`
${colors.green("✓")} Created sync '${rawName}':`);
      console.log(`  ${colors.dim("•")} ${path.relative(syncCwd, syncPath)}`);
      if (!hasSyncDependency) {
        console.log(colors.yellow('  ! Add "@dotmix/sync" to "dependencies" in package.json.'));
      }
      console.log();
    }
    return 0;
  }

  const cwd = process.cwd();
  const isTs = isTypeScriptProject(cwd);
  const compExt = isTs ? "tix" : "mix";
  const codeExt = isTs ? "ts" : "js";
  const stylesheetFormat = selectStylesheetFormat(parsed);
  const createdFiles: string[] = [];
  let routeNotRegistered = false;

  switch (type) {
    case "component": {
      const name = toPascal(rawName);
      const kebab = toKebab(name);
      const compPath = path.join(cwd, `src/components/${name}.${compExt}`);
      const testPath = path.join(cwd, `tests/components/${name}.test.mjs`);

      fs.mkdirSync(path.dirname(compPath), { recursive: true });
      fs.mkdirSync(path.dirname(testPath), { recursive: true });

      const compContent = `${stylesheetImportLine(name, stylesheetFormat)}
export default function ${name}(props = {}) {
  return (
    <div class="${kebab}">
      <h2>${name} Component</h2>
      <slot />
    </div>
  );
}
`;
      createdFiles.push(writeSiblingStylesheet(compPath, stylesheetFormat, {
        selector: `.${kebab}`,
        declarations: [["display", "block"], ["padding", "1rem"]]
      }));

      const testContent = `import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("${name} Component", () => {
  it("renders correctly", () => {
    assert.ok(true);
  });
});
`;

      fs.writeFileSync(compPath, compContent, "utf-8");
      fs.writeFileSync(testPath, testContent, "utf-8");
      createdFiles.push(compPath, testPath);
      break;
    }

    case "page": {
      const baseName = toPascal(rawName);
      const pageName = baseName.endsWith("Page") ? baseName : `${baseName}Page`;
      const kebab = toKebab(pageName);
      const pagePath = path.join(cwd, `src/pages/${pageName}.${compExt}`);
      const testPath = path.join(cwd, `tests/pages/${pageName}.test.mjs`);

      fs.mkdirSync(path.dirname(pagePath), { recursive: true });
      fs.mkdirSync(path.dirname(testPath), { recursive: true });

      const pageContent = `${stylesheetImportLine(pageName, stylesheetFormat)}
export default function ${pageName}() {
  return (
    <main class="${kebab}">
      <h1>${baseName}</h1>
      <p>Page content for ${baseName}.</p>
    </main>
  );
}
`;
      createdFiles.push(writeSiblingStylesheet(pagePath, stylesheetFormat, {
        selector: `.${kebab}`,
        declarations: [["max-width", "800px"], ["margin", "0 auto"]]
      }));

      const testContent = `import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("${pageName}", () => {
  it("renders page structure", () => {
    assert.ok(true);
  });
});
`;

      fs.writeFileSync(pagePath, pageContent, "utf-8");
      fs.writeFileSync(testPath, testContent, "utf-8");
      createdFiles.push(pagePath, testPath);

      const explicitRoute = parsed.values.route;
      if (explicitRoute !== undefined && !explicitRoute.startsWith("/")) {
        console.error(colors.red(`Invalid --route '${explicitRoute}': it must start with '/'.`));
        return 2;
      }
      const routesFile = path.join(cwd, "src/routes.ts");
      const registered = updateRoutesWithoutRegex(routesFile, pageName, compExt, explicitRoute);
      if (registered) {
        if (!parsed.values.silent) {
          console.log(`  ${colors.green("✓")} Registered ${pageName} in src/routes.ts`);
        }
      } else {
        const reason = fs.existsSync(routesFile)
          ? "src/routes.ts has no routes array or already references this page"
          : "src/routes.ts does not exist";
        console.error(colors.yellow(`! Route not registered: ${reason}. Register ${pageName} manually.`));
        if (explicitRoute !== undefined) routeNotRegistered = true;
      }
      break;
    }

    case "layout": {
      const baseName = toPascal(rawName);
      const layoutName = baseName.endsWith("Layout") ? baseName : `${baseName}Layout`;
      const layoutPath = path.join(cwd, `src/layouts/${layoutName}.${compExt}`);

      fs.mkdirSync(path.dirname(layoutPath), { recursive: true });
      const layoutKebab = toKebab(layoutName);
      const layoutContent = `${stylesheetImportLine(layoutName, stylesheetFormat)}
export default function ${layoutName}() {
  return (
    <div class="${layoutKebab}">
      <header>Header</header>
      <main><slot /></main>
      <footer>Footer</footer>
    </div>
  );
}
`;
      createdFiles.push(writeSiblingStylesheet(layoutPath, stylesheetFormat, {
        selector: `.${layoutKebab}`,
        declarations: [["display", "flex"], ["flex-direction", "column"], ["min-height", "100vh"]]
      }));
      fs.writeFileSync(layoutPath, layoutContent, "utf-8");
      createdFiles.push(layoutPath);
      break;
    }

    case "store": {
      const name = toCamel(rawName);
      const storeName = name.endsWith("Store") ? name : `${name}Store`;
      const storePath = path.join(cwd, `src/stores/${storeName}.${codeExt}`);

      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      const storeContent = `import { signal, computed } from "@dotmix/runtime";

export function create${toPascal(storeName)}() {
  const value = signal(0);
  const doubled = computed(() => value() * 2);

  return {
    value,
    doubled,
    increment: () => value.set(value() + 1),
    reset: () => value.set(0)
  };
}

export const ${storeName} = create${toPascal(storeName)}();
`;
      fs.writeFileSync(storePath, storeContent, "utf-8");
      createdFiles.push(storePath);
      break;
    }

    case "permission": {
      const name = toCamel(rawName);
      const policyName = name.endsWith("Policy") ? name : `${name}Policy`;
      const policyPath = path.join(cwd, `src/permissions/${policyName}.${codeExt}`);

      fs.mkdirSync(path.dirname(policyPath), { recursive: true });
      const policyContent = `import { definePolicy } from "@dotmix/runtime/permissions";

export const ${policyName} = definePolicy({
  name: "${policyName}",
  authorize: (context, user) => Boolean(user && user.roles?.includes("admin"))
});
`;
      fs.writeFileSync(policyPath, policyContent, "utf-8");
      createdFiles.push(policyPath);
      break;
    }

    default:
      console.error(colors.red(`Unknown artifact type: '${type}'. Supported: component, page, layout, store, permission, sync`));
      return 2;
  }

  if (parsed.values.json) {
    console.log(JSON.stringify({ success: !routeNotRegistered, type, name: rawName, files: createdFiles, routeRegistered: !routeNotRegistered }));
    return routeNotRegistered ? 1 : 0;
  }

  if (!parsed.values.silent) {
    console.log(`\n${colors.green("✓")} Created ${type} '${rawName}':`);
    for (const f of createdFiles) {
      console.log(`  ${colors.dim("•")} ${path.relative(cwd, f)}`);
    }
    console.log();
  }

  return routeNotRegistered ? 1 : 0;
}
