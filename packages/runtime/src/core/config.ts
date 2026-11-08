// packages/runtime/src/core/config.ts — FROZEN per MIX_SPEC_v3.2.2 §1.5

import type { MixErrorCode } from "./errors.js";

export interface MixWarning {
  readonly code: MixErrorCode;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

export interface SecurityViolation {
  readonly code: MixErrorCode;
  readonly attribute?: string;
  readonly value: string;
}

export interface RuntimeConfig {
  scheduler: (flush: () => void) => void;
  maxEffectRunsPerFlush: number;
  onUncaughtError: (err: unknown) => void;
  onWarning: (w: MixWarning) => void;
  onSecurityViolation: (v: SecurityViolation) => void;
}

// Global __DEV__ is defined by build tools / bundler (R-BLD-01)
// If undefined at runtime, fall back safely without reading process.env (R-BLD-02)
const isDev = typeof (globalThis as unknown as { __DEV__?: boolean }).__DEV__ !== "undefined"
  ? Boolean((globalThis as unknown as { __DEV__?: boolean }).__DEV__)
  : true;

export const defaultConfig: RuntimeConfig = {
  scheduler: (flush: () => void) => {
    // Pure ECMAScript microtask scheduler
    Promise.resolve().then(flush);
  },
  maxEffectRunsPerFlush: 100, // Default 100 per spec §1.5
  onUncaughtError: (err: unknown) => {
    if (err) {
      console.error(err);
    }
  },
  onWarning: (w: MixWarning) => {
    if (isDev) {
      console.warn(`[${w.code}] ${w.message}`, w.details ?? "");
    }
  },
  onSecurityViolation: (v: SecurityViolation) => {
    defaultConfig.onWarning({
      code: v.code,
      message: `Security violation on attribute "${v.attribute ?? "unknown"}": ${v.value}`
    });
  }
};

export let activeConfig: RuntimeConfig = { ...defaultConfig };

export function configureRuntime(partial: Partial<RuntimeConfig>): void {
  activeConfig = {
    ...activeConfig,
    ...partial
  };
}

export function resetRuntimeConfig(): void {
  activeConfig = { ...defaultConfig };
}

