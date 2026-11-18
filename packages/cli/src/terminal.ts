/**
 * @dotmix/cli — Zero-Dependency Terminal & ANSI Formatting Utilities
 */

export interface TerminalColors {
  readonly isColorSupported: boolean;
  bold(text: string): string;
  dim(text: string): string;
  italic(text: string): string;
  underline(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  blue(text: string): string;
  magenta(text: string): string;
  cyan(text: string): string;
  white(text: string): string;
  gray(text: string): string;
}

function supportsColor(): boolean {
  if (process.env.NO_COLOR !== undefined || process.env.NODE_DISABLE_COLORS !== undefined) {
    return false;
  }
  if (process.env.FORCE_COLOR !== undefined) {
    return process.env.FORCE_COLOR !== "0";
  }
  return Boolean(process.stdout && process.stdout.isTTY);
}

function createAnsiFormatter(open: number, close: number, isEnabled: boolean): (text: string) => string {
  if (!isEnabled) {
    return (text: string) => text;
  }
  const openCode = `\x1b[${open}m`;
  const closeCode = `\x1b[${close}m`;
  return (text: string) => `${openCode}${text}${closeCode}`;
}

export function createTerminalColors(forcedEnabled?: boolean): TerminalColors {
  const enabled = forcedEnabled ?? supportsColor();
  return {
    isColorSupported: enabled,
    bold: createAnsiFormatter(1, 22, enabled),
    dim: createAnsiFormatter(2, 22, enabled),
    italic: createAnsiFormatter(3, 23, enabled),
    underline: createAnsiFormatter(4, 24, enabled),
    red: createAnsiFormatter(31, 39, enabled),
    green: createAnsiFormatter(32, 39, enabled),
    yellow: createAnsiFormatter(33, 39, enabled),
    blue: createAnsiFormatter(34, 39, enabled),
    magenta: createAnsiFormatter(35, 39, enabled),
    cyan: createAnsiFormatter(36, 39, enabled),
    white: createAnsiFormatter(37, 39, enabled),
    gray: createAnsiFormatter(90, 39, enabled)
  };
}

export const colors = createTerminalColors();

export function banner(title: string, subtitle?: string): string {
  const line = colors.cyan("─".repeat(50));
  const heading = colors.bold(colors.cyan(`● dotMix — ${title}`));
  if (subtitle) {
    return `\n${line}\n${heading}\n${colors.dim(subtitle)}\n${line}\n`;
  }
  return `\n${line}\n${heading}\n${line}\n`;
}

export function formatTable(headers: string[], rows: string[][]): string {
  const colWidths: number[] = headers.map((h, i) => {
    let max = h.length;
    for (const row of rows) {
      const cell = row[i] ?? "";
      if (cell.length > max) max = cell.length;
    }
    return max;
  });

  const formatRow = (cols: string[]): string =>
    cols.map((col, i) => (col ?? "").padEnd(colWidths[i] ?? 0)).join("   ");

  const headerLine = colors.bold(formatRow(headers));
  const sep = colors.dim(colWidths.map((w) => "─".repeat(w)).join("   "));
  const dataLines = rows.map((r) => formatRow(r)).join("\n");

  return `${headerLine}\n${sep}\n${dataLines}`;
}
