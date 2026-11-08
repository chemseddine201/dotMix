// packages/runtime/src/hmr/types.ts — FROZEN per MIX_SPEC_v3.2.2 §8
export interface HmrComponentRecord {
  readonly id: string;
  readonly signature: string;
  readonly methods: (scope: Record<string, unknown>) => Record<string, (...args: never[]) => unknown>;
  readonly render: (scope: Record<string, unknown>) => unknown;
}
