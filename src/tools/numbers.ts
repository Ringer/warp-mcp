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
import { isValidTn, isValidUuid } from "../utils/validation.js";

// TN path parameter: WARP accepts 10-digit NANP or 11-digit with leading 1.
const tn = z
  .string()
  .refine(
    (v) => isValidTn(v) || /^1\d{10}$/.test(v),
    "Must be a 10-digit NANP telephone number (or 11 digits with leading 1)"
  )
  .describe(
    'Telephone number, 10 digits (e.g. "3035551234") or 11 digits with leading 1'
  );

export function registerNumberTools(
  server: McpServer,
  client: WarpClient
): void {
  server.registerTool(
    "num_list",
    {
      title: "List your numbers",
      description:
        "List the telephone numbers you own, with each number's voice/SMS configuration state. Use to browse or audit your DID/TFN inventory; filter by status, type, search text, or configuration flags. To find NEW purchasable numbers use num_search instead; to inspect one owned number use num_get.",
      inputSchema: {
        page: z
          .number()
          .int()
          .optional()
          .describe("Page number, 1-based (default 1)"),
        size: z
          .number()
          .int()
          .optional()
          .describe("Results per page (default 50)"),
        status: z
          .enum(["active", "held", "released", "all"])
          .optional()
          .describe("Filter by number status"),
        type: z
          .enum(["did", "tfn"])
          .optional()
          .describe("Filter by number type: did (local) or tfn (toll-free)"),
        search: z
          .string()
          .optional()
          .describe("Free-text search on TN digits or metadata"),
        voice_configured: z
          .boolean()
          .optional()
          .describe("Filter to numbers with (true) or without (false) voice configuration"),
        sms_configured: z
          .boolean()
          .optional()
          .describe("Filter to numbers with (true) or without (false) SMS configuration"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, size, status, type, search, voice_configured, sms_configured }) =>
      formatResponse(
        await client.get("/v1/numbers", {
          page,
          size,
          status,
          type,
          search,
          voice_configured,
          sms_configured,
        })
      )
  );

  server.registerTool(
    "num_search",
    {
      title: "Search available numbers",
      description:
        "Search upstream inventory for PURCHASABLE telephone numbers by area code, rate center, locality, or digit pattern. Returns paginated candidates you do not yet own. Use this before ordering; then buy a candidate with num_order (or many with num_bulk_order). For numbers you already own use num_list.",
      inputSchema: {
        type: z
          .enum(["did", "tfn"])
          .optional()
          .describe('Number type: "did" (local, default) or "tfn" (toll-free)'),
        npa: z
          .string()
          .optional()
          .describe('Area code (NPA), 3 digits, e.g. "303"'),
        nxx: z
          .string()
          .optional()
          .describe('Exchange (NXX), 3 digits, e.g. "629"'),
        state: z
          .string()
          .optional()
          .describe('2-letter state code, e.g. "CO"'),
        city: z.string().optional().describe("City name"),
        locality: z.string().optional().describe("Locality name"),
        rate_center: z
          .string()
          .optional()
          .describe('LERG rate center name, e.g. "DENVER"'),
        pattern: z
          .string()
          .optional()
          .describe('Digit pattern to match within the number, e.g. "1234"'),
        last_4_prefix: z
          .string()
          .optional()
          .describe("Prefix the last 4 digits must start with"),
        page: z
          .number()
          .int()
          .optional()
          .describe("Page number, 1-based (default 1)"),
        size: z
          .number()
          .int()
          .optional()
          .describe("Results per page (default 25)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({
      type,
      npa,
      nxx,
      state,
      city,
      locality,
      rate_center,
      pattern,
      last_4_prefix,
      page,
      size,
    }) =>
      formatResponse(
        await client.get("/v1/numbers/search", {
          type,
          npa,
          nxx,
          state,
          city,
          locality,
          rate_center,
          pattern,
          last_4_prefix,
          page,
          size,
        })
      )
  );

  server.registerTool(
    "num_get",
    {
      title: "Get a number",
      description:
        "Get one telephone number you own, including its voice and SMS usage configuration. Use after num_list to inspect a specific TN before updating it with num_update_voice, num_update_sms, or num_update_metadata.",
      inputSchema: { tn },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ tn: tnValue }) =>
      formatResponse(await client.get(`/v1/numbers/${tnValue}`))
  );

  server.registerTool(
    "num_update_metadata",
    {
      title: "Update number metadata",
      description:
        "Update the friendly name and/or description on a number you own. Use to label numbers for humans; for routing/E911/CNAM use num_update_voice, for messaging use num_update_sms. Errors: INVALID_REQUEST, TN_NOT_OWNED.",
      inputSchema: {
        tn,
        friendly_name: z
          .string()
          .optional()
          .describe('Human-friendly label for the number, e.g. "Support line"'),
        description: z
          .string()
          .optional()
          .describe("Longer free-text description of the number's purpose"),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ tn: tnValue, friendly_name, description }) =>
      formatResponse(
        await client.patch(`/v1/numbers/${tnValue}`, {
          friendly_name,
          description,
        })
      )
  );

  server.registerTool(
    "num_order",
    {
      title: "Order (assign) a number",
      description:
        "Procure a telephone number from upstream inventory and assign it to your account. THIS COSTS MONEY — ordering a number incurs purchase and recurring charges, so confirm the TN with the user first. Find candidates with num_search; after ordering, configure it with num_update_voice / num_update_sms. For up to 200 numbers at once use num_bulk_order. Errors: TN_ALREADY_ASSIGNED, TN_UNAVAILABLE, TNIQ_UPSTREAM_ERROR.",
      inputSchema: {
        tn,
        friendly_name: z
          .string()
          .optional()
          .describe("Human-friendly label to set on the new number"),
        description: z
          .string()
          .optional()
          .describe("Free-text description to set on the new number"),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ tn: tnValue, friendly_name, description }) =>
      formatResponse(
        await client.post(`/v1/numbers/${tnValue}/assign`, {
          friendly_name,
          description,
        })
      )
  );

  server.registerTool(
    "num_bulk_order",
    {
      title: "Bulk order (assign) numbers",
      description:
        "Procure and assign up to 200 telephone numbers in one idempotent batch. THIS COSTS MONEY — each number incurs purchase and recurring charges, so confirm the list with the user first. Requires a UUID idempotency key (reused as procurement_request_id); reuse the same key to safely retry. Per-TN failures do not abort the batch. Find candidates with num_search; for a single number use num_order; to route many held numbers to a trunk use num_bulk_route. Errors: INVALID_REQUEST, MISSING_IDEMPOTENCY_KEY, INVALID_IDEMPOTENCY_KEY, TRUNK_UNOWNED (whole-request 403 on default_trunk_id).",
      inputSchema: {
        idempotency_key: z
          .string()
          .refine(isValidUuid, "Must be a UUID")
          .describe(
            "UUID idempotency key for the batch (sent as the Idempotency-Key header; reuse it to retry the same batch safely)"
          ),
        tns: z
          .array(
            z
              .string()
              .describe("Telephone number, 10 digits (or 11 with leading 1)")
          )
          .max(200)
          .describe("Telephone numbers to procure and assign (max 200)"),
        default_trunk_id: z
          .string()
          .optional()
          .describe(
            "Trunk-group UUID to route all assigned numbers to (403 TRUNK_UNOWNED if not yours)"
          ),
        note: z
          .string()
          .optional()
          .describe("Free-text note recorded on the procurement request"),
        tn_metadata: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Metadata applied to every TN in the batch (e.g. friendly_name, description fields)"
          ),
        per_tn_overrides: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Map of TN -> per-number override object, overriding tn_metadata/default_trunk_id for that TN"
          ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({
      idempotency_key,
      tns,
      default_trunk_id,
      note,
      tn_metadata,
      per_tn_overrides,
    }) =>
      formatResponse(
        await client.post(
          "/v1/numbers/bulk-assign",
          {
            tns,
            default_trunk_id,
            note,
            tn_metadata,
            per_tn_overrides,
          },
          undefined,
          { headers: { "Idempotency-Key": idempotency_key } }
        )
      )
  );

  server.registerTool(
    "num_bulk_route",
    {
      title: "Bulk route numbers to a trunk",
      description:
        "Assign up to 200 HELD numbers you already own to a single voice trunk-group in one request (idempotent at the SQL level). Use after num_bulk_order to bring purchased numbers into service, or to re-home existing numbers. For per-number routing details use num_update_voice. Errors: INVALID_REQUEST, TRUNK_UNOWNED (whole-request 403).",
      inputSchema: {
        tns: z
          .array(
            z
              .string()
              .describe("Telephone number, 10 digits (or 11 with leading 1)")
          )
          .max(200)
          .describe("Held telephone numbers to route (max 200)"),
        trunk_id: z
          .string()
          .describe("Voice trunk-group UUID to route all listed numbers to"),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ tns, trunk_id }) =>
      formatResponse(
        await client.post("/v1/numbers/bulk-route", { tns, trunk_id })
      )
  );

  server.registerTool(
    "num_release",
    {
      title: "Release a number",
      description:
        "Release a telephone number you own back to inventory. IRREVERSIBLE from your account's perspective — the number leaves your inventory and may be picked up by others, so confirm with the user first. Errors: TN_NOT_OWNED, POI_LOCKED (number is a POI fallback ANI), TNIQ_UPSTREAM_ERROR.",
      inputSchema: {
        tn,
        reason: z
          .string()
          .optional()
          .describe("Free-text reason for releasing the number (for audit)"),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ tn: tnValue, reason }) =>
      formatResponse(
        await client.post(`/v1/numbers/${tnValue}/release`, { reason })
      )
  );

  server.registerTool(
    "num_update_voice",
    {
      title: "Update voice configuration",
      description:
        "Set or update the voice routing, E911, and CNAM configuration on a number you own. Use after ordering a number (num_order) to bring it into voice service, or to change routing later. To disable voice entirely use num_delete_voice_config; to route many numbers to one trunk use num_bulk_route. Errors: INVALID_REQUEST, TN_NOT_OWNED.",
      inputSchema: {
        tn,
        trunk_id: z
          .string()
          .optional()
          .describe("Voice trunk-group UUID to route inbound calls to"),
        voice_routing_type: z
          .string()
          .optional()
          .describe(
            'Routing type for inbound voice (e.g. "trunk" or a URI-based type per your account setup)'
          ),
        voice_destination: z
          .string()
          .optional()
          .describe("Primary inbound voice destination (e.g. SIP URI or endpoint)"),
        voice_failover_destination: z
          .string()
          .optional()
          .describe("Failover destination used when the primary is unreachable"),
        e911_enabled: z
          .boolean()
          .optional()
          .describe("Enable or disable E911 emergency service on this number"),
        e911_address_id: z
          .string()
          .optional()
          .describe("Validated E911 address record ID to associate with this number"),
        cnam_enabled: z
          .boolean()
          .optional()
          .describe("Enable or disable outbound CNAM (caller name) on this number"),
        cnam_display_name: z
          .string()
          .optional()
          .describe("CNAM display name shown to called parties (typically max 15 chars)"),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({
      tn: tnValue,
      trunk_id,
      voice_routing_type,
      voice_destination,
      voice_failover_destination,
      e911_enabled,
      e911_address_id,
      cnam_enabled,
      cnam_display_name,
    }) =>
      formatResponse(
        await client.patch(`/v1/numbers/${tnValue}/voice`, {
          trunk_id,
          voice_routing_type,
          voice_destination,
          voice_failover_destination,
          e911_enabled,
          e911_address_id,
          cnam_enabled,
          cnam_display_name,
        })
      )
  );

  server.registerTool(
    "num_delete_voice_config",
    {
      title: "Clear voice configuration",
      description:
        "Remove the voice usage row from a number you own, DISABLING voice routing on it (inbound calls will stop routing). To change routing instead of removing it, use num_update_voice. Errors: TN_NOT_OWNED.",
      inputSchema: { tn },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ tn: tnValue }) =>
      formatResponse(await client.delete(`/v1/numbers/${tnValue}/voice`))
  );

  server.registerTool(
    "num_update_sms",
    {
      title: "Update SMS configuration",
      description:
        "Update the customer-owned SMS fields on a number you own: inbound webhook URL/secret, fallback URL, and MMS toggle. Requests containing tniq-owned fields are rejected. To remove SMS entirely use num_delete_sms_config. Errors: INVALID_REQUEST, TN_NOT_OWNED.",
      inputSchema: {
        tn,
        inbound_webhook_url: z
          .string()
          .optional()
          .describe(
            'HTTPS URL that receives inbound SMS webhooks, e.g. "https://example.com/sms"'
          ),
        inbound_webhook_secret: z
          .string()
          .optional()
          .describe("Shared secret used to sign inbound webhook deliveries"),
        fallback_inbound_url: z
          .string()
          .optional()
          .describe("Fallback URL used when the primary inbound webhook fails"),
        mms_enabled: z
          .boolean()
          .optional()
          .describe("Enable or disable MMS on this number"),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({
      tn: tnValue,
      inbound_webhook_url,
      inbound_webhook_secret,
      fallback_inbound_url,
      mms_enabled,
    }) =>
      formatResponse(
        await client.patch(`/v1/numbers/${tnValue}/sms`, {
          inbound_webhook_url,
          inbound_webhook_secret,
          fallback_inbound_url,
          mms_enabled,
        })
      )
  );

  server.registerTool(
    "num_delete_sms_config",
    {
      title: "Clear SMS configuration",
      description:
        "Remove the SMS usage row from a number you own, disabling SMS on it. To change SMS settings instead of removing them, use num_update_sms. Errors: TN_NOT_OWNED.",
      inputSchema: { tn },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ tn: tnValue }) =>
      formatResponse(await client.delete(`/v1/numbers/${tnValue}/sms`))
  );

  server.registerTool(
    "num_get_port_out_pin",
    {
      title: "Get port-out PIN status",
      description:
        "Check whether a port-out PIN is set on a number you own, and if verification attempts locked it out, when the lock expires (locked_until). The PIN itself is never returned. Set a PIN with num_set_port_out_pin; clear it with num_remove_port_out_pin. Errors: TN_NOT_OWNED.",
      inputSchema: { tn },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ tn: tnValue }) =>
      formatResponse(await client.get(`/v1/numbers/${tnValue}/port-out-pin`))
  );

  server.registerTool(
    "num_set_port_out_pin",
    {
      title: "Set port-out PIN",
      description:
        "Set the customer-chosen 4-10 digit port-out PIN on a number you own (hashed at rest; also resets the failed-attempt lock). Requires step-up MFA on the session. Check current state with num_get_port_out_pin; clear with num_remove_port_out_pin. Errors: INVALID_REQUEST, INVALID_PIN, TN_NOT_OWNED.",
      inputSchema: {
        tn,
        pin: z
          .string()
          .regex(/^\d{4,10}$/, "PIN must be 4-10 digits")
          .describe('Port-out PIN, 4-10 digits, e.g. "482913"'),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ tn: tnValue, pin }) =>
      formatResponse(
        await client.put(`/v1/numbers/${tnValue}/port-out-pin`, { pin })
      )
  );

  server.registerTool(
    "num_remove_port_out_pin",
    {
      title: "Clear port-out PIN",
      description:
        "Clear the port-out PIN on a number you own (idempotent), removing PIN protection against port-outs. Requires step-up MFA. Returns 204 No Content on success. Check state with num_get_port_out_pin; set a new PIN with num_set_port_out_pin. Errors: TN_NOT_OWNED.",
      inputSchema: { tn },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ tn: tnValue }) =>
      formatResponse(
        await client.delete(`/v1/numbers/${tnValue}/port-out-pin`)
      )
  );
}
