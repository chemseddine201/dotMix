/**
 * @dotmix/runtime/dom/hot — Dev-Only HMR Runtime Instance Registry & Transactional State Transfer
 *
 * Implements H-1, H-7, D-151, D-153, D-155:
 * - Module-keyed instance registry with composite keys across parent-child trees
 * - DOM instance boundaries using start & end comment markers (reusing KeepAlive boundary primitive)
 * - State transfer store carrying over signal values by identifier key across re-instantiations
 * - Transactional off-DOM render: exceptions in new setup code abort swap and preserve prior DOM/state
 * - Disposal of old reactive owner only after successful DOM swap
 */

import {
  createRoot,
  getCurrentOwner,
  withComponentProps,
  type Owner
} from "../../core/index.js";
import { normalizeToNodeArray } from "../nodes.js";

export type HmrComponentFn = (props: Record<string, unknown>) => Node | readonly Node[];

interface WindowWithMixOverlay {
  __mix_show_error?: (err: { message: string; frame?: string }) => void;
  __mix_clear_error?: () => void;
}

export interface HmrInstanceRecord {
  readonly instanceKey: string;
  readonly moduleId: string;
  ComponentFn: HmrComponentFn;
  props: Record<string, unknown>;
  startMarker: Comment;
  endMarker: Comment;
  owner: Owner | null;
  dispose: () => void;
  signalGetters: Map<string, () => unknown>;
}

// Global dev-only state registries
const instanceRegistry = new Map<string, Set<HmrInstanceRecord>>(); // moduleId -> Set<HmrInstanceRecord>
const stateTransferStore = new Map<string, Map<string, unknown>>(); // instanceKey -> (signalName -> value)
const liveGettersStore = new Map<string, Map<string, () => unknown>>();

let activeInstanceKey = "";
let instanceCounter = 0;

export function getActiveInstanceKey(): string {
  return activeInstanceKey;
}

export function setActiveInstanceKey(key: string): void {
  activeInstanceKey = key;
}

/**
 * Seeds a declared signal's initial value from the state-transfer store if present.
 */
export function hmrSeedSignal<T>(
  instanceKey: string,
  signalName: string,
  initialValue: T
): T {
  const getters = liveGettersStore.get(instanceKey);
  if (getters && getters.has(signalName)) {
    try {
      const liveVal = getters.get(signalName)!();
      if (liveVal !== undefined) {
        return liveVal as T;
      }
    } catch { /* ignore getter error */ }
  }
  const store = stateTransferStore.get(instanceKey);
  if (store && store.has(signalName)) {
    return store.get(signalName) as T;
  }
  return initialValue;
}

/**
 * Registers a live signal getter for state preservation across swaps.
 */
export function hmrTrackSignal(
  instanceKey: string,
  signalName: string,
  getter: () => unknown
): void {
  let getters = liveGettersStore.get(instanceKey);
  if (!getters) {
    getters = new Map();
    liveGettersStore.set(instanceKey, getters);
  }
  getters.set(signalName, getter);

  // Also update transfer store immediately
  let store = stateTransferStore.get(instanceKey);
  if (!store) {
    store = new Map();
    stateTransferStore.set(instanceKey, store);
  }
  try {
    store.set(signalName, getter());
  } catch { /* ignore initial getter error */ }
}

export function registerHmrInstance(
  moduleId: string,
  ComponentFn: HmrComponentFn,
  props: Record<string, unknown>,
  startMarker: Comment,
  endMarker: Comment,
  owner: Owner | null,
  dispose: () => void,
  instanceKey: string
): HmrInstanceRecord {
  const record: HmrInstanceRecord = {
    instanceKey,
    moduleId,
    ComponentFn,
    props,
    startMarker,
    endMarker,
    owner,
    dispose,
    signalGetters: liveGettersStore.get(instanceKey) ?? new Map()
  };

  let set = instanceRegistry.get(moduleId);
  if (!set) {
    set = new Set();
    instanceRegistry.set(moduleId, set);
  }
  set.add(record);
  return record;
}

export function unregisterHmrInstance(record: HmrInstanceRecord): void {
  const set = instanceRegistry.get(record.moduleId);
  if (set) {
    set.delete(record);
  }
}

export function generateInstanceKey(moduleId: string, props?: Record<string, unknown>): string {
  const parentKey = activeInstanceKey;
  const localKey = (props?.key ?? props?.name ?? props?.id ?? ++instanceCounter) as string | number;
  if (parentKey) {
    return `${parentKey}::${moduleId}#${String(localKey)}`;
  }
  return `${moduleId}#${String(localKey)}`;
}

