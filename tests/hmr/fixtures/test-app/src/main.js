/* global window, document */
import { mount } from "@dotmix/runtime";
import App from "./App.mix";
import { entryVersion } from "./entry-helper.js";

window.__entryVersion = entryVersion;
if (typeof window !== "undefined") {
  window.__reloadMarker = (window.__reloadMarker || 0) + 1;
}

const container = document.getElementById("app");
if (container) {
  mount(App, container);
}
