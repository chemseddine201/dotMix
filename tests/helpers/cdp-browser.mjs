/* global WebSocket, setTimeout, clearTimeout, document, fetch */
/**
 * Zero-dependency Chrome DevTools Protocol (CDP) client for real-browser testing.
 * Uses Node 22 built-in fetch and WebSocket to control an installed Chromium-based browser.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { findInstalledBrowser } from "../../node_modules/@dotmix/cli/dist/browser/detector.js";

/** The browser found the same way `mix test --browser` finds it (MIX_BROWSER_PATH, then the platform's usual install paths). */
export const installedBrowserPath = findInstalledBrowser();

/** `skip` option for suites that need a real browser: a reason when none is installed, otherwise false. */
export const browserSkipReason = installedBrowserPath === null
  ? "no Chromium-based browser installed (set MIX_BROWSER_PATH to run this suite)"
  : false;

export class CdpPage {
  constructor(browser, pageInfo, ws) {
    this.browser = browser;
    this.pageInfo = pageInfo;
    this.targetId = pageInfo.id;
    this.ws = ws;
    this._msgId = 1;
    this._callbacks = new Map();
    this._loadCallbacks = new Set();
    this.consoleErrors = [];
    this.consoleMessages = [];

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.id && this._callbacks.has(msg.id)) {
          const cb = this._callbacks.get(msg.id);
          this._callbacks.delete(msg.id);
          cb(msg);
        }
        if (msg.method === "Page.loadEventFired") {
          for (const cb of this._loadCallbacks) {
            cb();
          }
          this._loadCallbacks.clear();
        }
        if (msg.method === "Runtime.exceptionThrown") {
          const desc =
            msg.params?.exceptionDetails?.exception?.description ||
            msg.params?.exceptionDetails?.text ||
            "Unknown runtime exception";
          this.consoleErrors.push(desc);
        }
        if (msg.method === "Runtime.consoleAPICalled") {
          const type = msg.params?.type;
          const text = (msg.params?.args || [])
            .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || ""))
            .join(" ");
          this.consoleMessages.push({ type, text });
          if (type === "error") {
            this.consoleErrors.push(text);
          }
        }
      } catch {
        // ignore malformed messages
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) {
        return reject(new Error("WebSocket is not open"));
      }
      const id = this._msgId++;
      this._callbacks.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async goto(url, { waitUntil = "load", timeout = 10000 } = {}) {
    const loadPromise = new Promise((resolve) => {
      this._loadCallbacks.add(resolve);
    });
    const timer = setTimeout(() => {
      this._loadCallbacks.delete(loadPromise);
    }, timeout);

    await this.send("Page.navigate", { url });
    if (waitUntil === "load") {
      await Promise.race([
        loadPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout waiting for page load: ${url}`)), timeout)
        )
      ]);
    }
    clearTimeout(timer);
  }

  async evaluate(exprOrFn, ...args) {
    let expression;
    if (typeof exprOrFn === "function") {
      const serializedArgs = args.map((a) => JSON.stringify(a)).join(", ");
      expression = `(${exprOrFn.toString()})(${serializedArgs})`;
    } else {
      expression = String(exprOrFn);
    }

    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    if (res.error) {
      throw new Error(`CDP Runtime.evaluate protocol error: ${res.error.message}`);
    }
    if (res.result?.exceptionDetails) {
      const details = res.result.exceptionDetails;
      const msg = details.exception?.description || details.text || "Evaluation error";
      throw new Error(`CDP evaluate exception: ${msg}`);
    }
    return res.result?.result?.value;
  }

  async waitForCondition(fn, { timeout = 10000, interval = 50 } = {}, ...args) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const val = await this.evaluate(fn, ...args);
        if (val) return val;
      } catch {
        // Condition might throw if elements are mid-transition; retry
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Timeout after ${timeout}ms waiting for condition: ${fn.toString()}`);
  }

  async waitForSelector(selector, { timeout = 10000 } = {}) {
    return this.waitForCondition(
      (sel) => {
        const el = document.querySelector(sel);
        return el !== null;
      },
      { timeout },
      selector
    );
  }

  async getText(selector) {
    return this.evaluate((sel) => {
      const el = document.querySelector(sel);
      return el ? el.textContent : null;
    }, selector);
  }

  async click(selector) {
    return this.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error("Element not found for click: " + sel);
      el.click();
    }, selector);
  }

  getConsoleErrors() {
    return [...this.consoleErrors];
  }

  clearConsoleErrors() {
    this.consoleErrors.length = 0;
  }

  async close() {
    try {
      this.ws.close();
      await fetch(`http://127.0.0.1:${this.browser.port}/json/close/${this.targetId}`);
    } catch {
      // ignore
    }
  }
}

export class CdpBrowser {
  constructor(proc, port, userDataDir) {
    this.proc = proc;
    this.port = port;
    this.userDataDir = userDataDir;
    this.pages = new Set();
  }

  async newPage() {
    const newRes = await fetch(`http://127.0.0.1:${this.port}/json/new`, { method: "PUT" });
    const pageInfo = await newRes.json();
    const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });

    const page = new CdpPage(this, pageInfo, ws);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    this.pages.add(page);
    return page;
  }

  async close() {
    for (const page of this.pages) {
      await page.close();
    }
    this.pages.clear();
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
    await new Promise((r) => setTimeout(r, 150));
    try {
      if (this.userDataDir && fs.existsSync(this.userDataDir)) {
        fs.rmSync(this.userDataDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

export async function launchBrowser(options = {}) {
  const chromePath = options.executablePath || installedBrowserPath;
  if (!chromePath || !fs.existsSync(chromePath)) {
    throw new Error("No Chromium-based browser found. Install Chrome, Edge or Chromium, or set MIX_BROWSER_PATH.");
  }
  const userDataDir =
    options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), "cdp-browser-"));

  const args = [
    "--remote-debugging-port=0",
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    `--user-data-dir=${userDataDir}`,
    ...(options.args || [])
  ];

  const proc = spawn(chromePath, args);

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Timeout waiting for Chrome CDP port"));
    }, 15000);

    let output = "";
    const onData = (data) => {
      output += data.toString();
      const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        proc.stderr.off("data", onData);
        resolve(parseInt(match[1], 10));
      }
    };

    proc.stderr.on("data", onData);
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early with code ${code}`));
    });
  });

  return new CdpBrowser(proc, port, userDataDir);
}
