import { createInterface } from "node:readline/promises";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { execSync, execFileSync } from "node:child_process";
import { stdin, stdout } from "node:process";
import { CONFIG_DIR, CONFIG_FILE, DEFAULT_API_URL } from "./config.js";
import { ICON_DARK_DATA_URI } from "./icons.js";

const PORTAL_URL = "https://warp.ringer.tel";
const API_BASE_URL = process.env.WARP_API_BASE_URL || DEFAULT_API_URL;
// Cheap authenticated GET: any valid customer key can call it, no params.
const VALIDATION_ENDPOINT = "/v1/network/ingress-ips";

export async function runSetup(): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  console.log("\n  WARP MCP — Setup\n");

  const existing = loadExistingToken();
  if (existing) {
    console.log(`  Found existing API key: ${maskToken(existing)}`);
    const keep = await rl.question("  Keep this key? (Y/n): ");
    if (keep.toLowerCase() !== "n") {
      console.log("\n  ✓ Keeping existing configuration.");
      await registerWithClients(rl, existing);
      rl.close();
      return;
    }
  }

  console.log("  Do you have a WARP API key? (rk_... — minted in the portal");
  console.log(`  under Settings → API Keys at ${PORTAL_URL})\n`);
  console.log("  [1] Yes, I have one  → Enter it");
  console.log(`  [2] No, I need one   → Opens ${PORTAL_URL} in browser`);
  console.log();

  const choice = await rl.question("  > ");

  switch (choice.trim()) {
    case "1": {
      const token = await rl.question("\n  Enter your API key: ");
      const trimmed = token.trim();
      if (!trimmed) {
        console.log("\n  ✗ No key entered. Exiting.\n");
        rl.close();
        process.exit(1);
      }

      console.log("\n  Validating...");
      const valid = await validateToken(trimmed);
      if (!valid) {
        console.log("  ✗ Token validation failed. The API returned an error.");
        console.log("  Check your key and try again.\n");
        rl.close();
        process.exit(1);
      }

      saveToken(trimmed);
      console.log(`  ✓ Token validated`);
      console.log(`  ✓ Saved to ${CONFIG_FILE}`);
      await registerWithClients(rl, trimmed);
      break;
    }

    case "2":
    default: {
      console.log(`\n  Opening ${PORTAL_URL} ...\n`);
      await openBrowser(PORTAL_URL);
      console.log(
        "  Mint a key under Settings → API Keys, then run `warp-mcp setup` again.\n"
      );
      break;
    }
  }

  rl.close();
}

// Prefer the globally installed binary; fall back to npx for one-off runs.
function getServerCommand(): { command: string; args: string[] } {
  if (commandExists("warp-mcp")) {
    return { command: "warp-mcp", args: [] };
  }
  return { command: "npx", args: ["-y", "warp-mcp"] };
}

async function registerWithClients(
  rl: ReturnType<typeof createInterface>,
  token: string | null
): Promise<void> {
  const clients = detectMcpClients();

  if (clients.length === 0) {
    console.log("\n  No supported MCP clients detected.\n");
    printManualConfig(token);
    return;
  }

  console.log("\n  Detected MCP clients:\n");
  clients.forEach((c, i) => console.log(`  [${i + 1}] ${c.name}`));
  console.log(`  [A] All of the above`);
  console.log(`  [S] Skip — I'll configure manually`);
  console.log();

  const answer = await rl.question(
    "  Register with which clients? (e.g. 1,3 or A) > "
  );
  const trimmed = answer.trim().toUpperCase();

  if (trimmed === "S") {
    printManualConfig(token);
    return;
  }

  const selected =
    trimmed === "A"
      ? clients
      : clients.filter((_, i) =>
          trimmed
            .split(",")
            .map((s) => s.trim())
            .includes(String(i + 1))
        );

  if (selected.length === 0) {
    printManualConfig(token);
    return;
  }

  for (const client of selected) {
    const success = client.register(token);
    if (success) {
      console.log(`  ✓ Registered with ${client.name}`);
    } else {
      console.log(`  ✗ Failed to register with ${client.name}`);
    }
  }

  console.log("\n  Done! Restart your MCP client to load the WARP tools.\n");
}

