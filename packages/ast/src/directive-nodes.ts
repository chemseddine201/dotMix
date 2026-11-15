/**
 * @dotmix/ast/directive-nodes — Dual-mode directive AST node definitions, constructors, walker, and canonical grammar table.
 */

import type { SourceSpan } from "@dotmix/diagnostics";
import type { ESTreeNode } from "./estree.js";
import { validateSpan, deepFreeze } from "./spans.js";
import type { ASTNodeBase, ASTNode, AttributeNode, TemplateNode } from "./template-nodes.js";

export type DirectiveForm = "block" | "component";

interface FormBase extends ASTNodeBase { readonly form: DirectiveForm; }
interface BranchPairBase extends FormBase { readonly consequent: readonly TemplateNode[]; readonly alternate: readonly TemplateNode[] | null; }
interface CanTargetFields { readonly subject: ESTreeNode | null; readonly rawSubject: string | null; readonly subjectType: ESTreeNode | null; readonly rawSubjectType: string | null; }
interface FormFieldTargetFields { readonly formExpr: ESTreeNode; readonly rawFormExpr: string; readonly fieldName: ESTreeNode; readonly rawFieldName: string; }
interface NamedBlockBase extends FormBase { readonly name: ESTreeNode; readonly rawName: string; readonly children: readonly TemplateNode[]; }
interface IncludeSharedBase extends FormBase { readonly props: ESTreeNode | null; readonly rawProps: string | null; readonly pending: readonly TemplateNode[]; readonly fallback: readonly TemplateNode[]; }

export interface UnlessBlockNode extends BranchPairBase { readonly type: "UnlessBlock"; readonly condition: ESTreeNode; readonly rawCondition: string; }
export interface IsSetBlockNode extends BranchPairBase { readonly type: "IsSetBlock"; readonly value: ESTreeNode; readonly rawValue: string; readonly asIdentifier: string | null; }
export interface IsEmptyBlockNode extends BranchPairBase { readonly type: "IsEmptyBlock"; readonly value: ESTreeNode; readonly rawValue: string; }

export interface SwitchCaseBranch extends ASTNodeBase {
  readonly kind: "values" | "condition";
  readonly values: readonly ESTreeNode[];
  readonly rawValues: readonly string[];
  readonly condition: ESTreeNode | null;
  readonly rawCondition: string | null;
  readonly body: readonly TemplateNode[];
}

export interface SwitchBlockNode extends FormBase {
  readonly type: "SwitchBlock";
  readonly subject: ESTreeNode | null;
  readonly rawSubject: string | null;
  readonly cases: readonly SwitchCaseBranch[];
  readonly defaultBranch: readonly TemplateNode[] | null;
}

export interface LoopControlDirective extends ASTNodeBase { readonly kind: "continue" | "break"; readonly condition: ESTreeNode; readonly rawCondition: string; }

export interface EachExtNode extends FormBase {
  readonly type: "EachExtBlock";
  readonly collection: ESTreeNode;
  readonly rawCollection: string;
  readonly itemIdentifier: string;
  readonly indexIdentifier: string | null;
  readonly keyExpression: ESTreeNode | null;
  readonly rawKeyExpression: string | null;
  readonly controls: readonly LoopControlDirective[];
  readonly skipExpression: ESTreeNode | null;
  readonly rawSkipExpression: string | null;
  readonly stopExpression: ESTreeNode | null;
  readonly rawStopExpression: string | null;
  readonly renderComponent: ESTreeNode | null;
  readonly rawRenderComponent: string | null;
  readonly renderPropName: string | null;
  readonly children: readonly TemplateNode[];
  readonly empty: readonly TemplateNode[];
}

export interface ForBlockNode extends FormBase {
  readonly type: "ForBlock";
  readonly variant: "range" | "times";
  readonly itemIdentifier: string | null;
  readonly from: ESTreeNode | null;
  readonly rawFrom: string | null;
  readonly to: ESTreeNode | null;
  readonly rawTo: string | null;
  readonly step: ESTreeNode | null;
  readonly rawStep: string | null;
  readonly times: ESTreeNode | null;
  readonly rawTimes: string | null;
  readonly children: readonly TemplateNode[];
}

export interface AuthBlockNode extends BranchPairBase {
  readonly type: "AuthBlock";
  readonly guard: ESTreeNode | null;
  readonly rawGuard: string | null;
  readonly roles: readonly ESTreeNode[];
  readonly rawRoles: readonly string[];
  readonly roleExpression: ESTreeNode | null;
  readonly rawRoleExpression: string | null;
  readonly asIdentifier: string | null;
  /** Type annotation of the render callback parameter: `<Auth>{(user: AdminUser) => ...}</Auth>`. */
  readonly asTypeAnnotation?: ParameterTypeAnnotation | null | undefined;
}

