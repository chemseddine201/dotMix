/**
 * @dotmix/runtime/directives/types — Canonical prop interfaces for every directive component (§0, §2).
 */

import type { Context as RuntimeContext } from "../core/index.js";
import type { FormController } from "../forms/types.js";
import type { Action } from "../permissions/types.js";
import type {
  AuthGuards,
  AuthInstance,
  ComponentLoader,
  DirectiveComponent
} from "../dom/directives/contract-types.js";

export type Children = unknown;
export type Maybe<T> = T | (() => T);
export type Component<P extends object = Record<string, unknown>> = DirectiveComponent<P>;
export type Loader<P extends object = Record<string, unknown>> = ComponentLoader<P>;
export type Auth<
  TGuards extends AuthGuards = AuthGuards,
  TDefault extends keyof TGuards & string = keyof TGuards & string
> = AuthInstance<TGuards, TDefault>;

// F1: Conditionals
export interface IfProps {
  condition: Maybe<unknown>;
  children: Children;
}

export interface ElseIfProps {
  condition: Maybe<unknown>;
  children: Children;
}

export interface ElseProps {
  children: Children;
}

export interface UnlessProps {
  condition: Maybe<unknown>;
  else?: Children;
  children: Children;
}

export interface IsSetProps<T = unknown> {
  value: Maybe<T | null | undefined>;
  else?: Children;
  children: Children | ((value: NonNullable<T>) => Children);
}

export interface IsEmptyProps {
  value: Maybe<unknown>;
  else?: Children;
  children: Children;
}

// F2: Switch
export interface SwitchProps<T = unknown> {
  on?: Maybe<T> | undefined;
  children: Children;
}

export interface CaseProps<T = unknown> {
  is?: T | readonly T[] | undefined;
  condition?: Maybe<unknown> | undefined;
  children: Children;
}

export interface DefaultProps {
  children: Children;
}

// F3: Loops
export interface EachProps<T = unknown> {
  data: Maybe<readonly T[]>;
  key?: ((item: T, index: number) => PropertyKey) | undefined;
  skip?: ((item: T, index: number) => boolean) | undefined;
  stop?: ((item: T, index: number) => boolean) | undefined;
  fallback?: Children;
  children: ((item: T, index: () => number) => Children) | Children;
}

export interface EachRenderProps<T = unknown, K extends string = "item"> {
  data: Maybe<readonly T[]>;
  render: Component<Record<K, T>>;
  as?: K | undefined;
  key?: ((item: T) => PropertyKey) | undefined;
  fallback?: Children;
  children?: Children;
}

export interface EmptyProps {
  children: Children;
}

export interface ForProps {
  from?: Maybe<number> | undefined;
  to?: Maybe<number> | undefined;
  step?: Maybe<number> | undefined;
  times?: Maybe<number> | undefined;
  children: (index: number) => Children;
}

// F4: Async
export interface AwaitProps<T = unknown> {
  promise: Maybe<Promise<T>>;
  pending?: Children;
  catch?: ((error: unknown) => Children) | undefined;
  children: (value: T) => Children;
}

// F5: Authentication
export interface AuthProps<U = unknown> {
  guard?: string | undefined;
  role?: string | readonly string[] | undefined;
  else?: Children;
  children: Children | ((user: U) => Children);
}

export interface GuestProps {
  guard?: string | undefined;
  else?: Children;
  children: Children;
}

// F6: Authorization
export interface ElseCanProps {
  I: Action;
  this?: unknown;
  a?: string | undefined;
  an?: string | undefined;
  field?: string | undefined;
  children: Children;
}

export interface CannotProps extends ElseCanProps {
  else?: Children;
}

export interface CanAnyProps {
  I: readonly Action[];
  this?: unknown;
  a?: string | undefined;
  an?: string | undefined;
  else?: Children;
  children: Children;
}

// F7: Environment & Context
export interface DevProps {
  children: Children;
}

export interface ProductionProps {
  children: Children;
}

export interface EnvProps {
  is: string | readonly string[];
  else?: Children;
  children: Children;
}

export interface ContextProps<T = unknown> {
  of: RuntimeContext<T>;
  else?: Children;
  children: (value: NonNullable<T>) => Children;
}

// F8: Forms, CSRF & Method
export interface FieldErrorProps<F extends object = Record<string, unknown>> {
  form: FormController<F>;
  name: keyof F & string;
  children?: ((message: string) => Children) | undefined;
}

export interface FormErrorsProps<F extends object = Record<string, unknown>> {
  form: FormController<F>;
  children: (list: readonly { field: keyof F & string; message: string }[]) => Children;
}

export interface FieldValidProps<F extends object = Record<string, unknown>> {
  form: FormController<F>;
  name: keyof F & string;
  children: Children;
}

export type CsrfProps = Record<string, never>;

export interface MethodProps {
  value: "PUT" | "PATCH" | "DELETE";
}

// F9: Sections, Stacks & Head
export interface SectionProps {
  name: string;
  children: Children;
}

export interface YieldProps {
  name: string;
  fallback?: Children;
  children?: Children;
}

export interface HasSectionProps {
  name: string;
  children: Children;
}

export interface SectionMissingProps {
  name: string;
  children: Children;
}

export interface PushProps {
  to: string;
  once?: string | undefined;
  children: Children;
}

export interface PrependProps {
  to: string;
  once?: string | undefined;
  children: Children;
}

export interface StackProps {
  name: string;
}

export interface HeadProps {
  children: Children;
}

export interface TitleProps {
  children: Children;
}

export interface MetaProps {
  name?: string | undefined;
  property?: string | undefined;
  "http-equiv"?: string | undefined;
  content?: Maybe<string> | undefined;
  charset?: string | undefined;
}

export interface LinkProps {
  rel: string;
  href?: Maybe<string> | undefined;
  as?: string | undefined;
  type?: string | undefined;
  media?: string | undefined;
  crossorigin?: string | undefined;
}

// F10: Composition
export interface IncludeProps<P extends object = Record<string, unknown>> {
  component: Component<P> | Loader<P>;
  props?: P | undefined;
  condition?: Maybe<unknown> | undefined;
  unless?: Maybe<unknown> | undefined;
  pending?: Children;
  fallback?: Children;
}

export interface IncludeFirstProps<P extends object = Record<string, unknown>> {
  candidates: readonly Loader<P>[];
  props?: P | undefined;
  pending?: Children;
  fallback?: Children;
  children?: Children;
}

// F11: Render control
export interface OnceProps {
  children: Children;
}

export interface MemoProps {
  on: readonly Maybe<unknown>[];
  equals?: ((prev: readonly unknown[], next: readonly unknown[]) => boolean) | undefined;
  children: Children;
}

export interface LazyProps {
  trigger?: "visible" | "idle" | undefined;
  fallback?: Children;
  children: Children;
}

export type HydrateWhen = "load" | "idle" | "visible" | "never" | `media ${string}` | "media";

export interface HydrateProps {
  when: HydrateWhen;
  media?: string | undefined;
  children: Children;
}

// F13: Server rendering
export interface SessionProps<T = unknown> {
  key: string;
  else?: Children;
  children: (value: T) => Children;
}

export interface PartialProps {
  name: string;
  children: Children;
}

export interface JsonProps<T = unknown> {
  id: string;
  data: Maybe<T>;
}

// F14: Debug & text
export interface DumpProps {
  value: Maybe<unknown>;
}

export interface VerbatimProps {
  children: Children;
}
