/**
 * @mix/runtime/permissions — <Can> Permission Gate Component
 *
 * Provides declarative, zero-VDOM fine-grained DOM gating based on RBAC + ABAC abilities.
 */

import { createMemo } from "../core/index.js";
import { createConditional } from "../dom/index.js";
import { useAbility } from "./context.js";
import type { Ability, Action } from "./types.js";

export interface CanProps {
  I: Action;
  a?: string | undefined;
  an?: string | undefined;
  this?: unknown;
  field?: string | undefined;
  not?: boolean | undefined;
  ability?: Ability | (() => Ability) | undefined;
  fallback?: unknown;
  children?: unknown;
  slots?: { default?: () => unknown; [key: string]: unknown } | undefined;
}

function resolveToDomNodes(content: unknown, allowed: boolean): Node[] {
  if (content === null || content === undefined || typeof content === "boolean") {
    return [];
  }
  if (typeof content === "function") {
    return resolveToDomNodes((content as (a: boolean) => unknown)(allowed), allowed);
  }
  if (Array.isArray(content)) {
    const out: Node[] = [];
    for (const item of content) {
      out.push(...resolveToDomNodes(item, allowed));
    }
    return out;
  }
  if (typeof (content as { nodeType?: unknown })?.nodeType === "number") {
    const node = content as Node;
    if (node.nodeType === 11 /* DocumentFragment */) {
      return Array.from((node as DocumentFragment).childNodes);
    }
    return [node];
  }
  return [document.createTextNode(String(content))];
}

/**
 * Declarative component that gates UI based on whether the active user ability
 * permits an action on a subject.
 *
 * In DOM environments, mounts on top of `createConditional` (`<!--mix:if-->`) so
 * ability and subject signal changes dynamically swap the DOM branch in place and
 * dispose the inactive branch's Owner.
 */
export function Can(props: CanProps): unknown {
  const contextAbility = useAbility();

  const isAllowed = createMemo(() => {
    const rawAbility = props.ability ?? contextAbility;
    const activeAbility =
      typeof rawAbility === "function" ? (rawAbility as () => Ability)() : rawAbility;
    let target: unknown = props.this ?? props.a ?? props.an ?? "all";
    if (typeof target === "function") {
      target = (target as () => unknown)();
    }
    const hasPermission = activeAbility.can(props.I, (target ?? "all") as object, props.field);
    return props.not ? !hasPermission : hasPermission;
  });

  const isRenderProp =
    typeof props.children === "function" &&
    props.children.length >= 1 &&
    props.slots?.default !== props.children;

  if (typeof document !== "undefined" && typeof document.createDocumentFragment === "function") {
    const fragment = document.createDocumentFragment();
    createConditional(
      fragment,
      [
        {
          condition: isAllowed,
          render: () => resolveToDomNodes(props.children, true)
        }
      ],
      () => resolveToDomNodes(isRenderProp ? props.children : props.fallback, false)
    );
    return fragment;
  }

  if (isRenderProp) {
    return (props.children as (allowed: boolean) => unknown)(isAllowed());
  }

  if (isAllowed()) {
    return typeof props.children === "function"
      ? (props.children as () => unknown)()
      : props.children;
  }

  return typeof props.fallback === "function"
    ? (props.fallback as () => unknown)()
    : (props.fallback ?? null);
}
