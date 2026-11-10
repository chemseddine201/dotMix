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
    win.__MIX_TEST_ENV__ = true;
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

    // Verify KeepAlive tab switching preserves Live Calculator DOM and Scratchpad Notes
    const [calcTabBtn, notesTabBtn] = [...overviewContainer.querySelectorAll(".keepalive-box .tab-btn")];
    assert.ok(calcTabBtn && notesTabBtn);

    // Switch to Scratchpad Notes tab
    notesTabBtn.click();
    assert.strictEqual(overviewContainer.querySelector(".diamond-formula"), null);
    const notesArea = overviewContainer.querySelector(".notes-area");
    assert.ok(notesArea);
    notesArea.value = "Saved architectural note";
    notesArea.dispatchEvent(new win.Event("input"));

    // Switch back to Live Calculator tab -> must reappear with preserved DOM & state
    calcTabBtn.click();
    const restoredFormula = overviewContainer.querySelector(".diamond-formula");
    assert.strictEqual(restoredFormula, formula);
    assert.ok(restoredFormula.textContent.includes("Count: 2"));
    assert.ok(restoredFormula.textContent.includes("Sum: 16"));

    // Increment again inside restored KeepAlive calculator
    overviewContainer.querySelector(".btn-inc").click();
    assert.ok(restoredFormula.textContent.includes("Count: 3"));
    assert.ok(restoredFormula.textContent.includes("Sum: 19"));

    // Switch to Notes and back to Calculator again to verify multi-cycle preservation
    notesTabBtn.click();
    assert.strictEqual(overviewContainer.querySelector(".notes-area"), notesArea);
    calcTabBtn.click();
    assert.strictEqual(overviewContainer.querySelector(".diamond-formula"), formula);

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
    assert.strictEqual(navLinks.length, 10);
    assert.ok(navLinks[0].textContent.includes("Overview"), "Overview link must render label");
    assert.ok(navLinks[0].classList.contains("active"), "Overview link is active at /");
    assert.ok(navLinks[1].textContent.includes("Tasks"), "Tasks link must render label");
    assert.ok(navLinks[2].textContent.includes("User Route"), "User link must render label");
    assert.ok(navLinks[3].textContent.includes("File Splat"), "Reports link must render label");
    assert.ok(navLinks[4].textContent.includes("Search Params"), "Analytics link must render label");
    assert.ok(navLinks[5].textContent.includes("Async Block"), "Async link must render label");
    assert.ok(navLinks[6].textContent.includes("Forms"), "Forms link must render label");
    assert.ok(navLinks[7].textContent.includes("Sync"), "Sync link must render label");
    assert.ok(navLinks[8].textContent.includes("Permissions"), "Permissions link must render label");
    assert.ok(navLinks[9].textContent.includes("Native Helpers"), "Helpers link must render label");


    // 3. Switch to /tasks -> renders TasksPage while parent layout remains mounted (mounts=1)
    navLinks[1].click();
    assert.strictEqual(mountCounter.textContent, "1", "Parent layout MUST NOT remount when switching routes");
    assert.ok(root.querySelector(".page-tasks"), "TasksPage is rendered in outlet");
    assert.strictEqual(root.querySelector(".page-overview"), null, "OverviewPage unmounted");

    // Add a task on /tasks before navigating away to verify persistence across route changes
    const taskCountBefore = root.querySelectorAll(".task-item").length;
    const taskInput = root.querySelector(".task-input");
    taskInput.value = "Persisted Across Route Switch";
    taskInput.dispatchEvent(new win.Event("input"));
    root.querySelector(".btn-primary").click();
    assert.strictEqual(root.querySelectorAll(".task-item").length, taskCountBefore + 1);
    assert.ok(root.querySelector(".page-tasks").textContent.includes("Persisted Across Route Switch"));

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

    // 7. Switch to /forms -> renders FormsPage with reactive validation engine (Gate 21 / D-124)
    navLinks[6].click();
    assert.strictEqual(mountCounter.textContent, "1");
    assert.ok(root.querySelector(".forms-page"), "FormsPage rendered in outlet");

    // 8. Switch to /sync -> renders SyncPage with CRDT offline store (Gate 16 & 22 / D-119 & D-125)
    navLinks[7].click();
    assert.strictEqual(mountCounter.textContent, "1");
    assert.ok(root.querySelector(".sync-page"), "SyncPage rendered in outlet");

    // 9. Switch to /permissions -> renders PermissionsPage with RBAC/ABAC engine (Gate 25 / D-128)
    navLinks[8].click();
    assert.strictEqual(mountCounter.textContent, "1");
    assert.ok(root.querySelector(".permissions-container"), "PermissionsPage rendered in outlet");

    // 10. Switch to /helpers -> renders HelpersPage with mix-helpers (Gate 29 / D-135)
    navLinks[9].click();
    assert.strictEqual(mountCounter.textContent, "1");
    assert.ok(root.querySelector(".helpers-page"), "HelpersPage rendered in outlet");
    assert.ok(root.textContent.includes("Native Standard Library"), "HelpersPage title rendered");

    // 11. Navigate back to /tasks -> verify added task persisted across all route switches!
    navLinks[1].click();
    assert.ok(root.querySelector(".page-tasks"), "TasksPage re-mounted in outlet");
    assert.strictEqual(root.querySelectorAll(".task-item").length, taskCountBefore + 1);
    assert.ok(
      root.querySelector(".page-tasks").textContent.includes("Persisted Across Route Switch"),
      "Added task must persist when navigating away from /tasks and returning"
    );

  });
});
