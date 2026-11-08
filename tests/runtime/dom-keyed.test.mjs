import test from "node:test";
import assert from "node:assert/strict";
import {
  setSafeStyleProperty,
  insertTrustedHtml,
  isSameKey,
  renderKeyedList
} from "../../packages/runtime/dist/dom/index.js";
import { createTrustedHtml } from "../../packages/runtime/dist/security/index.js";
import { MixError } from "../../packages/runtime/dist/core/index.js";
import { activeConfig } from "../../packages/runtime/dist/core/config.js";

// Mock DOM Node & Element for headless environment
class MockNode {
  constructor(nodeType = 1, nodeName = "DIV") {
    this.nodeType = nodeType;
    this.nodeName = nodeName;
    this.parentNode = null;
    this.children = [];
    this.namespaceURI = "http://www.w3.org/1999/xhtml";
    this.style = {
      _styles: {},
      setProperty(prop, val) {
        this._styles[prop] = val;
      },
      removeProperty(prop) {
        delete this._styles[prop];
      }
    };
    this.innerHTML = "";
  }

  get tagName() {
    return this.nodeName;
  }

  get firstChild() {
    return this.children[0] || null;
  }

  contains(child) {
    return this.children.includes(child);
  }

  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  insertBefore(newChild, refChild) {
    if (!refChild) return this.appendChild(newChild);
    if (newChild.parentNode) newChild.parentNode.removeChild(newChild);
    const idx = this.children.indexOf(refChild);
    if (idx === -1) return this.appendChild(newChild);
    newChild.parentNode = this;
    this.children.splice(idx, 0, newChild);
    return newChild;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }
}

