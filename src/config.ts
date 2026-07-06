import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface Config {
  baseUrl: string;
  apiToken: string | null;
  requestTimeoutMs: number;
}

// Deliberately ~/.warp-mcp, not ~/.warp — the Warp terminal app uses ~/.warp.
const CONFIG_DIR = join(homedir(), ".warp-mcp");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const DEFAULT_API_URL = "https://api.warp.ringer.tel";

export { CONFIG_DIR, CONFIG_FILE, DEFAULT_API_URL };

function loadTokenFromConfigFile(): string | null {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const config = JSON.parse(raw);
    return typeof config.apiToken === "string" ? config.apiToken : null;
  } catch {
    return null;
  }
}

export function loadConfig(): Config {
  // Token resolution: env var > config file > null (unauthenticated)
  const apiToken =
    process.env.WARP_API_TOKEN || loadTokenFromConfigFile() || null;

  return {
    baseUrl: process.env.WARP_API_BASE_URL || DEFAULT_API_URL,
    apiToken,
    requestTimeoutMs: parseInt(
      process.env.WARP_REQUEST_TIMEOUT_MS || "30000",
      10
    ),
  };
}
