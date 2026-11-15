/**
 * @dotmix/server-node/directives/ssr-render — SSR entry helpers for RequestContext, partial extraction, and head/stack injection (T-38.6).
 */

import type { HeadCollector, RequestContext, StackCollector } from "@dotmix/runtime";
import { createRequestContext, runWithSsrScope } from "./request-context.js";
import {
  createSsrHeadCollector,
  createSsrStackCollector,
  injectHeadAndStacks,
  streamWithHeadAndStacks
} from "./head-stacks.js";

export interface SsrDirectiveCallContext {
  readonly partial?: string | undefined;
  readonly request: RequestContext;
  readonly session: (key: string) => unknown;
  readonly csrfToken: () => string;
  readonly head: HeadCollector;
  readonly headCollector: HeadCollector;
  readonly stacks: StackCollector;
  readonly stackCollector: StackCollector;
}

export interface SsrDirectiveRenderOptions {
  readonly props?: Record<string, unknown> | undefined;
  readonly partial?: string | undefined;
  readonly request?: RequestContext | undefined;
  readonly session?:
    | Readonly<Record<string, unknown>>
    | ((key: string) => unknown)
    | undefined;
  readonly csrfToken?: string | (() => string) | undefined;
  readonly headCollector?: HeadCollector | undefined;
  readonly stackCollector?: StackCollector | undefined;
}

export type SsrSyncAppTarget =
  | {
      readonly renderToString: (
        props?: Record<string, unknown>,
        ctx?: SsrDirectiveCallContext
      ) => string;
    }
  | ((props?: Record<string, unknown>, ctx?: SsrDirectiveCallContext) => string);

export type SsrAppTarget =
  | {
      readonly renderToString: (
        props?: Record<string, unknown>,
        ctx?: SsrDirectiveCallContext
      ) => string | Promise<string>;
      readonly renderToStream?: (
        props?: Record<string, unknown>,
        onChunk?: (chunk: string) => void,
        ctx?: SsrDirectiveCallContext
      ) => AsyncIterable<string> | Iterable<string>;
    }
  | ((
      props?: Record<string, unknown>,
      ctx?: SsrDirectiveCallContext
    ) => string | Promise<string> | AsyncIterable<string> | Iterable<string>);

const PARTIAL_OPEN_PREFIX = "<!--mix:partial:";

function isAsyncIterable(candidate: unknown): candidate is AsyncIterable<string> {
  return candidate !== null && typeof candidate === "object" && Symbol.asyncIterator in candidate;
}

function isSyncIterable(candidate: unknown): candidate is Iterable<string> {
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    Symbol.iterator in candidate &&
    typeof candidate !== "string"
  );
}

function isPromiseLike(candidate: unknown): candidate is Promise<unknown> {
  return (
    candidate !== null &&
    (typeof candidate === "object" || typeof candidate === "function") &&
    "then" in candidate &&
    typeof (candidate as { then: unknown }).then === "function"
  );
}

/**
 * Extracts a `{partial "name"}...{endpartial}` / `<Partial name>` region from rendered HTML
 * using `<!--mix:partial:name-->...<!--/mix:partial:name-->` markers.
 */
export function extractPartialRegion(html: string, partialName: string): string {
  const openTag = `${PARTIAL_OPEN_PREFIX}${partialName}-->`;
  const closeTag = `<!--/mix:partial:${partialName}-->`;

  const startIdx = html.indexOf(openTag);
  if (startIdx === -1) {
    // If partial markers exist in the output, the requested partial was not rendered; return empty.
    if (html.includes(PARTIAL_OPEN_PREFIX)) {
      return "";
    }
    return html;
  }

  const contentStart = startIdx + openTag.length;
  let searchPos = contentStart;
  let depth = 1;

  while (searchPos < html.length && depth > 0) {
    const nextOpen = html.indexOf(openTag, searchPos);
    const nextClose = html.indexOf(closeTag, searchPos);
    if (nextClose === -1) {
      return html.slice(contentStart);
    }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      searchPos = nextOpen + openTag.length;
    } else {
      depth -= 1;
      if (depth === 0) {
        return html.slice(contentStart, nextClose);
      }
      searchPos = nextClose + closeTag.length;
    }
  }

  return html.slice(contentStart);
}

