/**
 * mix-helpers/http — Native Interceptor HTTP Client with Retry, Dedupe & TTL Cache
 */

import {
  type HttpRequestConfig,
  type HttpResponse,
  type ErrorInterceptor,
  HttpError,
  isHttpError,
  InterceptorManager,
} from "./types.js";

export class HttpClient {
  readonly defaults: HttpRequestConfig;
  readonly interceptors = {
    request: new InterceptorManager<HttpRequestConfig>(),
    response: new InterceptorManager<HttpResponse<unknown>>(),
  };

  private inFlight = new Map<string, Promise<HttpResponse<unknown>>>();
  private cache = new Map<string, { data: unknown; expiresAt: number; response: HttpResponse<unknown> }>();

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

  async request<T = unknown>(config: HttpRequestConfig): Promise<HttpResponse<T>> {
    // 1. Merge defaults
    let merged: HttpRequestConfig = {
      ...this.defaults,
      ...config,
      headers: { ...(this.defaults.headers || {}), ...(config.headers || {}) },
    };

    // 2. Run request interceptors
    const requestChain: Array<{
      fulfilled?: ((val: HttpRequestConfig) => HttpRequestConfig | Promise<HttpRequestConfig>) | undefined;
      rejected?: ErrorInterceptor | undefined;
    }> = [];
    this.interceptors.request.forEach((interceptor) => {
      requestChain.push(interceptor);
    });

    let chainPromise: Promise<HttpRequestConfig> = Promise.resolve(merged);
    for (const step of requestChain) {
      chainPromise = chainPromise.then(
        step.fulfilled,
        step.rejected as ((reason: unknown) => HttpRequestConfig | PromiseLike<HttpRequestConfig>) | undefined
      );
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
      this.inFlight.set(cacheKey, execPromise as Promise<HttpResponse<unknown>>);
      void execPromise.finally(() => this.inFlight.delete(cacheKey));
    }

    const res = await execPromise;

    if (method === "GET" && merged.cache?.ttlMs) {
      this.cache.set(cacheKey, {
        data: res.data,
        expiresAt: Date.now() + merged.cache.ttlMs,
        response: res as HttpResponse<unknown>,
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
      } catch (err: unknown) {
        const isLast = attempt > retries;
        const cancelled = isHttpError(err) && err.isCancelled;
        if (isLast || cancelled) {
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
      const rawBody: unknown = config.data ?? config.body;
      let fetchBody: BodyInit | null = null;

      if (
        rawBody !== undefined &&
        rawBody !== null &&
        typeof rawBody === "object" &&
        !(rawBody instanceof FormData) &&
        !(rawBody instanceof ArrayBuffer) &&
        !(rawBody instanceof Blob)
      ) {
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/json; charset=utf-8";
        }
        fetchBody = JSON.stringify(rawBody);
      } else if (rawBody !== undefined && rawBody !== null) {
        fetchBody = rawBody as BodyInit;
      }

      const rawRes = await globalThis.fetch(fullUrl, {
        method: config.method || "GET",
        headers,
        body: (config.method || "GET").toUpperCase() === "GET" ? null : fetchBody,
        signal: controller.signal,
      });

      if (timer) clearTimeout(timer);
      if (cancelCleanup) cancelCleanup();

      const resHeaders: Record<string, string> = {};
      rawRes.headers.forEach((v, k) => {
        resHeaders[k.toLowerCase()] = v;
      });

      let parsedData: unknown;
      const contentType = resHeaders["content-type"] || "";
      if (config.responseType === "text") {
        parsedData = await rawRes.text();
      } else if (config.responseType === "blob") {
        parsedData = await rawRes.blob();
      } else if (config.responseType === "arraybuffer") {
        parsedData = await rawRes.arrayBuffer();
      } else if (contentType.includes("application/json")) {
        const text = await rawRes.text();
        parsedData = text ? (JSON.parse(text) as unknown) : null;
      } else {
        const text = await rawRes.text();
        try {
          parsedData = JSON.parse(text) as unknown;
        } catch {
          parsedData = text;
        }
      }

      let responseEnvelope: HttpResponse<unknown> = {
        data: parsedData,
        status: rawRes.status,
        statusText: rawRes.statusText,
        headers: resHeaders,
        config,
      };

      // Run response interceptors
      const responseChain: Array<{
        fulfilled?: ((val: HttpResponse<unknown>) => HttpResponse<unknown> | Promise<HttpResponse<unknown>>) | undefined;
        rejected?: ErrorInterceptor | undefined;
      }> = [];
      this.interceptors.response.forEach((interceptor) => {
        responseChain.push(interceptor);
      });

      let resPromise: Promise<HttpResponse<unknown>> = Promise.resolve(responseEnvelope);
      for (const step of responseChain) {
        resPromise = resPromise.then(
          step.fulfilled,
          step.rejected as ((reason: unknown) => HttpResponse<unknown> | PromiseLike<HttpResponse<unknown>>) | undefined
        );
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

      return responseEnvelope as HttpResponse<T>;
    } catch (err: unknown) {
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

  get<T = unknown>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: "GET" });
  }

  delete<T = unknown>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: "DELETE" });
  }

  head<T = unknown>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: "HEAD" });
  }

  options<T = unknown>(url: string, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, method: "OPTIONS" });
  }

  post<T = unknown>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, data, method: "POST" });
  }

  put<T = unknown>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, data, method: "PUT" });
  }

  patch<T = unknown>(url: string, data?: unknown, config?: HttpRequestConfig): Promise<HttpResponse<T>> {
    return this.request<T>({ ...config, url, data, method: "PATCH" });
  }
}

export function createHttpClient(defaults?: HttpRequestConfig): HttpClient {
  return new HttpClient(defaults);
}

export const http = createHttpClient();
