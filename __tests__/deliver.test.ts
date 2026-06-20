// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import { deliverWork, isDeliverableEmail, friendlyDeliverError } from "../src/pica/deliver";
import { PicaMcpError } from "../src/pica/mcpClient";

function fakeClient(impl: (name: string, args: any) => any) {
  return { callTool: vi.fn(impl) } as unknown as import("../src/pica/mcpClient").PicaMcpClient & {
    callTool: ReturnType<typeof vi.fn>;
  };
}

const base = { workId: "w1", email: "sarah@band.com", allowDownload: true as const };

describe("isDeliverableEmail", () => {
  it("accepts a normal address and rejects junk", () => {
    expect(isDeliverableEmail("sarah@band.com")).toBe(true);
    expect(isDeliverableEmail("  sarah@band.com ")).toBe(true);
    expect(isDeliverableEmail("")).toBe(false);
    expect(isDeliverableEmail("sarah")).toBe(false);
    expect(isDeliverableEmail("sarah@band")).toBe(false);
  });
});

describe("deliverWork", () => {
  it("returns sent on a successful share, mapping view+download", async () => {
    const client = fakeClient(() => ({
      send_id: "s1",
      share_link_id: "l1",
      share_url: "https://withpica.com/share/abc",
      recipient_resolution: { classification: "external", display_name: "Sarah", email_hash_prefix: "x" },
    }));
    const r = await deliverWork({ client }, base);
    expect(r).toEqual({ state: "sent", shareUrl: "https://withpica.com/share/abc", classification: "external", displayName: "Sarah" });
    const arg = client.callTool.mock.calls[0]?.[1];
    expect(arg).toMatchObject({ entity_type: "work", entity_id: "w1", recipient: { kind: "email", value: "sarah@band.com" }, scope: "view+download" });
  });

  it("maps allowDownload:false to scope view", async () => {
    const client = fakeClient(() => ({ share_url: "u", recipient_resolution: { classification: "internal_user", display_name: null } }));
    await deliverWork({ client }, { ...base, allowDownload: false });
    expect(client.callTool.mock.calls[0]?.[1]?.scope).toBe("view");
  });

  it("returns needs_confirm on the REAL tool error shape (status 428, generic error_code)", async () => {
    // The MCP pica_share_send tool collapses the route's specific error_code to
    // a generic SHARE_SEND_ERROR and only preserves the real signal in `status`
    // (428) and the `error` message — verified live against staging. Detection
    // must key on status/message, NOT error_code === FIRST_EXTERNAL.
    const client = fakeClient(() => ({
      error: 'API request failed: 428 {"error_code":"FIRST_EXTERNAL_SEND_CONFIRMATION_REQUIRED"}',
      error_code: "SHARE_SEND_ERROR",
      status: 428,
    }));
    const r = await deliverWork({ client }, base);
    expect(r).toEqual({ state: "needs_confirm", email: "sarah@band.com" });
  });

  it("returns needs_confirm when the error is THROWN with that code", async () => {
    const client = fakeClient(() => { throw new PicaMcpError("first send", "FIRST_EXTERNAL_SEND_CONFIRMATION_REQUIRED"); });
    const r = await deliverWork({ client }, base);
    expect(r).toEqual({ state: "needs_confirm", email: "sarah@band.com" });
  });

  it("re-sends with confirm_first_external_send when confirmFirstExternal is set", async () => {
    const client = fakeClient(() => ({ share_url: "u", recipient_resolution: { classification: "external", display_name: "Sarah" } }));
    await deliverWork({ client }, { ...base, confirmFirstExternal: true });
    expect(client.callTool.mock.calls[0]?.[1]?.confirm_first_external_send).toBe(true);
  });

  it("renders a friendly message for a RESOLVED volume error (real raw shape, no JSON leak)", async () => {
    // Real shape: SHARE_SEND_ERROR + status + a raw "API request failed: 429 {json}" message.
    const client = fakeClient(() => ({
      error:
        'API request failed: 429 {"error":"recipient hi@x.com above marketing-guard volume threshold","error_code":"RECIPIENT_VOLUME_EXCEEDED","retry_after_seconds":86400}',
      error_code: "SHARE_SEND_ERROR",
      status: 429,
    }));
    const r = await deliverWork({ client }, base);
    expect(r.state).toBe("error");
    const m = (r as { message?: string }).message ?? "";
    expect(m).toContain("a lot of email");
    expect(m).toContain("~24h");
    expect(m).not.toContain("{"); // raw JSON must not leak into the dialog
  });

  it("surfaces a THROWN error (network/HTTP)", async () => {
    const client = fakeClient(() => { throw new PicaMcpError("PICA returned HTTP 500", "500"); });
    const r = await deliverWork({ client }, base);
    expect(r).toEqual({ state: "error", message: "PICA returned HTTP 500", code: "500" });
  });
});

describe("friendlyDeliverError", () => {
  const raw = (status: number, code: string, msg: string, retry?: number) =>
    `API request failed: ${status} {"error":${JSON.stringify(msg)},"error_code":"${code}"${retry ? `,"retry_after_seconds":${retry}` : ""}}`;

  it("maps recipient volume with a retry window", () => {
    const out = friendlyDeliverError(raw(429, "RECIPIENT_VOLUME_EXCEEDED", "above threshold", 86400));
    expect(out).toContain("a lot of email");
    expect(out).toContain("~24h");
    expect(out).not.toContain("{");
  });

  it("maps sender rate limit, role address, and not-found", () => {
    expect(friendlyDeliverError(raw(429, "SENDER_RATE_LIMIT_EXCEEDED", "x", 3600))).toContain("shares in the last day");
    expect(friendlyDeliverError(raw(422, "ROLE_ADDRESS_REJECTED", "x"))).toContain("role inbox");
    expect(friendlyDeliverError(raw(404, "RECIPIENT_NOT_FOUND", "x"))).toContain("check the email address");
  });

  it("falls back to the inner message, then suggestion, then raw text", () => {
    expect(friendlyDeliverError(raw(400, "SOMETHING_NEW", "the inner reason"))).toBe("the inner reason");
    expect(friendlyDeliverError("PICA returned HTTP 500", "try later")).toBe("try later");
    expect(friendlyDeliverError("plain failure")).toBe("plain failure");
  });
});
