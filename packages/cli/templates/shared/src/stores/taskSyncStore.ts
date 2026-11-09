import { syncCollection } from "@mix/sync";

export interface TaskRecord {
  id: string;
  title: string;
  completed: boolean;
  ownerId: number;
}

export const taskStore = syncCollection<TaskRecord>({
  key: "app_tasks",
  initialItems: [
    { id: "task-1", title: "Build compiler frontend", completed: true, ownerId: 1 },
    { id: "task-2", title: "Fine-grained reactivity", completed: true, ownerId: 1 },
    { id: "task-3", title: "Ship isomorphic RBAC permissions", completed: false, ownerId: 1 }
  ]
});
