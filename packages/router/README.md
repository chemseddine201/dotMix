# `@mix/router`

Fine-grained, trie-matched router for Mix and Tix applications with first-class data loaders, actions, cancellation tokens, and reactive permission guards.

## Route Permission Guards

Routes may declare a `permissions` guard (`{ action, subject, field?, redirectTo? }`). `@mix/router` enforces route permissions across the full navigation lifecycle:

1. **Initial Load:** Evaluated synchronously when `createRouter()` initializes so unauthorized initial entries (such as a direct reload on `/admin`) redirect immediately before any route loader or component mounts.
2. **Programmatic Navigation (`push` / `replace`):** Evaluated before `beforeEach` guards and route `loader` functions.
3. **Browser History (`popstate`):** Evaluated on Back/Forward navigation; if denied without a `redirectTo` target, the browser history URL is restored to the previous authorized location.
4. **Reactive Ability Changes:** When `ability` is a reactive signal or updated via `router.setAbility(...)`, the router automatically re-evaluates the active route and redirects if the current location is no longer permitted.

## Client Guards Are Not Authorization

> **Security Warning:** Client-side route guards (`route.permissions`, `beforeEnter`, `beforeEach`) and `<Can>` boundaries exist for **user experience and UI consistency only**. They are **not** an authorization boundary.
>
> Because all client code executes in an untrusted browser environment, a user can inspect client bundles or issue direct HTTP requests. Always enforce authentication, RBAC/ABAC permissions, and field-level filtering on the server (API endpoints, RPC handlers, and server loaders/actions).

