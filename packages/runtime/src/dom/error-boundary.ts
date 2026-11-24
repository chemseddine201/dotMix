import {
  collectComponentStack, createRoot, extractErrorLocation, findErrorHandler,
  getCurrentOwner, onCleanup, reportError, type Owner, type RuntimeErrorInfo
} from "../core/index.js";
import { normalizeToNodeArray, removeNode } from "./nodes.js";
import { getHydrationContext, runWithHydrationSubtree } from "./hydration.js";

export type RootErrorFallback = (error: unknown, reset: () => void) => Node | readonly Node[] | string;
export interface RootErrorConfig {
  readonly onError?: ((error: unknown, info: RuntimeErrorInfo) => void) | undefined;
  readonly fallback?: RootErrorFallback | undefined;
}
export interface ErrorBoundaryProps {
  readonly fallback: RootErrorFallback | Node | readonly Node[] | string;
  readonly children?: (() => Node | readonly Node[]) | Node | readonly Node[];
  readonly slots?: { readonly default?: () => Node | readonly Node[] };
}

let rootCfg: RootErrorConfig = {};
export const setRootErrorConfig = (c: RootErrorConfig): void => { rootCfg = c; };
const toNodes = (r: Node | readonly Node[] | string): Node[] =>
  typeof r === "string" ? [document.createTextNode(r)] : normalizeToNodeArray(r);

export function createErrorBoundary(
  parent: Node,
  renderChildren: () => Node | readonly Node[],
  renderFallback: (errorGetter: () => unknown, reset: () => void) => Node | readonly Node[],
  anchor?: Node | null
): Comment {
  const w = getHydrationContext();
  const open = w?.claimComment("mix:try:") ?? null;
  const close = open ? w!.findClosingComment(open, "mix:try:") : null;
  const end = close ?? document.createComment("mix:try");
  if (!close) parent.insertBefore(end, anchor ?? null);
  else if (parent.nodeType === 11) w!.recordScopeNode(end);

  const pOwner = getCurrentOwner();
  let dispose: (() => void) | null = null;
  let nodes: Node[] = [];
  let inFb = false;
  let hydrateFirst = Boolean(close);

  const clear = (): void => {
    const d = dispose;
    dispose = null;
    if (d) try { d(); } catch { /* ignore */ }
    for (const n of nodes) removeNode(n);
    nodes = [];
  };
  if (pOwner) onCleanup(clear);

  const put = (raw: Node | readonly Node[]): Node[] => {
    const list = normalizeToNodeArray(raw);
    const p = end.parentNode ?? parent;
    for (const n of list) p.insertBefore(n, end);
    return list;
  };
  const bubble = (err: unknown): void => {
    const outer = findErrorHandler(pOwner);
    if (outer) return outer(err);
    reportError(err, { source: "boundary" }, pOwner);
    throw err;
  };
  const reset = (): void => { inFb = false; run(); };
  const onErr = (err: unknown): void => {
    if (inFb) return bubble(err);
    inFb = true;
    clear();
    try { createRoot((d) => { dispose = d; nodes = put(renderFallback(() => err, reset)); }, pOwner); }
    catch (fbErr) { bubble(fbErr); }
  };
  const run = (): void => {
    clear();
    try {
      createRoot((d) => {
        dispose = d;
        const own = getCurrentOwner();
        if (own) own.errorHandler = onErr;
        if (hydrateFirst) {
          hydrateFirst = false;
          nodes = runWithHydrationSubtree(w!, open!, close!, () => {
            w!.pushScope();
            const r = normalizeToNodeArray(renderChildren());
            const s = w!.popScope();
            return r.length > 0 ? r : s;
          }, () => put(renderChildren()));
        } else nodes = put(renderChildren());
      }, pOwner);
    } catch (err) { onErr(err); }
  };
  run();
  return end;
}

export function ErrorBoundary(props: ErrorBoundaryProps): Node[] {
  const f = document.createDocumentFragment();
  createErrorBoundary(
    f,
    () => props.slots?.default ? props.slots.default() : typeof props.children === "function" ? props.children() : (props.children ?? []),
    (err, reset) => toNodes(typeof props.fallback === "function" ? props.fallback(err(), reset) : props.fallback)
  );
  return [...f.childNodes];
}

const COPY: Record<string, readonly [string, string]> = {
  ar: ["حدث خطأ غير متوقع.", "إعادة تحميل"],
  fr: ["Une erreur est survenue.", "Recharger"],
  en: ["Something went wrong.", "Reload"]
};

export function handleRootFailure(
  err: unknown,
  source: "mount" | "hydrate",
  target: Element,
  owner: Owner | null,
  options: RootErrorConfig | undefined,
  renderDefault: boolean
): boolean {
  const onError = options?.onError ?? rootCfg.onError;
  const fallback = options?.fallback ?? rootCfg.fallback;
  reportError(err, { source }, owner);
  if (onError) onError(err, { ...extractErrorLocation(err), source, componentStack: collectComponentStack(owner) });
  const retry = (): void => { if (typeof location !== "undefined") location.reload(); };
  if (fallback) target.replaceChildren(...toNodes(fallback(err, retry)));
  else if (renderDefault && typeof document !== "undefined") {
    const [msg, btnTxt] = COPY[(document.documentElement?.getAttribute("lang") ?? "en").slice(0, 2).toLowerCase()] ?? COPY.en!;
    const box = document.createElement("div");
    box.setAttribute("role", "alert");
    box.setAttribute("style", "margin:48px auto;max-width:420px;font:14px system-ui");
    const p = document.createElement("p");
    p.textContent = msg;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = btnTxt;
    btn.addEventListener("click", retry);
    box.append(p, btn);
    target.replaceChildren(box);
  }
  return Boolean(onError || fallback);
}
