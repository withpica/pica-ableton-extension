// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { type PicaMcpClient } from "./mcpClient";
import { loadAllPages } from "./paging";

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

/** One row of pica_audio_query, as the stem picker reads it. */
export type AudioRow = { id: string; filename?: string; stem_label?: string | null; file_type?: string };

/** The rows of a pica_audio_query result, whatever its envelope. */
export function audioRowsOf(raw: unknown): AudioRow[] {
  const obj = raw as { data?: unknown; items?: unknown } | null;
  const rows = Array.isArray(raw)
    ? raw
    : Array.isArray(obj?.data)
      ? (obj.data as unknown[])
      : Array.isArray(obj?.items)
        ? (obj.items as unknown[])
        : [];
  return rows.filter((r): r is AudioRow => typeof (r as AudioRow)?.id === "string");
}

/** pica_audio_query's limit maximum (mcp-server/src/tools/audio-files.ts). */
const AUDIO_PAGE = 200;
/** A safety cap on the files one stem picker lists. */
const AUDIO_CAP = 2000;

/**
 * Every audio file of a work, for the stem picker. One call used to read only
 * the first page (50 by default, fewer when PICA trimmed it under its 100KB
 * cap), so a song with more files offered only some of them. Pages are
 * followed by has_more / next_offset (./paging.ts).
 */
export async function fetchWorkAudio(client: PicaMcpClient, workId: string): Promise<AudioRow[]> {
  return (
    await loadAllPages(client, "pica_audio_query", { work_id: workId }, audioRowsOf, {
      pageSize: AUDIO_PAGE,
      cap: AUDIO_CAP,
    })
  ).rows;
}
