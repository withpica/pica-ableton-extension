// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import type { SongSnapshot, TrackSnapshot } from "./snapshot";

/**
 * A performed part of the Set — the unit the attribution checklist shows one
 * row for. Pure derivation from the snapshot: groups fold to one Part, empty
 * utility tracks drop out, everything else stays (the human can delete rows
 * the detector got wrong — resilient include beats clever exclude, per the
 * 2026-06-12 field finding that real Sets classify unevenly).
 */
export interface Part {
  /** Stable re-run anchor: `${trackIndex}:${trimmedName}`. */
  key: string;
  /** Pre-filled, editable instrument label (the track/group name). */
  instrumentLabel: string;
  trackName: string;
  deviceNames: string[];
  sampleFiles: string[]; // basenames, context only
  kind: "instrument" | "audio" | "group";
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function performs(t: TrackSnapshot): boolean {
  return t.deviceNames.length > 0 || t.clipCount > 0;
}

function kindOf(t: TrackSnapshot): "instrument" | "audio" {
  return t.type === "midi" ? "instrument" : "audio";
}

export function deriveParts(snapshot: SongSnapshot): Part[] {
  const tracks = snapshot.tracks;
  const groupParents = new Set<number>();
  for (const t of tracks) {
    if (t.groupIndex != null) groupParents.add(t.groupIndex);
  }

  const parts: Part[] = [];
  tracks.forEach((t, i) => {
    const name = (t.name ?? "").trim() || "Untitled track";

    if (groupParents.has(i)) {
      // Group parent: one Part folding its children. Include only when the
      // group carries any performance at all.
      const children = tracks.filter((c) => c.groupIndex === i);
      const members = [t, ...children];
      if (!members.some(performs)) return;
      const deviceNames = Array.from(
        new Set(members.flatMap((m) => m.deviceNames)),
      );
      const sampleFiles = Array.from(
        new Set(members.flatMap((m) => m.sampleFilePaths.map(basename))),
      );
      parts.push({
        key: `${i}:${name}`,
        instrumentLabel: name,
        trackName: name,
        deviceNames,
        sampleFiles,
        kind: "group",
      });
      return;
    }

    if (t.groupIndex != null) return; // folded into its parent
    if (!performs(t)) return; // empty utility track

    parts.push({
      key: `${i}:${name}`,
      instrumentLabel: name,
      trackName: name,
      deviceNames: t.deviceNames,
      sampleFiles: t.sampleFilePaths.map(basename),
      kind: kindOf(t),
    });
  });
  return parts;
}
