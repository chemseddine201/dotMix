/**
 * Zero-dependency browser executable discovery across standard OS locations.
 * Follows D-169: checks MIX_BROWSER_PATH, then platform defaults. Never downloads binaries.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

export function findInstalledBrowser(): string | null {
  // 1. Explicit environment override
  if (process.env.MIX_BROWSER_PATH === "none" || process.env.MIX_BROWSER_PATH === "skip") {
    return null;
  }
  if (process.env.MIX_BROWSER_PATH && fs.existsSync(process.env.MIX_BROWSER_PATH)) {
    return process.env.MIX_BROWSER_PATH;
  }

  const platform = process.platform;

  if (platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? "";
    const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

    const candidates = [
      // Standard Google Chrome
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      localAppData ? path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe") : "",

      // Standard Microsoft Edge
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
      localAppData ? path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe") : "",

      // Chrome Headless Shell installed locally
      localAppData
        ? path.join(
            localAppData,
            "ms-playwright",
            "chromium_headless_shell-1248",
            "chrome-headless-shell-win64",
            "chrome-headless-shell.exe"
          )
        : "",
    ];

    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } else if (platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  } else if (platform === "linux") {
    const candidates = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
      "/snap/bin/chromium",
    ];

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}
