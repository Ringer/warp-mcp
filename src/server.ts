import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WarpClient } from "./client.js";
import { registerAccountTools } from "./tools/account.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerBillingTools } from "./tools/billing.js";
import { registerMessagingTools } from "./tools/messaging.js";
import { registerNumberTools } from "./tools/numbers.js";
import { registerPortingTools } from "./tools/porting.js";
import { registerTeamTools } from "./tools/team.js";
import { registerTrunkTools } from "./tools/trunks.js";
import { registerKnowledge, WARP_KNOWLEDGE } from "./knowledge.js";
import { ICONS } from "./icons.js";
import { VERSION } from "./version.js";

export function createServer(client: WarpClient): McpServer {
  const server = new McpServer(
    {
      name: "warp",
      version: VERSION,
      title: "WARP by Ringer",
      description:
        "Ringer WARP platform — SIP trunking, numbers, porting, messaging, billing, and CDR analytics",
      icons: ICONS,
      websiteUrl: "https://warp.ringer.tel",
    },
    {
      instructions: WARP_KNOWLEDGE,
    }
  );

  registerAccountTools(server, client);
  registerAnalyticsTools(server, client);
  registerBillingTools(server, client);
  registerMessagingTools(server, client);
  registerNumberTools(server, client);
  registerPortingTools(server, client);
  registerTeamTools(server, client);
  registerTrunkTools(server, client);
  registerKnowledge(server);

  return server;
}