export interface GuestBlockNode extends BranchPairBase { readonly type: "GuestBlock"; readonly guard: ESTreeNode | null; readonly rawGuard: string | null; }
export interface CanBranch extends ASTNodeBase, CanTargetFields { readonly action: ESTreeNode; readonly rawAction: string; readonly field: ESTreeNode | null; readonly rawField: string | null; readonly body: readonly TemplateNode[]; }
export interface CanChainNode extends FormBase { readonly type: "CanChain"; readonly branches: readonly CanBranch[]; readonly alternate: readonly TemplateNode[] | null; }
export interface CannotBlockNode extends BranchPairBase, CanTargetFields { readonly type: "CannotBlock"; readonly action: ESTreeNode; readonly rawAction: string; readonly field: ESTreeNode | null; readonly rawField: string | null; }
export interface CanAnyBlockNode extends BranchPairBase, CanTargetFields { readonly type: "CanAnyBlock"; readonly actions: ESTreeNode; readonly rawActions: string; }
export interface EnvGateNode extends BranchPairBase { readonly type: "EnvGate"; readonly mode: "dev" | "production" | "env"; readonly environments: readonly string[]; readonly rawExpression: ESTreeNode | null; readonly rawExpressionText: string | null; }
export interface ContextBlockNode extends BranchPairBase { readonly type: "ContextBlock"; readonly contextExpr: ESTreeNode; readonly rawContextExpr: string; readonly asIdentifier: string | null; }
export interface FieldErrorNode extends FormBase, FormFieldTargetFields { readonly type: "FieldError"; readonly asIdentifier: string | null; readonly children: readonly TemplateNode[]; }
export interface FormErrorsNode extends FormBase { readonly type: "FormErrors"; readonly formExpr: ESTreeNode; readonly rawFormExpr: string; readonly asIdentifier: string | null; readonly children: readonly TemplateNode[]; }
export interface FieldValidNode extends FormBase, FormFieldTargetFields { readonly type: "FieldValid"; readonly children: readonly TemplateNode[]; }
export interface CsrfNode extends FormBase { readonly type: "Csrf"; }
export interface MethodNode extends FormBase { readonly type: "Method"; readonly value: ESTreeNode; readonly rawValue: string; }
export interface SectionNode extends NamedBlockBase { readonly type: "Section"; }
export interface HasSectionNode extends NamedBlockBase { readonly type: "HasSection"; }
export interface SectionMissingNode extends NamedBlockBase { readonly type: "SectionMissing"; }
export interface PartialNode extends NamedBlockBase { readonly type: "Partial"; }
export interface YieldNode extends FormBase { readonly type: "Yield"; readonly name: ESTreeNode; readonly rawName: string; readonly fallback: readonly TemplateNode[]; }
export interface StackPushNode extends FormBase { readonly type: "StackPush"; readonly operation: "push" | "prepend"; readonly target: ESTreeNode; readonly rawTarget: string; readonly onceId: ESTreeNode | null; readonly rawOnceId: string | null; readonly children: readonly TemplateNode[]; }
export interface StackNode extends FormBase { readonly type: "Stack"; readonly name: ESTreeNode; readonly rawName: string; }
export interface HeadChildEntry extends ASTNodeBase { readonly tag: "title" | "meta" | "link"; readonly attributes: readonly AttributeNode[]; readonly children: readonly TemplateNode[]; }
export interface HeadGroupNode extends FormBase { readonly type: "HeadGroup"; readonly entries: readonly HeadChildEntry[]; readonly children: readonly TemplateNode[]; }
export interface IncludeNode extends IncludeSharedBase { readonly type: "Include"; readonly component: ESTreeNode; readonly rawComponent: string; readonly condition: ESTreeNode | null; readonly rawCondition: string | null; readonly unless: ESTreeNode | null; readonly rawUnless: string | null; }
export interface IncludeFirstNode extends IncludeSharedBase { readonly type: "IncludeFirst"; readonly candidates: ESTreeNode; readonly rawCandidates: string; }
export interface OnceNode extends FormBase { readonly type: "Once"; readonly children: readonly TemplateNode[]; }
export interface MemoNode extends FormBase { readonly type: "Memo"; readonly deps: ESTreeNode; readonly rawDeps: string; readonly equals: ESTreeNode | null; readonly rawEquals: string | null; readonly children: readonly TemplateNode[]; }
export interface LazyNode extends FormBase { readonly type: "Lazy"; readonly trigger: "visible" | "idle"; readonly triggerExpr: ESTreeNode | null; readonly rawTriggerExpr: string | null; readonly fallback: readonly TemplateNode[]; readonly children: readonly TemplateNode[]; }
export interface KeepAliveBlockNode extends FormBase { readonly type: "KeepAliveBlock"; readonly activeKey: ESTreeNode; readonly rawActiveKey: string; readonly max: ESTreeNode | null; readonly rawMax: string | null; readonly asIdentifier: string | null; readonly children: readonly TemplateNode[]; }
export interface SessionBlockNode extends BranchPairBase { readonly type: "SessionBlock"; readonly key: ESTreeNode; readonly rawKey: string; readonly asIdentifier: string | null; }
export interface JsonNode extends FormBase { readonly type: "Json"; readonly id: ESTreeNode; readonly rawId: string; readonly data: ESTreeNode; readonly rawData: string; }
export interface DumpNode extends FormBase { readonly type: "Dump"; readonly value: ESTreeNode; readonly rawValue: string; }
export interface VerbatimNode extends FormBase { readonly type: "Verbatim"; readonly content: string; }
/** The source text of a parameter type annotation and its offset in the component source. */
export interface ParameterTypeAnnotation { readonly raw: string; readonly start: number; }

