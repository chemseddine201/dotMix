/**
 * @mix/router — Types and Interfaces
 */

import type { CancellationToken } from "@mix/runtime";

export type NavigationGuardReturn = boolean | string | void | undefined;

export type NavigationGuard = (
  to: RouteLocation,
  from: RouteLocation,
  cancellationToken: CancellationToken
) => NavigationGuardReturn | Promise<NavigationGuardReturn>;

export type RouteComponent = unknown;

export interface RouteRecord<TProps = unknown> {
  path: string;
  component?: RouteComponent;
  name?: string;
  meta?: Record<string, unknown>;
  children?: RouteRecord<TProps>[];
  beforeEnter?: NavigationGuard;
}

export interface MatchedRoute {
  record: RouteRecord;
  path: string;
  params: Record<string, string>;
  component?: RouteComponent;
}

export interface RouteLocation {
  fullPath: string;
  pathname: string;
  search: string;
  hash: string;
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
  routes: RouteRecord[];
  history?: RouterHistory;
  initialPath?: string;
  beforeEach?: NavigationGuard;
}

export interface Router {
  readonly routes: RouteRecord[];
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
