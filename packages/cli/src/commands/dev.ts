/**
 * @dotmix/cli — `mix dev` Command (Gate 37 / T-37.3 / D-161)
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { exec } from "node:child_process";
import type { ParsedCliArgs } from "../args.js";
import { createDevServer } from "../dev.js";
import { colors } from "../terminal.js";

function getNetworkIp(): string | undefined {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return undefined;
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const cmd = platform === "win32" ? `start "" "${url}"` : platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

export async function devCommand(parsed: ParsedCliArgs): Promise<number> {
  const rootDir = parsed.positional[0] ? path.resolve(parsed.positional[0]) : process.cwd();

  // Load config if present
  const port = parsed.values.port ? Number(parsed.values.port) : 3000;
  const host = parsed.values.host ?? "127.0.0.1";
  const _cors = Boolean(parsed.values.cors);
  const open = Boolean(parsed.values.open);
  const silent = Boolean(parsed.values.silent);
  const mode = parsed.values.mode || "development";

  const configPathTs = path.join(rootDir, "mix.config.ts");
  const configPathDotmix = path.join(rootDir, "dotmix.config.ts");
  const activeConfig = fs.existsSync(configPathTs) ? configPathTs : fs.existsSync(configPathDotmix) ? configPathDotmix : null;

  if (activeConfig && !silent) {
    console.log(colors.dim(`Loaded config from ${path.basename(activeConfig)}`));
  }

  const server = await createDevServer({ rootDir, port, host, silent: true, mode });

  if (!silent) {
    const netIp = getNetworkIp();
    console.log(`\n${colors.bold(colors.cyan("● Mix Framework Dev Server"))}`);
    console.log(`  ${colors.green("➜")}  ${colors.bold("Local:")}   http://${host}:${server.port}/`);
    if (netIp) {
      console.log(`  ${colors.green("➜")}  ${colors.bold("Network:")} http://${netIp}:${server.port}/`);
    }
    console.log(`  ${colors.dim("press h + enter to show help, q to quit")}\n`);
  }

  if (open) {
    openBrowser(`http://${host}:${server.port}/`);
  }

  return 0;
}