interface McpClient {
  name: string;
  register: (token: string | null) => boolean;
}

function detectMcpClients(): McpClient[] {
  const clients: McpClient[] = [];

  if (commandExists("claude")) {
    clients.push({
      name: "Claude Code",
      register: (token) => registerClaudeCode(token),
    });
  }

  const claudeDesktopConfig = getClaudeDesktopConfigPath();
  if (claudeDesktopConfig && existsSync(claudeDesktopConfig)) {
    clients.push({
      name: "Claude Desktop",
      register: (token) => registerJsonConfig(claudeDesktopConfig, token),
    });
  }

  const cursorConfig = getCursorConfigPath();
  if (cursorConfig && existsSync(cursorConfig)) {
    clients.push({
      name: "Cursor",
      register: (token) => registerJsonConfig(cursorConfig, token),
    });
  }

  const codex = findCodexBinary();
  if (codex) {
    clients.push({
      name: codex.label,
      register: (token) => registerCodex(codex.bin, token),
    });
  }

  const vscodeSettingsPath = getVsCodeSettingsPath();
  if (vscodeSettingsPath && existsSync(vscodeSettingsPath)) {
    clients.push({
      name: "GitHub Copilot (VS Code)",
      register: (token) => registerCopilot(vscodeSettingsPath, token),
    });
  }

  if (isChatGptDesktopInstalled()) {
    clients.push({
      name: "ChatGPT Desktop (manual)",
      register: (token) => {
        const { command, args } = getServerCommand();
        console.log("\n  ChatGPT Desktop requires manual setup:");
        console.log("  1. Open ChatGPT Desktop → Settings → Developer Mode");
        console.log("  2. Add a new MCP server with:");
        console.log(`     Command: ${command}`);
        if (args.length) console.log(`     Args: ${args.join(" ")}`);
        if (token) {
          console.log(`     Env: WARP_API_TOKEN=${token}`);
        }
        return true;
      },
    });
  }

  return clients;
}

