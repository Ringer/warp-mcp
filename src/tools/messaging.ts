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

const page = z
  .number()
  .int()
  .optional()
  .describe("Page number, 1-based (default 1)");

const perPage = z
  .number()
  .int()
  .optional()
  .describe("Page size (default 20, max 100)");

const brandId = z
  .string()
  .describe("Brand ID (messaging-backend UUID, as returned by msg_list_brands / msg_create_brand)");

const campaignId = z
  .string()
  .describe("Campaign ID (messaging-backend UUID, as returned by msg_list_campaigns / msg_create_campaign)");

// TCR brand fields (snake_case, proxied to the TCR brand model). Shared by
// msg_create_brand (POST) and msg_update_brand (PUT full replace).
const brandBodyShape = {
  entity_type: z
    .enum([
      "PRIVATE_PROFIT",
      "PUBLIC_PROFIT",
      "NON_PROFIT",
      "GOVERNMENT",
      "SOLE_PROPRIETOR",
    ])
    .optional()
    .describe(
      "Brand entity type (see msg_list_entity_types for the valid list), e.g. PRIVATE_PROFIT"
    ),
  display_name: z
    .string()
    .optional()
    .describe('Brand display/marketing name, e.g. "Acme Coffee"'),
  company_name: z
    .string()
    .optional()
    .describe(
      'Legal company name as registered, e.g. "Acme Coffee LLC". Required for non-SOLE_PROPRIETOR entity types.'
    ),
  ein: z
    .string()
    .optional()
    .describe(
      'Tax ID / EIN, e.g. "12-3456789" (US). Required for company registrations; improves trust score.'
    ),
  ein_issuing_country: z
    .string()
    .optional()
    .describe('EIN issuing country as 2-letter ISO code, e.g. "US"'),
  first_name: z
    .string()
    .optional()
    .describe("Contact first name (required for SOLE_PROPRIETOR)"),
  last_name: z
    .string()
    .optional()
    .describe("Contact last name (required for SOLE_PROPRIETOR)"),
  phone: z
    .string()
    .optional()
    .describe('Support/contact phone in E.164 format, e.g. "+13035551212"'),
  mobile_phone: z
    .string()
    .optional()
    .describe('Mobile phone in E.164 format (used for SOLE_PROPRIETOR OTP verification)'),
  email: z.string().optional().describe("Brand contact email address"),
  street: z.string().optional().describe('Street address, e.g. "123 Main St"'),
  city: z.string().optional().describe('City, e.g. "Denver"'),
  state: z.string().optional().describe('State/region code, e.g. "CO"'),
  postal_code: z.string().optional().describe('Postal/ZIP code, e.g. "80202"'),
  country: z
    .string()
    .optional()
    .describe('Country as 2-letter ISO code, e.g. "US"'),
  website: z
    .string()
    .optional()
    .describe('Brand website URL, e.g. "https://acme.example.com"'),
  vertical: z
    .string()
    .optional()
    .describe(
      "Industry vertical code (see msg_list_verticals for the valid list), e.g. RETAIL"
    ),
  stock_symbol: z
    .string()
    .optional()
    .describe("Stock ticker symbol (PUBLIC_PROFIT brands only)"),
  stock_exchange: z
    .string()
    .optional()
    .describe("Stock exchange, e.g. NASDAQ, NYSE (PUBLIC_PROFIT brands only)"),
  alt_business_id: z
    .string()
    .optional()
    .describe("Alternate business identifier, e.g. DUNS number"),
  alt_business_id_type: z
    .string()
    .optional()
    .describe("Type of the alternate business ID, e.g. DUNS, LEI, GIIN"),
  reference_id: z
    .string()
    .optional()
    .describe("Your own free-form reference ID for this brand"),
};

