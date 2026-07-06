// Library exports for remote MCP servers and other embedding consumers.

// Client + server factory
export { WarpClient } from "./client.js";
export { createServer } from "./server.js";
export type { Config } from "./config.js";

// Tool registrars
export { registerAccountTools } from "./tools/account.js";
export { registerAnalyticsTools } from "./tools/analytics.js";
export { registerBillingTools } from "./tools/billing.js";
export { registerMessagingTools } from "./tools/messaging.js";
export { registerNumberTools } from "./tools/numbers.js";
export { registerPortingTools } from "./tools/porting.js";
export { registerTeamTools } from "./tools/team.js";
export { registerTrunkTools } from "./tools/trunks.js";

// Knowledge / prompts
export { registerKnowledge, WARP_KNOWLEDGE } from "./knowledge.js";

// Metadata
export { ICONS, ICON_LIGHT_DATA_URI, ICON_DARK_DATA_URI } from "./icons.js";
export { VERSION } from "./version.js";

// Annotations
export {
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  IDEMPOTENT_WRITE_ANNOTATIONS,
  DESTRUCTIVE_ANNOTATIONS,
} from "./annotations.js";

// Types
export type { ToolRegistrar } from "./types.js";
