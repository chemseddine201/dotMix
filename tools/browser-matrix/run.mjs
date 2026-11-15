/* global process, console, setTimeout, clearTimeout, performance */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { startMatrixServer } from './server.mjs';

const BROWSER_DEFINITIONS = [
  {
    name: 'chrome',
    resolveExecutable: () => {
      const candidates = [
        process.env.MIX_CHROME_PATH,
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      ].filter(Boolean);
      return candidates.find((executablePath) => fs.existsSync(executablePath));
    },
    buildArguments: (profileDirectory, targetUrl) => [
      '--headless=new',
      `--user-data-dir=${profileDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      targetUrl
    ],
    prepareProfile: () => {}
  },
  {
    name: 'edge',
    resolveExecutable: () => {
      const candidates = [
        process.env.MIX_EDGE_PATH,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ].filter(Boolean);
      return candidates.find((executablePath) => fs.existsSync(executablePath));
    },
    buildArguments: (profileDirectory, targetUrl) => [
      '--headless=new',
      `--user-data-dir=${profileDirectory}`,
      '--no-first-run',
      '--no-default-browser-check',
      targetUrl
    ],
    prepareProfile: () => {}
  },
  {
    name: 'firefox',
    resolveExecutable: () => {
      const candidates = [
        process.env.MIX_FIREFOX_PATH,
        'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
        'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
      ].filter(Boolean);
      return candidates.find((executablePath) => fs.existsSync(executablePath));
    },
    buildArguments: (profileDirectory, targetUrl) => [
      '-headless',
      '-no-remote',
      '-profile',
      profileDirectory,
      targetUrl
    ],
    prepareProfile: (profileDirectory) => {
      const userPreferences = [
        'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("browser.startup.homepage_override.mstone", "ignore");',
        'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
        'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
        'user_pref("browser.tabs.warnOnClose", false);',
        'user_pref("dom.indexedDB.enabled", true);',
        'user_pref("dom.indexedDB.privateBrowsing.enabled", true);'
      ].join('\n');
      fs.writeFileSync(path.join(profileDirectory, 'user.js'), userPreferences, 'utf8');
    }
  }
];

function terminateProcessSafely(processIdentifier) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /T /PID ${processIdentifier}`, { stdio: 'ignore' });
    } else {
      process.kill(processIdentifier, 'SIGKILL');
    }
  } catch {
    // Process already terminated
  }
}

/**
 * Browser launchers (msedge.exe in particular) hand off to a child process and exit at once,
 * so killing the launcher PID is not enough. Kill every process started with this profile.
 */
function terminateProfileProcesses(profileDirectoryPath) {
  if (process.platform !== 'win32') return;
  const profileFilter = profileDirectoryPath.replace(/'/g, "''");
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profileFilter}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    );
  } catch {
    // Nothing left to stop
  }
}

