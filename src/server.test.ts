import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import { WarpClient } from "./client.js";
import type { Config } from "./config.js";

const TEST_CONFIG: Config = {
  baseUrl: "https://api.warp.test",
  apiToken: "rk_test_abc123",
  requestTimeoutMs: 5000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function connectedClient(warpClient: WarpClient): Promise<Client> {
  const server = createServer(warpClient);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("warp-mcp server", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers the full tool catalog with valid metadata", async () => {
    const client = await connectedClient(new WarpClient(TEST_CONFIG));
    const { tools } = await client.listTools();

    expect(tools.length).toBeGreaterThanOrEqual(130);

    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("warp_status");

    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z0-9_]{1,128}$/);
      expect(tool.description, `${tool.name} missing description`).toBeTruthy();
      expect(
        tool.annotations,
        `${tool.name} missing annotations`
      ).toBeDefined();
      expect(
        typeof tool.annotations?.readOnlyHint,
        `${tool.name} missing readOnlyHint`
      ).toBe("boolean");
    }
  });

  it("exposes destructive hints only on mutating tools", async () => {
    const client = await connectedClient(new WarpClient(TEST_CONFIG));
    const { tools } = await client.listTools();

    const trunkDelete = tools.find((t) => t.name === "trunk_delete");
    expect(trunkDelete?.annotations?.readOnlyHint).toBe(false);
    expect(trunkDelete?.annotations?.destructiveHint).toBe(true);

    const trunkList = tools.find((t) => t.name === "trunk_list");
    expect(trunkList?.annotations?.readOnlyHint).toBe(true);
    expect(trunkList?.annotations?.destructiveHint).toBe(false);
  });

  it("registers the warp-guide knowledge prompt", async () => {
    const client = await connectedClient(new WarpClient(TEST_CONFIG));
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain("warp-guide");
  });

  it("calls the API with Bearer auth and returns JSON", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: { balance: 42.5 } })
    );
    const client = await connectedClient(new WarpClient(TEST_CONFIG));

    const result = await client.callTool({
      name: "acct_get_balance",
      arguments: {},
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.warp.test/v1/customers/me/balance");
    expect(init.headers.Authorization).toBe("Bearer rk_test_abc123");

    const content = result.content as Array<{ type: string; text: string }>;
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(content[0].text)).toEqual({
      success: true,
      data: { balance: 42.5 },
    });
  });

  it("returns isError (not a protocol error) on HTTP failures", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { success: false, error: { code: "FORBIDDEN", message: "nope" } },
        401
      )
    );
    const client = await connectedClient(new WarpClient(TEST_CONFIG));

    const result = await client.callTool({
      name: "acct_get_balance",
      arguments: {},
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("Error:");
    expect(content[0].text).toContain("FORBIDDEN");
  });

  it("truncates arrays over 50 items with _meta", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: i }));
    fetchMock.mockResolvedValue(jsonResponse(rows));
    const client = await connectedClient(new WarpClient(TEST_CONFIG));

    const result = await client.callTool({
      name: "bill_list_invoices",
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed._meta.total).toBe(120);
    expect(parsed._meta.returned).toBe(50);
    expect(parsed.items).toHaveLength(50);
  });

  it("reports missing API key via warp_status without calling the API", async () => {
    const client = await connectedClient(
      new WarpClient({ ...TEST_CONFIG, apiToken: null })
    );

    const result = await client.callTool({ name: "warp_status", arguments: {} });

    expect(fetchMock).not.toHaveBeenCalled();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.api_key_configured).toBe(false);
    expect(parsed.note).toContain("WARP_API_TOKEN");
  });

  it("rejects invalid tool arguments as a tool execution error", async () => {
    const client = await connectedClient(new WarpClient(TEST_CONFIG));

    const result = await client.callTool({
      name: "key_list",
      arguments: { customer_id: "not-a-uuid" },
    });

    // Spec 2025-11-25 (SEP-1303): validation failures are tool errors the
    // model can self-correct, not protocol errors.
    expect(result.isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