export interface TemplateRenderFunctionNode extends ASTNodeBase {
  readonly type: "TemplateRenderFunction";
  readonly params: readonly string[];
  /** One entry per parameter: its type annotation, or null when the parameter is not annotated. */
  readonly paramTypes?: readonly (ParameterTypeAnnotation | null)[] | undefined;
  readonly body: readonly TemplateNode[];
}

export interface ConditionalAttributeNode extends ASTNodeBase {
  readonly type: "ConditionalAttribute";
  readonly name: string;
  readonly modifier: "if" | "unless" | "else" | "match" | "case";
  readonly caseToken: string | null;
  readonly expression: ESTreeNode | null;
  readonly rawExpression: string;
  readonly isStatic: boolean;
  readonly staticValue: string | null;
}

export interface ConditionalEventNode extends ASTNodeBase {
  readonly type: "ConditionalEvent";
  readonly eventName: string;
  readonly rawName: string;
  readonly modifier: "if" | "unless" | "else";
  readonly expression: ESTreeNode;
  readonly rawExpression: string;
}

export interface ClassMapNode extends ASTNodeBase { readonly type: "ClassMap"; readonly kind: "object" | "array" | "directive"; readonly className: string | null; readonly expression: ESTreeNode; readonly rawExpression: string; }
export interface StyleMapNode extends ASTNodeBase { readonly type: "StyleMap"; readonly kind: "object" | "directive"; readonly property: string | null; readonly expression: ESTreeNode; readonly rawExpression: string; }
export interface ConditionalSpreadNode extends ASTNodeBase { readonly type: "ConditionalSpread"; readonly spreadExpression: ESTreeNode; readonly rawSpreadExpression: string; readonly condition: ESTreeNode | null; readonly rawCondition: string | null; }

export type DirectiveModifierAttributeNode =
  | ConditionalAttributeNode
  | ConditionalEventNode
  | ClassMapNode
  | StyleMapNode
  | ConditionalSpreadNode;

export type DirectiveTemplateNode =
  | UnlessBlockNode | IsSetBlockNode | IsEmptyBlockNode | SwitchBlockNode
  | EachExtNode | ForBlockNode | AuthBlockNode | GuestBlockNode
  | CanChainNode | CannotBlockNode | CanAnyBlockNode | EnvGateNode
  | ContextBlockNode | FieldErrorNode | FormErrorsNode | FieldValidNode
  | CsrfNode | MethodNode | SectionNode | YieldNode
  | HasSectionNode | SectionMissingNode | StackPushNode | StackNode
  | HeadGroupNode | IncludeNode | IncludeFirstNode | OnceNode
  | MemoNode | LazyNode | KeepAliveBlockNode | SessionBlockNode
  | PartialNode | JsonNode | DumpNode | VerbatimNode
  | TemplateRenderFunctionNode;

export interface DirectiveBranchGrammar {
  readonly name: string;
  readonly parentId: string;
  readonly role: "branch" | "subcomponent";
  readonly blockMarker: string | null;
  readonly importSource: string;
}

export interface DirectiveGrammarEntry {
  readonly id: string;
  readonly blockOpen: string;
  readonly blockClose: string | null;
  readonly branchMarkers: readonly string[];
  readonly inlineStatements: readonly string[];
  readonly componentName: string;
  readonly branchComponents: readonly DirectiveBranchGrammar[];
  readonly rawTextMode: boolean;
  readonly voidBlock: boolean;
  readonly supportsElse: boolean;
  readonly importSources: readonly string[];
}

