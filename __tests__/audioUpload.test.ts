// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.
import { describe, it, expect } from "vitest";
import {
  MAX_UPLOAD_BYTES, exceedsCap, contentTypeFor, presignedArgs, completeArgs, uploadRenderedStem,
} from "../src/pica/audioUpload";

describe("contentTypeFor", () => {
  it("maps known audio extensions, defaults to wav", () => {
    expect(contentTypeFor("a.wav")).toBe("audio/wav");
    expect(contentTypeFor("a.mp3")).toBe("audio/mpeg");
    expect(contentTypeFor("a.flac")).toBe("audio/flac");
    expect(contentTypeFor("a.aiff")).toBe("audio/aiff");
    expect(contentTypeFor("MY.WAV")).toBe("audio/wav");
    expect(contentTypeFor("noext")).toBe("audio/wav");
  });
});

describe("exceedsCap", () => {
  it("is true above 800MB", () => {
    expect(exceedsCap(MAX_UPLOAD_BYTES)).toBe(false);
    expect(exceedsCap(MAX_UPLOAD_BYTES + 1)).toBe(true);
  });
});

describe("presignedArgs", () => {
  it("builds a stem presign payload with the work_id", () => {
    expect(presignedArgs({ filename: "Drums.wav", fileSize: 123, workId: "w1" })).toEqual({
      filename: "Drums.wav", content_type: "audio/wav", file_size: 123, file_type: "stem", work_id: "w1",
    });
  });
});

describe("completeArgs", () => {
  it("links the stem to the recording with its label", () => {
    expect(completeArgs({
      uploadId: "u1", key: "k", bucket: "b", filename: "Drums.wav", fileSize: 123, recordingId: "r1", stemLabel: "Drums",
    })).toEqual({
      upload_id: "u1", key: "k", bucket: "b", content_type: "audio/wav",
      file_size: 123, recording_id: "r1", file_type: "stem", stem_label: "Drums",
    });
  });
});

describe("uploadRenderedStem", () => {
  function harness(putOk = true) {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = { callTool: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "pica_audio_presigned_upload") return { upload_url: "https://s3/put", upload_id: "u1", key: "k", bucket: "b" };
      if (name === "pica_audio_complete_upload") return { id: "f1" };
      return {};
    } } as unknown as import("../src/pica/mcpClient").PicaMcpClient;
    const fetchFn = (async () => ({ ok: putOk, status: putOk ? 200 : 500 })) as unknown as typeof fetch;
    const openStream = (_p: string) => ("STREAM" as unknown as import("node:fs").ReadStream);
    return { calls, client, fetchFn, openStream };
  }

  it("presigns, PUTs, completes (linked to recording), and analyzes", async () => {
    const h = harness();
    const out = await uploadRenderedStem(
      { client: h.client, fetchFn: h.fetchFn, openStream: h.openStream },
      { wavPath: "/tmp/Drums.wav", fileName: "Drums.wav", fileSize: 10, recordingId: "r1", workId: "w1", stemLabel: "Drums" },
    );
    expect(out.fileId).toBe("f1");
    expect(h.calls.map((c) => c.name)).toEqual([
      "pica_audio_presigned_upload", "pica_audio_complete_upload", "pica_audio_analyze",
    ]);
    expect(h.calls[1]!.args).toMatchObject({ recording_id: "r1", file_type: "stem", stem_label: "Drums", file_size: 10 });
    expect(h.calls[2]!.args).toEqual({ file_id: "f1" });
  });

  it("throws if the S3 PUT fails (and does not complete)", async () => {
    const h = harness(false);
    await expect(uploadRenderedStem(
      { client: h.client, fetchFn: h.fetchFn, openStream: h.openStream },
      { wavPath: "/tmp/x.wav", fileName: "x.wav", fileSize: 10, recordingId: "r1", workId: "w1", stemLabel: "x" },
    )).rejects.toThrow(/PUT failed/);
    expect(h.calls.map((c) => c.name)).toEqual(["pica_audio_presigned_upload"]);
  });
});
