// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect } from "vitest";
import { locatorOptions, resolveRange, defaultEnd, SONG_END } from "../src/session/locatorRange";

const CUES = [
  { time: 64, name: "CH" },
  { time: 0, name: "INTRO" },
  { time: 16, name: "V1" },
  { time: 96, name: "" },
];

describe("locatorOptions", () => {
  it("sorts by position and names unnamed locators by where they are", () => {
    expect(locatorOptions(CUES).map((o) => o.name)).toEqual([
      "INTRO",
      "V1",
      "CH",
      "locator at beat 96",
    ]);
  });
  it("drops locators with no usable time", () => {
    expect(locatorOptions([{ name: "x" }, { time: -1 }, { time: NaN }])).toEqual([]);
  });
});

describe("resolveRange", () => {
  const opts = locatorOptions(CUES);
  const SONG = 128;

  it("whole song renders from 0 to the end of the last clip", () => {
    expect(resolveRange({ mode: "whole" }, opts, SONG)).toEqual({ start: 0, end: SONG, label: "whole song" });
  });

  it("between two locators renders exactly that section", () => {
    expect(resolveRange({ mode: "locators", from: 1, to: 2 }, opts, SONG)).toEqual({
      start: 16,
      end: 64,
      label: "V1 to CH",
    });
  });

  it("a locator to the end of the song", () => {
    expect(resolveRange({ mode: "locators", from: 2, to: SONG_END }, opts, SONG)).toEqual({
      start: 64,
      end: SONG,
      label: "CH to end of song",
    });
  });

  it("refuses an end that is not after the start, in plain words", () => {
    expect(resolveRange({ mode: "locators", from: 2, to: 1 }, opts, SONG)).toEqual({
      error: '"V1" is not after "CH". pick an end that comes later.',
    });
  });

  it("refuses a start after the last clip, which would export silence", () => {
    expect(resolveRange({ mode: "locators", from: 3, to: SONG_END }, opts, 80)).toEqual({
      error: '"locator at beat 96" is after the last clip in the arrangement, so there is nothing to export there.',
    });
  });

  it("refuses a missing locator", () => {
    expect(resolveRange({ mode: "locators", from: 9, to: SONG_END }, opts, SONG)).toHaveProperty("error");
  });
});

describe("defaultEnd", () => {
  const opts = locatorOptions(CUES);
  it("is the next locator, else the end of the song", () => {
    expect(defaultEnd(opts, 1)).toBe(2);
    expect(defaultEnd(opts, 3)).toBe(SONG_END);
  });
});
