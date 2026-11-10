/**
 * @mix/runtime/permissions — Core Ability Engine
 *
 * Implements isomorphic RBAC + ABAC with fine-grained signal reactivity,
 * signal-aware condition tracking, async cancellation, and field-level permissions.
 */

import { signal, isSignal, type Signal, type CancellationToken } from "../core/index.js";
import { MixError, DiagnosticCodes } from "../errors.js";
import type {
  Action,
  Rule,
  RulePredicate,
  Ability,
  AbilityContext,
  AbilityOptions,
  CanRuleFn,
  CannotRuleFn,
  DefineAbilityCallback
} from "./types.js";

export const SUBJECT_TYPE_KEY = Symbol.for("@mix/subjectType");

export class ForbiddenError extends Error {
  readonly action: string;
  readonly subject: string;
  readonly field?: string | undefined;

  constructor(message: string, action: string, subject: string, field?: string) {
    super(message);
    this.name = "ForbiddenError";
    this.action = action;
    this.subject = subject;
    this.field = field;
  }
}

/**
 * Attaches subject type metadata to a plain JavaScript object.
 */
export function subject<T extends object>(type: string, obj: T): T {
  Object.defineProperty(obj, SUBJECT_TYPE_KEY, {
    value: type,
    writable: false,
    enumerable: false,
    configurable: true
  });
  return obj;
}

/**
 * Detects the subject type identifier from a string or object.
 */
export function detectSubjectType(
  subjectVal: unknown,
  options?: { strictSubjects?: boolean | undefined }
): string {
  if (typeof subjectVal === "string") {
    return subjectVal;
  }
  if (subjectVal && typeof subjectVal === "object") {
    const obj = subjectVal as Record<string | symbol, unknown>;
    if (obj[SUBJECT_TYPE_KEY]) {
      return String(obj[SUBJECT_TYPE_KEY]);
    }
    if (typeof obj.__subjectType === "string") {
      return obj.__subjectType;
    }
    if (typeof obj.__caslSubjectType__ === "string") {
      return obj.__caslSubjectType__;
    }
    if (typeof obj.modelName === "string") {
      return obj.modelName;
    }
    if (obj.constructor && obj.constructor.name && obj.constructor.name !== "Object") {
      if (options?.strictSubjects) {
        return "all";
      }
      console.warn(
        `[@mix/runtime/permissions] Implicit subject detection via constructor.name ("${obj.constructor.name}") is fragile under minification. Tag subjects explicitly with subject("${obj.constructor.name}", instance) or configure detectSubjectType / strictSubjects: true.`
      );
      return obj.constructor.name;
    }
  }
  return "all";
}

function matchesAction(ruleAction: Action | Action[], action: Action): boolean {
  if (ruleAction === "manage" || ruleAction === action) {
    return true;
  }
  if (Array.isArray(ruleAction)) {
    return ruleAction.includes("manage") || ruleAction.includes(action);
  }
  return false;
}

function matchesSubject(ruleSubject: string, subjectType: string): boolean {
  return ruleSubject === "all" || ruleSubject === subjectType;
}

function matchesField(rule: Rule, field?: string): boolean {
  if (!field) {
    return true;
  }
  if (!rule.fields || rule.fields.length === 0) {
    return true;
  }
  return rule.fields.includes(field);
}

function isThenable(val: unknown): boolean {
  return (
    val !== null &&
    (typeof val === "object" || typeof val === "function") &&
    typeof (val as { then?: unknown }).then === "function"
  );
}

function matchesConditionsSync(
  conditions: unknown,
  subjectVal: unknown,
  context: AbilityContext
): boolean {
  if (!conditions) {
    return true;
  }
  if (typeof conditions === "function") {
    const res = (conditions as (subj: unknown, ctx: AbilityContext) => unknown)(subjectVal, context);
    if (isThenable(res)) {
      throw new MixError(
        DiagnosticCodes.MIX_ERR_ASYNC_RULE_IN_SYNC_CHECK,
        "Asynchronous permission rule predicate cannot be evaluated synchronously in ability.can(). Use ability.canAsync() instead."
      );
    }
    return res === true;
  }
  if (typeof conditions === "object" && subjectVal && typeof subjectVal === "object") {
    const subj = subjectVal as Record<string, unknown>;
    const condObj = conditions as Record<string, unknown>;
    for (const key of Object.keys(condObj)) {
      let actual = subj[key];
      if (isSignal(actual)) {
        // Unwrap only branded reactive signals/computeds — never invoke arbitrary object methods
        actual = actual();
      }
      const expected = condObj[key];
      if (actual !== expected) {
        return false;
      }
    }
    return true;
  }
  return false;
}

async function matchesConditionsAsync(
  conditions: unknown,
  subjectVal: unknown,
  context: AbilityContext,
  token?: CancellationToken
): Promise<boolean> {
  if (!conditions) {
    return true;
  }
  token?.throwIfAborted();
  if (typeof conditions === "function") {
    const res = await (conditions as (subj: unknown, ctx: AbilityContext) => unknown)(subjectVal, context);
    token?.throwIfAborted();
    return res === true;
  }
  return matchesConditionsSync(conditions, subjectVal, context);
}


