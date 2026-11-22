// Copyright (c) 2025-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  READ_ONLY_TOOLS,
  readOnly,
  fetchWorkChoices,
  workLabel,
  workForPick,
  toRecordingChoices,
  toImportFiles,
  filesForRecording,
  formatLength,
  songTempo,
  songKey,
  tempoPlan,
  tempoChoice,
  keyNote,
  tempFileName,
  downloadToFile,
  trackName,
  ImportCancelled,
  type ImportFile,
} from "../src/pica/importFromPica";
import { PicaMcpClient } from "../src/pica/mcpClient";

const file = (over: Partial<ImportFile> = {}): ImportFile => ({
  id: "f1",
  label: "drums",
  fileType: "stem",
  durationSeconds: 187,
  bpm: null,
  key: "",
  recordingId: "r1",
  filename: "drums.wav",
  ...over,
});

describe("read-only on pica", () => {
  it("allows only query and inspect tools", () => {
    for (const t of READ_ONLY_TOOLS) expect(t).toMatch(/_(query|inspect)$/);
  });

  it("refuses any other tool before it reaches pica", () => {
    const callTool = vi.fn();
    const c = readOnly({ callTool } as unknown as PicaMcpClient);
    expect(() => c.read("pica_works_update" as never, {})).toThrow(/only read/);
    expect(callTool).not.toHaveBeenCalled();
  });

  it("gets a file's download address with one GET on its own playback-url", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ success: true, data: { url: "https://s3/x" } })));
    const c = readOnly(new PicaMcpClient({ baseUrl: "https://withpica.com", apiKey: "k" }, fetchFn as any));
    expect(await c.playbackUrl("a/b")).toBe("https://s3/x");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://withpica.com/api/admin/audio-files/a%2Fb/playback-url");
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
  });

  it("says so when the key can't read the audio", async () => {
    const fetchFn = vi.fn(async () => new Response("{}", { status: 403 }));
    const c = readOnly(new PicaMcpClient({ baseUrl: "https://withpica.com", apiKey: "k" }, fetchFn as any));
    await expect(c.playbackUrl("f1")).rejects.toThrow(/403/);
  });
});

describe("which song", () => {
  it("pages the caller's works and labels them title — artist", async () => {
    const calls: unknown[] = [];
    const c = {
      read: async (tool: string, args: any) => {
        calls.push([tool, args]);
        return { items: [{ id: "w1", title: "Wave", primary_artist: "Ivy" }, { id: "w2", title: "Tide" }] };
      },
    } as any;
    const works = await fetchWorkChoices(c);
    expect(calls).toEqual([["pica_works_query", { limit: 200, offset: 0 }]]);
    expect(works.map(workLabel)).toEqual(["Wave — Ivy", "Tide"]);
  });

  it("finds the picked song by label, or by a title only one song has", () => {
    const works = [
      { id: "w1", title: "Wave", artist: "Ivy" },
      { id: "w2", title: "Wave", artist: "Sol" },
      { id: "w3", title: "Tide", artist: "" },
    ];
    expect(workForPick("Wave — Sol", works)?.id).toBe("w2");
    expect(workForPick("tide", works)?.id).toBe("w3");
    expect(workForPick("Wave", works)).toBeUndefined(); // two songs share it
    expect(workForPick("", works)).toBeUndefined();
  });

  it("reads recordings by their recording_title", () => {
    expect(
      toRecordingChoices({ items: [{ id: "r1", recording_title: "Wave (master)", version_type: "original" }] }),
    ).toEqual([{ id: "r1", title: "Wave (master)", versionType: "original" }]);
  });
});

describe("which files", () => {
  it("offers the chosen recording's stems ticked and its master apart", () => {
    const files = toImportFiles({
      items: [
        { id: "s1", stem_label: "drums", file_type: "stem", recording_id: "r1", duration_seconds: 60 },
        { id: "m1", filename: "wave master.wav", file_type: "master", recording_id: "r1", detected_bpm: 120 },
        { id: "s2", stem_label: "bass", file_type: "stem", recording_id: "r2" },
        { id: "s3", stem_label: "vox", file_type: "stem", recording_id: "" },
      ],
    });
    const { stems, master } = filesForRecording(files, "r1");
    expect(stems.map((f) => f.id)).toEqual(["s1", "s3"]);
    expect(master?.id).toBe("m1");
    expect(master?.label).toBe("wave master");
    expect(filesForRecording(files, null).stems).toHaveLength(3);
  });

  it("shows lengths as m:ss", () => {
    expect(formatLength(187)).toBe("3:07");
    expect(formatLength(null)).toBe("");
  });
});

