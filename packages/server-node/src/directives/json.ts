/**
 * @dotmix/server-node/directives/json — Safe JSON escaping & script tag serialization for {json} / <Json> (F13, T-38.6).
 */

function escapeHtmlAttribute(attributeValue: string): string {
  let escaped = "";
  for (let i = 0; i < attributeValue.length; i++) {
    const ch = attributeValue[i]!;
    if (ch === "&") escaped += "&amp;";
    else if (ch === "\"") escaped += "&quot;";
    else if (ch === "<") escaped += "&lt;";
    else if (ch === ">") escaped += "&gt;";
    else if (ch === "'") escaped += "&#39;";
    else escaped += ch;
  }
  return escaped;
}

/**
 * Escapes `</script` (case-insensitive), `<!--`, U+2028, and U+2029 inside JSON text
 * so embedding inside `<script type="application/json">` is safe and `JSON.parse()` round-trips identically.
 */
export function escapeJsonForScript(jsonText: string): string {
  const len = jsonText.length;
  const lower = jsonText.toLowerCase();
  let out = "";
  let i = 0;

  while (i < len) {
    const ch = jsonText[i]!;
    if (ch === "<") {
      if (lower.startsWith("</script", i)) {
        out += "\\u003c" + jsonText.slice(i + 1, i + 8);
        i += 8;
        continue;
      }
      if (jsonText.startsWith("<!--", i)) {
        out += "\\u003c!--";
        i += 4;
        continue;
      }
    } else if (ch === "\u2028") {
      out += "\\u2028";
      i += 1;
      continue;
    } else if (ch === "\u2029") {
      out += "\\u2029";
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }

  return out;
}

export function serializeJsonForScript(value: unknown, space?: number): string {
  const raw = JSON.stringify(value, null, space);
  const jsonText = raw === undefined ? "null" : raw;
  return escapeJsonForScript(jsonText);
}

export function serializeJsonScriptTag(
  id: string,
  value: unknown,
  options?: { readonly nonce?: string | undefined; readonly space?: number | undefined }
): string {
  const escapedId = escapeHtmlAttribute(id);
  const nonceAttr =
    options?.nonce !== undefined ? ` nonce="${escapeHtmlAttribute(options.nonce)}"` : "";
  const body = serializeJsonForScript(value, options?.space);
  return `<script id="${escapedId}" type="application/json"${nonceAttr}>${body}</script>`;
}
