// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import {
  masterSplitPayload,
  asSplitArray,
  ensureMasterOwnership,
} from "../src/pica/ownership";
import { PicaMcpError } from "../src/pica/mcpClient";

function fakeClient() {
  return { callTool: vi.fn() } as unknown as import("../src/pica/mcpClient").PicaMcpClient & {
    callTool: ReturnType<typeof vi.fn>;
  };
}

describe("masterSplitPayload", () => {
  it("is exactly an org-owned 100% master split (no person_id)", () => {
    expect(masterSplitPayload("r1")).toEqual({
      recording_id: "r1",
      split_type: "master",
      percentage: 100,
      role: "owner",
    });
    expect("person_id" in masterSplitPayload("r1")).toBe(false);
  });
});

describe("asSplitArray", () => {
  it("normalises array, {data}, {splits}, {items}, and junk to a list", () => {
    expect(asSplitArray([{ split_type: "master" }])).toHaveLength(1);
    expect(asSplitArray({ data: [{ split_type: "master" }] })).toHaveLength(1);
    expect(asSplitArray({ splits: [{ split_type: "mechanical" }] })).toHaveLength(1);
    expect(asSplitArray({ items: [{ split_type: "master" }] })).toHaveLength(1);
    expect(asSplitArray(null)).toEqual([]);
    expect(asSplitArray({ nope: true })).toEqual([]);
  });
});

describe("ensureMasterOwnership", () => {
  it("creates the master split when none exists", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce([]) // splits_list → none
      .mockResolvedValueOnce({ id: "s1" }); // splits_create
    const out = await ensureMasterOwnership(c, "r1");
    expect(out).toEqual({ status: "created" });
    expect(c.callTool).toHaveBeenNthCalledWith(1, "pica_recording_splits_list", { recording_id: "r1" });
    expect(c.callTool).toHaveBeenNthCalledWith(2, "pica_recording_splits_create", {
      recording_id: "r1",
      split_type: "master",
      percentage: 100,
      role: "owner",
    });
  });

  it("skips (no create) when a master split already exists", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce([{ split_type: "master" }]); // splits_list
    const out = await ensureMasterOwnership(c, "r1");
    expect(out).toEqual({ status: "skipped_existing" });
    expect(c.callTool).toHaveBeenCalledTimes(1); // never called create
  });

  it("reports failed (does not throw) on a non-auth error", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValueOnce(new PicaMcpError("boom", "500"));
    const out = await ensureMasterOwnership(c, "r1");
    expect(out.status).toBe("failed");
    expect(out.error).toContain("boom");
  });

  it("rethrows a 401 so the reconnect path can re-run", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValueOnce(new PicaMcpError("unauthorized", "401"));
    await expect(ensureMasterOwnership(c, "r1")).rejects.toBeInstanceOf(PicaMcpError);
  });
});