test("Phase 6 — DOM Runtime & Keyed List Reconciliation (§6.3, §6.4, §7 / T-HTML-04, T-KEY-*)", async (t) => {

  await t.test("R-CSS-01: Style properties applied individually via setProperty", () => {
    const el = new MockNode(1, "DIV");
    setSafeStyleProperty(el, "color", "red");
    setSafeStyleProperty(el, "--custom-theme", "dark");
    assert.equal(el.style._styles["color"], "red");
    assert.equal(el.style._styles["--custom-theme"], "dark");

    // Invalid property name throws MIX_SEC_INVALID_STYLE_PROPERTY
    assert.throws(
      () => setSafeStyleProperty(el, "color:red;", "blue"),
      (err) => err instanceof MixError && err.code === "MIX_SEC_INVALID_STYLE_PROPERTY"
    );

    // Insecure property value throws MIX_SEC_INSECURE_DYNAMIC_STYLE
    assert.throws(
      () => setSafeStyleProperty(el, "background", "url(javascript:alert(1))"),
      (err) => err instanceof MixError && err.code === "MIX_SEC_INSECURE_DYNAMIC_STYLE"
    );
  });

  await t.test("T-HTML-04: Trusted HTML insertion context validation", () => {
    const safeHtml = createTrustedHtml("<b>Hello</b>", (s) => s);

    // Allowed HTML element succeeds
    const div = new MockNode(1, "DIV");
    insertTrustedHtml(div, safeHtml);
    assert.equal(div.innerHTML, "<b>Hello</b>");

    // Non-HTML namespace throws MIX_SEC_HTML_CONTEXT
    const svgEl = new MockNode(1, "SVG");
    svgEl.namespaceURI = "http://www.w3.org/2000/svg";
    assert.throws(
      () => insertTrustedHtml(svgEl, safeHtml),
      (err) => err instanceof MixError && err.code === "MIX_SEC_HTML_CONTEXT"
    );

    // Forbidden HTML elements throw MIX_SEC_HTML_CONTEXT
    const scriptEl = new MockNode(1, "SCRIPT");
    assert.throws(
      () => insertTrustedHtml(scriptEl, safeHtml),
      (err) => err instanceof MixError && err.code === "MIX_SEC_HTML_CONTEXT"
    );

    const styleEl = new MockNode(1, "STYLE");
    assert.throws(
      () => insertTrustedHtml(styleEl, safeHtml),
      (err) => err instanceof MixError && err.code === "MIX_SEC_HTML_CONTEXT"
    );

    const iframeEl = new MockNode(1, "IFRAME");
    assert.throws(
      () => insertTrustedHtml(iframeEl, safeHtml),
      (err) => err instanceof MixError && err.code === "MIX_SEC_HTML_CONTEXT"
    );
  });

  await t.test("T-KEY-01: Key comparison via SameValueZero", () => {
    assert.ok(isSameKey(NaN, NaN));
    assert.ok(isSameKey(+0, -0));
    assert.ok(isSameKey("abc", "abc"));
    assert.ok(!isSameKey(1, 2));
    assert.ok(!isSameKey("1", 1));
  });

  await t.test("T-KEY-02: __DEV__ duplicate key throws MIX_RT_DUPLICATE_KEY with details", () => {
    globalThis.__DEV__ = true;
    const parent = new MockNode(1, "UL");
    const items = [
      { id: "a", text: "First" },
      { id: "b", text: "Second" },
      { id: "a", text: "Duplicate" }
    ];

    assert.throws(
      () => {
        renderKeyedList(
          parent,
          null,
          items,
          (item) => item.id,
          (itemSig) => {
            const li = new MockNode(1, "LI");
            li.text = itemSig.value.text;
            return li;
          }
        );
      },
      (err) => {
        assert.ok(err instanceof MixError);
        assert.equal(err.code, "MIX_RT_DUPLICATE_KEY");
        assert.equal(err.details.key, "a");
        assert.equal(err.details.firstIndex, 0);
        assert.equal(err.details.duplicateIndex, 2);
        return true;
      }
    );
  });

  await t.test("T-KEY-03: Production duplicate key preserves all items and warns", () => {
    globalThis.__DEV__ = false;
    const warnings = [];
    const prevWarn = activeConfig.onWarning;
    activeConfig.onWarning = (w) => warnings.push(w);

    try {
      const parent = new MockNode(1, "UL");
      const items = [
        { id: "x", text: "First X" },
        { id: "y", text: "Y" },
        { id: "x", text: "Second X" }
      ];

      const entries = renderKeyedList(
        parent,
        null,
        items,
        (item) => item.id,
        (itemSig) => {
          const li = new MockNode(1, "LI");
          li.text = itemSig.value.text;
          return li;
        }
      );

      // In production: MUST NOT delete any item! All 3 items rendered
      assert.equal(entries.length, 3);
      assert.equal(parent.children.length, 3);
      assert.equal(parent.children[0].text, "First X");
      assert.equal(parent.children[1].text, "Y");
      assert.equal(parent.children[2].text, "Second X");

      // Warning emitted
      assert.equal(warnings.length, 1);
      assert.equal(warnings[0].code, "MIX_RT_DUPLICATE_KEY");
      assert.equal(warnings[0].details.duplicateIndex, 2);
    } finally {
      activeConfig.onWarning = prevWarn;
      globalThis.__DEV__ = true;
    }
  });

  await t.test("Keyed LIS Reconciliation: reorder, insertion, deletion, and signal update", () => {
    globalThis.__DEV__ = true;
    const parent = new MockNode(1, "UL");

    // 1. Initial list: [A, B, C, D]
    let items = [
      { id: "A", val: 1 },
      { id: "B", val: 2 },
      { id: "C", val: 3 },
      { id: "D", val: 4 }
    ];

    let entries = renderKeyedList(
      parent,
      null,
      items,
      (it) => it.id,
      (sig) => {
        const li = new MockNode(1, "LI");
        li.id = sig.value.id;
        li.val = sig.value.val;
        return li;
      }
    );

    assert.equal(parent.children.map((c) => c.id).join(","), "A,B,C,D");
    const nodeA = parent.children[0];
    const nodeB = parent.children[1];
    const nodeC = parent.children[2];
    const nodeD = parent.children[3];

    // 2. Reorder with updates & insertions: [B(updated), D, A, E(new)] (C deleted)
    items = [
      { id: "B", val: 20 },
      { id: "D", val: 4 },
      { id: "A", val: 1 },
      { id: "E", val: 5 }
    ];

    entries = renderKeyedList(
      parent,
      null,
      items,
      (it) => it.id,
      (sig) => {
        const li = new MockNode(1, "LI");
        li.id = sig.value.id;
        li.val = sig.value.val;
        return li;
      }
    );

    // Verify DOM order
    assert.equal(parent.children.map((c) => c.id).join(","), "B,D,A,E");
    // Verify nodes preserved by identity
    assert.equal(parent.children[0], nodeB);
    assert.equal(parent.children[1], nodeD);
    assert.equal(parent.children[2], nodeA);
    // Node C was cleanly removed
    assert.ok(!parent.children.includes(nodeC));
    // Signal of B was updated in place
    assert.equal(entries[0].itemSignal.value.val, 20);
  });
});
