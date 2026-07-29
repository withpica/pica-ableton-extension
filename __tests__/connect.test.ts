import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionContext } from "@ableton-extensions/sdk";
import {
  isKeyShaped,
  safeParse,
  connectAndStoreKey,
  withReconnect,
  disconnect,
} from "../src/pica/connect";
import { PicaMcpError } from "../src/pica/mcpClient";

vi.mock("../src/pica/keyStore", () => ({
  writeApiKey: vi.fn(async () => {}),
  readApiKey: vi.fn(async () => null),
  readCredentials: vi.fn(async () => null),
  writeIdentity: vi.fn(async () => true),
  clearCredentials: vi.fn(async () => true),
}));
import { writeApiKey, clearCredentials } from "../src/pica/keyStore";

const KEY = "withpica_live_" + "a".repeat(64);

const ME_PAYLOAD = {
  success: true,
  data: {
    full_name: "Fez",
    email: "hi@soundslikefez.com",
    organisation_id: "c0c31e65-7749-4af4-a4f8-c4d3641204ae",
    organisation_name: "soundslikefez",
  },
};

/**
 * Minting resolves the connected identity (ADR-259), so both connect paths and
 * the reconnect path now make a request. Every one of them takes an injected
 * fetch; nothing here touches the global, which __tests__/setup.ts has turned
 * into a tripwire precisely so an omission fails instead of reaching prod.
 */
function fakeFetch(response: { ok: boolean; payload?: unknown }) {
  return vi.fn(async () => ({
    ok: response.ok,
    json: async () => response.payload,
  })) as unknown as typeof fetch;
}

const okFetch = () => fakeFetch({ ok: true, payload: ME_PAYLOAD });

function fakeContext(results: string[]) {
  const showModalDialog = vi.fn();
  results.forEach((r) => showModalDialog.mockResolvedValueOnce(r));
  return {
    ctx: { ui: { showModalDialog } } as unknown as ExtensionContext<"1.0.0">,
    showModalDialog,
  };
}

describe("isKeyShaped", () => {
  it("accepts the real mint format", () => {
    expect(isKeyShaped("withpica_live_" + "a".repeat(64))).toBe(true);
  });
  it("rejects wrong prefix / length / case", () => {
    expect(isKeyShaped("withpica_test_" + "a".repeat(64))).toBe(false);
    expect(isKeyShaped("withpica_live_" + "a".repeat(10))).toBe(false);
    expect(isKeyShaped("withpica_live_" + "A".repeat(64))).toBe(false);
    expect(isKeyShaped("")).toBe(false);
  });
});

describe("safeParse", () => {
  it("returns {} on non-JSON and on non-object JSON", () => {
    expect(safeParse("not json")).toEqual({});
    expect(safeParse("42")).toEqual({});
  });
  it("parses an object", () => {
    expect(safeParse('{"apiKey":"x"}')).toEqual({ apiKey: "x" });
  });
});

describe("connectAndStoreKey", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Mode A: page bridges {apiKey} → persists and returns it (one dialog)", async () => {
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ apiKey: KEY }),
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    expect(out).toBe(KEY);
    expect(writeApiKey).toHaveBeenCalledWith(
      "/tmp/store",
      KEY,
      expect.objectContaining({
        email: "hi@soundslikefez.com",
        organisationName: "soundslikefez",
      }),
    );
    expect(showModalDialog).toHaveBeenCalledTimes(1);
  });

  /**
   * The identity has to be resolved at MINT time, not lazily. A key that
   * outlives the account line describing it is the wrong-catalogue write this
   * whole feature exists to prevent.
   */
  it("caches the connected identity alongside the key on mint", async () => {
    const fetchFn = okFetch();
    const { ctx } = fakeContext([JSON.stringify({ apiKey: KEY })]);
    await connectAndStoreKey(ctx, "/tmp/store", fetchFn);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://withpica.com/api/admin/me",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${KEY}` }),
      }),
    );
  });

  it("stores the key alone when the identity cannot be resolved", async () => {
    // An unreachable or refusing /me must not block connecting: the dialogs
    // say the account is unconfirmed instead.
    const { ctx } = fakeContext([JSON.stringify({ apiKey: KEY })]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", fakeFetch({ ok: false }));
    expect(out).toBe(KEY);
    expect(writeApiKey).toHaveBeenCalledWith("/tmp/store", KEY, undefined);
  });

  it("resolves the identity on the pasted-key path too", async () => {
    const { ctx } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ apiKey: KEY }),
    ]);
    await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    expect(writeApiKey).toHaveBeenCalledWith(
      "/tmp/store",
      KEY,
      expect.objectContaining({ organisationName: "soundslikefez" }),
    );
  });

  it("useBrowser → opens the paste dialog and persists the pasted key", async () => {
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ apiKey: KEY }),
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    expect(out).toBe(KEY);
    expect(showModalDialog).toHaveBeenCalledTimes(2);
  });

  it("plain cancel → returns null, no paste dialog, no write", async () => {
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ cancelled: true }),
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    expect(out).toBeNull();
    expect(showModalDialog).toHaveBeenCalledTimes(1);
    expect(writeApiKey).not.toHaveBeenCalled();
  });

  it("window-close (unparseable) → returns null, no paste dialog", async () => {
    const { ctx, showModalDialog } = fakeContext([""]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    expect(out).toBeNull();
    expect(showModalDialog).toHaveBeenCalledTimes(1);
  });

  it("malformed paste → returns null, no write", async () => {
    const { ctx } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ apiKey: "nope" }),
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    expect(out).toBeNull();
    expect(writeApiKey).not.toHaveBeenCalled();
  });
});

