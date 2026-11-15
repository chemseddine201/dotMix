import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { mount } from "../../node_modules/@dotmix/runtime/dist/index.js";
import {
  createMemoryRouter,
  RouterProvider,
  Outlet,
  useLoaderData
} from "../../node_modules/@dotmix/router/dist/index.js";

test("useLoaderData() without a route id returns loader data on parameterized route /users/:id", async () => {
  const domWindow = new Window({ url: "http://localhost:3000/" });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = domWindow;
  globalThis.document = domWindow.document;

  try {
    const router = createMemoryRouter({
      initialEntries: ["/"],
      routes: [
        {
          path: "/",
          element: () => domWindow.document.createElement("span")
        },
        {
          path: "/users/:id",
          loader: async ({ params }) => ({ userId: params.id, name: "Ada" }),
          element: () => {
            const loaderData = useLoaderData();
            const paragraph = domWindow.document.createElement("p");
            paragraph.id = "user-profile";
            paragraph.textContent = loaderData ? `${loaderData.userId}:${loaderData.name}` : "missing";
            return paragraph;
          }
        }
      ]
    });

    const host = domWindow.document.createElement("div");
    domWindow.document.body.appendChild(host);
    mount(() => RouterProvider({ router, children: () => Outlet() }), host);

    await router.push("/users/42");

    const profile = host.querySelector("#user-profile");
    assert.ok(profile, "Expected the parameterized route page to render");
    assert.equal(profile.textContent, "42:Ada");
  } finally {
    domWindow.close();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
});
