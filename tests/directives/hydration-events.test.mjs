import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  AuthProvider, CanAny, Cannot, DiagnosticCodes, MixError, PermissionProvider,
  __mixAuth, __mixAwaitWithTimeout, __mixBindBooleanAttr, __mixBindClassMap,
  __mixBindConditionalAttr, __mixBindFieldError, __mixBindFormErrors, __mixBindMatchAttr,
  __mixBindStyleMap, __mixCreateHeadCollector, __mixCreateStackCollector, __mixCsrfInput,
  __mixEachPipeline, __mixEachWithEmpty, __mixEscapeJson, __mixFieldError, __mixFieldValid,
  __mixForRange, __mixGuest, __mixHead, __mixIsEmpty, __mixIsSet, __mixJson, __mixJsonScript,
  __mixLazy, __mixMemo, __mixMethodInput, __mixOnConditionalEvent, __mixOnEvent, __mixOnce,
  __mixPrependStack, __mixProvideRequestContext, __mixPushStack, __mixRenderStack,
  __mixSession, __mixShow, __mixSwitch, createAuth, createElement, createForm, defineAbility,
  hydrate, mount, signal, validators
} from "../../node_modules/@dotmix/runtime/dist/index.js";
import { If, For, Switch, Each } from "../../node_modules/@dotmix/runtime/dist/directives/index.js";

function installDomGlobals() {
  const win = new Window({ url: "http://localhost:3000/" });
  const prev = {
    window: globalThis.window,
    document: globalThis.document,
    Node: globalThis.Node,
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement
  };
  Object.assign(globalThis, {
    window: win, document: win.document, Node: win.Node, Element: win.Element, HTMLElement: win.HTMLElement
  });
  return {
    win,
    restore() {
      win.close();
      Object.assign(globalThis, prev);
    }
  };
}

function withDom(runInDom) {
  const env = installDomGlobals();
  try { return runInDom(env.win.document, env.win); } finally { env.restore(); }
}
async function withDomAsync(runInDom) {
  const env = installDomGlobals();
  try { return await runInDom(env.win.document, env.win); } finally { env.restore(); }
}
function createListenerSpy(target) {
  const records = [];
  const active = new Set();
  const origAdd = target.addEventListener.bind(target);
  const origRemove = target.removeEventListener.bind(target);
  target.addEventListener = (type, listener, options) => { records.push({ action: "add", type, listener, options }); active.add(listener); return origAdd(type, listener, options); };
  target.removeEventListener = (type, listener, options) => { records.push({ action: "remove", type, listener, options }); active.delete(listener); return origRemove(type, listener, options); };
  return { records, active };
}

