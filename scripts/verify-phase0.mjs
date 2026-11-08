import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const required = [
  "README.md",
  "AGENT_HANDOFF.md",
  "PHASE_0_SCOPE.md",
  "DECISIONS.md",
  "ROADMAP.md",
  "tsconfig.base.json",
  "spec/SPEC_STATUS.md",
  "spec/LANGUAGE.md",
  "spec/AST.md",
  "spec/SEMANTICS.md",
  "spec/RUNTIME_API.md",
  "spec/CSS_SCOPING.md",
  "spec/DIAGNOSTICS.md",
  "spec/SECURITY.md",
  "spec/TESTING.md",
  "spec/PERFORMANCE.md",
  "spec/COMPATIBILITY.md",
  "packages/ast/package.json",
  "packages/compiler-frontend/package.json",
  "packages/compiler-semantic/package.json",
  "packages/compiler-css/package.json",
  "packages/compiler-codegen/package.json",
  "packages/runtime/package.json",
  "packages/router/package.json"
];

const missing = required.filter((file) => !existsSync(resolve(file)));
if (missing.length) {
  console.error("Phase 0 scaffold check failed. Missing:");
  for (const file of missing) console.error(` - ${file}`);
  process.exitCode = 1;
} else {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (pkg.private !== true || !Array.isArray(pkg.workspaces)) {
    console.error("Root package must be private and declare npm workspaces.");
    process.exitCode = 1;
  } else {
    console.log(`Phase 0 scaffold check passed (${required.length} required paths).`);
    console.log("This check validates repository structure only; it does not test compiler behavior.");
  }
}
