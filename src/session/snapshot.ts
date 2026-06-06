// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

export type TrackKind = "audio" | "midi" | "group" | "other";

export interface TrackSnapshot {
  name: string;
  type: TrackKind;
  deviceNames: string[];
  sampleFilePaths: string[];
}

export interface SongSnapshot {
  tempo: number;
  rootNote: number; // 0..11 (C..B), per Song.rootNote
  scaleName: string;
  signatureNumerator?: number;
  signatureDenominator?: number;
  tracks: TrackSnapshot[];
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Map Live's rootNote (0..11) + scaleName to a key string like "C Minor". */
export function deriveKey(rootNote: number, scaleName: string): string {
  const idx = ((Math.trunc(rootNote) % 12) + 12) % 12;
  const note = NOTE_NAMES[idx] ?? "C";
  const scale = (scaleName ?? "").trim();
  return scale ? `${note} ${scale}` : note;
}

/** Distinct device names across all tracks, order-preserved. */
function distinctDevices(s: SongSnapshot): string[] {
  return Array.from(new Set(s.tracks.flatMap((t) => t.deviceNames)));
}

/** The full structured snapshot persisted to works.metadata. */
export function buildMetadata(s: SongSnapshot): Record<string, unknown> {
  const sampleCount = s.tracks.reduce((n, t) => n + t.sampleFilePaths.length, 0);
  return {
    capturedFrom: "ableton",
    tempo: Math.round(s.tempo),
    key: deriveKey(s.rootNote, s.scaleName),
    timeSignature:
      s.signatureNumerator && s.signatureDenominator
        ? `${s.signatureNumerator}/${s.signatureDenominator}`
        : undefined,
    trackCount: s.tracks.length,
    sampleCount,
    devices: distinctDevices(s),
    tracks: s.tracks.map((t) => ({
      name: t.name,
      type: t.type,
      devices: t.deviceNames,
      samples: t.sampleFilePaths,
    })),
  };
}

/** Short human-readable line for the confirm panel + the work's notes field. */
export function buildSummary(s: SongSnapshot): string {
  const audio = s.tracks.filter((t) => t.type === "audio").length;
  const midi = s.tracks.filter((t) => t.type === "midi").length;
  const samples = s.tracks.reduce((n, t) => n + t.sampleFilePaths.length, 0);
  const devices = distinctDevices(s);

  const parts: string[] = [`${s.tracks.length} tracks`];
  if (audio || midi) parts.push(`${audio} audio / ${midi} midi`);
  if (samples) parts.push(`${samples} samples`);
  if (devices.length) {
    parts.push(`made with ${devices.slice(0, 3).join(", ")}${devices.length > 3 ? "…" : ""}`);
  }
  parts.push(`${Math.round(s.tempo)}bpm`, deriveKey(s.rootNote, s.scaleName));
  return `${parts.join(" · ")} · captured from Ableton`;
}
