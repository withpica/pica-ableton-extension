// Copyright (c) 2025-2026 Withpica Ltd. All rights reserved.

import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { type PicaMcpClient } from "./mcpClient";

/**
 * Import a song's audio from PICA into the open Live Set (ADR-259, "import
 * from PICA"). Read-only on PICA: every call is a query or a GET, pinned by
 * READ_ONLY_TOOLS below. Pure and host-independent except downloadToFile,
 * which takes its fetch and writes to the path it is given.
 */

/** The only MCP tools the import may call. Each one reads; none writes. */
export const READ_ONLY_TOOLS = [
  "pica_works_query",
  "pica_works_inspect",
  "pica_recordings_query",
  "pica_audio_query",
] as const;
type ReadOnlyTool = (typeof READ_ONLY_TOOLS)[number];

/** The client the import gets: only reads can be sent through it. */
export interface ReadOnlyClient {
  read<T = unknown>(tool: ReadOnlyTool, args: Record<string, unknown>): Promise<T>;
  /** The signed download URL for one audio file in the caller's catalogue. */
  playbackUrl(audioFileId: string): Promise<string>;
}

export function readOnly(client: PicaMcpClient): ReadOnlyClient {
  return {
    read: (tool, args) => {
      if (!(READ_ONLY_TOOLS as readonly string[]).includes(tool)) {
        throw new Error(`import may only read from pica (${tool} refused)`);
      }
      return client.callTool(tool, args);
    },
    playbackUrl: async (id) => {
      const data = await client.restGet<{ url?: unknown }>(
        `/api/admin/audio-files/${encodeURIComponent(id)}/playback-url`,
      );
      if (typeof data?.url !== "string" || !data.url) throw new Error("pica sent no download address");
      return data.url;
    },
  };
}

function rowsOf(raw: unknown, ...keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  const obj = raw as Record<string, unknown> | null;
  for (const k of [...keys, "items", "data"]) {
    const v = obj?.[k];
    if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
  }
  return [];
}
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---------------------------------------------------------------------------
// 1. Which song, which recording
// ---------------------------------------------------------------------------

export interface WorkChoice {
  id: string;
  title: string;
  artist: string;
}

export function toWorkChoices(raw: unknown): WorkChoice[] {
  const out: WorkChoice[] = [];
  const seen = new Set<string>();
  for (const r of rowsOf(raw, "works")) {
    const id = str(r.id);
    const title = str(r.title);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title, artist: str(r.primary_artist) });
  }
  return out;
}

/** How many matches one search shows. */
export const SEARCH_LIMIT = 25;

/**
 * The caller's own works whose title, ISWC or artist matches what they typed,
 * searched by PICA (pica_works_query's `query`; scoped to the key's
 * catalogue). Replaces loading the whole catalogue into a suggestion list:
 * its page size (200) was over the tool's maximum (100), so only the first
 * page ever arrived and a new song was not in it (founder smoke 2026-11-23).
 */
export async function searchWorks(c: Pick<ReadOnlyClient, "read">, text: string): Promise<WorkChoice[]> {
  const query = text.trim();
  if (!query) return [];
  return toWorkChoices(await c.read("pica_works_query", { query, limit: SEARCH_LIMIT }));
}

/** "Title — Artist", how a match is shown. */
export function workLabel(w: WorkChoice): string {
  return w.artist ? `${w.title} — ${w.artist}` : w.title;
}

export interface RecordingChoice {
  id: string;
  title: string;
  versionType: string;
}

