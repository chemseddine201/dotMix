// packages/compiler-semantic/src/spans.ts — FROZEN per MIX_SPEC_v3.2.2 §5.4
import { MixError } from "@mix/runtime/core";

export type SpanKind = "verbatim" | "origin" | "internal";

export interface SpanEntry {
  readonly genStart: number;
  readonly genEnd: number; // positions in projection file
  readonly srcStart: number;
  readonly srcEnd: number; // positions in .tix file (ignored in internal)
  readonly kind: SpanKind;
}

export interface MappedDiagnostic {
  readonly start: number;
  readonly end: number;
  readonly kind: SpanKind;
  readonly message: string;
  readonly internalError?: MixError;
}

/**
 * Validates that every byte in the projection is covered by exactly one span entry (R-SP-05).
 * Ensures no gaps, no overlaps, and that verbatim spans have identical lengths.
 */
export function validateSpanTableCoverage(
  spans: readonly SpanEntry[],
  projectionLength: number
): void {
  if (projectionLength === 0) {
    if (spans.length !== 0) {
      throw new MixError("MIX_INTERNAL_TYPECHECK", "Expected 0 spans for empty projection");
    }
    return;
  }

  if (spans.length === 0) {
    throw new MixError(
      "MIX_INTERNAL_TYPECHECK",
      `Span table has 0 entries but projection length is ${projectionLength}`
    );
  }

  let currentOffset = 0;
  for (let i = 0; i < spans.length; i++) {
    const span = spans[i]!;

    if (span.genStart < currentOffset) {
      throw new MixError(
        "MIX_INTERNAL_TYPECHECK",
        `Overlapping span at index ${i}: genStart ${span.genStart} < currentOffset ${currentOffset}`
      );
    }

    if (span.genStart > currentOffset) {
      throw new MixError(
        "MIX_INTERNAL_TYPECHECK",
        `Gap in span table at index ${i}: genStart ${span.genStart} > currentOffset ${currentOffset}`
      );
    }

    if (span.genEnd <= span.genStart) {
      throw new MixError(
        "MIX_INTERNAL_TYPECHECK",
        `Empty or inverted span at index ${i}: [${span.genStart}, ${span.genEnd}]`
      );
    }

    if (span.kind === "verbatim") {
      const genLen = span.genEnd - span.genStart;
      const srcLen = span.srcEnd - span.srcStart;
      if (genLen !== srcLen) {
        throw new MixError(
          "MIX_INTERNAL_TYPECHECK",
          `Verbatim span length mismatch at index ${i}: genLen=${genLen}, srcLen=${srcLen}`
        );
      }
    }

    currentOffset = span.genEnd;
  }

  if (currentOffset !== projectionLength) {
    throw new MixError(
      "MIX_INTERNAL_TYPECHECK",
      `Span table covers up to ${currentOffset}, but projection length is ${projectionLength}`
    );
  }
}

/**
 * Selects the smallest span containing diagnostic start (R-SP-04):
 * - verbatim: mapped to exact character offset.
 * - origin: mapped to the entire construct span in the source.
 * - internal: prohibited from showing diagnostic at user position; emits MIX_INTERNAL_TYPECHECK.
 */
export function mapDiagnostic(
  diag: { start: number; length: number; message: string },
  spans: readonly SpanEntry[],
  projectionCode: string,
  compilerVersion = "3.2.2"
): MappedDiagnostic {
  const diagStart = diag.start;
  const diagEnd = diag.start + diag.length;

  const matching: SpanEntry[] = [];
  for (const s of spans) {
    if (diagStart >= s.genStart && diagStart < s.genEnd) {
      matching.push(s);
    }
  }

  if (matching.length === 0 && spans.length > 0) {
    const last = spans[spans.length - 1]!;
    if (diagStart === last.genEnd) {
      matching.push(last);
    }
  }

  if (matching.length === 0) {
    const err = new MixError(
      "MIX_INTERNAL_TYPECHECK",
      `Diagnostic at offset ${diagStart} is outside any projection span`,
      { compilerVersion, diagStart }
    );
    return {
      start: -1,
      end: -1,
      kind: "internal",
      message: err.message,
      internalError: err
    };
  }

  // Choose the smallest span containing the diagnostic start
  matching.sort((a, b) => (a.genEnd - a.genStart) - (b.genEnd - b.genStart));
  const span = matching[0]!;

  if (span.kind === "verbatim") {
    const offset = diagStart - span.genStart;
    const len = Math.min(diag.length, span.genEnd - diagStart);
    return {
      start: span.srcStart + offset,
      end: span.srcStart + offset + len,
      kind: "verbatim",
      message: diag.message
    };
  }

  if (span.kind === "origin") {
    return {
      start: span.srcStart,
      end: span.srcEnd,
      kind: "origin",
      message: diag.message
    };
  }

  // Internal: MUST NOT show diagnostic at user position (R-SP-04)
  const snippet = projectionCode.slice(
    Math.max(0, diagStart - 20),
    Math.min(projectionCode.length, diagEnd + 20)
  );
  const internalError = new MixError(
    "MIX_INTERNAL_TYPECHECK",
    `Internal typecheck error at generated offset ${diagStart}: ${diag.message}`,
    {
      compilerVersion,
      projectionOffset: diagStart,
      snippet
    }
  );

  return {
    start: -1,
    end: -1,
    kind: "internal",
    message: internalError.message,
    internalError
  };
}

/**
 * Helper builder to incrementally construct projection code while recording span entries.
 */
export class ProjectionBuilder {
  private code = "";
  private readonly spans: SpanEntry[] = [];

  appendInternal(text: string): this {
    if (!text) return this;
    const genStart = this.code.length;
    this.code += text;
    this.spans.push({
      genStart,
      genEnd: this.code.length,
      srcStart: 0,
      srcEnd: 0,
      kind: "internal"
    });
    return this;
  }

  appendVerbatim(text: string, srcStart: number, srcEnd: number): this {
    if (!text) return this;
    const genStart = this.code.length;
    this.code += text;
    this.spans.push({
      genStart,
      genEnd: this.code.length,
      srcStart,
      srcEnd,
      kind: "verbatim"
    });
    return this;
  }

  appendOrigin(text: string, srcStart: number, srcEnd: number): this {
    if (!text) return this;
    const genStart = this.code.length;
    this.code += text;
    this.spans.push({
      genStart,
      genEnd: this.code.length,
      srcStart,
      srcEnd,
      kind: "origin"
    });
    return this;
  }

  build(): { code: string; spans: readonly SpanEntry[] } {
    validateSpanTableCoverage(this.spans, this.code.length);
    return {
      code: this.code,
      spans: Object.freeze([...this.spans])
    };
  }
}
