import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  DiagnosticCodes,
  MixError,
  signal,
  createEffect,
  createRoot,
  createElement,
  createTextNode,
  setText,
  insertNode,
  createKeyedEach,
  renderKeyedList,
  resolveIncomingKeys,
  hydrateRoot,
  mount,
  setErrorReporter,
  normalizeSameValueZeroKey,
  __mixFor,
  __mixEachWithEmpty
} from "../../node_modules/@dotmix/runtime/dist/index.js";
import { parse } from "../../node_modules/@dotmix/compiler-frontend/dist/index.js";
import { analyze, typecheckTix } from "../../node_modules/@dotmix/compiler-semantic/dist/index.js";
import { generate } from "../../node_modules/@dotmix/compiler-codegen/dist/index.js";
import { compileToSsr } from "../../node_modules/@dotmix/compiler-ssr/dist/index.js";
import { MixLanguageService } from "../../node_modules/@dotmix/language-server/dist/index.js";

describe("Gate 40 — D-188 Safe Two-Mode List Keys", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.document = document;
    setErrorReporter(null);
  });

  afterEach(() => {
    setErrorReporter(null);
  });

  it("K1/K3: implicit mode renders plain objects without id, mixed primitives/objects, and invalid id fallback", () => {
    const ul = document.createElement("ul");
    const a = { label: "Alpha" };
    const b = { id: "b-id", label: "Beta" };
    const c = { key: 42, label: "Gamma" };
    const d = { id: { invalid: true }, label: "InvalidIdObj" };
    const e = { id: Number.NaN, label: "InvalidIdNaN" };
    const items = signal([a, b, c, d, e, "str", 7]);

    const warnings = [];
    setErrorReporter((err, info) => warnings.push({ err, info }));

    createRoot(() => {
      createKeyedEach(
        ul,
        () => items(),
        null,
        (getItem) => {
          const li = document.createElement("li");
          createEffect(() => {
            const v = getItem();
            li.textContent = typeof v === "object" && v ? v.label : String(v);
          });
          return [li];
        },
        null,
        { mode: "implicit" }
      );
    });

    const initialLis = [...ul.querySelectorAll("li")];
    assert.deepEqual(
      initialLis.map((n) => n.textContent),
      ["Alpha", "Beta", "Gamma", "InvalidIdObj", "InvalidIdNaN", "str", "7"]
    );
    assert.equal(warnings.length, 0);

    // Reorder plain objects without id and verify exact DOM node identity preserved
    items.set([d, a, c, b, "str"]);
    const afterLis = [...ul.querySelectorAll("li")];
    assert.equal(afterLis[0], initialLis[3], "invalid-id object falls back to reference identity");
    assert.equal(afterLis[1], initialLis[0], "plain object without id keeps DOM node on reorder");
    assert.equal(afterLis[2], initialLis[2], "item.key object keeps DOM node");
    assert.equal(afterLis[3], initialLis[1], "item.id object keeps DOM node");
    assert.equal(afterLis[4], initialLis[5], "primitive keeps DOM node");
  });

  it("K4: implicit duplicates (primitives, ids, refs) never throw, preserve DOM nodes, and warn once per list", () => {
    const ul = document.createElement("ul");
    const shared = { label: "SameRef" };
    const items = signal(["x", "x", shared, shared, { id: "dup", label: "D1" }, { id: "dup", label: "D2" }]);
    const warnings = [];
    setErrorReporter((err, info) => {
      if (info.source === "warning") warnings.push({ err, info });
    });

    createRoot(() => {
      createKeyedEach(
        ul,
        () => items(),
        null,
        (getItem) => {
          const li = document.createElement("li");
          createEffect(() => {
            const v = getItem();
            li.textContent = typeof v === "object" && v ? v.label : String(v);
          });
          return [li];
        },
        null,
        { mode: "implicit", loc: { file: "src/List.tix", line: 10, column: 5, collection: "items", itemIdent: "item" } }
      );
    });

    const before = [...ul.querySelectorAll("li")];
    assert.equal(before.length, 6);
    assert.equal(warnings.length, 1, "Must emit exactly one warning per list");
    assert.equal(warnings[0].info.code, DiagnosticCodes.MIX_WARN_IMPLICIT_DUPLICATE_KEY);

    // Update with duplicates again: DOM nodes preserved and no second warning
    items.set(["x", "x", "y", shared, shared]);
    const after = [...ul.querySelectorAll("li")];
    assert.equal(after.length, 5);
    assert.equal(after[0], before[0]);
    assert.equal(after[1], before[1]);
    assert.equal(after[3], before[2]);
    assert.equal(after[4], before[3]);
    assert.equal(warnings.length, 1, "Warning must fire at most once per list across updates");
  });

  it("K2/K5/K6: explicit mode rejects invalid key types with MIX_ERR_INVALID_KEY, safe JSON, file:line:col, and Fix hint", () => {
    const ul = document.createElement("ul");
    const navLinks = [{ href: "/pro", label: "Pro", extra: "x".repeat(120) }];

    assert.throws(
      () =>
        renderKeyedList(
          ul,
          navLinks,
          (item) => item,
          () => [document.createElement("li")],
          {
            mode: "explicit",
            loc: {
              file: "src/components/SiteHeader.tix",
              line: 61,
              column: 11,
              collection: "navLinks",
              keyExpr: "item",
              itemIdent: "item",
              indexIdent: "idx"
            }
          }
        ),
      (err) => {
        assert.ok(err instanceof MixError);
        assert.equal(err.code, DiagnosticCodes.MIX_ERR_INVALID_KEY);
        assert.ok(err.message.includes("src/components/SiteHeader.tix:61:11"), err.message);
        assert.ok(err.message.includes("{each (item, idx, item) in navLinks}"), err.message);
        assert.ok(!err.message.includes("[object Object]"), "Must never print [object Object]");
        assert.ok(err.message.includes('{"href":"/pro"'), err.message);
        assert.ok(err.message.includes("Fix:"), err.message);
        return true;
      }
    );

    // NaN and null rejected in explicit mode; -0 normalized to 0
    assert.equal(Object.is(normalizeSameValueZeroKey(-0, 0, "explicit"), 0), true);
    assert.throws(
      () => normalizeSameValueZeroKey(Number.NaN, 0, "explicit"),
      (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_ERR_INVALID_KEY
    );
    assert.throws(
      () => normalizeSameValueZeroKey(null, 2, "explicit"),
      (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_ERR_INVALID_KEY
    );

    // Production mode (no loc): code + index only, no source text
    assert.throws(
      () =>
        renderKeyedList(ul, [{ a: 1 }], (item) => item, () => [document.createElement("li")], {
          mode: "explicit"
        }),
      (err) => {
        assert.equal(err.code, DiagnosticCodes.MIX_ERR_INVALID_KEY);
        assert.ok(err.message.includes("index 0"));
        assert.ok(!err.message.includes("Fix:"));
        return true;
      }
    );
  });

  it("K2: explicit duplicate key rejects atomically with MIX_ERR_DUPLICATE_KEY without mutating DOM", () => {
    const ul = document.createElement("ul");
    const list = signal([{ id: "a", name: "A" }, { id: "b", name: "B" }]);
    createRoot(() => {
      createKeyedEach(
        ul,
        () => list(),
        (item) => item.id,
        (getItem) => {
          const li = document.createElement("li");
          li.textContent = getItem().name;
          return [li];
        },
        null,
        { mode: "explicit", loc: { file: "src/App.tix", line: 5, column: 3, collection: "list", keyExpr: "item.id", itemIdent: "item" } }
      );
    });
    const before = [...ul.querySelectorAll("li")];
    assert.throws(
      () => list.set([{ id: "a", name: "A2" }, { id: "a", name: "Dup" }]),
      (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_ERR_DUPLICATE_KEY
    );
    const after = [...ul.querySelectorAll("li")];
    assert.equal(after.length, 2);
    assert.equal(after[0], before[0]);
    assert.equal(after[1], before[1]);
  });

  it("K7: compile-time .tix checker & LSP reject object explicit keys and accept implicit object lists", () => {
    const badSrc = `export default function Bad() {
  const items = [{ label: "One" }, { label: "Two" }];
  return (<ul>{each (item, i, item) in items}<li>{item.label}</li>{endeach}</ul>);
}`;
    const parsedBad = parse(badSrc, { filename: "Bad.tix" });
    const descBad = analyze(parsedBad, { filename: "Bad.tix", source: badSrc });
    const tcBad = typecheckTix(descBad, badSrc, { filename: "Bad.tix" });
    const keyErr = tcBad.diagnostics.find((d) => d.code === DiagnosticCodes.MIX_ERR_INVALID_KEY);
    assert.ok(keyErr, `Expected MIX_ERR_INVALID_KEY diagnostic, got: ${JSON.stringify(tcBad.diagnostics)}`);
    assert.equal(keyErr.span.start.line, 3);

    const ls = new MixLanguageService();
    const lspDiags = ls.getDiagnostics("Bad.tix", badSrc);
    assert.ok(lspDiags.some((d) => d.code === DiagnosticCodes.MIX_ERR_INVALID_KEY), "LSP must emit MIX_ERR_INVALID_KEY");

    const goodSrc = `export default function Good() {
  const items = [{ label: "One" }, { label: "Two" }];
  return (<ul>{each (item, i) in items}<li>{i}: {item.label}</li>{endeach}</ul>);
}`;
    const parsedGood = parse(goodSrc, { filename: "Good.tix" });
    const descGood = analyze(parsedGood, { filename: "Good.tix", source: goodSrc });
    const tcGood = typecheckTix(descGood, goodSrc, { filename: "Good.tix" });
    assert.equal(tcGood.diagnostics.filter((d) => d.severity === "error").length, 0, JSON.stringify(tcGood.diagnostics));
  });

  it("K8: SSR hydration adopts implicit-identity rows positionally without serializing keys and preserves them on update", () => {
    const src = `<script>const items = [{ label: "One" }, { label: "Two" }];</script><ul>{each item in items}<li>{item.label}</li>{endeach}</ul>`;
    const parsed = parse(src, { filename: "HydrateList.tix" });
    const desc = analyze(parsed, { filename: "HydrateList.tix", source: src });
    const ssr = compileToSsr(desc, undefined, { includeHydrationMarkers: true });
    assert.ok(!ssr.code.includes("item?.id"), "SSR must not serialize implicit keys");
    assert.ok(ssr.code.includes("<!--mix:item:"), "SSR emits positional item markers");

    const a = { label: "One" };
    const b = { label: "Two" };
    const listSig = signal([a, b]);
    const container = document.createElement("div");
    container.setAttribute("data-mix-ssr", "");
    container.innerHTML = `<ul><!--mix:each:0--><!--mix:item:0--><li><!--mix:t:0-->One<!--/mix:t:0--></li><!--/mix:item:0--><!--mix:item:1--><li><!--mix:t:1-->Two<!--/mix:t:1--></li><!--/mix:item:1--><!--/mix:each:0--></ul>`;
    const ssrLis = [...container.querySelectorAll("li")];

    const App = () => {
      const ul = createElement("ul");
      createKeyedEach(
        ul,
        () => listSig(),
        null,
        (getItem) => {
          const li = createElement("li");
          const txt = createTextNode("");
          insertNode(li, txt);
          createEffect(() => { setText(txt, getItem().label); });
          return [li];
        },
        null,
        { mode: "implicit" }
      );
      return ul;
    };

    const handle = hydrateRoot(App, container);
    const hydratedLis = [...container.querySelectorAll("li")];
    assert.equal(hydratedLis.length, 2);
    assert.equal(hydratedLis[0], ssrLis[0], "First row adopted in place");
    assert.equal(hydratedLis[1], ssrLis[1], "Second row adopted in place");

    // Reorder by object reference identity
    listSig.set([b, a]);
    const reorderedLis = [...container.querySelectorAll("li")];
    assert.equal(reorderedLis[0], ssrLis[1]);
    assert.equal(reorderedLis[1], ssrLis[0]);
    handle.unmount();
  });

  it("K8: __mixFor numeric ranges and __mixEachWithEmpty work in implicit and explicit modes", () => {
    const host = document.createElement("div");
    const items = signal([{ label: "First" }]);
    const mounted = mount(() => {
      const box = document.createElement("div");
      __mixFor(box, { kind: "range", from: () => 1, to: () => 3 }, (n) => {
        const s = document.createElement("span");
        s.textContent = `f${n()}`;
        return [s];
      });
      __mixEachWithEmpty(
        box,
        () => items(),
        null,
        (getItem) => {
          const p = document.createElement("p");
          p.textContent = getItem().label;
          return [p];
        },
        () => {
          const p = document.createElement("p");
          p.textContent = "EMPTY";
          return [p];
        },
        null,
        { mode: "implicit" }
      );
      return box;
    }, host);

    assert.equal(host.textContent, "f1f2f3First");
    items.set([]);
    assert.equal(host.textContent, "f1f2f3EMPTY");
    mounted.unmount();
  });

  it("K6: production codegen strips dev loc and __mix_dev metadata", () => {
    const src = `<script>const items = [{ label: "A" }];</script><ul>{each item in items}<li>{item.label}</li>{endeach}</ul>`;
    const parsed = parse(src, { filename: "ProdList.tix" });
    const desc = analyze(parsed, { filename: "ProdList.tix", source: src });
    const prod = generate(desc, { filename: "ProdList.tix", componentName: "ProdList", mode: "production" });
    assert.ok(prod.js.includes('{ mode: "implicit" }'));
    assert.ok(!prod.js.includes("loc:"));
    assert.ok(!prod.js.includes("__mix_dev"));
  });

  it("F2: prunes synthetic duplicateTokens when a duplicated object leaves the list and allows re-adding twice", () => {
    const objA = { label: "ObjA" };
    const objB = { label: "ObjB" };
    const tracker = { duplicateTokens: new Map(), warnedDuplicate: false };

    // 1. Add duplicated object: token map holds objA
    const first = resolveIncomingKeys([objA, objA, objB], null, "implicit", tracker);
    assert.equal(tracker.duplicateTokens.has(objA), true);
    assert.equal(tracker.duplicateTokens.get(objA).size, 1);
    const firstDupSym = first.incomingKeys[1];

    // Still present twice -> keeps exact same symbol token
    const stillDup = resolveIncomingKeys([objB, objA, objA], null, "implicit", tracker);
    assert.equal(stillDup.incomingKeys[2], firstDupSym, "Token stays identical while object remains duplicated");

    // 2. Remove duplicated object: token map no longer holds objA
    resolveIncomingKeys([objB], null, "implicit", tracker);
    assert.equal(tracker.duplicateTokens.has(objA), false, "Removed object must be pruned from duplicateTokens");
    assert.equal(tracker.duplicateTokens.size, 0);

    // 3. Re-add it twice: works cleanly with no throw
    const readded = resolveIncomingKeys([objA, objA], null, "implicit", tracker);
    assert.equal(readded.incomingKeys.length, 2);
    assert.equal(readded.incomingKeys[0], objA);
    assert.equal(typeof readded.incomingKeys[1], "symbol");
    assert.equal(tracker.duplicateTokens.has(objA), true);

    // Full reactive DOM check: remove duplicated object, re-add twice cleanly
    const ul = document.createElement("ul");
    const listSig = signal([objA, objA]);
    createRoot(() => {
      createKeyedEach(
        ul,
        () => listSig(),
        null,
        (getItem) => {
          const li = document.createElement("li");
          li.textContent = getItem().label;
          return [li];
        },
        null,
        { mode: "implicit" }
      );
    });
    assert.equal(ul.querySelectorAll("li").length, 2);
    listSig.set([objB]);
    assert.deepEqual([...ul.querySelectorAll("li")].map((n) => n.textContent), ["ObjB"]);
    listSig.set([objA, objA]);
    assert.deepEqual([...ul.querySelectorAll("li")].map((n) => n.textContent), ["ObjA", "ObjA"]);
  });
});
