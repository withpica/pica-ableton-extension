// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import { detectSpliceSamples, saveSpliceSamples } from "../src/pica/samples";
import type { SongSnapshot } from "../src/session/snapshot";
import { PicaMcpError } from "../src/pica/mcpClient";

function fakeClient() {
  return { callTool: vi.fn() } as unknown as import("../src/pica/mcpClient").PicaMcpClient & {
    callTool: ReturnType<typeof vi.fn>;
  };
}

/** A snapshot whose tracks carry the given sampleFilePaths (one array per track). */
const snap = (perTrack: string[][]): SongSnapshot => ({
  tempo: 120,
  rootNote: 0,
  scaleName: "Major",
  tracks: perTrack.map((paths, i) => ({
    name: `t${i}`,
    type: "audio",
    deviceNames: [],
    sampleFilePaths: paths,
    groupIndex: null,
    clipCount: 0,
  })),
});

describe("detectSpliceSamples", () => {
  it("matches a sample under a macOS Splice folder", () => {
    const out = detectSpliceSamples(snap([["/Users/me/Splice/sounds/packs/x/kick.wav"]]));
    expect(out).toEqual([{ sampleName: "kick.wav", filePath: "/Users/me/Splice/sounds/packs/x/kick.wav" }]);
  });

  it("matches a Windows-backslash Splice path", () => {
    const out = detectSpliceSamples(snap([["C:\\Users\\me\\Splice\\sounds\\snare.wav"]]));
    expect(out.map((s) => s.sampleName)).toEqual(["snare.wav"]);
  });

  it("is case-insensitive on the folder name", () => {
    const out = detectSpliceSamples(snap([["/users/me/splice/loops/hat.wav"]]));
    expect(out.map((s) => s.sampleName)).toEqual(["hat.wav"]);
  });

  it("rejects a file merely NAMED splice_* under a non-Splice folder", () => {
    expect(detectSpliceSamples(snap([["/Users/me/Music/splice_kick.wav"]]))).toEqual([]);
  });

  it("rejects a file literally named 'Splice' under a non-Splice folder (folder match drops the basename)", () => {
    expect(detectSpliceSamples(snap([["/Users/me/loops/Splice"]]))).toEqual([]);
  });

  it("rejects a path with no Splice folder", () => {
    expect(detectSpliceSamples(snap([["/Users/me/Music/kick.wav"]]))).toEqual([]);
  });

  it("dedupes the same basename across tracks, keeping the first occurrence", () => {
    const out = detectSpliceSamples(snap([["/a/Splice/kick.wav"], ["/b/Splice/kick.wav"]]));
    expect(out).toEqual([{ sampleName: "kick.wav", filePath: "/a/Splice/kick.wav" }]);
  });

  it("picks up multiple Splice samples (clip + device paths both live in sampleFilePaths)", () => {
    const out = detectSpliceSamples(snap([["/a/Splice/clip.wav", "/b/Splice/synth.wav"]]));
    expect(out.map((s) => s.sampleName).sort()).toEqual(["clip.wav", "synth.wav"]);
  });

  it("returns [] when the Set uses no Splice samples", () => {
    expect(detectSpliceSamples(snap([[], ["/x/Music/loop.wav"]]))).toEqual([]);
  });
});

describe("saveSpliceSamples", () => {
  const one = [{ sampleName: "kick.wav", filePath: "/a/Splice/kick.wav" }];

  it("logs one pica_recording_samples_add per sample with source=splice, clearance=not_required", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValue({ id: "rs1" });
    const out = await saveSpliceSamples(c, "r1", one);
    expect(c.callTool).toHaveBeenCalledWith("pica_recording_samples_add", {
      recording_id: "r1",
      source: "splice",
      sample_name: "kick.wav",
      clearance_status: "not_required",
    });
    expect(out).toEqual({ added: 1, failed: 0, errors: [] });
  });

  it("makes no calls and reports zero for an empty list", async () => {
    const c = fakeClient();
    const out = await saveSpliceSamples(c, "r1", []);
    expect(c.callTool).not.toHaveBeenCalled();
    expect(out).toEqual({ added: 0, failed: 0, errors: [] });
  });

  it("records a non-auth failure and continues with the rest", async () => {
    const c = fakeClient();
    c.callTool
      .mockRejectedValueOnce(new PicaMcpError("boom", "500"))
      .mockResolvedValueOnce({ id: "rs2" });
    const out = await saveSpliceSamples(c, "r1", [
      { sampleName: "a.wav", filePath: "/x/Splice/a.wav" },
      { sampleName: "b.wav", filePath: "/x/Splice/b.wav" },
    ]);
    expect(out.added).toBe(1);
    expect(out.failed).toBe(1);
    expect(out.errors[0]).toContain("boom");
  });

  it("rethrows a 401 so the reconnect path can re-run (idempotent adds make that safe)", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValueOnce(new PicaMcpError("unauthorized", "401"));
    await expect(saveSpliceSamples(c, "r1", one)).rejects.toBeInstanceOf(PicaMcpError);
  });
});
