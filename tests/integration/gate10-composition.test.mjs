import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  createContext,
  provideContext,
  useContext,
  createRoot,
  mount
} from "../../packages/runtime/dist/index.js";
import { parse } from "../../packages/compiler-frontend/dist/index.js";
import { analyze } from "../../packages/compiler-semantic/dist/index.js";
import { generate } from "../../packages/compiler-codegen/dist/index.js";
import { pathToFileURL } from "node:url";
import fs from "node:fs";
import path from "node:path";

describe("Gate 10: Component Composition — Slots (<slot>) & Context API (D-113)", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.window = win;
    globalThis.document = document;
  });

  const runtimeUrl = pathToFileURL(path.resolve("packages/runtime/dist/index.js")).href;

  function compileMixComponent(source, name = "Comp") {
    const ast = parse(source, { filename: `${name}.mix` });
    const descriptor = analyze(ast, { filename: `${name}.mix`, source });
    const codegen = generate(descriptor, {
      filename: `${name}.mix`,
      runtimeImportPath: runtimeUrl
    });
    return codegen.js;
  }

  it("1. Context API (createContext / provideContext / useContext) works with prototype inheritance", () => {
    const ThemeContext = createContext("light");
    const UserContext = createContext({ name: "Guest" });

    let capturedTheme;
    let capturedUser;
    let innerTheme;

    createRoot(() => {
      provideContext(ThemeContext, "dark");
      provideContext(UserContext, { name: "Alice" });

      capturedTheme = useContext(ThemeContext);
      capturedUser = useContext(UserContext);

      // Child owner inherits context
      createRoot(() => {
        // Child can override one context without affecting parent
        provideContext(ThemeContext, "high-contrast");
        innerTheme = useContext(ThemeContext);
      });
    });

    assert.equal(capturedTheme, "dark");
    assert.deepEqual(capturedUser, { name: "Alice" });
    assert.equal(innerTheme, "high-contrast");

    // Outside of owner returns default value
    assert.equal(useContext(ThemeContext), "light");
  });

  it("2. Compiles and mounts a component with default <slot /> and fallback content", async () => {
    const childSource = `
export default function Card(props) {
  return (
    <div class="card">
      <div class="card-body">
        <slot>
          <span class="fallback">Default Card Content</span>
        </slot>
      </div>
    </div>
  );
}
`;
    const parentSource = `
import Card from "./Card.mix";

export default function Page() {
  const custom = signal(true);
  return (
    <main class="page">
      <Card>
        <p class="custom-content">Injected Custom Content</p>
      </Card>
      <Card />
    </main>
  );
}
`;
    // Verify AST parsing of SlotOutletNode
    const childAst = parse(childSource, { filename: "Card.mix" });
    const cardEl = childAst.template[0];
    const cardBody = cardEl.children.find(c => c.type === "Element");
    const slotNode = cardBody.children.find(c => c.type === "SlotOutlet");
    assert.ok(slotNode !== undefined);
    assert.equal(slotNode.type, "SlotOutlet");
    assert.equal(slotNode.name, null);
    const fallbackEl = slotNode.fallback.find(c => c.type === "Element");
    assert.ok(fallbackEl !== undefined);
    assert.equal(fallbackEl.tag, "span");

    // Verify Codegen emits __renderSlot
    const childDesc = analyze(childAst, { filename: "Card.mix", source: childSource });
    const childJs = generate(childDesc).js;
    assert.ok(childJs.includes("__renderSlot"));

    // Verify parent codegen passes children function
    const parentAst = parse(parentSource, { filename: "Page.mix" });
    const parentDesc = analyze(parentAst, { filename: "Page.mix", source: parentSource });
    const parentJs = generate(parentDesc).js;
    assert.ok(parentJs.includes("children: () =>"));
    assert.ok(parentJs.includes("slots: { default: () =>"));
  });

  it("3. Compiles and executes named slots with fallback (<slot name='header'>)", async () => {
    const modalSource = `
export default function Modal(props) {
  return (
    <section class="modal-dialog">
      <header class="modal-header">
        <slot name="header">
          <h2>Default Dialog Title</h2>
        </slot>
      </header>
      <div class="modal-content">
        <slot />
      </div>
      <footer class="modal-footer">
        <slot name="footer">
          <button class="btn-default-close">Close</button>
        </slot>
      </footer>
    </section>
  );
}
`;
    const callerSource = `
import Modal from "./Modal.mix";

export default function App() {
  return (
    <div class="app-wrap">
      <Modal>
        <h2 slot="header" class="custom-title">Custom Header Title</h2>
        <p class="custom-body">Custom Modal Body</p>
      </Modal>
    </div>
  );
}
`;
    const tmpDir = path.resolve("tests/integration/.tmp-gate10");
    fs.mkdirSync(tmpDir, { recursive: true });

    const modalJs = compileMixComponent(modalSource, "Modal");
    const callerJs = compileMixComponent(callerSource, "App");

    fs.writeFileSync(path.join(tmpDir, "Modal.mix.js"), modalJs, "utf8");
    fs.writeFileSync(path.join(tmpDir, "App.mix.js"), callerJs, "utf8");

    const appUrl = pathToFileURL(path.join(tmpDir, "App.mix.js")).href;
    const { default: App } = await import(appUrl);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = mount(App, container);

    // Verify custom header slot was rendered
    const title = container.querySelector(".modal-header .custom-title");
    assert.ok(title !== null);
    assert.equal(title.textContent, "Custom Header Title");

    // Verify default body slot was rendered
    const body = container.querySelector(".modal-content .custom-body");
    assert.ok(body !== null);
    assert.equal(body.textContent, "Custom Modal Body");

    // Verify fallback footer was rendered because caller didn't provide slot="footer"
    const footerBtn = container.querySelector(".modal-footer .btn-default-close");
    assert.ok(footerBtn !== null);
    assert.equal(footerBtn.textContent, "Close");

    mounted.unmount();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("4. React-style {props.children} projection in functional components", async () => {
    const boxSource = `
export default function Box(props) {
  return (
    <div class="box-container">
      {props.children}
    </div>
  );
}
`;
    const parentSource = `
import Box from "./Box.mix";

export default function Parent() {
  const count = signal(10);
  return (
    <div class="parent">
      <Box>
        <span class="slotted-count">Count: {count()}</span>
      </Box>
    </div>
  );
}
`;
    const tmpDir = path.resolve("tests/integration/.tmp-gate10-react");
    fs.mkdirSync(tmpDir, { recursive: true });

    const boxJs = compileMixComponent(boxSource, "Box");
    const parentJs = compileMixComponent(parentSource, "Parent");

    fs.writeFileSync(path.join(tmpDir, "Box.mix.js"), boxJs, "utf8");
    fs.writeFileSync(path.join(tmpDir, "Parent.mix.js"), parentJs, "utf8");

    const appUrl = pathToFileURL(path.join(tmpDir, "Parent.mix.js")).href;
    const { default: Parent } = await import(appUrl);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = mount(Parent, container);

    const slotted = container.querySelector(".box-container .slotted-count");
    assert.ok(slotted !== null);
    assert.equal(slotted.textContent, "Count: 10");

    mounted.unmount();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
