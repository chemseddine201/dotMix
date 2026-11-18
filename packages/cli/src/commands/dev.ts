/**
 * @dotmix/cli — `mix dev` Command
 */

import path from "node:path";
import os from "node:os";
import { exec } from "node:child_process";
import type { ParsedCliArgs } from "../args.js";
import { resolveCommandOptions } from "../config.js";
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
  const options = await resolveCommandOptions(parsed, rootDir);
  const silent = Boolean(parsed.values.silent);

  if (options.configPath && !silent) {
    console.log(colors.dim(`Loaded config from ${path.basename(options.configPath)}`));
  }

  const host = options.dev.host === "localhost" ? "127.0.0.1" : options.dev.host;
  const server = await createDevServer({
    rootDir: options.dev.rootDir,
    port: options.dev.port,
    host,
    cors: options.dev.cors,
    silent: true,
    mode: options.dev.mode
  });

  if (!silent) {
    const netIp = getNetworkIp();
    console.log(`\n${colors.bold(colors.cyan("● dotMix Dev Server"))}`);
    console.log(`  ${colors.green("➜")}  ${colors.bold("Local:")}   http://${options.dev.host}:${server.port}/`);
    if (netIp) {
      console.log(`  ${colors.green("➜")}  ${colors.bold("Network:")} http://${netIp}:${server.port}/`);
    }
    console.log(`  ${colors.dim("press h + enter to show help, q to quit")}\n`);
  }

  if (options.dev.open) {
    openBrowser(`http://${options.dev.host}:${server.port}/`);
  }

  return 0;
}
