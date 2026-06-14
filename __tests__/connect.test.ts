import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionContext } from "@ableton-extensions/sdk";
import {
  isKeyShaped,
  safeParse,
  connectAndStoreKey,
} from "../src/pica/connect";

vi.mock("../src/pica/keyStore", () => ({
  writeApiKey: vi.fn(async () => {}),
  readApiKey: vi.fn(async () => null),
}));
import { writeApiKey } from "../src/pica/keyStore";

const KEY = "withpica_live_" + "a".repeat(64);

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
    const out = await connectAndStoreKey(ctx, "/tmp/store");
    expect(out).toBe(KEY);
    expect(writeApiKey).toHaveBeenCalledWith("/tmp/store", KEY);
    expect(showModalDialog).toHaveBeenCalledTimes(1);
  });

  it("useBrowser → opens the paste dialog and persists the pasted key", async () => {
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ apiKey: KEY }),
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store");
    expect(out).toBe(KEY);
    expect(showModalDialog).toHaveBeenCalledTimes(2);
  });

  it("plain cancel → returns null, no paste dialog, no write", async () => {
    const { ctx, showModalDialog } = fakeContext([
      JSON.stringify({ cancelled: true }),
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store");
    expect(out).toBeNull();
    expect(showModalDialog).toHaveBeenCalledTimes(1);
    expect(writeApiKey).not.toHaveBeenCalled();
  });

  it("window-close (unparseable) → returns null, no paste dialog", async () => {
    const { ctx, showModalDialog } = fakeContext([""]);
    const out = await connectAndStoreKey(ctx, "/tmp/store");
    expect(out).toBeNull();
    expect(showModalDialog).toHaveBeenCalledTimes(1);
  });

  it("malformed paste → returns null, no write", async () => {
    const { ctx } = fakeContext([
      JSON.stringify({ useBrowser: true }),
      JSON.stringify({ apiKey: "nope" }),
    ]);
    const out = await connectAndStoreKey(ctx, "/tmp/store");
    expect(out).toBeNull();
    expect(writeApiKey).not.toHaveBeenCalled();
  });
});
