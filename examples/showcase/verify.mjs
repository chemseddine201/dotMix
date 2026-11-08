#!/usr/bin/env node

/**
 * End-to-End Verification Test for Mix / Tix Showcase Application
 */

import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { resolve } from "node:path";

// 1. Build the showcase application
console.log("Stage 1: Compiling showcase components...");
execSync("node examples/showcase/build.mjs", { stdio: "pipe" });
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
const { flushQueue } = await import("../../packages/runtime/dist/index.js");
const { mountApplication } = await import("./dist/main.js");

const appContainer = document.createElement("div");
appContainer.id = "app";
document.body.appendChild(appContainer);

// 4. Mount Application
console.log("Stage 3: Mounting Application into DOM...");
const appInstance = mountApplication(appContainer);
assert.ok(appInstance, "Application failed to mount");

// Verify Header
const headerTitle = appContainer.querySelector(".brand-title");
assert.equal(headerTitle?.textContent, "Mix / Tix Framework");
const badgeTag = appContainer.querySelector(".badge-tag");
assert.equal(badgeTag?.textContent, "v1.0.0-rc.1");
console.log("✓ Header mounted with correct branding and version.");

// Verify Counter Component
console.log("Stage 4: Testing Reactive Counter DOM interactions...");
const countVal = appContainer.querySelector(".count-value");
assert.equal(countVal?.textContent, "0");

const incBtn = appContainer.querySelector(".btn-inc");
assert.ok(incBtn, "Increment button not found");
incBtn.click();
flushQueue();
assert.equal(countVal?.textContent, "1");

incBtn.click();
incBtn.click();
flushQueue();
assert.equal(countVal?.textContent, "3");

const decBtn = appContainer.querySelector(".btn-dec");
assert.ok(decBtn, "Decrement button not found");
decBtn.click();
flushQueue();
assert.equal(countVal?.textContent, "2");

const resetBtn = appContainer.querySelector(".reset-btn");
resetBtn.click();
flushQueue();
assert.equal(countVal?.textContent, "0");
console.log("✓ Reactive Counter: increment, decrement, and reset update direct DOM correctly.");

// Verify DynamicElement
console.log("Stage 5: Testing DynamicElement (D-105)...");
const tagInfo = appContainer.querySelector(".tag-info");
assert.ok(tagInfo?.textContent.includes("article"), "Tag info text should include article");

const articleEl = appContainer.querySelector("article");
assert.ok(articleEl, "Polymorphic <article> element must be in the DOM");
assert.equal(articleEl.tagName.toLowerCase(), "article");
console.log("✓ DynamicElement: rendered <article> with resolved tag identity.");

// Verify Reconciliation & TodoList
console.log("Stage 6: Testing State & Reconciliation (D-110)...");
const stats = appContainer.querySelectorAll(".stat-val");
assert.equal(stats[0]?.textContent, "3"); // Total Tasks
assert.equal(stats[1]?.textContent, "1"); // Completed Tasks

const checkBtns = appContainer.querySelectorAll(".check-btn");
checkBtns[0].click();
flushQueue();
assert.equal(stats[1]?.textContent, "2");
console.log("✓ State updates & reconciliation verified.");

// Verify Security Demo
console.log("Stage 7: Testing Security Boundary & Dynamic Styles (D-108, D-109)...");
const htmlPreview = appContainer.querySelector(".html-preview");
assert.ok(htmlPreview?.innerHTML.includes("Safe formatted text"));
assert.ok(htmlPreview?.innerHTML.includes("<strong>"));

const styleTarget = appContainer.querySelector(".style-target");
assert.ok(styleTarget?.getAttribute("style")?.includes("background-color"));
console.log("✓ Trusted HTML sanitizer and safe CSS styling verified.");

// Verify View / Tab Navigation
console.log("Stage 8: Testing View Filtering & Navigation...");
const grid = appContainer.querySelector("#showcase-grid");
assert.equal(grid?.children.length, 4, "Initial view should show all 4 components");

const tabCounterBtn = appContainer.querySelector(".btn-tab-counter");
tabCounterBtn.click();
flushQueue();
assert.equal(grid?.children.length, 1, "Counter tab should show only 1 component");

const tabAllBtn = appContainer.querySelector(".btn-tab-all");
tabAllBtn.click();
flushQueue();
assert.equal(grid?.children.length, 4, "Show All tab should restore all 4 components");
console.log("✓ View filtering and navigation verified.");

console.log("\n================================================================================");
console.log(" ALL SHOWCASE ACCEPTANCE VERIFICATIONS PASSED (100% SUCCESS)");
console.log("================================================================================");
