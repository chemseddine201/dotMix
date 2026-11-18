/**
 * @dotmix/runtime/client — module declarations for dotMix application code.
 *
 * Reference it once from a declaration file in the project (created by `mix create --ts`):
 *
 *   // src/env.d.ts
 *   /// <reference types="@dotmix/runtime/client" />
 *
 * TypeScript then accepts imports of .tix/.mix components and side-effect imports of style
 * files in .ts modules. With the dotMix editor extension installed, its TypeScript plugin
 * resolves component imports to the real files, which enables go-to-definition.
 */

declare module "*.tix" {
  const component: (props: Record<string, unknown>) => Node | readonly Node[];
  export default component;
}

declare module "*.mix" {
  const component: (props: Record<string, unknown>) => Node | readonly Node[];
  export default component;
}

// Stylesheets are imported for their side effect only: `import "./App.css";`
declare module "*.css" {}
declare module "*.scss" {}
declare module "*.sass" {}
declare module "*.less" {}
declare module "*.pcss" {}

interface ImportMetaEnv {
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly [key: `MIX_PUBLIC_${string}`]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface HmrAppliedDetail {
  /** The module that was swapped, as the dev server names it (same value as `mix:hmr-update`). */
  readonly moduleId: string;
  /** Top-level nodes inserted for every swapped instance, in document order. */
  readonly nodes: readonly Node[];
}

interface HmrUpdateDetail {
  readonly type: "update";
  readonly file: string;
  readonly timestamp: number;
  readonly cssUpdated: boolean;
  readonly kind?: "js" | "css";
  readonly cssContent?: string;
  readonly seq?: number;
}

interface WindowEventMap {
  "mix:hmr-applied": CustomEvent<HmrAppliedDetail>;
  "mix:hmr-update": CustomEvent<HmrUpdateDetail>;
}
