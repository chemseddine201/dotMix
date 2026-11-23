import { mount } from "@dotmix/runtime";
import { createBrowserRouter, RouterProvider } from "@dotmix/router";
import { routes } from "./routes.js";

const router = createBrowserRouter({
  routes,
  i18n: {
    locales: ["ar", "fr"],
    defaultLocale: "ar",
    prefixDefault: false,
    dir: { ar: "rtl", fr: "ltr" }
  }
});

const root = document.getElementById("app");
if (root) {
  mount(() => RouterProvider({ router }) as Node, root);
}

