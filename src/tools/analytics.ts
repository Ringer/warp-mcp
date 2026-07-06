import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WarpClient } from "../client.js";
import { formatResponse } from "../utils/formatting.js";
import { READ_ONLY_ANNOTATIONS } from "../annotations.js";
import { isValidDate } from "../utils/validation.js";

const startDate = z
  .string()
  .refine(isValidDate, "Must be YYYY-MM-DD")
  .optional()
  .describe("Start date (YYYY-MM-DD)");
const endDate = z
  .string()
  .refine(isValidDate, "Must be YYYY-MM-DD")
  .optional()
  .describe("End date (YYYY-MM-DD, inclusive)");
const tzOffset = z
  .number()
  .int()
  .optional()
  .describe(
    "Operator timezone offset in minutes, as returned by JS getTimezoneOffset() (e.g. 420 for US Mountain in summer)"
  );
const direction = z
  .enum(["inbound", "outbound"])
  .optional()
  .describe("Filter by call direction");
const disposition = z
  .string()
  .optional()
  .describe("Filter by call disposition (e.g. ANSWERED, NO ANSWER, BUSY, FAILED)");
const ani = z
  .string()
  .optional()
  .describe("Filter by ANI (calling number)");
const dni = z
  .string()
  .optional()
  .describe("Filter by DNI (called number)");

export function registerAnalyticsTools(
  server: McpServer,
  client: WarpClient
): void {
  server.registerTool(
    "cdr_get_details",
    {
      title: "List call detail records",
      description:
        "List paginated call detail records (CDRs) for a date range with optional filters. Use to investigate specific calls, verify traffic, or debug call failures. For aggregate metrics use cdr_get_statistics; for chart data use cdr_get_trends.",
      inputSchema: {
        start_date: startDate,
        end_date: endDate,
        tz_offset_minutes: tzOffset,
        page: z.number().int().min(1).optional().describe("Page (1-based, default 1)"),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe("Page size (1-500, default 50)"),
        direction,
        disposition,
        ani,
        dni,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) =>
      formatResponse(
        await client.get("/v1/cdr/details", {
          start_date: args.start_date,
          end_date: args.end_date,
          tz_offset_minutes: args.tz_offset_minutes,
          page: args.page,
          per_page: args.per_page,
          direction: args.direction,
          disposition: args.disposition,
          ani: args.ani,
          dni: args.dni,
        })
      )
  );

  server.registerTool(
    "cdr_export_csv",
    {
      title: "Export CDRs as CSV",
      description:
        "Export up to 10,000 call detail records for a date range as CSV text. Use only when the user explicitly wants a CSV export; for browsing or analysis prefer cdr_get_details (paginated). Output over 40k characters is truncated — narrow the date range or filters if that happens.",
      inputSchema: {
        start_date: startDate,
        end_date: endDate,
        tz_offset_minutes: tzOffset,
        direction,
        disposition,
        ani,
        dni,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) =>
      formatResponse(
        await client.get("/v1/cdr/export", {
          start_date: args.start_date,
          end_date: args.end_date,
          tz_offset_minutes: args.tz_offset_minutes,
          direction: args.direction,
          disposition: args.disposition,
          ani: args.ani,
          dni: args.dni,
        })
      )
  );

  server.registerTool(
    "cdr_get_statistics",
    {
      title: "Get call statistics",
      description:
        "Get aggregated CDR metrics (totals, durations, dispositions) for a date range. Use for summary questions like 'how many calls last week' or ASR/ACD analysis. For individual calls use cdr_get_details.",
      inputSchema: {
        start_date: startDate,
        end_date: endDate,
        tz_offset_minutes: tzOffset,
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) =>
      formatResponse(
        await client.get("/v1/cdr/statistics", {
          start_date: args.start_date,
          end_date: args.end_date,
          tz_offset_minutes: args.tz_offset_minutes,
        })
      )
  );

  server.registerTool(
    "cdr_get_trends",
    {
      title: "Get call trend data",
      description:
        "Get time-bucketed CDR aggregates for a date range, suitable for charts and spotting traffic patterns over time. Choose hour granularity for a single day, day for weeks, week for months.",
      inputSchema: {
        start_date: startDate,
        end_date: endDate,
        tz_offset_minutes: tzOffset,
        granularity: z
          .enum(["hour", "day", "week"])
          .optional()
          .describe("Bucket size (default day)"),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (args) =>
      formatResponse(
        await client.get("/v1/cdr/trends", {
          start_date: args.start_date,
          end_date: args.end_date,
          tz_offset_minutes: args.tz_offset_minutes,
          granularity: args.granularity,
        })
      )
  );

  server.registerTool(
    "cdr_get_dashboard_stats",
    {
      title: "Get dashboard statistics",
      description:
        "Get the key dashboard metrics (counts, revenue, growth) scoped to your accessible customers. Use for a quick account health overview rather than detailed CDR analysis.",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => formatResponse(await client.get("/v1/dashboard/stats"))
  );
}
