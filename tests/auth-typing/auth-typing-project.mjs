import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../packages/compiler-semantic/dist/index.js";

export const runtimeDirectivesDeclarations = path.resolve(
  "packages/runtime/dist/directives/index.d.ts"
);

export const appAuthModule = `import { createAuth } from "@dotmix/runtime/directives";

export interface Customer {
  readonly email: string;
}

export interface AdminUser {
  readonly email: string;
  readonly permissions: readonly string[];
}

const session = {
  customer: (): Customer | null => ({ email: "ada@example.com" }),
  admin: (): AdminUser | null => ({ email: "root@example.com", permissions: ["all"] })
};

export const appAuth = createAuth({
  guards: {
    web: (): Customer | null => session.customer(),
    admin: (): AdminUser | null => session.admin()
  },
  defaultGuard: "web"
});
`;

export const registrationWithTypeof = `/// <reference types="@dotmix/runtime/client" />
declare module "@dotmix/runtime/directives" {
  interface Register {
    auth: typeof import("./auth/appAuth").appAuth;
  }
}
export {};
`;

export const handWrittenRegistration = `import type { AuthInstanceOf } from "@dotmix/runtime/directives";
import type { Customer } from "./auth/appAuth";

declare module "@dotmix/runtime/directives" {
  interface Register {
    auth: AuthInstanceOf<{ web: Customer }, "web">;
  }
}
export {};
`;

export const typeHint =
  "Type the auth user: register it in src/env.d.ts (interface Register { auth: ... }), wrap the block in <AuthProvider value={...}>, or annotate the parameter in <Auth>{(user: User) => ...}</Auth>.";

/**
 * Writes a temporary project (tsconfig.json + src/) and returns its folder.
 * `files` maps paths relative to src/ to their contents.
 */
export function createAuthProject(files) {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-auth-typing-"));
  fs.writeFileSync(
    path.join(projectDirectory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }, null, 2)
  );
  for (const [relativePath, contents] of Object.entries(files)) {
    const absolutePath = path.join(projectDirectory, "src", relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, contents, "utf-8");
  }
  return projectDirectory;
}

export function removeProject(projectDirectory) {
  fs.rmSync(projectDirectory, { recursive: true, force: true });
}

/** Runs the same parse → analyze → typecheckTix sequence as `mix check` on one .tix file. */
export function checkTixFile(projectDirectory, relativePath) {
  const filename = path.join(projectDirectory, "src", relativePath).replace(/\\/g, "/");
  const sourceCode = fs.readFileSync(filename, "utf-8");
  const ast = parse(sourceCode, { filename });
  const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
  const typecheckResult = typecheckTix(descriptor, sourceCode, { filename, throwOnError: false });
  return [...descriptor.diagnostics, ...typecheckResult.diagnostics];
}

/** Type-checks the project's .ts files with the TypeScript compiler, as tsc would. */
export function checkTypeScriptProject(projectDirectory) {
  const rootNames = [];
  const collect = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) collect(entryPath);
      else if (entry.name.endsWith(".ts")) rootNames.push(entryPath);
    }
  };
  collect(path.join(projectDirectory, "src"));
  const program = ts.createProgram(rootNames, {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2023,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    types: [],
    paths: { "@dotmix/runtime/directives": [runtimeDirectivesDeclarations] }
  });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file && !diagnostic.file.fileName.endsWith("env.d.ts"))
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}
