import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WarpClient } from "../client.js";
import { formatResponse } from "../utils/formatting.js";
import { READ_ONLY_ANNOTATIONS } from "../annotations.js";

export function registerBillingTools(
  server: McpServer,
  client: WarpClient
): void {
  server.registerTool(
    "bill_get_balance",
    {
      title: "Get billing balance snapshot",
      description:
        "Get your full billing balance snapshot: current balance, credit limit, available credit, suspension flag, and currency. Use for billing questions; for just the prepaid number use acct_get_balance.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/billing/balance"))
  );

  server.registerTool(
    "bill_list_ledger",
    {
      title: "List ledger transactions",
      description:
        "List your billing ledger journal entries, most recent first. Use to trace payments, charges, and adjustments — e.g. 'why did my balance drop yesterday'.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Max rows to return (1-500, default 100)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ limit }) =>
      formatResponse(await client.get("/v1/billing/ledger", { limit }))
  );

  server.registerTool(
    "bill_list_invoices",
    {
      title: "List invoices",
      description:
        "List your invoices, newest billing period first. Use to find an invoice id before fetching details with bill_get_invoice.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/invoices"))
  );

  server.registerTool(
    "bill_get_invoice",
    {
      title: "Get an invoice",
      description:
        "Get one invoice in full: header, line items, tax lines, and payment applications. Use after finding the invoice id via bill_list_invoices. Returns 404 for invoices not owned by you.",
      inputSchema: {
        invoice_id: z.string().describe("Invoice id (from bill_list_invoices)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ invoice_id }) =>
      formatResponse(await client.get(`/v1/invoices/${invoice_id}`))
  );

  server.registerTool(
    "bill_get_invoice_html",
    {
      title: "Render invoice as HTML",
      description:
        "Render one invoice as a branded HTML document (returned as text). Use when the user wants a presentable invoice document; for structured data use bill_get_invoice. A PDF variant exists at GET /v1/invoices/{id}/pdf but is binary — direct users to the portal for PDF downloads.",
      inputSchema: {
        invoice_id: z.string().describe("Invoice id (from bill_list_invoices)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ invoice_id }) =>
      formatResponse(await client.get(`/v1/invoices/${invoice_id}/html`))
  );
}
