/**
 * @mix/sync — Last-Write-Wins Register CRDT
 */

import type { MutationId } from "../types.js";
import { compareMutationIds } from "./clock.js";

export class LWWRegister<T> {
  private _value: T;
  private _mutationId: MutationId;

  constructor(initialValue: T, initialMutationId: MutationId) {
    this._value = initialValue;
    this._mutationId = initialMutationId;
  }

  get value(): T {
    return this._value;
  }

  get mutationId(): MutationId {
    return this._mutationId;
  }

  set(newValue: T, mutationId: MutationId): boolean {
    if (compareMutationIds(mutationId, this._mutationId) >= 0) {
      this._value = newValue;
      this._mutationId = mutationId;
      return true;
    }
    return false;
  }

  merge(remoteValue: T, remoteMutationId: MutationId): boolean {
    return this.set(remoteValue, remoteMutationId);
  }

  toJSON(): { value: T; mutationId: MutationId } {
    return {
      value: this._value,
      mutationId: this._mutationId,
    };
  }

  static fromJSON<T>(json: { value: T; mutationId: MutationId }): LWWRegister<T> {
    return new LWWRegister<T>(json.value, json.mutationId);
  }
}

