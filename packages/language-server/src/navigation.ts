/**
 * @dotmix/language-server/navigation — Go-to-definition (`doDefinition`) and cross-file component/import lookup helpers.
 */

import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "@dotmix/compiler-frontend";
import { analyze } from "@dotmix/compiler-semantic";
import type { Position, Location } from "./types.js";
import {
  positionToOffset,
  getWordAtOffset,
  resolveRelativeUri,
  spanToRange,
} from "./indexer.js";

/** Analyses of recently used documents. Holding Ctrl and moving the mouse asks for many definitions in the same text. */
const MAX_CACHED_ANALYSES = 32;
const analysisCache = new Map<string, { readonly text: string; readonly descriptor: ReturnType<typeof analyze> }>();

function analyzeDocument(uri: string, filename: string, text: string): ReturnType<typeof analyze> {
  const cachedAnalysis = analysisCache.get(uri);
  if (cachedAnalysis && cachedAnalysis.text === text) return cachedAnalysis.descriptor;
  const ast = parse(text, { filename });
  const descriptor = analyze(ast, {
    filename,
    source: text,
    throwOnError: false,
    warnLegacyControlFlow: true,
  });
  analysisCache.delete(uri);
  analysisCache.set(uri, { text, descriptor });
  if (analysisCache.size > MAX_CACHED_ANALYSES) {
    const oldestUri = analysisCache.keys().next().value;
    if (oldestUri !== undefined) analysisCache.delete(oldestUri);
  }
  return descriptor;
}

/**
 * Resolves an import specifier to the file to open. Imports written with a `.js` extension
 * (the NodeNext convention) point to their source file: `.ts`, `.tix` or `.mix`.
 */
function resolveImportTargetUri(baseUri: string, importSource: string): string {
  return findExistingImportTarget(baseUri, importSource) ?? resolveRelativeUri(baseUri, importSource);
}

/** The file an import specifier points to, if it exists on disk; also maps `.js` to its source file. */
function findExistingImportTarget(baseUri: string, importSource: string): string | null {
  const targetUri = resolveRelativeUri(baseUri, importSource);
  if (!targetUri.startsWith("file:")) return null;
  try {
    const targetPath = fileURLToPath(targetUri);
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) return targetUri;
    const pathWithoutExtension = importSource.endsWith(".js") ? targetPath.slice(0, -".js".length) : targetPath;
    for (const sourceExtension of [".ts", ".tix", ".mix"]) {
      if (fs.existsSync(pathWithoutExtension + sourceExtension)) {
        return pathToFileURL(pathWithoutExtension + sourceExtension).href;
      }
    }
  } catch {
    // Not a local file URI.
  }
  return null;
}

/** The content of the quoted string that contains `offset`, when that string sits on one line. */
function findQuotedTextAt(text: string, offset: number): string | null {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const lineEndIndex = text.indexOf("\n", offset);
  const lineText = text.slice(lineStart, lineEndIndex < 0 ? text.length : lineEndIndex);
  const column = offset - lineStart;
  for (const quote of ['"', "'"]) {
    const openingIndex = lineText.lastIndexOf(quote, column - 1);
    if (openingIndex < 0) continue;
    const quotesBefore = lineText.slice(0, openingIndex).split(quote).length - 1;
    if (quotesBefore % 2 !== 0) continue;
    const closingIndex = lineText.indexOf(quote, Math.max(column, openingIndex + 1));
    if (closingIndex < 0) continue;
    return lineText.slice(openingIndex + 1, closingIndex);
  }
  return null;
}

/** Ctrl+click on a relative path such as `"../components/ui/NavSection.tix"` or `"./App.css"`. */
function resolvePathStringDefinition(uri: string, text: string, offset: number): Location | null {
  const quotedText = findQuotedTextAt(text, offset);
  if (!quotedText || !(quotedText.startsWith("./") || quotedText.startsWith("../"))) return null;
  const targetUri = findExistingImportTarget(uri, quotedText);
  if (!targetUri) return null;
  return { uri: targetUri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } };
}

export function resolveDefinition(
  uri: string,
  text: string,
  position: Position
): Location | null {
  const filename = uri.replace(/^file:\/\//, "");
  const offset = positionToOffset(text, position);
  const pathDefinition = resolvePathStringDefinition(uri, text, offset);
  if (pathDefinition) return pathDefinition;
  const wordInfo = getWordAtOffset(text, offset);
  if (!wordInfo) return null;

  try {
    const desc = analyzeDocument(uri, filename, text);

    // 1. Check if word is an imported component or module in <script>
    const importSource = desc.imports.get(wordInfo.word);
    if (importSource && (importSource.startsWith("./") || importSource.startsWith("../"))) {
      const targetUri = resolveImportTargetUri(uri, importSource);
      return {
        uri: targetUri,
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      };
    }

    // 2. Check bindings declared in current component
    const binding = desc.rootScope.bindings.get(wordInfo.word);
    if (binding) {
      if (binding.importSource && (binding.importSource.startsWith("./") || binding.importSource.startsWith("../"))) {
        const targetUri = resolveImportTargetUri(uri, binding.importSource);
        return {
          uri: targetUri,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        };
      }
      if (binding.span) {
        return {
          uri,
          range: spanToRange(binding.span),
        };
      }
    }
  } catch {
    // Ignore parse errors while typing
  }

  return null;
}
