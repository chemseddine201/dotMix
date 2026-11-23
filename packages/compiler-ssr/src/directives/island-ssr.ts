/**
 * @dotmix/compiler-ssr/directives/island-ssr — Automatic island interactivity detection & {hydrate}/<Hydrate> metadata.
 */

import type {
  AttributeNode,
  ComponentCallNode,
  ComponentNode,
  HydrateWhen,
  TemplateNode
} from "@dotmix/ast";
import type { ComponentDescriptor } from "@dotmix/compiler-semantic";

export type IslandClientTrigger = Exclude<HydrateWhen, "never">;

export interface HydrationComponentMeta {
  readonly isInteractive: boolean;
  readonly islandSpecifiers: readonly string[];
}

const REACTIVE_SCRIPT_IMPORTS = new Set([
  "signal",
  "createSignal",
  "computed",
  "createComputed",
  "createEffect",
  "effect",
  "createResource",
  "createStore",
  "syncSignal",
  "syncCollection",
  "onMount"
]);

function attributesHaveInteractivity(
  attributes: readonly AttributeNode[],
  islandImports: Set<string>,
  imports: ReadonlyMap<string, string> | undefined
): boolean {
  for (const attr of attributes) {
    if (
      attr.type === "EventBinding" ||
      attr.type === "BindBinding" ||
      attr.type === "RefBinding" ||
      attr.type === "ConditionalEvent"
    ) {
      return true;
    }
    if (attr.type === "DynamicAttribute" && attr.templateValue) {
      if (templateHasClientInteractivity(attr.templateValue, islandImports, imports, false)) {
        return true;
      }
    }
  }
  return false;
}

function collectIslandCallSpecifiers(
  nodes: readonly TemplateNode[],
  islandImports: Set<string>,
  imports: ReadonlyMap<string, string> | undefined
): void {
  for (const node of nodes) {
    if (node.type === "ComponentCall") {
      const spec = imports?.get(node.name);
      if (spec) islandImports.add(spec);
      collectIslandCallSpecifiers(node.children, islandImports, imports);
    } else if (node.type === "Element" || node.type === "DynamicElement") {
      collectIslandCallSpecifiers(node.children, islandImports, imports);
    }
  }
}

function templateHasClientInteractivity(
  nodes: readonly TemplateNode[],
  islandImports: Set<string>,
  imports: ReadonlyMap<string, string> | undefined,
  insideHydrateIsland: boolean
): boolean {
  for (const node of nodes) {
    switch (node.type) {
      case "Element":
      case "DynamicElement": {
        if (attributesHaveInteractivity(node.attributes, islandImports, imports)) {
          return true;
        }
        if (templateHasClientInteractivity(node.children, islandImports, imports, insideHydrateIsland)) {
          return true;
        }
        break;
      }
      case "ComponentCall": {
        const call = node as ComponentCallNode;
        if (insideHydrateIsland) {
          const spec = imports?.get(call.name);
          if (spec) islandImports.add(spec);
          break;
        }
        if (attributesHaveInteractivity(call.attributes, islandImports, imports)) {
          return true;
        }
        if (templateHasClientInteractivity(call.children, islandImports, imports, false)) {
          return true;
        }
        break;
      }
      case "Hydrate": {
        if (node.when === "never") {
          // `{hydrate never}` / `<Hydrate when="never">` keeps this subtree strictly 0-JS static.
          break;
        }
        collectIslandCallSpecifiers(node.children, islandImports, imports);
        const nonComponentInteractive = node.children.some((child) => {
          if (child.type === "ComponentCall") return false;
          if (child.type === "Text" && child.value.trim().length === 0) return false;
          return templateHasClientInteractivity([child], islandImports, imports, true);
        });
        if (nonComponentInteractive) return true;
        break;
      }
      case "IfBlock": {
        if (templateHasClientInteractivity(node.consequent, islandImports, imports, insideHydrateIsland)) {
          return true;
        }
        if (node.alternate) {
          const altNodes = Array.isArray(node.alternate) ? node.alternate : [node.alternate];
          if (templateHasClientInteractivity(altNodes, islandImports, imports, insideHydrateIsland)) {
            return true;
          }
        }
        break;
      }
      case "UnlessBlock":
      case "IsSetBlock":
      case "IsEmptyBlock":
      case "AuthBlock":
      case "GuestBlock":
      case "CannotBlock":
      case "CanAnyBlock":
      case "EnvGate":
      case "ContextBlock":
      case "SessionBlock": {
        if (templateHasClientInteractivity(node.consequent, islandImports, imports, insideHydrateIsland)) {
          return true;
        }
        if (node.alternate && templateHasClientInteractivity(node.alternate, islandImports, imports, insideHydrateIsland)) {
          return true;
        }
        break;
      }
      case "SwitchBlock": {
        for (const c of node.cases) {
          if (templateHasClientInteractivity(c.body, islandImports, imports, insideHydrateIsland)) {
            return true;
          }
        }
        if (node.defaultBranch && templateHasClientInteractivity(node.defaultBranch, islandImports, imports, insideHydrateIsland)) {
          return true;
        }
        break;
      }
      case "EachBlock":
      case "EachExtBlock":
      case "ForBlock":
      case "Once":
      case "Memo":
      case "Lazy":
      case "KeepAliveBlock":
      case "Section":
      case "Partial": {
        if (templateHasClientInteractivity(node.children, islandImports, imports, insideHydrateIsland)) {
          return true;
        }
        break;
      }
      case "AwaitBlock":
        return true;
      case "SlotOutlet":
        if (templateHasClientInteractivity(node.fallback, islandImports, imports, insideHydrateIsland)) {
          return true;
        }
        break;
      default:
        break;
    }
  }
  return false;
}

export function analyzeSsrHydrationMeta(
  rootNode: ComponentNode,
  descriptor: ComponentDescriptor | undefined
): HydrationComponentMeta {
  const islandSpecifiers = new Set<string>();
  const hasTemplateInteractivity = templateHasClientInteractivity(
    rootNode.template,
    islandSpecifiers,
    descriptor?.imports,
    false
  );
  const hasReactiveImport = descriptor
    ? [...descriptor.imports.keys()].some((k) => REACTIVE_SCRIPT_IMPORTS.has(k))
    : false;
  const hasScriptReactivity = Boolean(
    descriptor &&
      (descriptor.signals.length > 0 ||
        descriptor.computeds.length > 0 ||
        descriptor.refs.length > 0 ||
        descriptor.hasReactiveState ||
        descriptor.hasOnMount ||
        hasReactiveImport)
  );

  return {
    isInteractive: hasTemplateInteractivity || hasScriptReactivity,
    islandSpecifiers: [...islandSpecifiers]
  };
}
