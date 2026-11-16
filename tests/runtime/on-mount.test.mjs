import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Window } from "happy-dom";
import {
  createRoot,
  mount,
  onMount,
  signal
} from "@dotmix/runtime";
import { createMemoryRouter, RouterProvider, Outlet } from "@dotmix/router";
import { parse } from "@dotmix/compiler-frontend";
import { analyze, typecheckTix } from "@dotmix/compiler-semantic";
import { generate } from "@dotmix/compiler-codegen";
import { compileToSsr } from "@dotmix/compiler-ssr";
import { runtimeUrl, toLoaderFileUrl } from "../support/module-urls.mjs";

function setupDomGlobals() {
  const domWindow = new Window({ url: "http://localhost/" });
  const previousGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    SVGElement: globalThis.SVGElement,
    Text: globalThis.Text,
    Comment: globalThis.Comment,
    DocumentFragment: globalThis.DocumentFragment,
    Event: globalThis.Event
  };
  Object.assign(globalThis, {
    window: domWindow,
    document: domWindow.document,
    Node: domWindow.Node,
    Element: domWindow.Element,
    HTMLElement: domWindow.HTMLElement,
    SVGElement: domWindow.SVGElement,
    Text: domWindow.Text,
    Comment: domWindow.Comment,
    DocumentFragment: domWindow.DocumentFragment,
    Event: domWindow.Event
  });
  return {
    domWindow,
    restore() {
      domWindow.close();
      Object.assign(globalThis, previousGlobals);
    }
  };
}

function flushMicrotasks() {
  return new Promise((resolve) => globalThis.queueMicrotask(resolve));
}

