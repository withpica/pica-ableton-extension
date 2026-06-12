import { describe, it, expect, vi, beforeEach } from "vitest";
import { PicaMcpClient, PicaMcpError, parseJsonRpcPayload } from "../src/pica/mcpClient";

describe("parseJsonRpcPayload", () => {
  it("parses a plain JSON body", () => {
    const raw = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(parseJsonRpcPayload(raw)).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("parses an SSE-framed body (extracts the data: line)", () => {
    const raw = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })}\n\n`;
    expect(parseJsonRpcPayload(raw)).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  it("ignores a trailing SSE [DONE] sentinel and parses the JSON data line", () => {
    const json = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    const raw = `event: message\ndata: ${json}\n\ndata: [DONE]\n\n`;
    expect(parseJsonRpcPayload(raw)).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });
});

describe("PicaMcpClient.callTool", () => {
  beforeEach(() => vi.restoreAllMocks());

  function mockFetch(body: unknown, status = 200) {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    } as Response);
  }

  it("POSTs a JSON-RPC tools/call envelope with the bearer token", async () => {
    const fetchMock = mockFetch({
      jsonrpc: "2.0",
      id: 1,
      result: { isError: false, content: [{ type: "text", text: JSON.stringify({ id: "w1" }) }] },
    });
    const client = new PicaMcpClient({ baseUrl: "https://withpica.com", apiKey: "k" }, fetchMock);

    const out = await client.callTool("pica_works_query", { query: "x" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://withpica.com/api/mcp");
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body)).toMatchObject({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "pica_works_query", arguments: { query: "x" } },
    });
    expect(out).toEqual({ id: "w1" });
  });

  it("throws PicaMcpError with code+data on a tool-level error envelope", async () => {
    const fetchMock = mockFetch({
      jsonrpc: "2.0",
      id: 1,
      result: {
        isError: true,
        content: [{ type: "text", text: JSON.stringify({ error_code: "WORK_ALREADY_EXISTS", message: "dup", existing_work_id: "w9" }) }],
      },
    });
    const client = new PicaMcpClient({ baseUrl: "https://withpica.com", apiKey: "k" }, fetchMock);

    await expect(client.callTool("pica_works_create", {})).rejects.toMatchObject({
      name: "PicaMcpError",
      code: "WORK_ALREADY_EXISTS",
    });
  });

  // Real prod shape captured 2026-06-12: create tools put the entity in
  // structuredContent.data; content[0].text is a human message with no JSON.
  it("returns structuredContent.data for create-style responses (text is human-only)", async () => {
    const fetchMock = mockFetch({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: "Work created successfully\n\nNext steps you could take:\n- Set AI disclosure" }],
        structuredContent: {
          success: true,
          message: "Work created successfully",
          data: { id: "w-new", title: "T", completeness_score: 12 },
          completion_hints: [],
        },
      },
    });
    const client = new PicaMcpClient({ baseUrl: "https://withpica.com", apiKey: "k" }, fetchMock);

    const out = await client.callTool<{ id: string }>("pica_works_create", { title: "T" });

    expect(out.id).toBe("w-new");
  });

  // Real prod shape captured 2026-06-12: query text is "Found N works.\n\n{json}"
  // (human prefix before the JSON) and structuredContent is {count, items, ...}.
  it("returns the items payload for query responses with a human text prefix", async () => {
    const payload = { count: 1, items: [{ id: "w1", title: "Ableton Test" }], total: 1, limit: 25, hasMore: false };
    const fetchMock = mockFetch({
      jsonrpc: "2.0",
      id: 1,
      result: {
        content: [{ type: "text", text: `Found 1 works.\n\n${JSON.stringify(payload)}` }],
        structuredContent: payload,
      },
    });
    const client = new PicaMcpClient({ baseUrl: "https://withpica.com", apiKey: "k" }, fetchMock);

    const out = await client.callTool<{ items: Array<{ id: string }> }>("pica_works_query", { query: "x" });

    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.id).toBe("w1");
  });

  it("parses an error envelope even when the text has a human prefix", async () => {
    const fetchMock = mockFetch({
      jsonrpc: "2.0",
      id: 1,
      result: {
        isError: true,
        content: [{ type: "text", text: `Something went wrong.\n\n${JSON.stringify({ error_code: "WORK_ALREADY_EXISTS", message: "dup", existing_work_id: "w9" })}` }],
      },
    });
    const client = new PicaMcpClient({ baseUrl: "https://withpica.com", apiKey: "k" }, fetchMock);

    await expect(client.callTool("pica_works_create", {})).rejects.toMatchObject({
      name: "PicaMcpError",
      code: "WORK_ALREADY_EXISTS",
    });
  });

  it("throws PicaMcpError on a non-2xx HTTP response (e.g. 401)", async () => {
    const fetchMock = mockFetch({ error: "Invalid API key", status: 401 }, 401);
    const client = new PicaMcpClient({ baseUrl: "https://withpica.com", apiKey: "bad" }, fetchMock);

    await expect(client.callTool("pica_works_query", {})).rejects.toBeInstanceOf(PicaMcpError);
  });
});
