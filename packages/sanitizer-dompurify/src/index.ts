/**
 * @dotmix/sanitizer-dompurify — Official Production HTML Sanitizer Adapter for Mix & Tix (D-109 / HAA-03).
 *
 * Bridges DOMPurify (or an inert DOM-tree allowlist sanitizer when running in DOM environments)
 * into `@dotmix/runtime`'s `SanitizerProvider` authority without adding any dependencies to `@dotmix/runtime`.
 */

export * from "./allowlists.js";
export * from "./sanitizer.js";
