// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect } from "vitest";
import { deriveParts } from "../src/session/parts";
import type { SongSnapshot, TrackSnapshot } from "../src/session/snapshot";

function track(over: Partial<TrackSnapshot> & { name: string }): TrackSnapshot {
  return {
    type: "audio",
    deviceNames: [],
    sampleFilePaths: [],
    groupIndex: null,
    clipCount: 0,
    ...over,
  };
}
const song = (tracks: TrackSnapshot[]): SongSnapshot =>
  ({ tempo: 120, rootNote: 0, scaleName: "Major", tracks });

describe("deriveParts", () => {
  it("includes tracks with devices or clips; drops empty utility tracks", () => {
    const parts = deriveParts(
      song([
        track({ name: "EBass", deviceNames: ["EQ Eight"] }),
        track({ name: "Vox", clipCount: 2 }),
        track({ name: "CUES" }), // no devices, no clips → dropped
      ]),
    );
    expect(parts.map((p) => p.trackName)).toEqual(["EBass", "Vox"]);
  });

  it("folds a group into one Part and suppresses its children", () => {
    const parts = deriveParts(
      song([
        track({ name: "Drums" }), // index 0 — group parent
        track({ name: "Kick", deviceNames: ["EQ Eight"], groupIndex: 0 }),
        track({ name: "Snare", clipCount: 1, groupIndex: 0 }),
      ]),
    );
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      trackName: "Drums",
      kind: "group",
      instrumentLabel: "Drums",
    });
    expect(parts[0]!.deviceNames).toEqual(["EQ Eight"]);
  });

  it("drops a group whose children are all empty", () => {
    const parts = deriveParts(
      song([
        track({ name: "STRUCTURE" }),
        track({ name: "Marker A", groupIndex: 0 }),
      ]),
    );
    expect(parts).toHaveLength(0);
  });

  it("derives kind from track type (midi → instrument, audio/other → audio)", () => {
    const parts = deriveParts(
      song([
        track({ name: "Keys", type: "midi", deviceNames: ["Operator"] }),
        track({ name: "Gtr", type: "other", clipCount: 1 }),
      ]),
    );
    expect(parts[0]!.kind).toBe("instrument");
    expect(parts[1]!.kind).toBe("audio");
  });

  it("uses stable index-prefixed keys and basenames for sample files", () => {
    const parts = deriveParts(
      song([
        track({
          name: " Vox ",
          clipCount: 1,
          sampleFilePaths: ["/takes/vox_take3.wav"],
        }),
      ]),
    );
    expect(parts[0]!.key).toBe("0:Vox");
    expect(parts[0]!.sampleFiles).toEqual(["vox_take3.wav"]);
  });
});
