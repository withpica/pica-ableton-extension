import { describe, it, expect } from "vitest";
import { deriveKey, buildMetadata, buildSummary, type SongSnapshot } from "../src/session/snapshot";

const sample: SongSnapshot = {
  tempo: 124.0,
  rootNote: 0, // C
  scaleName: "Minor",
  signatureNumerator: 4,
  signatureDenominator: 4,
  tracks: [
    { name: "Drums", type: "midi", deviceNames: ["Drum Rack"], sampleFilePaths: ["/s/kick.wav"] },
    { name: "Bass", type: "midi", deviceNames: ["Serum"], sampleFilePaths: [] },
    { name: "Vocal", type: "audio", deviceNames: ["EQ Eight"], sampleFilePaths: [] },
  ],
};

describe("deriveKey", () => {
  it("combines root note name and scale", () => {
    expect(deriveKey(0, "Minor")).toBe("C Minor");
    expect(deriveKey(7, "Major")).toBe("G Major");
  });
  it("wraps out-of-range root notes and tolerates empty scale", () => {
    expect(deriveKey(12, "")).toBe("C");
    expect(deriveKey(-1, "Major")).toBe("B Major");
  });
});

describe("buildMetadata", () => {
  it("captures tracks, devices, samples, tempo and derived key", () => {
    const m = buildMetadata(sample);
    expect(m).toMatchObject({
      capturedFrom: "ableton",
      tempo: 124,
      key: "C Minor",
      timeSignature: "4/4",
      trackCount: 3,
      sampleCount: 1,
    });
    expect(m.devices).toEqual(expect.arrayContaining(["Drum Rack", "Serum", "EQ Eight"]));
    expect((m.tracks as unknown[]).length).toBe(3);
  });
});

describe("buildSummary", () => {
  it("produces a human-readable one-liner", () => {
    const s = buildSummary(sample);
    expect(s).toContain("3 tracks");
    expect(s).toContain("124bpm");
    expect(s).toContain("C Minor");
    expect(s).toContain("captured from Ableton");
  });
});
