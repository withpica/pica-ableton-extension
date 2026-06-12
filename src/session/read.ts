// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import type { SongSnapshot, TrackKind, TrackSnapshot } from "./snapshot";

/**
 * Minimal structural views of the SDK objects we read. The concrete SDK
 * `Song`/`Track`/`Device`/`Simpler` instances satisfy these shapes, so the real
 * `context.application.song` can be passed straight in. Kept loose on purpose —
 * we only read; we never mutate.
 */
export interface DeviceLike {
  name: string;
  // Simpler devices expose a sample; everything else doesn't.
  sample?: { filePath: string } | null;
}
export interface ClipLike {
  filePath?: string;
}
export interface ClipSlotLike {
  clip?: ClipLike | null;
}
export interface TrackLike {
  name: string;
  devices: DeviceLike[];
  // Present on group/midi/audio tracks; used only for classification when available.
  className?: string;
  clipSlots?: ClipSlotLike[];
  arrangementClips?: ClipLike[];
  groupTrack?: TrackLike | null;
}
export interface SongLike {
  tempo: number;
  rootNote: number;
  scaleName: string;
  signatureNumerator?: number;
  signatureDenominator?: number;
  tracks: TrackLike[];
}

/**
 * Read the effective className for a track.
 *
 * The SDK declares `className` as a STATIC on AudioTrack / MidiTrack / GroupTrack,
 * so `track.className` on an actual instance returns `undefined` (the property
 * lives on the class, not the prototype chain). Reading `track.constructor.className`
 * hits the static. The instance-property fallback keeps plain-object fakes (whose
 * constructor is Object with no `className` static) working without change.
 */
function classNameOf(track: TrackLike): string | undefined {
  const fromCtor = (track?.constructor as { className?: string } | undefined)?.className;
  return fromCtor && fromCtor !== "Object" ? fromCtor : track?.className;
}

function classify(track: TrackLike): TrackKind {
  switch (classNameOf(track)) {
    case "AudioTrack":
      return "audio";
    case "MidiTrack":
      return "midi";
    case "GroupTrack":
      return "group";
    default:
      return "other";
  }
}

function readTrack(track: TrackLike, groupIndex: number | null): TrackSnapshot {
  const deviceNames: string[] = [];
  const sampleFilePaths: string[] = [];
  for (const device of track.devices ?? []) {
    if (device?.name) deviceNames.push(device.name);
    const path = device?.sample?.filePath;
    if (typeof path === "string" && path.length > 0) sampleFilePaths.push(path);
  }

  // Count clips and collect audio-clip file paths from session clip slots and
  // arrangement clips. Null/empty slots are skipped.
  let clipCount = 0;
  for (const slot of track.clipSlots ?? []) {
    const clip = slot?.clip;
    if (!clip) continue;
    clipCount += 1;
    if (typeof clip.filePath === "string" && clip.filePath.length > 0) {
      sampleFilePaths.push(clip.filePath);
    }
  }
  for (const clip of track.arrangementClips ?? []) {
    clipCount += 1;
    if (typeof clip?.filePath === "string" && clip.filePath.length > 0) {
      sampleFilePaths.push(clip.filePath);
    }
  }

  return {
    name: track.name ?? "Untitled track",
    type: classify(track),
    deviceNames,
    sampleFilePaths,
    groupIndex,
    clipCount,
  };
}

/** Read a (structurally Song-like) Live Set into a plain SongSnapshot. */
export function readSong(song: SongLike): SongSnapshot {
  const rawTracks = song.tracks ?? [];
  // Build an identity map so we can resolve groupTrack references to their index.
  const indexByTrack = new Map<TrackLike, number>(rawTracks.map((t, i) => [t, i]));
  return {
    tempo: song.tempo,
    rootNote: song.rootNote,
    scaleName: song.scaleName,
    signatureNumerator: song.signatureNumerator,
    signatureDenominator: song.signatureDenominator,
    tracks: rawTracks.map((t) => {
      const parent = t.groupTrack ?? null;
      const groupIndex = parent ? (indexByTrack.get(parent) ?? null) : null;
      return readTrack(t, groupIndex);
    }),
  };
}
