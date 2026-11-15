import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  buildProject,
  createBuildProject,
  findHashedModule,
  removeProject
} from "./build-project.mjs";

const commentLikeString = "/* not a comment */ and // neither";
const slashLinesTemplate = `
// a line that starts with slashes
    four spaces before this line
  // two spaces, then slashes
`;
const importLineTemplate = `
import x from "y";
`;

const literalModule = `// A real comment that the build removes.
export const sample = "/* not a comment */ and // neither";
export const slashLines = \`
// a line that starts with slashes
    four spaces before this line
  // two spaces, then slashes
\`;
export const importLine = \`
import x from "y";
\`;
/* a block comment */
export const closingPattern = /end\\*\\//;
`;

test("strings and template literals that look like comments reach the built module unchanged", async () => {
  const projectDirectory = createBuildProject({ "main.js": literalModule });
  try {
    buildProject(projectDirectory);
    const builtModulePath = findHashedModule(`${projectDirectory}/dist`, "main.js");
    const builtModule = await import(pathToFileURL(builtModulePath).href);
    assert.equal(builtModule.sample, commentLikeString);
    assert.equal(builtModule.slashLines, slashLinesTemplate);
    assert.equal(builtModule.closingPattern.source, "end\\*\\/");
  } finally {
    removeProject(projectDirectory);
  }
});

test("a template literal line that reads like an import declaration stays in the built output", async () => {
  const projectDirectory = createBuildProject({ "main.js": literalModule });
  try {
    buildProject(projectDirectory);
    const builtModulePath = findHashedModule(`${projectDirectory}/dist`, "main.js");
    const builtModule = await import(pathToFileURL(builtModulePath).href);
    assert.equal(builtModule.importLine, importLineTemplate);
  } finally {
    removeProject(projectDirectory);
  }
});
