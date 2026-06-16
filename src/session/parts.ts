// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import type { SongSnapshot, TrackSnapshot } from "./snapshot";

/**
 * A node in the credit tree. A leaf is one performing track; a group folds its
 * children but is itself a node (creditable as a whole when collapsed, or by
 * its parts when expanded — the dialog decides). The hierarchy mirrors Live's
 * group/folder tracks; `children` is present iff `kind === "group"`.
 */
export interface PartNode {
  /** Stable re-run anchor: `${trackIndex}:${trimmedName}`. */
  key: string;
  /** Pre-filled, editable instrument label (the track/group name). */
  instrumentLabel: string;
  trackName: string;
  kind: "instrument" | "audio" | "group";
  /** Own (leaf) or aggregated descendant (group) device names — context only. */
  deviceNames: string[];
  /** Basenames — context only. */
  sampleFiles: string[];
  children?: PartNode[];
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

/**
 * Build the credit tree from a snapshot. The snapshot is flat with each track
 * carrying `groupIndex` (its immediate parent's index, or null). A track that
 * is some other track's parent becomes a group node; everything else is a leaf.
 * Inclusion: a leaf is kept iff it performs (has devices or clips); a group is
 * kept iff it has at least one kept descendant. Empty/utility tracks and groups
 * drop out.
 */
export function derivePartTree(snapshot: SongSnapshot): PartNode[] {
  const tracks = snapshot.tracks;
  const childrenByParent = new Map<number, number[]>();
  tracks.forEach((t, i) => {
    if (t.groupIndex != null) {
      const arr = childrenByParent.get(t.groupIndex) ?? [];
      arr.push(i);
      childrenByParent.set(t.groupIndex, arr);
    }
  });

  function buildNode(i: number): PartNode | null {
    const t = tracks[i]!;
    const name = (t.name ?? "").trim() || "Untitled track";
    const childIdx = childrenByParent.get(i);

    if (childIdx) {
      const children = childIdx
        .map(buildNode)
        .filter((n): n is PartNode => n !== null);
      if (children.length === 0) return null; // no performing descendant
      return {
        key: `${i}:${name}`,
        instrumentLabel: name,
        trackName: name,
        kind: "group",
        deviceNames: Array.from(
          new Set([...t.deviceNames, ...children.flatMap((c) => c.deviceNames)]),
        ),
        sampleFiles: Array.from(
          new Set([
            ...t.sampleFilePaths.map(basename),
            ...children.flatMap((c) => c.sampleFiles),
          ]),
        ),
        children,
      };
    }

    if (!performs(t)) return null; // empty utility leaf
    return {
      key: `${i}:${name}`,
      instrumentLabel: name,
      trackName: name,
      kind: kindOf(t),
      deviceNames: t.deviceNames,
      sampleFiles: t.sampleFilePaths.map(basename),
    };
  }

  const roots: PartNode[] = [];
  tracks.forEach((t, i) => {
    if (t.groupIndex != null) return; // children are built by their parent
    const node = buildNode(i);
    if (node) roots.push(node);
  });
  return roots;
}