export class PureAbility<A extends string = Action, S extends string = string>
  implements Ability<A, S>
{
  private readonly _rules: Signal<readonly Rule[]>;
  private readonly _options: AbilityOptions;
  private readonly _listeners = new Set<(rules: readonly Rule[]) => void>();

  constructor(initialRules: readonly Rule[] = [], options: AbilityOptions = {}) {
    this._rules = signal<readonly Rule[]>(initialRules);
    this._options = options;
  }

  readonly rules = (): readonly Rule[] => {
    return this._rules();
  };

  update(newRules: readonly Rule[]): void {
    this._rules.set(newRules);
    for (const listener of this._listeners) {
      try {
        listener(newRules);
      } catch (err) {
        console.error("Ability update listener error:", err);
      }
    }
  }

  on(event: "update", listener: (rules: readonly Rule[]) => void): () => void {
    if (event === "update") {
      this._listeners.add(listener);
      return () => {
        this._listeners.delete(listener);
      };
    }
    return () => {};
  }

  private resolveSubjectType(subjectVal: S | object): string {
    if (this._options.detectSubjectType) {
      return this._options.detectSubjectType(subjectVal);
    }
    return detectSubjectType(subjectVal, this._options);
  }

  relevantRuleFor(action: A, subjectVal: S | object, field?: string): Rule | undefined {
    const currentRules = this._rules();
    const subjectType = this.resolveSubjectType(subjectVal);
    const context: AbilityContext = {};

    // Rules evaluated in reverse order (last matching rule wins)
    for (let i = currentRules.length - 1; i >= 0; i--) {
      const rule = currentRules[i]!;
      if (!matchesAction(rule.action as Action, action)) continue;
      if (!matchesSubject(rule.subject, subjectType)) continue;
      if (!matchesField(rule, field)) continue;
      if (matchesConditionsSync(rule.conditions, subjectVal, context)) {
        return rule;
      }
    }
    return undefined;
  }

  can(action: A, subjectVal: S | object, field?: string): boolean {
    const rule = this.relevantRuleFor(action, subjectVal, field);
    if (!rule) {
      return false;
    }
    return !rule.inverted;
  }

  cannot(action: A, subjectVal: S | object, field?: string): boolean {
    return !this.can(action, subjectVal, field);
  }

  async canAsync(
    action: A,
    subjectVal: S | object,
    field?: string,
    token?: CancellationToken
  ): Promise<boolean> {
    token?.throwIfAborted();
    const currentRules = this._rules();
    const subjectType = this.resolveSubjectType(subjectVal);
    const context: AbilityContext = {};

    for (let i = currentRules.length - 1; i >= 0; i--) {
      token?.throwIfAborted();
      const rule = currentRules[i]!;
      if (!matchesAction(rule.action as Action, action)) continue;
      if (!matchesSubject(rule.subject, subjectType)) continue;
      if (!matchesField(rule, field)) continue;

      const matched = await matchesConditionsAsync(rule.conditions, subjectVal, context, token);
      if (matched) {
        return !rule.inverted;
      }
    }
    return false;
  }
}

export class AbilityBuilder<A extends string = Action> {
  private readonly _rules: Rule[] = [];

  readonly can: CanRuleFn<A> = (
    action: A | A[],
    subjectInput: string | string[],
    conditionsOrFields?:
      | RulePredicate<unknown>
      | Record<string, unknown>
      | readonly string[]
      | string,
    conditions?: RulePredicate<unknown> | Record<string, unknown>
  ): void => {
    this.addRule(false, action, subjectInput, conditionsOrFields, conditions);
  };

  readonly cannot: CannotRuleFn<A> = (
    action: A | A[],
    subjectInput: string | string[],
    conditionsOrFields?:
      | RulePredicate<unknown>
      | Record<string, unknown>
      | readonly string[]
      | string,
    conditions?: RulePredicate<unknown> | Record<string, unknown>
  ): void => {
    this.addRule(true, action, subjectInput, conditionsOrFields, conditions);
  };

  private addRule(
    inverted: boolean,
    action: A | A[],
    subjectInput: string | string[],
    conditionsOrFields?:
      | RulePredicate<unknown>
      | Record<string, unknown>
      | readonly string[]
      | string,
    conditions?: RulePredicate<unknown> | Record<string, unknown>
  ): void {
    let fields: string[] | undefined;
    let actualConditions = conditions;

    if (Array.isArray(conditionsOrFields)) {
      fields = conditionsOrFields as string[];
    } else if (typeof conditionsOrFields === "string") {
      fields = [conditionsOrFields];
    } else if (conditionsOrFields !== undefined) {
      actualConditions = conditionsOrFields as RulePredicate<unknown> | Record<string, unknown>;
    }

    const subjects = Array.isArray(subjectInput) ? subjectInput : [subjectInput];
    for (const subj of subjects) {
      this._rules.push({
        action,
        subject: subj,
        inverted,
        ...(fields ? { fields } : {}),
        ...(actualConditions !== undefined ? { conditions: actualConditions } : {})
      });
    }
  }

  build(options?: AbilityOptions): Ability<A> {
    return new PureAbility<A>(this._rules, options);
  }
}

export function createAbility<A extends string = Action>(
  initialRules: readonly Rule[] = [],
  options?: AbilityOptions
): Ability<A> {
  return new PureAbility<A>(initialRules, options);
}

export function defineAbility<A extends string = Action>(
  defineFn: DefineAbilityCallback<A>,
  options?: AbilityOptions
): Ability<A> {
  const builder = new AbilityBuilder<A>();
  defineFn(builder.can, builder.cannot);
  return builder.build(options);
}
