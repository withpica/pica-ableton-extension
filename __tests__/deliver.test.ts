// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import { deliverWork, isDeliverableEmail } from "../src/pica/deliver";
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

  it("returns needs_confirm when the RESOLVED result carries the first-external code", async () => {
    const client = fakeClient(() => ({ error: "first send", error_code: "FIRST_EXTERNAL_SEND_CONFIRMATION_REQUIRED", suggestion: "confirm" }));
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

  it("surfaces a generic RESOLVED error with its code and message", async () => {
    const client = fakeClient(() => ({ error: "slow down", error_code: "SENDER_RATE_LIMIT_EXCEEDED", suggestion: "wait" }));
    const r = await deliverWork({ client }, base);
    expect(r).toEqual({ state: "error", message: "slow down", code: "SENDER_RATE_LIMIT_EXCEEDED" });
  });

  it("surfaces a THROWN error (network/HTTP)", async () => {
    const client = fakeClient(() => { throw new PicaMcpError("PICA returned HTTP 500", "500"); });
    const r = await deliverWork({ client }, base);
    expect(r).toEqual({ state: "error", message: "PICA returned HTTP 500", code: "500" });
  });
});
