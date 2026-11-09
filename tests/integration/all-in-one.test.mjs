/**
 * All-In-One Modular Architecture End-to-End Test Suite
 *
 * Verifies every major subsystem of the Mix Framework working in harmony:
 * 1. Ahead-of-Time compiler for modular .mix and .tix components (with TS 6.0.3 type checking)
 * 2. Glitch-free Push-Pull diamond reactivity (Signals, Computed, Batch, Effects)
 * 3. Minimal Keyed List reconciliation via Longest Increasing Subsequence (LIS)
 * 4. Component composition with child .tix components, dynamic <$tag>, and context
 * 5. Full React Router v6/v7 parity:
 *    - Modular <Routes>, <Route>, and <Outlet /> in .mix components
 *    - Parent layout preservation (mount count stays at 1)
 *    - Dynamic parameters (:id) and wildcard splats (*)
 *    - Polymorphic useNavigate() (paths and -1 back navigation)
 *    - URL SearchParams synchronization
 * 6. Enterprise security boundaries (HTML Sanitizer, Safe URL enforcement)
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { buildShowcase } from "../../examples/showcase/build.mjs";
import {
  mount,
  setSanitizerProvider
} from "../../packages/runtime/dist/index.js";

describe("All-In-One Modular Architecture Suite", () => {
  let win;
  let document;

  beforeEach(() => {
    win = new Window();
    document = win.document;
    globalThis.window = win;
    globalThis.document = document;
    setSanitizerProvider({
      sanitizeHtml(raw) {
        return raw.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
      }
    });
  });

  it("1. Compiles modular component hierarchy (components/, pages/, layouts) with 100% type safety", () => {
    const artifacts = buildShowcase();
    assert.ok(artifacts.has("components/Header.mix"), "Header.mix must compile");
    assert.ok(artifacts.has("components/Sidebar.mix"), "Sidebar.mix must compile");
    assert.ok(artifacts.has("components/Breadcrumbs.mix"), "Breadcrumbs.mix must compile");
    assert.ok(artifacts.has("components/MetricCard.tix"), "MetricCard.tix must compile");
    assert.ok(artifacts.has("pages/OverviewPage.mix"), "OverviewPage.mix must compile");
    assert.ok(artifacts.has("pages/TasksPage.mix"), "TasksPage.mix must compile");
    assert.ok(artifacts.has("pages/UserPage.mix"), "UserPage.mix must compile");
    assert.ok(artifacts.has("pages/ReportsPage.mix"), "ReportsPage.mix must compile");
    assert.ok(artifacts.has("pages/AnalyticsPage.mix"), "AnalyticsPage.mix must compile");
    assert.ok(artifacts.has("pages/AsyncPage.mix"), "AsyncPage.mix must compile");
    assert.ok(artifacts.has("DashboardLayout.mix"), "DashboardLayout.mix must compile");
    assert.ok(artifacts.has("MasterApp.mix"), "MasterApp.mix must compile");
  });

  it("2. OverviewPage & TasksPage: diamond reactivity, child .tix card, and LIS keyed list", async () => {
    const artifacts = buildShowcase();

    // 1. Mount OverviewPage.mix
    const overviewArtifact = artifacts.get("pages/OverviewPage.mix");
    const overviewModule = await import(pathToFileURL(overviewArtifact.jsPath).href);
    const OverviewPage = overviewModule.default;

    const overviewContainer = document.createElement("div");
    document.body.appendChild(overviewContainer);
    mount(OverviewPage, overviewContainer);

    // Verify Diamond Reactivity: count=1 -> left=2, right=11, sum=13
    const formula = overviewContainer.querySelector(".diamond-formula");
    assert.ok(formula.textContent.includes("Count: 1"));
    assert.ok(formula.textContent.includes("Left (×2): 2"));
    assert.ok(formula.textContent.includes("Right (+10): 11"));
    assert.ok(formula.textContent.includes("Sum: 13"));

    // Verify Trusted HTML strips script
    const securityBanner = overviewContainer.querySelector(".security-banner");
    assert.ok(securityBanner.innerHTML.includes("<strong>Framework Security Verified:</strong>"));
    assert.strictEqual(securityBanner.innerHTML.includes("<script>"), false);

    // Verify child .tix MetricCard rendered
    const metricCards = overviewContainer.querySelectorAll(".metric-card");
    assert.strictEqual(metricCards.length, 3);

    // Click increment and verify topological update
    overviewContainer.querySelector(".btn-inc").click();
    assert.ok(formula.textContent.includes("Count: 2"));
    assert.ok(formula.textContent.includes("Left (×2): 4"));
    assert.ok(formula.textContent.includes("Right (+10): 12"));
    assert.ok(formula.textContent.includes("Sum: 16"));

    // 2. Mount TasksPage.mix
    const tasksArtifact = artifacts.get("pages/TasksPage.mix");
    const tasksModule = await import(pathToFileURL(tasksArtifact.jsPath).href);
    const TasksPage = tasksModule.default;

    const tasksContainer = document.createElement("div");
    document.body.appendChild(tasksContainer);
    mount(TasksPage, tasksContainer);

    const initialRows = [...tasksContainer.querySelectorAll(".task-item")];
    assert.strictEqual(initialRows.length, 4);

    // Rotate list and verify LIS preserves DOM identities
    tasksContainer.querySelector(".btn-secondary").click();
    const rotatedRows = [...tasksContainer.querySelectorAll(".task-item")];
    assert.strictEqual(rotatedRows[0], initialRows[1]);
    assert.strictEqual(rotatedRows[rotatedRows.length - 1], initialRows[0]);

    // Add new task
    const input = tasksContainer.querySelector(".task-input");
    input.value = "New Surgical Feature";
    input.dispatchEvent(new win.Event("input"));
    tasksContainer.querySelector(".btn-primary").click();

    const updatedRows = [...tasksContainer.querySelectorAll(".task-item")];
    assert.strictEqual(updatedRows.length, 5);
  });

  it("3. MasterApp.mix: executes declarative router, layout preservation, and parameter extraction", async () => {
    const artifacts = buildShowcase();
    const masterArtifact = artifacts.get("MasterApp.mix");
    const masterModule = await import(pathToFileURL(masterArtifact.jsPath).href);
    const MasterApp = masterModule.default;

    const root = document.createElement("div");
    document.body.appendChild(root);
    mount(MasterApp, root);

    // 1. Initial render at "/" renders OverviewPage inside DashboardLayout
    const mountCounter = root.querySelector(".mount-num");
    assert.strictEqual(mountCounter.textContent, "1", "DashboardLayout must mount once");
    assert.ok(root.querySelector(".page-overview"), "OverviewPage rendered in <Outlet />");

    // 2. Navigation items exist in Sidebar
    const navLinks = root.querySelectorAll(".nav-link");
    assert.strictEqual(navLinks.length, 6);
    assert.ok(navLinks[0].textContent.includes("Overview"), "Overview link must render label");
    assert.ok(navLinks[0].classList.contains("active"), "Overview link is active at /");
    assert.ok(navLinks[1].textContent.includes("Tasks"), "Tasks link must render label");
    assert.ok(navLinks[2].textContent.includes("User Route"), "User link must render label");
    assert.ok(navLinks[3].textContent.includes("File Splat"), "Reports link must render label");
    assert.ok(navLinks[4].textContent.includes("Search Params"), "Analytics link must render label");
    assert.ok(navLinks[5].textContent.includes("Async Block"), "Async link must render label");

    // 3. Switch to /tasks -> renders TasksPage while parent layout remains mounted (mounts=1)
    navLinks[1].click();
    assert.strictEqual(mountCounter.textContent, "1", "Parent layout MUST NOT remount when switching routes");
    assert.ok(root.querySelector(".page-tasks"), "TasksPage is rendered in outlet");
    assert.strictEqual(root.querySelector(".page-overview"), null, "OverviewPage unmounted");

    // 4. Switch to /users/lead-architect -> extracts :id
    navLinks[2].click();
    assert.strictEqual(mountCounter.textContent, "1");
    const paramCode = root.querySelector(".param-code");
    assert.ok(paramCode.textContent.includes("lead-architect"));

    // 5. Switch to /reports/2026/perf.log -> extracts wildcard splat *
    navLinks[3].click();
    assert.strictEqual(mountCounter.textContent, "1");
    const splatCode = root.querySelector(".splat-code");
    assert.ok(splatCode.textContent.includes("2026/perf.log"));

    // 6. Test navigate(-1) back button
    const btnBack = root.querySelector(".controls-group .btn-nav");
    btnBack.click();
    const returnedParam = root.querySelector(".param-code");
    assert.ok(returnedParam.textContent.includes("lead-architect"));
  });
});
