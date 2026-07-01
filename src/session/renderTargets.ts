// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

/** Minimal shape of a Live track for target derivation (kept structural so the
 *  pure functions are testable without the SDK). The real SDK track is passed
 *  through as `track` and handed back to renderPreFxAudio by the caller. */
export interface TrackLike {
  name?: string;
  className?: string;
  arrangementClips?: Array<{ endTime?: number }>;
  [key: string]: unknown;
}

export interface RenderTarget<T extends TrackLike = TrackLike> {
  track: T;
  name: string;
  include: boolean;
  label: string;
}

/** className is a static on AudioTrack/MidiTrack (on the constructor), so read it
 *  from `constructor.className`, falling back to an own `className`. Mirrors
 *  read.ts's classNameOf. */
function classNameOf(track: TrackLike): string | undefined {
  const fromCtor = (track?.constructor as { className?: string } | undefined)?.className;
  return fromCtor && fromCtor !== "Object" ? fromCtor : track?.className;
}

export function isAudioTrack(track: TrackLike): boolean {
  return classNameOf(track) === "AudioTrack";
}

/** Max arrangement-clip endTime (beats) across all tracks; 0 if no content. */
export function computeSongEnd(tracks: TrackLike[]): number {
  let end = 0;
  for (const t of tracks) {
    for (const c of t.arrangementClips ?? []) {
      if (typeof c.endTime === "number" && c.endTime > end) end = c.endTime;
    }
  }
  return end;
}

export function deriveRenderTargets<T extends TrackLike>(audioTracks: T[]): RenderTarget<T>[] {
  // Live audio tracks frequently share a name (default "Audio", and common
  // after freeze & flatten), so N tracks would otherwise all upload as the
  // same "<name>.wav" and collapse a real multi-stem session downstream.
  // Suffix an index on repeats so every stem gets a distinct name at capture.
  const counts = new Map<string, number>();
  return audioTracks.map((track) => {
    const base = (track.name ?? "").trim() || "untitled";
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    const name = n > 1 ? `${base} ${n}` : base;
    return { track, name, include: true, label: name };
  });
}
