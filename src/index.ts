#!/usr/bin/env node

const subcommand = process.argv[2];

if (subcommand === "setup") {
  const { runSetup } = await import("./setup.js");
  await runSetup();
} else if (!subcommand && process.stdin.isTTY && !process.env.MCP_CLIENT) {
  // No args + interactive terminal + not spawned by an MCP client.
  const { VERSION } = await import("./version.js");
  console.log(`
  warp-mcp v${VERSION} — MCP server for the Ringer WARP platform

  Usage:
    warp-mcp setup    Interactive setup wizard
    warp-mcp          MCP server (stdio) — used by MCP clients

  Run 'warp-mcp setup' to configure your API key and register
  with your MCP clients (Claude, Cursor, Copilot, Codex, ChatGPT).
`);
} else {
  // MCP server mode — default when spawned by an MCP client
  const { StdioServerTransport } = await import(
    "@modelcontextprotocol/sdk/server/stdio.js"
  );
  const { WarpClient } = await import("./client.js");
  const { loadConfig } = await import("./config.js");
  const { createServer } = await import("./server.js");

  const client = new WarpClient(loadConfig());
  const server = createServer(client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
