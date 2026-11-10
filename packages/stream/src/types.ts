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

export interface WebSsrStyleSheet {
  readonly id: string;
  readonly css: string;
}

export type WebSsrRenderResult =
  | string
  | Promise<string>
  | AsyncIterable<string>
  | Iterable<string>;

export interface WebSsrRenderContext {
  readonly request: Request;
  readonly url: string;
  readonly nonce: string;
}

export interface WebSsrOptions {
  title?: string | undefined;
  styles?: readonly WebSsrStyleSheet[] | undefined;
  state?: unknown;
  getNonce?: ((request: Request) => string) | undefined;
  render: (ctx: WebSsrRenderContext) => WebSsrRenderResult;
  errorFallback?: ((error: unknown, ctx: WebSsrRenderContext) => string) | undefined;
  onError?: ((error: unknown, ctx: WebSsrRenderContext) => void) | undefined;
}