describe("disconnect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forgets the stored credentials", async () => {
    const out = await disconnect("/tmp/store");
    expect(clearCredentials).toHaveBeenCalledWith("/tmp/store");
    expect(out).toBe(true);
  });
});

describe("withReconnect", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reconnects once on a 401 then retries with the fresh key", async () => {
    const { ctx } = fakeContext([JSON.stringify({ apiKey: KEY })]); // connect returns KEY
    const make = vi
      .fn()
      .mockRejectedValueOnce(new PicaMcpError("unauthorised", "401"))
      .mockResolvedValueOnce("ok");
    const out = await withReconnect(ctx, "/tmp/store", make, "old-key", undefined, okFetch());
    expect(out).toBe("ok");
    expect(make).toHaveBeenNthCalledWith(1, "old-key");
    expect(make).toHaveBeenNthCalledWith(2, KEY);
  });

  it("reconnects once on INSUFFICIENT_SCOPE then retries with the fresh key", async () => {
    // An under-scoped (but valid) key isn't a 401 — it returns
    // error_code INSUFFICIENT_SCOPE. Reconnecting re-mints with the current
    // scope set, so this must trigger the same reconnect-and-retry as a 401.
    const { ctx } = fakeContext([JSON.stringify({ apiKey: KEY })]);
    const make = vi
      .fn()
      .mockRejectedValueOnce(
        new PicaMcpError("Scope 'write:files' is required for tool 'pica_audio_presigned_upload'", "INSUFFICIENT_SCOPE"),
      )
      .mockResolvedValueOnce("ok");
    const out = await withReconnect(ctx, "/tmp/store", make, "old-key", undefined, okFetch());
    expect(out).toBe("ok");
    expect(make).toHaveBeenNthCalledWith(1, "old-key");
    expect(make).toHaveBeenNthCalledWith(2, KEY);
  });

  it("rethrows the 401 if the user declines to reconnect", async () => {
    const { ctx } = fakeContext([JSON.stringify({ cancelled: true })]); // connect returns null
    const make = vi
      .fn()
      .mockRejectedValue(new PicaMcpError("unauthorised", "401"));
    await expect(
      withReconnect(ctx, "/tmp/store", make, "old-key", undefined, okFetch()),
    ).rejects.toThrow("unauthorised");
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("does not reconnect on a non-401 error", async () => {
    const { ctx, showModalDialog } = fakeContext([]);
    const make = vi
      .fn()
      .mockRejectedValue(new PicaMcpError("server error", "500"));
    await expect(
      withReconnect(ctx, "/tmp/store", make, "old-key", undefined, okFetch()),
    ).rejects.toThrow("server error");
    expect(showModalDialog).not.toHaveBeenCalled();
  });

  it("invokes onReconnect with the fresh key on a 401", async () => {
    const { ctx } = fakeContext([JSON.stringify({ apiKey: KEY })]);
    const make = vi
      .fn()
      .mockRejectedValueOnce(new PicaMcpError("unauthorised", "401"))
      .mockResolvedValueOnce("ok");
    const onReconnect = vi.fn();
    const out = await withReconnect(ctx, "/tmp/store", make, "old-key", onReconnect, okFetch());
    expect(out).toBe("ok");
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onReconnect).toHaveBeenCalledWith(KEY);
  });

  it("does not invoke onReconnect when make succeeds first try", async () => {
    const { ctx } = fakeContext([]);
    const make = vi.fn().mockResolvedValueOnce("ok");
    const onReconnect = vi.fn();
    const out = await withReconnect(ctx, "/tmp/store", make, "old-key", onReconnect, okFetch());
    expect(out).toBe("ok");
    expect(onReconnect).not.toHaveBeenCalled();
  });
});