// TCR campaign fields (snake_case, proxied to the TCR campaign model). Shared
// by msg_create_campaign (POST) and msg_update_campaign (PUT).
const campaignBodyShape = {
  brand_id: z
    .string()
    .optional()
    .describe(
      "Parent brand ID (messaging-backend UUID from msg_list_brands). Required when creating a campaign."
    ),
  usecase: z
    .string()
    .optional()
    .describe(
      "Campaign use case code, e.g. MARKETING, 2FA, CUSTOMER_CARE (see msg_list_use_cases; check msg_get_use_case_requirements first)"
    ),
  sub_usecases: z
    .array(z.string())
    .optional()
    .describe("Sub-use-case codes for MIXED/LOW_VOLUME campaigns"),
  description: z
    .string()
    .optional()
    .describe("What this campaign sends and to whom (reviewed by carriers)"),
  message_flow: z
    .string()
    .optional()
    .describe(
      "How subscribers opt in to receive messages (consent flow description; heavily weighted in carrier review)"
    ),
  sample1: z.string().optional().describe("Sample message 1 (representative outbound text)"),
  sample2: z.string().optional().describe("Sample message 2"),
  sample3: z.string().optional().describe("Sample message 3"),
  sample4: z.string().optional().describe("Sample message 4"),
  sample5: z.string().optional().describe("Sample message 5"),
  embedded_link: z
    .boolean()
    .optional()
    .describe("True if messages may contain URLs/links"),
  embedded_phone: z
    .boolean()
    .optional()
    .describe("True if messages may contain phone numbers"),
  number_pool: z
    .boolean()
    .optional()
    .describe("True if the campaign uses 50+ sending numbers (number pooling)"),
  age_gated: z
    .boolean()
    .optional()
    .describe("True if content is age-gated (alcohol, gambling, etc.)"),
  direct_lending: z
    .boolean()
    .optional()
    .describe("True if content relates to direct lending or loan arrangements"),
  subscriber_optin: z
    .boolean()
    .optional()
    .describe("True if subscribers can opt in via keyword"),
  subscriber_optout: z
    .boolean()
    .optional()
    .describe("True if subscribers can opt out via keyword (STOP handling)"),
  subscriber_help: z
    .boolean()
    .optional()
    .describe("True if subscribers can request help via keyword (HELP handling)"),
  optin_keywords: z
    .string()
    .optional()
    .describe('Comma-separated opt-in keywords, e.g. "START,SUBSCRIBE"'),
  optout_keywords: z
    .string()
    .optional()
    .describe('Comma-separated opt-out keywords, e.g. "STOP,UNSUBSCRIBE"'),
  help_keywords: z
    .string()
    .optional()
    .describe('Comma-separated help keywords, e.g. "HELP,INFO"'),
  optin_message: z
    .string()
    .optional()
    .describe("Confirmation message sent after a subscriber opts in"),
  optout_message: z
    .string()
    .optional()
    .describe("Confirmation message sent after a subscriber opts out"),
  help_message: z
    .string()
    .optional()
    .describe("Reply sent when a subscriber texts a help keyword"),
  terms_and_conditions: z
    .boolean()
    .optional()
    .describe("Affirm the campaign complies with carrier terms and conditions"),
  auto_renewal: z
    .boolean()
    .optional()
    .describe("Auto-renew the campaign at TCR each billing cycle"),
  reference_id: z
    .string()
    .optional()
    .describe("Your own free-form reference ID for this campaign"),
};

