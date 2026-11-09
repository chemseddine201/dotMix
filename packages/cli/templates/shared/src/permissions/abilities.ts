import { defineAbility } from "@mix/runtime/permissions";
import type { TaskSubject } from "./subjects.js";

export interface UserSession {
  id: number;
  name: string;
  roles: string[];
}

export function defineAppAbility(user: UserSession | null) {
  return defineAbility((can, cannot) => {
    if (!user) {
      can("read", "PublicContent");
      return;
    }

    if (user.roles.includes("admin")) {
      can("manage", "all");
      return;
    }

    can("read", "Dashboard");
    can("read", "Task");
    can("create", "Task");

    // Dynamic signal-aware ABAC condition
    can("update", "Task", (task: TaskSubject) => {
      const owner = typeof task.ownerId === "function" ? task.ownerId() : task.ownerId;
      const locked = typeof task.isLocked === "function" ? task.isLocked() : task.isLocked;
      return owner === user.id && !locked;
    });

    cannot("delete", "Task");
  });
}
