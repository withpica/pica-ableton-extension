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

  it("throws PicaMcpError on a non-2xx HTTP response (e.g. 401)", async () => {
    const fetchMock = mockFetch({ error: "Invalid API key", status: 401 }, 401);
    const client = new PicaMcpClient({ baseUrl: "https://withpica.com", apiKey: "bad" }, fetchMock);

    await expect(client.callTool("pica_works_query", {})).rejects.toBeInstanceOf(PicaMcpError);
  });
});