async function compileComponentsToDir(filesByName) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-on-mount-"));
  for (const [moduleName, sourceCode] of Object.entries(filesByName)) {
    const filename = `${moduleName}.mix`;
    const ast = parse(sourceCode, { filename });
    const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
    assert.deepEqual(descriptor.diagnostics, []);
    const compiled = generate(descriptor, {
      filename,
      componentName: moduleName,
      runtimeImportPath: runtimeUrl
    });
    fs.writeFileSync(path.join(tempDir, `${moduleName}.mjs`), compiled.js, "utf8");
  }
  return {
    async load(entryName) {
      const mod = await import(`${toLoaderFileUrl(path.join(tempDir, `${entryName}.mjs`))}?cacheBust=${Date.now()}`);
      return mod.default;
    },
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

describe("onMount lifecycle hook", () => {
  let domEnv;

  beforeEach(() => {
    domEnv = setupDomGlobals();
  });

  afterEach(() => {
    domEnv.restore();
  });

  it("runs after mount() inserts nodes and invokes returned cleanup on unmount", async () => {
    const events = [];
    let connectedOnRender = null;
    let connectedOnMount = null;

    function SampleCard() {
      const card = domEnv.domWindow.document.createElement("div");
      card.id = "sample-card";
      connectedOnRender = card.isConnected;
      onMount(() => {
        connectedOnMount = card.isConnected;
        events.push("mounted");
        return () => {
          events.push("cleaned");
        };
      });
      return card;
    }

    const host = domEnv.domWindow.document.createElement("div");
    domEnv.domWindow.document.body.appendChild(host);
    const mounted = mount(SampleCard, host);

    assert.equal(connectedOnRender, false);
    assert.deepEqual(events, []);

    await flushMicrotasks();
    assert.equal(connectedOnMount, true);
    assert.deepEqual(events, ["mounted"]);

    mounted.unmount();
    assert.deepEqual(events, ["mounted", "cleaned"]);
  });

  it("sees isConnected === true inside a page rendered by Outlet after router.push", async () => {
    let aboutElement = null;
    let connectedOnMount = null;
    let cleanedUp = false;

    const router = createMemoryRouter({
      initialEntries: ["/"],
      routes: [
        {
          path: "/",
          element: () => domEnv.domWindow.document.createElement("span")
        },
        {
          path: "/about",
          element: () => {
            const page = domEnv.domWindow.document.createElement("section");
            page.id = "about-page";
            aboutElement = page;
            onMount(() => {
              connectedOnMount = page.isConnected;
              return () => {
                cleanedUp = true;
              };
            });
            return page;
          }
        }
      ]
    });

    const host = domEnv.domWindow.document.createElement("div");
    domEnv.domWindow.document.body.appendChild(host);
    const mounted = mount(() => RouterProvider({ router, children: () => Outlet() }), host);

    await router.push("/about");
    await flushMicrotasks();

    assert.ok(aboutElement);
    assert.equal(connectedOnMount, true);
    assert.equal(cleanedUp, false);

    await router.push("/");
    assert.equal(cleanedUp, true);
    mounted.unmount();
  });

  it("runs after an {if} branch turns true later and cleans up when hidden", async () => {
    const visible = signal(false);
    const log = [];

    const panelSource = `
export default function Panel(props) {
  let box = null;
  onMount(() => {
    props.record("mounted", Boolean(box && box.isConnected));
    return () => props.record("cleaned", true);
  });
  return <p ref={(node) => { box = node; }}>Shown</p>;
}
`;
    const parentSource = `
import Panel from "./Panel.mjs";
export default function ConditionalMountDemo(props) {
  return (
    <div>
      {if props.visible()}
        <Panel record={props.record} />
      {endif}
    </div>
  );
}
`;
    const bundle = await compileComponentsToDir({
      Panel: panelSource,
      ConditionalMountDemo: parentSource
    });
    const host = domEnv.domWindow.document.createElement("div");
    domEnv.domWindow.document.body.appendChild(host);
    try {
      const ConditionalMountDemo = await bundle.load("ConditionalMountDemo");
      const mounted = mount(ConditionalMountDemo, host, {
        visible,
        record(phase, status) {
          log.push([phase, status]);
        }
      });

      await flushMicrotasks();
      assert.deepEqual(log, []);

      visible.set(true);
      await flushMicrotasks();
      assert.deepEqual(log, [["mounted", true]]);

      visible.set(false);
      assert.deepEqual(log, [
        ["mounted", true],
        ["cleaned", true]
      ]);

      mounted.unmount();
    } finally {
      bundle.cleanup();
    }
  });

  it("runs for newly inserted {each} items with isConnected === true", async () => {
    const items = signal([{ id: "first", label: "First" }]);
    const connections = new Map();

    const rowSource = `
export default function Row(props) {
  let rowEl = null;
  onMount(() => {
    props.reportMount(props.label, Boolean(rowEl && rowEl.isConnected));
  });
  return <li ref={(node) => { rowEl = node; }}>{props.label}</li>;
}
`;
    const listSource = `
import Row from "./Row.mjs";
export default function EachMountDemo(props) {
  return (
    <ul>
      {each (item) in props.items()}
        <Row label={item.label} reportMount={props.reportMount} />
      {endeach}
    </ul>
  );
}
`;
    const bundle = await compileComponentsToDir({
      Row: rowSource,
      EachMountDemo: listSource
    });
    const host = domEnv.domWindow.document.createElement("div");
    domEnv.domWindow.document.body.appendChild(host);
    try {
      const EachMountDemo = await bundle.load("EachMountDemo");
      const mounted = mount(EachMountDemo, host, {
        items,
        reportMount(label, isConnected) {
          connections.set(label, isConnected);
        }
      });

      await flushMicrotasks();
      assert.equal(connections.get("First"), true);

      items.set([
        { id: "first", label: "First" },
        { id: "second", label: "Second" }
      ]);
      await flushMicrotasks();
      assert.equal(connections.get("Second"), true);

      mounted.unmount();
    } finally {
      bundle.cleanup();
    }
  });

  it("skips callback if the owner is disposed before the microtask runs, and matches onCleanup outside an owner", async () => {
    let calledWhenDisposed = false;
    createRoot((dispose) => {
      onMount(() => {
        calledWhenDisposed = true;
      });
      dispose();
    });

    let calledOutsideOwner = false;
    onMount(() => {
      calledOutsideOwner = true;
    });

    await flushMicrotasks();
    assert.equal(calledWhenDisposed, false);
    assert.equal(calledOutsideOwner, false);
  });

  it("typechecks in .tix without an explicit import", () => {
    const sourceCode = `
export default function AutoGlobalMount() {
  let cleanups = 0;
  onMount(() => {
    return () => {
      cleanups += 1;
    };
  });
  return <div data-count={String(cleanups)}>Ready</div>;
}
`;
    const filename = "AutoGlobalMount.tix";
    const ast = parse(sourceCode, { filename });
    const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
    const typecheckResult = typecheckTix(descriptor, sourceCode, {
      filename,
      throwOnError: false
    });
    assert.deepEqual(descriptor.diagnostics, []);
    assert.deepEqual(typecheckResult.diagnostics, []);
  });

  it("renders SSR output and never invokes the onMount callback under SSR", async () => {
    const sourceCode = `
export default function SsrMountDemo(props) {
  onMount(() => {
    props.onUnexpectedMount();
    return () => props.onUnexpectedCleanup();
  });
  return <p>Server output</p>;
}
`;
    const filename = "SsrMountDemo.mix";
    const ast = parse(sourceCode, { filename });
    const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
    const ssr = compileToSsr(descriptor, undefined, { includeHydrationMarkers: false });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-ssr-mount-"));
    const ssrPath = path.join(tempDir, "SsrMountDemo.ssr.mjs");
    fs.writeFileSync(ssrPath, ssr.code, "utf8");
    try {
      const mod = await import(`${toLoaderFileUrl(ssrPath)}?cacheBust=${Date.now()}`);
      let mountCalled = 0;
      let cleanupCalled = 0;
      const html = mod.renderToString({
        onUnexpectedMount() {
          mountCalled += 1;
        },
        onUnexpectedCleanup() {
          cleanupCalled += 1;
        }
      });
      await flushMicrotasks();
      assert.equal(html, "<p>Server output</p>");
      assert.equal(mountCalled, 0);
      assert.equal(cleanupCalled, 0);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

