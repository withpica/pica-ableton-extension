// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect } from "vitest";
import { derivePartTree } from "../src/session/parts";
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

describe("derivePartTree", () => {
  it("includes leaf tracks with devices or clips; drops empty utility tracks", () => {
    const tree = derivePartTree(
      song([
        track({ name: "EBass", deviceNames: ["EQ Eight"] }),
        track({ name: "Vox", clipCount: 2 }),
        track({ name: "CUES" }), // no devices, no clips → dropped
      ]),
    );
    expect(tree.map((n) => n.trackName)).toEqual(["EBass", "Vox"]);
    expect(tree.every((n) => n.children === undefined)).toBe(true);
  });

  it("builds a group node holding its performing children", () => {
    const tree = derivePartTree(
      song([
        track({ name: "Drums", sampleFilePaths: ["/drum/loop.wav"] }), // index 0 — group parent with its own sample
        track({ name: "Kick", deviceNames: ["EQ Eight"], groupIndex: 0 }),
        track({ name: "Snare", clipCount: 1, groupIndex: 0 }),
      ]),
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ trackName: "Drums", kind: "group", instrumentLabel: "Drums" });
    expect(tree[0]!.children!.map((c) => c.trackName)).toEqual(["Kick", "Snare"]);
    // group aggregates descendant devices for context
    expect(tree[0]!.deviceNames).toEqual(["EQ Eight"]);
    // group aggregates its OWN sample files alongside descendants'
    expect(tree[0]!.sampleFiles).toContain("loop.wav");
  });

  it("drops a non-performing child but keeps the group if a sibling performs", () => {
    const tree = derivePartTree(
      song([
        track({ name: "GTRS" }),
        track({ name: "rhythm", deviceNames: ["Amp"], groupIndex: 0 }),
        track({ name: "muted-take", groupIndex: 0 }), // no devices/clips → dropped
      ]),
    );
    expect(tree[0]!.children!.map((c) => c.trackName)).toEqual(["rhythm"]);
  });

  it("drops a group whose descendants are all empty", () => {
    const tree = derivePartTree(
      song([
        track({ name: "STRUCTURE" }),
        track({ name: "Marker A", groupIndex: 0 }),
      ]),
    );
    expect(tree).toHaveLength(0);
  });

  it("nests recursively: a group inside a group", () => {
    const tree = derivePartTree(
      song([
        track({ name: "DRUMS" }), // 0 top group
        track({ name: "Live Drums", groupIndex: 0 }), // 1 sub-group (child of 0)
        track({ name: "Kick", deviceNames: ["EQ"], groupIndex: 1 }), // 2 leaf in sub-group
      ]),
    );
    expect(tree).toHaveLength(1);
    expect(tree[0]!.kind).toBe("group");
    const sub = tree[0]!.children![0]!;
    expect(sub).toMatchObject({ trackName: "Live Drums", kind: "group" });
    expect(sub.children!.map((c) => c.trackName)).toEqual(["Kick"]);
  });

  it("derives leaf kind from track type (midi → instrument, audio/other → audio)", () => {
    const tree = derivePartTree(
      song([
        track({ name: "Keys", type: "midi", deviceNames: ["Operator"] }),
        track({ name: "Gtr", type: "other", clipCount: 1 }),
      ]),
    );
    expect(tree[0]!.kind).toBe("instrument");
    expect(tree[1]!.kind).toBe("audio");
  });

  it("uses stable index-prefixed keys and basenames for sample files", () => {
    const tree = derivePartTree(
      song([
        track({ name: "Pad", deviceNames: ["Reverb"] }),
        track({ name: " Vox ", clipCount: 1, sampleFilePaths: ["/takes/vox_take3.wav"] }),
      ]),
    );
    expect(tree[1]!.key).toBe("1:Vox");
    expect(tree[1]!.sampleFiles).toEqual(["vox_take3.wav"]);
  });
});
