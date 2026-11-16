import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Window } from "happy-dom";
import {
  BOOLEAN_ATTRIBUTES,
  mount,
  setAttribute,
  signal
} from "@dotmix/runtime";
import { parse } from "@dotmix/compiler-frontend";
import { analyze } from "@dotmix/compiler-semantic";
import { generate } from "@dotmix/compiler-codegen";
import { runtimeUrl, toLoaderFileUrl } from "../support/module-urls.mjs";

const ELEMENT_TAGS_BY_BOOLEAN_ATTR = {
  disabled: "button",
  readonly: "input",
  required: "input",
  checked: "input",
  selected: "option",
  hidden: "div",
  multiple: "select",
  autofocus: "input",
  autoplay: "video",
  controls: "video",
  loop: "video",
  muted: "video",
  novalidate: "form",
  open: "details",
  reversed: "ol"
};

const DOM_PROPERTY_BY_BOOLEAN_ATTR = {
  readonly: "readOnly",
  novalidate: "noValidate"
};

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

async function compileAndImportComponent(sourceCode, componentName) {
  const filename = `${componentName}.mix`;
  const ast = parse(sourceCode, { filename });
  const descriptor = analyze(ast, { filename, source: sourceCode, throwOnError: false });
  assert.deepEqual(descriptor.diagnostics, []);
  const compiled = generate(descriptor, {
    filename,
    componentName,
    runtimeImportPath: runtimeUrl
  });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mix-bool-attr-"));
  const modulePath = path.join(tempDir, `${componentName}.mjs`);
  fs.writeFileSync(modulePath, compiled.js, "utf8");
  const mod = await import(`${toLoaderFileUrl(modulePath)}?cacheBust=${Date.now()}`);
  return {
    component: mod.default,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

describe("boolean attributes", () => {
  let domEnv;

  beforeEach(() => {
    domEnv = setupDomGlobals();
  });

  afterEach(() => {
    domEnv.restore();
  });

  it("leaves every attribute in BOOLEAN_ATTRIBUTES present and sets its DOM property when given an empty string", () => {
    for (const attrName of BOOLEAN_ATTRIBUTES) {
      const tagName = ELEMENT_TAGS_BY_BOOLEAN_ATTR[attrName] ?? "div";
      const element = domEnv.domWindow.document.createElement(tagName);
      if (tagName === "input" && attrName === "checked") {
        element.type = "checkbox";
      }

      setAttribute(element, attrName, "");
      assert.equal(
        element.hasAttribute(attrName),
        true,
        `Expected attribute '${attrName}' to be present when set with ""`
      );

      const propName = DOM_PROPERTY_BY_BOOLEAN_ATTR[attrName] ?? attrName;
      if (propName in element) {
        assert.equal(
          Boolean(element[propName]),
          true,
          `Expected DOM property '${propName}' to be true when '${attrName}' is set with ""`
        );
      }

      setAttribute(element, attrName, false);
      assert.equal(
        element.hasAttribute(attrName),
        false,
        `Expected attribute '${attrName}' to be removed when set to false`
      );
    }
  });

  it("renders compiled valueless boolean attributes as enabled", async () => {
    const sourceCode = `
export default function StaticBooleanAttrs() {
  return (
    <section>
      <input id="cb" type="checkbox" checked />
      <button id="btn" disabled>Save</button>
      <div id="panel" hidden>Hidden panel</div>
      <details id="det" open><summary>Details</summary></details>
      <input id="ro" readonly />
    </section>
  );
}
`;
    const loaded = await compileAndImportComponent(sourceCode, "StaticBooleanAttrs");
    const host = domEnv.domWindow.document.createElement("div");
    domEnv.domWindow.document.body.appendChild(host);
    try {
      const mounted = mount(loaded.component, host);
      const checkbox = host.querySelector("#cb");
      const button = host.querySelector("#btn");
      const hiddenPanel = host.querySelector("#panel");
      const details = host.querySelector("#det");
      const readonlyInput = host.querySelector("#ro");

      assert.equal(checkbox.hasAttribute("checked"), true);
      assert.equal(checkbox.checked, true);
      assert.equal(button.hasAttribute("disabled"), true);
      assert.equal(button.disabled, true);
      assert.equal(hiddenPanel.hasAttribute("hidden"), true);
      assert.equal(hiddenPanel.hidden, true);
      assert.equal(details.hasAttribute("open"), true);
      assert.equal(details.open, true);
      assert.equal(readonlyInput.hasAttribute("readonly"), true);
      assert.equal(readonlyInput.readOnly, true);

      mounted.unmount();
    } finally {
      loaded.cleanup();
    }
  });

  it("handles checked={false} and reactive checked={flag()} toggles across true -> false -> true", async () => {
    const sourceCode = `
export default function DynamicBooleanAttrs(props) {
  return (
    <div>
      <input id="always-off" type="checkbox" checked={false} />
      <input id="reactive-cb" type="checkbox" checked={props.flag()} />
    </div>
  );
}
`;
    const flag = signal(true);
    const loaded = await compileAndImportComponent(sourceCode, "DynamicBooleanAttrs");
    const host = domEnv.domWindow.document.createElement("div");
    domEnv.domWindow.document.body.appendChild(host);
    try {
      const mounted = mount(loaded.component, host, { flag });
      const alwaysOff = host.querySelector("#always-off");
      const reactiveCheckbox = host.querySelector("#reactive-cb");

      assert.equal(alwaysOff.hasAttribute("checked"), false);
      assert.equal(alwaysOff.checked, false);
      assert.equal(reactiveCheckbox.hasAttribute("checked"), true);
      assert.equal(reactiveCheckbox.checked, true);

      flag.set(false);
      assert.equal(reactiveCheckbox.hasAttribute("checked"), false);
      assert.equal(reactiveCheckbox.checked, false);

      flag.set(true);
      assert.equal(reactiveCheckbox.hasAttribute("checked"), true);
      assert.equal(reactiveCheckbox.checked, true);

      mounted.unmount();
    } finally {
      loaded.cleanup();
    }
  });

  it("matches :checked selector for the first radio input with static checked attribute", async () => {
    const sourceCode = `
export default function RadioGroupDemo() {
  return (
    <div class="group">
      <input id="opt-first" type="radio" name="sampler" checked />
      <input id="opt-second" type="radio" name="sampler" />
    </div>
  );
}
`;
    const loaded = await compileAndImportComponent(sourceCode, "RadioGroupDemo");
    const host = domEnv.domWindow.document.createElement("div");
    domEnv.domWindow.document.body.appendChild(host);
    try {
      const mounted = mount(loaded.component, host);
      const checkedRadio = host.querySelector('input[type="radio"]:checked');
      assert.ok(checkedRadio, "Expected a radio input to match :checked");
      assert.equal(checkedRadio.id, "opt-first");
      mounted.unmount();
    } finally {
      loaded.cleanup();
    }
  });
});

