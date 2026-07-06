# Changelog

## 1.0.0

Initial release.

- 135 tools covering the full WARP Customer API (trunks, porting, messaging/10DLC, numbers, team, billing, CDR analytics, account, network, API-key audit) plus `warp_status`.
- Interactive setup wizard (`warp-mcp setup`) with API-key validation and one-shot registration for Claude Code, Claude Desktop, Cursor, Codex (CLI + Desktop), GitHub Copilot (VS Code), and ChatGPT Desktop.
- Deep in-server knowledge base exposed as the `warp-guide` prompt and server instructions.
- Claude Code plugin packaging (`.claude-plugin/plugin.json` + `.mcp.json`), MCP Registry metadata (`server.json`), and MCPB desktop-extension manifest.
- Accurate tool annotations (read-only / write / idempotent / destructive) on every tool.