describe("Directive runtime helpers and conditional events", () => {
  test("conditional events: never attaches listener before first evaluation when condition starts false", () => {
    withDom((document) => {
      const container = document.createElement("div");
      const button = document.createElement("button");
      const spy = createListenerSpy(button);
      const editable = signal(false);
      let clicks = 0;
      const mounted = mount(() => {
        __mixOnConditionalEvent(button, "click", editable, () => { clicks++; });
        return button;
      }, container);
      assert.strictEqual(spy.records.length, 0);
      assert.strictEqual(spy.active.size, 0);
      button.click();
      assert.strictEqual(clicks, 0);
      mounted.unmount();
      assert.strictEqual(spy.records.length, 0);
    });
  });

  test("conditional events: attaches, detaches, and re-attaches on reactive condition toggle", () => {
    withDom((document) => {
      const container = document.createElement("div");
      const button = document.createElement("button");
      const spy = createListenerSpy(button);
      const editable = signal(false);
      let clicks = 0;
      const mounted = mount(() => {
        __mixOnConditionalEvent(button, "click", editable, () => { clicks++; });
        return button;
      }, container);
      assert.strictEqual(spy.active.size, 0);
      editable.set(true);
      assert.strictEqual(spy.active.size, 1);
      button.click();
      editable.set(false);
      assert.strictEqual(spy.active.size, 0);
      button.click();
      editable.set(true);
      assert.strictEqual(spy.active.size, 1);
      button.click();
      assert.strictEqual(clicks, 2);
      mounted.unmount();
      assert.strictEqual(spy.active.size, 0);
    });
  });

  test("conditional events: performs atomic :else swap without duplicate or stale handlers", () => {
    withDom((document) => {
      const container = document.createElement("div");
      const button = document.createElement("button");
      const spy = createListenerSpy(button);
      const editable = signal(true);
      const log = [];
      const mounted = mount(() => {
        __mixOnConditionalEvent(button, "click", editable, () => log.push("save"), () => log.push("login"));
        return button;
      }, container);
      assert.strictEqual(spy.active.size, 1);
      button.click();
      assert.deepStrictEqual(log, ["save"]);
      editable.set(false);
      assert.strictEqual(spy.active.size, 1);
      assert.strictEqual(spy.records[1].action, "remove");
      assert.strictEqual(spy.records[2].action, "add");
      assert.strictEqual(spy.records[1].listener, spy.records[0].listener);
      button.click();
      assert.deepStrictEqual(log, ["save", "login"]);
      editable.set(true);
      button.click();
      assert.deepStrictEqual(log, ["save", "login", "save"]);
      mounted.unmount();
      assert.strictEqual(spy.active.size, 0);
    });
  });

  test("conditional events: calls removeEventListener with exact wrapper reference and options on unmount", () => {
    withDom((document) => {
      const container = document.createElement("div");
      const button = document.createElement("button");
      const spy = createListenerSpy(button);
      const active = signal(true);
      const mounted = mount(() => {
        __mixOnConditionalEvent(button, "click", active, () => {}, null, { capture: true, passive: false });
        return button;
      }, container);
      assert.strictEqual(spy.records.length, 1);
      assert.deepStrictEqual(spy.records[0].options, { capture: true, passive: false });
      mounted.unmount();
      assert.strictEqual(spy.records.length, 2);
      assert.strictEqual(spy.records[1].action, "remove");
      assert.strictEqual(spy.records[1].listener, spy.records[0].listener);
      assert.strictEqual(spy.records[1].options, spy.records[0].options);
      assert.strictEqual(spy.active.size, 0);
    });
  });

  test("conditional events: evaluates condition first during hydration without attaching falsy listener", () => {
    withDom((document) => {
      const container = document.createElement("div");
      container.innerHTML = "<button>Action</button>";
      const button = container.firstElementChild;
      const spy = createListenerSpy(button);
      const canAct = signal(false);
      let clicks = 0;
      const dispose = hydrate(() => {
        const claimed = createElement("button");
        assert.strictEqual(claimed, button);
        __mixOnConditionalEvent(claimed, "click", canAct, () => { clicks++; });
      }, container);
      assert.strictEqual(spy.records.length, 0);
      button.click();
      assert.strictEqual(clicks, 0);
      canAct.set(true);
      assert.strictEqual(spy.active.size, 1);
      button.click();
      assert.strictEqual(clicks, 1);
      dispose.unmount();
      assert.strictEqual(spy.active.size, 0);
    });
  });

  test("event modifiers: enforces prevent, stop, self, outside, keyboard keys, and modifiers", () => {
    withDom((document, win) => {
      const container = document.createElement("div");
      const outer = document.createElement("div");
      const inner = document.createElement("button");
      outer.appendChild(inner);
      document.body.appendChild(outer);
      let selfHits = 0;
      let enterHits = 0;
      let outsideHits = 0;
      let stoppedOuterHits = 0;
      const mounted = mount(() => {
        __mixOnEvent(outer, "click", () => { stoppedOuterHits++; });
        __mixOnEvent(outer, "click", () => { selfHits++; }, { self: true });
        __mixOnEvent(inner, "click", () => {}, { stop: true, prevent: true });
        __mixOnEvent(inner, "keydown", () => { enterHits++; }, { enter: true, ctrl: true });
        __mixOnEvent(outer, "click", () => { outsideHits++; }, { outside: true });
        return outer;
      }, container);
      inner.click();
      assert.deepStrictEqual([stoppedOuterHits, selfHits, outsideHits], [0, 0, 0]);
      outer.click();
      assert.deepStrictEqual([selfHits, outsideHits], [1, 0]);
      document.body.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
      assert.strictEqual(outsideHits, 1);
      inner.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", ctrlKey: false }));
      inner.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true }));
      assert.strictEqual(enterHits, 1);
      mounted.unmount();
    });
  });

  test("isEmpty, isSet, show, and switch: handles 0/false, display restore, and Object.is matching", () => {
      assert.deepStrictEqual(
        [__mixIsSet(0), __mixIsSet(false), __mixIsSet(null), __mixIsEmpty(0), __mixIsEmpty(false), __mixIsEmpty(""), __mixIsEmpty([]), __mixIsEmpty(new Map()), __mixIsEmpty(new Set([1])), __mixIsEmpty({}), __mixIsEmpty({ count: 0 })],
        [true, true, false, false, false, true, true, true, false, true, false]
      );
    withDom((document) => {
      const container = document.createElement("div");
      const visible = signal(true);
      const status = signal("loading");
      const box = document.createElement("div");
      box.style.display = "flex";
      const mounted = mount(() => {
        __mixShow(box, visible);
        const host = document.createElement("section");
        host.appendChild(box);
        __mixSwitch(
          host,
          status,
          [
            { kind: "values", values: () => ["loading"], render: () => document.createTextNode("Loading") },
            { kind: "values", values: () => ["error", "timeout"], render: () => document.createTextNode("Failed") },
            { kind: "condition", condition: () => true, render: () => document.createTextNode("Cond") }
          ],
          () => document.createTextNode("Default")
        );
        return host;
      }, container);
      assert.strictEqual(box.style.display, "flex");
      visible.set(false);
      assert.strictEqual(box.style.display, "none");
      visible.set(true);
      assert.strictEqual(box.style.display, "flex");
      assert.strictEqual(container.textContent, "Loading");
      status.set("timeout");
      assert.strictEqual(container.textContent, "Failed");
      status.set("ready");
      assert.strictEqual(container.textContent, "Cond");
      mounted.unmount();
    });
  });

  test("for range and each pipeline: enforces step-zero and range limit guards and empty fallback", () => {
    assert.deepStrictEqual(__mixForRange(1, 3), [1, 2, 3]);
    assert.deepStrictEqual(__mixForRange(5, 3), [5, 4, 3]);
    assert.throws(() => __mixForRange(1, 5, 0), (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_ERR_FOR_STEP_ZERO);
    assert.throws(() => __mixForRange(1, 100_001), (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_ERR_FOR_RANGE_TOO_LARGE);
    const piped = __mixEachPipeline(
      [{ id: 1, archived: true }, { id: 2, archived: false }, { id: 3, archived: false }, { id: 4, archived: false }],
      { skip: (item) => item.archived, stop: (_item, index) => index >= 2 }
    );
    assert.deepStrictEqual(piped.map((item) => item.id), [2, 3]);
    withDom((document) => {
      const container = document.createElement("div");
      const list = signal([]);
      const mounted = mount(() => {
        const host = document.createElement("div");
        __mixEachWithEmpty(
          host, list, (item) => item.id,
          (itemGetter, indexGetter) => document.createTextNode(`${indexGetter()}:${itemGetter().id}`),
          () => document.createTextNode("Empty")
        );
        return host;
      }, container);
      assert.strictEqual(container.textContent, "Empty");
      list.set([{ id: "a" }, { id: "b" }]);
      assert.strictEqual(container.textContent, "0:a1:b");
      list.set([]);
      assert.strictEqual(container.textContent, "Empty");
      mounted.unmount();
    });
  });

  test("once, memo, lazy, and await timeout: control tracking, stale async, and observer cleanup", async () => {
    await withDomAsync(async (document) => {
      const container = document.createElement("div");
      const tracked = signal(1);
      const untrackedDep = signal("light");
      let memoRuns = 0;
      const mounted = mount(() => {
        const host = document.createElement("div");
        __mixOnce(host, () => document.createTextNode(`once:${tracked()}`));
        __mixMemo(host, () => [tracked()], () => {
          memoRuns++;
          return document.createTextNode(`memo:${tracked()}:${untrackedDep()}`);
        });
        return host;
      }, container);
      assert.strictEqual(container.textContent, "once:1memo:1:light");
      untrackedDep.set("dark");
      assert.strictEqual(memoRuns, 1);
      tracked.set(2);
      assert.strictEqual(memoRuns, 2);
      assert.strictEqual(container.textContent, "once:1memo:2:dark");
      mounted.unmount();

      let resolveFirst;
      let resolveSecond;
      const activePromise = signal(new Promise((resolve) => { resolveFirst = resolve; }));
      const secondPromise = new Promise((resolve) => { resolveSecond = resolve; });
      const awaitContainer = document.createElement("div");
      const mountedAwait = mount(() => {
        const host = document.createElement("div");
        __mixAwaitWithTimeout(host, activePromise, 15, {
          pending: () => document.createTextNode("pending"),
          timeout: () => document.createTextNode("timed-out"),
          then: (dataGetter) => document.createTextNode(`done:${dataGetter()}`)
        });
        return host;
      }, awaitContainer);
      assert.strictEqual(awaitContainer.textContent, "pending");
      await new Promise((resolve) => globalThis.setTimeout(resolve, 30));
      assert.strictEqual(awaitContainer.textContent, "timed-out");
      activePromise.set(secondPromise);
      resolveFirst("stale");
      await Promise.resolve();
      assert.strictEqual(awaitContainer.textContent, "pending");
      resolveSecond("fresh");
      await Promise.resolve();
      assert.strictEqual(awaitContainer.textContent, "done:fresh");
      mountedAwait.unmount();

      const prevIo = globalThis.IntersectionObserver;
      let disconnected = false;
      let triggerIntersect;
      globalThis.IntersectionObserver = class {
        constructor(callback) { triggerIntersect = callback; }
        observe() {}
        disconnect() { disconnected = true; }
      };
      try {
        const lazyContainer = document.createElement("div");
        const mountedLazy = mount(() => {
          const host = document.createElement("div");
          __mixLazy(host, "visible", () => document.createTextNode("loaded"), () => document.createTextNode("wait"));
          return host;
        }, lazyContainer);
        assert.strictEqual(lazyContainer.textContent, "wait");
        triggerIntersect([{ isIntersecting: true, intersectionRatio: 1 }]);
        assert.strictEqual(lazyContainer.textContent, "loaded");
        assert.strictEqual(disconnected, true);
        mountedLazy.unmount();
      } finally {
        globalThis.IntersectionObserver = prevIo;
      }
    });
  });

  test("auth, permissions, and forms: enforces provider/role errors, permission gates, and touched error visibility", async () => {
    await withDomAsync(async (document) => {
      assert.throws(
        () => mount(() => { const host = document.createElement("div"); __mixAuth(host, {}, () => document.createTextNode("ok")); return host; }, document.createElement("div")),
        (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_ERR_AUTH_PROVIDER_MISSING
      );
      const currentUser = signal({ name: "Ada" });
      const authNoRoles = createAuth({ guards: { web: () => currentUser() } });
      assert.throws(
        () => mount(() => AuthProvider({ value: authNoRoles, children: () => { const host = document.createElement("div"); __mixAuth(host, { roles: ["admin"] }, () => document.createTextNode("ok")); return host; } }), document.createElement("div")),
        (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_ERR_AUTH_ROLE_UNSUPPORTED
      );
      const authContainer = document.createElement("div");
      const auth = createAuth({ guards: { web: () => currentUser() }, hasRole: (user, role) => user.name === "Ada" && role === "admin" });
      const mountedAuth = mount(
        () => AuthProvider({
          value: auth,
          children: () => {
            const host = document.createElement("div");
            __mixAuth(host, { roles: ["admin"] }, (userGetter) => document.createTextNode(`hello:${userGetter().name}`), () => document.createTextNode("denied"));
            __mixGuest(host, undefined, () => document.createTextNode(":guest"));
            return host;
          }
        }),
        authContainer
      );
      assert.strictEqual(authContainer.textContent, "hello:Ada");
      currentUser.set(null);
      assert.strictEqual(authContainer.textContent, "denied:guest");
      mountedAuth.unmount();

      const ability = defineAbility((can) => { can("read", "Task"); });
      const permContainer = document.createElement("div");
      const mountedPerm = mount(
        () => PermissionProvider({
          ability,
          children: () => {
            const host = document.createElement("div");
            host.appendChild(Cannot({ I: "delete", a: "Task", children: () => document.createTextNode("cannot|") }));
            host.appendChild(CanAny({ I: ["delete", "read"], a: "Task", children: () => document.createTextNode("canany") }));
            return host;
          }
        }),
        permContainer
      );
      assert.strictEqual(permContainer.textContent, "cannot|canany");
      mountedPerm.unmount();

      const form = createForm({ initialValues: { email: "" }, validators: { email: [validators.required("Email required")] } });
      const formContainer = document.createElement("div");
      const mountedForm = mount(() => {
        const host = document.createElement("div");
        __mixBindFieldError(host, form, "email");
        __mixBindFormErrors(host, form, (listGetter) => document.createTextNode(`[${listGetter().length}]`));
        return host;
      }, formContainer);
      form.field("email").setValue("");
      assert.strictEqual(__mixFieldError(form, "email"), null);
      assert.strictEqual(__mixFieldValid(form, "email"), false);
      await form.handleSubmit();
      assert.strictEqual(__mixFieldError(form, "email"), "Email required");
      assert.strictEqual(formContainer.textContent, "Email required[1]");
      mountedForm.unmount();
    });
  });

  test("stacks, head, attrs, json, csrf/session, and directive stubs", () => {
    const ssrStacks = __mixCreateStackCollector();
    ssrStacks.push("scripts", "<script>push1</script>", "lib");
    ssrStacks.push("scripts", "<script>push2</script>", "lib");
    ssrStacks.prepend("scripts", "<script>pre1</script>");
    assert.deepStrictEqual(ssrStacks.getEntries("scripts"), ["<script>pre1</script>", "<script>push1</script>"]);
    const ssrHead = __mixCreateHeadCollector();
    ssrHead.addTitle("First");
    ssrHead.addTitle("Second");
    ssrHead.addMeta({ name: "description", content: "One" });
    ssrHead.addMeta({ name: "description", content: "Two" });
    ssrHead.addLink({ rel: "canonical", href: "/a" });
    ssrHead.addLink({ rel: "canonical", href: "/a" });
    assert.strictEqual(ssrHead.getTags().length, 3);
    assert.ok(ssrHead.renderHtml().includes("<title>Second</title>"));

    const escaped = __mixEscapeJson('{"html":"</SCRIPT><!--\u2028\u2029"}');
    assert.strictEqual(escaped.toLowerCase().includes("</script"), false);
    assert.strictEqual(escaped.includes("<!--"), false);
    assert.deepStrictEqual(JSON.parse(__mixJson({ text: "</script><!--" })), { text: "</script><!--" });

    withDom((document) => {
      document.title = "Base Title";
      const container = document.createElement("div");
      const showChild = signal(true);
      const mounted = mount(() => {
        const host = document.createElement("div");
        __mixRenderStack(host, "body-scripts");
        __mixPushStack("body-scripts", () => document.createTextNode("P1"));
        __mixPrependStack("body-scripts", () => document.createTextNode("Pre"));
        __mixPushStack("body-scripts", () => document.createTextNode("Once"), "id1");
        __mixPushStack("body-scripts", () => document.createTextNode("Dup"), "id1");
        __mixHead([
          { kind: "title", text: () => "Parent Title" },
          { kind: "meta", attrs: () => ({ name: "author", content: "Mix" }) },
          { kind: "link", attrs: () => ({ rel: "icon", href: "/a.ico" }) }
        ]);
        const badge = document.createElement("span");
        badge.className = "static";
        __mixBindClassMap(badge, () => ({ active: showChild(), hidden: false }));
        __mixBindStyleMap(badge, () => ({ color: "red", "--gap": "4px" }));
        __mixBindBooleanAttr(badge, "disabled", () => true);
        __mixBindConditionalAttr(badge, "data-flag", showChild, () => "yes", () => "no");
        __mixBindMatchAttr(badge, "data-state", () => "ok", [{ token: "ok", value: () => "green" }]);
        __mixJsonScript(host, "app-data", () => ({ safe: "</script>" }));
        __mixProvideRequestContext(
          { session: (key) => (key === "flash" ? "Saved" : undefined), csrfToken: () => "tok-1" },
          () => {
            __mixCsrfInput(host);
            __mixMethodInput(host, "PUT");
            assert.strictEqual(__mixSession("flash"), "Saved");
          }
        );
        host.appendChild(badge);
        return host;
      }, container);
      assert.strictEqual(document.title, "Parent Title");
      assert.ok(container.textContent.startsWith("PreP1Once"));
      assert.strictEqual(container.querySelector("span").classList.contains("active"), true);
      assert.strictEqual(container.querySelector("span").getAttribute("data-state"), "green");
      assert.strictEqual(container.querySelector("input[name='_token']").getAttribute("value"), "tok-1");
      assert.strictEqual(container.querySelector("input[name='_method']").getAttribute("value"), "PUT");
      mounted.unmount();
      assert.strictEqual(document.title, "Base Title");
      assert.strictEqual(document.head.querySelector('meta[name="author"]'), null);
    });

    for (const componentFn of [If, For, Switch, Each]) {
      assert.throws(() => componentFn({}), (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_ERR_DIRECTIVE_NOT_COMPILED);
    }
  });
});
