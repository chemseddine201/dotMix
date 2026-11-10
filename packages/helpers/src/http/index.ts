/**
 * mix-helpers/http — dotMix Native Interceptor HTTP Client & Reactive Hook
 *
 * 100% zero external dependencies. Built on native globalThis.fetch + CancellationToken.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  createSignal,
  createEffect,
  onCleanup,
  createCancellationSource,
  type Signal,
  type CancellationToken
} from "@mix/runtime";

export interface HttpRequestConfig {
  url?: string;
  method?: string;
  baseURL?: string;
  headers?: Record<string, string>;
  params?: Record<string, any>;
  data?: any;
  body?: any;
  timeout?: number;
  cancelToken?: CancellationToken;
  signal?: AbortSignal;
  retry?: {
    retries?: number;
    delayMs?: number;
    statusCodes?: number[];
    shouldRetry?: (error: any) => boolean;
  };
  dedupe?: boolean;
  cache?: {
    ttlMs?: number;
  };
  responseType?: "json" | "text" | "blob" | "arraybuffer";
}

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  config: HttpRequestConfig;
}

export class HttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly response?: HttpResponse<any> | undefined;
  readonly config: HttpRequestConfig;
  readonly isTimeout: boolean;
  readonly isCancelled: boolean;

  constructor(
    message: string,
    config: HttpRequestConfig,
    status = 0,
    statusText = "",
    response?: HttpResponse<any> | undefined,
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

export function isHttpError(err: any): err is HttpError {
  return err instanceof HttpError || (err && typeof err === "object" && err.name === "HttpError");
}

export type RequestInterceptor = (config: HttpRequestConfig) => HttpRequestConfig | Promise<HttpRequestConfig>;
export type ResponseInterceptor = (response: HttpResponse<any>) => HttpResponse<any> | Promise<HttpResponse<any>>;
export type ErrorInterceptor = (error: any) => any;

class InterceptorManager<T> {
  private handlers: Array<{
    fulfilled?: ((val: T) => any) | undefined;
    rejected?: ErrorInterceptor | undefined;
  } | null> = [];

  use(fulfilled?: ((val: T) => any) | undefined, rejected?: ErrorInterceptor | undefined): number {
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

  forEach(
    fn: (handler: {
      fulfilled?: ((val: T) => any) | undefined;
      rejected?: ErrorInterceptor | undefined;
    }) => void
  ): void {
    for (const h of this.handlers) {
      if (h !== null) fn(h);
    }
  }
}

export class HttpClient {
  readonly defaults: HttpRequestConfig;
  readonly interceptors = {
    request: new InterceptorManager<HttpRequestConfig>(),
    response: new InterceptorManager<HttpResponse<any>>()
  };

  private inFlight = new Map<string, Promise<HttpResponse<any>>>();
  private cache = new Map<string, { data: any; expiresAt: number; response: HttpResponse<any> }>();

  constructor(defaults: HttpRequestConfig = {}) {
    this.defaults = defaults;
  }

  clearCache(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  async request<T = any>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    // 1. Merge defaults
    let merged: HttpRequestConfig = {
      ...this.defaults,
      ...config,
      headers: { ...(this.defaults.headers || {}), ...(config.headers || {}) }
    };

    // 2. Run request interceptors
    const requestChain: any[] = [];
    this.interceptors.request.forEach((interceptor) => {
      requestChain.push(interceptor.fulfilled, interceptor.rejected);
    });

    let chainPromise = Promise.resolve(merged);
    while (requestChain.length > 0) {
      const onFulfilled = requestChain.shift();
      const onRejected = requestChain.shift();
      chainPromise = chainPromise.then(onFulfilled, onRejected);
    }
    merged = await chainPromise;

    // 3. Resolve Full URL
    let fullUrl = merged.url || "";
    if (merged.baseURL && !fullUrl.startsWith("http://") && !fullUrl.startsWith("https://")) {
      const base = merged.baseURL.endsWith("/") ? merged.baseURL.slice(0, -1) : merged.baseURL;
      const path = fullUrl.startsWith("/") ? fullUrl : `/${fullUrl}`;
      fullUrl = `${base}${path}`;
    }

    if (merged.params) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(merged.params)) {
        if (v !== undefined && v !== null) {
          sp.append(k, String(v));
        }
      }
      const qs = sp.toString();
      if (qs) {
        fullUrl += (fullUrl.includes("?") ? "&" : "?") + qs;
      }
    }

    const method = (merged.method || "GET").toUpperCase();
    const cacheKey = `${method}:${fullUrl}`;

    // 4. Cache check (GET only)
    if (method === "GET" && merged.cache?.ttlMs) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.response as HttpResponse<T>;
      }
    }

    // 5. In-flight deduplication (GET only)
    if (method === "GET" && merged.dedupe) {
      const existing = this.inFlight.get(cacheKey);
      if (existing) {
        return existing as Promise<HttpResponse<T>>;
      }
    }

    const execPromise = this.executeWithRetry<T>(merged, fullUrl);

    if (method === "GET" && merged.dedupe) {
      this.inFlight.set(cacheKey, execPromise);
      execPromise.finally(() => this.inFlight.delete(cacheKey));
    }

    const res = await execPromise;

    if (method === "GET" && merged.cache?.ttlMs) {
      this.cache.set(cacheKey, {
        data: res.data,
        expiresAt: Date.now() + merged.cache.ttlMs,
        response: res
      });
    }

    return res;
  }

  private async executeWithRetry<T>(config: HttpRequestConfig, fullUrl: string): Promise<HttpResponse<T>> {
    const retries = config.retry?.retries ?? 0;
    const baseDelay = config.retry?.delayMs ?? 100;
    const statusCodes = new Set(config.retry?.statusCodes ?? [408, 429, 500, 502, 503, 504]);
    const shouldRetryFn = config.retry?.shouldRetry;

    let attempt = 0;
    while (true) {
      attempt++;
      try {
        return await this.executeFetch<T>(config, fullUrl);
      } catch (err: any) {
        const isLast = attempt > retries;
        if (isLast || (err && err.isCancelled)) {
          throw err;
        }

        const isStatusRetry = isHttpError(err) && statusCodes.has(err.status);
        const customRetry = shouldRetryFn ? shouldRetryFn(err) : false;

        if (isStatusRetry || customRetry || !isHttpError(err)) {
          const delay = baseDelay * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
  }

  private async executeFetch<T>(config: HttpRequestConfig, fullUrl: string): Promise<HttpResponse<T>> {
    const controller = new AbortController();
    let isCancelled = false;
    let isTimeout = false;

    // CancellationToken (D-104) bridge
    let cancelCleanup: (() => void) | undefined;
    if (config.cancelToken) {
      if (config.cancelToken.isCancelled) {
        throw new HttpError("Request cancelled", config, 0, "", undefined, false, true);
      }
      cancelCleanup = config.cancelToken.onCancelled(() => {
        isCancelled = true;
        controller.abort();
      });
    }

    if (config.signal) {
      if (config.signal.aborted) {
        controller.abort();
      } else {
        config.signal.addEventListener("abort", () => controller.abort());
      }
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (config.timeout && config.timeout > 0) {
      timer = setTimeout(() => {
        isTimeout = true;
        controller.abort();
      }, config.timeout);
    }

    try {
      const headers: Record<string, string> = { ...(config.headers || {}) };
      let body = config.data ?? config.body;

      if (body !== undefined && body !== null && typeof body === "object" && !(body instanceof FormData) && !(body instanceof ArrayBuffer) && !(body instanceof Blob)) {
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/json; charset=utf-8";
        }
        body = JSON.stringify(body);
      }

      const rawRes = await globalThis.fetch(fullUrl, {
        method: config.method || "GET",
        headers,
        body: (config.method || "GET").toUpperCase() === "GET" ? undefined : body,
        signal: controller.signal
      });

      if (timer) clearTimeout(timer);
      if (cancelCleanup) cancelCleanup();

      const resHeaders: Record<string, string> = {};
      rawRes.headers.forEach((v, k) => {
        resHeaders[k.toLowerCase()] = v;
      });

      let parsedData: any;
      const contentType = resHeaders["content-type"] || "";
      if (config.responseType === "text") {
        parsedData = await rawRes.text();
      } else if (config.responseType === "blob") {
        parsedData = await rawRes.blob();
      } else if (config.responseType === "arraybuffer") {
        parsedData = await rawRes.arrayBuffer();
      } else if (contentType.includes("application/json")) {
        const text = await rawRes.text();
        parsedData = text ? JSON.parse(text) : null;
      } else {
        const text = await rawRes.text();
        try {
          parsedData = JSON.parse(text);
        } catch {
          parsedData = text;
        }
      }

      let responseEnvelope: HttpResponse<T> = {
        data: parsedData,
        status: rawRes.status,
        statusText: rawRes.statusText,
        headers: resHeaders,
        config
      };

      // Run response interceptors
      const responseChain: any[] = [];
      this.interceptors.response.forEach((interceptor) => {
        responseChain.push(interceptor.fulfilled, interceptor.rejected);
      });

      let resPromise = Promise.resolve(responseEnvelope);
      while (responseChain.length > 0) {
        const onFulfilled = responseChain.shift();
        const onRejected = responseChain.shift();
        resPromise = resPromise.then(onFulfilled, onRejected);
      }
      responseEnvelope = await resPromise;

      if (!rawRes.ok) {
        throw new HttpError(
          `Request failed with status code ${rawRes.status}`,
          config,
          rawRes.status,
          rawRes.statusText,
          responseEnvelope
        );
      }

      return responseEnvelope;
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      if (cancelCleanup) cancelCleanup();

      if (isCancelled) {
        throw new HttpError("Request cancelled", config, 0, "", undefined, false, true);
      }
      if (isTimeout) {
        throw new HttpError(`Request timeout of ${config.timeout}ms exceeded`, config, 0, "", undefined, true, false);
      }
      if (isHttpError(err)) {
        throw err;
      }
      throw new HttpError(err instanceof Error ? err.message : String(err), config);
    }
  }

  get<T = any>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: "GET" });
  }

  delete<T = any>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: "DELETE" });
  }

  head<T = any>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: "HEAD" });
  }

  options<T = any>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: "OPTIONS" });
  }

  post<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, data, method: "POST" });
  }

  put<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, data, method: "PUT" });
  }

  patch<T = any>(url: string, data?: any, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, data, method: "PATCH" });
  }
}

export function createHttpClient(defaults?: HttpRequestConfig): HttpClient {
  return new HttpClient(defaults);
}

export const http = createHttpClient();

export interface UseHttpResult<T> {
  data: Signal<T | undefined>;
  error: Signal<HttpError | null>;
  loading: Signal<boolean>;
  status: Signal<number | null>;
  execute: () => Promise<T | undefined>;
  refetch: () => Promise<T | undefined>;
  abort: () => void;
  mutate: (val: T | undefined) => void;
}

export function useHttp<T = any>(
  urlOrConfig: string | HttpRequestConfig | (() => string | HttpRequestConfig),
  options: { immediate?: boolean; client?: HttpClient } = {}
): UseHttpResult<T> {
  const client = options.client || http;
  const data = createSignal<T | undefined>(undefined);
  const error = createSignal<HttpError | null>(null);
  const loading = createSignal<boolean>(false);
  const status = createSignal<number | null>(null);

  let activeCts: ReturnType<typeof createCancellationSource> | null = null;

  const execute = async (): Promise<T | undefined> => {
    if (activeCts) {
      activeCts.cancel();
      activeCts = null;
    }

    const cts = createCancellationSource();
    activeCts = cts;

    loading.set(true);
    error.set(null);

    const resolved = typeof urlOrConfig === "function" ? urlOrConfig() : urlOrConfig;
    const reqConfig: HttpRequestConfig =
      typeof resolved === "string" ? { url: resolved } : { ...resolved };
    reqConfig.cancelToken = cts.token;

    try {
      const res = await client.request<T>(reqConfig);
      if (!cts.token.isCancelled) {
        data.set(res.data);
        status.set(res.status);
        loading.set(false);
      }
      return res.data;
    } catch (err: any) {
      if (!cts.token.isCancelled) {
        const httpErr = isHttpError(err) ? err : new HttpError(String(err), reqConfig);
        error.set(httpErr);
        status.set(httpErr.status || null);
        loading.set(false);
      }
      return undefined;
    } finally {
      if (activeCts === cts) {
        activeCts = null;
      }
    }
  };

  const abort = () => {
    if (activeCts) {
      activeCts.cancel();
      activeCts = null;
      loading.set(false);
    }
  };

  if (options.immediate !== false) {
    createEffect(() => {
      // Re-run execute when reactive dependencies in urlOrConfig change
      if (typeof urlOrConfig === "function") {
        urlOrConfig();
      }
      execute();
    });
  }

  onCleanup(() => {
    abort();
  });

  return {
    data,
    error,
    loading,
    status,
    execute,
    refetch: execute,
    abort,
    mutate: (val: T | undefined) => data.set(val)
  };
}

