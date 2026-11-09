/**
 * Mix Showcase — Live React Router v6/v7 Parity Demo
 *
 * Demonstrates:
 * 1. Declarative <Routes>, <Route>, and <Outlet /> nested layout
 * 2. Parent layout preservation (mount count stays at 1)
 * 3. Polymorphic useNavigate() (paths and -1 back navigation)
 * 4. useParams() for dynamic :userId and wildcard splats (*)
 * 5. useSearchParams() with live two-way URL query synchronization
 * 6. <NavLink /> with active class toggling and aria-current="page"
 */

/* global document, setTimeout, console */

import {
  createMemoryRouter,
  RouterProvider,
  Routes,
  Route,
  Outlet,
  NavLink,
  useNavigate,
  useLocation,
  useParams,
  useSearchParams,
  useOutletContext
} from "/router/index.js";

export default function RouterDemo() {
  const container = document.createElement("div");
  container.className = "router-showcase-container";

  let layoutMounts = 0;

  // 1. Parent Layout Component with <Outlet />
  function DashboardLayout() {
    layoutMounts++;
    const layoutEl = document.createElement("div");
    layoutEl.style.cssText = `
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      font-family: inherit;
    `;

    const nav = document.createElement("div");
    nav.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #e2e8f0;
      align-items: center;
    `;

    // History Back / Forward Controls
    const navControls = document.createElement("div");
    navControls.style.cssText = "display: flex; gap: 6px; margin-right: 12px;";

    const btnBack = document.createElement("button");
    btnBack.textContent = "← Back (-1)";
    btnBack.style.cssText = "padding: 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; cursor: pointer; font-size: 13px; font-weight: 600;";

    const btnForward = document.createElement("button");
    btnForward.textContent = "Forward (+1) →";
    btnForward.style.cssText = "padding: 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1; background: #f8fafc; cursor: pointer; font-size: 13px; font-weight: 600;";

    navControls.appendChild(btnBack);
    navControls.appendChild(btnForward);
    nav.appendChild(navControls);

    function createStyledNavLink(to, label, end = false) {
      return NavLink({
        to,
        end,
        className: ({ isActive }) =>
          isActive
            ? "router-nav-link active"
            : "router-nav-link",
        children: label
      });
    }

    nav.appendChild(createStyledNavLink("/", "Overview", true));
    nav.appendChild(createStyledNavLink("/analytics", "Analytics"));
    nav.appendChild(createStyledNavLink("/users/mix-architect", "User Profile (:id)"));
    nav.appendChild(createStyledNavLink("/files/packages/router/src/match.ts", "File Splat (*)"));

    layoutEl.appendChild(nav);

    // Layout mount counter badge (proves parent does NOT remount when switching child tabs!)
    const badgeBar = document.createElement("div");
    badgeBar.style.cssText = "display: flex; justify-content: space-between; margin-bottom: 16px; font-size: 12px; color: #64748b;";
    badgeBar.innerHTML = `
      <span>Parent Layout Mounts: <strong style="color: #2563eb;">${layoutMounts}</strong> (Never remounts on route switch!)</span>
      <span id="live-loc-display">Location: Loading...</span>
    `;
    layoutEl.appendChild(badgeBar);

    // Child Outlet projection with context
    const outletContainer = document.createElement("div");
    outletContainer.style.cssText = "min-height: 200px; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px dashed #cbd5e1;";
    outletContainer.appendChild(
      Outlet({
        context: {
          appName: "Mix Router Showcase",
          version: "0.1.0",
          engine: "Push-Pull Reactive DOM"
        }
      })
    );
    layoutEl.appendChild(outletContainer);

    // Wire up navigate(-1) and navigate(1)
    setTimeout(() => {
      try {
        const navigate = useNavigate();
        const loc = useLocation();
        btnBack.onclick = () => navigate(-1);
        btnForward.onclick = () => navigate(1);

        const locSpan = layoutEl.querySelector("#live-loc-display");
        if (locSpan) {
          locSpan.innerHTML = `Path: <code style="color: #0f172a; font-weight: 600;">${loc.pathname}${loc.search}</code>`;
        }
      } catch (e) {
        console.error(e);
      }
    }, 0);

    return layoutEl;
  }

  // 2. Overview Page
  function OverviewPage() {
    const el = document.createElement("div");
    const ctx = useOutletContext();
    el.innerHTML = `
      <h3 style="margin-top: 0; color: #0f172a;">⚡ Welcome to @mix/router (React Router v6/v7 Parity)</h3>
      <p style="color: #475569; line-height: 1.6;">
        This page demonstrates zero-overhead React Router parity in Mix. The router uses the exact
        specificity ranking algorithm (static +10, param +3, splat -2, index +2) while compiling
        directly to surgical DOM operations with zero Virtual DOM.
      </p>
      <div style="margin-top: 12px; padding: 12px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; font-size: 13px; color: #1e40af;">
        <strong>Context from &lt;Outlet context={...}&gt;:</strong> ${ctx ? `${ctx.appName} (Engine: ${ctx.engine})` : "Active"}
      </div>
    `;
    return el;
  }

  // 3. Analytics Page with useSearchParams()
  function AnalyticsPage() {
    const el = document.createElement("div");
    el.innerHTML = `
      <h3 style="margin-top: 0; color: #0f172a;">📊 Analytics & Search Params</h3>
      <p style="color: #475569;">Demonstrates <code>useSearchParams()</code> synchronized with URL query:</p>
      <div style="display: flex; gap: 8px; margin: 12px 0;">
        <button id="btn-tab-day" style="padding: 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; cursor: pointer;">Period: 24h</button>
        <button id="btn-tab-week" style="padding: 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; cursor: pointer;">Period: 7d</button>
        <button id="btn-tab-month" style="padding: 6px 12px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; cursor: pointer;">Period: 30d</button>
      </div>
      <div id="analytics-info" style="font-family: monospace; font-size: 13px; color: #334155; padding: 10px; background: #ffffff; border-radius: 6px; border: 1px solid #e2e8f0;"></div>
    `;

    setTimeout(() => {
      try {
        const [searchParams, setSearchParams] = useSearchParams();
        const info = el.querySelector("#analytics-info");
        const updateDisplay = () => {
          if (info) {
            info.textContent = `Current Period: ${searchParams.get("period") || "default (24h)"} | Raw Query: ${searchParams.toString() || "(none)"}`;
          }
        };
        updateDisplay();

        const btnDay = el.querySelector("#btn-tab-day");
        const btnWeek = el.querySelector("#btn-tab-week");
        const btnMonth = el.querySelector("#btn-tab-month");

        if (btnDay) btnDay.onclick = () => { setSearchParams({ period: "24h" }); updateDisplay(); };
        if (btnWeek) btnWeek.onclick = () => { setSearchParams({ period: "7d" }); updateDisplay(); };
        if (btnMonth) btnMonth.onclick = () => { setSearchParams({ period: "30d" }); updateDisplay(); };
      } catch (e) {
        console.error(e);
      }
    }, 0);

    return el;
  }

  // 4. User Profile Page with useParams()
  function UserProfilePage() {
    const el = document.createElement("div");
    el.innerHTML = `
      <h3 style="margin-top: 0; color: #0f172a;">👤 Dynamic Route Parameter</h3>
      <p style="color: #475569;">Route pattern: <code>/users/:id</code></p>
      <div id="user-param-box" style="padding: 16px; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
        Loading params...
      </div>
    `;

    setTimeout(() => {
      try {
        const params = useParams();
        const box = el.querySelector("#user-param-box");
        if (box) {
          box.innerHTML = `
            <div>Matched Parameter: <strong style="color: #059669; font-size: 16px;">:id = "${params().id || params.id}"</strong></div>
            <div style="font-size: 12px; color: #64748b; margin-top: 6px;">Extracted with zero-regex Radix/Segment tree matcher.</div>
          `;
        }
      } catch (e) {
        console.error(e);
      }
    }, 0);

    return el;
  }

  // 5. Wildcard Splat Page with params["*"]
  function FileViewerPage() {
    const el = document.createElement("div");
    el.innerHTML = `
      <h3 style="margin-top: 0; color: #0f172a;">📁 Wildcard Splat Route</h3>
      <p style="color: #475569;">Route pattern: <code>/files/*</code></p>
      <div id="file-splat-box" style="padding: 16px; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0; font-family: monospace;">
        Loading splat...
      </div>
    `;

    setTimeout(() => {
      try {
        const params = useParams();
        const box = el.querySelector("#file-splat-box");
        if (box) {
          box.innerHTML = `
            <div>Splat Rest Path: <strong style="color: #d97706;">params["*"] = "${params()["*"] || params["*"]}"</strong></div>
            <div style="font-size: 12px; color: #64748b; margin-top: 6px; font-family: sans-serif;">Full multi-segment remainder captured exactly like React Router v6.</div>
          `;
        }
      } catch (e) {
        console.error(e);
      }
    }, 0);

    return el;
  }

  // 6. Router Setup with <Routes> and <Route>
  const router = createMemoryRouter([
    {
      path: "/",
      element: DashboardLayout,
      children: [
        { index: true, element: OverviewPage },
        { path: "analytics", element: AnalyticsPage },
        { path: "users/:id", element: UserProfilePage },
        { path: "files/*", element: FileViewerPage },
      ]
    }
  ]);

  const styleEl = document.createElement("style");
  styleEl.textContent = `
    .router-nav-link {
      padding: 6px 14px;
      border-radius: 8px;
      text-decoration: none;
      color: #334155;
      font-size: 13px;
      font-weight: 600;
      background: #f1f5f9;
      transition: all 0.15s ease;
    }
    .router-nav-link:hover {
      background: #e2e8f0;
      color: #0f172a;
    }
    .router-nav-link.active {
      background: #2563eb;
      color: #ffffff;
      box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
    }
  `;
  container.appendChild(styleEl);

  RouterProvider({
    router,
    children: () => {
      container.appendChild(
        Routes({
          children: [
            Route({
              path: "/",
              element: DashboardLayout,
              children: [
                Route({ index: true, element: OverviewPage }),
                Route({ path: "analytics", element: AnalyticsPage }),
                Route({ path: "users/:id", element: UserProfilePage }),
                Route({ path: "files/*", element: FileViewerPage }),
              ]
            })
          ]
        })
      );
    }
  });

  return container;
}
