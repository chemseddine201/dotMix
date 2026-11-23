# Decision Proposal D-186: Optional Image Optimization Package (`@dotmix/image`) (P5)

**Status:** PROPOSED (Gate 39, Phase A — addresses Gap G6)  
**Target Packages:** `@dotmix/image` (new optional package `packages/image`), `@dotmix/cli` (optional build integration)  
**Related Decisions:** `D-107` (WHATWG `srcset` security), `D-159` (Zero-dependency CLI), `AGENTS.md` §6 (`@dotmix/runtime` zero deps)  

---

## 1. Problem Statement

**Gap G6:** dotMix has no built-in responsive image component or build-time optimization pipeline for AVIF/WebP generation, responsive `srcset` candidates, guaranteed intrinsic `width`/`height` attributes (`CLS = 0`), `loading`/`decoding`/`fetchpriority` forwarding, or offline/zero-network placeholder boxes for sites whose final photography is not yet supplied.

---

## 2. Options Considered

- **Option A:** Add `sharp` directly to `@dotmix/runtime` or `@dotmix/cli`.  
  *Rejected:* Violates `AGENTS.md` §6 (`@dotmix/runtime` must have 0 dependencies) and `D-159` (`@dotmix/cli` has 0 external dependencies).
- **Option B (Chosen):** Introduce a new optional workspace package `@dotmix/image` (`packages/image`) depending only on `@dotmix/runtime` (for DOM/security primitives), with `sharp` declared exclusively as an **optional `peerDependency`**.
  - `<Picture>` works in both SSR/Node SSG (`renderToString`) and client DOM/hydration without `sharp`.
  - When `placeholder` mode is enabled (or `placeholder="box"`), `<Picture>` renders a fixed aspect-ratio box with **zero network requests** and `CLS = 0`.
  - `@dotmix/image/build` (invoked by `mix build` via dynamic optional import when `@dotmix/image` is used, or standalone) processes local source images into AVIF, WebP, and fallback formats at configured widths using `sharp`, emitting `dist/mix-image-manifest.json`.
- **Option C:** Rely purely on raw `<img>` tags with manual `srcset`.  
  *Rejected:* No build-time AVIF/WebP generation, easy to omit `width`/`height` (causing CLS), and no built-in placeholder mode.

---

## 3. Why This Design

- Strictly preserves zero external dependencies in `@dotmix/runtime` and `@dotmix/cli`.
- Validates all generated `src` and `srcset` strings through `@dotmix/runtime/security` (`D-107`).
- Guarantees `CLS = 0` by always emitting explicit `width` and `height` (or CSS `aspect-ratio: width / height` on placeholders).
- Allows marketing sites (like `vitedz-web`) to ship immediately with `<Picture placeholder ... />` achieving Performance ≥ 95 and CLS = 0 before real images arrive, and upgrade seamlessly to AVIF/WebP when `sharp` + images are added.

---

## 4. Public API (Exact Signatures)

### 4.1 `@dotmix/image` (`packages/image/src/index.ts`)

```ts
export type ImageFormat = "avif" | "webp" | "jpeg" | "png";

export interface PictureProps {
  readonly src: string;
  readonly alt: string;
  readonly width: number;
  readonly height: number;
  readonly widths?: readonly number[] | undefined; // default: [400, 800, 1200, 1600]
  readonly formats?: readonly ImageFormat[] | undefined; // default: ["avif", "webp", "jpeg"]
  readonly sizes?: string | undefined; // default: "100vw"
  readonly loading?: "lazy" | "eager" | undefined; // default: "lazy"
  readonly decoding?: "async" | "sync" | "auto" | undefined; // default: "async"
  readonly fetchpriority?: "high" | "low" | "auto" | undefined;
  readonly placeholder?: boolean | "box" | undefined;
  readonly class?: string | undefined;
  readonly style?: string | Readonly<Record<string, string>> | undefined;
}

export interface ImageBuildManifestEntry {
  readonly src: string;
  readonly intrinsicWidth: number;
  readonly intrinsicHeight: number;
  readonly sources: readonly {
    readonly format: ImageFormat;
    readonly type: string;
    readonly srcset: string;
  }[];
  readonly fallbackSrc: string;
}

export type ImageBuildManifest = Readonly<Record<string, ImageBuildManifestEntry>>;

export function Picture(props: PictureProps): Node | string;
export function setImageManifest(manifest: ImageBuildManifest): void;
```

### 4.2 `@dotmix/image/build` (`packages/image/src/build.ts`)

```ts
export interface OptimizeImagesOptions {
  readonly projectDirectory: string;
  readonly outDir: string;
  readonly basePath?: string | undefined;
  readonly widths?: readonly number[] | undefined;
  readonly formats?: readonly ImageFormat[] | undefined;
  readonly quality?: number | undefined; // default: 80
  readonly cacheDir?: string | undefined;
}

export function optimizeProjectImages(
  inputs: readonly { readonly src: string; readonly widths?: readonly number[] | undefined; readonly formats?: readonly ImageFormat[] | undefined }[],
  options: OptimizeImagesOptions
): Promise<ImageBuildManifest>;
```

### Rendering Rules
- **Placeholder mode (`props.placeholder === true || props.placeholder === "box"`):** Emits `<div class="mix-picture-placeholder ..." role="img" aria-label="..." data-mix-placeholder="true" style="aspect-ratio: <width> / <height>; width: 100%; max-width: <width>px;">` with **no `<img>` or `<source>` tags**, causing **zero network requests** and **zero layout shift**.
- **Image mode:** Emits `<picture>` with `<source type="image/avif" srcset="..." sizes="..." />`, `<source type="image/webp" srcset="..." sizes="..." />`, and `<img src="..." srcset="..." width="<width>" height="<height>" alt="<alt>" loading="..." decoding="..." fetchpriority="..." />`.

---

## 5. Verification Tests (Phase B)

1. **Zero-Dependency Guard Test:** Verify `@dotmix/runtime/package.json` has `"dependencies": {}`, `@dotmix/cli/package.json` has no `sharp` dependency, and `@dotmix/image` works in placeholder mode and pre-manifest mode when `sharp` is absent.
2. **Placeholder Zero-Network & Aspect Ratio Test (`tests/image/picture.test.mjs`):** Render `<Picture src="/hero.jpg" alt="Hero" width={1200} height={800} placeholder />` in both SSR and real Chrome CDP; assert zero network requests for `/hero.jpg`, `role="img"`, `aria-label="Hero"`, and `aspect-ratio: 1200 / 800`.
3. **Manifest & `srcset` Security Test:** Populate `setImageManifest(...)` with AVIF + WebP + JPEG candidates; assert SSR and DOM output emit `<picture>` with `<source type="image/avif">`, `<source type="image/webp">`, intrinsic `width`/`height`, `fetchpriority="high"`, and reject unsafe `javascript:` URLs via `D-107`.
4. **Build Pipeline Test (when `sharp` is present, skipped cleanly with notice if absent):** Generate AVIF/WebP variants into a temp `dist/assets/img/` directory and verify `mix-image-manifest.json`.

