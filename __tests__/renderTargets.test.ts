// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.
import { describe, it, expect } from "vitest";
import { isAudioTrack, computeSongEnd, deriveRenderTargets } from "../src/session/renderTargets";

const audioViaCtor = { name: "Drums", constructor: { className: "AudioTrack" } };
const audioViaProp = { name: "Vox", className: "AudioTrack" };
const midi = { name: "Keys", constructor: { className: "MidiTrack" } };
const group = { name: "Bus", constructor: { className: "GroupTrack" } };

describe("isAudioTrack", () => {
  it("is true for AudioTrack via constructor static or own property", () => {
    expect(isAudioTrack(audioViaCtor)).toBe(true);
    expect(isAudioTrack(audioViaProp)).toBe(true);
  });
  it("is false for MIDI / group / plain objects", () => {
    expect(isAudioTrack(midi)).toBe(false);
    expect(isAudioTrack(group)).toBe(false);
    expect(isAudioTrack({ name: "x" })).toBe(false);
  });
});

describe("computeSongEnd", () => {
  it("is the max arrangement-clip endTime across all tracks", () => {
    const tracks = [
      { arrangementClips: [{ endTime: 16 }, { endTime: 32 }] },
      { arrangementClips: [{ endTime: 64 }] },
      { arrangementClips: [] },
      {},
    ];
    expect(computeSongEnd(tracks)).toBe(64);
  });
  it("is 0 when there is no arrangement content", () => {
    expect(computeSongEnd([{ arrangementClips: [] }, {}])).toBe(0);
  });
});

describe("deriveRenderTargets", () => {
  it("maps each audio track to an included target labelled by name", () => {
    const t = deriveRenderTargets([audioViaCtor, audioViaProp]);
    expect(t).toEqual([
      { track: audioViaCtor, name: "Drums", include: true, label: "Drums" },
      { track: audioViaProp, name: "Vox", include: true, label: "Vox" },
    ]);
  });
  it("falls back to 'untitled' for a blank name", () => {
    const t = deriveRenderTargets([{ name: "  ", className: "AudioTrack" }]);
    expect(t[0]!.name).toBe("untitled");
    expect(t[0]!.label).toBe("untitled");
  });
  it("disambiguates duplicate track names so each stem gets a distinct label", () => {
    // Common after freeze & flatten: every track named the same.
    const t = deriveRenderTargets([
      { name: "tracking", className: "AudioTrack" },
      { name: "tracking", className: "AudioTrack" },
      { name: "tracking", className: "AudioTrack" },
    ]);
    expect(t.map((x) => x.label)).toEqual(["tracking", "tracking 2", "tracking 3"]);
    expect(t.map((x) => x.name)).toEqual(["tracking", "tracking 2", "tracking 3"]);
  });
  it("counts blanks-as-untitled together when disambiguating", () => {
    const t = deriveRenderTargets([
      { name: "", className: "AudioTrack" },
      { name: "  ", className: "AudioTrack" },
    ]);
    expect(t.map((x) => x.label)).toEqual(["untitled", "untitled 2"]);
  });
});
