/**
 * @dotmix/runtime/permissions — Additional permission gate components (<ElseCan>, <Cannot>, <CanAny>).
 */

import { createMemo } from "../core/index.js";
import { createConditional } from "../dom/index.js";
import { DiagnosticCodes, MixError } from "../errors.js";
import { Can } from "./Can.js";
import { useAbility } from "./context.js";
import type { Ability, Action } from "./types.js";

export interface ElseCanProps {
  I: Action;
  this?: unknown;
  a?: string | undefined;
  an?: string | undefined;
  field?: string | undefined;
  children: unknown;
}

export interface CannotProps extends ElseCanProps {
  ability?: Ability | (() => Ability) | undefined;
  else?: unknown;
  fallback?: unknown;
  slots?: { default?: () => unknown; [key: string]: unknown } | undefined;
}

export interface CanAnyProps {
  I: readonly Action[];
  this?: unknown;
  a?: string | undefined;
  an?: string | undefined;
  field?: string | undefined;
  ability?: Ability | (() => Ability) | undefined;
  else?: unknown;
  fallback?: unknown;
  children: unknown;
}

function resolveBranchNodes(content: unknown): Node[] {
  if (content === null || content === undefined || typeof content === "boolean") {
    return [];
  }
  if (typeof content === "function") {
    return resolveBranchNodes((content as () => unknown)());
  }
  if (Array.isArray(content)) {
    const out: Node[] = [];
    for (const item of content) {
      out.push(...resolveBranchNodes(item));
    }
    return out;
  }
  if (typeof (content as { nodeType?: unknown })?.nodeType === "number") {
    const node = content as Node;
    if (node.nodeType === 11) {
      return Array.from((node as DocumentFragment).childNodes);
    }
    return [node];
  }
  return [document.createTextNode(String(content))];
}

function resolveBranchString(content: unknown): string {
  const resolvedContent = typeof content === "function" ? (content as () => unknown)() : content;
  if (resolvedContent === null || resolvedContent === undefined || typeof resolvedContent === "boolean") {
    return "";
  }
  if (Array.isArray(resolvedContent)) {
    return resolvedContent
      .map((item) => (item === null || item === undefined ? "" : String(item)))
      .join("");
  }
  return String(resolvedContent);
}

export function ElseCan(_props: ElseCanProps): unknown {
  throw new MixError(
    DiagnosticCodes.MIX_ERR_DIRECTIVE_NOT_COMPILED,
    "<ElseCan> is a branch marker inside <Can> and cannot be invoked standalone at runtime."
  );
}

export function Cannot(props: CannotProps): unknown {
  return Can({
    I: props.I,
    a: props.a,
    an: props.an,
    this: props.this,
    field: props.field,
    ability: props.ability,
    not: true,
    fallback: props.else !== undefined ? props.else : props.fallback,
    children: props.children,
    slots: props.slots
  });
}

Cannot.renderToString = function renderCannotToString(props: CannotProps): string {
  return Can.renderToString({
    I: props.I,
    a: props.a,
    an: props.an,
    this: props.this,
    field: props.field,
    ability: props.ability,
    not: true,
    fallback: props.else !== undefined ? props.else : props.fallback,
    children: props.children,
    slots: props.slots
  });
};

function checkCanAny(props: CanAnyProps, contextAbility: Ability): boolean {
  const rawAbility = props.ability ?? contextAbility;
  const activeAbility =
    typeof rawAbility === "function" ? (rawAbility as () => Ability)() : rawAbility;
  let target: unknown = props.this ?? props.a ?? props.an ?? "all";
  if (typeof target === "function") {
    target = (target as () => unknown)();
  }
  const subj = (target ?? "all") as object;
  for (let i = 0; i < props.I.length; i++) {
    if (activeAbility.can(props.I[i]!, subj, props.field)) {
      return true;
    }
  }
  return false;
}

export function CanAny(props: CanAnyProps): unknown {
  const contextAbility = useAbility();
  const isAllowed = createMemo(() => checkCanAny(props, contextAbility));
  const alt = props.else !== undefined ? props.else : props.fallback;

  if (typeof document !== "undefined" && typeof document.createDocumentFragment === "function") {
    const fragment = document.createDocumentFragment();
    createConditional(
      fragment,
      [
        {
          condition: isAllowed,
          render: () => resolveBranchNodes(props.children)
        }
      ],
      alt !== undefined ? () => resolveBranchNodes(alt) : null
    );
    return fragment;
  }

  if (isAllowed()) {
    return typeof props.children === "function"
      ? (props.children as () => unknown)()
      : props.children;
  }

  return typeof alt === "function" ? (alt as () => unknown)() : (alt ?? null);
}

CanAny.renderToString = function renderCanAnyToString(props: CanAnyProps): string {
  const allowed = checkCanAny(props, useAbility());
  const alt = props.else !== undefined ? props.else : props.fallback;
  return allowed ? resolveBranchString(props.children) : resolveBranchString(alt);
};
