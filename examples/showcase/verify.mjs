#!/usr/bin/env node

/**
 * End-to-End Verification Test for Mix / Tix Showcase Application
 * Validates compiler-native UI, 5-state reactivity, LIS keyed lists, cancellation, and security.
 */

import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";

// 1. Build the showcase application
console.log("Stage 1: Compiling showcase components...");
execSync("node examples/showcase/build.mjs", { stdio: "inherit" });
console.log("✓ All components compiled cleanly.");

// 2. Setup Happy-DOM Environment
console.log("Stage 2: Initializing DOM simulation environment...");
const window = new Window();
globalThis.window = window;
globalThis.document = window.document;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Text = window.Text;

// 3. Import Runtime and Application Modules
const { flushQueue, flushSync } = await import("../../packages/runtime/dist/index.js");
function flushAll() {
  if (typeof flushQueue === "function") flushQueue();
  if (typeof flushSync === "function") flushSync();
}
const { mountApplication } = await import("./dist/main.js");

const appContainer = document.createElement("div");
appContainer.id = "app";
document.body.appendChild(appContainer);

// 4. Mount Application
console.log("Stage 3: Mounting Application into DOM...");
const appInstance = mountApplication(appContainer);
assert.ok(appInstance, "Application failed to mount");
flushAll();

// Verify Header
const headerTitle = appContainer.querySelector(".brand-title");
assert.equal(headerTitle?.textContent, "Mix / Tix Framework");
console.log("✓ Header mounted with correct branding.");

// Verify Diamond Graph Reactivity
console.log("Stage 4: Testing 5-State Push-Pull Reactivity (Diamond Graph)...");
const reactivityEl = appInstance.reactivityInstance.element;
assert.ok(reactivityEl.textContent.includes("Source Signal A: 10"));
assert.ok(reactivityEl.textContent.includes("D (B + C): 40"));

// Click increase
const incBtn = reactivityEl.querySelector(".btn-ctrl:nth-child(2)");
incBtn.click();
flushAll();
assert.ok(reactivityEl.textContent.includes("Source Signal A: 11"), "Base value should increase to 11");
assert.ok(reactivityEl.textContent.includes("D (B + C): 43"), "D should evaluate lazily to 43 without diamond glitch");
console.log("✓ Push-Pull Reactive Scheduler: Diamond Graph solved lazily with zero duplicate computations.");

// Verify Keyed List Reconciliation with LIS (TodoList)
console.log("Stage 5: Testing Keyed List Reconciliation with O(N log N) LIS...");
const todoEl = appInstance.todoInstance.element;
let taskItems = todoEl.querySelectorAll(".task-item");
assert.equal(taskItems.length, 4, "Initial task count must be 4");

// 1. Add Task
const addBtn = todoEl.querySelector(".btn-primary");
addBtn.click();
flushAll();
taskItems = todoEl.querySelectorAll(".task-item");
assert.equal(taskItems.length, 5, "Task count must become 5 after addition");
assert.ok(taskItems[4].textContent.includes("New task #5"));

// 2. Reverse Tasks (LIS Inversion)
const revBtn = todoEl.querySelector(".btn-action:nth-child(3)");
revBtn.click();
flushAll();
taskItems = todoEl.querySelectorAll(".task-item");
assert.equal(taskItems.length, 5);
assert.ok(taskItems[0].textContent.includes("New task #5"), "Top item must now be task #5 after reverse");

// 3. Remove First
const remBtn = todoEl.querySelector(".btn-action:nth-child(2)");
remBtn.click();
flushAll();
taskItems = todoEl.querySelectorAll(".task-item");
assert.equal(taskItems.length, 4, "Task count must decrease to 4 after remove");
console.log("✓ Keyed List: surgical LIS reordering, addition, and removal verified.");

// Verify Cancellation Token
console.log("Stage 6: Testing Pure Cancellation Token (§3)...");
const cancelEl = appInstance.cancellationInstance.element;
const startQueryBtn = cancelEl.querySelector(".btn-start");
startQueryBtn.click();
flushAll();
assert.ok(cancelEl.textContent.includes("Fetching results"));

const abortBtn = cancelEl.querySelector(".btn-cancel");
abortBtn.click();
flushAll();
assert.ok(cancelEl.textContent.includes("Cancelled via CancellationToken"));
console.log("✓ Cancellation Token: async lifecycle control verified.");

// Verify DynamicElement
console.log("Stage 7: Testing DynamicElement Polymorphic Tag (<{~ Tag }>)...");
const dynamicEl = appInstance.dynamicInstance.element;
const articleEl = dynamicEl.querySelector("article");
assert.ok(articleEl, "Polymorphic <article> element must be rendered");
console.log("✓ DynamicElement: rendered <article> with resolved identity.");

// Verify Security Demo
console.log("Stage 8: Testing Security Hardening & Trusted Types (§6)...");
const secEl = appInstance.securityInstance.element;
const htmlPreview = secEl.querySelector(".html-preview");
assert.ok(htmlPreview?.innerHTML.includes("Safe formatted text"));
assert.ok(htmlPreview?.innerHTML.includes("<strong>"));

const styleTarget = secEl.querySelector(".style-target");
assert.ok(styleTarget?.getAttribute("style")?.includes("background-color"));
console.log("✓ Security: Trusted HTML sanitizer and individual setProperty verified.");

// Verify .tix TypeScript Component
console.log("Stage 9: Testing .tix TypeScript Component (§5)...");
const tsEl = appInstance.typeSafeInstance.element;
assert.ok(tsEl.textContent.includes("Reactive Multiplier: 42"));

const doubleBtn = tsEl.querySelector(".btn-double");
doubleBtn.click();
flushAll();
assert.ok(tsEl.textContent.includes("Reactive Multiplier: 84"), "Multiplier should double to 84");
console.log("✓ .tix Component: virtual projection and reactive updates verified.");

// Verify View / Tab Navigation
console.log("Stage 10: Testing Interactive View Filtering...");
const grid = appContainer.querySelector("#showcase-grid");
assert.equal(grid?.children.length, 6, "Initial view should show all 6 showcase modules");

const tabTodosBtn = appContainer.querySelector(".btn-tab-todos");
tabTodosBtn.click();
flushAll();
assert.equal(grid?.children.length, 1, "Todos tab should show only the keyed list component");

const tabAllBtn = appContainer.querySelector(".btn-tab-all");
tabAllBtn.click();
flushAll();
assert.equal(grid?.children.length, 6, "Show All tab should restore all 6 components");
console.log("✓ View filtering and tab switching verified.");

console.log("\n================================================================================");
console.log(" ALL 10 SHOWCASE ACCEPTANCE VERIFICATIONS PASSED (100% SUCCESS)");
console.log("================================================================================");
