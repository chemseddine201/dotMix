/* global process, console, fetch, setTimeout */
/**
 * Clean-room install test: proves the packed @dotmix/* packages work on their own, outside the
 * monorepo. Packs every package, scaffolds a project with the packed CLI, installs the tarballs,
 * then runs check, build, preview (loaded in headless Chrome) and dev.
 *
 * Usage: node tools/release/clean-room-test.mjs
 * Exit code 1 when any step fails. Network is needed only for the external dependencies.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const npxCommand = isWindows ? "npx.cmd" : "npx";
const TEMPLATE_HEADING = "Mix Framework App";
const BROWSER_ERROR_MARKERS = ["Uncaught", "SyntaxError", "Failed to load module"];

const stepResults = [];
const runningServers = [];

function recordStep(stepName, passed, detail = "") {
  stepResults.push({ stepName, passed, detail });
  console.log(`${passed ? "PASS" : "FAIL"}  ${stepName}${detail ? `  (${detail})` : ""}`);
  return passed;
}

function runCommand(command, args, workingDirectory) {
  const result = spawnSync(command, args, {
    cwd: workingDirectory,
    encoding: "utf-8",
    shell: isWindows,
    maxBuffer: 64 * 1024 * 1024
  });
  return {
    passed: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status
  };
}

function lastLines(text, count = 8) {
  return text.trim().split("\n").slice(-count).join("\n");
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function startServer(args, workingDirectory) {
  const serverProcess = spawn(npxCommand, args, { cwd: workingDirectory, shell: isWindows, stdio: "pipe" });
  serverProcess.capturedOutput = "";
  serverProcess.stdout.on("data", (chunk) => { serverProcess.capturedOutput += chunk; });
  serverProcess.stderr.on("data", (chunk) => { serverProcess.capturedOutput += chunk; });
  runningServers.push(serverProcess);
  return serverProcess;
}

function stopServer(serverProcess) {
  if (serverProcess.exitCode !== null) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(serverProcess.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    serverProcess.kill("SIGTERM");
  }
}

async function waitForHttp(url, timeoutMilliseconds = 30000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      return response;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`No response from ${url} within ${timeoutMilliseconds} ms`);
}

function findChrome() {
  const candidatePaths = [
    process.env.MIX_CHROME_PATH,
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter(Boolean);
  return candidatePaths.find((binaryPath) => fs.existsSync(binaryPath));
}

function listFilesRecursively(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function packAllPackages(tarballDirectory) {
  fs.mkdirSync(tarballDirectory, { recursive: true });
  const packagesDirectory = path.join(repositoryRoot, "packages");
  for (const packageName of fs.readdirSync(packagesDirectory)) {
    const packageDirectory = path.join(packagesDirectory, packageName);
    if (!fs.existsSync(path.join(packageDirectory, "package.json"))) continue;
    const packed = runCommand(npmCommand, ["pack", "--pack-destination", tarballDirectory], packageDirectory);
    if (!packed.passed) {
      return recordStep("npm pack", false, `${packageName}: ${lastLines(packed.output, 3)}`);
    }
  }
  const tarballs = fs.readdirSync(tarballDirectory).filter((fileName) => fileName.endsWith(".tgz"));
  return recordStep("npm pack", tarballs.length > 0, `${tarballs.length} tarballs`);
}

/**
 * Installs the packed CLI with its dependencies into its own folder (what `npx` does) and returns
 * its bin.js. The unpacked tarball alone cannot start: bin.js imports the compiler packages.
 */
function installPackedCli(tarballPaths, toolchainDirectory) {
  fs.mkdirSync(toolchainDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(toolchainDirectory, "package.json"),
    JSON.stringify({ name: "dotmix-clean-room-toolchain", version: "0.0.0", private: true }, null, 2)
  );
  const installed = runCommand(npmCommand, ["install", "--no-audit", "--no-fund", ...tarballPaths], toolchainDirectory);
  const cliBinary = path.join(toolchainDirectory, "node_modules", "@dotmix", "cli", "dist", "bin.js");
  recordStep("install the packed CLI", installed.passed && fs.existsSync(cliBinary), installed.passed ? "" : lastLines(installed.output));
  return installed.passed && fs.existsSync(cliBinary) ? cliBinary : null;
}

function verifyLockFileUsesTarballs(projectDirectory) {
  const lockFile = JSON.parse(fs.readFileSync(path.join(projectDirectory, "package-lock.json"), "utf-8"));
  const registryResolved = Object.entries(lockFile.packages ?? {})
    .filter(([packagePath]) => packagePath.includes("node_modules/@dotmix/"))
    .filter(([, entry]) => typeof entry.resolved === "string" && !entry.resolved.startsWith("file:"))
    .map(([packagePath, entry]) => `${packagePath} -> ${entry.resolved}`);
  return recordStep(
    "package-lock resolves @dotmix/* from the tarballs",
    registryResolved.length === 0,
    registryResolved.join(", ")
  );
}

function checkEmittedModules(projectDirectory) {
  const emittedModules = listFilesRecursively(path.join(projectDirectory, "dist", "assets")).filter((filePath) =>
    filePath.endsWith(".js")
  );
  const failures = emittedModules.filter(
    (modulePath) => spawnSync(process.execPath, ["--check", modulePath], { encoding: "utf-8" }).status !== 0
  );
  return recordStep(
    "node --check dist/assets/**/*.js",
    emittedModules.length > 0 && failures.length === 0,
    failures.length > 0 ? failures.join(", ") : `${emittedModules.length} modules`
  );
}

