import { defineAbility, subject } from "@dotmix/runtime/permissions";

export type ArticleRole = "author" | "editor" | "admin";

export interface ArticleRecord {
  id: number;
  authorId: number;
  locked: boolean;
}

export function defineArticleAbility(role: ArticleRole, currentUserId: number) {
  return defineAbility((can, cannot) => {
    if (role === "admin") {
      can("manage", "all");
      return;
    }
    can("read", "Article");
    if (role === "editor") {
      can(["edit", "update", "delete"], "Article");
      return;
    }
    can("edit", "Article", (article: ArticleRecord) => article.authorId === currentUserId && !article.locked);
    can("update", "Article", ["title", "content"]);
    cannot("update", "Article", ["status"]);
    cannot("delete", "Article");
  });
}

export const sampleArticle: ArticleRecord = subject("Article", { id: 42, authorId: 101, locked: false });