function buildSsrCallContext(options: SsrDirectiveRenderOptions): {
  readonly ctx: SsrDirectiveCallContext;
  readonly headCollector: HeadCollector;
  readonly stackCollector: StackCollector;
} {
  const request =
    options.request ??
    createRequestContext({
      session: options.session,
      csrfToken: options.csrfToken
    });
  const headCollector = options.headCollector ?? createSsrHeadCollector();
  const stackCollector = options.stackCollector ?? createSsrStackCollector();

  const ctx: SsrDirectiveCallContext = {
    partial: options.partial,
    request,
    session: (key: string) => request.session(key),
    csrfToken: () => request.csrfToken(),
    head: headCollector,
    headCollector,
    stacks: stackCollector,
    stackCollector
  };

  return { ctx, headCollector, stackCollector };
}

function finalizeHtml(
  rawHtml: string,
  partial: string | undefined,
  headCollector: HeadCollector,
  stackCollector: StackCollector
): string {
  const scopedHtml = partial !== undefined ? extractPartialRegion(rawHtml, partial) : rawHtml;
  return injectHeadAndStacks(scopedHtml, headCollector, stackCollector);
}

export function renderToString(
  app: SsrSyncAppTarget,
  options: SsrDirectiveRenderOptions = {}
): string {
  const { ctx, headCollector, stackCollector } = buildSsrCallContext(options);
  const props = options.props ?? {};

  const raw = runWithSsrScope(
    {
      request: ctx.request,
      headCollector,
      stackCollector,
      partial: options.partial
    },
    () => (typeof app === "function" ? app(props, ctx) : app.renderToString(props, ctx))
  );

  if (isPromiseLike(raw)) {
    throw new Error("renderToString received an async render result; use renderToStringAsync instead.");
  }

  return finalizeHtml(String(raw), options.partial, headCollector, stackCollector);
}

export async function renderToStringAsync(
  app: SsrAppTarget,
  options: SsrDirectiveRenderOptions = {}
): Promise<string> {
  const { ctx, headCollector, stackCollector } = buildSsrCallContext(options);
  const props = options.props ?? {};

  const raw = await runWithSsrScope(
    {
      request: ctx.request,
      headCollector,
      stackCollector,
      partial: options.partial
    },
    async () => {
      if (typeof app === "function") {
        const renderedResult = await app(props, ctx);
        if (isAsyncIterable(renderedResult) || isSyncIterable(renderedResult)) {
          let buf = "";
          for await (const chunk of renderedResult) buf += String(chunk);
          return buf;
        }
        return String(renderedResult);
      }
      return String(await app.renderToString(props, ctx));
    }
  );

  return finalizeHtml(raw, options.partial, headCollector, stackCollector);
}

export async function* renderToStream(
  app: SsrAppTarget,
  options: SsrDirectiveRenderOptions = {}
): AsyncIterable<string> {
  const { ctx, headCollector, stackCollector } = buildSsrCallContext(options);
  const props = options.props ?? {};

  if (options.partial !== undefined) {
    const html = await renderToStringAsync(app, options);
    yield html;
    return;
  }

  const rawResult = runWithSsrScope(
    {
      request: ctx.request,
      headCollector,
      stackCollector,
      partial: options.partial
    },
    () => {
      if (typeof app === "function") {
        return app(props, ctx);
      }
      if (typeof app.renderToStream === "function") {
        return app.renderToStream(props, undefined, ctx);
      }
      return app.renderToString(props, ctx);
    }
  );

  async function* toChunks(): AsyncIterable<string> {
    if (typeof rawResult === "string") {
      yield rawResult;
    } else if (isAsyncIterable(rawResult) || isSyncIterable(rawResult)) {
      for await (const chunk of rawResult) {
        yield String(chunk);
      }
    } else {
      yield String(await rawResult);
    }
  }

  yield* streamWithHeadAndStacks(toChunks(), headCollector, stackCollector);
}
