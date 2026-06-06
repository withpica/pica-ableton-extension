// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

export interface McpClientConfig {
  baseUrl: string;
  apiKey: string;
}

export class PicaMcpError extends Error {
  code?: string;
  data?: unknown;
  constructor(message: string, code?: string, data?: unknown) {
    super(message);
    this.name = "PicaMcpError";
    this.code = code;
    this.data = data;
  }
}

type FetchFn = typeof fetch;

/** PICA's /api/mcp may answer a POST with plain JSON or an SSE frame. Normalise both. */
export function parseJsonRpcPayload(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  // SSE: find the last `data:` line and parse it.
  const dataLine = trimmed
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("data:"));
  if (!dataLine) throw new PicaMcpError(`Unparseable MCP response: ${trimmed.slice(0, 200)}`);
  return JSON.parse(dataLine.slice("data:".length).trim());
}

/** Unwrap PICA's `{ success, message, data, ... }` envelope to its `data`, else return as-is. */
export function unwrapEnvelope(payload: any): any {
  if (payload && typeof payload === "object" && "data" in payload) return payload.data;
  return payload;
}

export class PicaMcpClient {
  private nextId = 1;
  constructor(
    private readonly cfg: McpClientConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  /** Call an MCP tool. Returns the parsed tool result (envelope unwrapped). Throws PicaMcpError on any failure. */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    const reqBody = {
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    };

    let res: Response;
    try {
      res = await this.fetchFn(`${this.cfg.baseUrl}/api/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify(reqBody),
      });
    } catch (e) {
      throw new PicaMcpError(`Network error calling ${name}: ${(e as Error).message}`);
    }

    const raw = await res.text();
    if (!res.ok) {
      throw new PicaMcpError(`PICA returned HTTP ${res.status} for ${name}: ${raw.slice(0, 300)}`, String(res.status));
    }

    const payload = parseJsonRpcPayload(raw);
    if (payload.error) {
      throw new PicaMcpError(payload.error.message ?? `JSON-RPC error from ${name}`, payload.error.code, payload.error.data);
    }

    const result = payload.result;
    const text: unknown = result?.content?.[0]?.text;
    let parsed: any = result;
    if (typeof text === "string") {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { message: text };
      }
    }

    if (result?.isError) {
      throw new PicaMcpError(
        parsed?.message ?? parsed?.error ?? `Tool ${name} returned an error`,
        parsed?.error_code ?? parsed?.code,
        parsed,
      );
    }

    return unwrapEnvelope(parsed) as T;
  }
}
