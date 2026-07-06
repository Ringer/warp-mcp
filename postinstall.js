#!/usr/bin/env node
import { stdin } from "node:process";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const setupScript = join(__dirname, "dist", "index.js");

// Only run interactive setup for global installs in a terminal.
const isGlobal = process.env.npm_config_global === "true";

if (isGlobal && stdin.isTTY && existsSync(setupScript)) {
  try {
    execFileSync("node", [setupScript, "setup"], { stdio: "inherit" });
  } catch {
    // Setup cancelled or failed — not fatal
  }
}
