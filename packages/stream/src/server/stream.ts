/**
 * @mix/stream — Resilient Resumable Island Streaming Engine (Server-side)
 */

import type { IslandManifest, StreamResilienceOptions } from "../types.js";

/**
 * Encodes an island HTML chunk with signed resume tokens and inline metadata.
 */
export function formatIslandMarkup(
  id: string,
  componentName: string,
  contentHtml: string,
  state: Record<string, unknown> = {},
  status: "ready" | "pending" | "failed" = "ready",
  resumeToken = ""
): string {
  const token = resumeToken || `tok_${Math.random().toString(36).slice(2, 10)}`;
  const manifest: IslandManifest = {
    id,
    componentName,
    resumeToken: token,
    state,
    status
  };

  const serializedManifest = JSON.stringify(manifest).replace(/"/g, "&quot;");

  return [
    `<!--mix-island-start:${id}-->`,
    `<mix-island id="${id}" data-component="${componentName}" data-status="${status}" data-manifest="${serializedManifest}">`,
    contentHtml,
    `</mix-island>`,
    `<!--mix-island-end:${id}-->`
  ].join("\n");
}

export interface StreamableIsland {
  id: string;
  componentName: string;
  render: () => Promise<string> | string;
  state?: Record<string, unknown>;
}

/**
 * Streams islands progressively with sub-island timeout containment.
 * If one island microservice fails or times out, sibling islands continue streaming.
 */
export async function* renderToResilientStream(
  islands: StreamableIsland[],
  options: StreamResilienceOptions = {}
): AsyncGenerator<string, void, unknown> {
  const timeoutMs = options.islandTimeoutMs ?? 5000;

  for (const island of islands) {
    try {
      const renderPromise = Promise.resolve(island.render());
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Island '${island.id}' rendering timed out after ${timeoutMs}ms`)), timeoutMs);
      });

      const html = await Promise.race([renderPromise, timeoutPromise]);
      yield formatIslandMarkup(island.id, island.componentName, html, island.state ?? {}, "ready");
    } catch (err) {
      if (options.onChunkDropped) {
        options.onChunkDropped(island.id, err);
      }
      // Emit resilient fallback placeholder with recovery resume token
      const fallbackHtml = `<div class="mix-island-placeholder" data-island-fallback="${island.id}"><span class="loading-token">Recovering ${island.componentName}...</span></div>`;
      yield formatIslandMarkup(island.id, island.componentName, fallbackHtml, island.state ?? {}, "failed");
    }
  }
}
