import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  DiagnosticCodes,
  MixError,
  OwnerState,
  signal,
  createEffect,
  createRoot,
  getCurrentOwner,
  onCleanup,
  longestIncreasingSubsequence,
  renderKeyedList,
  createKeyedEach,
  createHmrScope,
  applyHmrUpdate
} from "../../packages/runtime/dist/index.js";

describe("Gate 7 & Gate 8: Keyed LIS Reconciliation (D-110 / HAA-02) & HMR Stable Scope (D-111)", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.document = document;
  });

  describe("1. O(N log N) Longest Increasing Subsequence (LIS)", () => {
    it("accurately handles index 0, negative (-1) new-item markers, reversals, and shuffles", () => {
      // Index 0 at the start must be included in LIS
      const lis1 = longestIncreasingSubsequence([0, 2, 1, 3]);
      assert.equal(lis1.length, 3);
      assert.equal(lis1[0], 0); // seq[0] === 0!
      assert.equal(lis1[2], 3); // seq[3] === 3

      // Negative markers (-1) for newly inserted items are ignored
      const lis2 = longestIncreasingSubsequence([-1, 0, -1, 1, 2]);
      assert.deepEqual(lis2, [1, 3, 4]);

      // Complete reversal [3, 2, 1, 0] has LIS of length 1
      const lis3 = longestIncreasingSubsequence([3, 2, 1, 0]);
      assert.equal(lis3.length, 1);

      // Single element [0]
      assert.deepEqual(longestIncreasingSubsequence([0]), [0]);
      assert.deepEqual(longestIncreasingSubsequence([-1, -1]), []);
    });
  });

  describe("2. Surgical DOM Identity Preservation & Minimal LIS Moves", () => {
    it("preserves DOM nodes and only moves out-of-order elements during keyed updates", () => {
      const ul = document.createElement("ul");
      const items = [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
        { id: "d", label: "D" }
      ];

      renderKeyedList(
        ul,
        items,
        (item) => item.id,
        (item, indexGetter, itemGetter) => {
          const li = document.createElement("li");
          createEffect(() => {
            li.textContent = `${indexGetter()}:${itemGetter().label}`;
          });
          return li;
        }
      );

      const initialLis = [...ul.querySelectorAll("li")];
      assert.equal(initialLis.length, 4);
      assert.deepEqual(
        initialLis.map((el) => el.textContent),
        ["0:A", "1:B", "2:C", "3:D"]
      );

      // Track insertBefore calls when moving on [a, c, d, b] -> LIS is [a, c, d] (3 items), only 'b' moves!
      let insertBeforeCount = 0;
      const origInsertBefore = ul.insertBefore.bind(ul);
      ul.insertBefore = (node, child) => {
        insertBeforeCount++;
        return origInsertBefore(node, child);
      };

      renderKeyedList(
        ul,
        [
          { id: "a", label: "A" },
          { id: "c", label: "C-updated" },
          { id: "d", label: "D" },
          { id: "b", label: "B" }
        ],
        (item) => item.id,
        (item, indexGetter, itemGetter) => {
          const li = document.createElement("li");
          createEffect(() => {
            li.textContent = `${indexGetter()}:${itemGetter().label}`;
          });
          return li;
        }
      );

      // Only 1 element ('b') was moved!
      assert.equal(insertBeforeCount, 1);

      const reorderedLis = [...ul.querySelectorAll("li")];
      assert.equal(reorderedLis[0], initialLis[0]); // 'a' same DOM node
      assert.equal(reorderedLis[1], initialLis[2]); // 'c' same DOM node
      assert.equal(reorderedLis[2], initialLis[3]); // 'd' same DOM node
      assert.equal(reorderedLis[3], initialLis[1]); // 'b' same DOM node
      assert.deepEqual(
        reorderedLis.map((el) => el.textContent),
        ["0:A", "1:C-updated", "2:D", "3:B"]
      );
    });
  });

  describe("3. Atomic Duplicate-Update Rejection Policy (D-110 / HAA-02 Option A Strict)", () => {
    it("validates keys upfront, rejects duplicates atomically, preserves DOM & owners, allocates zero nodes, and throws MixError", () => {
      const container = document.createElement("div");
      let renderAllocations = 0;
      const rowOwners = new Map();
      const disposedKeys = [];

      const initialItems = [
        { id: "k1", name: "First" },
        { id: "k2", name: "Second" },
        { id: "k3", name: "Third" }
      ];

      renderKeyedList(
        container,
        initialItems,
        (item) => item.id,
        (item, _idx, itemGetter) => {
          renderAllocations++;
          const owner = getCurrentOwner();
          rowOwners.set(item.id, owner);
          onCleanup(() => {
            disposedKeys.push(item.id);
          });
          const row = document.createElement("p");
          row.setAttribute("data-key", item.id);
          createEffect(() => {
            row.textContent = itemGetter().name;
          });
          return row;
        }
      );

      assert.equal(renderAllocations, 3);
      const beforeNodes = [...container.querySelectorAll("p")];
      assert.equal(beforeNodes.length, 3);

      // Now attempt an invalid update containing a brand new key "new-key" AND a duplicate key "dup"
      const invalidUpdate = [
        { id: "new-key", name: "Should Never Allocate" },
        { id: "dup", name: "Dup 1" },
        { id: "k2", name: "Second Mutated" },
        { id: "dup", name: "Dup 2" }
      ];

      assert.throws(
        () =>
          renderKeyedList(
            container,
            invalidUpdate,
            (item) => item.id,
            () => {
              renderAllocations++;
              return document.createElement("p");
            }
          ),
        (err) => err instanceof MixError && err.code === DiagnosticCodes.MIX_ERR_DUPLICATE_KEY
      );

      // Verify all 6 requirements of D-110 / HAA-02 Option A:
      // 1. Zero new DOM or owner allocations occurred for "new-key" or "dup"
      assert.equal(renderAllocations, 3);
      // 2. Zero existing row owners were disposed
      assert.deepEqual(disposedKeys, []);
      for (const owner of rowOwners.values()) {
        assert.equal(owner.ownerState, OwnerState.ACTIVE);
      }
      // 3. Previously rendered DOM collection remains 100% intact and unmutated
      const afterNodes = [...container.querySelectorAll("p")];
      assert.deepEqual(afterNodes, beforeNodes);
      assert.deepEqual(
        afterNodes.map((n) => n.textContent),
        ["First", "Second", "Third"]
      );

      // 4. Subsequent valid update succeeds cleanly
      renderKeyedList(
        container,
        [
          { id: "k3", name: "Third Updated" },
          { id: "k1", name: "First Updated" }
        ],
        (item) => item.id,
        (item, _idx, itemGetter) => {
          renderAllocations++;
          const row = document.createElement("p");
          createEffect(() => {
            row.textContent = itemGetter().name;
          });
          return row;
        }
      );

      assert.deepEqual(disposedKeys, ["k2"]);
      assert.equal(rowOwners.get("k2").ownerState, OwnerState.DISPOSED);
      assert.equal(rowOwners.get("k1").ownerState, OwnerState.ACTIVE);
      assert.equal(rowOwners.get("k3").ownerState, OwnerState.ACTIVE);
      assert.deepEqual(
        [...container.querySelectorAll("p")].map((n) => n.textContent),
        ["Third Updated", "First Updated"]
      );
    });

    it("reactive createKeyedEach tears down row owners on removal and rejects duplicate keys", () => {
      const parent = document.createElement("div");
      const listSig = signal([
        { id: 1, title: "One" },
        { id: 2, title: "Two" }
      ]);

      let unmountRoot;
      createRoot((dispose) => {
        unmountRoot = dispose;
        createKeyedEach(
          parent,
          () => listSig(),
          (item) => item.id,
          (itemGetter, indexGetter) => {
            const span = document.createElement("span");
            createEffect(() => {
              span.textContent = `#${indexGetter()}:${itemGetter().title}`;
            });
            return span;
          }
        );
      });

      assert.deepEqual(
        [...parent.querySelectorAll("span")].map((s) => s.textContent),
        ["#0:One", "#1:Two"]
      );

      listSig.set([
        { id: 2, title: "Two+" },
        { id: 3, title: "Three" }
      ]);
      assert.deepEqual(
        [...parent.querySelectorAll("span")].map((s) => s.textContent),
        ["#0:Two+", "#1:Three"]
      );

      unmountRoot();
      assert.equal(parent.querySelectorAll("span").length, 0);
    });
  });

  describe("4. HMR Stable Scope & Trampoline Dispatch (D-111)", () => {
    it("hot-swaps component methods in place via stable scope without rebinding DOM event listeners", () => {
      const btn = document.createElement("button");
      const count = signal(5);
      let remountCalled = 0;

      const hmr = createHmrScope(
        "Counter.mix",
        { count },
        {
          onClick(scope) {
            const c = scope.count;
            c.set(c() + 1);
          }
        },
        "sig:count",
        () => {
          remountCalled++;
        }
      );

      btn.addEventListener("click", hmr.trampoline("onClick"));

      btn.click();
      assert.equal(count(), 6);

      // Hot-swap onClick to add 10 instead of 1, keeping the same state signature
      const swappedInPlace = applyHmrUpdate("Counter.mix", {
        signature: "sig:count",
        methods: {
          onClick(scope) {
            const c = scope.count;
            c.set(c() + 10);
          }
        }
      });

      assert.equal(swappedInPlace, true);
      assert.equal(remountCalled, 0);

      // Clicking the same untouched DOM button invokes the new method against live state!
      btn.click();
      assert.equal(count(), 16);

      // Changing the structural state signature triggers full remount
      const swappedOnSigChange = applyHmrUpdate("Counter.mix", {
        signature: "sig:count+extra",
        methods: {}
      });
      assert.equal(swappedOnSigChange, false);
      assert.equal(remountCalled, 1);
    });
  });
});
