/**
 * @mix/runtime/permissions — <Can> Permission Gate Component
 *
 * Provides declarative, zero-VDOM fine-grained DOM gating based on RBAC + ABAC abilities.
 */

import { createMemo } from "../core/index.js";
import { useAbility } from "./context.js";
import type { Ability, Action } from "./types.js";

export interface CanProps {
  I: Action;
  a?: string | undefined;
  an?: string | undefined;
  this?: unknown;
  field?: string | undefined;
  not?: boolean | undefined;
  ability?: Ability | undefined;
  fallback?: unknown;
  children?: unknown;
}

/**
 * Declarative component that gates UI based on whether the active user ability
 * permits an action on a subject.
 *
 * Example:
 * ```tsx
 * <Can I="update" this={article} fallback={<p>Read only</p>}>
 *   <button @click={save}>Save</button>
 * </Can>
 * ```
 */
export function Can(props: CanProps): unknown {
  const contextAbility = useAbility();
  const ability = props.ability ?? contextAbility;

  const isAllowed = createMemo(() => {
    let target: unknown = props.this ?? props.a ?? props.an ?? "all";
    if (typeof target === "function") {
      target = (target as () => unknown)();
    }
    const hasPermission = ability.can(props.I, (target ?? "all") as object, props.field);
    return props.not ? !hasPermission : hasPermission;
  });

  if (typeof props.children === "function") {
    return (props.children as (allowed: boolean) => unknown)(isAllowed());
  }

  return isAllowed() ? props.children : (props.fallback ?? null);
}
