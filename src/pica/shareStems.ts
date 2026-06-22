// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

export interface StemChoice {
  id: string;
  label: string;
  fileType: string;
}

export function mapAudioQueryToStems(
  rows: Array<{
    id: string;
    filename?: string;
    stem_label?: string | null;
    file_type?: string;
  }>,
): StemChoice[] {
  return rows.map((r) => ({
    id: r.id,
    label: (r.stem_label && r.stem_label.trim()) || r.filename || r.id,
    fileType: r.file_type || "file",
  }));
}

/** undefined means share all (omit the param). A narrowed selection returns the chosen ids. */
export function selectionParam(
  allIds: string[],
  chosenIds: string[],
): string[] | undefined {
  if (chosenIds.length === 0) return undefined; // caller guards empty before here
  if (chosenIds.length === allIds.length) return undefined;
  return chosenIds;
}
