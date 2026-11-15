/**
 * @dotmix/runtime/dom/directives/contract-types — Shared TypeScript contract types
 * for Gate 38 Dual-Mode Directives runtime helpers (T-38.0b).
 */

export type DirectiveChildren = unknown;
export type MaybeReactive<T> = T | (() => T);
export type RenderResult = Node | readonly Node[] | null | undefined;
export type BranchRenderer = () => RenderResult;

export type DirectiveComponent<P extends object = Record<string, unknown>> = (
  props: P
) => unknown;

export type ComponentLoader<P extends object = Record<string, unknown>> = () => Promise<{
  readonly default: DirectiveComponent<P>;
}>;

export interface SwitchValueCase {
  readonly kind: "values";
  readonly values: () => readonly unknown[];
  readonly render: () => Node | readonly Node[];
}

export interface SwitchConditionCase {
  readonly kind: "condition";
  readonly condition: () => unknown;
  readonly render: () => Node | readonly Node[];
}

export type SwitchCase = SwitchValueCase | SwitchConditionCase;

export type ForRangeSpec =
  | {
      readonly kind: "range";
      readonly from: () => number;
      readonly to: () => number;
      readonly step?: (() => number) | undefined;
    }
  | {
      readonly kind: "times";
      readonly count: () => number;
    };

export interface EachPipelineOptions<T> {
  readonly skip?: ((item: T, index: number) => boolean) | undefined;
  readonly stop?: ((item: T, index: number) => boolean) | undefined;
  readonly filter?: ((item: T, index: number) => boolean) | undefined;
  readonly sort?: ((a: T, b: T) => number) | undefined;
  readonly limit?: number | undefined;
  readonly paginate?:
    | {
        readonly page: number;
        readonly perPage: number;
      }
    | undefined;
}

export interface IncludeMountOptions {
  readonly condition?: (() => unknown) | undefined;
  readonly unless?: (() => unknown) | undefined;
  readonly pending?: (() => Node | readonly Node[]) | undefined;
  readonly fallback?: (() => Node | readonly Node[]) | undefined;
}

/** The guard functions of an auth contract, keyed by guard name. */
export type AuthGuards = Readonly<Record<string, () => unknown>>;

/** The signed-in user type returned by one guard, without `null` and `undefined`. */
export type GuardUser<TGuards extends AuthGuards, TGuard extends keyof TGuards> = Exclude<
  ReturnType<TGuards[TGuard]>,
  null | undefined
>;

export interface AuthContract<
  TGuards extends AuthGuards,
  TDefault extends keyof TGuards & string
> {
  readonly guards: TGuards;
  readonly defaultGuard?: TDefault;
  readonly hasRole?: (user: GuardUser<TGuards, keyof TGuards>, role: string) => boolean;
}

export interface AuthInstance<
  TGuards extends AuthGuards = AuthGuards,
  TDefault extends keyof TGuards & string = keyof TGuards & string
> {
  readonly defaultGuard: TDefault;
  user<TGuard extends keyof TGuards & string = TDefault>(
    guard?: TGuard
  ): GuardUser<TGuards, TGuard> | null;
  check(guard?: keyof TGuards & string): boolean;
  guest(guard?: keyof TGuards & string): boolean;
  hasRole(user: GuardUser<TGuards, keyof TGuards>, role: string): boolean;
  hasAnyRole(
    user: GuardUser<TGuards, keyof TGuards>,
    roles: readonly string[],
    guard?: keyof TGuards & string
  ): boolean;
}

/** Hand-written registration: AuthInstanceOf<{ web: Customer }, "web"> */
export type AuthInstanceOf<
  TUsers extends Record<string, unknown>,
  TDefault extends keyof TUsers & string
> = AuthInstance<{ readonly [TGuard in keyof TUsers]: () => TUsers[TGuard] | null }, TDefault>;

/** Augmented by applications. Empty by default. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- augmented by applications
export interface Register {}

/** The application's registered auth instance (`Register.auth`), or the untyped instance. */
export type RegisteredAuth = Register extends { auth: infer TAuth } ? TAuth : AuthInstance;

/** Accepts every auth instance, whatever its guards (`AuthInstance` is invariant in its guards). */
export interface AuthProviderValue {
  readonly defaultGuard: string;
  user(guard?: string): unknown;
  check(guard?: string): boolean;
  guest(guard?: string): boolean;
}

export interface AuthProviderProps {
  readonly value: AuthProviderValue;
  readonly children?: unknown;
}

export interface AuthCheckOptions {
  readonly guard?: string | undefined;
  readonly roles?: readonly string[] | undefined;
}

export interface FormErrorItem<F extends object = Record<string, unknown>> {
  readonly field: keyof F & string;
  readonly message: string;
}

export interface RequestContext {
  session(key: string): unknown;
  csrfToken(): string;
}

export interface StackCollector {
  push(stackName: string, content: string, onceId?: string): void;
  prepend(stackName: string, content: string, onceId?: string): void;
  render(stackName: string): string;
  has(stackName: string): boolean;
  getEntries(stackName: string): readonly string[];
}

export type HeadTagSpec =
  | { readonly kind: "title"; readonly text: () => string }
  | { readonly kind: "meta"; readonly attrs: () => Readonly<Record<string, string>> }
  | { readonly kind: "link"; readonly attrs: () => Readonly<Record<string, string>> };

export type HeadTagRecord =
  | { readonly kind: "title"; readonly text: string }
  | { readonly kind: "meta"; readonly attrs: Readonly<Record<string, string>> }
  | { readonly kind: "link"; readonly attrs: Readonly<Record<string, string>> };

export interface HeadCollector {
  addTitle(text: string): void;
  addMeta(attrs: Readonly<Record<string, string>>): void;
  addLink(attrs: Readonly<Record<string, string>>): void;
  getTags(): readonly HeadTagRecord[];
  renderHtml(): string;
  renderToHeadHtml(): string;
}

export interface AwaitTimeoutBranches<T> {
  readonly pending: () => Node | readonly Node[];
  readonly then: (valGetter: () => T) => Node | readonly Node[];
  readonly catch?: ((errGetter: () => unknown) => Node | readonly Node[]) | undefined;
  readonly timeout?: (() => Node | readonly Node[]) | undefined;
}

export interface EventModifiers {
  readonly prevent?: boolean | undefined;
  readonly stop?: boolean | undefined;
  readonly self?: boolean | undefined;
  readonly once?: boolean | undefined;
  readonly capture?: boolean | undefined;
  readonly passive?: boolean | undefined;
  readonly debounce?: number | undefined;
  readonly throttle?: number | undefined;
  readonly window?: boolean | undefined;
  readonly document?: boolean | undefined;
  readonly outside?: boolean | undefined;
  readonly keys?: readonly string[] | undefined;
  readonly enter?: boolean | undefined;
  readonly esc?: boolean | undefined;
  readonly tab?: boolean | undefined;
  readonly space?: boolean | undefined;
  readonly ctrl?: boolean | undefined;
  readonly shift?: boolean | undefined;
  readonly alt?: boolean | undefined;
  readonly meta?: boolean | undefined;
}

export interface AttrMatchCase {
  readonly token: string;
  readonly value: () => unknown;
}
