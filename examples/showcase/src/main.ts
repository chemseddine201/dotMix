import "./styles/tokens.css";
import "./styles/base.css";
import "./stores/themeStore.js";
import { mount } from "@dotmix/runtime";
import { createHashRouter } from "@dotmix/router";
import App from "./App.tix";
import { routes } from "./routes.js";

const container = document.getElementById("app");
if (container === null) {
  throw new Error("Missing #app container");
}

mount(App, container, { router: createHashRouter(routes) });
