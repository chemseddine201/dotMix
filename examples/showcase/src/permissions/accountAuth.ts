import { createAuth, signal } from "@dotmix/runtime";

export const currentAccount = signal<string | null>(null);

export const accountAuth = createAuth({
  guards: { web: () => currentAccount() },
  hasRole: (account, role) => role === "admin" && account === "Alex"
});
