/**
 * @mix/stream — Types for Resilient Progressive Streaming & Partial Hydration (Gate 18 / D-121)
 */

export interface IslandManifest {
  readonly id: string;
  readonly componentName: string;
  readonly resumeToken: string;
  readonly state: Record<string, unknown>;
  readonly status: "ready" | "pending" | "failed";
}

export interface StreamResilienceOptions {
  readonly islandTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly recoveryEndpoint?: string;
  readonly onChunkDropped?: (islandId: string, error: unknown) => void;
}

export interface IslandChunk {
  readonly id: string;
  readonly html: string;
  readonly manifest: IslandManifest;
}

export interface HydrateResult {
  readonly islandCount: number;
  readonly recoveredCount: number;
  readonly unmountAll: () => void;
}

