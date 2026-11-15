import { createContext, signal, type Signal } from "@dotmix/runtime";

export interface TocEntry {
  id: string;
  title: string;
}

export interface TocController {
  entries: Signal<TocEntry[]>;
  register: (title: string) => TocEntry;
  unregister: (id: string) => void;
}

export const TocContext = createContext<TocController | null>(null);

export function createSectionId(title: string, seq: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `section-${slug}` : `section-${seq}`;
}

export function createTocController(): TocController {
  const entries = signal<TocEntry[]>([]);
  let nextSeq = 1;
  const usedIds = new Set<string>();

  function register(title: string): TocEntry {
    const base = createSectionId(title, nextSeq++);
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${base}-${suffix++}`;
    }
    usedIds.add(id);
    const entry: TocEntry = { id, title };
    entries.set([...entries(), entry]);
    return entry;
  }

  function unregister(id: string): void {
    usedIds.delete(id);
    entries.set(entries().filter((item) => item.id !== id));
  }

  return { entries, register, unregister };
}

export function scrollToSection(id: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const target = document.getElementById(id);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}
