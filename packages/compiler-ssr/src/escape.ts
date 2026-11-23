/**
 * @dotmix/compiler-ssr/escape — HTML escaping, state serialization, and inline SSR runtime preamble.
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

export function escapeJson(value: unknown, space?: number): string {
  const json = JSON.stringify(value, null, space) ?? "null";
  return json
    .replace(/</g, "\\u003c")
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

export function buildSsrImplicitPrimitives(
  imports: ReadonlyMap<string, string> | undefined,
  bindings: ReadonlyMap<string, unknown> | undefined
): string {
  const hasBinding = (name: string): boolean =>
    Boolean((imports && imports.has(name)) || (bindings && bindings.has(name)));
  const lines: string[] = [];
  if (!hasBinding("signal")) {
    lines.push(
      '    const signal = (init) => { let v = init; const g = () => v; g.set = (n) => { v = typeof n === "function" ? n(v) : n; }; g.update = (fn) => { v = fn(v); }; g.peek = () => v; return g; };'
    );
  }
  if (!hasBinding("computed")) {
    lines.push("    const computed = (fn) => () => fn();");
  }
  if (!hasBinding("createEffect")) {
    lines.push("    const createEffect = () => {};");
  }
  if (!hasBinding("onCleanup")) {
    lines.push("    const onCleanup = () => {};");
  }
  if (!hasBinding("onMount")) {
    lines.push("    const onMount = () => {};");
  }
  if (!hasBinding("batch")) {
    lines.push('    const batch = (fn) => (typeof fn === "function" ? fn() : undefined);');
  }
  if (!hasBinding("createRef")) {
    lines.push("    const createRef = (v = null) => ({ current: v });");
  }
  return lines.length > 0 ? lines.join("\n") + "\n" : "";
}
