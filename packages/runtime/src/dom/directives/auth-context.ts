/**
 * @dotmix/runtime/dom/directives/auth-context — F5, F6, F7.2 auth, permission & context helpers.
 */

import {
  createContext,
  createMemo,
  createRoot,
  getContext,
  getCurrentOwner,
  setContext,
  type Context as RuntimeContext
} from "../../core/index.js";
import { DiagnosticCodes, MixError } from "../../errors.js";
import { useAbility } from "../../permissions/context.js";
import type { Action } from "../../permissions/types.js";
import { createConditional } from "../control-flow.js";
import type {
  AuthCheckOptions,
  AuthContract,
  AuthGuards,
  AuthInstance,
  AuthProviderProps,
  GuardUser,
  RegisteredAuth
} from "./contract-types.js";

export const AuthContext: RuntimeContext<AuthInstance | null> =
  createContext<AuthInstance | null>(null);

function roleCheckUnsupported(): MixError {
  return new MixError(
    DiagnosticCodes.MIX_ERR_AUTH_ROLE_UNSUPPORTED,
    "Auth contract must provide `hasRole(user, role)` when role checks are used."
  );
}

export function createAuth<
  const TGuards extends AuthGuards,
  const TDefault extends keyof TGuards & string = "web" & keyof TGuards
>(contract: AuthContract<TGuards, TDefault>): AuthInstance<TGuards, TDefault> {
  type AnyGuardUser = GuardUser<TGuards, keyof TGuards>;
  const defaultGuard = (contract.defaultGuard ?? "web") as TDefault;
  const guards: AuthGuards = contract.guards;

  const readUser = (guard: string): unknown => {
    const guardFunction = guards[guard];
    if (!guardFunction) {
      return null;
    }
    return guardFunction();
  };

  const check = (guard: string = defaultGuard): boolean => {
    const current = readUser(guard);
    return current !== null && current !== undefined;
  };

  const hasRole = (user: AnyGuardUser, role: string): boolean => {
    if (!contract.hasRole) {
      throw roleCheckUnsupported();
    }
    return Boolean(contract.hasRole(user, role));
  };

  const hasAnyRole = (user: AnyGuardUser, roles: readonly string[]): boolean => {
    if (!contract.hasRole) {
      throw roleCheckUnsupported();
    }
    for (let roleIndex = 0; roleIndex < roles.length; roleIndex++) {
      if (contract.hasRole(user, roles[roleIndex]!)) {
        return true;
      }
    }
    return false;
  };

  return {
    defaultGuard,
    user<TGuard extends keyof TGuards & string = TDefault>(
      guard?: TGuard
    ): GuardUser<TGuards, TGuard> | null {
      return readUser(guard ?? defaultGuard) as GuardUser<TGuards, TGuard> | null;
    },
    check,
    guest: (guard: string = defaultGuard): boolean => !check(guard),
    hasRole,
    hasAnyRole
  };
}

export function AuthProvider(props: AuthProviderProps): unknown {
  const run = (): unknown => {
    setContext(AuthContext, props.value as AuthInstance);
    if (typeof props.children === "function") {
      return (props.children as () => unknown)();
    }
    return props.children;
  };

  if (!getCurrentOwner()) {
    let result: unknown;
    createRoot((dispose) => {
      try {
        result = run();
      } finally {
        dispose();
      }
    });
    return result;
  }

  return run();
}

/** The auth instance of the nearest <AuthProvider>, typed by the application's `Register.auth`. */
export function useAuth(): RegisteredAuth {
  const auth = getContext(AuthContext);
  if (!auth) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_AUTH_PROVIDER_MISSING,
      "Auth directive/hook requires an active <AuthProvider> ancestor."
    );
  }
  return auth as RegisteredAuth;
}

export function __mixAuth(
  parent: Node,
  options: AuthCheckOptions,
  renderAuthed: (userGetter: () => unknown) => Node | readonly Node[],
  elseRender?: (() => Node | readonly Node[]) | null,
  anchor?: Node | null
): Comment {
  const auth = useAuth();
  const userMemo = createMemo(() => auth.user(options.guard));
  const allowedMemo = createMemo(() => {
    const currentUser = userMemo();
    if (currentUser === null || currentUser === undefined) {
      return false;
    }
    if (options.roles && options.roles.length > 0) {
      return auth.hasAnyRole(currentUser, options.roles, options.guard);
    }
    return true;
  });

  return createConditional(
    parent,
    [
      {
        condition: allowedMemo,
        render: () => renderAuthed(() => userMemo())
      }
    ],
    elseRender,
    anchor
  );
}

export function __mixGuest(
  parent: Node,
  guard: string | undefined,
  renderGuest: () => Node | readonly Node[],
  elseRender?: (() => Node | readonly Node[]) | null,
  anchor?: Node | null
): Comment {
  const auth = useAuth();
  return createConditional(
    parent,
    [
      {
        condition: () => auth.guest(guard),
        render: renderGuest
      }
    ],
    elseRender,
    anchor
  );
}

export function __mixCanAny(
  parent: Node,
  actions: () => readonly Action[],
  subject: () => unknown,
  field: string | undefined,
  renderAllowed: () => Node | readonly Node[],
  elseRender?: (() => Node | readonly Node[]) | null,
  anchor?: Node | null
): Comment {
  const ability = useAbility();
  const allowedMemo = createMemo(() => {
    const actionList = actions();
    const target = (subject() ?? "all") as object;
    for (let i = 0; i < actionList.length; i++) {
      if (ability.can(actionList[i]!, target, field)) {
        return true;
      }
    }
    return false;
  });

  return createConditional(
    parent,
    [{ condition: allowedMemo, render: renderAllowed }],
    elseRender,
    anchor
  );
}

export function __mixProvideContext<T>(ctx: RuntimeContext<T>, value: T): T {
  return setContext(ctx, value);
}

export function __mixUseContext<T>(ctx: RuntimeContext<T>): T {
  return getContext(ctx);
}

export function __mixReadContext<T>(
  parent: Node,
  ctx: RuntimeContext<T>,
  renderWithVal: (valGetter: () => NonNullable<T>) => Node | readonly Node[],
  elseRender?: (() => Node | readonly Node[]) | null,
  anchor?: Node | null
): Comment {
  const valueMemo = createMemo(() => getContext(ctx));
  return createConditional(
    parent,
    [
      {
        condition: () => {
          const contextValue = valueMemo();
          return contextValue !== null && contextValue !== undefined;
        },
        render: () => renderWithVal(() => valueMemo() as NonNullable<T>)
      }
    ],
    elseRender,
    anchor
  );
}
