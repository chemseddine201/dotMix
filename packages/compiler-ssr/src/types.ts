/**
 * @mix/compiler-ssr/types — SSR compilation options and result interfaces.
 */

export interface SsrOptions {
  includeHydrationMarkers?: boolean | undefined;
  scopeHash?: string | undefined;
}

export interface SsrCompilationResult {
  code: string;
  css: string;
}
