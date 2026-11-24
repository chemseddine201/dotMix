import type { Owner } from "./types.js";
import { coreState } from "./state.js";

export type RuntimeErrorSource =
  | "render" | "effect" | "event" | "onMount" | "resource"
  | "mount" | "hydrate" | "reconciler" | "boundary" | "warning";

export interface RuntimeErrorInfo {
  readonly source: RuntimeErrorSource;
  readonly componentStack: readonly string[];
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly code?: string;
  readonly handled?: boolean;
}

export type ErrorReporter = (error: unknown, info: RuntimeErrorInfo) => void;
let reporter: ErrorReporter | null = null;
export const setErrorReporter = (fn: ErrorReporter | null): void => { reporter = fn; };
export const getErrorReporter = (): ErrorReporter | null => reporter;

export function collectComponentStack(owner: Owner | null | undefined): string[] {
  const out: string[] = [];
  let c: Owner | null = owner ?? coreState.currentOwner;
  for (let n = 0; c && n < 128; n++, c = c.parent ?? c.contextParent) {
    if (c.componentName) {
      const s = c.componentFile ? `${c.componentName} (${c.componentFile})` : c.componentName;
      if (out[out.length - 1] !== s) out.push(s);
    }
  }
  return out;
}

interface ErrDetails { code?: unknown; details?: { loc?: { file?: unknown; line?: unknown; column?: unknown } } }

export function extractErrorLocation(error: unknown): { code?: string; file?: string; line?: number; column?: number } {
  if (!error || typeof error !== "object") return {};
  const e = error as ErrDetails;
  const loc = e.details?.loc;
  const out: { code?: string; file?: string; line?: number; column?: number } = {};
  if (typeof e.code === "string") out.code = e.code;
  if (typeof loc?.file === "string") out.file = loc.file;
  if (typeof loc?.line === "number") out.line = loc.line;
  if (typeof loc?.column === "number") out.column = loc.column;
  return out;
}

export function reportError(error: unknown, partial: Omit<RuntimeErrorInfo, "componentStack">, owner?: Owner | null): void {
  if (!reporter) return;
  try { reporter(error, { ...extractErrorLocation(error), ...partial, componentStack: collectComponentStack(owner) }); } catch { /* ignore */ }
}

export function reportWarning(code: string, message: string, loc?: { readonly file?: string; readonly line?: number; readonly column?: number }): void {
  if (typeof console !== "undefined") console.warn(`[${code}] ${message}`);
  reportError(new Error(message), { source: "warning", code, ...loc }, coreState.currentOwner);
}
