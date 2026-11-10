/**
 * @mix/runtime/permissions — Permission Context & Provider
 */

import {
  createContext,
  setContext,
  getContext,
  type Context,
  type Signal
} from "../core/index.js";
import { createAbility } from "./ability.js";
import type { Ability, Action } from "./types.js";

export type AbilityInput<A extends string = Action> =
  | Ability<A>
  | Signal<Ability<A>>
  | (() => Ability<A>);

export const PermissionContext: Context<AbilityInput | null> =
  createContext<AbilityInput | null>(null);

const DEFAULT_GUEST_ABILITY = createAbility([]);
const abilityProxyCache = new WeakMap<object, Ability<any>>();

/**
 * Hook to retrieve the active Ability from context.
 * If the provided ability is a reactive Signal or function, this returns a memoized
 * reactive proxy that forwards all checks to the active instance while tracking signal dependencies.
 */
export function useAbility<A extends string = Action>(): Ability<A> {
  const ctx = getContext(PermissionContext);
  if (!ctx) {
    return DEFAULT_GUEST_ABILITY as Ability<A>;
  }

  const key = ctx as unknown as object;
  const cached = abilityProxyCache.get(key);
  if (cached) {
    return cached as Ability<A>;
  }

  const resolve = (): Ability<A> => {
    if (typeof ctx === "function") {
      return (ctx as () => Ability<A>)();
    }
    return ctx as Ability<A>;
  };

  // Return reactive proxy forwarding calls to the active ability
  const proxy: Ability<A> = {
    can(action, subject, field) {
      return resolve().can(action, subject, field);
    },
    cannot(action, subject, field) {
      return resolve().cannot(action, subject, field);
    },
    canAsync(action, subject, field, token) {
      return resolve().canAsync(action, subject, field, token);
    },
    rules() {
      return resolve().rules();
    },
    update(newRules) {
      resolve().update(newRules);
    },
    on(event, listener) {
      return resolve().on(event, listener);
    },
    relevantRuleFor(action, subject, field) {
      return resolve().relevantRuleFor(action, subject, field);
    }
  };

  abilityProxyCache.set(key, proxy);
  return proxy;
}

export interface PermissionProviderProps {
  ability: AbilityInput;
  children: unknown;
}

/**
 * Context Provider for application permissions.
 */
export function PermissionProvider(props: PermissionProviderProps): unknown {
  setContext(PermissionContext, props.ability);
  if (typeof props.children === "function") {
    return (props.children as () => unknown)();
  }
  return props.children;
}
