/**
 * mix-helpers/data — String Case Conversion, Slugification & Escaping Utilities
 */

export function words(str: string): string[] {
  if (!str) return [];
  const matches = str.match(/[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\W|$)|[0-9]+/g);
  return matches || [];
}

export function camelCase(str: string): string {
  const w = words(str);
  if (w.length === 0) return "";
  return (
    w[0]!.toLowerCase() +
    w
      .slice(1)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("")
  );
}

export function kebabCase(str: string): string {
  return words(str)
    .map((word) => word.toLowerCase())
    .join("-");
}

export function snakeCase(str: string): string {
  return words(str)
    .map((word) => word.toLowerCase())
    .join("_");
}

export function pascalCase(str: string): string {
  return words(str)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
}

export function capitalize(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

export function deburr(str: string): string {
  if (!str) return "";
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function slugify(str: string): string {
  return deburr(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function truncate(str: string, options: { length?: number; omission?: string } = {}): string {
  const len = options.length ?? 30;
  const omission = options.omission ?? "...";
  if (str.length <= len) return str;
  return str.slice(0, Math.max(0, len - omission.length)) + omission;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const HTML_UNESCAPE_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

export function escapeHtml(str: string): string {
  if (!str) return "";
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

export function unescapeHtml(str: string): string {
  if (!str) return "";
  return str.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_UNESCAPE_MAP[entity] ?? entity);
}
