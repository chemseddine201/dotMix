/**
 * @dotmix/compiler-ssr/types — SSR compilation options and result interfaces.
 */

export interface SsrOptions {
  includeHydrationMarkers?: boolean | undefined;
  scopeHash?: string | undefined;
  mode?: "development" | "production" | string | undefined;
}

export interface SsrCompilationResult {
  code: string;
  css: string;
  readonly hydrationMeta?: {
    readonly isInteractive: boolean;
    readonly islandSpecifiers: readonly string[];
  } | undefined;
}
