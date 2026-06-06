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
export interface TrackLike {
  name: string;
  devices: DeviceLike[];
  // Present on group/midi/audio tracks; used only for classification when available.
  className?: string;
}
export interface SongLike {
  tempo: number;
  rootNote: number;
  scaleName: string;
  signatureNumerator?: number;
  signatureDenominator?: number;
  tracks: TrackLike[];
}

function classify(track: TrackLike): TrackKind {
  switch (track.className) {
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

function readTrack(track: TrackLike): TrackSnapshot {
  const deviceNames: string[] = [];
  const sampleFilePaths: string[] = [];
  for (const device of track.devices ?? []) {
    if (device?.name) deviceNames.push(device.name);
    const path = device?.sample?.filePath;
    if (typeof path === "string" && path.length > 0) sampleFilePaths.push(path);
  }
  return { name: track.name ?? "Untitled track", type: classify(track), deviceNames, sampleFilePaths };
}

/** Read a (structurally Song-like) Live Set into a plain SongSnapshot. */
export function readSong(song: SongLike): SongSnapshot {
  return {
    tempo: song.tempo,
    rootNote: song.rootNote,
    scaleName: song.scaleName,
    signatureNumerator: song.signatureNumerator,
    signatureDenominator: song.signatureDenominator,
    tracks: (song.tracks ?? []).map(readTrack),
  };
}
