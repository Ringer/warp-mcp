# Installing warp-mcp

MCP server for the Ringer WARP platform. Works with any MCP-capable client over stdio.

## Requirements

- Node.js >= 20 (`node --version`)
- A WARP API key (`rk_...`) — mint one in the [WARP portal](https://app.warp.ringer.tel) under **Settings → API Keys**. Test keys start with `rk_test_`.

## Quick start (recommended)

```bash
npm install -g warp-mcp
```

The interactive setup wizard runs automatically on global install (and can be re-run anytime with `warp-mcp setup`). It:

1. Validates your API key against the live API
2. Saves it to `~/.warp-mcp/config.json`
3. Detects installed MCP clients and registers the server with the ones you pick

## Per-client setup

### Claude Code

```bash
claude mcp add -s user warp -e WARP_API_TOKEN=rk_your_key -- npx -y warp-mcp
```

Or install as a Claude Code plugin (ships `.claude-plugin/plugin.json`; prompts for your key securely on install).

### Claude Desktop

Edit the config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "warp": {
      "command": "npx",
      "args": ["-y", "warp-mcp"],
      "env": { "WARP_API_TOKEN": "rk_your_key" }
    }
  }
}
```

### Cursor

One-click: [install warp MCP](cursor://anysphere.cursor-deeplink/mcp/install?name=warp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIndhcnAtbWNwIl0sImVudiI6eyJXQVJQX0FQSV9UT0tFTiI6IllPVVJfV0FSUF9BUElfS0VZIn19), then replace `YOUR_WARP_API_KEY` in Cursor's MCP settings.

Or edit `~/.cursor/mcp.json` with the same JSON block as Claude Desktop.

### Codex (CLI and Desktop)

```bash
codex mcp add warp --env WARP_API_TOKEN=rk_your_key -- npx -y warp-mcp
```

Codex Desktop shares `~/.codex/config.toml` with the CLI, so this covers both. The setup wizard also detects the Desktop app bundle directly if the CLI isn't on your PATH.

### GitHub Copilot (VS Code)

Add to VS Code `settings.json`:

```json
{
  "github.copilot.chat.mcp.servers": {
    "warp": {
      "command": "npx",
      "args": ["-y", "warp-mcp"],
      "env": { "WARP_API_TOKEN": "rk_your_key" }
    }
  }
}
```

### ChatGPT Desktop

Settings → Developer Mode → Add MCP server:

- Command: `npx`
- Args: `-y warp-mcp`
- Env: `WARP_API_TOKEN=rk_your_key`

## Hosted endpoint (no local install)

Instead of running the package locally, connect directly to
`https://mcp.warp.ringer.tel/` (Streamable HTTP):

- **Desktop connectors (claude.ai, ChatGPT):** add a custom connector with that URL
  and sign in with your WARP account when prompted (OAuth 2.1) — grants your
  customer-scoped permissions (excluding admin surfaces, Buzz, and API-key
  management — those stay in the portal).
- **Developer / CLI clients:** use a bearer `rk_` key:

```bash
claude mcp add --transport http warp https://mcp.warp.ringer.tel/ \
  --header "Authorization: Bearer $WARP_API_KEY"
```

```json
{
  "mcpServers": {
    "warp": {
      "type": "http",
      "url": "https://mcp.warp.ringer.tel/",
      "headers": { "Authorization": "Bearer rk_your_key_here" }
    }
  }
}
```

## API key notes

- Resolution order: `WARP_API_TOKEN` env var → `~/.warp-mcp/config.json` → unauthenticated (tools return setup guidance).
- Keys cannot be created via the API — only in the [portal](https://app.warp.ringer.tel) (Settings → API Keys). Rotate or revoke compromised keys there immediately.
- To update a stored key, run `warp-mcp setup` again, or edit `~/.warp-mcp/config.json`.

## Verifying the install

Ask your agent to run the `warp_status` tool — it reports the server version, whether a key is configured, and whether the API accepts it. From a terminal:

```bash
npx -y @modelcontextprotocol/inspector --cli npx -y warp-mcp --method tools/list
```

## Troubleshooting

- **"Authentication failed" on every tool** — key is missing, revoked, or lacks scopes. Run `warp_status`, then `warp-mcp setup`.
- **Tools don't appear in the client** — restart the client after registering; verify with the Inspector command above.
- **`npx` is slow to start** — install globally (`npm i -g warp-mcp`); the setup wizard then registers the global binary instead of npx.
- **Corporate proxy/no TTY** — the postinstall wizard only runs in interactive terminals; set `WARP_API_TOKEN` via env and add the manual JSON config.

## Uninstalling

```bash
npm uninstall -g warp-mcp
rm -rf ~/.warp-mcp
claude mcp remove -s user warp   # plus remove the JSON entries from other clients
```
