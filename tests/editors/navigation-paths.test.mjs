import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolveDefinition } from "../../packages/language-server/dist/index.js";

const LAYOUT_SOURCE = [
  'import "./PageLayout.css";',
  'import NavSection from "../components/NavSection.tix";',
  'import { buildNavigation } from "./navigation.js";',
  "",
  "export default function PageLayout() {",
  "  const groups = buildNavigation();",
  "  return <nav><NavSection groups={groups} /></nav>;",
  "}",
  "",
].join("\n");

function createProject() {
  const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mix-navigation-"));
  fs.mkdirSync(path.join(projectDirectory, "layouts"));
  fs.mkdirSync(path.join(projectDirectory, "components"));
  fs.writeFileSync(path.join(projectDirectory, "layouts", "PageLayout.tix"), LAYOUT_SOURCE);
  fs.writeFileSync(path.join(projectDirectory, "layouts", "PageLayout.css"), "nav { display: flex; }\n");
  fs.writeFileSync(path.join(projectDirectory, "layouts", "navigation.ts"), "export function buildNavigation() { return []; }\n");
  fs.writeFileSync(path.join(projectDirectory, "components", "NavSection.tix"), "export default function NavSection() { return <ul />; }\n");
  return projectDirectory;
}

/** Position of the first character after `needle` on the line that contains it. */
function positionInside(needle, extraCharacters = 2) {
  const lines = LAYOUT_SOURCE.split("\n");
  const line = lines.findIndex((lineText) => lineText.includes(needle));
  return { line, character: lines[line].indexOf(needle) + extraCharacters };
}

function definedFileName(location) {
  return location ? path.basename(fileURLToPath(location.uri)) : null;
}

describe("Language server: Ctrl+click on paths and names in .tix files", () => {
  const projectDirectory = createProject();
  const layoutUri = pathToFileURL(path.join(projectDirectory, "layouts", "PageLayout.tix")).href;

  it("opens a component from its import path", () => {
    const location = resolveDefinition(layoutUri, LAYOUT_SOURCE, positionInside('"../components/NavSection.tix"', 18));
    assert.equal(definedFileName(location), "NavSection.tix");
  });

  it("opens the stylesheet of a side-effect import", () => {
    const location = resolveDefinition(layoutUri, LAYOUT_SOURCE, positionInside('"./PageLayout.css"', 4));
    assert.equal(definedFileName(location), "PageLayout.css");
  });

  it("opens the .ts source of an import written with .js", () => {
    const location = resolveDefinition(layoutUri, LAYOUT_SOURCE, positionInside('"./navigation.js"', 4));
    assert.equal(definedFileName(location), "navigation.ts");
  });

  it("opens a component from its tag name", () => {
    const location = resolveDefinition(layoutUri, LAYOUT_SOURCE, positionInside("<NavSection", 3));
    assert.equal(definedFileName(location), "NavSection.tix");
  });

  it("returns nothing for a string that is not a path", () => {
    const source = 'const label = "Navigation";\n';
    const location = resolveDefinition(layoutUri, source, { line: 0, character: 18 });
    assert.equal(location, null);
  });
});
