// packages/compiler-semantic/src/projection.ts — FROZEN per MIX_SPEC_v3.2.2 §5
import type {
  ComponentNode,
  TemplateChildNode,
  ElementNode,
  DynamicElementNode,
  IfBlockNode,
  EachBlockNode,
  AttributeNode,
  RefBindingNode
} from "@mix/ast";
import { ProjectionBuilder, type SpanEntry } from "./spans.js";

const SVG_TAGS = new Set([
  "svg", "path", "g", "circle", "rect", "line", "polyline", "polygon",
  "ellipse", "text", "tspan", "defs", "use", "symbol", "clipPath", "mask",
  "pattern", "image", "linearGradient", "radialGradient", "stop"
]);

export interface ProjectionResult {
  readonly code: string;
  readonly spans: readonly SpanEntry[];
}

/**
 * Generates the TypeScript projection (.tix.ts) and exact 1:1 span table for typechecking.
 * Ensures 100% byte coverage of generated projection code without gaps or overlaps (R-SP-05).
 */
export function generateTypeProjection(ast: ComponentNode): ProjectionResult {
  const builder = new ProjectionBuilder();

  // 1. Internal Preamble
  builder.appendInternal(
    'import { VerifyRef, ElementOf, SvgElementOf, AnyElement, VerifyProps } from "@mix/runtime/typecheck";\n\n'
  );

  // 2. User Script Block (verbatim)
  if (ast.script && ast.script.content) {
    const scriptStart = ast.script.span.start.offset;
    const scriptEnd = ast.script.span.end.offset;
    builder.appendVerbatim(ast.script.content, scriptStart, scriptEnd);
    builder.appendInternal("\n\n");
  }

  // 3. Template Type Validations Block
  builder.appendInternal("function __mix_template_typecheck() {\n");

  function processAttributes(attrs: readonly AttributeNode[], tagName: string, tagSpanStart: number, tagSpanEnd: number) {
    for (const attr of attrs) {
      if (attr.type === "RefBinding") {
        const ref = attr as RefBindingNode;
        builder.appendInternal("  VerifyRef(");
        builder.appendVerbatim(ref.target.code, ref.target.span.start.offset, ref.target.span.end.offset);
        if (SVG_TAGS.has(tagName)) {
          builder.appendOrigin(`, SvgElementOf("${tagName}"));\n`, tagSpanStart, tagSpanEnd);
        } else {
          builder.appendOrigin(`, ElementOf("${tagName as any}"));\n`, tagSpanStart, tagSpanEnd);
        }
      }
    }
  }

  function visitChild(child: TemplateChildNode): void {
    if (child.type === "Element") {
      const el = child as ElementNode;
      const isComponent = /^[A-Z]/.test(el.tag);

      if (isComponent) {
        // Component Invocation: VerifyProps(Comp, { freshLiteral }) per R-TC-02 & R-TC-03
        builder.appendInternal("  VerifyProps(");
        builder.appendOrigin(el.tag, el.span.start.offset, el.span.start.offset + el.tag.length);
        builder.appendInternal(", {\n");

        for (const attr of el.attributes) {
          if (attr.type === "StaticAttribute") {
            builder.appendInternal(`    ${attr.name}: `);
            builder.appendOrigin(JSON.stringify(attr.value), attr.span.start.offset, attr.span.end.offset);
            builder.appendInternal(",\n");
          } else if (attr.type === "DynamicAttribute") {
            builder.appendInternal(`    ${attr.name}: `);
            builder.appendVerbatim(
              attr.expression.code,
              attr.expression.span.start.offset,
              attr.expression.span.end.offset
            );
            builder.appendInternal(",\n");
          }
        }

        builder.appendInternal("  });\n");
      } else {
        // Static HTML or SVG Element
        processAttributes(el.attributes, el.tag, el.span.start.offset, el.span.end.offset);
      }

      for (const nested of el.children) {
        visitChild(nested);
      }
    } else if (child.type === "DynamicElement") {
      const dyn = child as DynamicElementNode;
      // DynamicElement with ref: VerifyRef(ref, AnyElement()) per R-TC-01
      for (const attr of dyn.attributes) {
        if (attr.type === "RefBinding") {
          const ref = attr as RefBindingNode;
          builder.appendInternal("  VerifyRef(");
          builder.appendVerbatim(ref.target.code, ref.target.span.start.offset, ref.target.span.end.offset);
          builder.appendOrigin(
            ", AnyElement());\n",
            dyn.tagExpression.span.start.offset,
            dyn.tagExpression.span.end.offset
          );
        }
      }
      for (const nested of dyn.children) {
        visitChild(nested);
      }
    } else if (child.type === "IfBlock") {
      const ifNode = child as IfBlockNode;
      for (const c of ifNode.consequent) visitChild(c);
      if (ifNode.alternate) {
        for (const c of ifNode.alternate) visitChild(c);
      }
    } else if (child.type === "EachBlock") {
      const eachNode = child as EachBlockNode;
      for (const c of eachNode.body) visitChild(c);
    }
  }

  for (const tNode of ast.template) {
    visitChild(tNode);
  }

  builder.appendInternal("}\n");

  return builder.build();
}
