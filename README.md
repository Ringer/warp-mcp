# warp-mcp

MCP server for the [Ringer WARP platform](https://warp.ringer.tel) — SIP trunking, phone numbers, porting, messaging/10DLC, billing, and CDR analytics.

Gives AI agents (Claude, Cursor, Copilot, Codex, ChatGPT) full access to the WARP Customer API: 135 tools covering trunk provisioning, number search and ordering, port-in lifecycle, 10DLC brand/campaign registration, SMS sending, invoices, and call-detail analytics.

## Quick Start

```bash
# Recommended: global install — the setup wizard runs automatically
npm install -g warp-mcp

# Or run the wizard explicitly / without installing
npx -y warp-mcp setup
```

The wizard validates your API key, stores it in `~/.warp-mcp/config.json`, and registers the server with every MCP client it detects (Claude Code, Claude Desktop, Cursor, Codex, GitHub Copilot, ChatGPT Desktop).

You need a WARP API key (`rk_...`) — mint one in the [WARP portal](https://app.warp.ringer.tel) under **Settings → API Keys**.

## One-command installs

**Claude Code**

```bash
claude mcp add -s user warp -e WARP_API_TOKEN=rk_your_key -- npx -y warp-mcp
```

**Cursor** — [click to install](cursor://anysphere.cursor-deeplink/mcp/install?name=warp&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIndhcnAtbWNwIl0sImVudiI6eyJXQVJQX0FQSV9UT0tFTiI6IllPVVJfV0FSUF9BUElfS0VZIn19) (then replace `YOUR_WARP_API_KEY`)

**Manual (any MCP client)**

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

See [INSTALL.md](INSTALL.md) for per-client walkthroughs, troubleshooting, and uninstall steps.

## Hosted endpoint

No local install needed — connect straight to `https://mcp.warp.ringer.tel/` (Streamable HTTP).

**Desktop connectors (claude.ai, ChatGPT):** add a custom connector with that URL and
sign in with your WARP account when prompted — the hosted endpoint authenticates via
OAuth 2.1 and grants your customer-scoped permissions (excluding admin surfaces, Buzz,
and API-key management — those stay in the portal).

**Developer / CLI clients:** authenticate with a bearer `rk_` key instead:

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

Keys are minted in the [WARP portal](https://app.warp.ringer.tel) under **Settings → API Keys**.

## Tools

| Prefix | Group | Tools | What it does |
|---|---|---:|---|
| `trunk_` | SIP Trunks | 24 | Trunk CRUD, SIP credentials, endpoints, IP ACLs, registrations |
| `port_` | Porting | 33 | Port-in requests end to end: draft → validate → submit → activate, documents, TIN compliance |
| `msg_` | Messaging | 33 | Send SMS, message history, 10DLC brands/campaigns, number enrollment, TCR reference data |
| `num_` | Numbers | 15 | Search, order, release DIDs; per-TN voice/SMS config; port-out PINs |
| `team_` | Team | 9 | Members and RBAC roles |
| `bill_` | Billing | 5 | Balance, ledger, invoices (JSON + HTML) |
| `cdr_` | Analytics | 5 | Call detail records, statistics, trends, CSV export |
| `acct_` / `net_` / `key_` | Account | 10 | Capacity, utilization, scopes, WARP network IPs, API-key audit |
| `warp_status` | Diagnostics | 1 | Config + connectivity check |

The server also ships a `warp-guide` prompt (and server instructions) with deep WARP domain knowledge — workflows, concepts, and common mistakes.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `WARP_API_TOKEN` | — | API key (`rk_...`). Overrides `~/.warp-mcp/config.json` |
| `WARP_API_BASE_URL` | `https://api.warp.ringer.tel` | API base URL override |
| `WARP_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout |

Token resolution order: env var → `~/.warp-mcp/config.json` → unauthenticated (tools return guidance to run setup).

## Development

```bash
npm ci --ignore-scripts
npm run build   # tsc → dist/
npm test        # vitest (in-memory MCP transport)
npm run dev     # tsx src/index.ts
```

Releases are published from CI: `npm version patch|minor|major`, push with `--follow-tags`, create a GitHub release — the workflow publishes to npm (OIDC trusted publishing with provenance) and to the [MCP Registry](https://registry.modelcontextprotocol.io) (`io.github.ringer/warp`). Do not run `npm publish` locally after the initial release.

## License

MIT © [Ringer](https://ringer.tel)