export const DIRECTIVES_IMPORT_PATH = "@dotmix/runtime/directives" as const;
export const PERMISSIONS_IMPORT_PATH = "@dotmix/runtime/permissions" as const;

const br = (name: string, parentId: string, blockMarker: string | null, role: "branch" | "subcomponent" = "branch"): DirectiveBranchGrammar => ({
  name, parentId, role, blockMarker, importSource: DIRECTIVES_IMPORT_PATH
});

const dg = (
  id: string,
  blockOpen: string,
  blockClose: string | null,
  componentName: string,
  opts: Partial<Omit<DirectiveGrammarEntry, "id" | "blockOpen" | "blockClose" | "componentName" | "voidBlock">> = {}
): DirectiveGrammarEntry => ({
  id,
  blockOpen,
  blockClose,
  componentName,
  branchMarkers: opts.branchMarkers ?? [],
  inlineStatements: opts.inlineStatements ?? [],
  branchComponents: opts.branchComponents ?? [],
  rawTextMode: opts.rawTextMode ?? false,
  voidBlock: blockClose === null,
  supportsElse: opts.supportsElse ?? false,
  importSources: opts.importSources ?? [DIRECTIVES_IMPORT_PATH]
});

export const DIRECTIVE_GRAMMAR = deepFreeze({
  directives: [
    dg("if", "if", "endif", "If", { branchMarkers: ["elseif", "else"], branchComponents: [br("ElseIf", "if", "elseif"), br("Else", "if", "else")], supportsElse: true }),
    dg("unless", "unless", "endunless", "Unless", { branchMarkers: ["else"], branchComponents: [br("Else", "unless", "else")], supportsElse: true }),
    dg("isset", "isset", "endisset", "IsSet", { branchMarkers: ["else"], branchComponents: [br("Else", "isset", "else")], supportsElse: true }),
    dg("isempty", "isempty", "endisempty", "IsEmpty", { branchMarkers: ["else"], branchComponents: [br("Else", "isempty", "else")], supportsElse: true }),
    dg("switch", "switch", "endswitch", "Switch", { branchMarkers: ["case", "default"], branchComponents: [br("Case", "switch", "case"), br("Default", "switch", "default")] }),
    dg("each", "each", "endeach", "Each", { branchMarkers: ["empty"], inlineStatements: ["continue", "break"], branchComponents: [br("Empty", "each", "empty")] }),
    dg("for", "for", "endfor", "For"),
    dg("await", "await", "endawait", "Await", { branchMarkers: ["then", "catch"] }),
    dg("auth", "auth", "endauth", "Auth", { branchMarkers: ["else"], branchComponents: [br("Else", "auth", "else")], supportsElse: true }),
    dg("guest", "guest", "endguest", "Guest", { branchMarkers: ["else"], branchComponents: [br("Else", "guest", "else")], supportsElse: true }),
    dg("can", "can", "endcan", "Can", { branchMarkers: ["elsecan", "else"], branchComponents: [br("ElseCan", "can", "elsecan"), br("Else", "can", "else")], supportsElse: true, importSources: [PERMISSIONS_IMPORT_PATH, DIRECTIVES_IMPORT_PATH] }),
    dg("cannot", "cannot", "endcannot", "Cannot", { branchMarkers: ["else"], branchComponents: [br("Else", "cannot", "else")], supportsElse: true }),
    dg("canany", "canany", "endcanany", "CanAny", { branchMarkers: ["else"], branchComponents: [br("Else", "canany", "else")], supportsElse: true }),
    dg("dev", "dev", "enddev", "Dev"),
    dg("production", "production", "endproduction", "Production"),
    dg("env", "env", "endenv", "Env", { branchMarkers: ["else"], branchComponents: [br("Else", "env", "else")], supportsElse: true }),
    dg("context", "context", "endcontext", "Context", { branchMarkers: ["else"], branchComponents: [br("Else", "context", "else")], supportsElse: true }),
    dg("error", "error", "enderror", "FieldError"),
    dg("errors", "errors", "enderrors", "FormErrors"),
    dg("valid", "valid", "endvalid", "FieldValid"),
    dg("csrf", "csrf", null, "Csrf"),
    dg("method", "method", null, "Method"),
    dg("section", "section", "endsection", "Section"),
    dg("yield", "yield", "endyield", "Yield"),
    dg("hassection", "hassection", "endhassection", "HasSection"),
    dg("sectionmissing", "sectionmissing", "endsectionmissing", "SectionMissing"),
    dg("push", "push", "endpush", "Push"),
    dg("prepend", "prepend", "endprepend", "Prepend"),
    dg("stack", "stack", null, "Stack"),
    dg("head", "push", "endpush", "Head", { branchComponents: [br("Title", "head", null, "subcomponent"), br("Meta", "head", null, "subcomponent"), br("Link", "head", null, "subcomponent")] }),
    dg("include", "include", null, "Include"),
    dg("includefirst", "includefirst", "endincludefirst", "IncludeFirst", { branchMarkers: ["else"], branchComponents: [br("Else", "includefirst", "else")], supportsElse: true }),
    dg("once", "once", "endonce", "Once"),
    dg("memo", "memo", "endmemo", "Memo"),
    dg("lazy", "lazy", "endlazy", "Lazy", { branchMarkers: ["else"], branchComponents: [br("Else", "lazy", "else")], supportsElse: true }),
    dg("keepalive", "keepalive", "endkeepalive", "KeepAlive"),
    dg("session", "session", "endsession", "Session", { branchMarkers: ["else"], branchComponents: [br("Else", "session", "else")], supportsElse: true }),
    dg("partial", "partial", "endpartial", "Partial"),
    dg("json", "json", null, "Json"),
    dg("dump", "dump", null, "Dump"),
    dg("verbatim", "verbatim", "endverbatim", "Verbatim", { rawTextMode: true })
  ] as readonly DirectiveGrammarEntry[],
  contextualKeywords: ["as", "on", "in", "if", "unless", "from", "to", "step", "times", "role", "render", "with", "once", "by", "field", "max", "visible", "idle"] as readonly string[],
  attributeModifiers: {
    attr: ["if", "unless", "else", "match", "case-"] as readonly string[],
    event: ["if", "unless", "else"] as readonly string[],
    classPrefix: "class:" as const,
    stylePrefix: "style:" as const,
    spread: "spread:if" as const
  },
  booleanHtmlAttributes: ["checked", "selected", "disabled", "readonly", "required", "hidden"] as readonly string[]
});