export function registerMessagingTools(
  server: McpServer,
  client: WarpClient
): void {
  // ---------------------------------------------------------------------
  // Messages (SMS/MMS send + history)
  // ---------------------------------------------------------------------

  server.registerTool(
    "msg_list",
    {
      title: "List messages",
      description:
        "List your SMS/MMS messages (inbound and outbound), most recent first, optionally filtered by direction or delivery status. Use to review message history or check recent delivery outcomes; for a single message use msg_get, for aggregate counts use msg_get_stats. Errors: NO_ACTIVE_CUSTOMER/UNAUTHORIZED (401).",
      inputSchema: {
        page,
        per_page: perPage,
        direction: z
          .enum(["INBOUND", "OUTBOUND"])
          .optional()
          .describe("Filter by message direction"),
        status: z
          .string()
          .optional()
          .describe(
            "Filter by delivery status, e.g. queued, sent, delivered, failed"
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, per_page, direction, status }) =>
      formatResponse(
        await client.get("/v1/messages", { page, per_page, direction, status })
      )
  );

  server.registerTool(
    "msg_send",
    {
      title: "Send an SMS message",
      description:
        "SENDS A REAL SMS TEXT MESSAGE to a real phone number — the recipient's device will receive it immediately; there is no test/sandbox mode, so confirm the destination and body before calling. The `from` number must be assigned to your account AND enrolled in an approved 10DLC campaign (register via msg_create_brand → msg_create_campaign → msg_assign_numbers), otherwise the request is rejected. Errors: INVALID_PAYLOAD/MISSING_PARAM/INVALID_TO (400), NO_ACTIVE_CUSTOMER/UNAUTHORIZED (401), FROM_* rejections for unenrolled numbers.",
      inputSchema: {
        from: z
          .string()
          .describe(
            'Sending telephone number in NANP format, e.g. "13039813633". Must be assigned to your account and enrolled in an approved 10DLC campaign (see msg_list_numbers).'
          ),
        to: z
          .string()
          .describe(
            'Destination telephone number in E.164 / NANP format, e.g. "13125551212". A real device receives the message.'
          ),
        body: z
          .string()
          .describe(
            'Message text, e.g. "Your verification code is 123456". Encoding (GSM-7 vs UCS-2) and segment count are computed automatically.'
          ),
        status_callback: z
          .string()
          .optional()
          .describe(
            'Optional webhook URL that receives message-status callbacks (queued → sent → delivered/failed), e.g. "https://example.com/webhooks/sms"'
          ),
        idempotency_key: z
          .string()
          .optional()
          .describe(
            "Client-supplied Idempotency-Key: retrying with the same key returns the original message instead of sending a duplicate. Strongly recommended."
          ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ from, to, body, status_callback, idempotency_key }) =>
      formatResponse(
        await client.post(
          "/v1/messages",
          { from, to, body, status_callback },
          undefined,
          idempotency_key
            ? { headers: { "Idempotency-Key": idempotency_key } }
            : undefined
        )
      )
  );

  server.registerTool(
    "msg_get",
    {
      title: "Get a message",
      description:
        "Get a single SMS/MMS message by its WARP message UUID, including delivery status. Use after msg_send or msg_list to check one message's details. Errors: INVALID_ID (400), NOT_FOUND (404).",
      inputSchema: {
        id: z
          .string()
          .refine(isValidUuid, "Must be a UUID")
          .describe("WARP message UUID"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) => formatResponse(await client.get(`/v1/messages/${id}`))
  );

  server.registerTool(
    "msg_get_stats",
    {
      title: "Get message statistics",
      description:
        "Get aggregate message counts for your account: overall totals (total, inbound, outbound, delivered, failed) plus a per-campaign breakdown. Use for a quick health check of messaging volume and delivery rates. Errors: NO_ACTIVE_CUSTOMER/UNAUTHORIZED (401).",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/messages/stats"))
  );

  // ---------------------------------------------------------------------
  // 10DLC brands (TCR)
  // ---------------------------------------------------------------------

  server.registerTool(
    "msg_list_brands",
    {
      title: "List 10DLC brands",
      description:
        "List your registered 10DLC brands (snake_case TCR brand objects). A brand is step 1 of the 10DLC flow (create brand → create campaign → assign numbers); use this to find an existing brand before creating campaigns.",
      inputSchema: { page, per_page: perPage },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, per_page }) =>
      formatResponse(
        await client.get("/v1/messaging/brands", { page, per_page })
      )
  );

  server.registerTool(
    "msg_create_brand",
    {
      title: "Create 10DLC brand",
      description:
        "Register a new 10DLC brand with TCR (The Campaign Registry) for your account. This is STEP 1 of the 10DLC flow: create brand → msg_create_campaign → msg_assign_numbers. Check msg_list_entity_types and msg_list_verticals for valid enum values first. Registration may incur TCR fees. Errors: INVALID_PAYLOAD/TNIQ_VALIDATION (400), TNIQ_ERROR (502, upstream TCR failure).",
      inputSchema: brandBodyShape,
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      formatResponse(await client.post("/v1/messaging/brands", args))
  );

  server.registerTool(
    "msg_get_brand",
    {
      title: "Get 10DLC brand",
      description:
        "Get one of your 10DLC brands by its messaging-backend UUID (snake_case TCR brand object, including identity status and trust score). For brands not registered in this account use msg_lookup_brand with the TCR brand ID instead. Errors: NOT_FOUND (404, includes cross-tenant access), TNIQ_ERROR (502).",
      inputSchema: { id: brandId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.get(`/v1/messaging/brands/${id}`))
  );

  server.registerTool(
    "msg_update_brand",
    {
      title: "Update 10DLC brand",
      description:
        "Full replace (PUT) of one of your 10DLC brands — supply the complete brand object, not just changed fields. Use to correct brand identity details, which may trigger TCR re-verification. Errors: INVALID_PAYLOAD (400), NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: { id: brandId, ...brandBodyShape },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ id, ...body }) =>
      formatResponse(await client.put(`/v1/messaging/brands/${id}`, body))
  );

  server.registerTool(
    "msg_delete_brand",
    {
      title: "Delete 10DLC brand",
      description:
        "Permanently delete one of your 10DLC brands from TCR and this account. Campaigns under the brand become unusable — only do this when decommissioning a brand. Errors: NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: { id: brandId },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.delete(`/v1/messaging/brands/${id}`))
  );

  server.registerTool(
    "msg_link_brand",
    {
      title: "Link existing TCR brand",
      description:
        "Link a brand that already exists at TCR (registered elsewhere) into this account, instead of creating a new one with msg_create_brand. Use msg_lookup_brand first to verify the TCR brand ID. Errors: INVALID_PAYLOAD (400), TNIQ_ERROR (502).",
      inputSchema: {
        tcr_brand_id: z
          .string()
          .describe('TCR brand ID to link into this account, e.g. "BABC123"'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ tcr_brand_id }) =>
      formatResponse(
        await client.post("/v1/messaging/brands/link", { tcr_brand_id })
      )
  );

  server.registerTool(
    "msg_lookup_brand",
    {
      title: "Look up TCR brand",
      description:
        "Read brand details directly from TCR by TCR brand ID, without requiring the brand to be registered in this account. Use before msg_link_brand to verify a brand exists. Errors: NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: {
        tcr_brand_id: z.string().describe('TCR brand ID, e.g. "BABC123"'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ tcr_brand_id }) =>
      formatResponse(
        await client.get(`/v1/messaging/brands/lookup/${tcr_brand_id}`)
      )
  );

  // ---------------------------------------------------------------------
  // 10DLC campaigns (TCR)
  // ---------------------------------------------------------------------

  server.registerTool(
    "msg_list_campaigns",
    {
      title: "List 10DLC campaigns",
      description:
        "List your 10DLC campaigns (snake_case TCR campaign objects), optionally filtered by parent brand. A number must be attached to an approved campaign (msg_assign_numbers) before msg_send will accept it as a `from` number.",
      inputSchema: {
        page,
        per_page: perPage,
        brand_id: z
          .string()
          .optional()
          .describe("Filter by parent brand ID (messaging-backend UUID)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ page, per_page, brand_id }) =>
      formatResponse(
        await client.get("/v1/messaging/campaigns", {
          page,
          per_page,
          brand_id,
        })
      )
  );

  server.registerTool(
    "msg_create_campaign",
    {
      title: "Create 10DLC campaign",
      description:
        "Register a new 10DLC campaign under one of your brands. This is STEP 2 of the 10DLC flow: msg_create_brand → create campaign → msg_assign_numbers. Check msg_get_use_case_requirements for the chosen use case first (sample counts, opt-in rules). Carrier review can take days; monitor with msg_get_mno_status. Registration incurs recurring TCR fees. Errors: INVALID_PAYLOAD/TNIQ_VALIDATION (400), TNIQ_ERROR (502).",
      inputSchema: campaignBodyShape,
      annotations: WRITE_ANNOTATIONS,
    },
    async (args) =>
      formatResponse(await client.post("/v1/messaging/campaigns", args))
  );

  server.registerTool(
    "msg_get_campaign",
    {
      title: "Get 10DLC campaign",
      description:
        "Get one of your 10DLC campaigns by its messaging-backend UUID (snake_case TCR campaign object, including registration status). For campaigns not registered in this account use msg_lookup_campaign with the TCR campaign ID. Errors: NOT_FOUND (404, includes cross-tenant access), TNIQ_ERROR (502).",
      inputSchema: { id: campaignId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.get(`/v1/messaging/campaigns/${id}`))
  );

  server.registerTool(
    "msg_update_campaign",
    {
      title: "Update 10DLC campaign",
      description:
        "Update (PUT) one of your 10DLC campaigns — e.g. fix sample messages or opt-in flow after a carrier rejection, then resubmit with msg_resubmit_campaign. Errors: INVALID_PAYLOAD (400), NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: { id: campaignId, ...campaignBodyShape },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ id, ...body }) =>
      formatResponse(await client.put(`/v1/messaging/campaigns/${id}`, body))
  );

  server.registerTool(
    "msg_resubmit_campaign",
    {
      title: "Resubmit 10DLC campaign",
      description:
        "Resubmit a 10DLC campaign for carrier review, typically after fixing rejection reasons with msg_update_campaign. Check current per-carrier status with msg_get_mno_status first. Errors: NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: { id: campaignId },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(
        await client.put(`/v1/messaging/campaigns/${id}/resubmit`)
      )
  );

  server.registerTool(
    "msg_elect_cnp",
    {
      title: "Elect connectivity partner (CNP)",
      description:
        "Elect a Connectivity Partner / DCA for one of your campaigns (required before carriers will pass traffic; see msg_list_dcas for available partners). The body is a free-form object passed through to the messaging backend. Check election/sharing progress with msg_get_sharing_status. Errors: INVALID_PAYLOAD (400), NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: {
        id: campaignId,
        body: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            'Free-form CNP election payload passed through to the messaging backend, e.g. {"cnp_id": "SYNIVERSE"}'
          ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, body }) =>
      formatResponse(
        await client.post(`/v1/messaging/campaigns/${id}/cnp`, body ?? {})
      )
  );

  server.registerTool(
    "msg_nudge_cnp",
    {
      title: "Nudge connectivity partner",
      description:
        "Prompt the elected Connectivity Partner to re-review a campaign that is stuck in review. Use when msg_get_sharing_status shows a pending CNP review for too long. Returns 202 Accepted with no body. Errors: NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: { id: campaignId },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(
        await client.post(`/v1/messaging/campaigns/${id}/nudge`, {})
      )
  );

  server.registerTool(
    "msg_get_mno_status",
    {
      title: "Get campaign MNO status",
      description:
        "Get per-mobile-carrier (MNO) registration status for one of your campaigns — shows whether AT&T, T-Mobile, Verizon, etc. have approved it. Use after msg_create_campaign or msg_resubmit_campaign to track carrier approval. Errors: NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: { id: campaignId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(
        await client.get(`/v1/messaging/campaigns/${id}/mno-status`)
      )
  );

  server.registerTool(
    "msg_get_sharing_status",
    {
      title: "Get campaign sharing status",
      description:
        "Get the connectivity-partner (CNP) sharing status for one of your campaigns — whether the campaign has been shared with and accepted by the elected CNP/DCA. Use after msg_elect_cnp; if stuck, try msg_nudge_cnp. Errors: NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: { id: campaignId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(
        await client.get(`/v1/messaging/campaigns/${id}/sharing`)
      )
  );

  server.registerTool(
    "msg_link_campaign",
    {
      title: "Link existing TCR campaign",
      description:
        "Link a campaign that already exists at TCR (registered elsewhere) into this account, instead of creating a new one with msg_create_campaign. Use msg_lookup_campaign first to verify the TCR campaign ID. Errors: INVALID_PAYLOAD (400), TNIQ_ERROR (502).",
      inputSchema: {
        tcr_campaign_id: z
          .string()
          .describe('TCR campaign ID to link into this account, e.g. "CABC123"'),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ tcr_campaign_id }) =>
      formatResponse(
        await client.post("/v1/messaging/campaigns/link", { tcr_campaign_id })
      )
  );

  server.registerTool(
    "msg_lookup_campaign",
    {
      title: "Look up TCR campaign",
      description:
        "Read campaign details directly from TCR by TCR campaign ID, without requiring the campaign to be registered in this account. Use before msg_link_campaign to verify a campaign exists. Errors: NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: {
        tcr_campaign_id: z
          .string()
          .describe('TCR campaign ID, e.g. "CABC123"'),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ tcr_campaign_id }) =>
      formatResponse(
        await client.get(`/v1/messaging/campaigns/lookup/${tcr_campaign_id}`)
      )
  );

  // ---------------------------------------------------------------------
  // Campaign number assignment
  // ---------------------------------------------------------------------

  server.registerTool(
    "msg_list_campaign_numbers",
    {
      title: "List campaign numbers",
      description:
        "List the telephone numbers attached to one of your 10DLC campaigns. Use to verify which numbers can send under a campaign; for account-wide messaging status of every DID use msg_list_numbers. Errors: NOT_FOUND (404), TNIQ_ERROR (502).",
      inputSchema: {
        id: campaignId,
        page,
        per_page: z
          .number()
          .int()
          .optional()
          .describe("Page size (default 50, max 500)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id, page, per_page }) =>
      formatResponse(
        await client.get(`/v1/messaging/campaigns/${id}/numbers`, {
          page,
          per_page,
        })
      )
  );

  server.registerTool(
    "msg_assign_numbers",
    {
      title: "Attach numbers to campaign",
      description:
        "Attach telephone numbers you own to one of your 10DLC campaigns. This is STEP 3 of the 10DLC flow (msg_create_brand → msg_create_campaign → assign numbers) and is required before msg_send will accept a number as `from`. Returns per-TN assigned/failed lists (failure reasons: not_found, not_owned, lookup_error, write_error); the response is NOT wrapped in the standard envelope. Errors: INVALID_PAYLOAD (400), NOT_FOUND (404, campaign not owned), TNIQ_ERROR (502).",
      inputSchema: {
        id: campaignId,
        phone_numbers: z
          .array(z.string())
          .describe(
            'Telephone numbers to attach, NANP format, e.g. ["13039813633"]'
          ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, phone_numbers }) =>
      formatResponse(
        await client.post(`/v1/messaging/campaigns/${id}/numbers`, {
          phone_numbers,
        })
      )
  );

  server.registerTool(
    "msg_remove_numbers",
    {
      title: "Detach numbers from campaign",
      description:
        "Detach telephone numbers from one of your 10DLC campaigns — those numbers can no longer send SMS until re-attached to an approved campaign. Returns per-TN removed/failed lists (failure reasons: not_found, not_owned, lookup_error, write_error); the response is NOT wrapped in the standard envelope. Errors: INVALID_PAYLOAD (400), NOT_FOUND (404, campaign not owned), TNIQ_ERROR (502).",
      inputSchema: {
        id: campaignId,
        phone_numbers: z
          .array(z.string())
          .describe(
            'Telephone numbers to detach, NANP format, e.g. ["13039813633"]'
          ),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ id, phone_numbers }) =>
      formatResponse(
        await client.delete(`/v1/messaging/campaigns/${id}/numbers`, undefined, {
          phone_numbers,
        })
      )
  );

  server.registerTool(
    "msg_list_numbers",
    {
      title: "List messaging-enabled numbers",
      description:
        "List every active DID you own joined to its messaging association: attached campaign/brand, messaging status, MMS enablement, and whether a per-TN inbound webhook is configured (has_webhook). Use to check which numbers are ready to send with msg_send or still need msg_assign_numbers. Errors: NO_ACTIVE_CUSTOMER/UNAUTHORIZED (401).",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/messaging/numbers"))
  );

  // ---------------------------------------------------------------------
  // 10DLC reference data
  // ---------------------------------------------------------------------

  server.registerTool(
    "msg_list_carriers",
    {
      title: "List mobile carriers (MNOs)",
      description:
        "List the mobile network operators (MNOs) relevant to 10DLC registration (AT&T, T-Mobile, Verizon, etc.). Reference data for interpreting msg_get_mno_status results.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/messaging/carriers"))
  );

  server.registerTool(
    "msg_list_dcas",
    {
      title: "List connectivity partners (DCAs/CNPs)",
      description:
        "List the Direct Connect Aggregators / connectivity partners (CNPs) that WARP elects against (only the common ones, not the full upstream list). Use before msg_elect_cnp to pick a partner.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/messaging/dcas"))
  );

  server.registerTool(
    "msg_list_entity_types",
    {
      title: "List brand entity types",
      description:
        "List the valid 10DLC brand entity types (e.g. PRIVATE_PROFIT, NON_PROFIT). Reference data — check before msg_create_brand.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/messaging/entity-types"))
  );

  server.registerTool(
    "msg_list_use_cases",
    {
      title: "List campaign use cases",
      description:
        "List the valid 10DLC campaign use cases (e.g. MARKETING, 2FA). Reference data — check before msg_create_campaign, then fetch details with msg_get_use_case_requirements.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/messaging/use-cases"))
  );

  server.registerTool(
    "msg_get_use_case_requirements",
    {
      title: "Get use case requirements",
      description:
        "Get the submission requirements for a specific 10DLC campaign use case: required sample-message count, opt-in rules, approval difficulty, and notes. Use before msg_create_campaign to build a compliant submission. Errors: MISSING_PARAM/INVALID_USE_CASE (400).",
      inputSchema: {
        use_case: z
          .string()
          .describe(
            "Use case code from msg_list_use_cases, e.g. MARKETING, 2FA"
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ use_case }) =>
      formatResponse(
        await client.get("/v1/messaging/use-case-requirements", { use_case })
      )
  );

  server.registerTool(
    "msg_list_verticals",
    {
      title: "List industry verticals",
      description:
        "List the valid 10DLC brand industry verticals. Reference data — check before msg_create_brand or msg_update_brand.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/messaging/verticals"))
  );

  server.registerTool(
    "msg_get_throughput_estimate",
    {
      title: "Get throughput estimate",
      description:
        "Estimate messaging throughput (messages/sec, daily cap) and get a recommendation for a brand given its trust score and vetting status. Use after msg_get_brand (which includes the trust score) to understand sending capacity and whether external vetting would help. Errors: MISSING_PARAM/INVALID_PARAM (400).",
      inputSchema: {
        trust_score: z
          .number()
          .int()
          .min(0)
          .max(100)
          .describe("Brand trust score, 0-100 (from the TCR brand object)"),
        vetted: z
          .boolean()
          .optional()
          .describe("Whether the brand is externally vetted"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ trust_score, vetted }) =>
      formatResponse(
        await client.get("/v1/messaging/throughput-estimate", {
          trust_score,
          vetted,
        })
      )
  );
}
