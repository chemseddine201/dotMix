/**
 * @dotmix/compiler-ssr/types — SSR compilation options and result interfaces.
 */

import type { SourceMapV3 } from "@dotmix/compiler-semantic";

export interface SsrOptions {
  includeHydrationMarkers?: boolean | undefined;
  scopeHash?: string | undefined;
  mode?: "development" | "production" | string | undefined;
  filename?: string | undefined;
  source?: string | undefined;
  sourceMap?: boolean | undefined;
}

export interface SsrCompilationResult {
  code: string;
  css: string;
  readonly map?: SourceMapV3 | undefined;
  readonly hydrationMeta?: {
    readonly isInteractive: boolean;
    readonly islandSpecifiers: readonly string[];
  } | undefined;
}
