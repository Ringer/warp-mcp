const MAX_ITEMS = 50;
// Cap huge string payloads (CSV exports, rendered HTML) so a single tool call
// can't flood the model's context window.
const MAX_TEXT_CHARS = 40_000;

interface ErrorResponse {
  _error: true;
  status: number;
  message: string;
  body?: unknown;
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "_error" in value &&
    (value as ErrorResponse)._error === true
  );
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

export function formatResponse(data: unknown): ToolResult {
  if (isErrorResponse(data)) {
    const parts = [`Error: ${data.message}`];
    if (data.body && typeof data.body === "object") {
      parts.push(JSON.stringify(data.body, null, 2));
    } else if (data.body) {
      parts.push(truncateText(String(data.body)));
    }
    return {
      content: [{ type: "text", text: parts.join("\n\n") }],
      isError: true,
    };
  }

  // Non-JSON payloads (CSV, HTML) come back as plain strings.
  if (typeof data === "string") {
    return { content: [{ type: "text", text: truncateText(data) }] };
  }

  const truncated = truncateArrays(data);
  const text = JSON.stringify(truncated, null, 2);
  return { content: [{ type: "text", text: truncateText(text) }] };
}

function truncateText(text: string): string {
  if (text.length <= MAX_TEXT_CHARS) return text;
  return (
    text.slice(0, MAX_TEXT_CHARS) +
    `\n\n[truncated — ${text.length.toLocaleString()} chars total, showing first ${MAX_TEXT_CHARS.toLocaleString()}. Narrow the date range or filters to reduce output.]`
  );
}

function truncateArrays(data: unknown): unknown {
  if (Array.isArray(data)) {
    if (data.length > MAX_ITEMS) {
      return {
        _meta: {
          total: data.length,
          returned: MAX_ITEMS,
          has_more: true,
          message: `Showing ${MAX_ITEMS} of ${data.length} items. Use limit/offset or page parameters to paginate.`,
        },
        items: data.slice(0, MAX_ITEMS).map(truncateArrays),
      };
    }
    return data.map(truncateArrays);
  }

  if (typeof data === "object" && data !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = truncateArrays(value);
    }
    return result;
  }

  return data;
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    isError: true,
  };
}
