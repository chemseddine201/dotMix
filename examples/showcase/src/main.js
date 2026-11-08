import { createRoot, createEffect, setSanitizerProvider } from "@mix/runtime";
import { createRouter } from "@mix/router";

import { Header } from "./Header.js";
import { App } from "./App.js";
import { Counter } from "./Counter.js";
import { DynamicCard } from "./DynamicCard.js";
import { TodoList } from "./TodoList.js";
import { SecurityDemo } from "./SecurityDemo.js";

// 1. Register Trusted Sanitizer Provider (D-109)
setSanitizerProvider({
  sanitizeHtml(raw) {
    // Strip scripts and inline event attributes for safety
    return String(raw)
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/on\w+\s*=\s*["'][^"']*["']/gi, "");
  }
});

// 2. Initialize Client-Side Router
export const router = createRouter({
  initialPath: typeof window !== "undefined" && window.location.pathname.length > 1 ? window.location.pathname : "/all",
  routes: [
    { path: "/all" },
    { path: "/counter" },
    { path: "/dynamic" },
    { path: "/todos" },
    { path: "/security" }
  ]
});

// 3. Mount Application Root
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
    const counterInstance = Counter();
    const dynamicInstance = DynamicCard();
    const todoInstance = TodoList();
    const securityInstance = SecurityDemo();

    const sections = [
      { id: "counter", el: counterInstance.element },
      { id: "dynamic", el: dynamicInstance.element },
      { id: "todos", el: todoInstance.element },
      { id: "security", el: securityInstance.element }
    ];

    // Reactive View Filtering based on activeTab
    createEffect(() => {
      const activeTab = appInstance.activeTab();
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
      counterInstance,
      dynamicInstance,
      todoInstance,
      securityInstance
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

