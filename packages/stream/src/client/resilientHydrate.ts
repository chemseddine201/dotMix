/**
 * @mix/stream — Client-side Resilient Progressive Hydration Engine
 */

import { mount, type MountedComponent } from "@mix/runtime";
import type { HydrateResult, IslandManifest, StreamResilienceOptions } from "../types.js";

export type ComponentRegistry = Record<
  string,
  (props?: Record<string, unknown>) => Node | readonly Node[] | DocumentFragment
>;

/**
 * Parses island manifest encoded in data-manifest attribute.
 */
export function parseIslandManifest(element: Element): IslandManifest | null {
  const raw = element.getAttribute("data-manifest");
  if (!raw) return null;
  try {
    const unescaped = raw.replace(/&quot;/g, '"');
    return JSON.parse(unescaped) as IslandManifest;
  } catch {
    return null;
  }
}

/**
 * Progressively hydrates streamed islands on the client with autonomous dropout recovery.
 */
export async function resilientHydrate(
  root: Element | Document = typeof document !== "undefined" ? document : (null as unknown as Document),
  registry: ComponentRegistry,
  options: StreamResilienceOptions = {}
): Promise<HydrateResult> {
  if (!root) {
    return { islandCount: 0, recoveredCount: 0, unmountAll: () => {} };
  }

  const islandElements = Array.from(root.querySelectorAll("mix-island"));
  const handles: MountedComponent[] = [];
  let recoveredCount = 0;

  for (const el of islandElements) {
    const manifest = parseIslandManifest(el);
    const componentName = el.getAttribute("data-component") || manifest?.componentName;
    const status = el.getAttribute("data-status") || manifest?.status;

    if (!componentName) continue;
    const Component = registry[componentName];
    if (!Component) continue;

    if (status === "failed") {
      // Chunk dropped during streaming! Trigger autonomous sub-island recovery
      const endpoint = options.recoveryEndpoint ?? "/_mix_chunk";
      try {
        const resumeToken = manifest?.resumeToken ?? "";
        const url = `${endpoint}?island=${encodeURIComponent(manifest?.id ?? "")}&resumeToken=${encodeURIComponent(resumeToken)}`;

        let recoveredHtml = "";
        if (typeof fetch === "function") {
          const res = await fetch(url);
          if (res.ok) {
            recoveredHtml = await res.text();
          }
        }

        if (recoveredHtml) {
          el.innerHTML = recoveredHtml;
          el.setAttribute("data-status", "ready");
          recoveredCount++;
        }
      } catch (e) {
        if (options.onChunkDropped) {
          options.onChunkDropped(manifest?.id ?? "", e);
        }
      }
    }

    // Clear SSR placeholder nodes and mount live interactive component
    el.innerHTML = "";
    const props = manifest?.state ?? {};
    const handle = mount(() => Component(props), el as HTMLElement);
    handles.push(handle);
  }

  return {
    islandCount: islandElements.length,
    recoveredCount,
    unmountAll() {
      for (const h of handles) {
        h.unmount();
      }
    }
  };
}