async function verifyPreviewInChrome(projectDirectory, temporaryRoot) {
  const chromePath = findChrome();
  if (!chromePath) return recordStep("preview in headless Chrome", false, "Chrome not found (set MIX_CHROME_PATH)");
  const port = await findFreePort();
  const previewServer = startServer(["mix", "preview", "--port", String(port)], projectDirectory);
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`);
    const chromeRun = spawnSync(
      chromePath,
      [
        "--headless=new",
        "--disable-gpu",
        `--user-data-dir=${path.join(temporaryRoot, "chrome-profile")}`,
        "--virtual-time-budget=8000",
        "--enable-logging=stderr",
        "--v=0",
        "--dump-dom",
        `http://127.0.0.1:${port}/`
      ],
      { encoding: "utf-8", timeout: 60000, maxBuffer: 64 * 1024 * 1024 }
    );
    const renderedDom = chromeRun.stdout ?? "";
    const rootStart = renderedDom.indexOf('<div id="root">');
    const rootMarkup = rootStart >= 0 ? renderedDom.slice(rootStart) : "";
    const browserErrors = BROWSER_ERROR_MARKERS.filter((marker) => (chromeRun.stderr ?? "").includes(marker));
    const rendered = rootMarkup.includes(TEMPLATE_HEADING);
    return recordStep(
      "preview in headless Chrome",
      rendered && browserErrors.length === 0,
      rendered ? browserErrors.join(", ") : `#root does not contain "${TEMPLATE_HEADING}"`
    );
  } catch (error) {
    return recordStep("preview in headless Chrome", false, `${error.message}; server output: ${lastLines(previewServer.capturedOutput)}`);
  } finally {
    stopServer(previewServer);
  }
}

async function verifyDevServer(projectDirectory) {
  const port = await findFreePort();
  const devServer = startServer(["mix", "dev", "--port", String(port)], projectDirectory);
  try {
    const indexResponse = await waitForHttp(`http://127.0.0.1:${port}/`);
    const entryResponse = await fetch(`http://127.0.0.1:${port}/src/main.mix`);
    const entryType = entryResponse.headers.get("content-type") ?? "";
    return recordStep(
      "mix dev serves / and /src/main.mix",
      indexResponse.status === 200 && entryResponse.status === 200 && entryType.includes("javascript"),
      `/ ${indexResponse.status}, /src/main.mix ${entryResponse.status} ${entryType}`
    );
  } catch (error) {
    return recordStep("mix dev serves / and /src/main.mix", false, `${error.message}; server output: ${lastLines(devServer.capturedOutput)}`);
  } finally {
    stopServer(devServer);
  }
}

async function runCleanRoom(temporaryRoot) {
  const tarballDirectory = path.join(temporaryRoot, "tarballs");
  if (!packAllPackages(tarballDirectory)) return;

  const tarballPaths = fs
    .readdirSync(tarballDirectory)
    .filter((fileName) => fileName.endsWith(".tgz"))
    .map((fileName) => path.join(tarballDirectory, fileName));
  const cliBinary = installPackedCli(tarballPaths, path.join(temporaryRoot, "toolchain"));
  if (!cliBinary) return;

  const created = runCommand(process.execPath, [cliBinary, "create", "demo", "--ts", "--css"], temporaryRoot);
  if (!recordStep("mix create demo --ts --css", created.passed, created.passed ? "" : lastLines(created.output))) return;
  const projectDirectory = path.join(temporaryRoot, "demo");

  const installed = runCommand(npmCommand, ["install", "--no-audit", "--no-fund", ...tarballPaths], projectDirectory);
  if (!recordStep("npm install <tarballs>", installed.passed, installed.passed ? "" : lastLines(installed.output))) return;
  verifyLockFileUsesTarballs(projectDirectory);

  const checked = runCommand(npxCommand, ["mix", "check", "src"], projectDirectory);
  recordStep("mix check src", checked.passed, checked.passed ? "" : lastLines(checked.output));

  const built = runCommand(npxCommand, ["mix", "build", "src", "dist", "--clean"], projectDirectory);
  if (!recordStep("mix build src dist --clean", built.passed, built.passed ? "" : lastLines(built.output))) return;
  checkEmittedModules(projectDirectory);

  await verifyPreviewInChrome(projectDirectory, temporaryRoot);
  await verifyDevServer(projectDirectory);
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-clean-room-"));
try {
  await runCleanRoom(temporaryRoot);
} catch (error) {
  recordStep("unexpected error", false, error instanceof Error ? error.message : String(error));
} finally {
  for (const serverProcess of runningServers) stopServer(serverProcess);
  try {
    fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  } catch (error) {
    console.log(`Could not remove ${temporaryRoot}: ${error.message}`);
  }
}

console.log("\n| Step | Result |\n| :--- | :--- |");
for (const step of stepResults) {
  console.log(`| ${step.stepName} | ${step.passed ? "PASS" : "FAIL"} |`);
}
const failedSteps = stepResults.filter((step) => !step.passed);
process.exitCode = failedSteps.length > 0 || stepResults.length === 0 ? 1 : 0;
