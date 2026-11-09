/**
 * Gate 17 (D-120): Universal Polyglot Component ABI Integration Suite
 *
 * Verifies:
 * 1. TC39 Signals Standard interoperability bridge (`toTc39Signal`, `fromTc39Signal`, `isSignal`)
 * 2. React 19 / Next.js adapter bridge (`asReactComponent`, `mountMixInContainer`)
 * 3. Vue 3.5 adapter bridge (`asVueComponent`)
 * 4. Angular 18+ signal adapter bridge (`asAngularComponent`)
 * 5. Light-DOM Custom Elements (`defineMixCustomElement`) with complex prop reflection
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { signal, createEffect } from "../../packages/runtime/dist/index.js";
import {
  toTc39Signal,
  fromTc39Signal,
  toSignalRef,
  isSignal,
  mountMixInContainer,
  asReactComponent,
  asVueComponent,
  asAngularComponent,
  defineMixCustomElement
} from "../../packages/interop/dist/index.js";

describe("Gate 17: Universal Polyglot Component ABI (@mix/interop)", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.window = win;
    globalThis.document = document;
    globalThis.customElements = win.customElements;
    globalThis.HTMLElement = win.HTMLElement;
  });

  test("1. TC39 Signals Proposal Bridge (toTc39Signal & fromTc39Signal)", () => {
    const mixSig = signal(42);
    assert.ok(isSignal(mixSig));

    const tc39 = toTc39Signal(mixSig);
    assert.strictEqual(tc39.get(), 42);

    let notificationCount = 0;
    const unsub = tc39.subscribe(() => {
      notificationCount++;
    });

    tc39.set(100);
    assert.strictEqual(mixSig(), 100);
    assert.strictEqual(tc39.get(), 100);
    assert.strictEqual(notificationCount, 1);

    unsub();
    tc39.set(200);
    assert.strictEqual(notificationCount, 1); // Unsubscribed

    // Reverse bridge: external signal to Mix signal
    const externalStore = {
      value: "hello",
      set(v) { this.value = v; }
    };
    const bridged = fromTc39Signal(externalStore);
    assert.strictEqual(bridged(), "hello");
    bridged.set("world");
    assert.strictEqual(externalStore.value, "world");
    assert.strictEqual(bridged(), "world");
  });

  test("2. toSignalRef provides standard Vue 3.5 / Svelte store ref interface", () => {
    const s = signal("initial");
    const ref = toSignalRef(s);
    assert.strictEqual(ref.value, "initial");
    assert.strictEqual(ref.peek(), "initial");

    let observed = "";
    ref.subscribe((v) => {
      observed = v;
    });

    ref.value = "updated";
    assert.strictEqual(s(), "updated");
    assert.strictEqual(observed, "updated");
  });

  test("3. React 19 Adapter Bridge mounts surgical DOM with 0 VDOM diffing overhead", () => {
    const MockMixComponent = (props) => {
      const el = document.createElement("div");
      el.className = "mix-react-child";
      createEffect(() => {
        el.textContent = `User: ${props.name} · Role: ${props.role}`;
      });
      return el;
    };

    const container = document.createElement("div");
    document.body.appendChild(container);

    const bridge = mountMixInContainer(container, MockMixComponent, {
      name: "Alice",
      role: "Architect"
    });

    const rendered = container.querySelector(".mix-react-child");
    assert.ok(rendered);
    assert.strictEqual(rendered.textContent, "User: Alice · Role: Architect");

    // React prop update simulation
    bridge.update({ name: "Alice", role: "Principal Fellow" });
    assert.strictEqual(rendered.textContent, "User: Alice · Role: Principal Fellow");

    bridge.unmount();
    assert.strictEqual(container.innerHTML, "");
  });

  test("4. asReactComponent creates standard wrapper component", () => {
    const MockMixComponent = (props) => {
      const p = document.createElement("p");
      p.textContent = `Count: ${props.count}`;
      return p;
    };

    const ReactWrapped = asReactComponent(MockMixComponent, {
      asContainer: "section",
      className: "react-host"
    });

    const hostNode = ReactWrapped({ count: 10 });
    assert.ok(hostNode);
    assert.strictEqual(hostNode.tagName.toLowerCase(), "section");
    assert.ok(hostNode.querySelector("p"));
    assert.strictEqual(hostNode.querySelector("p").textContent, "Count: 10");
  });

  test("5. Vue 3.5 and Angular 18+ Component Bridges", () => {
    const MockComp = (props) => {
      const span = document.createElement("span");
      createEffect(() => {
        span.textContent = `Metric: ${props.value}`;
      });
      return span;
    };

    // Vue adapter
    const vueDef = asVueComponent(MockComp);
    assert.strictEqual(vueDef.name, "MixVueBridge");
    const vueEl = document.createElement("div");
    const vueInstance = { $el: vueEl, $props: { value: 99 } };
    vueDef.mounted.call(vueInstance);
    assert.strictEqual(vueEl.querySelector("span").textContent, "Metric: 99");

    vueInstance.$props.value = 100;
    vueDef.updated.call(vueInstance);
    assert.strictEqual(vueEl.querySelector("span").textContent, "Metric: 100");

    vueDef.unmounted.call(vueInstance);
    assert.strictEqual(vueEl.innerHTML, "");

    // Angular adapter
    const AngularClass = asAngularComponent(MockComp);
    const ngEl = document.createElement("div");
    const ngInstance = new AngularClass({ nativeElement: ngEl });
    ngInstance.props = { value: 50 };
    ngInstance.ngOnInit();
    assert.strictEqual(ngEl.querySelector("span").textContent, "Metric: 50");

    ngInstance.ngOnChanges({ value: { currentValue: 75 } });
    assert.strictEqual(ngEl.querySelector("span").textContent, "Metric: 75");

    ngInstance.ngOnDestroy();
    assert.strictEqual(ngEl.innerHTML, "");
  });

  test("6. Light-DOM Custom Elements with Complex Prop Reflection and Zero Shadow Barriers", () => {
    const TagName = "mix-polyglot-card";
    const MockComp = (props) => {
      const art = document.createElement("article");
      art.className = "polyglot-card";
      const h3 = document.createElement("h3");
      const span = document.createElement("span");
      span.className = "count";
      art.appendChild(h3);
      art.appendChild(span);
      createEffect(() => {
        h3.textContent = props.title || "Untitled";
        span.textContent = String(props.items?.length ?? 0);
      });
      return art;
    };

    defineMixCustomElement(TagName, MockComp, {
      observedProps: ["title", "items"],
      shadow: false // Light DOM!
    });

    const el = document.createElement(TagName);
    document.body.appendChild(el);

    // Initial state
    assert.ok(el.querySelector(".polyglot-card"));
    assert.strictEqual(el.querySelector("h3").textContent, "Untitled");

    // Complex Object Reflection (Not limited to string attributes!)
    el.title = "Distributed Systems";
    el.items = [{ id: 1 }, { id: 2 }, { id: 3 }];

    assert.strictEqual(el.querySelector("h3").textContent, "Distributed Systems");
    assert.strictEqual(el.querySelector(".count").textContent, "3");

    // Disconnect cleanup
    el.remove();
  });
});
