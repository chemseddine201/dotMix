/**
 * @mix/runtime/permissions — Native RBAC + ABAC Permissions Engine for Mix/Tix
 *
 * Implements isomorphic permission checks with fine-grained signal reactivity,
 * signal-aware condition tracking, async cancellation, and field-level permissions.
 *
 * @security Defense-in-Depth Callout:
 * Client-side permission rules and the `<Can>` component govern UI element visibility
 * and interactive workflows only. All sensitive data mutations, API endpoints, and
 * backend queries MUST be authoritatively verified by your backend server.
 */

export * from "./types.js";
export * from "./ability.js";
export * from "./context.js";
export * from "./Can.js";

