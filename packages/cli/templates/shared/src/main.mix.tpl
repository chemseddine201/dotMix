import "./styles/global.{{styleExt}}";
import { mount, computed } from "@mix/runtime";
import { RouterProvider, createBrowserRouter, createMemoryRouter } from "@mix/router";
import { PermissionProvider } from "@mix/runtime/permissions";
import { routes } from "./routes.js";
import { activeUser } from "./stores/authStore.js";
import { defineAppAbility } from "./permissions/abilities.js";

export default function Main() {
  const ability = computed(() => defineAppAbility(activeUser()));
  const router = typeof window !== "undefined" && window.history
    ? createBrowserRouter({ routes, ability })
    : createMemoryRouter({ routes, ability });

  return (
    <PermissionProvider ability={ability}>
      <RouterProvider router={router} />
    </PermissionProvider>
  );
}

if (typeof document !== "undefined") {
  const rootEl = document.getElementById("root");
  if (rootEl && rootEl.childNodes.length === 0) {
    mount(Main, rootEl);
  }
}
