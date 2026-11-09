/**
 * @mix/router — Types and Interfaces (React Router v6/v7 Parity & Mix Native)
 */

import type { CancellationToken } from "@mix/runtime";

export type NavigationGuardReturn = boolean | string | void | undefined;

export type NavigationGuard = (
  to: RouteLocation,
  from: RouteLocation,
  cancellationToken: CancellationToken
) => NavigationGuardReturn | Promise<NavigationGuardReturn>;

export type RouteComponent = unknown;

export type To = string | { pathname?: string | undefined; search?: string | undefined; hash?: string | undefined };

export interface PathPattern {
  path?: string | undefined;
  caseSensitive?: boolean | undefined;
  end?: boolean | undefined;
}

export interface PathMatch {
  params: Record<string, string>;
  pathname: string;
  pathnameBase: string;
  pattern: PathPattern;
}

export interface RouteObject {
  path?: string | undefined;
  index?: boolean | undefined;
  element?: unknown | undefined;
  Component?: unknown | undefined;
  component?: unknown | undefined;
  name?: string | undefined;
  id?: string | undefined;
  caseSensitive?: boolean | undefined;
  children?: RouteObject[] | undefined;
  meta?: Record<string, unknown> | undefined;
  beforeEnter?: NavigationGuard | undefined;
  loader?: unknown | undefined;
  action?: unknown | undefined;
}

export type RouteRecord<TProps = unknown> = RouteObject & {
  children?: RouteRecord<TProps>[] | undefined;
};

export interface RouteMatch {
  params: Record<string, string>;
  pathname: string;
  pathnameBase: string;
  route: RouteObject;
}

export interface MatchedRoute extends RouteMatch {
  record: RouteRecord;
  path: string;
  component?: RouteComponent | undefined;
}

export interface Location {
  pathname: string;
  search: string;
  hash: string;
  state?: unknown | undefined;
  key?: string | undefined;
}

export interface RouteLocation extends Location {
  fullPath: string;
  params: Record<string, string>;
  query: Record<string, string>;
  matched: MatchedRoute[];
  meta: Record<string, unknown>;
}

export interface RouterHistory {
  readonly location: string;
  push(url: string): void;
  replace(url: string): void;
  back(): void;
  forward(): void;
  go(delta: number): void;
  listen(listener: (url: string) => void): () => void;
  destroy(): void;
}

export interface RouterOptions {
  routes: (RouteRecord | RouteObject)[];
  history?: RouterHistory | undefined;
  initialPath?: string | undefined;
  basename?: string | undefined;
  beforeEach?: NavigationGuard | undefined;
}

export interface MemoryRouterOptions extends Omit<RouterOptions, "history" | "routes"> {
  initialEntries?: string[] | undefined;
  initialIndex?: number | undefined;
  routes?: (RouteRecord | RouteObject)[] | undefined;
}

export interface BrowserRouterOptions extends Omit<RouterOptions, "history" | "routes"> {
  window?: unknown | undefined;
  basename?: string | undefined;
  routes?: (RouteRecord | RouteObject)[] | undefined;
}

export interface HashRouterOptions extends Omit<RouterOptions, "history" | "routes"> {
  window?: unknown | undefined;
  basename?: string | undefined;
  routes?: (RouteRecord | RouteObject)[] | undefined;
}

export interface NavigateOptions {
  replace?: boolean | undefined;
  state?: unknown | undefined;
  preventScrollReset?: boolean | undefined;
}

export interface NavigateFunction {
  (to: To, options?: NavigateOptions): Promise<boolean>;
  (delta: number): void;
}

export interface Router {
  readonly routes: (RouteRecord | RouteObject)[];
  readonly history: RouterHistory;
  readonly currentRoute: () => RouteLocation;
  push(to: string): Promise<boolean>;
  replace(to: string): Promise<boolean>;
  back(): void;
  forward(): void;
  go(delta: number): void;
  beforeEach(guard: NavigationGuard): () => void;
  resolve(to: string): RouteLocation;
  destroy(): void;
}
