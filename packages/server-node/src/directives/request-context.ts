/**
 * @dotmix/server-node/directives/request-context — Per-request SSR context for session & CSRF tokens (F8, F13, T-38.6).
 */

import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import type http from "node:http";
import type { HeadCollector, RequestContext, StackCollector } from "@dotmix/runtime";

export type { RequestContext };

export interface CreateRequestContextOptions {
  readonly session?:
    | Readonly<Record<string, unknown>>
    | ((key: string) => unknown)
    | undefined;
  readonly csrfToken?: string | (() => string) | undefined;
  readonly req?: http.IncomingMessage | undefined;
}

export interface ActiveSsrDirectiveScope {
  readonly request: RequestContext;
  readonly headCollector: HeadCollector;
  readonly stackCollector: StackCollector;
  readonly partial?: string | undefined;
}

const ssrScopeStorage = new AsyncLocalStorage<ActiveSsrDirectiveScope>();

function generateRandomCsrfToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function readCookieFromRequest(req: http.IncomingMessage | undefined, name: string): string | undefined {
  const cookieHeader = req?.headers?.cookie;
  if (!cookieHeader || typeof cookieHeader !== "string") return undefined;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === name) {
      const rawVal = part.slice(eqIdx + 1).trim();
      try {
        return decodeURIComponent(rawVal);
      } catch {
        return rawVal;
      }
    }
  }
  return undefined;
}

export function createRequestContext(options: CreateRequestContextOptions = {}): RequestContext {
  let cachedCsrfToken: string | undefined;

  const session = (key: string): unknown => {
    const source = options.session;
    if (typeof source === "function") {
      return source(key);
    }
    if (source && typeof source === "object") {
      return Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
    }
    return undefined;
  };

  const csrfToken = (): string => {
    const source = options.csrfToken;
    if (typeof source === "function") {
      return source();
    }
    if (typeof source === "string") {
      return source;
    }
    if (cachedCsrfToken === undefined) {
      cachedCsrfToken =
        readCookieFromRequest(options.req, "XSRF-TOKEN") ??
        readCookieFromRequest(options.req, "_csrf") ??
        generateRandomCsrfToken();
    }
    return cachedCsrfToken;
  };

  return {
    session,
    csrfToken
  };
}

export function runWithSsrScope<T>(scope: ActiveSsrDirectiveScope, callback: () => T): T {
  return ssrScopeStorage.run(scope, callback);
}

export function getActiveSsrScope(): ActiveSsrDirectiveScope | undefined {
  return ssrScopeStorage.getStore();
}

export function getActiveRequestContext(): RequestContext | undefined {
  return ssrScopeStorage.getStore()?.request;
}

export function getActiveHeadCollector(): HeadCollector | undefined {
  return ssrScopeStorage.getStore()?.headCollector;
}

export function getActiveStackCollector(): StackCollector | undefined {
  return ssrScopeStorage.getStore()?.stackCollector;
}
