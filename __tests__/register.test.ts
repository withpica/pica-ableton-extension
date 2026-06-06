import { describe, it, expect, vi } from "vitest";
import { ensureIntroduced, registerSet, DuplicateWorkError, type RegisterInput } from "../src/pica/register";
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
      .mockResolvedValueOnce({ data: [] }) // pica_works_query (note: unwrapEnvelope already applied in real client; here raw)
      .mockResolvedValueOnce({ id: "w1", completeness_score: 12 }) // works_create
      .mockResolvedValueOnce({ id: "r1" }); // recordings_create

    const out = await registerSet(c, input);

    expect(c.callTool).toHaveBeenNthCalledWith(1, "pica_works_query", { query: "Night Drive" });
    expect(c.callTool).toHaveBeenNthCalledWith(2, "pica_works_create", expect.objectContaining({
      title: "Night Drive", work_type: "song", key: "C Minor", metadata: input.metadata, notes: input.summary,
    }));
    expect(c.callTool).toHaveBeenNthCalledWith(3, "pica_recordings_create", expect.objectContaining({
      title: "Night Drive", artist_name: "Dinachi", version_type: "master", work_id: "w1",
    }));
    expect(out).toEqual({
      workId: "w1", recordingId: "r1", completenessScore: 12,
      inspectUrl: "https://withpica.com/inspect/works/w1",
    });
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
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new PicaMcpError("dup", "WORK_ALREADY_EXISTS", { existing_work_id: "w7" }));
    await expect(registerSet(c, input)).rejects.toMatchObject({ name: "DuplicateWorkError", existingWorkId: "w7" });
  });

  it("propagates a recording-create failure (never reports success on a failed write)", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce({ data: [] })
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
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new PicaMcpError("dup", "WORK_ALREADY_EXISTS", {}));
    await expect(registerSet(c, input)).rejects.toMatchObject({ name: "PicaMcpError" });
  });
});
