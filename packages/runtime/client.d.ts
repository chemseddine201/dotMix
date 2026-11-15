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
