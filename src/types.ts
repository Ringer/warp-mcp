import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WarpClient } from "./client.js";

export type ToolRegistrar = (server: McpServer, client: WarpClient) => void;
