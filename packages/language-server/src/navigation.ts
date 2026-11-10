/**
 * @mix/language-server/navigation — Go-to-definition (`doDefinition`) and cross-file component/import lookup helpers.
 */

import { parse } from "@mix/compiler-frontend";
import { analyze } from "@mix/compiler-semantic";
import type { Position, Location } from "./types.js";
import {
  positionToOffset,
  getWordAtOffset,
  resolveRelativeUri,
  spanToRange,
} from "./indexer.js";

export function resolveDefinition(
  uri: string,
  text: string,
  position: Position
): Location | null {
  const filename = uri.replace(/^file:\/\//, "");
  const offset = positionToOffset(text, position);
  const wordInfo = getWordAtOffset(text, offset);
  if (!wordInfo) return null;

  try {
    const ast = parse(text, { filename });
    const desc = analyze(ast, {
      filename,
      source: text,
      throwOnError: false,
      warnLegacyControlFlow: true,
    });

    // 1. Check if word is an imported component or module in <script>
    const importSource = desc.imports.get(wordInfo.word);
    if (importSource && (importSource.startsWith("./") || importSource.startsWith("../"))) {
      const targetUri = resolveRelativeUri(uri, importSource);
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
        const targetUri = resolveRelativeUri(uri, binding.importSource);
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
