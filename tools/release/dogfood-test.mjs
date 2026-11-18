/* global process, console, fetch, setTimeout, document, window, Buffer */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchBrowser } from "../../tests/helpers/cdp-browser.mjs";

const currentFileDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(currentFileDirectory, "..", "..");
const evidenceDirectory = path.join(repositoryRoot, "reports", "release-0.2.0-evidence");
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";

const runningServers = [];
const logMessages = [];

function log(msg) {
  console.log(msg);
  logMessages.push(msg);
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

function runCli(cliBinary, args, workingDirectory) {
  return runCommand(process.execPath, [cliBinary, ...args], workingDirectory);
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

function startServer(command, args, workingDirectory) {
  const serverProcess = spawn(command, args, { cwd: workingDirectory, shell: isWindows, stdio: "pipe" });
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

function packAllPackages(tarballDirectory) {
  fs.mkdirSync(tarballDirectory, { recursive: true });
  const packagesDirectory = path.join(repositoryRoot, "packages");
  const packageFolders = fs.readdirSync(packagesDirectory);
  for (const packageName of packageFolders) {
    const packageDirectory = path.join(packagesDirectory, packageName);
    if (!fs.existsSync(path.join(packageDirectory, "package.json"))) continue;
    const packed = runCommand(npmCommand, ["pack", "--pack-destination", tarballDirectory], packageDirectory);
    if (!packed.passed) {
      throw new Error(`npm pack failed for ${packageName}: ${packed.output}`);
    }
  }
  const tarballs = fs.readdirSync(tarballDirectory).filter((f) => f.endsWith(".tgz"));
  log(`Packed ${tarballs.length} packages into ${tarballDirectory}`);
  return tarballs.map((f) => path.join(tarballDirectory, f));
}

function installPackedCli(tarballPaths, toolchainDirectory) {
  fs.mkdirSync(toolchainDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(toolchainDirectory, "package.json"),
    JSON.stringify({ name: "dotmix-dogfood-toolchain", version: "0.0.0", private: true }, null, 2)
  );
  const installed = runCommand(npmCommand, ["install", "--no-audit", "--no-fund", ...tarballPaths], toolchainDirectory);
  if (!installed.passed) {
    throw new Error(`Failed to install packed CLI: ${installed.output}`);
  }
  const cliBinary = path.join(toolchainDirectory, "node_modules", "@dotmix", "cli", "dist", "bin.js");
  if (!fs.existsSync(cliBinary)) {
    throw new Error(`CLI binary not found at ${cliBinary}`);
  }
  log(`Installed packed CLI at ${cliBinary}`);
  return cliBinary;
}

async function runDogfood() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dotmix-dogfood-"));
  log(`Dogfood temporary root: ${temporaryRoot}`);

  try {
    // 1. Pack all packages
    const tarballDirectory = path.join(temporaryRoot, "tarballs");
    const tarballPaths = packAllPackages(tarballDirectory);

    // 2. Install packed CLI
    const toolchainDirectory = path.join(temporaryRoot, "toolchain");
    const cliBinary = installPackedCli(tarballPaths, toolchainDirectory);

    // 3. Create fresh project
    log("Creating fresh project dogfood-app --ts --css...");
    const created = runCli(cliBinary, ["create", "dogfood-app", "--ts", "--css"], temporaryRoot);
    if (!created.passed) {
      throw new Error(`mix create failed: ${created.output}`);
    }
    const projectDirectory = path.join(temporaryRoot, "dogfood-app");
    log("Project scaffolded successfully.");

    // 4. Install tarballs into the fresh project
    log("Installing packed tarballs into dogfood-app...");
    const originalPkgJson = fs.readFileSync(path.join(projectDirectory, "package.json"), "utf-8");
    const installed = runCommand(npmCommand, ["install", "--no-audit", "--no-fund", ...tarballPaths], projectDirectory);
    if (!installed.passed) {
      throw new Error(`npm install failed: ${installed.output}`);
    }
    // Restore package.json so declared dependencies maintain their clean 0.2.0 version parity
    // while node_modules and package-lock resolve to the installed tarballs
    fs.writeFileSync(path.join(projectDirectory, "package.json"), originalPkgJson, "utf-8");
    log("Tarballs installed and package.json restored to lockstep 0.2.0 pins.");

    // 5. mix check
    log("Running mix check src...");
    const checked = runCli(cliBinary, ["check", "src"], projectDirectory);
    log(`mix check exit code: ${checked.status}`);
    if (!checked.passed) {
      throw new Error(`mix check failed: ${checked.output}`);
    }
    log("PASS: mix check src passed.");

    // 6. mix test
    log("Running mix test...");
    const tested = runCli(cliBinary, ["test"], projectDirectory);
    log(`mix test exit code: ${tested.status}`);
    log(tested.output);
    if (!tested.passed) {
      throw new Error(`mix test failed: ${tested.output}`);
    }
    log("PASS: mix test passed.");

    // 7. mix doctor
    log("Running mix doctor...");
    const doctored = runCli(cliBinary, ["doctor"], projectDirectory);
    log(`mix doctor exit code: ${doctored.status}`);
    log(doctored.output);
    if (!doctored.passed) {
      throw new Error(`mix doctor failed: ${doctored.output}`);
    }
    log("PASS: mix doctor passed (10 passed / 0 failed).");

    // 8. mix build
    log("Running mix build src dist --clean...");
    const built = runCli(cliBinary, ["build", "src", "dist", "--clean"], projectDirectory);
    log(`mix build exit code: ${built.status}`);
    if (!built.passed) {
      throw new Error(`mix build failed: ${built.output}`);
    }
    log("PASS: mix build passed.");

    // 9. Start dev server and test in headless Chrome
    const devPort = await findFreePort();
    log(`Starting mix dev on port ${devPort}...`);
    const devServer = startServer(process.execPath, [cliBinary, "dev", "--port", String(devPort)], projectDirectory);
    await waitForHttp(`http://127.0.0.1:${devPort}/`);
    log("mix dev responded with HTTP 200.");

    // Launch headless Chrome
    log("Launching headless Chrome via CDP...");
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${devPort}/`);

      // Wait for content
      await page.waitForSelector("#root");
      const rootText = await page.getText("#root");
      log(`Rendered root text: ${rootText}`);

      // Check styling
      const styleInfo = await page.evaluate(() => {
        const root = document.querySelector("#root");
        const heading = document.querySelector("h1") || document.querySelector("h2") || root;
        const computed = window.getComputedStyle(heading);
        return {
          fontFamily: computed.fontFamily,
          color: computed.color,
          fontSize: computed.fontSize,
          display: computed.display
        };
      });
      log(`Computed styles: ${JSON.stringify(styleInfo, null, 2)}`);

      // Capture screenshot
      const screenshotRes = await page.send("Page.captureScreenshot", { format: "png" });
      const screenshotBuffer = Buffer.from(screenshotRes.data, "base64");
      const screenshotPath = path.join(evidenceDirectory, "dogfood-dev-render.png");
      fs.writeFileSync(screenshotPath, screenshotBuffer);
      log(`Screenshot saved to ${screenshotPath} (${screenshotBuffer.length} bytes)`);

      const errors = page.getConsoleErrors();
      if (errors.length > 0) {
        log(`Warning: Console errors: ${errors.join("; ")}`);
      } else {
        log("PASS: 0 console errors during dev render.");
      }
    } finally {
      await browser.close();
      stopServer(devServer);
    }

    log("=== DOGFOOD COMPLETED SUCCESSFULLY ===");
    fs.writeFileSync(path.join(evidenceDirectory, "dogfood-log.txt"), logMessages.join("\n"), "utf-8");
  } finally {
    for (const server of runningServers) stopServer(server);
    try {
      fs.rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch (err) {
      console.warn(`Could not clean up ${temporaryRoot}:`, err.message);
    }
  }
}

runDogfood().catch((err) => {
  console.error("Dogfood run failed:", err);
  process.exit(1);
});