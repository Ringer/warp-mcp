import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WarpClient } from "../client.js";
import { formatResponse } from "../utils/formatting.js";
import { READ_ONLY_ANNOTATIONS } from "../annotations.js";
import { isValidUuid } from "../utils/validation.js";
import { VERSION } from "../version.js";
import { DEFAULT_API_URL } from "../config.js";

const customerId = z
  .string()
  .refine(isValidUuid, "Must be a UUID")
  .describe("Your customer UUID (shown in the WARP portal under Settings)");

export function registerAccountTools(
  server: McpServer,
  client: WarpClient
): void {
  server.registerTool(
    "warp_status",
    {
      title: "WARP MCP status",
      description:
        "Check warp-mcp configuration and API connectivity. Use this first when any other tool returns an auth error, or to confirm the server is set up correctly. Reports the server version, API base URL, whether an API key is configured, and whether the API accepts it.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      const status: Record<string, unknown> = {
        version: VERSION,
        base_url: DEFAULT_API_URL,
        api_key_configured: !client.isAnonymous,
      };
      if (client.isAnonymous) {
        status.note =
          "No API key configured. Run `npx warp-mcp setup` or set WARP_API_TOKEN. Keys are minted in the WARP portal under Settings → API Keys.";
      } else {
        const probe = await client.get("/v1/network/ingress-ips");
        const failed =
          typeof probe === "object" &&
          probe !== null &&
          "_error" in probe;
        status.api_reachable = !failed;
        if (failed) status.probe_result = probe;
      }
      return formatResponse(status);
    }
  );

  server.registerTool(
    "acct_get_capacity",
    {
      title: "Get account capacity",
      description:
        "Get your account's per-class × per-direction CPS (calls-per-second) and channel capacity ceilings. Use when planning traffic loads or diagnosing capacity-related call rejections.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/account/capacity"))
  );

  server.registerTool(
    "acct_get_balance",
    {
      title: "Get prepaid balance",
      description:
        "Get your prepaid balance and currency. Use for a quick balance check; for the full billing snapshot (credit limit, available, suspension flag) use bill_get_balance. POSTPAID customers always see prepaid_balance=0.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/customers/me/balance"))
  );

  server.registerTool(
    "acct_get_utilization",
    {
      title: "Get capacity utilization",
      description:
        "Get your aggregate CPS/channel capacity and current concurrent usage across trunk groups. Use to check how close live traffic is to capacity ceilings. current_* fields are null when live counters cannot be read (counters_available=false).",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () =>
      formatResponse(await client.get("/v1/customers/me/utilization"))
  );

  server.registerTool(
    "acct_list_scopes",
    {
      title: "List permission scope catalog",
      description:
        "List every permission scope in the WARP platform registry, grouped by category. Use when building or editing team roles or API keys to see what scopes exist. Requires the team:read scope.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/scopes"))
  );

  server.registerTool(
    "net_get_ingress_ips",
    {
      title: "Get WARP SIP ingress servers",
      description:
        "Get the customer-facing WARP SIP edge servers (UDP/TCP/TLS hosts, IPs, ports) to point a trunk or PBX at. Use when configuring SIP endpoints or firewall rules toward WARP.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/network/ingress-ips"))
  );

  server.registerTool(
    "net_get_vendor_ips",
    {
      title: "Get WARP origination IPs",
      description:
        "Get the WARP egress/origination IPs you must allowlist in your firewall for symmetric SIP signaling. Use when inbound calls from WARP are being blocked or when setting up a new network edge.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/network/vendor-ips"))
  );

  server.registerTool(
    "key_list",
    {
      title: "List API keys",
      description:
        "List your API keys with their scopes and prefixes (secrets are never returned). Use to audit which keys exist and what they can do. Requires the api_keys:read scope.",
      inputSchema: {
        customer_id: customerId,
        include_revoked: z
          .boolean()
          .optional()
          .describe("Include revoked keys (default false)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ customer_id, include_revoked }) =>
      formatResponse(
        await client.get(`/v1/customers/${customer_id}/api-keys`, {
          include_revoked,
        })
      )
  );

  server.registerTool(
    "key_get",
    {
      title: "Get an API key",
      description:
        "Get one API key's metadata and scopes by key UUID (never the secret). Use to inspect a specific key found via key_list. Requires the api_keys:read scope.",
      inputSchema: {
        customer_id: customerId,
        key_id: z
          .string()
          .refine(isValidUuid, "Must be a UUID")
          .describe("API key UUID"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ customer_id, key_id }) =>
      formatResponse(
        await client.get(`/v1/customers/${customer_id}/api-keys/${key_id}`)
      )
  );

  server.registerTool(
    "key_get_audit",
    {
      title: "Get API key audit trail",
      description:
        "Get the most recent 100 audit events (create/rotate/revoke/auth activity) for one API key. Use when investigating suspicious key usage or verifying rotation history. Requires the api_keys:read scope.",
      inputSchema: {
        customer_id: customerId,
        key_id: z
          .string()
          .refine(isValidUuid, "Must be a UUID")
          .describe("API key UUID"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ customer_id, key_id }) =>
      formatResponse(
        await client.get(
          `/v1/customers/${customer_id}/api-keys/${key_id}/audit`
        )
      )
  );

  server.registerTool(
    "key_get_audit_all",
    {
      title: "Get customer-wide API key audit trail",
      description:
        "Get the most recent 100 audit events across ALL of your API keys. Use for a security review of key activity account-wide; for a single key's history use key_get_audit. Requires the api_keys:read scope.",
      inputSchema: { customer_id: customerId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ customer_id }) =>
      formatResponse(
        await client.get(`/v1/customers/${customer_id}/api-keys/audit`)
      )
  );
}
