/* global structuredClone */
/**
 * @dotmix/sync — Multi-Tab Leader Failover & Post-Commit Refresh Test
 *
 * Verifies BroadcastChannel heartbeats, follower post-commit refreshes,
 * leader stall detection, failover takeover at fencingTerm+1, and fencing
 * out the stale previous leader.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MultiTabCoordinator } from "../../../packages/sync/dist/transport/multi-tab.js";

/**
 * In-memory simulated BroadcastChannel for deterministic multi-window testing.
 */
class SimulatedBroadcastChannelHub {
  constructor() {
    this.channelsByName = new Map();
  }

  createChannel(channelName) {
    let listeners = this.channelsByName.get(channelName);
    if (!listeners) {
      listeners = new Set();
      this.channelsByName.set(channelName, listeners);
    }

    const channelInstance = {
      name: channelName,
      onmessage: null,
      postMessage: (messageData) => {
        const clonedData = structuredClone(messageData);
        for (const targetListener of listeners) {
          if (targetListener !== channelInstance && targetListener.onmessage) {
            targetListener.onmessage({ data: clonedData });
          }
        }
      },
      close: () => {
        listeners.delete(channelInstance);
      },
    };

    listeners.add(channelInstance);
    return channelInstance;
  }
}

describe("Multi-Tab Lease Fencing & Leader Failover", () => {
  it("coordinates leader election, follower post-commit refreshes, failover on stall, and fencing out stale leader", () => {
    let simulatedCurrentWallTime = 1_000_000;
    const simulatedClock = () => simulatedCurrentWallTime;
    const channelHub = new SimulatedBroadcastChannelHub();
    const collectionId = "col_multitab_test";

    // 1. Instantiate three simulated tabs: Tab A, Tab B, Tab C
    const tabA = new MultiTabCoordinator({
      collectionId,
      tabIdentifier: "tab-window-A",
      clock: simulatedClock,
      broadcastChannelFactory: (name) => channelHub.createChannel(name),
    });

    const tabB = new MultiTabCoordinator({
      collectionId,
      tabIdentifier: "tab-window-B",
      clock: simulatedClock,
      broadcastChannelFactory: (name) => channelHub.createChannel(name),
    });

    const tabC = new MultiTabCoordinator({
      collectionId,
      tabIdentifier: "tab-window-C",
      clock: simulatedClock,
      broadcastChannelFactory: (name) => channelHub.createChannel(name),
    });

    // 2. Tab A acquires lease and becomes Primary Leader
    const tabAAcquired = tabA.acquirePrimaryLease();
    assert.equal(tabAAcquired, true);
    assert.equal(tabA.getRole(), "primary");
    assert.equal(tabA.getFencingTerm(), 1);

    // Tab B attempts acquisition while Tab A is active -> fails, remains Follower
    tabA.emitHeartbeat();
    const tabBAcquired = tabB.acquirePrimaryLease();
    assert.equal(tabBAcquired, false);
    assert.equal(tabB.getRole(), "follower");

    assert.equal(tabC.getRole(), "follower");

    // 3. Post-commit refresh: Tab A commits operations and broadcasts refresh notification
    const tabBReceivedRefreshes = [];
    const tabCReceivedRefreshes = [];

    const unsubscribeB = tabB.onFollowerRefresh((notification) => {
      tabBReceivedRefreshes.push(notification);
    });
    const unsubscribeC = tabC.onFollowerRefresh((notification) => {
      tabCReceivedRefreshes.push(notification);
    });

    const committedOperationKeys = ["col:1:tab-A:1", "col:1:tab-A:2"];
    const broadcastSuccessful = tabA.broadcastPostCommitRefresh(committedOperationKeys);
    assert.equal(broadcastSuccessful, true);

    // Verify followers received notification
    assert.equal(tabBReceivedRefreshes.length, 1);
    assert.equal(tabBReceivedRefreshes[0].tabIdentifier, "tab-window-A");
    assert.deepEqual(
      tabBReceivedRefreshes[0].committedOperationKeys,
      committedOperationKeys
    );

    assert.equal(tabCReceivedRefreshes.length, 1);
    assert.equal(tabCReceivedRefreshes[0].tabIdentifier, "tab-window-A");

    // 4. Leader Stall & Failover:
    // Tab A stalls (stops heartbeating). Clock advances past TAB_LEASE_TAKEOVER_STALE_MS (10,000ms)
    simulatedCurrentWallTime += 10_500;

    // Tab B attempts takeover
    const tabBTakeover = tabB.acquirePrimaryLease();
    assert.equal(tabBTakeover, true);
    assert.equal(tabB.getRole(), "primary");
    assert.equal(tabB.getFencingTerm(), 2, "Tab B must acquire at next fencing term (2)");

    // Tab B emits heartbeat at fencingTerm 2
    tabB.emitHeartbeat();

    // 5. Stale Leader Fencing:
    // Tab A wakes up and attempts to assert primary or commit an operation
    tabA.emitHeartbeat();
    const staleAssertion = tabA.assertActivePrimary();
    assert.equal(staleAssertion.ok, false);
    assert.equal(staleAssertion.code, "SYNC_STALE_TAB_LEASE_FENCED");

    const staleBroadcast = tabA.broadcastPostCommitRefresh(["col:1:tab-A:3"]);
    assert.equal(
      staleBroadcast,
      false,
      "Stale leader Tab A MUST be fenced out from broadcasting commits"
    );

    // Verify Tab B can broadcast commits as active leader
    const tabBPostCommit = tabB.broadcastPostCommitRefresh(["col:1:tab-B:1"]);
    assert.equal(tabBPostCommit, true);

    // Verify Tab C observes Tab B's refresh
    assert.equal(tabCReceivedRefreshes.length, 2);
    assert.equal(tabCReceivedRefreshes[1].tabIdentifier, "tab-window-B");
    assert.equal(tabCReceivedRefreshes[1].leaseFencingTerm, 2);

    unsubscribeB();
    unsubscribeC();
    tabA.dispose();
    tabB.dispose();
    tabC.dispose();
  });
});
