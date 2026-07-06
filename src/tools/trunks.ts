import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WarpClient } from "../client.js";
import { formatResponse } from "../utils/formatting.js";
import {
  READ_ONLY_ANNOTATIONS,
  WRITE_ANNOTATIONS,
  IDEMPOTENT_WRITE_ANNOTATIONS,
  DESTRUCTIVE_ANNOTATIONS,
} from "../annotations.js";
import { isValidUuid } from "../utils/validation.js";

const trunkId = z
  .string()
  .refine(isValidUuid, "Must be a UUID")
  .describe("Trunk group UUID (find it with trunk_list)");

const credId = z
  .string()
  .refine(isValidUuid, "Must be a UUID")
  .describe("SIP credential UUID (find it with trunk_list_credentials)");

const ipId = z
  .string()
  .refine(isValidUuid, "Must be a UUID")
  .describe("IP ACL entry UUID (find it with trunk_list_ips)");

const endpointId = z
  .number()
  .int()
  .describe("Endpoint ID (integer, find it with trunk_list_endpoints)");

const sipConfig = z
  .record(z.string(), z.unknown())
  .optional()
  .describe(
    "SIP config object persisted as JSONB (e.g. { codecs: [...], dtmf_mode: '...' }). The customer portal only writes codecs and dtmf_mode; other keys are admin-surface."
  );

// Shared endpoint body fields (POST and PATCH use the same shape).
const endpointBodyShape = {
  host: z
    .string()
    .optional()
    .describe(
      "SIP destination hostname or IP (structured form; mutually alternative to raw_uri)"
    ),
  port: z
    .number()
    .int()
    .optional()
    .describe("SIP destination port (e.g. 5060)"),
  transport: z
    .enum(["UDP", "TCP", "TLS"])
    .optional()
    .describe("SIP transport protocol"),
  raw_uri: z
    .string()
    .optional()
    .describe(
      "Raw SIP URI (alternative to structured host/port/transport, e.g. sip:pbx.example.com:5061;transport=tls)"
    ),
  priority: z
    .number()
    .int()
    .optional()
    .describe("Failover priority (lower is tried first)"),
  weight: z
    .number()
    .int()
    .optional()
    .describe("Load-balancing weight among endpoints of the same priority"),
  enabled: z
    .boolean()
    .optional()
    .describe("Whether the endpoint is active in the dispatcher"),
  description: z
    .string()
    .optional()
    .describe("Free-text label for the endpoint"),
};

