// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.
import { describe, it, expect, vi } from "vitest";
import { saveWriters, summarizeWriters } from "../src/pica/writers";
import { PicaMcpError } from "../src/pica/mcpClient";

function fakeClient() {
  return { callTool: vi.fn() } as unknown as import("../src/pica/mcpClient").PicaMcpClient & {
    callTool: ReturnType<typeof vi.fn>;
  };
}

describe("saveWriters", () => {
  it("sends one call with the trimmed non-blank names and returns outcomes", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValue({ writers: [{ name: "Jane", status: "created", person_id: "p1" }] });
    const out = await saveWriters(c, "w1", ["Jane", "  "]);
    expect(c.callTool).toHaveBeenCalledWith("pica_work_writers_add", { work_id: "w1", names: ["Jane"] });
    expect(out).toEqual([{ name: "Jane", status: "created", person_id: "p1" }]);
  });

  it("returns [] without calling when there are no non-blank names", async () => {
    const c = fakeClient();
    const out = await saveWriters(c, "w1", ["", "   "]);
    expect(out).toEqual([]);
    expect(c.callTool).not.toHaveBeenCalled();
  });

  it("rethrows a 401 so the reconnect path can re-run", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValue(new PicaMcpError("unauthorized", "401"));
    await expect(saveWriters(c, "w1", ["Jane"])).rejects.toBeInstanceOf(PicaMcpError);
  });
});

describe("summarizeWriters", () => {
  it("counts linked / created / skipped", () => {
    expect(summarizeWriters([
      { name: "A", status: "linked_existing" },
      { name: "B", status: "created" },
      { name: "C", status: "skipped_ambiguous" },
      { name: "D", status: "skipped_existing" },
    ])).toBe("writers: 1 linked, 1 added, 1 need review");
  });
  it("is empty string for no writers", () => {
    expect(summarizeWriters([])).toBe("");
  });
});
