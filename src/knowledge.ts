import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerKnowledge(server: McpServer): void {
  server.prompt(
    "warp-guide",
    "Comprehensive guide to the WARP platform APIs — trunking, numbers, porting, messaging, billing, analytics. Load this before answering WARP domain questions.",
    () => ({
      messages: [
        { role: "user" as const, content: { type: "text" as const, text: WARP_KNOWLEDGE } },
      ],
    })
  );
}

export const WARP_KNOWLEDGE = `# WARP Platform API Knowledge Base

WARP (Wholesale Accounting, Routing and Provisioning) is Ringer's carrier-grade SIP trunking and messaging platform. Through this MCP server you manage a customer account on WARP: SIP trunks, DIDs/toll-free numbers, number porting, SMS/10DLC messaging, billing, and CDR analytics. Base API: \`https://api.warp.ringer.tel\`.

NEVER guess customer UUIDs, trunk IDs, telephone numbers, balances, port statuses, or campaign IDs — always query the API. If you need an identifier you don't have, list the parent resource first or ask the user.

---

## Authentication

- Every tool sends \`Authorization: Bearer rk_...\` using the configured WARP API key (\`WARP_API_TOKEN\` env var, or \`npx warp-mcp setup\`).
- Keys are minted ONLY in the WARP customer portal under **Settings → API Keys**. The API can list, inspect, and audit keys (\`key_\` tools) but it CANNOT create, rotate, or revoke them — direct users to the portal for that.
- Test keys are prefixed \`rk_test_...\`; live keys \`rk_...\`. Key secrets are never returned by any endpoint — listings show only prefixes.
- Each key carries a scope set (e.g. \`team:read\`, \`api_keys:read\`). A 401/403 usually means a missing scope or a revoked key. \`acct_list_scopes\` returns the full scope catalog.
- The key is bound to one customer account. Endpoints like \`/v1/customers/me/...\` operate on that bound customer implicitly; \`NO_ACTIVE_CUSTOMER\` means no active customer is bound to the session/key.

## Response Envelope

Most endpoints wrap responses in a standard envelope:

\`\`\`json
{ "success": true, "data": { ... }, "meta": { "page": 1, "per_page": 50, "total": 213, "total_pages": 5 } }
\`\`\`

Failures:

\`\`\`json
{ "success": false, "error": { "code": "TN_NOT_OWNED", "message": "...", "details": { ... } } }
\`\`\`

- \`error.code\` is a stable machine string (e.g. \`NO_ACTIVE_CUSTOMER\`, \`VALIDATION_ERROR\`, \`TNIQ_ERROR\`, \`CONFLICT\`); \`error.details\` may carry structured context (missing fields, blocked SPID groups, etc.).
- A few endpoints return BARE responses without the envelope: port-out PIN status/set, campaign number attach/detach (per-TN assigned/removed/failed lists), and streamed downloads (CSV export, documents, invoice HTML).
- When HTTP transport itself fails, tools return \`{ _error: true, status, message, body }\` — treat that as an error, not data.
- \`TNIQ_ERROR\` / \`TNIQ_UPSTREAM_ERROR\` / \`GATEWAY_UNAVAILABLE\` mean an upstream provider (TNIQ number inventory, TCR, PDF renderer) failed — usually transient; retry or report, do not "fix" the request.
- Some destructive/sensitive operations (trunk delete/update, credential create/rotate, port submit/cancel/activate, port-out PIN set, LOA generation) require step-up MFA on the session. If such a call is rejected for auth reasons, the user may need to complete the action in the portal.

---

## Tool Group Map

| Prefix | Source | What it covers |
|--------|--------|----------------|
| \`warp_status\` | account.ts | Connectivity/auth sanity check — run first when anything fails |
| \`acct_\` | account.ts | Account capacity (CPS/channel ceilings), prepaid balance, live utilization, scope catalog |
| \`net_\` | account.ts | WARP network facts: ingress SIP servers to point trunks at, vendor/origination IPs to allowlist |
| \`key_\` | account.ts | API key metadata + audit trails (read-only; minting is portal-only) |
| \`cdr_\` | analytics.ts | Call detail records: paginated details, statistics, time-bucketed trends, CSV export, dashboard stats |
| \`bill_\` | billing.ts | Balance snapshot, ledger transactions, invoices (list/get/HTML render) |
| \`trunk_\` | trunks.ts | SIP trunk group CRUD, digest credentials, IP ACLs, dispatcher endpoints, live throttle state |
| \`num_\` | numbers.ts | Number inventory: search, assign/order, voice + SMS config, metadata, release, port-out PIN |
| \`port_\` | porting.ts | Port-in lifecycle: preview, draft, TNs, documents/LOA, submit, progress, activate; on-net transfers; TIN/EIN checks |
| \`msg_\` | messaging.ts | Messages (send/list/get/stats) and 10DLC compliance: brands, campaigns, number attachment, MNO status, reference data |
| \`team_\` | team.ts | Team members, roles, custom role management |

When to reach for each:
- **Account questions** ("what's my capacity / balance / who am I") → \`acct_\`.
- **"What IPs do I configure?"** → \`net_get_ingress_ips\` (where the customer sends SIP) and \`net_get_vendor_ips\` (what the customer must allowlist for traffic FROM WARP).
- **Call quality / volume / "why did my call fail"** → \`cdr_\`.
- **Money** → \`bill_\` (billing balance includes credit limit and suspension flag; \`acct_get_balance\` is the simpler prepaid-only view).
- **Voice connectivity setup** → \`trunk_\` + \`net_\`.
- **Getting numbers** → \`num_\` (new inventory) or \`port_\` (bringing numbers from another carrier).
- **Texting** → \`msg_\` — but 10DLC registration comes before any send.
- **Access control** → \`team_\` (roles/members) and \`key_\` (API keys). Team and key tools take a customer UUID path param — get it from the user's context or key audit, never invent one.

---

## Tool Groups in Detail

### warp_status + acct_ / net_ / key_ — Account, Network, API Keys

- \`warp_status\` — verifies the API is reachable and the key authenticates. Run it FIRST when any other tool errors; it distinguishes "no key configured" from "key rejected" from "API down".
- \`acct_get_capacity\` — the account's capacity ceilings, per number-class × per direction (CPS and channels). Trunk-level capacity must fit under these.
- \`acct_get_utilization\` — aggregate configured capacity vs live concurrent usage across all trunk groups.
- \`acct_get_balance\` — prepaid balance + currency only. POSTPAID accounts always show prepaid_balance=0 here.
- \`acct_list_scopes\` — the full platform scope registry grouped by category (requires \`team:read\`). Use it when building custom roles or diagnosing a FORBIDDEN error.
- \`net_get_ingress_ips\` — the customer-facing SIP edge (UDP/TCP/TLS hosts, IPs, ports) a trunk should be pointed at.
- \`net_get_vendor_ips\` — WARP's egress/origination IPs the customer must allowlist for symmetric SIP signaling. Both net_ tools are static platform facts — safe to call any time.
- \`key_list\` / \`key_get\` — key metadata and scopes (never the secret, only prefixes). \`include_revoked=true\` shows revoked keys too.
- \`key_get_audit\` (one key) / \`key_get_audit_all\` (all keys) — the most recent 100 audit events (create/rotate/revoke/auth activity). Useful for "when was this key last used" and for recovering the customer UUID tied to the current key. All key_ tools require the \`api_keys:read\` scope.

### cdr_ — Analytics

- \`cdr_get_details\` — paginated CDRs (per_page 1–500) with direction/disposition/ani/dni filters. The primary investigation tool.
- \`cdr_get_statistics\` — aggregated metrics for a range (volumes, ASR/ACD-style aggregates).
- \`cdr_get_trends\` — time-bucketed aggregates for charts; granularity hour | day | week (default day). INVALID_GRANULARITY on anything else.
- \`cdr_export_csv\` — streams up to 10,000 rows as a CSV file for humans. Failure responses (before the stream starts) are JSON.
- \`cdr_get_dashboard_stats\` — headline dashboard metrics scoped to the caller's accessible customers.
- Every date-ranged cdr_ tool takes start_date/end_date (YYYY-MM-DD, end inclusive) and \`tz_offset_minutes\`. Errors: INVALID_DATE, CDR_QUERY_FAILED, CDR_EXPORT_FAILED.

### bill_ — Billing

- \`bill_get_balance\` — the full balance snapshot: current balance, credit limit, available, suspension flag, currency. Prefer this over acct_get_balance for "can this account make calls" questions.
- \`bill_list_ledger\` — journal, newest first; limit default 100, valid (0, 500], out-of-range silently ignored.
- \`bill_list_invoices\` — newest period first. \`bill_get_invoice\` — one invoice in full: header, lines, tax lines, payment applications (404 when not owned by this customer).
- \`bill_get_invoice_html\` — branded HTML invoice document. PDF is NOT exposed as a tool (portal-only).

### trunk_ — SIP Trunks

- CRUD: \`trunk_list\` (includes IP ACL entries), \`trunk_get\`, \`trunk_create\`, \`trunk_update\`, \`trunk_delete\` (+ \`trunk_get_cascade_preview\` before delete).
- \`sip_config\` on create/update is free-form JSONB; the customer surface meaningfully writes codecs and dtmf_mode — leave other keys alone.
- Credentials (digest auth): \`trunk_list_credentials\` (enriched with live registration_count and active_call_count; never returns password/HA1), \`trunk_create_credential\`, \`trunk_rotate_credential\`, \`trunk_update_credential\` (enable/disable), \`trunk_delete_credential\` (idempotent, cascades Redis + Kamailio usrloc removal).
- Registrations: \`trunk_list_credential_registrations\` shows live Kamailio usrloc bindings; \`trunk_revoke_registration\` evicts one contact. \`trunk_list_credential_calls\` exists but the dialog-tracking store is not yet live — it currently always returns an empty array; do not conclude "no active calls" from it (use throttle-state counters instead).
- Endpoints: \`trunk_list_endpoints\` / \`trunk_get_endpoint\` / \`trunk_create_endpoint\` / \`trunk_update_endpoint\` / \`trunk_delete_endpoint\`. priority + weight drive failover and load balancing; 207 = saved but Kamailio sync deferred.
- IP ACL: \`trunk_list_ips\` / \`trunk_add_ip_acl\` / \`trunk_update_ip_acl\` (description/enabled) / \`trunk_delete_ip_acl\`.
- \`trunk_get_throttle_state\` — configured caps + live CPS/channel counters (Redis). Null counters + counters_available=false is a read failure, still HTTP 200.

### num_ — Numbers

- \`num_search\` searches UPSTREAM purchasable inventory; the num_ list tool lists numbers the customer already OWNS (filters: status active|held|released|all, type did|tfn, search, voice_configured, sms_configured). Don't confuse the two.
- Held numbers (assigned but not routed) become active by routing them to a trunk (voice config or bulk-route).
- Voice config is where E911 and CNAM live — a number without e911 configured cannot legally carry outbound emergency-capable service; flag it when provisioning voice.
- Per-TN errors: TN_NOT_OWNED (you don't own it), TN_ALREADY_ASSIGNED / TN_UNAVAILABLE (procurement), POI_LOCKED (release blocked), TRUNK_UNOWNED (whole-request 403 when routing to someone else's trunk).

### port_ — Porting

- The port request object is dual-sourced: a WARP mirror row + the live TNIQ project. Reads reconcile them; statistics reads opportunistically refresh the WARP snapshot.
- Documents: list (filter by doc_type or tn), upload (multipart), download (streams raw bytes), delete. LOA generation is per SPID group and supersedes prior LOAs for that group.
- Notes have visibility: customers may only post and see "customer" notes; "internal" is operator-only.
- History = tenant-scoped audit timeline, newest first. Progress/statistics/error-groups are live TNIQ reads.
- Error remediation loop: error-groups → auto-fix (optionally scoped) → revalidate → resubmit.

### msg_ — Messaging and 10DLC

- Message sending/reading: \`msg_send\`, plus list/get/stats. Brand and campaign objects are snake_case TCR objects proxied from the messaging backend.
- Brand tools: list/create/get/update (full PUT replace)/delete, link-by-TCR-ID, lookup-by-TCR-ID (works without the brand being in this account).
- Campaign tools: list (filter by brand_id)/create/get/update/resubmit, CNP election, nudge (202, no body), MNO status, sharing status, number attach/detach/list.
- Reference data (no side effects, safe to call freely): carriers (MNOs), DCAs/CNPs, entity types, use cases, use-case requirements, verticals, throughput estimate. Some are served from a static WARP-maintained fallback when the backend is unavailable.
- Errors: TNIQ_VALIDATION (400 — fix the payload) vs TNIQ_ERROR (502 — upstream failed, retry/report).

### team_ — Team and Roles

- Members: list (alphabetical by email), remove (invalidates their sessions; you cannot remove yourself), set role.
- Roles: list (system + customer-owned), get, create, update, delete, duplicate. System roles are immutable and cannot be deleted; a role still assigned to users cannot be deleted (CONFLICT).
- No privilege escalation: every scope you grant (create/update/duplicate/assign) must be held by the caller — SCOPE_NOT_GRANTABLE otherwise. Superadmin scopes are never grantable.
- Scope-change updates fan out session invalidation to affected users.
- Read ops need \`team:read\`; writes need \`team:write\`.

---

## Workflow 1: Provision a New SIP Trunk

1. \`acct_get_capacity\` — check the account's per-direction CPS/channel ceilings. Trunk creation is rejected if the sum of trunk capacities would exceed account ceilings.
2. \`trunk_create\` — name, \`auth_type\` (\`IP_ACL\` | \`DIGEST\` | \`EITHER\` | \`BOTH\`), per-direction \`capacity_cps_*\` / \`capacity_channels_*\`. A CPS of 0 means "direction disabled" (calls in that direction get 503 + Retry-After).
3. Authentication material, depending on auth_type:
   - IP-based: \`trunk_add_ip_acl\` with the customer's source IP/netmask. Syncs to Kamailio.
   - Digest: \`trunk_create_credential\` with a username. **The plaintext password is returned exactly once** — relay it to the user immediately; it cannot be retrieved later (only rotated via \`trunk_rotate_credential\`, which also returns the new password exactly once).
4. For outbound-from-WARP delivery (DID termination to customer gear): \`trunk_create_endpoint\` with host/port/transport (or raw_uri), priority and weight for failover/load-balancing. A 207 response means the Kamailio sync was deferred — the endpoint is saved but may take a moment to go live.
5. \`net_get_ingress_ips\` — give the user the WARP SIP edge (UDP/TCP/TLS hosts + ports) to point their PBX/SBC at.
6. \`net_get_vendor_ips\` — the user must allowlist these WARP origination IPs in their firewall for symmetric SIP signaling.
7. Verify: \`trunk_get_throttle_state\` (live CPS/channel counters) and, for digest trunks, \`trunk_list_credential_registrations\` to confirm the customer device registered.

Trunk lifecycle cautions:
- Before \`trunk_delete\`, run \`trunk_get_cascade_preview\` — it reports src_ips, routed TNs, live active_calls, and CDR count. Delete is rejected with CONFLICT while calls are live (drain first) or when CDRs reference the trunk (disable instead of delete).
- Disabling a credential (\`trunk_update_credential\` enabled=false) tears down its registrations but does NOT terminate in-progress dialogs.
- \`trunk_update\` silently ignores POI assignment (admin-only field).

## Workflow 2: Acquire and Configure a Number

1. \`num_search\` — search purchasable inventory by NPA/NXX, state, city, rate center, digit pattern, or last-4 prefix. \`type\` defaults to \`did\`; use \`tfn\` for toll-free.
2. \`num_order\` (assign) — procure one TN. Idempotent via an \`Idempotency-Key\` header. For up to 200 TNs at once use the bulk-assign tool: it REQUIRES a UUID Idempotency-Key, and per-TN failures do not abort the batch — always inspect the per-TN results.
3. Voice config — update the number's voice configuration: \`trunk_id\` (which trunk receives inbound calls), \`voice_destination\` / \`voice_failover_destination\`, \`voice_routing_type\`, E911 (\`e911_enabled\` + \`e911_address_id\`), and CNAM (\`cnam_enabled\` + \`cnam_display_name\`). To point many held numbers at one trunk, use the bulk-route tool (up to 200 TNs → one trunk).
4. SMS config — update the number's SMS configuration: inbound webhook URL + secret, fallback URL, MMS toggle. Note: SMS config alone does NOT make the number sendable — it must also be attached to an approved 10DLC campaign (Workflow 4).
5. Housekeeping: update friendly_name/description metadata; release returns a number to inventory (rejected with \`POI_LOCKED\` if the TN is a POI fallback ANI).

Port-out protection: each number can carry a customer-chosen 4–10 digit port-out PIN (set/get/clear via the \`num_\` PIN tools; set/clear require step-up MFA). The PIN status response is bare (\`{ set, locked_until? }\`), not enveloped. This PIN is what authorizes on-net transfers and protects against unauthorized port-outs.

## Workflow 3: Port-In Lifecycle

1. **Preview** (optional but recommended): \`port_\` preview takes a free-form TN list, runs a Telique-backed portability check, and groups TNs by current losing-carrier SPID. No project is created.
2. **Create draft**: \`port_create_request\` (optional name + desired_due_date). This creates a TNIQ project plus a WARP mirror row.
3. **Add TNs**: the add-TNs tool normalises a free-form list and uploads it to the project. Then validate/revalidate to surface errors.
4. **Carrier group details**: for each losing-carrier SPID group, apply account details (account number, BTN, PIN, business name, end-user name, service address). Group membership is recomputed from live TNIQ data — you supply details per SPID, not per TN.
5. **Documents**: \`port_upload_document\` accepts LOA | BILL | CSR | OTHER (max 25MB). Or generate a WARP-branded LOA per SPID group via the LOA tool (requires attestation=true, authorizing party, losing carrier, and signer fields; step-up MFA; valid only pre-submission).
6. **Submit**: the submit tool sends the port to NPAC. Gated on every off-net SPID group having a current LOA — a 409 with \`error.details.reason = "loa_required"\` lists the uncovered groups (\`missing\` or \`stale\`). Step-up MFA required.
7. **Track**: progress (live TNIQ snapshot), statistics, error-groups, history (audit timeline), notes. On validation errors, try auto-fix (optionally scoped to an error group or TN subset) then resubmit — resubmit is only valid from an error/rejection/exception state.
8. **FOC and activation**: once the losing carrier confirms, TNs get a FOC date. Activate manually post-FOC (step-up MFA), or set the auto-activation policy: \`DISABLED\` | \`ASAP\` | \`SCHEDULED\` (scheduled_at required for SCHEDULED). Getting the port request reconciles ACTIVATED TNs into number inventory automatically.
9. **Changes**: supplement (SUP_DDD) changes the desired due date pre-activation; cancel (step-up MFA) is gated on the project being cancellable; a draft with zero submitted TNs can be deleted outright.

**On-net transfers** (both parties on WARP) skip NPAC entirely: the transfer-preview tool reports which TNs are on-net and eligible; the transfer tool executes per-TN, authorized by each number's port-out PIN. Items succeed/fail independently at HTTP 200 — check per-TN reasons (\`invalid_pin\`, \`pin_locked\`, \`poi_locked\`, \`not_in_warp_inventory\`, \`already_yours\`, ...).

**Entity verification** during port-in: the \`port_\` TIN/EIN tools (TinComply) validate EIN format, look up companies by EIN or by name+address, and verify TIN↔company-name matches with the IRS.

## Workflow 4: 10DLC Messaging Setup

US A2P SMS from local numbers legally requires TCR (The Campaign Registry) registration BEFORE sending. Order matters:

1. **Brand**: \`msg_create_brand\` — registers the business identity with TCR (legal name, EIN, entity type, vertical). Use the reference tools for valid entity types and verticals. If the business already has a TCR brand (registered elsewhere), link it by TCR brand ID instead of re-registering, or look it up directly by TCR ID first.
2. **Vetting / throughput**: the brand's trust score drives carrier throughput. The throughput-estimate tool converts a trust score + vetted flag into messages/sec, daily cap, and a recommendation.
3. **Campaign**: \`msg_create_campaign\` under the brand — declares the use case (MARKETING, 2FA, ...), sample messages, and opt-in/opt-out handling. Check the use-case-requirements tool first: sample counts, opt-in rules, and approval difficulty vary by use case.
4. **CNP election and review**: elect a Connectivity Partner (DCA) for the campaign, then track per-carrier approval with the MNO-status tool and CNP sharing status. Use nudge to prompt a stalled CNP re-review; resubmit after fixing a rejected campaign.
5. **Attach numbers**: attach owned TNs to the approved campaign. The attach/detach responses are bare per-TN \`assigned\`/\`removed\`/\`failed\` lists (reasons: not_found, not_owned, lookup_error, write_error) — NOT the standard envelope. The messaging-numbers listing shows every DID with its campaign/brand association, messaging status, MMS flag, and webhook state.
6. **Send**: \`msg_send\` — \`from\` MUST be an account-owned number enrolled in an APPROVED campaign, or the request is rejected. \`to\` in NANP/E.164 (e.g. "13125551212"). Encoding (GSM-7 vs UCS-2) and segment count are computed automatically. Supply an Idempotency-Key to make retries safe (repeat returns the original message with 200 instead of a duplicate 201). \`status_callback\` receives delivery webhooks (queued → sent → delivered/failed).
7. **Monitor**: list/get messages (filter by direction and status) and message stats (totals + per-campaign breakdown).

Inbound SMS is delivered to the per-number inbound webhook configured via the \`num_\` SMS config tools.

## Workflow 5: Investigate Call Issues (CDR)

1. Start wide: \`cdr_get_statistics\` for the date range — totals, ASR/ACD-style aggregates. Then \`cdr_get_trends\` (granularity hour | day | week) to see WHEN a problem started.
2. Drill down: \`cdr_get_details\` with filters — \`direction\` (inbound | outbound), \`disposition\`, \`ani\`, \`dni\`. Paginated (per_page up to 500).
3. **Always pass \`tz_offset_minutes\`** on every cdr_ query — it is the operator's timezone offset in the JavaScript \`getTimezoneOffset()\` convention (minutes to ADD to local time to reach UTC: US Mountain DST = 360, US Eastern DST = 240, UTC = 0). Omitting it silently shifts day boundaries and produces wrong daily totals.
4. Dates are \`YYYY-MM-DD\` and \`end_date\` is INCLUSIVE.
5. Correlate with trunk state: \`trunk_get_throttle_state\` shows configured caps vs live CPS/channel counters — rejected calls with 503s often mean a capacity cap (including cps=0 "direction disabled"). \`acct_get_utilization\` gives the account-wide view. \`counters_available: false\` means live counters could not be read (Redis) — the null counters are unknown, not zero.
6. \`cdr_export_csv\` is for handing raw data to a human (streams up to 10,000 rows as CSV). For analysis you do yourself, use \`cdr_get_details\`/\`cdr_get_statistics\` — never parse the CSV when a structured endpoint answers the question.

## Workflow 6: Billing Reconciliation

1. \`bill_get_balance\` — current balance, credit limit, available credit, suspension flag, currency. (\`acct_get_balance\` is the prepaid-only variant; POSTPAID customers show prepaid_balance=0 there — that is not "zero money", it means the account is postpaid.)
2. \`bill_list_ledger\` — the journal, most recent first. \`limit\` defaults to 100, valid range 1–500 (out-of-range values are silently ignored, not errored).
3. \`bill_list_invoices\` → \`bill_get_invoice\` — full invoice detail: header, line items, tax lines, and payment applications. Cross-check invoice lines against ledger entries for the same period.
4. \`bill_get_invoice_html\` renders a branded HTML invoice document (good for presenting to the user). **The PDF rendering endpoint exists in the API (\`GET /v1/invoices/{id}/pdf\`) but is NOT exposed as an MCP tool** (binary stream; also 503s when the render service is unconfigured) — for a PDF, direct the user to the portal or the HTML render.
5. Usage-side check: \`cdr_get_statistics\` for the invoice period should be consistent with usage charges on the invoice.

---

## REST Paths for Direct API Access

The MCP tools wrap these HTTP endpoints. Use this table when calling the WARP API directly with \`curl\` or another HTTP client. Base URL: \`https://api.warp.ringer.tel\`. Authentication: \`-H "Authorization: Bearer rk_..."\`.

| Area | Method(s) | Path | Notes |
|------|-----------|------|-------|
| Account | GET | \`/v1/account/capacity\` | Per-class × per-direction ceilings |
| Account | GET | \`/v1/customers/me/balance\` | Prepaid balance |
| Account | GET | \`/v1/customers/me/utilization\` | Live aggregate CPS/channel usage |
| Account | GET | \`/v1/scopes\` | Scope catalog |
| Network | GET | \`/v1/network/ingress-ips\` | WARP SIP edge to point trunks at |
| Network | GET | \`/v1/network/vendor-ips\` | WARP origination IPs to allowlist |
| API keys | GET | \`/v1/customers/{id}/api-keys[/{keyId}]\` | Metadata only, never secrets |
| API keys | GET | \`/v1/customers/{id}/api-keys[/{keyId}]/audit\` | Last 100 audit events |
| CDR | GET | \`/v1/cdr/details\` | Paginated CDRs; tz_offset_minutes! |
| CDR | GET | \`/v1/cdr/statistics\` \`/v1/cdr/trends\` | Aggregates; trends takes granularity |
| CDR | GET | \`/v1/cdr/export\` | CSV stream, max 10k rows |
| CDR | GET | \`/v1/dashboard/stats\` | Headline dashboard metrics |
| Billing | GET | \`/v1/billing/balance\` \`/v1/billing/ledger\` | Snapshot; journal (limit ≤ 500) |
| Billing | GET | \`/v1/invoices[/{id}]\` | List / full invoice detail |
| Billing | GET | \`/v1/invoices/{id}/html\` | Branded HTML render |
| Billing | GET | \`/v1/invoices/{id}/pdf\` | Exists in API; NOT an MCP tool |
| Trunks | GET,POST | \`/v1/trunks\` | List / create |
| Trunks | GET,PUT,DELETE | \`/v1/trunks/{trunk_id}\` | Update/delete need step-up MFA |
| Trunks | GET | \`/v1/trunks/{trunk_id}/cascade-preview\` | Pre-delete impact counts |
| Trunks | GET,POST | \`/v1/trunks/{trunk_id}/credentials\` | Create returns password ONCE |
| Trunks | PATCH,DELETE | \`/v1/trunks/{trunk_id}/credentials/{cred_id}\` | Enable/disable; delete |
| Trunks | POST | \`/v1/trunks/{trunk_id}/credentials/{cred_id}/rotate\` | New password returned once |
| Trunks | GET | \`.../credentials/{cred_id}/registrations\` | Live usrloc bindings |
| Trunks | DELETE | \`.../registrations/{contact_id}\` | Evict one binding |
| Trunks | GET,POST | \`/v1/trunks/{trunk_id}/endpoints\` | Dispatcher endpoints |
| Trunks | GET,PATCH,DELETE | \`/v1/trunks/{trunk_id}/endpoints/{endpoint_id}\` | 207 = Kamailio sync deferred |
| Trunks | GET,POST | \`/v1/trunks/{trunk_id}/ips\` | IP ACL list / add |
| Trunks | PATCH,DELETE | \`/v1/trunks/{trunk_id}/ips/{ip_id}\` | Update / remove ACL entry |
| Trunks | GET | \`/v1/trunks/{trunk_id}/throttle-state\` | Caps + live counters |
| Numbers | GET | \`/v1/numbers\` \`/v1/numbers/search\` | Owned inventory; upstream search |
| Numbers | GET,PATCH | \`/v1/numbers/{tn}\` | Detail; metadata update |
| Numbers | POST | \`/v1/numbers/{tn}/assign\` \`/{tn}/release\` | Procure; return to inventory |
| Numbers | POST | \`/v1/numbers/bulk-assign\` \`/v1/numbers/bulk-route\` | ≤200 TNs; bulk-assign needs UUID Idempotency-Key |
| Numbers | PATCH,DELETE | \`/v1/numbers/{tn}/voice\` \`/{tn}/sms\` | Set / clear usage config |
| Numbers | GET,PUT,DELETE | \`/v1/numbers/{tn}/port-out-pin\` | Bare response (no envelope) |
| Porting | POST | \`/v1/porting/preview\` | Portability check, no project |
| Porting | GET,POST | \`/v1/porting/requests\` | List / create draft |
| Porting | GET,DELETE | \`/v1/porting/requests/{id}\` | Get reconciles ACTIVATED TNs |
| Porting | POST | \`.../{id}/tns\` \`.../{id}/validate\` \`.../{id}/revalidate\` | Add TNs; validation |
| Porting | PUT | \`.../{id}/groups/{spid}/details\` | Losing-carrier details per group |
| Porting | POST | \`.../{id}/groups/{spid}/loa\` | Generate branded LOA PDF |
| Porting | GET,POST | \`.../{id}/documents\` | List / multipart upload (≤25MB) |
| Porting | GET,DELETE | \`.../{id}/documents/{docId}\` | Download streams bytes |
| Porting | POST | \`.../{id}/submit\` \`/cancel\` \`/resubmit\` \`/activate\` | Lifecycle; MFA-gated |
| Porting | POST | \`.../{id}/auto-fix\` \`.../{id}/supplement\` | Fix errors; change DDD |
| Porting | PUT | \`.../{id}/auto-activation\` | DISABLED / ASAP / SCHEDULED |
| Porting | GET | \`.../{id}/progress\` \`/statistics\` \`/error-groups\` \`/history\` \`/notes\` | Tracking reads |
| Porting | POST | \`/v1/porting/transfer[/preview]\` | On-net transfer, PIN-authorized |
| Porting | GET,POST | \`/v1/tincomply/...\` | EIN/TIN lookups + verification |
| Messaging | GET,POST | \`/v1/messages\` | List; send (Idempotency-Key) |
| Messaging | GET | \`/v1/messages/{id}\` \`/v1/messages/stats\` | One message; aggregates |
| Messaging | GET,POST | \`/v1/messaging/brands\` | List / create 10DLC brand |
| Messaging | GET,PUT,DELETE | \`/v1/messaging/brands/{id}\` | TCR brand object (snake_case) |
| Messaging | POST,GET | \`/v1/messaging/brands/link\` \`/lookup/{tcrBrandId}\` | Link / direct TCR lookup |
| Messaging | GET,POST | \`/v1/messaging/campaigns\` | List (brand_id filter) / create |
| Messaging | GET,PUT | \`/v1/messaging/campaigns/{id}\` | Detail / update |
| Messaging | POST | \`.../campaigns/{id}/cnp\` \`/nudge\` | Elect CNP; prompt re-review |
| Messaging | GET | \`.../campaigns/{id}/mno-status\` \`/sharing\` | Per-carrier approval state |
| Messaging | GET,POST,DELETE | \`.../campaigns/{id}/numbers\` | Attach/detach (bare per-TN lists) |
| Messaging | PUT | \`.../campaigns/{id}/resubmit\` | After fixing a rejection |
| Messaging | GET | \`/v1/messaging/{carriers,dcas,entity-types,use-cases,use-case-requirements,verticals,throughput-estimate,numbers}\` | Reference data |
| Team | GET | \`/v1/customers/{id}/members\` \`/roles[/{roleId}]\` | Members; roles |
| Team | PUT,DELETE | \`/v1/customers/{id}/members/{userId}[/role]\` | Assign role; remove member |
| Team | POST,PATCH,DELETE | \`/v1/customers/{id}/roles[/{roleId}][/duplicate]\` | Custom role management |

---

## Key Concepts

| Term | Definition |
|------|-----------|
| **CPS** | Calls Per Second — rate cap on call setup attempts. Enforced per trunk per direction; 0 = direction disabled (503 + Retry-After) |
| **Channels** | Concurrent call cap (a.k.a. sessions/ports), also per trunk per direction |
| **Trunk group** | A WARP SIP trunk: auth method + capacity + IP ACL + credentials + endpoints. The unit calls are routed and throttled by |
| **IP ACL** | Source-IP allowlist authentication for a trunk (vs SIP Digest username/password) |
| **Dispatcher endpoint** | A SIP destination (host/port/transport, priority/weight) WARP delivers inbound calls to for a trunk |
| **DID** | Direct Inward Dial — a standard local telephone number. \`tfn\` = toll-free number |
| **ANI / DNI** | Calling number / called number on a CDR |
| **ASR / ACD** | Answer-Seizure Ratio (answered/attempted) and Average Call Duration — core quality metrics in CDR statistics |
| **NPA / NXX / rate center** | Area code / exchange / local-calling geography — the axes of number search |
| **SPID** | Service Provider ID — identifies a carrier in NPAC; port-in TNs are grouped by losing-carrier SPID |
| **LOA** | Letter of Authorization — signed customer authorization required per off-net SPID group before port submission |
| **CSR / BTN** | Customer Service Record / Billing Telephone Number — losing-carrier account artifacts used in porting |
| **FOC date** | Firm Order Commitment — the date the losing carrier confirms for the port; activation happens on/after FOC |
| **SUP (SUP_DDD)** | Supplement order — changing the desired due date on a pending port |
| **Port-out PIN** | Customer-set 4–10 digit PIN on a TN protecting port-outs and authorizing on-net transfers |
| **POI locked** | Number is a Point-of-Interconnect fallback ANI and cannot be released/transferred |
| **10DLC** | 10-Digit Long Code — the US A2P SMS compliance regime run by TCR |
| **Brand / Campaign** | TCR registrations: brand = the business identity; campaign = a messaging use case under a brand. Numbers attach to campaigns |
| **CNP / DCA** | Connectivity Partner / Direct Connect Aggregator — the upstream a campaign is elected to for carrier delivery |
| **MNO** | Mobile Network Operator — each carrier approves a campaign independently (per-MNO status) |
| **Trust score** | TCR brand score (0–100) that, with vetting, determines messaging throughput caps |
| **CNAM** | Caller ID Name — display name outbound calls present; configured per number |
| **E911** | Emergency-services address registration for a number |
| **Prepaid vs postpaid** | Prepaid draws down a balance; postpaid bills against a credit limit (prepaid_balance shows 0) |
| **Ledger** | The account's transaction journal — every charge, payment, and adjustment |
| **TNIQ** | Ringer's number-inventory/porting/10DLC backend that WARP proxies for num/port/msg operations |
| **Step-up MFA** | Extra verification required on destructive/sensitive operations (deletes, credential ops, port submit, PIN set) |

---

## Common Mistakes to Avoid

1. **Never guess a customer UUID** — \`team_\` and \`key_\` tools need one. Get it from the user or from context (e.g. key audit output); do not fabricate or reuse IDs across accounts.
2. **Never omit \`tz_offset_minutes\` on cdr_ queries** — day boundaries silently shift to the wrong timezone and daily totals will be wrong.
3. **Never send SMS before the 10DLC chain is complete** — number owned → brand registered → campaign APPROVED (check MNO status) → number attached to the campaign. \`msg_send\` rejects unenrolled \`from\` numbers.
4. **Never delete a trunk blind** — run \`trunk_get_cascade_preview\` first; live calls or CDR references cause a CONFLICT. Drain calls, or disable instead of delete.
5. **Never use \`cdr_export_csv\` for analysis** — it is a capped (10k rows) human-download stream. Use \`cdr_get_details\` / \`cdr_get_statistics\` / \`cdr_get_trends\` for anything you need to reason over.
6. **The API cannot mint API keys** — key create/rotate/revoke is portal-only (Settings → API Keys). \`key_\` tools are read/audit only.
7. **Invoice PDF is portal-only** — no PDF tool exists; use \`bill_get_invoice_html\` or send the user to the portal.
8. **Don't lose one-time secrets** — SIP credential passwords (create and rotate) are returned exactly once. Relay them immediately; afterwards only rotation produces a new one.
9. **Don't treat bare responses as envelope failures** — port-out PIN status, campaign number attach/detach, and streamed bodies have no \`success\`/\`data\` wrapper by design.
10. **Don't treat prepaid_balance=0 as "out of money"** on a POSTPAID account — check \`bill_get_balance\` for credit limit and the suspension flag instead.
11. **Don't skip the Idempotency-Key on bulk number assignment** — it is required (UUID) and doubles as the procurement request ID; and always check per-TN results, since batch-level 200 does not mean every TN succeeded.
12. **Don't submit a port with missing/stale LOAs** — the 409's \`error.details.groups\` tells you exactly which SPID groups are uncovered; generate or upload the LOA per group, then submit.
13. **Don't retry validation errors unchanged, and don't rewrite requests on upstream errors** — \`VALIDATION_ERROR\`/\`INVALID_PAYLOAD\` mean fix the payload; \`TNIQ_ERROR\`/\`GATEWAY_UNAVAILABLE\` mean the upstream hiccuped — retry as-is or report.
14. **Don't assume counters: \`counters_available: false\`** in utilization/throttle-state means live counters are unreadable — the nulls are "unknown", not zero.
15. **Remember \`end_date\` is inclusive** on all CDR date ranges.
`;
