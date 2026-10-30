// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

/**
 * Exporting stems over a section of the Set, between two locators.
 *
 * The Extensions SDK gives an extension no access to Live's loop brace or a
 * time selection, so the founder's ask, "can it export the cycle that's
 * highlighted" (2026-10-30), is answered with locators (cue points), which
 * the SDK does expose: the stems window offers "whole song" or "from
 * [locator] to [locator]". Times are in beats, as renderPreFxAudio takes them.
 */

export interface CueLike {
  time?: number;
  name?: string;
}

export interface LocatorOption {
  /** Position in the sorted list; the dialog's choice refers to this. */
  index: number;
  name: string;
  /** In beats. */
  time: number;
}

/** "end of song" as a `to` choice. */
export const SONG_END = -1;

export type RangeChoice =
  | { mode: "whole" }
  | { mode: "locators"; from: number; to: number };

/** Locators in arrangement order, unnamed ones labelled by their position. */
export function locatorOptions(cues: CueLike[]): LocatorOption[] {
  return cues
    .filter((c): c is { time: number; name?: string } =>
      typeof c?.time === "number" && Number.isFinite(c.time) && c.time >= 0,
    )
    .sort((a, b) => a.time - b.time)
    .map((c, index) => ({
      index,
      time: c.time,
      name: (c.name ?? "").trim() || `locator at beat ${Math.round(c.time * 100) / 100}`,
    }));
}

/**
 * The beat range to render, or a plain-English reason it cannot be used.
 * `to` may be SONG_END. A range must start before it ends and before the
 * song's last clip ends, or it would render only silence.
 */
export function resolveRange(
  choice: RangeChoice,
  options: LocatorOption[],
  songEnd: number,
): { start: number; end: number; label: string } | { error: string } {
  if (choice.mode === "whole") return { start: 0, end: songEnd, label: "whole song" };
  const from = options[choice.from];
  if (!from) return { error: "pick the locator the section starts at." };
  const to = choice.to === SONG_END ? null : options[choice.to];
  if (choice.to !== SONG_END && !to) return { error: "pick the locator the section ends at." };
  if (from.time >= songEnd) {
    return { error: `"${from.name}" is after the last clip in the arrangement, so there is nothing to export there.` };
  }
  const end = to ? to.time : songEnd;
  if (end <= from.time) {
    return { error: `"${to ? to.name : "end of song"}" is not after "${from.name}". pick an end that comes later.` };
  }
  return {
    start: from.time,
    end,
    label: `${from.name} to ${to ? to.name : "end of song"}`,
  };
}

/** The locator after `fromIndex`, else end of song: the dialog's default end. */
export function defaultEnd(options: LocatorOption[], fromIndex: number): number {
  return options[fromIndex + 1] ? fromIndex + 1 : SONG_END;
}
