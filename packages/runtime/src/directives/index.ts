/**
 * @dotmix/runtime/directives — Component declarations, props types, auth contract,
 * and compile-time directive stubs for Dual-Mode Directives.
 */

import { DiagnosticCodes, MixError } from "../errors.js";
import type {
  AuthProps,
  AwaitProps,
  CanAnyProps,
  CannotProps,
  CaseProps,
  ContextProps,
  CsrfProps,
  DefaultProps,
  DevProps,
  DumpProps,
  EachProps,
  EachRenderProps,
  ElseCanProps,
  ElseIfProps,
  ElseProps,
  EmptyProps,
  EnvProps,
  FieldErrorProps,
  FieldValidProps,
  ForProps,
  FormErrorsProps,
  GuestProps,
  HasSectionProps,
  HeadProps,
  IfProps,
  IncludeFirstProps,
  IncludeProps,
  IsEmptyProps,
  IsSetProps,
  JsonProps,
  LazyProps,
  LinkProps,
  MemoProps,
  MetaProps,
  MethodProps,
  OnceProps,
  PartialProps,
  PrependProps,
  ProductionProps,
  PushProps,
  SectionMissingProps,
  SectionProps,
  SessionProps,
  StackProps,
  SwitchProps,
  TitleProps,
  UnlessProps,
  VerbatimProps,
  YieldProps
} from "./types.js";

export * from "./types.js";

export { Can, type CanProps } from "../permissions/Can.js";
export {
  KeepAlive,
  createKeepAlive,
  type KeepAliveProps,
  type KeepAliveHandle
} from "../dom/keep-alive.js";
export {
  AuthProvider,
  createAuth,
  useAuth,
  type AuthContract,
  type AuthGuards,
  type AuthInstance,
  type AuthInstanceOf,
  type AuthProviderProps,
  type GuardUser,
  type Register,
  type RegisteredAuth
} from "../dom/directives/contract.js";

function notCompiled(name: string): never {
  throw new MixError(
    DiagnosticCodes.MIX_ERR_DIRECTIVE_NOT_COMPILED,
    `Directive component <${name}> must be compiled by @dotmix/compiler-semantic and cannot be invoked directly at runtime.`
  );
}

// F1: Conditionals
export function If(_props: IfProps): unknown {
  return notCompiled("If");
}

export function ElseIf(_props: ElseIfProps): unknown {
  return notCompiled("ElseIf");
}

export function Else(_props: ElseProps): unknown {
  return notCompiled("Else");
}

export function Unless(_props: UnlessProps): unknown {
  return notCompiled("Unless");
}

export function IsSet<T = unknown>(_props: IsSetProps<T>): unknown {
  return notCompiled("IsSet");
}

export function IsEmpty(_props: IsEmptyProps): unknown {
  return notCompiled("IsEmpty");
}

// F2: Switch
export function Switch<T = unknown>(_props: SwitchProps<T>): unknown {
  return notCompiled("Switch");
}

export function Case<T = unknown>(_props: CaseProps<T>): unknown {
  return notCompiled("Case");
}

export function Default(_props: DefaultProps): unknown {
  return notCompiled("Default");
}

// F3: Loops
export function Each<T = unknown>(_props: EachProps<T>): unknown;
export function Each<T = unknown, K extends string = "item">(
  _props: EachRenderProps<T, K>
): unknown;
export function Each(_props: EachProps<unknown> | EachRenderProps<unknown, string>): unknown {
  return notCompiled("Each");
}

export function Empty(_props: EmptyProps): unknown {
  return notCompiled("Empty");
}

export function For(_props: ForProps): unknown {
  return notCompiled("For");
}

// F4: Async
export function Await<T = unknown>(_props: AwaitProps<T>): unknown {
  return notCompiled("Await");
}

// F5: Authentication
export function Auth<U = unknown>(_props: AuthProps<U>): unknown {
  return notCompiled("Auth");
}

export function Guest(_props: GuestProps): unknown {
  return notCompiled("Guest");
}

// F6: Authorization
export function ElseCan(_props: ElseCanProps): unknown {
  return notCompiled("ElseCan");
}

export function Cannot(_props: CannotProps): unknown {
  return notCompiled("Cannot");
}

export function CanAny(_props: CanAnyProps): unknown {
  return notCompiled("CanAny");
}

// F7: Environment & Context
export function Dev(_props: DevProps): unknown {
  return notCompiled("Dev");
}

export function Production(_props: ProductionProps): unknown {
  return notCompiled("Production");
}

export function Env(_props: EnvProps): unknown {
  return notCompiled("Env");
}

export function Context<T = unknown>(_props: ContextProps<T>): unknown {
  return notCompiled("Context");
}

// F8: Forms, CSRF & Method
export function FieldError<F extends object = Record<string, unknown>>(
  _props: FieldErrorProps<F>
): unknown {
  return notCompiled("FieldError");
}

export function FormErrors<F extends object = Record<string, unknown>>(
  _props: FormErrorsProps<F>
): unknown {
  return notCompiled("FormErrors");
}

export function FieldValid<F extends object = Record<string, unknown>>(
  _props: FieldValidProps<F>
): unknown {
  return notCompiled("FieldValid");
}

export function Csrf(_props?: CsrfProps): unknown {
  return notCompiled("Csrf");
}

export function Method(_props: MethodProps): unknown {
  return notCompiled("Method");
}

// F9: Sections, Stacks & Head
export function Section(_props: SectionProps): unknown {
  return notCompiled("Section");
}

export function Yield(_props: YieldProps): unknown {
  return notCompiled("Yield");
}

export function HasSection(_props: HasSectionProps): unknown {
  return notCompiled("HasSection");
}

export function SectionMissing(_props: SectionMissingProps): unknown {
  return notCompiled("SectionMissing");
}

export function Push(_props: PushProps): unknown {
  return notCompiled("Push");
}

export function Prepend(_props: PrependProps): unknown {
  return notCompiled("Prepend");
}

export function Stack(_props: StackProps): unknown {
  return notCompiled("Stack");
}

export function Head(_props: HeadProps): unknown {
  return notCompiled("Head");
}

export function Title(_props: TitleProps): unknown {
  return notCompiled("Title");
}

export function Meta(_props: MetaProps): unknown {
  return notCompiled("Meta");
}

export function Link(_props: LinkProps): unknown {
  return notCompiled("Link");
}

// F10: Composition
export function Include<P extends object = Record<string, unknown>>(
  _props: IncludeProps<P>
): unknown {
  return notCompiled("Include");
}

export function IncludeFirst<P extends object = Record<string, unknown>>(
  _props: IncludeFirstProps<P>
): unknown {
  return notCompiled("IncludeFirst");
}

// F11: Render control
export function Once(_props: OnceProps): unknown {
  return notCompiled("Once");
}

export function Memo(_props: MemoProps): unknown {
  return notCompiled("Memo");
}

export function Lazy(_props: LazyProps): unknown {
  return notCompiled("Lazy");
}

// F13: Server rendering
export function Session<T = unknown>(_props: SessionProps<T>): unknown {
  return notCompiled("Session");
}

export function Partial(_props: PartialProps): unknown {
  return notCompiled("Partial");
}

export function Json<T = unknown>(_props: JsonProps<T>): unknown {
  return notCompiled("Json");
}

// F14: Debug & text
export function Dump(_props: DumpProps): unknown {
  return notCompiled("Dump");
}

export function Verbatim(_props: VerbatimProps): unknown {
  return notCompiled("Verbatim");
}
