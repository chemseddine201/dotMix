/**
 * mix-helpers/http — HTTP Client Types, Error Envelope & Interceptor Manager
 *
 * 100% zero external dependencies. Built on native globalThis.fetch + CancellationToken.
 */

import type { Signal, CancellationToken } from "@mix/runtime";

export type HttpMethod =
  | "GET" | "get"
  | "POST" | "post"
  | "PUT" | "put"
  | "PATCH" | "patch"
  | "DELETE" | "delete"
  | "HEAD" | "head"
  | "OPTIONS" | "options";

export interface HttpRequestConfig {
  url?: string;
  method?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  data?: unknown;
  body?: unknown;
  timeout?: number;
  cancelToken?: CancellationToken;
  signal?: AbortSignal;
  retry?: {
    retries?: number;
    delayMs?: number;
    statusCodes?: number[];
    shouldRetry?: (error: unknown) => boolean;
  };
  dedupe?: boolean;
  cache?: {
    ttlMs?: number;
  };
  responseType?: "json" | "text" | "blob" | "arraybuffer";
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: HttpRequestConfig;
}

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly response?: HttpResponse<unknown> | undefined;
  readonly config: HttpRequestConfig;
  readonly isTimeout: boolean;
  readonly isCancelled: boolean;

  constructor(
    message: string,
    config: HttpRequestConfig,
    status = 0,
    statusText = "",
    response?: HttpResponse<unknown> | undefined,
    isTimeout = false,
    isCancelled = false
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.statusText = statusText;
    this.response = response;
    this.config = config;
    this.isTimeout = isTimeout;
    this.isCancelled = isCancelled;
  }
}

export function isHttpError(err: unknown): err is HttpError {
  return (
    err instanceof HttpError ||
    (Boolean(err) && typeof err === "object" && (err as { name?: unknown }).name === "HttpError")
  );
}

export type RequestInterceptor = (config: HttpRequestConfig) => HttpRequestConfig | Promise<HttpRequestConfig>;
export type ResponseInterceptor = (response: HttpResponse<unknown>) => HttpResponse<unknown> | Promise<HttpResponse<unknown>>;
export type ErrorInterceptor = (error: unknown) => unknown;

export interface InterceptorHandler<T> {
  fulfilled?: ((val: T) => T | Promise<T>) | undefined;
  rejected?: ErrorInterceptor | undefined;
}

export class InterceptorManager<T> {
  private handlers: Array<InterceptorHandler<T> | null> = [];

  use(
    fulfilled?: ((val: T) => T | Promise<T>) | undefined,
    rejected?: ErrorInterceptor | undefined
  ): number {
    this.handlers.push({ fulfilled, rejected });
    return this.handlers.length - 1;
  }

  eject(id: number): void {
    if (this.handlers[id]) {
      this.handlers[id] = null;
    }
  }

  clear(): void {
    this.handlers = [];
  }

  forEach(fn: (handler: InterceptorHandler<T>) => void): void {
    for (const h of this.handlers) {
      if (h !== null) fn(h);
    }
  }
}

export function createInterceptorManager<T>(): InterceptorManager<T> {
  return new InterceptorManager<T>();
}

export interface UseHttpOptions<Client = unknown> {
  immediate?: boolean;
  client?: Client;
}

export interface UseHttpResult<T = unknown> {
  data: Signal<T | undefined>;
  error: Signal<HttpError | null>;
  loading: Signal<boolean>;
  status: Signal<number | null>;
  execute: () => Promise<T | undefined>;
  refetch: () => Promise<T | undefined>;
  abort: () => void;
  mutate: (val: T | undefined) => void;
}

export type UseHttpReturn<T = unknown> = UseHttpResult<T>;
