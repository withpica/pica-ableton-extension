import { describe, it, expect, vi } from "vitest";
import { ensureIntroduced, registerSet, findExistingRegistration, DuplicateWorkError, createRecordingForWork, NEW_VERSION_TYPES, coerceVersionType, type RegisterInput } from "../src/pica/register";
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
  it("registers the set in ONE pica_register_set call and returns ids + inspect url", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce({
      work_id: "w1",
      recording_id: "r1",
      completeness_score: 12,
      master_ownership: "created",
    });

    const out = await registerSet(c, input);

    expect(c.callTool).toHaveBeenCalledTimes(1);
    expect(c.callTool).toHaveBeenCalledWith("pica_register_set", {
      title: "Night Drive",
      artist_name: "Dinachi",
      work_type: "song",
      key: "C Minor",
      notes: input.summary,
      metadata: input.metadata,
    });
    expect(out).toEqual({
      workId: "w1",
      recordingId: "r1",
      completenessScore: 12,
      inspectUrl: "https://withpica.com/inspect/works/w1",
      masterOwnership: "created",
    });
  });

  it("surfaces master_ownership 'failed' from the server (best-effort ownership)", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce({
      work_id: "w1",
      recording_id: "r1",
      master_ownership: "failed",
    });
    const out = await registerSet(c, input);
    expect(out.masterOwnership).toBe("failed");
  });

  it("maps a duplicate error (existing_work_id under details) into DuplicateWorkError", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValueOnce(
      new PicaMcpError("dup", "WORK_ALREADY_EXISTS", { details: { existing_work_id: "w7" } }),
    );
    await expect(registerSet(c, input)).rejects.toMatchObject({
      name: "DuplicateWorkError",
      existingWorkId: "w7",
    });
    expect(c.callTool).toHaveBeenCalledTimes(1);
  });

  it("maps a duplicate error (flat existing_work_id fallback) into DuplicateWorkError", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValueOnce(
      new PicaMcpError("dup", "WORK_ALREADY_EXISTS", { existing_work_id: "w8" }),
    );
    await expect(registerSet(c, input)).rejects.toMatchObject({
      name: "DuplicateWorkError",
      existingWorkId: "w8",
    });
  });

  it("rethrows a duplicate error that carries no existing_work_id (not a DuplicateWorkError)", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValueOnce(new PicaMcpError("dup", "WORK_ALREADY_EXISTS", {}));
    await expect(registerSet(c, input)).rejects.toMatchObject({ name: "PicaMcpError" });
  });

  it("propagates a non-duplicate failure (never reports success on a failed write)", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValueOnce(new PicaMcpError("boom", "500"));
    await expect(registerSet(c, input)).rejects.toBeInstanceOf(PicaMcpError);
  });

  it("aborts if the server returns no work + recording ids", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce({ message: "registered" }); // missing ids
    await expect(registerSet(c, input)).rejects.toThrow(/work \+ recording ids/i);
  });

  it("rejects a blank title without calling any tool", async () => {
    const c = fakeClient();
    await expect(registerSet(c, { ...input, title: "   " })).rejects.toThrow(/blank/i);
    expect(c.callTool).not.toHaveBeenCalled();
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

describe("NEW_VERSION_TYPES", () => {
  it("excludes master and the video deliverables", () => {
    expect(NEW_VERSION_TYPES).not.toContain("master");
    expect(NEW_VERSION_TYPES).not.toContain("music_video");
    expect(NEW_VERSION_TYPES).not.toContain("lyric_video");
    expect(NEW_VERSION_TYPES[0]).toBe("alternate"); // default-first
  });
});

describe("coerceVersionType", () => {
  it("passes through a valid version type", () => {
    expect(coerceVersionType("remix")).toBe("remix");
    expect(coerceVersionType("alternate_master")).toBe("alternate_master");
  });
  it("defaults unrecognised / missing values to alternate", () => {
    expect(coerceVersionType("master")).toBe("alternate"); // excluded from NEW_VERSION_TYPES
    expect(coerceVersionType("nonsense")).toBe("alternate");
    expect(coerceVersionType(undefined)).toBe("alternate");
    expect(coerceVersionType(42)).toBe("alternate");
  });
});

describe("createRecordingForWork", () => {
  it("creates a recording under the work with the given version type", async () => {
    const client = { callTool: vi.fn().mockResolvedValue({ id: "rec-1" }) } as any;
    const out = await createRecordingForWork(client, {
      workId: "work-1", title: "Song", artistName: "Féz", versionType: "remix",
    });
    expect(out).toEqual({ recordingId: "rec-1" });
    expect(client.callTool).toHaveBeenCalledWith("pica_recordings_create", {
      title: "Song", artist_name: "Féz", version_type: "remix", work_id: "work-1",
    });
  });

  it("throws if no id is returned (never returns an undefined recording id)", async () => {
    const client = { callTool: vi.fn().mockResolvedValue({}) } as any;
    await expect(
      createRecordingForWork(client, { workId: "w", title: "t", artistName: "a", versionType: "alternate" }),
    ).rejects.toThrow(/did not return an id/);
  });
});

describe("primary_artist_id linking", () => {
  it("createRecordingForWork sends primary_artist_id when provided", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { id: "rec1" };
      },
    } as unknown as import("../src/pica/mcpClient").PicaMcpClient;
    await createRecordingForWork(client, {
      workId: "w1", title: "T", artistName: "Elle", versionType: "master", primaryArtistId: "p1",
    });
    expect(calls[0]!.args.primary_artist_id).toBe("p1");
  });

  it("createRecordingForWork omits primary_artist_id when not provided", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { id: "rec1" };
      },
    } as unknown as import("../src/pica/mcpClient").PicaMcpClient;
    await createRecordingForWork(client, {
      workId: "w1", title: "T", artistName: "Elle", versionType: "master",
    });
    expect(calls[0]!.args.primary_artist_id).toBeUndefined();
  });

  it("registerSet threads primaryArtistId into the single pica_register_set call", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { work_id: "w1", recording_id: "r1", master_ownership: "created" };
      },
    } as unknown as import("../src/pica/mcpClient").PicaMcpClient;
    await registerSet(client, { ...input, primaryArtistId: "p9" });
    const reg = calls.find((c) => c.name === "pica_register_set");
    expect(reg!.args.primary_artist_id).toBe("p9");
  });

  it("registerSet omits primary_artist_id from pica_register_set when not provided", async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      callTool: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { work_id: "w1", recording_id: "r1", master_ownership: "created" };
      },
    } as unknown as import("../src/pica/mcpClient").PicaMcpClient;
    await registerSet(client, input);
    const reg = calls.find((c) => c.name === "pica_register_set");
    expect(reg!.args.primary_artist_id).toBeUndefined();
  });
});
