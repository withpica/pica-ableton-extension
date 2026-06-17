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
  return audioTracks.map((track) => {
    const name = (track.name ?? "").trim() || "untitled";
    return { track, name, include: true, label: name };
  });
}
