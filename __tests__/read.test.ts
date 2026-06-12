import { describe, it, expect } from "vitest";
import { readSong, type SongLike, type TrackLike } from "../src/session/read";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal SongLike with the given tracks. */
function baseSong(tracks: TrackLike[]): SongLike {
  return { tempo: 120, rootNote: 0, scaleName: "Major", tracks };
}

// ---------------------------------------------------------------------------
// Plain-object fake (pre-existing style — no static className)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SDK-style fakes — className is a STATIC on the class, not an instance prop
// ---------------------------------------------------------------------------

class FakeAudioTrack {
  static readonly className = "AudioTrack";
  groupTrack: TrackLike | null = null;
  constructor(
    public name: string,
    public devices: Array<{ name: string }> = [],
    public clipSlots: Array<{ clip: { filePath?: string } | null }> = [],
    public arrangementClips: Array<{ filePath?: string }> = [],
  ) {}
}

class FakeMidiTrack {
  static readonly className = "MidiTrack";
  groupTrack: TrackLike | null = null;
  clipSlots: Array<{ clip: unknown | null }> = [];
  arrangementClips: unknown[] = [];
  constructor(
    public name: string,
    public devices: Array<{ name: string }> = [],
  ) {}
}

describe("readSong — static className discrimination (2026-06-12 field finding)", () => {
  it("classifies real SDK-style tracks via constructor.className", () => {
    const snap = readSong(baseSong([
      new FakeAudioTrack("Bass") as unknown as TrackLike,
      new FakeMidiTrack("Keys") as unknown as TrackLike,
    ]));
    expect(snap.tracks[0]!.type).toBe("audio");
    expect(snap.tracks[1]!.type).toBe("midi");
  });
});

describe("readSong — group membership", () => {
  it("records the parent track's index as groupIndex", () => {
    const drums = new FakeAudioTrack("Drums");
    const kick = new FakeAudioTrack("Kick", [{ name: "EQ Eight" }]);
    kick.groupTrack = drums as unknown as TrackLike;
    const snap = readSong(baseSong([
      drums as unknown as TrackLike,
      kick as unknown as TrackLike,
    ]));
    expect(snap.tracks[0]!.groupIndex).toBeNull();
    expect(snap.tracks[1]!.groupIndex).toBe(0);
  });
});

describe("readSong — clips", () => {
  it("counts session and arrangement clips and collects audio clip file paths", () => {
    const t = new FakeAudioTrack(
      "Vox",
      [],
      [{ clip: { filePath: "/takes/vox_take3.wav" } }, { clip: null }],
      [{ filePath: "/takes/vox_comp.wav" }],
    );
    const snap = readSong(baseSong([t as unknown as TrackLike]));
    expect(snap.tracks[0]!.clipCount).toBe(2);
    expect(snap.tracks[0]!.sampleFilePaths).toEqual([
      "/takes/vox_take3.wav",
      "/takes/vox_comp.wav",
    ]);
  });
});
