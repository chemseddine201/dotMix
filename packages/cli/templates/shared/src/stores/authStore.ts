import { signal } from "@mix/runtime";
import type { UserSession } from "../permissions/abilities.js";

export const activeUser = signal<UserSession | null>({
  id: 1,
  name: "Lead Architect",
  roles: ["editor"]
});

export function setRole(role: string) {
  activeUser.set(prev => prev ? { ...prev, roles: [role] } : null);
}

export function logout() {
  activeUser.set(null);
}
