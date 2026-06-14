import { describe, it, expect, vi } from "vitest";
import { ensureIntroduced, registerSet, findExistingRegistration, DuplicateWorkError, type RegisterInput } from "../src/pica/register";
import { PicaMcpError } from "../src/pica/mcpClient";

function fakeClient() {
  return { callTool: vi.fn() } as unknown as import("../src/pica/mcpClient").PicaMcpClient & {
    callTool: ReturnType<typeof vi.fn>;
  };
}

const input: RegisterInput = {
  title: "Night Drive",
  artistName: "Dinachi",
  workType: "song",
  key: "C Minor",
  metadata: { capturedFrom: "ableton" },
  summary: "3 tracks · captured from Ableton",
};

describe("ensureIntroduced", () => {
  it("calls pica_introduce_self exactly once across repeated calls", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValue({});
    await ensureIntroduced(c, "12.4.5");
    await ensureIntroduced(c, "12.4.5");
    expect(c.callTool).toHaveBeenCalledTimes(1);
    expect(c.callTool).toHaveBeenCalledWith("pica_introduce_self", expect.objectContaining({ agent_name: expect.stringContaining("Ableton") }));
  });
});

describe("registerSet", () => {
  it("dup-checks, creates work, then master recording, and returns ids + inspect url", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce([]) // pica_works_query → real client returns the unwrapped array
      .mockResolvedValueOnce({ id: "w1", completeness_score: 12 }) // works_create
      .mockResolvedValueOnce({ id: "r1" }) // recordings_create
      .mockResolvedValueOnce([]) // splits_list → none
      .mockResolvedValueOnce({ id: "s1" }); // splits_create

    const out = await registerSet(c, input);

    expect(c.callTool).toHaveBeenNthCalledWith(1, "pica_works_query", { query: "Night Drive" });
    expect(c.callTool).toHaveBeenNthCalledWith(2, "pica_works_create", expect.objectContaining({
      title: "Night Drive", work_type: "song", key: "C Minor", metadata: input.metadata, notes: input.summary,
    }));
    expect(c.callTool).toHaveBeenNthCalledWith(3, "pica_recordings_create", expect.objectContaining({
      title: "Night Drive", artist_name: "Dinachi", version_type: "master", work_id: "w1",
    }));
    expect(c.callTool).toHaveBeenNthCalledWith(4, "pica_recording_splits_list", { recording_id: "r1" });
    expect(c.callTool).toHaveBeenNthCalledWith(5, "pica_recording_splits_create", {
      recording_id: "r1", split_type: "master", percentage: 100, role: "owner",
    });
    expect(out).toEqual({
      workId: "w1", recordingId: "r1", completenessScore: 12,
      inspectUrl: "https://withpica.com/inspect/works/w1",
      masterOwnership: "created",
    });
  });

  it("skips the master split when the recording already has one (re-register)", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce([]) // works_query
      .mockResolvedValueOnce({ id: "w1" }) // works_create
      .mockResolvedValueOnce({ id: "r1" }) // recordings_create
      .mockResolvedValueOnce([{ split_type: "master" }]); // splits_list → already owned
    const out = await registerSet(c, input);
    expect(out.masterOwnership).toBe("skipped_existing");
    expect(c.callTool).toHaveBeenCalledTimes(4); // no splits_create
  });

  // Real prod shape captured 2026-06-12: pica_works_query returns {count, items, ...}.
  it("throws DuplicateWorkError when query returns the real {items} payload with a same-title work", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce({ count: 1, items: [{ id: "w9", title: "Night Drive" }], total: 1 });
    await expect(registerSet(c, input)).rejects.toBeInstanceOf(DuplicateWorkError);
    expect(c.callTool).toHaveBeenCalledTimes(1);
  });

  // Regression: 2026-06-12 smoke test — a parsing miss made work.id undefined; the
  // undefined work_id was silently dropped by JSON.stringify → orphaned recording.
  it("aborts before creating a recording if works_create returns no id", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce({ count: 0, items: [] }) // works_query
      .mockResolvedValueOnce({ message: "Work created successfully" }); // works_create with no id
    await expect(registerSet(c, input)).rejects.toThrow(/work id/i);
    expect(c.callTool).toHaveBeenCalledTimes(2); // recordings_create never called
  });

  it("throws DuplicateWorkError when query finds a same-title work", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce([{ id: "w9", title: "night drive" }]); // works_query returns array directly
    await expect(registerSet(c, input)).rejects.toBeInstanceOf(DuplicateWorkError);
    expect(c.callTool).toHaveBeenCalledTimes(1); // never reaches create
  });

  it("maps a 409 WORK_ALREADY_EXISTS from create into DuplicateWorkError", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce([]) // pica_works_query → real client returns the unwrapped array
      .mockRejectedValueOnce(new PicaMcpError("dup", "WORK_ALREADY_EXISTS", { existing_work_id: "w7" }));
    await expect(registerSet(c, input)).rejects.toMatchObject({ name: "DuplicateWorkError", existingWorkId: "w7" });
  });

  it("propagates a recording-create failure (never reports success on a failed write)", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce([]) // pica_works_query → real client returns the unwrapped array
      .mockResolvedValueOnce({ id: "w1" })
      .mockRejectedValueOnce(new PicaMcpError("boom", "500"));
    await expect(registerSet(c, input)).rejects.toBeInstanceOf(PicaMcpError);
  });

  it("rejects a blank title without calling any tool", async () => {
    const c = fakeClient();
    await expect(registerSet(c, { ...input, title: "   " })).rejects.toThrow(/blank/i);
    expect(c.callTool).not.toHaveBeenCalled();
  });

  it("rethrows a WORK_ALREADY_EXISTS error that carries no existing_work_id (not a DuplicateWorkError)", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce([]) // pica_works_query → real client returns the unwrapped array
      .mockRejectedValueOnce(new PicaMcpError("dup", "WORK_ALREADY_EXISTS", {}));
    await expect(registerSet(c, input)).rejects.toMatchObject({ name: "PicaMcpError" });
  });
});

describe("findExistingRegistration", () => {
  it("returns work + master recording ids for an exact-title match", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce({ count: 1, items: [{ id: "w1", title: "Night Drive" }] })
      .mockResolvedValueOnce({
        count: 2,
        items: [
          { id: "r2", version_type: "remix" },
          { id: "r1", version_type: "master" },
        ],
      });

    const out = await findExistingRegistration(c, "night drive");

    expect(c.callTool).toHaveBeenNthCalledWith(1, "pica_works_query", { query: "night drive" });
    expect(c.callTool).toHaveBeenNthCalledWith(2, "pica_recordings_query", { work_id: "w1" });
    expect(out).toEqual({ workId: "w1", recordingId: "r1" });
  });

  it("returns null when no work matches the title exactly", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce({ count: 1, items: [{ id: "w1", title: "Other Song" }] });
    expect(await findExistingRegistration(c, "Night Drive")).toBeNull();
  });

  it("falls back to the first recording when none is version_type master", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce({ count: 1, items: [{ id: "w1", title: "Night Drive" }] })
      .mockResolvedValueOnce({ count: 1, items: [{ id: "r7", version_type: "remix" }] });
    expect(await findExistingRegistration(c, "Night Drive")).toEqual({
      workId: "w1",
      recordingId: "r7",
    });
  });
});
