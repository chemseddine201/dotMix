/**
 * React Router v6/v7 Parity Verification Test Suite
 *
 * Verifies exact parity with React Router:
 * 1. Declarative <Routes>, <Route>, and <Outlet /> nested routing
 * 2. Parent layout preservation (parent does NOT remount when child route changes)
 * 3. Segment scoring specificity algorithm (static > param > wildcard, index bonus)
 * 4. Wildcard splat routes capturing remainder into params["*"]
 * 5. Index routes (<Route index element={...} />)
 * 6. <Outlet context={...} /> and useOutletContext() communication
 * 7. Polymorphic useNavigate() (path string, options, numeric history deltas like -1)
 * 8. useLocation(), useParams(), useSearchParams(), and useMatch()
 * 9. <NavLink to="..." end className={({ isActive }) => ...}>
 * 10. Declarative <Navigate to="..." replace />
 * 11. MemoryRouter, BrowserRouter, HashRouter, and createMemoryRouter / RouterProvider
 * 12. matchPath, matchRoutes, resolvePath, generatePath utilities
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  createMemoryRouter,
  createBrowserRouter,
  createHashRouter,
  RouterProvider,
  MemoryRouter,
  Routes,
  Route,
  Outlet,
  Link,
  NavLink,
  Navigate,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
  useMatch,
  useOutletContext,
  matchPath,
  matchRoutes,
  resolvePath,
  generatePath,
  createRoutesFromElements,
} from "../../packages/router/dist/index.js";
import { createRoot } from "../../packages/runtime/dist/index.js";

describe("React Router v6/v7 Exact Parity (@mix/router)", () => {
  let window;
  let doc;

  beforeEach(() => {
    window = new Window();
    doc = window.document;
    globalThis.window = window;
    globalThis.document = doc;
  });

  test("1. Route Ranking & Segment Scoring matches React Router exact specificity algorithm", () => {
    // Route tree with overlapping patterns:
    // static (+10) vs param (+3) vs wildcard (-2) vs index (+2)
    const routes = [
      {
        path: "/teams",
        children: [
          { path: "new", id: "teams-new" },
          { path: ":teamId", id: "teams-detail" },
          { index: true, id: "teams-index" },
          { path: "*", id: "teams-splat" },
        ],
      },
    ];

    // 1. Static match "/teams/new" must beat ":teamId" and "*"
    const matchNew = matchRoutes(routes, "/teams/new");
    assert.ok(matchNew);
    assert.strictEqual(matchNew[matchNew.length - 1].route.id, "teams-new");

    // 2. Dynamic param "/teams/fc-barcelona" matches ":teamId"
    const matchParam = matchRoutes(routes, "/teams/fc-barcelona");
    assert.ok(matchParam);
    assert.strictEqual(matchParam[matchParam.length - 1].route.id, "teams-detail");
    assert.strictEqual(matchParam[matchParam.length - 1].params.teamId, "fc-barcelona");

    // 3. Index route matches "/teams"
    const matchIndex = matchRoutes(routes, "/teams");
    assert.ok(matchIndex);
    assert.strictEqual(matchIndex[matchIndex.length - 1].route.id, "teams-index");

    // 4. Multi-segment subpath "/teams/a/b/c" falls through to splat "*"
    const matchSplat = matchRoutes(routes, "/teams/a/b/c");
    assert.ok(matchSplat);
    assert.strictEqual(matchSplat[matchSplat.length - 1].route.id, "teams-splat");
    assert.strictEqual(matchSplat[matchSplat.length - 1].params["*"], "a/b/c");
  });

  test("2. Declarative <Routes>, <Route>, and <Outlet /> nested layout rendering without remount", () => {
    let parentMountCount = 0;
    let homeMountCount = 0;
    let aboutMountCount = 0;

    const Layout = () => {
      parentMountCount++;
      const el = doc.createElement("div");
      el.className = "app-layout";
      el.innerHTML = "<h1>Header</h1>";
      el.appendChild(Outlet());
      return el;
    };

    const Home = () => {
      homeMountCount++;
      const el = doc.createElement("p");
      el.className = "home-page";
      el.textContent = "Welcome Home";
      return el;
    };

    const About = () => {
      aboutMountCount++;
      const el = doc.createElement("p");
      el.className = "about-page";
      el.textContent = "About Mix Framework";
      return el;
    };

    const router = createMemoryRouter([
      {
        path: "/",
        element: Layout,
        children: [
          { index: true, element: Home },
          { path: "about", element: About },
        ],
      },
    ]);

    const rootEl = doc.createElement("div");
    doc.body.appendChild(rootEl);

    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          rootEl.appendChild(
            Routes({
              children: [
                Route({
                  path: "/",
                  element: Layout,
                  children: [
                    Route({ index: true, element: Home }),
                    Route({ path: "about", element: About }),
                  ],
                }),
              ],
            })
          );
        },
      });
    });

    // Initial render at "/"
    assert.strictEqual(parentMountCount, 1, "Layout must mount once");
    assert.strictEqual(homeMountCount, 1, "Home must mount once");
    assert.strictEqual(aboutMountCount, 0, "About not yet mounted");
    assert.ok(rootEl.querySelector(".app-layout"));
    assert.ok(rootEl.querySelector(".home-page"));

    // Navigate to "/about"
    void router.push("/about");

    assert.strictEqual(parentMountCount, 1, "Layout MUST NOT remount when switching to child route");
    assert.strictEqual(aboutMountCount, 1, "About must mount");
    assert.strictEqual(rootEl.querySelector(".home-page"), null, "Home must be unmounted");
    assert.ok(rootEl.querySelector(".about-page"), "About page rendered in outlet");

    router.destroy();
  });

  test("3. <Outlet context={...} /> and useOutletContext() communication", () => {
    let receivedUser = null;

    const DashboardLayout = () => {
      const container = doc.createElement("div");
      const outletNode = Outlet({
        context: { user: "Senior Architect", role: "admin" },
      });
      container.appendChild(outletNode);
      return container;
    };

    const ProfilePage = () => {
      const ctx = useOutletContext();
      receivedUser = ctx;
      const el = doc.createElement("span");
      el.textContent = `User: ${ctx.user} (${ctx.role})`;
      return el;
    };

    const router = createMemoryRouter([
      {
        path: "/dashboard",
        element: DashboardLayout,
        children: [{ path: "profile", element: ProfilePage }],
      },
    ], { initialEntries: ["/dashboard/profile"] });

    const root = doc.createElement("div");
    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          root.appendChild(
            Routes({
              children: [
                Route({
                  path: "/dashboard",
                  element: DashboardLayout,
                  children: [Route({ path: "profile", element: ProfilePage })],
                }),
              ],
            })
          );
        },
      });
    });

    assert.ok(receivedUser);
    assert.strictEqual(receivedUser.user, "Senior Architect");
    assert.strictEqual(receivedUser.role, "admin");

    router.destroy();
  });

  test("4. Polymorphic useNavigate(): path, options (replace), and numeric history delta (-1)", async () => {
    const router = createMemoryRouter([
      { path: "/" },
      { path: "/step-1" },
      { path: "/step-2" },
      { path: "/step-3" },
    ]);

    let navigate;
    let location;

    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          navigate = useNavigate();
          location = useLocation();
        },
      });
    });

    assert.strictEqual(location.pathname, "/");

    // 1. Navigate by path string
    await navigate("/step-1");
    assert.strictEqual(location.pathname, "/step-1");

    await navigate("/step-2");
    assert.strictEqual(location.pathname, "/step-2");

    // 2. Navigate with replace option
    await navigate("/step-3", { replace: true });
    assert.strictEqual(location.pathname, "/step-3");

    // 3. Navigate with numeric delta (go back -1)
    navigate(-1);
    assert.strictEqual(location.pathname, "/step-1", "navigate(-1) should return to step-1 (since step-3 replaced step-2)");

    router.destroy();
  });

  test("5. useParams() dynamic params and wildcard splat (*)", async () => {
    const router = createMemoryRouter([
      { path: "/files/*" },
      { path: "/posts/:postId/comments/:commentId" },
    ], { initialEntries: ["/files/src/components/Button.tsx"] });

    let paramsFn;

    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          paramsFn = useParams();
        },
      });
    });

    // Splat captured in params["*"]
    assert.strictEqual(paramsFn()["*"], "src/components/Button.tsx");
    assert.strictEqual(paramsFn["*"], "src/components/Button.tsx");

    // Switch to multi-param route
    await router.push("/posts/42/comments/99");
    assert.strictEqual(paramsFn().postId, "42");
    assert.strictEqual(paramsFn().commentId, "99");
    assert.strictEqual(paramsFn.postId, "42");
    assert.strictEqual(paramsFn.commentId, "99");

    router.destroy();
  });

  test("6. useSearchParams() get, set, and URL query synchronization", async () => {
    const router = createMemoryRouter([
      { path: "/catalog" },
    ], { initialEntries: ["/catalog?category=books&sort=price"] });

    let searchParams;
    let setSearchParams;

    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          [searchParams, setSearchParams] = useSearchParams();
        },
      });
    });

    // React-style .get() method
    assert.strictEqual(searchParams.get("category"), "books");
    assert.strictEqual(searchParams.get("sort"), "price");
    assert.strictEqual(searchParams.has("category"), true);
    assert.strictEqual(searchParams.has("nonexistent"), false);

    // Direct property access
    assert.strictEqual(searchParams.category, "books");
    assert.strictEqual(searchParams.sort, "price");

    // Update search params
    setSearchParams({ category: "electronics", sort: "rating", page: "2" });
    assert.strictEqual(searchParams.get("category"), "electronics");
    assert.strictEqual(searchParams.get("page"), "2");
    assert.strictEqual(router.currentRoute().pathname, "/catalog");
    assert.strictEqual(router.currentRoute().query.category, "electronics");

    router.destroy();
  });

  test("7. useMatch() pattern specificity matcher", async () => {
    const router = createMemoryRouter([
      { path: "/docs/:section/:page" },
      { path: "/blog/*" },
    ], { initialEntries: ["/docs/guides/getting-started"] });

    let matchDocs;
    let matchBlog;

    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          matchDocs = useMatch("/docs/:section/:page");
          matchBlog = useMatch("/blog/*");
        },
      });
    });

    assert.ok(matchDocs());
    assert.strictEqual(matchDocs().params.section, "guides");
    assert.strictEqual(matchDocs().params.page, "getting-started");
    assert.strictEqual(matchBlog(), null);

    // Switch to blog
    await router.push("/blog/2026/mix-framework-launch");
    assert.strictEqual(matchDocs(), null);
    assert.ok(matchBlog());
    assert.strictEqual(matchBlog().params["*"], "2026/mix-framework-launch");

    router.destroy();
  });

  test("8. <NavLink /> active styling, className callback, and 'end' prop matching", async () => {
    const router = createMemoryRouter([
      { path: "/" },
      { path: "/users" },
      { path: "/users/:id" },
    ], { initialEntries: ["/users/100"] });

    let homeLink;
    let usersPrefixLink;
    let usersExactLink;

    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          homeLink = NavLink({
            to: "/",
            end: true,
            className: ({ isActive }) => (isActive ? "nav-link active" : "nav-link"),
            children: "Home",
          });

          // Prefix match (end: false, default)
          usersPrefixLink = NavLink({
            to: "/users",
            end: false,
            className: ({ isActive }) => (isActive ? "nav-link active" : "nav-link"),
            children: "Users (Prefix)",
          });

          // Exact match (end: true)
          usersExactLink = NavLink({
            to: "/users",
            end: true,
            className: ({ isActive }) => (isActive ? "nav-link active" : "nav-link"),
            children: "Users (Exact)",
          });
        },
      });
    });

    // Currently at "/users/100":
    // 1. Home is inactive
    assert.strictEqual(homeLink.className, "nav-link");
    assert.strictEqual(homeLink.hasAttribute("aria-current"), false);

    // 2. Users prefix link IS active because /users/100 starts with /users/
    assert.strictEqual(usersPrefixLink.className, "nav-link active");
    assert.strictEqual(usersPrefixLink.getAttribute("aria-current"), "page");

    // 3. Users exact link is NOT active because /users/100 !== /users
    assert.strictEqual(usersExactLink.className, "nav-link");
    assert.strictEqual(usersExactLink.hasAttribute("aria-current"), false);

    // Navigate to "/users" exact
    await router.push("/users");
    assert.strictEqual(usersPrefixLink.className, "nav-link active");
    assert.strictEqual(usersExactLink.className, "nav-link active");

    router.destroy();
  });

  test("9. Declarative <Navigate to='...' replace /> redirect component", async () => {
    const router = createMemoryRouter([
      { path: "/" },
      { path: "/legacy" },
      { path: "/modern" },
    ], { initialEntries: ["/legacy"] });

    const root = doc.createElement("div");

    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          root.appendChild(
            Routes({
              children: [
                Route({ path: "/", element: "Home" }),
                Route({ path: "/legacy", element: () => Navigate({ to: "/modern", replace: true }) }),
                Route({ path: "/modern", element: "Modern Page" }),
              ],
            })
          );
        },
      });
    });

    // Immediately redirected to /modern
    assert.strictEqual(router.currentRoute().pathname, "/modern");

    router.destroy();
  });

  test("10. Utility functions: matchPath, resolvePath, generatePath, and createRoutesFromElements", () => {
    // 1. matchPath
    const match = matchPath({ path: "/org/:orgId/repo/:repoId", end: true }, "/org/google/repo/mix");
    assert.ok(match);
    assert.strictEqual(match.params.orgId, "google");
    assert.strictEqual(match.params.repoId, "mix");

    // 2. resolvePath
    const resolved = resolvePath("../../settings", "/admin/users/details");
    assert.strictEqual(resolved.pathname, "/admin/settings");

    // 3. generatePath
    const generated = generatePath("/products/:cat/:id", { cat: "laptops", id: "macbook" });
    assert.strictEqual(generated, "/products/laptops/macbook");

    const splatGen = generatePath("/files/*", { "*": "reports/q1.pdf" });
    assert.strictEqual(splatGen, "/files/reports/q1.pdf");

    // 4. createRoutesFromElements
    const routeElements = [
      Route({
        path: "/",
        element: "Layout",
        children: [
          Route({ index: true, element: "Home" }),
          Route({ path: "contact", element: "Contact" }),
        ],
      }),
    ];

    const parsedRoutes = createRoutesFromElements(routeElements);
    assert.strictEqual(parsedRoutes.length, 1);
    assert.strictEqual(parsedRoutes[0].path, "/");
    assert.strictEqual(parsedRoutes[0].children.length, 2);
    assert.strictEqual(parsedRoutes[0].children[0].index, true);
    assert.strictEqual(parsedRoutes[0].children[1].path, "contact");
  });

  test("11. MemoryRouter, BrowserRouter, HashRouter, and <Link to='...'>", () => {
    // 1. MemoryRouter component
    let memLoc;
    createRoot(() => {
      MemoryRouter({
        initialEntries: ["/test-mem"],
        children: () => {
          memLoc = useLocation();
        },
      });
    });
    assert.strictEqual(memLoc.pathname, "/test-mem");

    // 2. <Link to="..."> component
    const router = createMemoryRouter([{ path: "/" }, { path: "/target" }]);
    let linkEl;
    createRoot(() => {
      RouterProvider({
        router,
        children: () => {
          linkEl = Link({ to: "/target", className: "nav-btn", children: "Go" });
        },
      });
    });
    assert.strictEqual(linkEl.getAttribute("href"), "/target");
    linkEl.click();
    assert.strictEqual(router.currentRoute().pathname, "/target");

    // 3. createBrowserRouter and createHashRouter factory checks
    const browserRouter = createBrowserRouter([{ path: "/" }]);
    assert.ok(browserRouter);
    browserRouter.destroy();

    const hashRouter = createHashRouter([{ path: "/" }]);
    assert.ok(hashRouter);
    hashRouter.destroy();
  });
});
