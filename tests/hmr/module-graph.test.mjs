import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ModuleGraph } from "../../node_modules/@dotmix/cli/dist/module-graph.js";

describe("Gate 36 (T-36.3): Module Graph & Propagation Traversal (H-5, D-152)", () => {
  const rootDir = "G:/xampp-httpdocs/mix-framework/app";

  it("1. Diamond dependency propagates to common boundary without duplicates", () => {
    const graph = new ModuleGraph(rootDir);
    // App.mix -> B.js -> D.js
    // App.mix -> C.js -> D.js
    graph.addEdge("/src/App.mix", "/src/B.js");
    graph.addEdge("/src/App.mix", "/src/C.js");
    graph.addEdge("/src/B.js", "/src/D.js");
    graph.addEdge("/src/C.js", "/src/D.js");

    const result = graph.computePropagation("/src/D.js");
    assert.strictEqual(result.type, "update");
    assert.deepStrictEqual(result.boundaries, ["/src/App.mix"]);
  });

  it("2. Cyclic dependency terminates safely and reaches absorbing boundary", () => {
    const graph = new ModuleGraph(rootDir);
    // Component.mix -> A.js <-> B.js
    graph.addEdge("/src/Component.mix", "/src/A.js");
    graph.addEdge("/src/A.js", "/src/B.js");
    graph.addEdge("/src/B.js", "/src/A.js");

    const result = graph.computePropagation("/src/B.js");
    assert.strictEqual(result.type, "update");
    assert.deepStrictEqual(result.boundaries, ["/src/Component.mix"]);
  });

  it("3. Entry-only dependency triggers full reload when reaching entry without boundary", () => {
    const graph = new ModuleGraph(rootDir);
    // main.mix -> entry-helper.js
    graph.addEdge("/src/main.mix", "/src/entry-helper.js");

    const result = graph.computePropagation("/src/entry-helper.js");
    assert.strictEqual(result.type, "full-reload");
    assert.strictEqual(result.boundaries.length, 0);
  });

  it("4. Deleted import unlinks dependency graph cleanly", () => {
    const graph = new ModuleGraph(rootDir);
    graph.addEdge("/src/Widget.mix", "/src/extra.js");
    assert.strictEqual(graph.getNode("/src/extra.js")?.importers.has("/src/Widget.mix"), true);

    graph.removeNode("/src/extra.js");
    assert.strictEqual(graph.getNode("/src/extra.js"), undefined);
    assert.strictEqual(graph.getNode("/src/Widget.mix")?.importedModules.has("/src/extra.js"), false);
  });

  it("5. Monotonic version increment tracks per-module versions", () => {
    const graph = new ModuleGraph(rootDir);
    assert.strictEqual(graph.incrementVersion("/src/helper.js"), 1);
    assert.strictEqual(graph.incrementVersion("/src/helper.js"), 2);
    assert.strictEqual(graph.getNode("/src/helper.js")?.version, 2);
  });
});