export function toRecordingChoices(raw: unknown): RecordingChoice[] {
  const out: RecordingChoice[] = [];
  const seen = new Set<string>();
  for (const r of rowsOf(raw, "recordings")) {
    const id = str(r.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      title: str(r.recording_title) || str(r.title) || "untitled recording",
      versionType: str(r.version_type),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Which files
// ---------------------------------------------------------------------------

export interface ImportFile {
  id: string;
  label: string;
  fileType: string;
  durationSeconds: number | null;
  bpm: number | null;
  key: string;
  recordingId: string;
  filename: string;
}

export function toImportFiles(raw: unknown): ImportFile[] {
  const out: ImportFile[] = [];
  const seen = new Set<string>();
  for (const r of rowsOf(raw, "audio_files", "files")) {
    const id = str(r.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const filename = str(r.filename);
    out.push({
      id,
      label: str(r.stem_label) || str(r.title) || filename.replace(/\.[^.]+$/, "") || "audio",
      fileType: str(r.file_type) || "audio",
      durationSeconds: num(r.duration_seconds),
      bpm: num(r.detected_bpm),
      key: str(r.detected_key),
      recordingId: str(r.recording_id),
      filename,
    });
  }
  return out;
}

/**
 * The files of the chosen recording, split into what is offered ticked (every
 * non-master file) and the master, offered unticked. With no recording chosen
 * (the work has none, or only one), every file of the work counts.
 */
export function filesForRecording(
  files: ImportFile[],
  recordingId: string | null,
): { stems: ImportFile[]; master: ImportFile | null } {
  const mine = recordingId
    ? files.filter((f) => f.recordingId === recordingId || f.recordingId === "")
    : files;
  const masters = mine.filter((f) => f.fileType === "master");
  return { stems: mine.filter((f) => f.fileType !== "master"), master: masters[0] ?? null };
}

/** "3:07" for a length in seconds; "" when unknown. */
export function formatLength(seconds: number | null): string {
  if (seconds === null || seconds < 0) return "";
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 3. Tempo and key
// ---------------------------------------------------------------------------

export type TempoSource = "session" | "measured";
export interface SongTempo {
  bpm: number;
  source: TempoSource;
}

/** works.metadata from a Set registered by this extension. */
function sessionSnapshot(workMetadata: unknown): { tempo: number | null; key: string } {
  const m = workMetadata as Record<string, unknown> | null;
  if (!m || m.capturedFrom !== "ableton") return { tempo: null, key: "" };
  const tempo = num(m.tempo);
  return { tempo: tempo !== null && tempo > 0 ? tempo : null, key: str(m.key) };
}

/**
 * The song's tempo: the Set's own tempo when the work was registered from
 * Ableton ("from the session"); otherwise the master's measured tempo, or the
 * stems' when they all agree within half a bpm ("measured"); otherwise unknown.
 */
export function songTempo(workMetadata: unknown, files: ImportFile[]): SongTempo | null {
  const snap = sessionSnapshot(workMetadata);
  if (snap.tempo !== null) return { bpm: snap.tempo, source: "session" };
  const master = files.find((f) => f.fileType === "master" && f.bpm !== null && f.bpm > 0);
  if (master) return { bpm: master.bpm!, source: "measured" };
  const bpms = files.map((f) => f.bpm).filter((b): b is number => b !== null && b > 0);
  if (bpms.length === 0) return null;
  const lo = Math.min(...bpms);
  const hi = Math.max(...bpms);
  return hi - lo <= 0.5 ? { bpm: bpms[0]!, source: "measured" } : null;
}

export interface SongKey {
  key: string;
  source: TempoSource;
}

export function songKey(workMetadata: unknown, files: ImportFile[]): SongKey | null {
  const snap = sessionSnapshot(workMetadata);
  if (snap.key) return { key: snap.key, source: "session" };
  const master = files.find((f) => f.fileType === "master" && f.key);
  if (master) return { key: master.key, source: "measured" };
  return null;
}

export type TempoPlan =
  | { kind: "set"; bpm: number; asked: false }
  | { kind: "ask"; song: SongTempo; sessionBpm: number }
  | { kind: "same"; bpm: number }
  | { kind: "unknown" };

const SAME_BPM = 0.5;

/**
 * Whether to ask about tempo. Ask only when the song's tempo is known, the
 * Set already has clips, and the two differ. An empty Set takes the song's
 * tempo without a question; an unknown tempo is imported unwarped.
 */
export function tempoPlan(song: SongTempo | null, sessionBpm: number, sessionHasContent: boolean): TempoPlan {
  if (!song) return { kind: "unknown" };
  if (Math.abs(song.bpm - sessionBpm) <= SAME_BPM) return { kind: "same", bpm: sessionBpm };
  if (!sessionHasContent) return { kind: "set", bpm: song.bpm, asked: false };
  return { kind: "ask", song, sessionBpm };
}

/** What the import does with tempo, once decided. */
export interface TempoChoice {
  /** Set Song.tempo to this, or leave it. */
  setTempo: number | null;
  /** Clips stretched to the Set's tempo (warp on), or played as recorded. */
  warp: boolean;
}

export function tempoChoice(plan: TempoPlan, answer?: "song" | "session"): TempoChoice {
  switch (plan.kind) {
    case "set":
      return { setTempo: plan.bpm, warp: false };
    case "ask":
      return answer === "session"
        ? { setTempo: null, warp: true }
        : { setTempo: plan.song.bpm, warp: false };
    case "same":
    case "unknown":
      return { setTempo: null, warp: false };
  }
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/**
 * The key line for the report. PICA cannot change Live's key or repitch
 * audio (rootNote and scaleName are read-only), so this only says what each
 * is. The Set's key is named only when Live's scale mode is on.
 */
export function keyNote(
  song: SongKey | null,
  session: { rootNote: number; scaleName: string; scaleMode: boolean },
): string | null {
  if (!song) return null;
  const songKeyText = proseKey(song.key);
  const songPart = `the song is in ${songKeyText}${song.source === "measured" ? " (measured)" : ""}`;
  const sessionKey =
    session.scaleMode && session.scaleName.trim()
      ? proseKey(`${NOTE_NAMES[((Math.trunc(session.rootNote) % 12) + 12) % 12]} ${session.scaleName.trim()}`)
      : "";
  if (sessionKey && sessionKey.toLowerCase() !== songKeyText.toLowerCase()) {
    return `${songPart}; your session is in ${sessionKey}. Ableton doesn't let pica change the key.`;
  }
  return `${songPart}.`;
}

/** "A Minor" → "A minor": the note name as it is, the scale in lowercase. */
function proseKey(key: string): string {
  const [note, ...rest] = key.trim().split(/\s+/);
  return [note, ...rest.map((w) => w.toLowerCase())].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// 4. Download
// ---------------------------------------------------------------------------

/** A temp file name for one download: safe characters only, unique per file id. */
export function tempFileName(file: ImportFile): string {
  const ext = (/\.([a-z0-9]{2,5})$/i.exec(file.filename)?.[1] ?? "wav").toLowerCase();
  const base = file.label.replace(/[^a-z0-9 _-]+/gi, "").trim().replace(/\s+/g, "-").slice(0, 60) || "audio";
  return `pica-${base}-${file.id.slice(0, 8)}.${ext}`;
}

/** Why one file was not imported, in fixed words (the raw error is logged, never shown). */
export type ImportStep = "download" | "add";
export function fileFailureReason(step: ImportStep | null): string {
  if (step === "download") return "the download didn't work";
  if (step === "add") return "Ableton couldn't add it";
  return "something went wrong";
}

const IMPORT_ERROR_FALLBACK = "couldn't import: something went wrong. try again, or open the song in pica.";

/**
 * What a failed import says: the API's own message when PICA sent one (nested
 * as "... {json}" with an `error`), otherwise a fixed line. Never transport
 * text, a guard's wording or a stack.
 */
export function importErrorMessage(rawMessage: string): string {
  const start = rawMessage.indexOf("{");
  if (start >= 0) {
    try {
      const p = JSON.parse(rawMessage.slice(start));
      if (typeof p.error === "string" && p.error.trim()) return `couldn't import: ${p.error.trim()}`;
    } catch {
      /* not JSON */
    }
  }
  return IMPORT_ERROR_FALLBACK;
}

export class ImportCancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

/**
 * Stream a signed URL to `dir/<name>`, reporting progress (0..1, or null when
 * the size is unknown). On any failure or cancel the partial file is removed
 * and the error is thrown; on success the path is returned and the caller
 * removes it once Live has its own copy.
 */
export async function downloadToFile(
  fetchFn: typeof fetch,
  url: string,
  dir: string,
  name: string,
  opts: { signal?: AbortSignal; onProgress?: (fraction: number | null) => void } = {},
): Promise<string> {
  const path = join(dir, name);
  if (opts.signal?.aborted) throw new ImportCancelled();
  try {
    const res = await fetchFn(url, { signal: opts.signal });
    if (!res.ok || !res.body) throw new Error(`the download failed (${res.status})`);
    const total = Number(res.headers.get("content-length")) || 0;
    let got = 0;
    const counted = Readable.fromWeb(res.body as any);
    counted.on("data", (chunk: Buffer) => {
      got += chunk.length;
      opts.onProgress?.(total > 0 ? Math.min(1, got / total) : null);
    });
    await pipeline(counted, createWriteStream(path), { signal: opts.signal });
    return path;
  } catch (e) {
    await unlink(path).catch(() => undefined);
    if (opts.signal?.aborted || (e as Error)?.name === "AbortError") throw new ImportCancelled();
    throw e;
  }
}

/** Remove a temp file; never throws. */
export async function removeTemp(path: string): Promise<void> {
  await unlink(path).catch(() => undefined);
}

/** The track name for an imported file. */
export function trackName(file: ImportFile, songTitle: string, prefixWithSong: boolean): string {
  return prefixWithSong && songTitle.trim() ? `${songTitle.trim()} — ${file.label}` : file.label;
}