export function getDirectiveGrammarById(id: string): DirectiveGrammarEntry {
  const found = DIRECTIVE_GRAMMAR.directives.find((d) => d.id === id);
  if (!found) throw new Error(`Missing directive grammar entry for '${id}'.`);
  return found;
}

export function createDirectiveNode<T extends ASTNodeBase & { readonly type: string }>(node: T): T {
  validateSpan(node.span);
  return deepFreeze(node);
}

export function createDirectiveSubNode<T extends { readonly span: SourceSpan }>(node: T): T {
  validateSpan(node.span);
  return deepFreeze(node);
}

export function walkDirectiveNode(
  node: ASTNode,
  visit: (child: ASTNode, parent: ASTNode | null) => void
): void {
  const visitAll = (list: readonly TemplateNode[] | null | undefined): void => {
    if (!list) return;
    for (const item of list) visit(item, node);
  };
  switch (node.type) {
    case "UnlessBlock": case "IsSetBlock": case "IsEmptyBlock":
    case "AuthBlock": case "GuestBlock": case "CannotBlock": case "CanAnyBlock":
    case "EnvGate": case "ContextBlock": case "SessionBlock":
      visitAll(node.consequent);
      visitAll(node.alternate);
      break;
    case "SwitchBlock":
      for (const c of node.cases) visitAll(c.body);
      visitAll(node.defaultBranch);
      break;
    case "EachExtBlock":
      visitAll(node.children);
      visitAll(node.empty);
      break;
    case "CanChain":
      for (const b of node.branches) visitAll(b.body);
      visitAll(node.alternate);
      break;
    case "ForBlock": case "FieldError": case "FormErrors": case "FieldValid":
    case "Section": case "HasSection": case "SectionMissing": case "StackPush":
    case "Once": case "Memo": case "KeepAliveBlock": case "Partial":
      visitAll(node.children);
      break;
    case "HeadGroup":
      for (const entry of node.entries) {
        for (const attr of entry.attributes) visit(attr, node);
        visitAll(entry.children);
      }
      visitAll(node.children);
      break;
    case "Yield":
      visitAll(node.fallback);
      break;
    case "Include": case "IncludeFirst":
      visitAll(node.pending);
      visitAll(node.fallback);
      break;
    case "Lazy":
      visitAll(node.children);
      visitAll(node.fallback);
      break;
    case "TemplateRenderFunction":
      visitAll(node.body);
      break;
    default:
      break;
  }
}
