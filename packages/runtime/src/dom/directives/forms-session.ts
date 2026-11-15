/**
 * @dotmix/runtime/dom/directives/forms-session — F8 & F13 forms, CSRF, method & session helpers.
 */

import {
  createContext,
  createEffect,
  createMemo,
  getContext,
  getCurrentOwner,
  setContext,
  type Context as RuntimeContext
} from "../../core/index.js";
import type { FormController } from "../../forms/types.js";
import { createConditional } from "../control-flow.js";
import {
  createElement,
  createTextNode,
  insertNode,
  setText
} from "../nodes.js";
import type { FormErrorItem, RequestContext } from "./contract-types.js";

export const RequestContextKey: RuntimeContext<RequestContext | null> =
  createContext<RequestContext | null>(null);

const requestContextStack: RequestContext[] = [];
const parsedHydratedSessionCache = new WeakMap<Document, Record<string, unknown>>();

export function getActiveRequestContext(): RequestContext | null {
  if (getCurrentOwner()) {
    const ownerCtx = getContext(RequestContextKey);
    if (ownerCtx) {
      return ownerCtx;
    }
  }
  if (requestContextStack.length > 0) {
    return requestContextStack[requestContextStack.length - 1] ?? null;
  }
  return null;
}

export function __mixProvideRequestContext<T>(
  ctx: RequestContext,
  callback: () => T
): T {
  if (getCurrentOwner()) {
    setContext(RequestContextKey, ctx);
  }
  requestContextStack.push(ctx);
  try {
    return callback();
  } finally {
    requestContextStack.pop();
  }
}

export function __mixFieldError<F extends object>(
  form: FormController<F>,
  name: keyof F & string
): string | null {
  const field = form.field(name);
  if (!field.touched()) {
    return null;
  }
  return field.error();
}

export function __mixFormErrors<F extends object>(
  form: FormController<F>,
  names?: readonly (keyof F & string)[]
): readonly FormErrorItem<F>[] {
  const keys =
    names ?? (Object.keys(form.errors()) as Array<keyof F & string>);
  const out: FormErrorItem<F>[] = [];
  for (let i = 0; i < keys.length; i++) {
    const fieldName = keys[i]!;
    const msg = __mixFieldError(form, fieldName);
    if (msg !== null) {
      out.push({ field: fieldName, message: msg });
    }
  }
  return out;
}

export function __mixFieldValid<F extends object>(
  form: FormController<F>,
  name: keyof F & string
): boolean {
  const field = form.field(name);
  return field.touched() && field.error() === null && !field.validating();
}

export function __mixBindFieldError<F extends object>(
  parent: Node,
  form: FormController<F>,
  name: keyof F & string,
  renderWithMsg?: ((msgGetter: () => string) => Node | readonly Node[]) | null,
  anchor?: Node | null
): Comment {
  const msgMemo = createMemo(() => __mixFieldError(form, name));
  const msgGetter = (): string => msgMemo() ?? "";

  const renderBranch = (): Node | readonly Node[] => {
    if (renderWithMsg) {
      return renderWithMsg(msgGetter);
    }
    const span = createElement("span");
    span.setAttribute("class", "field-error");
    span.setAttribute("role", "alert");
    const text = createTextNode("");
    insertNode(span, text);
    createEffect(() => {
      setText(text, msgGetter());
    });
    return span;
  };

  return createConditional(
    parent,
    [
      {
        condition: () => msgMemo() !== null,
        render: renderBranch
      }
    ],
    null,
    anchor
  );
}

export function __mixBindFormErrors<F extends object>(
  parent: Node,
  form: FormController<F>,
  renderWithList: (listGetter: () => readonly FormErrorItem<F>[]) => Node | readonly Node[],
  anchor?: Node | null
): Comment {
  const listMemo = createMemo(() => __mixFormErrors(form));
  return createConditional(
    parent,
    [
      {
        condition: () => listMemo().length > 0,
        render: () => renderWithList(listMemo)
      }
    ],
    null,
    anchor
  );
}

export function __mixBindFieldValid<F extends object>(
  parent: Node,
  form: FormController<F>,
  name: keyof F & string,
  renderValid: () => Node | readonly Node[],
  anchor?: Node | null
): Comment {
  return createConditional(
    parent,
    [
      {
        condition: () => __mixFieldValid(form, name),
        render: renderValid
      }
    ],
    null,
    anchor
  );
}

export function __mixCsrfToken(metaName: string = "csrf-token"): string {
  const reqCtx = getActiveRequestContext();
  if (reqCtx) {
    return reqCtx.csrfToken();
  }
  if (typeof document !== "undefined") {
    const metas = document.getElementsByTagName("meta");
    for (let i = 0; i < metas.length; i++) {
      const meta = metas[i]!;
      if (meta.getAttribute("name") === metaName) {
        return meta.getAttribute("content") ?? "";
      }
    }
  }
  return "";
}

export function __mixCsrfHeader(): Readonly<Record<string, string>> {
  return { "X-CSRF-TOKEN": __mixCsrfToken() };
}

export function __mixCsrfInput(
  parent: Node,
  inputName: string = "_token",
  anchor?: Node | null
): HTMLInputElement {
  const input = createElement("input") as HTMLInputElement;
  input.setAttribute("type", "hidden");
  input.setAttribute("name", inputName);
  input.setAttribute("value", __mixCsrfToken());
  insertNode(parent, input, anchor ?? null);
  return input;
}

export function __mixMethodInput(
  parent: Node,
  method: "PUT" | "PATCH" | "DELETE",
  anchor?: Node | null
): HTMLInputElement {
  const input = createElement("input") as HTMLInputElement;
  input.setAttribute("type", "hidden");
  input.setAttribute("name", "_method");
  input.setAttribute("value", method);
  insertNode(parent, input, anchor ?? null);
  return input;
}

function readHydratedSessionStore(): Record<string, unknown> | null {
  const globalStore = (globalThis as { __MIX_SESSION__?: unknown }).__MIX_SESSION__;
  if (globalStore && typeof globalStore === "object") {
    return globalStore as Record<string, unknown>;
  }
  if (typeof document !== "undefined") {
    const cached = parsedHydratedSessionCache.get(document);
    if (cached) {
      return cached;
    }
    const scriptEl = document.getElementById("__mix_session__");
    if (scriptEl && scriptEl.textContent) {
      try {
        const parsed: unknown = JSON.parse(scriptEl.textContent);
        if (parsed && typeof parsed === "object") {
          parsedHydratedSessionCache.set(document, parsed as Record<string, unknown>);
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Ignore malformed hydrated session payload
      }
    }
  }
  return null;
}

export function __mixSession<T = unknown>(key: string): T | undefined {
  const reqCtx = getActiveRequestContext();
  if (reqCtx) {
    return reqCtx.session(key) as T | undefined;
  }
  const store = readHydratedSessionStore();
  if (store && Object.prototype.hasOwnProperty.call(store, key)) {
    return store[key] as T | undefined;
  }
  return undefined;
}

export function __mixSessionBlock<T = unknown>(
  parent: Node,
  key: string,
  renderWithVal: (valGetter: () => NonNullable<T>) => Node | readonly Node[],
  elseRender?: (() => Node | readonly Node[]) | null,
  anchor?: Node | null
): Comment {
  const value = __mixSession<T>(key);
  return createConditional(
    parent,
    [
      {
        condition: () => value !== null && value !== undefined,
        render: () => renderWithVal(() => value as NonNullable<T>)
      }
    ],
    elseRender,
    anchor
  );
}
