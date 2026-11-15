import { computed, signal } from "@dotmix/runtime";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "dotmix-showcase-theme";

function readStoredTheme(): ThemeChoice {
  if (typeof window === "undefined") {
    return "system";
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") {
      return raw;
    }
  } catch {
    return "system";
  }
  return "system";
}

function readSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const themeChoice = signal<ThemeChoice>(readStoredTheme());
const systemTheme = signal<ResolvedTheme>(readSystemTheme());

export const resolvedTheme = computed<ResolvedTheme>(() => {
  const choice = themeChoice();
  return choice === "system" ? systemTheme() : choice;
});

function applyThemeToDocument(choice: ThemeChoice): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  root.setAttribute("data-theme-choice", choice);
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

applyThemeToDocument(themeChoice());

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = (event: MediaQueryListEvent): void => {
    systemTheme.set(event.matches ? "dark" : "light");
  };
  if (typeof media.addEventListener === "function") {
    media.addEventListener("change", handleChange);
  }
}

export function setTheme(next: ThemeChoice): void {
  themeChoice.set(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be unavailable in restricted contexts.
    }
  }
  applyThemeToDocument(next);
}