function removeDirectoryWithRetries(directoryPath, maximumAttempts = 5) {
  for (let attemptCounter = 0; attemptCounter < maximumAttempts; attemptCounter += 1) {
    try {
      if (fs.existsSync(directoryPath)) {
        fs.rmSync(directoryPath, { recursive: true, force: true });
      }
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
}

async function runBrowserMatrix() {
  const overallStartTime = performance.now();
  const workspaceDirectory = process.cwd();
  const scenarioDirectoryPath = path.join(workspaceDirectory, 'tools', 'browser-matrix', 'scenarios');
  const evidenceDirectoryPath = path.join(workspaceDirectory, 'reports', 'gate-35-evidence');

  if (!fs.existsSync(evidenceDirectoryPath)) {
    fs.mkdirSync(evidenceDirectoryPath, { recursive: true });
  }

  const expectedScenarioCount = fs
    .readdirSync(scenarioDirectoryPath)
    .filter((fileName) => fileName.endsWith('.js')).length;
  const serverControl = await startMatrixServer(workspaceDirectory, scenarioDirectoryPath);
  console.log(`Matrix server listening at ${serverControl.serverBaseUrl}`);

  let overallFailureEncountered = false;

  try {
    for (const browserConfig of BROWSER_DEFINITIONS) {
      const browserExecutable = browserConfig.resolveExecutable();
      if (!browserExecutable) {
        console.error(`Missing executable for browser: ${browserConfig.name}`);
        overallFailureEncountered = true;
        continue;
      }

      console.log(`\nLaunching browser: ${browserConfig.name} (${browserExecutable})`);
      const runToken = `${browserConfig.name}-${Date.now()}`;
      serverControl.resetResults(runToken);

      const profileDirectoryPath = path.join(
        os.tmpdir(),
        `mix-browser-profile-${browserConfig.name}-${Date.now()}`
      );
      fs.mkdirSync(profileDirectoryPath, { recursive: true });
      browserConfig.prepareProfile(profileDirectoryPath);

      const browserArguments = browserConfig.buildArguments(
        profileDirectoryPath,
        `${serverControl.serverBaseUrl}/?run=${encodeURIComponent(runToken)}`
      );

      const browserProcess = spawn(browserExecutable, browserArguments, {
        stdio: 'ignore',
        detached: false
      });

      const browserHardTimeoutMilliseconds = 300000; // 5 minutes hard kill
      let hardTimeoutFired = false;
      const hardTimeoutTimer = setTimeout(() => {
        hardTimeoutFired = true;
        console.error(`Browser ${browserConfig.name} exceeded 5-minute hard timeout. Killing.`);
        terminateProcessSafely(browserProcess.pid);
      }, browserHardTimeoutMilliseconds);

      try {
        await Promise.race([
          serverControl.waitForCompletion(),
          // A launcher that exits with code 0 has handed off to its child; keep waiting.
          new Promise((resolveExited) => {
            browserProcess.on('exit', (exitCode) => {
              if (exitCode !== 0 && exitCode !== null) resolveExited();
            });
          })
        ]);
      } finally {
        clearTimeout(hardTimeoutTimer);
        terminateProcessSafely(browserProcess.pid);
        terminateProfileProcesses(profileDirectoryPath);
        removeDirectoryWithRetries(profileDirectoryPath);
      }

      const collectedResults = serverControl.getResults();
      if (collectedResults.length === 0 && hardTimeoutFired) {
        collectedResults.push({
          name: 'timeout',
          pass: false,
          detail: 'Hard timeout exceeded before completion',
          durationMs: browserHardTimeoutMilliseconds
        });
      }

      const evidenceFilePath = path.join(
        evidenceDirectoryPath,
        `browser-${browserConfig.name}.json`
      );
      fs.writeFileSync(
        evidenceFilePath,
        JSON.stringify(collectedResults, null, 2),
        'utf8'
      );

      if (collectedResults.length !== expectedScenarioCount) {
        overallFailureEncountered = true;
        console.error(`${browserConfig.name}: ${collectedResults.length} of ${expectedScenarioCount} scenarios reported`);
      }
      console.log(`Results for ${browserConfig.name}:`);
      for (const scenarioResult of collectedResults) {
        const statusIndicator = scenarioResult.pass ? 'PASS' : 'FAIL';
        console.log(`  [${statusIndicator}] ${scenarioResult.name} (${scenarioResult.durationMs}ms) - ${scenarioResult.detail}`);
        if (!scenarioResult.pass) {
          overallFailureEncountered = true;
        }
      }
    }
  } finally {
    await serverControl.stopServer();
  }

  const overallDurationMilliseconds = Math.round(performance.now() - overallStartTime);
  const durationSecondsFormatted = (overallDurationMilliseconds / 1000).toFixed(2);
  console.log(`\nBrowser matrix execution completed in ${durationSecondsFormatted}s (total wall time).`);

  if (overallFailureEncountered) {
    process.exit(1);
  }
}

runBrowserMatrix().catch((fatalExecutionError) => {
  console.error('Fatal matrix runner error:', fatalExecutionError);
  process.exit(1);
});
