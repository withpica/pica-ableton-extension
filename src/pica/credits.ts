// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { PicaMcpError, type PicaMcpClient } from "./mcpClient";
import type { Part } from "../session/parts";

export interface CreditRow {
  instrument: string;
  performerName: string; // free text; "" = skip this row
}

export interface ExistingCredit {
  id: string;
  credited_name: string;
  role: string;
  instrument?: string | null;
  person_id?: string | null;
}

export interface CreditOutcome {
  creditedName: string;
  instrument: string;
  status: "saved_linked" | "saved_draft" | "skipped_existing" | "failed";
  error?: string;
}

const ROLE = "Performer"; // v1 default — spec decision 5

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Liner-notes rule (spec decision 6): one credit per person. The DB enforces
 * UNIQUE (recording_id, credited_name, role) — instrument is NOT in the key —
 * so multiple parts by the same person merge into one row, instruments joined.
 */
export function mergeRowsByPerson(
  rows: CreditRow[],
): Array<{ performerName: string; instrument: string }> {
  const byPerson = new Map<string, { performerName: string; instruments: string[] }>();
  for (const row of rows) {
    const name = row.performerName.trim();
    if (!name) continue;
    const k = norm(name);
    const entry = byPerson.get(k) ?? { performerName: name, instruments: [] };
    const label = row.instrument.trim();
    if (label && !entry.instruments.some((i) => norm(i) === norm(label))) {
      entry.instruments.push(label);
    }
    byPerson.set(k, entry);
  }
  return Array.from(byPerson.values()).map((e) => ({
    performerName: e.performerName,
    instrument: e.instruments.join(", "),
  }));
}

/**
 * Prefill for the panel: one row per detected Part; an existing credit whose
 * instrument list mentions the part's label fills that row's name. Existing
 * credits matching no part are appended so the human always sees everything
 * already saved (editing, not appending — saving skips unchanged rows).
 */
export function buildPrefillRows(
  parts: Part[],
  existing: ExistingCredit[],
): CreditRow[] {
  const claimed = new Set<ExistingCredit>();
  const rows: CreditRow[] = parts.map((p) => {
    const match = existing.find(
      (e) =>
        !claimed.has(e) &&
        (e.instrument ?? "")
          .split(",")
          .map(norm)
          .includes(norm(p.instrumentLabel)),
    );
    if (match) claimed.add(match);
    return {
      instrument: p.instrumentLabel,
      performerName: match?.credited_name ?? "",
    };
  });
  for (const e of existing) {
    if (claimed.has(e)) continue;
    rows.push({
      instrument: (e.instrument ?? "").trim(),
      performerName: e.credited_name,
    });
  }
  return rows;
}

/** Read the recording's saved credits (re-run path). */
export async function loadExistingCredits(
  client: PicaMcpClient,
  recordingId: string,
): Promise<ExistingCredit[]> {
  const out = await client.callTool<Record<string, unknown>>(
    "pica_recordings_inspect",
    { id: recordingId, sections: ["recording_credits"] },
  );
  const list =
    (out as { recording_credits?: unknown })?.recording_credits ??
    (out as { data?: { recording_credits?: unknown } })?.data
      ?.recording_credits ??
    [];
  return Array.isArray(list) ? (list as ExistingCredit[]) : [];
}

/**
 * Per-row writes (spec decision 7): one pica_recording_credits_update call
 * per merged person; the server resolves credited_name → person_id (ADR-255
 * resolve-on-write). Rows already saved (same name + role) are skipped — the
 * MCP tool only inserts, and the DB unique key would reject a duplicate.
 */
export async function saveCredits(
  client: PicaMcpClient,
  recordingId: string,
  rows: CreditRow[],
  existing: ExistingCredit[],
): Promise<CreditOutcome[]> {
  const merged = mergeRowsByPerson(rows);
  const existingKey = new Set(
    existing.map((e) => `${norm(e.credited_name)}|${e.role}`),
  );

  const outcomes: CreditOutcome[] = [];
  for (const m of merged) {
    if (existingKey.has(`${norm(m.performerName)}|${ROLE}`)) {
      outcomes.push({
        creditedName: m.performerName,
        instrument: m.instrument,
        status: "skipped_existing",
      });
      continue;
    }
    try {
      const created = await client.callTool<{ person_id?: string | null }>(
        "pica_recording_credits_update",
        {
          recording_id: recordingId,
          credited_name: m.performerName,
          role: ROLE,
          instrument: m.instrument,
        },
      );
      outcomes.push({
        creditedName: m.performerName,
        instrument: m.instrument,
        status: created?.person_id ? "saved_linked" : "saved_draft",
      });
    } catch (e) {
      // A 401 must reach withReconnect so it can mint a fresh key and re-run
      // the whole list. Rethrow (aborting the loop) rather than recording a
      // failed outcome that would swallow the auth signal. Safe to re-run:
      // credit writes are insert-only and de-duplicated (the skipped_existing
      // check + the DB UNIQUE (recording_id, credited_name, role) constraint),
      // so already-written rows are skipped on the retry — no double-write.
      if (e instanceof PicaMcpError && e.code === "401") throw e;
      outcomes.push({
        creditedName: m.performerName,
        instrument: m.instrument,
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return outcomes;
}
