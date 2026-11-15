import { syncCollection } from "@dotmix/sync";

export interface TaskItem {
  id: string;
  title: string;
  done: boolean;
}

interface BootReadySource {
  ready?: Promise<void>;
}

const STARTER_TASKS_SEEDED_KEY = "dotmix-showcase-tasks-seeded";

const STARTER_TASKS: readonly TaskItem[] = [
  { id: "task-1", title: "Read the directives reference", done: true },
  { id: "task-2", title: "Try the offline list", done: false },
  { id: "task-3", title: "Reload the page and check persistence", done: false }
];

export const taskCollection = syncCollection<TaskItem>("showcase-tasks", {
  driver: "indexeddb"
});

async function seedStarterTasksIfEmpty(): Promise<void> {
  const readySource: BootReadySource = taskCollection;
  if (readySource.ready) {
    await readySource.ready;
  }
  if (taskCollection.items().length > 0) {
    return;
  }
  if (typeof window !== "undefined") {
    try {
      if (window.localStorage.getItem(STARTER_TASKS_SEEDED_KEY) === "1") {
        return;
      }
      window.localStorage.setItem(STARTER_TASKS_SEEDED_KEY, "1");
    } catch {
      // Proceed even if localStorage is unavailable in restricted contexts.
    }
  }
  for (const starterTask of STARTER_TASKS) {
    await taskCollection.insert(starterTask);
  }
}

void seedStarterTasksIfEmpty();

interface ErrorCodeSource {
  errorCode?: () => string | undefined;
}

export function readTaskErrorCode(): string {
  const source: ErrorCodeSource = taskCollection;
  return source.errorCode?.() ?? "none";
}

let nextTaskNumber = Date.now();

export function createTaskId(): string {
  nextTaskNumber += 1;
  return "task-" + nextTaskNumber.toString(36);
}
