/**
 * @dotmix/cli browser testing module
 * Zero-dependency CDP browser detection and control.
 */

export { findInstalledBrowser } from "./detector.js";
export {
  CdpPage,
  CdpBrowser,
  launchBrowser,
  type LaunchOptions,
  type ConsoleEntry,
} from "./cdp.js";
