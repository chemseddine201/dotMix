/**
 * @mix/compiler-ssr/escape — HTML escaping, state serialization, and inline SSR runtime preamble.
 */

export function escapeHtml(val: unknown): string {
  if (val === null || val === undefined) return "";
  const resolved = typeof val === "function" ? (val as () => unknown)() : val;
  if (resolved === null || resolved === undefined) return "";
  const str = String(resolved);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function serializeState(data: unknown): string {
  const json = JSON.stringify(data);
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export const SSR_RUNTIME_PREAMBLE = `function __escapeHtml(val) {
  if (val === null || val === undefined) return "";
  const resolved = typeof val === "function" ? val() : val;
  if (resolved === null || resolved === undefined) return "";
  const str = String(resolved);
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function __escapeAttr(name, val) {
  const resolved = typeof val === "function" ? val() : val;
  if (resolved === null || resolved === undefined || resolved === false) return "";
  if (resolved === true) return " " + name;
  const str = String(resolved);
  if (name === "href" || name === "src" || name === "action") {
    const norm = str.replace(/[\\x00-\\x20\\x7f]/g, "").toLowerCase();
    if (norm.startsWith("javascript:") || norm.startsWith("vbscript:")) {
      return ' ' + name + '="about:blank"';
    }
  }
  return ' ' + name + '="' + __escapeHtml(str) + '"';
}`;
