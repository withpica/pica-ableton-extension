import { describe, it, expect } from "vitest";
import { readSong, type SongLike } from "../src/session/read";

const fakeSong: SongLike = {
  tempo: 120,
  rootNote: 2, // D
  scaleName: "Dorian",
  tracks: [
    {
      name: "Drums",
      devices: [
        { name: "Drum Rack" },
        { name: "Simpler", sample: { filePath: "/s/snare.wav" } },
      ],
    },
    { name: "Synth", devices: [{ name: "Wavetable" }] },
  ],
};

describe("readSong", () => {
  it("flattens a Song-like object into a SongSnapshot", () => {
    const snap = readSong(fakeSong);
    expect(snap.tempo).toBe(120);
    expect(snap.rootNote).toBe(2);
    expect(snap.scaleName).toBe("Dorian");
    expect(snap.tracks).toHaveLength(2);
    expect(snap.tracks[0]!.deviceNames).toEqual(["Drum Rack", "Simpler"]);
    expect(snap.tracks[0]!.sampleFilePaths).toEqual(["/s/snare.wav"]);
    expect(snap.tracks[1]!.sampleFilePaths).toEqual([]);
  });
});
