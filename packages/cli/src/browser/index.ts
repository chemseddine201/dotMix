/**
 * @dotmix/cli browser testing module (D-169)
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
