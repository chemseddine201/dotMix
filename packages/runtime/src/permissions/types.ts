/**
 * @mix/runtime/permissions — Types and interfaces for native RBAC + ABAC permission engine.
 */

import type { CancellationToken } from "../core/index.js";

export type Action = "create" | "read" | "update" | "delete" | "manage" | (string & {});
export type Subject = string | object;

export type RulePredicate<T = unknown> = (
  subject: T,
  context: AbilityContext
) => boolean | Promise<boolean>;

export interface Rule<A extends string = Action, S = Subject> {
  readonly action: A | A[];
  readonly subject: string;
  readonly fields?: readonly string[] | undefined;
  readonly conditions?: RulePredicate<S> | Record<string, unknown> | undefined;
  readonly inverted?: boolean | undefined; // true for `cannot`, false for `can`
  readonly reason?: string | undefined;
}

export interface AbilityContext {
  readonly user?: unknown;
  readonly roles?: readonly string[] | undefined;
  [key: string]: unknown;
}

export interface AbilityOptions {
  detectSubjectType?: ((subject: unknown) => string) | undefined;
}

export interface Ability<A extends string = Action, S extends string = string> {
  can(action: A, subject: S | object, field?: string): boolean;
  cannot(action: A, subject: S | object, field?: string): boolean;
  canAsync(
    action: A,
    subject: S | object,
    field?: string,
    token?: CancellationToken
  ): Promise<boolean>;
  readonly rules: () => readonly Rule[];
  update(rules: readonly Rule[]): void;
  on(event: "update", listener: (rules: readonly Rule[]) => void): () => void;
  relevantRuleFor(action: A, subject: S | object, field?: string): Rule | undefined;
}

export type CanRuleFn<A extends string = Action> = (
  action: A | A[],
  subject: string | string[],
  conditionsOrFields?:
    | RulePredicate<unknown>
    | Record<string, unknown>
    | readonly string[]
    | string,
  conditions?: RulePredicate<unknown> | Record<string, unknown>
) => void;

export type CannotRuleFn<A extends string = Action> = (
  action: A | A[],
  subject: string | string[],
  conditionsOrFields?:
    | RulePredicate<unknown>
    | Record<string, unknown>
    | readonly string[]
    | string,
  conditions?: RulePredicate<unknown> | Record<string, unknown>
) => void;

export type DefineAbilityCallback<A extends string = Action> = (
  can: CanRuleFn<A>,
  cannot: CannotRuleFn<A>
) => void;