function removeNodesBetween(startMarker: Comment, endMarker: Comment): void {
  const p = startMarker.parentNode;
  if (!p) return;
  let curr: Node | null = startMarker.nextSibling;
  while (curr && curr !== endMarker) {
    const next: Node | null = curr.nextSibling;
    p.removeChild(curr);
    curr = next;
  }
}

/**
 * Executes a transactional hot swap for all mounted instances of moduleId.
 * If newComponentFn throws during setup, the swap is aborted and old state is kept (D-155 / E6).
 */
export function hmrSwapComponent(
  moduleId: string,
  newComponentFn: HmrComponentFn
): boolean {
  const instances = instanceRegistry.get(moduleId);
  if (!instances || instances.size === 0) {
    return true;
  }

  for (const instance of Array.from(instances)) {
    // 1. Snapshot live signal values into transfer store
    let store = stateTransferStore.get(instance.instanceKey);
    if (!store) {
      store = new Map();
      stateTransferStore.set(instance.instanceKey, store);
    }
    const getters = liveGettersStore.get(instance.instanceKey) ?? instance.signalGetters;
    for (const [name, getter] of getters.entries()) {
      try {
        store.set(name, getter());
      } catch { /* ignore live getter snapshot error */ }
    }

    // 2. Off-DOM transactional render attempt
    let newDispose: (() => void) | null = null;
    let newOwner: Owner | null = null;
    let newNodes: Node[] = [];

    const prevKey = activeInstanceKey;
    activeInstanceKey = instance.instanceKey;
    // The new instance must see the same contexts (router, auth, theme...) as the one it replaces,
    // so it is rendered under the same context parent the first mount used.
    const contextOwner = instance.owner ? instance.owner.contextParent : null;

    try {
      createRoot((dispose) => {
        newDispose = dispose;
        newOwner = getCurrentOwner();
        newNodes = normalizeToNodeArray(
          withComponentProps(instance.props, () => newComponentFn(instance.props))
        );
      }, contextOwner);
    } catch (err: unknown) {
      activeInstanceKey = prevKey;
      if (newDispose) {
        try { (newDispose as () => void)(); } catch { /* ignore failed dispose */ }
      }
      showErrorOverlay(err);
      return false;
    } finally {
      activeInstanceKey = prevKey;
    }

    // 3. Swap DOM between markers
    const p = instance.startMarker.parentNode;
    if (p) {
      removeNodesBetween(instance.startMarker, instance.endMarker);
      for (const node of newNodes) {
        p.insertBefore(node, instance.endMarker);
      }
    }

    // 4. Dispose old owner
    const oldDispose = instance.dispose;
    try {
      oldDispose();
    } catch { /* ignore old dispose */ }

    // 5. Update instance record
    instance.ComponentFn = newComponentFn;
    instance.owner = newOwner;
    instance.dispose = newDispose ?? (() => {});
  }

  clearErrorOverlay();
  return true;
}

function showErrorOverlay(err: unknown): void {
  if (typeof document === "undefined") return;
  const msg = err instanceof Error ? err.message : String(err);
  const win = typeof window !== "undefined" ? (window as unknown as WindowWithMixOverlay) : undefined;
  if (win && typeof win.__mix_show_error === "function") {
    win.__mix_show_error({ message: msg, frame: msg });
    return;
  }
  let overlay = document.querySelector("mix-error-overlay");
  if (!overlay) {
    overlay = document.createElement("mix-error-overlay");
    overlay.setAttribute("id", "mix-error-overlay");
    const shadow = overlay.attachShadow({ mode: "open" });
    const pre = document.createElement("pre");
    pre.className = "error-message";
    shadow.appendChild(pre);
    document.body?.appendChild(overlay);
  }
  overlay.textContent = `[Mix Runtime Error] ${msg}`;
  const pre = overlay.shadowRoot?.querySelector("pre");
  if (pre) pre.textContent = msg;
}

function clearErrorOverlay(): void {
  if (typeof document === "undefined") return;
  const win = typeof window !== "undefined" ? (window as unknown as WindowWithMixOverlay) : undefined;
  if (win && typeof win.__mix_clear_error === "function") {
    win.__mix_clear_error();
    return;
  }
  const overlay = document.querySelector("mix-error-overlay");
  if (overlay) {
    overlay.remove();
  }
}
