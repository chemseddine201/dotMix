/**
 * Zero-dependency Chrome DevTools Protocol (CDP) client for real-browser testing.
 * Uses Node 22 built-in fetch and WebSocket to control Chrome/Edge/Chromium instances.
 * Implements D-169.
 */

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { findInstalledBrowser } from "./detector.js";

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: {
    result?: {
      value?: unknown;
      description?: string;
    };
    exceptionDetails?: {
      exception?: { description?: string };
      text?: string;
    };
  };
  error?: {
    code: number;
    message: string;
  };
}

interface TargetInfo {
  id: string;
  webSocketDebuggerUrl: string;
  title: string;
  url: string;
}

export interface LaunchOptions {
  executablePath?: string;
  userDataDir?: string;
  args?: string[];
}

export interface ConsoleEntry {
  type: string;
  text: string;
}

export class CdpPage {
  readonly browser: CdpBrowser;
  readonly pageInfo: TargetInfo;
  readonly targetId: string;
  private readonly ws: WebSocket;
  private msgId = 1;
  private readonly callbacks = new Map<number, (msg: CdpMessage) => void>();
  private readonly loadCallbacks = new Set<() => void>();
  readonly consoleErrors: string[] = [];
  readonly consoleMessages: ConsoleEntry[] = [];

