/**
 * mix-helpers/http — Reactive Signal Hook for HTTP Requests (`useHttp`)
 */

import {
  createSignal,
  createEffect,
  onCleanup,
  createCancellationSource,
} from "@mix/runtime";
import {
  type HttpRequestConfig,
  type UseHttpOptions,
  type UseHttpResult,
  HttpError,
  isHttpError,
} from "./types.js";
import { type HttpClient, http } from "./client.js";

export function useHttp<T = unknown>(
  urlOrConfig: string | HttpRequestConfig | (() => string | HttpRequestConfig),
  options: UseHttpOptions<HttpClient> = {}
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
    } catch (err: unknown) {
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

  const abort = (): void => {
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
      void execute();
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
    mutate: (val: T | undefined) => data.set(val),
  };
}
