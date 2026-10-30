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
      "connect",
    ]);
    await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    expect(writeApiKey).toHaveBeenCalledWith(
      "/tmp/store",
      KEY,
      expect.objectContaining({ organisationName: "soundslikefez" }),
    );
  });

  it("useBrowser → paste dialog, account check, then persists the pasted key", async () => {
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ apiKey: KEY }),
      "connect",
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    expect(out).toBe(KEY);
    expect(showModalDialog).toHaveBeenCalledTimes(3);
  });

  // Founder 2026-10-30: a key pasted from another browser session connected
  // Live to a different account, and nothing said so before it was saved.
  it("names the key's account before saving a pasted key", async () => {
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ apiKey: KEY }),
      "connect",
    ]);
    await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    const confirmUrl = decodeURIComponent(showModalDialog.mock.calls[2]![0]);
    expect(confirmUrl).toContain("is this the right account?");
    expect(confirmUrl).toContain("hi@soundslikefez.com");
    expect(confirmUrl).toContain("soundslikefez");
  });

  it("'not me' saves nothing and goes back to the paste dialog", async () => {
    const OTHER = "withpica_live_" + "b".repeat(64);
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ apiKey: KEY }),
      "another",
      JSON.stringify({ apiKey: OTHER }),
      "connect",
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    expect(out).toBe(OTHER);
    expect(writeApiKey).toHaveBeenCalledTimes(1);
    expect(writeApiKey).toHaveBeenCalledWith("/tmp/store", OTHER, expect.anything());
    expect(showModalDialog).toHaveBeenCalledTimes(5);
  });

  it("closing the account check saves nothing", async () => {
    const { ctx } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ apiKey: KEY }),
      "",
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", okFetch());
    expect(out).toBeNull();
    expect(writeApiKey).not.toHaveBeenCalled();
  });

  it("still asks when the key's account cannot be confirmed, and says so", async () => {
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ apiKey: KEY }),
      "connect",
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", fakeFetch({ ok: false }));
    expect(out).toBe(KEY);
    expect(decodeURIComponent(showModalDialog.mock.calls[2]![0])).toContain(
      "could not confirm which pica account",
    );
    expect(writeApiKey).toHaveBeenCalledWith("/tmp/store", KEY, undefined);
  });

  // Founder 2026-10-30: the connect address was text Live's window could not open.
  it("openBrowser from the connect page opens the system browser, then the paste dialog", async () => {
    const openFn = vi.fn(async () => true);
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ openBrowser: true }),
      JSON.stringify({ apiKey: KEY }),
      "connect",
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", okFetch(), openFn);
    expect(openFn).toHaveBeenCalledWith("https://withpica.com/connect/ableton");
    expect(out).toBe(KEY);
    expect(decodeURIComponent(showModalDialog.mock.calls[1]![0])).toContain(
      "connect live to your pica account",
    );
  });

  it("'open in browser' on the paste dialog opens the browser and brings the dialog back", async () => {
    const openFn = vi.fn(async () => true);
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ openBrowser: true }),
      JSON.stringify({ apiKey: KEY }),
      "connect",
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store", okFetch(), openFn);
    expect(openFn).toHaveBeenCalledTimes(1);
    expect(out).toBe(KEY);
    expect(showModalDialog).toHaveBeenCalledTimes(4);
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

describe("connectAndStoreKey: device sign-in", () => {
  beforeEach(() => vi.clearAllMocks());

  const START_BODY = {
    device_code: "dev-code",
    user_code: "BCDF-GHJK",
    verification_uri: "https://withpica.com/connect/device",
    verification_uri_complete: "https://withpica.com/connect/device?code=BCDF-GHJK",
    expires_in: 600,
    interval: 1,
  };

  /** Answers by URL: start, then the given poll answers, then /me. */
  function deviceFetch(polls: unknown[]) {
    const queue = [...polls];
    return vi.fn(async (url: string) => {
      if (url.endsWith("/api/public/connect/device")) return { ok: true, status: 200, json: async () => START_BODY };
      if (url.endsWith("/api/public/connect/device/token")) {
        const body = queue.shift() as { api_key?: string };
        return { ok: !!body?.api_key, status: body?.api_key ? 200 : 400, json: async () => body };
      }
      return { ok: true, status: 200, json: async () => ME_PAYLOAD };
    }) as unknown as typeof fetch;
  }

  function deviceContext(results: string[]) {
    const { ctx, showModalDialog } = fakeContext(results);
    const withinProgressDialog = vi.fn(async (_t: string, _o: unknown, cb: (u: unknown, s: AbortSignal) => unknown) =>
      cb(async () => {}, new AbortController().signal),
    );
    (ctx.ui as unknown as { withinProgressDialog: unknown }).withinProgressDialog = withinProgressDialog;
    return { ctx, showModalDialog, withinProgressDialog };
  }

  it("shows the code, opens the approve page, and saves the key once approved", async () => {
    const openFn = vi.fn(async () => true);
    const { ctx, showModalDialog, withinProgressDialog } = deviceContext([JSON.stringify({ open: true })]);
    const f = deviceFetch([{ error: "authorization_pending" }, { api_key: KEY }]);
    vi.useFakeTimers();
    const p = connectAndStoreKey(ctx, "/tmp/store", f, openFn);
    await vi.runAllTimersAsync();
    const out = await p;
    vi.useRealTimers();
    expect(out).toBe(KEY);
    expect(decodeURIComponent(showModalDialog.mock.calls[0]![0])).toContain("BCDF-GHJK");
    expect(openFn).toHaveBeenCalledWith("https://withpica.com/connect/device?code=BCDF-GHJK");
    expect(withinProgressDialog.mock.calls[0]![0]).toContain("BCDF-GHJK");
    expect(writeApiKey).toHaveBeenCalledWith(
      "/tmp/store",
      KEY,
      expect.objectContaining({ organisationName: "soundslikefez" }),
    );
  });

  it("'use a key instead' goes to the paste flow", async () => {
    const { ctx } = deviceContext([
      JSON.stringify({ paste: true }),
      JSON.stringify({ apiKey: KEY }),
      "connect",
    ]);
    expect(await connectAndStoreKey(ctx, "/tmp/store", deviceFetch([]))).toBe(KEY);
  });

  it("a denied code saves nothing and says why", async () => {
    const { ctx, showModalDialog } = deviceContext([JSON.stringify({ wait: true }), "ok"]);
    vi.useFakeTimers();
    const p = connectAndStoreKey(ctx, "/tmp/store", deviceFetch([{ error: "access_denied" }]));
    await vi.runAllTimersAsync();
    const out = await p;
    vi.useRealTimers();
    expect(out).toBeNull();
    expect(writeApiKey).not.toHaveBeenCalled();
    expect(decodeURIComponent(showModalDialog.mock.calls[1]![0])).toContain("denied");
  });

  it("cancel on the code window saves nothing and polls nothing", async () => {
    const { ctx, withinProgressDialog } = deviceContext([JSON.stringify({ cancelled: true })]);
    expect(await connectAndStoreKey(ctx, "/tmp/store", deviceFetch([]))).toBeNull();
    expect(withinProgressDialog).not.toHaveBeenCalled();
  });
});