export function registerTrunkTools(
  server: McpServer,
  client: WarpClient
): void {
  server.registerTool(
    "trunk_list",
    {
      title: "List my trunks",
      description:
        "List all of your trunk groups, each with its IP ACL entries. Use this first to find a trunk_id for the other trunk_* tools. Errors: UNAUTHORIZED, INTERNAL_ERROR.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/trunks"))
  );

  server.registerTool(
    "trunk_get",
    {
      title: "Get a trunk",
      description:
        "Get one trunk group you own, including its IP ACL entries. Use trunk_list first to find the trunk id. Errors: UNAUTHORIZED, INVALID_ID, NOT_FOUND.",
      inputSchema: { trunk_id: trunkId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ trunk_id }) =>
      formatResponse(await client.get(`/v1/trunks/${trunk_id}`))
  );

  server.registerTool(
    "trunk_create",
    {
      title: "Create a trunk",
      description:
        "Create a new trunk group on your account. Enforces your account's allowed number-classes and per-direction capacity ceilings (check acct_get_capacity first). Note: a capacity of 0 means 'direction disabled' — calls in that direction are rejected with 503 + Retry-After. Errors: NO_ACTIVE_CUSTOMER, INVALID_PAYLOAD, VALIDATION_ERROR, INTERNAL_ERROR.",
      inputSchema: {
        name: z.string().describe("Trunk name (required)"),
        auth_type: z
          .enum(["IP_ACL", "DIGEST", "EITHER", "BOTH"])
          .describe(
            "Authentication mode: IP_ACL (source-IP allowlist), DIGEST (SIP username/password), EITHER, or BOTH"
          ),
        description: z
          .string()
          .optional()
          .describe("Free-text description of the trunk"),
        allowed_number_classes: z
          .array(z.string())
          .optional()
          .describe(
            "Number classes this trunk may carry (must be within the account's allowed classes)"
          ),
        capacity_channels_inbound: z
          .number()
          .int()
          .optional()
          .describe("Max concurrent inbound channels; 0 disables inbound"),
        capacity_channels_outbound: z
          .number()
          .int()
          .optional()
          .describe("Max concurrent outbound channels; 0 disables outbound"),
        capacity_cps_inbound: z
          .number()
          .int()
          .optional()
          .describe(
            "Max inbound calls-per-second. 0 is valid and means the direction is disabled (runtime gate returns 503 + Retry-After)"
          ),
        capacity_cps_outbound: z
          .number()
          .int()
          .optional()
          .describe("Max outbound calls-per-second; 0 disables outbound"),
        sip_config: sipConfig,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({
      name,
      auth_type,
      description,
      allowed_number_classes,
      capacity_channels_inbound,
      capacity_channels_outbound,
      capacity_cps_inbound,
      capacity_cps_outbound,
      sip_config,
    }) =>
      formatResponse(
        await client.post("/v1/trunks", {
          name,
          auth_type,
          description,
          allowed_number_classes,
          capacity_channels_inbound,
          capacity_channels_outbound,
          capacity_cps_inbound,
          capacity_cps_outbound,
          sip_config,
        })
      )
  );

  server.registerTool(
    "trunk_update",
    {
      title: "Update a trunk",
      description:
        "Update an owned trunk's settings (name, auth type, capacities, SIP config). The trunk being updated is excluded from the account capacity-sum check. POI assignment is silently ignored (admin-only). Step-up MFA required. Use trunk_list first to find the trunk id. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INVALID_PAYLOAD, VALIDATION_ERROR, INTERNAL_ERROR.",
      inputSchema: {
        trunk_id: trunkId,
        name: z.string().optional().describe("Trunk name"),
        auth_type: z
          .enum(["IP_ACL", "DIGEST", "EITHER", "BOTH"])
          .optional()
          .describe(
            "Authentication mode: IP_ACL, DIGEST, EITHER, or BOTH"
          ),
        description: z
          .string()
          .optional()
          .describe("Free-text description of the trunk"),
        allowed_number_classes: z
          .array(z.string())
          .optional()
          .describe("Number classes this trunk may carry"),
        capacity_channels_inbound: z
          .number()
          .int()
          .optional()
          .describe("Max concurrent inbound channels; 0 disables inbound"),
        capacity_channels_outbound: z
          .number()
          .int()
          .optional()
          .describe("Max concurrent outbound channels; 0 disables outbound"),
        capacity_cps_inbound: z
          .number()
          .int()
          .optional()
          .describe(
            "Max inbound calls-per-second; 0 disables inbound (503 + Retry-After at runtime)"
          ),
        capacity_cps_outbound: z
          .number()
          .int()
          .optional()
          .describe("Max outbound calls-per-second; 0 disables outbound"),
        sip_config: sipConfig,
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({
      trunk_id,
      name,
      auth_type,
      description,
      allowed_number_classes,
      capacity_channels_inbound,
      capacity_channels_outbound,
      capacity_cps_inbound,
      capacity_cps_outbound,
      sip_config,
    }) =>
      formatResponse(
        await client.put(`/v1/trunks/${trunk_id}`, {
          name,
          auth_type,
          description,
          allowed_number_classes,
          capacity_channels_inbound,
          capacity_channels_outbound,
          capacity_cps_inbound,
          capacity_cps_outbound,
          sip_config,
        })
      )
  );

  server.registerTool(
    "trunk_delete",
    {
      title: "Delete a trunk",
      description:
        "Delete an owned trunk. Rejected with CONFLICT when the trunk has live calls (drain first — check trunk_get_throttle_state) or is referenced by CDRs (disable it via trunk_update instead). Run trunk_get_cascade_preview first to see what will be removed. Step-up MFA required. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, CONFLICT, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ trunk_id }) =>
      formatResponse(await client.delete(`/v1/trunks/${trunk_id}`))
  );

  server.registerTool(
    "trunk_get_cascade_preview",
    {
      title: "Preview trunk deletion cascade",
      description:
        "Get per-trunk cascade-preview counts (src_ips, tns_routed_here, active_calls, cdr_count) for an owned trunk. Use before trunk_delete to see what would be affected; active_calls is read live from Redis. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ trunk_id }) =>
      formatResponse(
        await client.get(`/v1/trunks/${trunk_id}/cascade-preview`)
      )
  );

  server.registerTool(
    "trunk_get_throttle_state",
    {
      title: "Get trunk live throttle state",
      description:
        "Get an owned trunk's configured capacity plus live CPS/channel counters. Use to check current load before draining, deleting, or resizing a trunk. On a Redis read failure the counters are null and counters_available=false (still HTTP 200). Errors: INVALID_ID, NO_ACTIVE_CUSTOMER, NOT_FOUND.",
      inputSchema: { trunk_id: trunkId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ trunk_id }) =>
      formatResponse(await client.get(`/v1/trunks/${trunk_id}/throttle-state`))
  );

  // ---------------------------------------------------------------------
  // SIP Digest credentials
  // ---------------------------------------------------------------------

  server.registerTool(
    "trunk_list_credentials",
    {
      title: "List SIP credentials",
      description:
        "List SIP Digest credentials for an owned trunk (no HA1, no password), each enriched with live registration_count and active_call_count. Use trunk_list first to find the trunk id. Errors: INVALID_ID, NO_ACTIVE_CUSTOMER, TRUNK_UNOWNED, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ trunk_id }) =>
      formatResponse(await client.get(`/v1/trunks/${trunk_id}/credentials`))
  );

  server.registerTool(
    "trunk_create_credential",
    {
      title: "Create a SIP credential",
      description:
        "Create a SIP Digest credential on an owned trunk. The trunk's auth_type must be DIGEST, EITHER, or BOTH (check with trunk_get). The plaintext password is returned exactly once — save it immediately. Step-up MFA required. Errors: INVALID_ID, NO_ACTIVE_CUSTOMER, TRUNK_UNOWNED, VALIDATION_ERROR, INVALID_PAYLOAD, CONFLICT, INTERNAL_ERROR.",
      inputSchema: {
        trunk_id: trunkId,
        username: z
          .string()
          .describe("SIP auth username for the new credential (required)"),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ trunk_id, username }) =>
      formatResponse(
        await client.post(`/v1/trunks/${trunk_id}/credentials`, { username })
      )
  );

  server.registerTool(
    "trunk_update_credential",
    {
      title: "Enable or disable a SIP credential",
      description:
        "Toggle a SIP credential's enabled flag. Disabling drops the Redis HA1 + AOR and tears down active registrations (in-progress dialogs are NOT terminated); enabling restores them. Use trunk_list_credentials first to find the credential id. Step-up MFA required. Errors: INVALID_ID, NO_ACTIVE_CUSTOMER, TRUNK_UNOWNED, INVALID_PAYLOAD, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: {
        trunk_id: trunkId,
        cred_id: credId,
        enabled: z
          .boolean()
          .optional()
          .describe("true to enable the credential, false to disable it"),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ trunk_id, cred_id, enabled }) =>
      formatResponse(
        await client.patch(`/v1/trunks/${trunk_id}/credentials/${cred_id}`, {
          enabled,
        })
      )
  );

  server.registerTool(
    "trunk_delete_credential",
    {
      title: "Delete a SIP credential",
      description:
        "Delete a SIP credential and cascade removal from Redis + Kamailio usrloc. Idempotent (returns 204 when already gone). Use trunk_list_credentials first to find the credential id. Step-up MFA required. Errors: INVALID_ID, NO_ACTIVE_CUSTOMER, TRUNK_UNOWNED, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId, cred_id: credId },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ trunk_id, cred_id }) =>
      formatResponse(
        await client.delete(`/v1/trunks/${trunk_id}/credentials/${cred_id}`)
      )
  );

  server.registerTool(
    "trunk_rotate_credential",
    {
      title: "Rotate a SIP credential's password",
      description:
        "Generate a new password + HA1 for a SIP credential (username and realm unchanged). The old password stops working immediately and the new plaintext password is returned exactly once — save it immediately. Step-up MFA required. Errors: INVALID_ID, NO_ACTIVE_CUSTOMER, TRUNK_UNOWNED, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId, cred_id: credId },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ trunk_id, cred_id }) =>
      formatResponse(
        await client.post(
          `/v1/trunks/${trunk_id}/credentials/${cred_id}/rotate`
        )
      )
  );

  server.registerTool(
    "trunk_list_credential_calls",
    {
      title: "List a credential's active calls",
      description:
        "List active SIP dialogs for a credential's AOR. Note: the dialog-tracking store is not yet live, so this currently returns an empty array. Use trunk_list_credentials first to find the credential id. Errors: INVALID_ID, NO_ACTIVE_CUSTOMER, TRUNK_UNOWNED, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId, cred_id: credId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ trunk_id, cred_id }) =>
      formatResponse(
        await client.get(
          `/v1/trunks/${trunk_id}/credentials/${cred_id}/calls`
        )
      )
  );

  server.registerTool(
    "trunk_list_credential_registrations",
    {
      title: "List a credential's live registrations",
      description:
        "List the current Kamailio usrloc bindings (live SIP registrations) for a credential's AOR. Use to see which devices are registered, or to find a contact_id for trunk_revoke_registration. Errors: INVALID_ID, NO_ACTIVE_CUSTOMER, TRUNK_UNOWNED, NOT_FOUND, GATEWAY_UNAVAILABLE.",
      inputSchema: { trunk_id: trunkId, cred_id: credId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ trunk_id, cred_id }) =>
      formatResponse(
        await client.get(
          `/v1/trunks/${trunk_id}/credentials/${cred_id}/registrations`
        )
      )
  );

  server.registerTool(
    "trunk_revoke_registration",
    {
      title: "Revoke a single SIP registration",
      description:
        "Evict one SIP contact binding from Kamailio usrloc for a credential's AOR. Use trunk_list_credential_registrations first to find the contact_id. Step-up MFA required. Errors: INVALID_ID, MISSING_ID, NO_ACTIVE_CUSTOMER, TRUNK_UNOWNED, NOT_FOUND, GATEWAY_UNAVAILABLE.",
      inputSchema: {
        trunk_id: trunkId,
        cred_id: credId,
        contact_id: z
          .string()
          .describe(
            "usrloc contact ID of the registration binding to revoke (from trunk_list_credential_registrations)"
          ),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ trunk_id, cred_id, contact_id }) =>
      formatResponse(
        await client.delete(
          `/v1/trunks/${trunk_id}/credentials/${cred_id}/registrations/${encodeURIComponent(contact_id)}`
        )
      )
  );

  // ---------------------------------------------------------------------
  // Dispatcher endpoints
  // ---------------------------------------------------------------------

  server.registerTool(
    "trunk_list_endpoints",
    {
      title: "List trunk endpoints",
      description:
        "List the dispatcher endpoints (SIP destinations WARP delivers calls to) for an owned trunk. Use trunk_list first to find the trunk id. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ trunk_id }) =>
      formatResponse(await client.get(`/v1/trunks/${trunk_id}/endpoints`))
  );

  server.registerTool(
    "trunk_get_endpoint",
    {
      title: "Get a trunk endpoint",
      description:
        "Get one dispatcher endpoint on an owned trunk. Use trunk_list_endpoints first to find the endpoint id. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId, endpoint_id: endpointId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ trunk_id, endpoint_id }) =>
      formatResponse(
        await client.get(`/v1/trunks/${trunk_id}/endpoints/${endpoint_id}`)
      )
  );

  server.registerTool(
    "trunk_create_endpoint",
    {
      title: "Create a trunk endpoint",
      description:
        "Add a dispatcher endpoint (SIP destination) to an owned trunk, either as structured host/port/transport or as a raw_uri. Returns HTTP 207 with a warning when the Kamailio sync is deferred. Step-up MFA required. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INVALID_PAYLOAD, VALIDATION_ERROR, INTERNAL_ERROR.",
      inputSchema: {
        trunk_id: trunkId,
        ...endpointBodyShape,
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({
      trunk_id,
      host,
      port,
      transport,
      raw_uri,
      priority,
      weight,
      enabled,
      description,
    }) =>
      formatResponse(
        await client.post(`/v1/trunks/${trunk_id}/endpoints`, {
          host,
          port,
          transport,
          raw_uri,
          priority,
          weight,
          enabled,
          description,
        })
      )
  );

  server.registerTool(
    "trunk_update_endpoint",
    {
      title: "Update a trunk endpoint",
      description:
        "Update a dispatcher endpoint on an owned trunk (structured host/port/transport fields or a raw_uri). Returns HTTP 207 with a warning when the Kamailio sync is deferred. Use trunk_list_endpoints first to find the endpoint id. Step-up MFA required. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INVALID_PAYLOAD, VALIDATION_ERROR, INTERNAL_ERROR.",
      inputSchema: {
        trunk_id: trunkId,
        endpoint_id: endpointId,
        ...endpointBodyShape,
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({
      trunk_id,
      endpoint_id,
      host,
      port,
      transport,
      raw_uri,
      priority,
      weight,
      enabled,
      description,
    }) =>
      formatResponse(
        await client.patch(
          `/v1/trunks/${trunk_id}/endpoints/${endpoint_id}`,
          {
            host,
            port,
            transport,
            raw_uri,
            priority,
            weight,
            enabled,
            description,
          }
        )
      )
  );

  server.registerTool(
    "trunk_delete_endpoint",
    {
      title: "Delete a trunk endpoint",
      description:
        "Remove a dispatcher endpoint from an owned trunk and drop it from Kamailio. Use trunk_list_endpoints first to find the endpoint id. Step-up MFA required. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId, endpoint_id: endpointId },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ trunk_id, endpoint_id }) =>
      formatResponse(
        await client.delete(`/v1/trunks/${trunk_id}/endpoints/${endpoint_id}`)
      )
  );

  // ---------------------------------------------------------------------
  // IP ACL entries
  // ---------------------------------------------------------------------

  server.registerTool(
    "trunk_list_ips",
    {
      title: "List trunk IP ACL entries",
      description:
        "List all IP ACL entries for an owned trunk. Use to audit which source IPs may send calls, or to find an ip_id for trunk_update_ip_acl / trunk_delete_ip_acl. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ trunk_id }) =>
      formatResponse(await client.get(`/v1/trunks/${trunk_id}/ips`))
  );

  server.registerTool(
    "trunk_add_ip_acl",
    {
      title: "Add a trunk IP ACL entry",
      description:
        "Add an IP/netmask to an owned trunk's ACL and sync it to Kamailio, allowing that source IP to send calls. The trunk's auth_type should include IP_ACL (IP_ACL, EITHER, or BOTH — check with trunk_get). Step-up MFA required. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INVALID_PAYLOAD, INTERNAL_ERROR.",
      inputSchema: {
        trunk_id: trunkId,
        ip: z
          .string()
          .describe("IPv4 address to allow (e.g. 203.0.113.10)"),
        netmask: z
          .number()
          .int()
          .min(0)
          .max(32)
          .optional()
          .describe("CIDR netmask bits, 0-32 (e.g. 32 for a single host)"),
        description: z
          .string()
          .optional()
          .describe("Free-text label for this ACL entry (e.g. 'HQ PBX')"),
        enabled: z
          .boolean()
          .optional()
          .describe("Whether the entry is active (default true)"),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ trunk_id, ip, netmask, description, enabled }) =>
      formatResponse(
        await client.post(`/v1/trunks/${trunk_id}/ips`, {
          ip,
          netmask,
          description,
          enabled,
        })
      )
  );

  server.registerTool(
    "trunk_update_ip_acl",
    {
      title: "Update a trunk IP ACL entry",
      description:
        "Update the description and/or enabled flag of an owned trunk's IP ACL entry. Use trunk_list_ips first to find the ip_id. Step-up MFA required. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INVALID_PAYLOAD, INTERNAL_ERROR.",
      inputSchema: {
        trunk_id: trunkId,
        ip_id: ipId,
        description: z
          .string()
          .optional()
          .describe("New free-text label for the ACL entry"),
        enabled: z
          .boolean()
          .optional()
          .describe("true to enable the ACL entry, false to disable it"),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ trunk_id, ip_id, description, enabled }) =>
      formatResponse(
        await client.patch(`/v1/trunks/${trunk_id}/ips/${ip_id}`, {
          description,
          enabled,
        })
      )
  );

  server.registerTool(
    "trunk_delete_ip_acl",
    {
      title: "Delete a trunk IP ACL entry",
      description:
        "Remove an IP ACL entry from an owned trunk; that source IP can no longer send calls via IP auth. Use trunk_list_ips first to find the ip_id. Step-up MFA required. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { trunk_id: trunkId, ip_id: ipId },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ trunk_id, ip_id }) =>
      formatResponse(
        await client.delete(`/v1/trunks/${trunk_id}/ips/${ip_id}`)
      )
  );
}
