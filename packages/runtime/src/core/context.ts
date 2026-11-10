/**
 * @mix/runtime/core/context — Hierarchical Owner context inheritance.
 */

import { MixError, DiagnosticCodes } from "../errors.js";
import { OwnerState, type Context, type Owner } from "./types.js";
import { coreState } from "./state.js";

export function createContext<T>(defaultValue: T): Context<T> {
  return Object.freeze({
    id: Symbol("mix.context"),
    defaultValue
  });
}

export function setContext<T>(context: Context<T>, value: T): T {
  if (!coreState.currentOwner || coreState.currentOwner.ownerState === OwnerState.DISPOSED) {
    throw new MixError(
      DiagnosticCodes.MIX_ERR_REACTIVE_CYCLE,
      "setContext must be called within an active Owner scope."
    );
  }
  coreState.currentOwner.contexts.set(context.id, value);
  return value;
}

export function getContext<T>(context: Context<T>): T {
  let cursor: Owner | null = coreState.currentOwner;
  while (cursor !== null) {
    if (cursor.contexts.has(context.id)) {
      return cursor.contexts.get(context.id) as T;
    }
    cursor = cursor.parent ?? cursor.contextParent;
  }
  return context.defaultValue;
}

export const useContext = getContext;
export const provideContext = setContext;
