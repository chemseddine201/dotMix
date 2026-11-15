/* global process, console, setTimeout, clearTimeout, performance */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareEndToEndArtifacts } from './scaffold-builder.mjs';
import { startEndToEndServer } from './server.mjs';

const currentFileDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(currentFileDirectory, '..', '..', '..');
const evidenceDirectoryPath = path.join(
  workspaceDirectory,
  'reports',
  'final-pass-evidence'
);

const BROWSER_CONFIGURATIONS = [
  {
    name: 'chrome',
    resolveExecutable: () => {
      const candidatePaths = [
        process.env.MIX_CHROME_PATH,
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
      ].filter(Boolean);
      return candidatePaths.find((binaryPath) => fs.existsSync(binaryPath));
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
      const candidatePaths = [
        process.env.MIX_EDGE_PATH,
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
      ].filter(Boolean);
      return candidatePaths.find((binaryPath) => fs.existsSync(binaryPath));
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
      const candidatePaths = [
        process.env.MIX_FIREFOX_PATH,
        'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
        'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
      ].filter(Boolean);
      return candidatePaths.find((binaryPath) => fs.existsSync(binaryPath));
    },
    buildArguments: (profileDirectory, targetUrl) => [
      '-headless',
      '-no-remote',
      '-profile',
      profileDirectory,
      targetUrl
    ],
    prepareProfile: (profileDirectory) => {
      const preferenceStatements = [
        'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("browser.startup.homepage_override.mstone", "ignore");',
        'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
        'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
        'user_pref("browser.tabs.warnOnClose", false);',
        'user_pref("dom.indexedDB.enabled", true);',
        'user_pref("dom.indexedDB.privateBrowsing.enabled", true);'
      ].join('\n');
      fs.writeFileSync(
        path.join(profileDirectory, 'user.js'),
        preferenceStatements,
        'utf8'
      );
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
    // Process already exited
  }
}

function terminateProfileProcesses(profileDirectoryPath) {
  if (process.platform !== 'win32') return;
  const escapedDirectory = profileDirectoryPath.replace(/'/g, "''");
  try {
    execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${escapedDirectory}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' }
    );
  } catch {
    // No remaining matching processes
  }
}

function removeDirectoryWithRetries(targetDirectoryPath, maximumRetries = 5) {
  for (let retryIndex = 0; retryIndex < maximumRetries; retryIndex += 1) {
    try {
      if (fs.existsSync(targetDirectoryPath)) {
        fs.rmSync(targetDirectoryPath, { recursive: true, force: true });
      }
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
}

export async function runEndToEndBrowserMatrix() {
  const overallStartTimestamp = performance.now();

  if (!fs.existsSync(evidenceDirectoryPath)) {
    fs.mkdirSync(evidenceDirectoryPath, { recursive: true });
  }

  console.log('=== dotMix End-to-End Real-Browser Matrix Runner ===\n');

  // Step 1: Pre-build showcase and scaffold variants once
  const artifactEnvironment = prepareEndToEndArtifacts(workspaceDirectory);
  const scenarioDefinitions = artifactEnvironment.scenarioDefinitions;
  const expectedScenarioCount = scenarioDefinitions.length;

  console.log(
    `\nTotal test targets prepared: ${expectedScenarioCount} (Showcase + 10 Golden Path variants)\n`
  );

  // Step 2: Start dedicated e2e HTTP server
  const serverControl = await startEndToEndServer(
    workspaceDirectory,
    artifactEnvironment.scaffoldRegistry,
    scenarioDefinitions
  );
  console.log(`E2E server listening at: ${serverControl.serverBaseUrl}\n`);

  let anyBrowserFailed = false;

  try {
    for (const browserConfig of BROWSER_CONFIGURATIONS) {
      const browserExecutable = browserConfig.resolveExecutable();
      if (!browserExecutable) {
        console.error(`ERROR: Missing executable for browser: ${browserConfig.name}`);
        anyBrowserFailed = true;
        continue;
      }

      console.log(`----------------------------------------------------------------`);
      console.log(`Launching Browser: ${browserConfig.name} (${browserExecutable})`);
      console.log(`----------------------------------------------------------------`);

      const runToken = `e2e-${browserConfig.name}-${Date.now()}`;
      serverControl.resetResults(runToken);

      const profileDirectoryPath = path.join(
        os.tmpdir(),
        `mix-e2e-profile-${browserConfig.name}-${Date.now()}`
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

      const hardTimeoutMilliseconds = 300000; // 5-minute timeout per browser
      let isTimeoutTriggered = false;
      const timeoutTimerHandle = setTimeout(() => {
        isTimeoutTriggered = true;
        console.error(
          `Browser ${browserConfig.name} exceeded hard execution timeout. Terminating.`
        );
        terminateProcessSafely(browserProcess.pid);
      }, hardTimeoutMilliseconds);

      try {
        await Promise.race([
          serverControl.waitForCompletion(),
          new Promise((resolveProcessExit) => {
            browserProcess.on('exit', (exitCode) => {
              if (exitCode !== 0 && exitCode !== null) {
                resolveProcessExit();
              }
            });
          })
        ]);
      } finally {
        clearTimeout(timeoutTimerHandle);
        terminateProcessSafely(browserProcess.pid);
        terminateProfileProcesses(profileDirectoryPath);
        removeDirectoryWithRetries(profileDirectoryPath);
      }

      const collectedResults = serverControl.getResults();

      if (collectedResults.length === 0 && isTimeoutTriggered) {
        collectedResults.push({
          name: 'browser-timeout',
          title: 'Hard Timeout',
          pass: false,
          detail: 'Execution exceeded 5-minute timeout',
          durationMs: hardTimeoutMilliseconds
        });
      }

      // Write browser evidence file
      const evidenceFilePath = path.join(
        evidenceDirectoryPath,
        `e2e-${browserConfig.name}.json`
      );
      fs.writeFileSync(
        evidenceFilePath,
        JSON.stringify(collectedResults, null, 2),
        'utf8'
      );
      console.log(`Saved evidence to: ${evidenceFilePath}`);

      if (collectedResults.length !== expectedScenarioCount) {
        anyBrowserFailed = true;
        console.error(
          `WARNING: ${browserConfig.name} completed ${collectedResults.length} of ${expectedScenarioCount} scenarios`
        );
      }

      let browserPassCount = 0;
      for (const scenarioResult of collectedResults) {
        const statusLabel = scenarioResult.pass ? 'PASS' : 'FAIL';
        console.log(
          `  [${statusLabel}] ${scenarioResult.title || scenarioResult.name} (${scenarioResult.durationMs}ms) - ${scenarioResult.detail}`
        );
        if (scenarioResult.pass) {
          browserPassCount += 1;
        } else {
          anyBrowserFailed = true;
        }
      }

      console.log(
        `\nSummary for ${browserConfig.name}: ${browserPassCount}/${expectedScenarioCount} passed.\n`
      );
    }
  } finally {
    await serverControl.stopServer();
    artifactEnvironment.cleanupArtifacts();
  }

  const overallWallMilliseconds = Math.round(performance.now() - overallStartTimestamp);
  const totalSecondsFormatted = (overallWallMilliseconds / 1000).toFixed(2);
  console.log('================================================================');
  console.log(
    `End-to-End Browser Matrix finished in ${totalSecondsFormatted}s total wall time.`
  );
  console.log('================================================================\n');

  if (anyBrowserFailed) {
    process.exit(1);
  }
}

const isDirectRun =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runEndToEndBrowserMatrix().catch((fatalExecutionError) => {
    console.error('Fatal E2E execution error:', fatalExecutionError);
    process.exit(1);
  });
}
