/**
 * @mix/compiler-codegen — Ahead-of-Time direct DOM JavaScript code generator (Phase Gate 5).
 *
 * Compiles a validated `ComponentDescriptor` into readable, deterministic ES2023 JavaScript
 * that binds fine-grained reactive primitives directly to surgical DOM operations with
 * zero Virtual DOM overhead.
 */

export * from "./types.js";
export * from "./context.js";
export * from "./emit-elements.js";
export * from "./emit-blocks.js";
export * from "./generator.js";
