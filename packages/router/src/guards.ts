/**
 * @mix/router — Route Permission & Lazy Resolution Helpers
 */

import type { RouteLocation, RouteObject } from "./types.js";

export function checkLocationPermissions(
  targetLoc: RouteLocation,
  abilitySource: unknown
): { allowed: boolean; redirectTo?: string | undefined } {
  for (const m of targetLoc.matched) {
    const perm = m.route.permissions;
    if (perm) {
      let ab: unknown = abilitySource;
      if (typeof ab === "function") {
        ab = (ab as () => unknown)();
      }
      if (ab && typeof (ab as { can?: unknown }).can === "function") {
        const allowed = (ab as { can: (a: string, s: string, f?: string) => boolean }).can(
          perm.action,
          perm.subject,
          perm.field
        );
        if (!allowed) {
          return { allowed: false, redirectTo: perm.redirectTo };
        }
      }
    }
  }
  return { allowed: true };
}

export async function resolveRouteLazy(route: RouteObject): Promise<void> {
  if (route.lazy && typeof route.lazy === "function") {
    const res = await route.lazy();
    if (res.default) route.component = res.default;
    if (res.Component) route.Component = res.Component;
    if (res.loader) route.loader = res.loader;
    if (res.action) route.action = res.action;
    route.lazy = undefined;
  }
}