describe("tempo", () => {
  const fromAbleton = { capturedFrom: "ableton", tempo: 92, key: "A Minor" };

  it("takes the session's tempo first, then the master's measured one, then agreeing stems", () => {
    expect(songTempo(fromAbleton, [file({ fileType: "master", bpm: 184 })])).toEqual({ bpm: 92, source: "session" });
    expect(songTempo({}, [file({ fileType: "master", bpm: 184 })])).toEqual({ bpm: 184, source: "measured" });
    expect(songTempo(null, [file({ bpm: 120 }), file({ id: "f2", bpm: 120.3 })])).toEqual({ bpm: 120, source: "measured" });
    expect(songTempo(null, [file({ bpm: 120 }), file({ id: "f2", bpm: 90 })])).toBeNull();
    expect(songTempo({ capturedFrom: "other", tempo: 92 }, [])).toBeNull();
  });

  it("asks only when the tempo is known, the set has clips, and they differ", () => {
    const song = { bpm: 92, source: "session" as const };
    expect(tempoPlan(song, 120, true)).toEqual({ kind: "ask", song, sessionBpm: 120 });
    expect(tempoPlan(song, 120, false)).toEqual({ kind: "set", bpm: 92, asked: false });
    expect(tempoPlan(song, 92.3, true)).toEqual({ kind: "same", bpm: 92.3 });
    expect(tempoPlan(null, 120, true)).toEqual({ kind: "unknown" });
  });

  it("the song's tempo plays unwarped; keeping the set's tempo stretches", () => {
    const ask = tempoPlan({ bpm: 92, source: "measured" }, 120, true);
    expect(tempoChoice(ask, "song")).toEqual({ setTempo: 92, warp: false });
    expect(tempoChoice(ask)).toEqual({ setTempo: 92, warp: false }); // the default
    expect(tempoChoice(ask, "session")).toEqual({ setTempo: null, warp: true });
    expect(tempoChoice({ kind: "unknown" })).toEqual({ setTempo: null, warp: false });
    expect(tempoChoice({ kind: "set", bpm: 92, asked: false })).toEqual({ setTempo: 92, warp: false });
  });
});

describe("key", () => {
  const off = { rootNote: 0, scaleName: "Major", scaleMode: false };
  it("is only reported, naming the set's key when scale mode is on", () => {
    expect(keyNote({ key: "A Minor", source: "session" }, { ...off, scaleMode: true })).toBe(
      "the song is in A minor; your session is in C major. Ableton doesn't let pica change the key.",
    );
    expect(keyNote({ key: "A Minor", source: "session" }, off)).toBe("the song is in A minor.");
    expect(keyNote({ key: "C Major", source: "session" }, { ...off, scaleMode: true })).toBe("the song is in C major.");
    expect(keyNote({ key: "F", source: "measured" }, off)).toBe("the song is in F (measured).");
    expect(keyNote(null, off)).toBeNull();
  });

  it("takes the session's key first, then the master's", () => {
    expect(songKey({ capturedFrom: "ableton", key: "A Minor" }, [])).toEqual({ key: "A Minor", source: "session" });
    expect(songKey(null, [file({ fileType: "master", key: "F" })])).toEqual({ key: "F", source: "measured" });
  });
});

describe("download", () => {
  const dir = () => mkdtempSync(join(tmpdir(), "pica-import-"));
  const bytes = (n: number) => new Uint8Array(n).fill(7);

  it("writes the file and reports progress", async () => {
    const d = dir();
    const seen: Array<number | null> = [];
    const fetchFn = vi.fn(async () => new Response(bytes(1000), { headers: { "content-length": "1000" } }));
    const path = await downloadToFile(fetchFn as any, "https://s3/x", d, "a.wav", { onProgress: (f) => seen.push(f) });
    expect(readFileSync(path)).toHaveLength(1000);
    expect(seen.at(-1)).toBe(1);
  });

  it("removes the partial file and throws on a failed download", async () => {
    const d = dir();
    const fetchFn = vi.fn(async () => new Response("no", { status: 403 }));
    await expect(downloadToFile(fetchFn as any, "https://s3/x", d, "a.wav")).rejects.toThrow(/403/);
    expect(readdirSync(d)).toEqual([]);
  });

  it("a cancel stops the download and leaves no file", async () => {
    const d = dir();
    const ac = new AbortController();
    ac.abort();
    await expect(downloadToFile(vi.fn() as any, "https://s3/x", d, "a.wav", { signal: ac.signal })).rejects.toBeInstanceOf(
      ImportCancelled,
    );
    expect(existsSync(join(d, "a.wav"))).toBe(false);
  });

  it("names temp files safely and uniquely", () => {
    expect(tempFileName(file({ label: "lead vox / take 2", filename: "x.AIFF", id: "abcdef1234" }))).toBe(
      "pica-lead-vox-take-2-abcdef12.aiff",
    );
    expect(tempFileName(file({ label: "///", filename: "noext" }))).toBe("pica-audio-f1.wav");
  });

  it("names tracks after the stem, optionally with the song title", () => {
    expect(trackName(file(), "Wave", false)).toBe("drums");
    expect(trackName(file(), "Wave", true)).toBe("Wave — drums");
  });
});

import { fileFailureReason, importErrorMessage } from "../src/pica/importFromPica";

describe("what a failure says (never raw error text)", () => {
  it("one file: a fixed phrase per step", () => {
    expect(fileFailureReason("download")).toBe("the download didn't work");
    expect(fileFailureReason("add")).toBe("Ableton couldn't add it");
    expect(fileFailureReason(null)).toBe("something went wrong");
  });
  it("the whole import: pica's own message, else a fixed line", () => {
    expect(importErrorMessage('API request failed: 404 {"error":"work not found"}')).toBe("couldn't import: work not found");
    for (const raw of [
      "import may only read from pica (pica_works_update refused)",
      "PICA returned HTTP 500 for pica_works_query: <html>",
      "Network error calling /api/x: ECONNRESET",
    ]) {
      expect(importErrorMessage(raw)).toBe("couldn't import: something went wrong. try again, or open the song in pica.");
    }
  });
});