function registerClaudeCode(token: string | null): boolean {
  try {
    try {
      execSync(`claude mcp remove -s user warp 2>/dev/null`, {
        stdio: "ignore",
      });
    } catch {
      // ignore — server may not have been registered before
    }

    const { command, args: cmdArgs } = getServerCommand();
    const args = ["mcp", "add", "-s", "user", "warp"];
    if (token) {
      args.push("-e", `WARP_API_TOKEN=${token}`);
    }
    args.push("--", command, ...cmdArgs);
    execFileSync("claude", args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Codex Desktop ships its own codex binary inside the .app bundle; both it and
// the standalone CLI share ~/.codex/config.toml, so either can register us.
function findCodexBinary(): { bin: string; label: string } | null {
  const desktopBin =
    process.platform === "darwin"
      ? "/Applications/Codex.app/Contents/Resources/codex"
      : null;
  const desktopAvailable = desktopBin !== null && existsSync(desktopBin);

  if (commandExists("codex")) {
    return {
      bin: "codex",
      label: desktopAvailable ? "Codex (CLI + Desktop)" : "Codex CLI",
    };
  }
  if (desktopAvailable && desktopBin) {
    return { bin: desktopBin, label: "Codex Desktop" };
  }
  return null;
}

function registerCodex(bin: string, token: string | null): boolean {
  try {
    try {
      execFileSync(bin, ["mcp", "remove", "warp"], { stdio: "ignore" });
    } catch {
      // ignore — server may not have been registered before
    }

    const { command, args: cmdArgs } = getServerCommand();
    const args = ["mcp", "add", "warp"];
    if (token) {
      args.push("--env", `WARP_API_TOKEN=${token}`);
    }
    args.push("--", command, ...cmdArgs);
    execFileSync(bin, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getCursorConfigPath(): string | null {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return `${home}/.cursor/mcp.json`;
}

function getVsCodeSettingsPath(): string | null {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  switch (process.platform) {
    case "darwin":
      return `${home}/Library/Application Support/Code/User/settings.json`;
    case "win32":
      return `${process.env.APPDATA}/Code/User/settings.json`;
    case "linux":
      return `${home}/.config/Code/User/settings.json`;
    default:
      return null;
  }
}

function registerCopilot(settingsPath: string, token: string | null): boolean {
  try {
    let settings: Record<string, unknown> = {};
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    } catch {
      // start fresh
    }

    const key = "github.copilot.chat.mcp.servers";
    if (!settings[key] || typeof settings[key] !== "object") {
      settings[key] = {};
    }

    const servers = settings[key] as Record<string, unknown>;
    const { command, args: cmdArgs } = getServerCommand();
    const entry: Record<string, unknown> = {
      command,
      args: cmdArgs,
      icon: ICON_DARK_DATA_URI,
    };
    if (token) {
      entry.env = { WARP_API_TOKEN: token };
    }
    servers["warp"] = entry;

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

function isChatGptDesktopInstalled(): boolean {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  switch (process.platform) {
    case "darwin":
      return existsSync(`${home}/Library/Application Support/com.openai.chat`);
    case "win32":
      return existsSync(`${process.env.LOCALAPPDATA}/Programs/ChatGPT`);
    default:
      return false;
  }
}

function registerJsonConfig(
  configPath: string,
  token: string | null,
  serverKey: string = "warp"
): boolean {
  try {
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      // start fresh
    }

    if (!config.mcpServers || typeof config.mcpServers !== "object") {
      config.mcpServers = {};
    }

    const servers = config.mcpServers as Record<string, unknown>;
    const { command, args: cmdArgs } = getServerCommand();
    const entry: Record<string, unknown> = {
      command,
      args: cmdArgs,
      icon: ICON_DARK_DATA_URI,
    };
    if (token) {
      entry.env = { WARP_API_TOKEN: token };
    }
    servers[serverKey] = entry;

    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    return true;
  } catch {
    return false;
  }
}

function getClaudeDesktopConfigPath(): string | null {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  switch (process.platform) {
    case "darwin":
      return `${home}/Library/Application Support/Claude/claude_desktop_config.json`;
    case "win32":
      return `${process.env.APPDATA}/Claude/claude_desktop_config.json`;
    case "linux":
      return `${home}/.config/Claude/claude_desktop_config.json`;
    default:
      return null;
  }
}

function commandExists(cmd: string): boolean {
  try {
    const check = process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`;
    execSync(check, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function loadExistingToken(): string | null {
  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const config = JSON.parse(raw);
    return typeof config.apiToken === "string" ? config.apiToken : null;
  } catch {
    return null;
  }
}

function saveToken(token: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = existsSync(CONFIG_FILE)
    ? JSON.parse(readFileSync(CONFIG_FILE, "utf-8"))
    : {};
  existing.apiToken = token;
  writeFileSync(CONFIG_FILE, JSON.stringify(existing, null, 2) + "\n");
}

async function validateToken(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}${VALIDATION_ENDPOINT}`, {
      headers: { Authorization: "Bearer " + token },
      signal: AbortSignal.timeout(10000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return token.substring(0, 4) + "..." + token.substring(token.length - 4);
}

async function openBrowser(url: string): Promise<void> {
  const { exec } = await import("node:child_process");
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${cmd} ${url}`);
}

function printManualConfig(token: string | null): void {
  const { command, args } = getServerCommand();
  const config = {
    mcpServers: {
      warp: {
        command,
        args,
        icon: ICON_DARK_DATA_URI,
        ...(token ? { env: { WARP_API_TOKEN: token } } : {}),
      },
    },
  };

  console.log("\n  Add this to your MCP client configuration:\n");
  console.log(
    JSON.stringify(config, null, 2)
      .split("\n")
      .map((line) => "  " + line)
      .join("\n")
  );
  console.log();
}