  constructor(browser: CdpBrowser, pageInfo: TargetInfo, ws: WebSocket) {
    this.browser = browser;
    this.pageInfo = pageInfo;
    this.targetId = pageInfo.id;
    this.ws = ws;

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const raw = typeof event.data === "string" ? event.data : String(event.data);
        const msg = JSON.parse(raw) as CdpMessage;

        if (msg.id && this.callbacks.has(msg.id)) {
          const cb = this.callbacks.get(msg.id)!;
          this.callbacks.delete(msg.id);
          cb(msg);
        }

        if (msg.method === "Page.loadEventFired") {
          for (const cb of this.loadCallbacks) {
            cb();
          }
          this.loadCallbacks.clear();
        }

        if (msg.method === "Runtime.exceptionThrown") {
          const details = (msg.params as { exceptionDetails?: { exception?: { description?: string }; text?: string } })?.exceptionDetails;
          const desc = details?.exception?.description || details?.text || "Unknown runtime exception";
          this.consoleErrors.push(desc);
        }

        if (msg.method === "Runtime.consoleAPICalled") {
          const params = msg.params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
          const type = params?.type ?? "log";
          const text = (params?.args || [])
            .map((arg) => (arg.value !== undefined ? String(arg.value) : arg.description || ""))
            .join(" ");
          this.consoleMessages.push({ type, text });
          if (type === "error") {
            this.consoleErrors.push(text);
          }
        }
      } catch {
        // Ignore unparseable frames
      }
    };
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== 1 /* WebSocket.OPEN */) {
        return reject(new Error("CDP WebSocket is not open"));
      }
      const id = this.msgId++;
      this.callbacks.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async goto(url: string, { waitUntil = "load", timeout = 10000 }: { waitUntil?: "load"; timeout?: number } = {}): Promise<void> {
    const loadPromise = new Promise<void>((resolve) => {
      this.loadCallbacks.add(resolve);
    });
    const timer = setTimeout(() => {
      this.loadCallbacks.delete(loadPromise as unknown as () => void);
    }, timeout);

    await this.send("Page.navigate", { url });
    if (waitUntil === "load") {
      await Promise.race([
        loadPromise,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout waiting for page load: ${url}`)), timeout)
        ),
      ]);
    }
    clearTimeout(timer);
  }

  async evaluate<T>(exprOrFn: string | ((...args: unknown[]) => T), ...args: unknown[]): Promise<T> {
    let expression: string;
    if (typeof exprOrFn === "function") {
      const serializedArgs = args.map((a) => JSON.stringify(a)).join(", ");
      expression = `(${exprOrFn.toString()})(${serializedArgs})`;
    } else {
      expression = String(exprOrFn);
    }

    const res = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });

    if (res.error) {
      throw new Error(`CDP Runtime.evaluate protocol error: ${res.error.message}`);
    }
    if (res.result?.exceptionDetails) {
      const details = res.result.exceptionDetails;
      const msg = details.exception?.description || details.text || "Evaluation error";
      throw new Error(`CDP evaluate exception: ${msg}`);
    }
    return res.result?.result?.value as T;
  }

  async waitForCondition<T>(
    fn: (...args: unknown[]) => T,
    { timeout = 10000, interval = 50 }: { timeout?: number; interval?: number } = {},
    ...args: unknown[]
  ): Promise<T> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        const val = await this.evaluate(fn, ...args);
        if (val) return val;
      } catch {
        // Condition may fail while DOM is mounting; retry
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    throw new Error(`Timeout after ${timeout}ms waiting for condition: ${fn.toString()}`);
  }

  async waitForSelector(selector: string, { timeout = 10000 }: { timeout?: number } = {}): Promise<boolean> {
    return this.waitForCondition(
      (sel) => {
        const el = (globalThis as unknown as { document?: { querySelector: (s: string) => unknown } }).document?.querySelector(sel as string);
        return el !== null && el !== undefined;
      },
      { timeout },
      selector
    );
  }

  async getText(selector: string): Promise<string | null> {
    return this.evaluate((sel) => {
      const el = (globalThis as unknown as { document?: { querySelector: (s: string) => { textContent: string | null } } }).document?.querySelector(sel as string);
      return el ? el.textContent : null;
    }, selector);
  }

  async click(selector: string): Promise<void> {
    return this.evaluate((sel) => {
      const el = (globalThis as unknown as { document?: { querySelector: (s: string) => { click: () => void } } }).document?.querySelector(sel as string);
      if (!el) throw new Error("Element not found for click: " + String(sel));
      el.click();
    }, selector);
  }

  getConsoleErrors(): string[] {
    return [...this.consoleErrors];
  }

  clearConsoleErrors(): void {
    this.consoleErrors.length = 0;
  }

  async close(): Promise<void> {
    try {
      this.ws.close();
      await fetch(`http://127.0.0.1:${this.browser.port}/json/close/${this.targetId}`);
    } catch {
      // Ignore cleanup error
    }
  }
}

export class CdpBrowser {
  readonly proc: ChildProcess;
  readonly port: number;
  readonly userDataDir: string;
  readonly pages = new Set<CdpPage>();

  constructor(proc: ChildProcess, port: number, userDataDir: string) {
    this.proc = proc;
    this.port = port;
    this.userDataDir = userDataDir;
  }

  async newPage(): Promise<CdpPage> {
    const newRes = await fetch(`http://127.0.0.1:${this.port}/json/new`, { method: "PUT" });
    const pageInfo = (await newRes.json()) as TargetInfo;
    const ws = new WebSocket(pageInfo.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (err) => reject(err);
    });

    const page = new CdpPage(this, pageInfo, ws);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    this.pages.add(page);
    return page;
  }

  async close(): Promise<void> {
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
      // Ignore cleanup errors
    }
  }
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<CdpBrowser> {
  const chromePath = options.executablePath || findInstalledBrowser();
  if (!chromePath || !fs.existsSync(chromePath)) {
    throw new Error(
      "No compatible Chromium browser found (checked standard paths and MIX_BROWSER_PATH). Skipping browser DOM tests."
    );
  }

  const userDataDir = options.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), "cdp-browser-"));

  const args = [
    "--remote-debugging-port=0",
    "--headless",
    "--no-sandbox",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    `--user-data-dir=${userDataDir}`,
    ...(options.args || []),
  ];

  const proc = spawn(chromePath, args);

  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error("Timeout waiting for Chrome CDP port"));
    }, 15000);

    let output = "";
    const onData = (data: Buffer) => {
      output += data.toString();
      const match = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        proc.stderr?.off("data", onData);
        resolve(parseInt(match[1]!, 10));
      }
    };

    proc.stderr?.on("data", onData);
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
