import { createRoot, createEffect } from "@mix/runtime";
import { setSanitizerProvider } from "@mix/runtime";
import { Header } from "./Header.js";
import { App } from "./App.js";
import { DiamondReactivity } from "./DiamondReactivity.js";
import { TodoList } from "./TodoList.js";
import { AsyncCancellation } from "./AsyncCancellation.js";
import { DynamicCard } from "./DynamicCard.js";
import { SecurityDemo } from "./SecurityDemo.js";
import { TypeSafeCard } from "./TypeSafeCard.js";

// 1. Register Trusted Sanitizer Provider (D-109 / §6.4)
setSanitizerProvider({
  sanitizeHtml(raw) {
    return String(raw)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");
  }
});

// 2. Mount Application Root
export function mountApplication(container = (typeof document !== "undefined" ? document.getElementById("app") : null)) {
  if (!container) return null;
  container.innerHTML = "";

  return createRoot((dispose) => {
    // Mount Header
    const headerInstance = Header();
    container.appendChild(headerInstance.element);

    // Mount App Shell
    const appInstance = App();
    container.appendChild(appInstance.element);

    const grid = appInstance.element.querySelector("#showcase-grid");

    // Instantiate Showcase Components
    const reactivityInstance = DiamondReactivity();
    const todoInstance = TodoList();
    const cancellationInstance = AsyncCancellation();
    const dynamicInstance = DynamicCard();
    const securityInstance = SecurityDemo();
    const typeSafeInstance = TypeSafeCard();

    const sections = [
      { id: "reactivity", el: reactivityInstance.element },
      { id: "todos", el: todoInstance.element },
      { id: "cancellation", el: cancellationInstance.element },
      { id: "dynamic", el: dynamicInstance.element },
      { id: "security", el: securityInstance.element },
      { id: "typesafe", el: typeSafeInstance.element }
    ];

    // Reactive View Filtering based on activeTab
    createEffect(() => {
      const activeTab = appInstance.activeTab ? appInstance.activeTab() : "all";
      if (!grid) return;
      grid.innerHTML = "";

      for (const sec of sections) {
        if (activeTab === "all" || activeTab === sec.id) {
          grid.appendChild(sec.el);
        }
      }
    });

    return {
      dispose,
      headerInstance,
      appInstance,
      reactivityInstance,
      todoInstance,
      cancellationInstance,
      dynamicInstance,
      securityInstance,
      typeSafeInstance
    };
  });
}

// Auto-mount if running in browser
if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountApplication());
  } else {
    mountApplication();
  }
}
