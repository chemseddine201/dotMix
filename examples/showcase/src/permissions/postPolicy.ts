import { defineAbility, subject } from "@dotmix/runtime/permissions";

export type PostRole = "viewer" | "editor" | "admin";

export interface PostRecord {
  id: number;
  title: string;
}

export function definePostAbility(role: PostRole) {
  return defineAbility((can) => {
    if (role === "admin") {
      can(["view", "edit", "delete", "publish", "archive"], "Post");
    } else if (role === "editor") {
      can(["view", "edit", "publish"], "Post");
    } else {
      can("view", "Post");
    }
  });
}

export const samplePost: PostRecord = subject("Post", { id: 1, title: "Release notes" });
