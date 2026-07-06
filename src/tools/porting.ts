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
import { isValidUuid, isValidTn } from "../utils/validation.js";

const portRequestId = z
  .string()
  .refine(isValidUuid, "Must be a UUID")
  .describe(
    "Port request UUID (from port_list_requests or port_create_request)"
  );

const tnList = z
  .array(
    z
      .string()
      .refine(isValidTn, "Must be a 10-digit NANP number")
      .describe("10-digit NANP telephone number, e.g. 3035551234")
  )
  .describe("List of 10-digit telephone numbers");

export function registerPortingTools(
  server: McpServer,
  client: WarpClient
): void {
  // ---------------------------------------------------------------------
  // Preview / list / create / get / delete
  // ---------------------------------------------------------------------

  server.registerTool(
    "port_preview",
    {
      title: "Preview a port-in",
      description:
        "Run an instant Telique-backed portability preview for a free-form list of TNs, grouped by current losing-carrier SPID. No project is created — use this BEFORE port_create_request to see which carriers hold the numbers and whether they are portable. For numbers already on-net (WARP-to-WARP), use port_preview_transfer instead. Errors: NO_ACTIVE_CUSTOMER, INVALID_PAYLOAD, VALIDATION_ERROR, GATEWAY_UNAVAILABLE.",
      inputSchema: {
        tns: tnList.describe(
          "Free-form list of 10-digit telephone numbers to check for portability, e.g. [\"3035551234\", \"7205556789\"]"
        ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ tns }) =>
      formatResponse(await client.post("/v1/porting/preview", { tns }))
  );

  server.registerTool(
    "port_list_requests",
    {
      title: "List port-in requests",
      description:
        "List the active customer's port-in requests, most-recent first. Use to find an existing port request's UUID before calling port_get_request or any other per-request tool. Errors: NO_ACTIVE_CUSTOMER, INTERNAL_ERROR.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/porting/requests"))
  );

  server.registerTool(
    "port_create_request",
    {
      title: "Create a port-in draft",
      description:
        "Create a draft port-in request (TNIQ project + WARP mirror row). This is step 1 of the port-in lifecycle: create draft → port_add_tns → port_set_group_details → port_validate_request → port_generate_loa → port_submit_request → track with port_get_progress → port_activate. Run port_preview first to check portability. Errors: NO_ACTIVE_CUSTOMER, INVALID_PAYLOAD, TNIQ_ERROR, INTERNAL_ERROR, GATEWAY_UNAVAILABLE.",
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe("Human-friendly name for the port request"),
        desired_due_date: z
          .string()
          .optional()
          .describe(
            "Desired port due date (FOC date), ISO 8601 date, e.g. 2026-08-01"
          ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ name, desired_due_date }) =>
      formatResponse(
        await client.post("/v1/porting/requests", { name, desired_due_date })
      )
  );

  server.registerTool(
    "port_get_request",
    {
      title: "Get a port-in request",
      description:
        "Get one port-in request: the WARP mirror row, the live TNIQ project, and per-SPID grouped TN details. Also reconciles any ACTIVATED TNs into inventory (idempotent). Use this as the primary status view for a port; for the lighter progress snapshot use port_get_progress. Errors: NO_ACTIVE_CUSTOMER, INVALID_ID, NOT_FOUND, CONFLICT.",
      inputSchema: { id: portRequestId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.get(`/v1/porting/requests/${id}`))
  );

  server.registerTool(
    "port_delete_draft",
    {
      title: "Delete a port-in draft",
      description:
        "Delete a pre-submission draft port request (TNIQ project + WARP mirror row). Only allowed in states with zero submitted TNs — after submission use port_cancel_request instead. Requires step-up MFA. Errors: NOT_FOUND, CONFLICT (already submitted), TNIQ_ERROR, INTERNAL_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.delete(`/v1/porting/requests/${id}`))
  );

  // ---------------------------------------------------------------------
  // TNs, validation, submission, activation lifecycle
  // ---------------------------------------------------------------------

  server.registerTool(
    "port_add_tns",
    {
      title: "Add TNs to a port-in request",
      description:
        "Normalise a free-form TN list and upload it to the draft port request's TNIQ project. Step 2 of the port-in lifecycle, after port_create_request and before port_set_group_details / port_validate_request. Errors: INVALID_PAYLOAD, VALIDATION_ERROR, NOT_FOUND, TNIQ_ERROR.",
      inputSchema: {
        id: portRequestId,
        tns: tnList.describe(
          "Free-form list of 10-digit telephone numbers to add to the port request"
        ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, tns }) =>
      formatResponse(
        await client.post(`/v1/porting/requests/${id}/tns`, { tns })
      )
  );

  server.registerTool(
    "port_validate_request",
    {
      title: "Validate a port-in request",
      description:
        "Trigger a TNIQ-side re-validation of ALL TNs in the port request. Run after adding TNs (port_add_tns) and applying carrier details (port_set_group_details), then inspect failures via port_get_error_groups and fix them with port_auto_fix. To revalidate only a subset of TNs use port_revalidate_tns. Errors: NOT_FOUND, TNIQ_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.post(`/v1/porting/requests/${id}/validate`))
  );

  server.registerTool(
    "port_revalidate_tns",
    {
      title: "Revalidate selected port-in TNs",
      description:
        "Send a REVALIDATE bulk action for selected (or all) TNs in the port request. Use after fixing individual TN errors when you don't need the full re-validation of port_validate_request. Errors: NOT_FOUND, TNIQ_ERROR.",
      inputSchema: {
        id: portRequestId,
        tns: tnList
          .optional()
          .describe(
            "Optional subset of 10-digit TNs to revalidate; omit to revalidate all TNs in the request"
          ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, tns }) =>
      formatResponse(
        await client.post(`/v1/porting/requests/${id}/revalidate`, { tns })
      )
  );

  server.registerTool(
    "port_submit_request",
    {
      title: "Submit a port-in request",
      description:
        "Submit the port to NPAC. Gated on (1) every off-net SPID group having a current LOA (generate one with port_generate_loa or upload with port_upload_document) and (2) the project being submittable (validate first with port_validate_request). Requires step-up MFA. On the LOA gate a 409 CONFLICT is returned whose error.details has reason=\"loa_required\" and groups=[{spid, tn_count, reason: \"missing\"|\"stale\"}]; other 409s carry error.details.reason from the submit blocker. After submitting, track with port_get_progress and port_get_statistics. Errors: NOT_FOUND, CONFLICT, TNIQ_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.post(`/v1/porting/requests/${id}/submit`))
  );

  server.registerTool(
    "port_resubmit_request",
    {
      title: "Resubmit a port-in request",
      description:
        "Resubmit a port that is in an error/rejection/exception state (e.g. after fixing issues with port_auto_fix or port_set_group_details). Only valid from those states — a CONFLICT is returned otherwise. Errors: NOT_FOUND, CONFLICT, TNIQ_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.post(`/v1/porting/requests/${id}/resubmit`))
  );

  server.registerTool(
    "port_activate",
    {
      title: "Activate ported numbers",
      description:
        "Activate numbers that have reached FOC (the final step of the port-in lifecycle). Gated on the project being activatable — check port_get_progress first. Requires step-up MFA. To have this happen automatically instead, use port_set_auto_activation. Errors: NOT_FOUND, CONFLICT (not activatable), TNIQ_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.post(`/v1/porting/requests/${id}/activate`))
  );

  server.registerTool(
    "port_set_auto_activation",
    {
      title: "Set auto-activation policy",
      description:
        "Update the port project's auto-activation mode so numbers activate without a manual port_activate call. Modes: DISABLED (manual only), ASAP (activate as soon as FOC is reached), SCHEDULED (activate at scheduled_at, which is required for that mode). Errors: INVALID_PAYLOAD, NOT_FOUND, TNIQ_ERROR.",
      inputSchema: {
        id: portRequestId,
        mode: z
          .enum(["DISABLED", "ASAP", "SCHEDULED"])
          .describe(
            "Auto-activation mode: DISABLED | ASAP | SCHEDULED (SCHEDULED requires scheduled_at)"
          ),
        scheduled_at: z
          .string()
          .optional()
          .describe(
            "ISO 8601 timestamp for SCHEDULED mode, e.g. 2026-08-01T14:00:00Z; required when mode=SCHEDULED"
          ),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({ id, mode, scheduled_at }) =>
      formatResponse(
        await client.put(`/v1/porting/requests/${id}/auto-activation`, {
          mode,
          scheduled_at,
        })
      )
  );

  server.registerTool(
    "port_cancel_request",
    {
      title: "Cancel a port-in request",
      description:
        "Cancel a submitted port. Gated on the project being cancellable — a CONFLICT is returned otherwise. For unsubmitted drafts use port_delete_draft instead. Requires step-up MFA. Errors: NOT_FOUND, CONFLICT, TNIQ_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.post(`/v1/porting/requests/${id}/cancel`))
  );

  server.registerTool(
    "port_supplement_due_date",
    {
      title: "Supplement the due date",
      description:
        "Change the desired due date of a submitted port (SUP_DDD), optionally for a subset of TNs. Only valid before activation — a CONFLICT is returned otherwise. Errors: INVALID_PAYLOAD, NOT_FOUND, CONFLICT, TNIQ_ERROR.",
      inputSchema: {
        id: portRequestId,
        new_ddd: z
          .string()
          .describe(
            "New desired due date (FOC date), ISO 8601 date, e.g. 2026-08-15"
          ),
        tns: tnList
          .optional()
          .describe(
            "Optional subset of 10-digit TNs to supplement; omit to apply to all TNs"
          ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, new_ddd, tns }) =>
      formatResponse(
        await client.post(`/v1/porting/requests/${id}/supplement`, {
          new_ddd,
          tns,
        })
      )
  );

  // ---------------------------------------------------------------------
  // Errors, auto-fix, carrier-group details
  // ---------------------------------------------------------------------

  server.registerTool(
    "port_get_error_groups",
    {
      title: "Get port-in error groups",
      description:
        "Get the TNIQ validation/port error groups for the project. Use after port_validate_request or a rejected submission to see what's blocking the port, then resolve with port_auto_fix (pass an error_group_id) or port_set_group_details. Errors: NOT_FOUND, TNIQ_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(
        await client.get(`/v1/porting/requests/${id}/error-groups`)
      )
  );

  server.registerTool(
    "port_auto_fix",
    {
      title: "Auto-fix port-in errors",
      description:
        "Apply TNIQ auto-fixes to the project, optionally scoped to one error group (from port_get_error_groups) or a TN subset. After fixing, run port_revalidate_tns or port_resubmit_request as appropriate. Errors: NOT_FOUND, TNIQ_ERROR.",
      inputSchema: {
        id: portRequestId,
        error_group_id: z
          .string()
          .optional()
          .describe(
            "Error group ID (from port_get_error_groups) to scope the fix to"
          ),
        tns: tnList
          .optional()
          .describe(
            "Optional subset of 10-digit TNs to fix; omit to fix all affected TNs"
          ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, error_group_id, tns }) =>
      formatResponse(
        await client.post(`/v1/porting/requests/${id}/auto-fix`, {
          error_group_id,
          tns,
        })
      )
  );

  server.registerTool(
    "port_set_group_details",
    {
      title: "Apply carrier-group details",
      description:
        "Apply losing-carrier account details (account number, BTN, PIN, service address, names) to EVERY TN in one SPID group. Group membership is recomputed from live TNIQ details, not client-supplied. Get SPID groups from port_get_request; run before port_validate_request. Errors: INVALID_PAYLOAD, INVALID_PARAM, NOT_FOUND, TNIQ_ERROR.",
      inputSchema: {
        id: portRequestId,
        spid: z
          .string()
          .describe("Losing-carrier SPID (from port_get_request's SPID groups)"),
        account_number: z
          .string()
          .optional()
          .describe("Account number with the losing carrier"),
        btn: z
          .string()
          .optional()
          .describe("Billing telephone number (10-digit) on the losing account"),
        business_name: z
          .string()
          .optional()
          .describe("Business name on the losing account"),
        end_user_name: z
          .string()
          .optional()
          .describe("End-user name on the losing account"),
        pin: z
          .string()
          .optional()
          .describe("Account PIN/passcode with the losing carrier"),
        service_address: z
          .string()
          .optional()
          .describe("Service address on file with the losing carrier"),
      },
      annotations: IDEMPOTENT_WRITE_ANNOTATIONS,
    },
    async ({
      id,
      spid,
      account_number,
      btn,
      business_name,
      end_user_name,
      pin,
      service_address,
    }) =>
      formatResponse(
        await client.put(
          `/v1/porting/requests/${id}/groups/${spid}/details`,
          {
            account_number,
            btn,
            business_name,
            end_user_name,
            pin,
            service_address,
          }
        )
      )
  );

  server.registerTool(
    "port_generate_loa",
    {
      title: "Generate a Letter of Authorization",
      description:
        "Render a WARP-branded LOA PDF for one off-net SPID group and upload it to the project, superseding prior LOAs for that group. Only valid BEFORE the port is submitted; every off-net group needs a current LOA before port_submit_request will succeed. Requires attestation=true plus all authorizing-party, losing-carrier, and signer fields. Requires step-up MFA. Alternatively upload an existing signed LOA with port_upload_document. Errors: INVALID_PAYLOAD (error.details.fields lists missing fields), INVALID_PARAM, CONFLICT (already submitted), TNIQ_ERROR, INTERNAL_ERROR, GATEWAY_UNAVAILABLE.",
      inputSchema: {
        id: portRequestId,
        spid: z
          .string()
          .describe("Losing-carrier SPID (from port_get_request's SPID groups)"),
        attestation: z
          .boolean()
          .describe(
            "Must be true — attests the signer is authorized to port the numbers"
          ),
        authorizing_party: z
          .object({
            address: z
              .string()
              .optional()
              .describe("Authorizing party's address"),
            company: z
              .string()
              .optional()
              .describe("Authorizing party's company name"),
            contact: z
              .string()
              .optional()
              .describe("Authorizing party's contact (name/phone/email)"),
          })
          .optional()
          .describe("Authorizing party details for the LOA"),
        losing_carrier: z
          .object({
            account_number: z
              .string()
              .optional()
              .describe("Account number with the losing carrier"),
            btn: z
              .string()
              .optional()
              .describe("Billing telephone number on the losing account"),
            name: z
              .string()
              .optional()
              .describe("Losing carrier's name"),
          })
          .optional()
          .describe("Losing-carrier account details for the LOA"),
        signer: z
          .object({
            name: z.string().optional().describe("Signer's full name"),
            title: z.string().optional().describe("Signer's job title"),
          })
          .optional()
          .describe("Signer details for the LOA"),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, spid, attestation, authorizing_party, losing_carrier, signer }) =>
      formatResponse(
        await client.post(`/v1/porting/requests/${id}/groups/${spid}/loa`, {
          attestation,
          authorizing_party,
          losing_carrier,
          signer,
        })
      )
  );

  // ---------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------

  server.registerTool(
    "port_list_documents",
    {
      title: "List port documents",
      description:
        "List the port project's documents (LOAs, bills, CSRs, etc.), optionally filtered by doc_type or TN. signer_ip is present only for operator callers. Use to verify LOA coverage before port_submit_request. Errors: NOT_FOUND, TNIQ_ERROR.",
      inputSchema: {
        id: portRequestId,
        doc_type: z
          .enum(["LOA", "BILL", "CSR", "OTHER"])
          .optional()
          .describe("Filter by document type: LOA | BILL | CSR | OTHER"),
        tn: z
          .string()
          .optional()
          .describe("Filter by 10-digit telephone number"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id, doc_type, tn }) =>
      formatResponse(
        await client.get(`/v1/porting/requests/${id}/documents`, {
          doc_type,
          tn,
        })
      )
  );

  server.registerTool(
    "port_upload_document",
    {
      title: "Upload a port document",
      description:
        "Upload a supporting document (LOA, bill copy, CSR, or other; max 25MB) to the port's TNIQ project from a local file. Use for a customer-signed LOA or supporting evidence; to have WARP generate the LOA instead, use port_generate_loa. Errors: INVALID_PAYLOAD, NOT_FOUND, TNIQ_VALIDATION, TNIQ_ERROR.",
      inputSchema: {
        id: portRequestId,
        doc_type: z
          .enum(["LOA", "BILL", "CSR", "OTHER"])
          .describe("Document type: LOA | BILL | CSR | OTHER"),
        file_path: z
          .string()
          .describe("Absolute path to the local file to upload (max 25MB)"),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, doc_type, file_path }) =>
      formatResponse(
        await client.postForm(
          `/v1/porting/requests/${id}/documents`,
          { doc_type },
          { field: "file", filePath: file_path }
        )
      )
  );

  server.registerTool(
    "port_download_document",
    {
      title: "Download a port document",
      description:
        "Download one port document's raw bytes (Content-Type mirrors the stored document). Get document IDs from port_list_documents. Note: binary content (e.g. PDF) is returned inline and may not be readable as text. Errors (JSON): NOT_FOUND, TNIQ_VALIDATION, TNIQ_ERROR.",
      inputSchema: {
        id: portRequestId,
        doc_id: z.string().describe("Document ID (from port_list_documents)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id, doc_id }) =>
      formatResponse(
        await client.get(`/v1/porting/requests/${id}/documents/${doc_id}`)
      )
  );

  server.registerTool(
    "port_delete_document",
    {
      title: "Delete a port document",
      description:
        "Delete a document from the port project. Get document IDs from port_list_documents. Deleting a group's only current LOA will re-block port_submit_request for that group. Errors: NOT_FOUND, TNIQ_VALIDATION, TNIQ_ERROR.",
      inputSchema: {
        id: portRequestId,
        doc_id: z.string().describe("Document ID (from port_list_documents)"),
      },
      annotations: DESTRUCTIVE_ANNOTATIONS,
    },
    async ({ id, doc_id }) =>
      formatResponse(
        await client.delete(`/v1/porting/requests/${id}/documents/${doc_id}`)
      )
  );

  // ---------------------------------------------------------------------
  // Tracking: progress, statistics, history, notes
  // ---------------------------------------------------------------------

  server.registerTool(
    "port_get_progress",
    {
      title: "Get port-in progress",
      description:
        "Get the live TNIQ progress snapshot for the port project. Use to track a submitted port (per-TN states, FOC readiness) and to check whether it is activatable before port_activate. For aggregate counts use port_get_statistics. Errors: NOT_FOUND, TNIQ_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.get(`/v1/porting/requests/${id}/progress`))
  );

  server.registerTool(
    "port_get_statistics",
    {
      title: "Get port-in statistics",
      description:
        "Get the live TNIQ statistics for the port project (also opportunistically refreshes the WARP snapshot). Use for aggregate TN state counts; for per-TN detail use port_get_progress. Errors: NOT_FOUND, TNIQ_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(
        await client.get(`/v1/porting/requests/${id}/statistics`)
      )
  );

  server.registerTool(
    "port_get_history",
    {
      title: "Get port-in audit history",
      description:
        "Get the audit timeline for the port request (tenant-scoped, newest-first). Use to see who did what and when — submissions, cancels, document uploads, state changes. Errors: NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.get(`/v1/porting/requests/${id}/history`))
  );

  server.registerTool(
    "port_list_notes",
    {
      title: "List port-in notes",
      description:
        "List the port request's notes. Operators also see internal notes; customers see only customer-visibility notes. Add notes with port_add_note. Errors: NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: { id: portRequestId },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) =>
      formatResponse(await client.get(`/v1/porting/requests/${id}/notes`))
  );

  server.registerTool(
    "port_add_note",
    {
      title: "Add a port-in note",
      description:
        "Add a note to the port request. visibility=\"internal\" is operator-only (customers get FORBIDDEN); customers may only post \"customer\" notes. Read notes with port_list_notes. Errors: INVALID_PAYLOAD, FORBIDDEN, NOT_FOUND, INTERNAL_ERROR.",
      inputSchema: {
        id: portRequestId,
        body: z.string().describe("Note text"),
        visibility: z
          .enum(["customer", "internal"])
          .optional()
          .describe(
            "Note visibility: \"customer\" (default; visible to the customer) or \"internal\" (operator-only)"
          ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ id, body, visibility }) =>
      formatResponse(
        await client.post(`/v1/porting/requests/${id}/notes`, {
          body,
          visibility,
        })
      )
  );

  // ---------------------------------------------------------------------
  // On-net transfers
  // ---------------------------------------------------------------------

  server.registerTool(
    "port_preview_transfer",
    {
      title: "Preview an on-net transfer",
      description:
        "For a free-form TN list, report which numbers are on-net (an active WARP assignment) and eligible for on-net transfer between WARP tenants (no NPAC port needed). The owning customer's BAN is masked. Per-TN ineligibility reasons: not_in_warp_inventory, already_yours, poi_locked, lookup_failed. Use before port_execute_transfer; for off-net numbers use port_preview instead. Errors: NO_ACTIVE_CUSTOMER, INVALID_PAYLOAD, VALIDATION_ERROR.",
      inputSchema: {
        tns: tnList.describe(
          "Free-form list of 10-digit telephone numbers to check for on-net transfer eligibility"
        ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ tns }) =>
      formatResponse(
        await client.post("/v1/porting/transfer/preview", { tns })
      )
  );

  server.registerTool(
    "port_execute_transfer",
    {
      title: "Execute an on-net transfer",
      description:
        "Transfer on-net numbers between WARP tenants without an NPAC port. Each item authorizes with the current owner's port-out PIN; items succeed or fail INDEPENDENTLY within an HTTP 200 response — check per-TN results. Per-TN failure reasons: not_in_warp_inventory, already_yours, poi_locked, invalid_pin, pin_locked, lookup_failed, transfer_failed, invalid_tn. Preview eligibility first with port_preview_transfer. Requires step-up MFA. Errors: NO_ACTIVE_CUSTOMER, INVALID_PAYLOAD.",
      inputSchema: {
        items: z
          .array(
            z.object({
              tn: z
                .string()
                .refine(isValidTn, "Must be a 10-digit NANP number")
                .describe("10-digit telephone number to transfer"),
              pin: z
                .string()
                .describe("Current owner's port-out PIN authorizing this TN"),
            })
          )
          .describe(
            "Numbers to transfer, each with the owning tenant's port-out PIN"
          ),
      },
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ items }) =>
      formatResponse(await client.post("/v1/porting/transfer", { items }))
  );

  // ---------------------------------------------------------------------
  // TinComply entity verification (used during the port-in flow)
  // ---------------------------------------------------------------------

  server.registerTool(
    "port_lookup_company_details",
    {
      title: "Lookup company details by name and address",
      description:
        "Retrieve detailed company information from TinComply by company name and optional address. Used during the port-in flow for entity verification (e.g. before drafting an LOA). See also port_lookup_ein (by EIN) and port_verify_tin_name (TIN/name match). Errors: INVALID_REQUEST, COMPANY_NAME_REQUIRED, TINCOMPLY_ERROR, LOOKUP_FAILED.",
      inputSchema: {
        company_name: z.string().describe("Legal company name to look up"),
        street: z.string().optional().describe("Street address"),
        city: z.string().optional().describe("City"),
        state: z
          .string()
          .optional()
          .describe("State, 2-letter code, e.g. CO"),
        zip_code: z.string().optional().describe("ZIP code, e.g. 80202"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ company_name, street, city, state, zip_code }) =>
      formatResponse(
        await client.post("/v1/tincomply/lookup-company-details", {
          company_name,
          street,
          city,
          state,
          zip_code,
        })
      )
  );

  server.registerTool(
    "port_lookup_ein",
    {
      title: "Lookup company by EIN",
      description:
        "Retrieve company information from TinComply by EIN/Tax ID. Used during the port-in flow for entity verification. Validate the format first with port_validate_ein_format if unsure. Errors: EIN_REQUIRED, INVALID_EIN, TINCOMPLY_ERROR, LOOKUP_FAILED.",
      inputSchema: {
        ein: z
          .string()
          .describe(
            "EIN/Tax ID, 9 digits with or without hyphen, e.g. 12-3456789 or 123456789"
          ),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ ein }) =>
      formatResponse(await client.get("/v1/tincomply/lookup-ein", { ein }))
  );

  server.registerTool(
    "port_validate_ein_format",
    {
      title: "Validate EIN format",
      description:
        "Check whether an EIN is well-formed (9 digits) WITHOUT calling the external TinComply API. Use as a cheap pre-check before port_lookup_ein or port_verify_tin_name. Errors: EIN_REQUIRED.",
      inputSchema: {
        ein: z.string().describe("EIN to validate, e.g. 12-3456789"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ ein }) =>
      formatResponse(
        await client.get("/v1/tincomply/validate-ein-format", { ein })
      )
  );

  server.registerTool(
    "port_verify_tin_name",
    {
      title: "Verify TIN and company name match",
      description:
        "Verify that a TIN matches the provided company name via IRS TIN-Name matching. Used during the port-in flow to confirm the authorizing entity before submission. See also port_lookup_ein and port_lookup_company_details. Errors: INVALID_REQUEST, INVALID_TIN, COMPANY_NAME_REQUIRED, TINCOMPLY_ERROR, VERIFICATION_FAILED.",
      inputSchema: {
        tin: z
          .string()
          .describe("TIN/EIN to verify, 9 digits, e.g. 123456789"),
        company_name: z
          .string()
          .describe("Legal company name to match against the TIN"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ tin, company_name }) =>
      formatResponse(
        await client.post("/v1/tincomply/verify-tin-name", {
          tin,
          company_name,
        })
      )
  );
}
