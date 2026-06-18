// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { PicaMcpError, type PicaMcpClient } from "./mcpClient";
import type { PartNode } from "../session/parts";
import { resolvePersonId, type PersonCandidate } from "./people";

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

/** Compact one-line summary for the consolidated final report. */
export function summarizeCredits(outcomes: CreditOutcome[]): string {
  if (outcomes.length === 0) return "credits: none saved.";
  const saved = outcomes.filter(
    (o) => o.status === "saved_linked" || o.status === "saved_draft",
  ).length;
  const draft = outcomes.filter((o) => o.status === "saved_draft").length;
  const unchanged = outcomes.filter((o) => o.status === "skipped_existing").length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const parts: string[] = [];
  if (saved > 0) parts.push(`${saved} saved`);
  if (draft > 0) parts.push(`${draft} draft`);
  if (unchanged > 0) parts.push(`${unchanged} unchanged`);
  if (failed > 0) parts.push(`${failed} failed`);
  return `credits: ${parts.join(", ")}.`;
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

/** A prefilled credit node handed to the dialog (mirrors PartNode + UI state). */
export interface PrefillNode {
  key: string;
  instrument: string; // editable label
  performerName: string; // "" = unfilled
  kind: "instrument" | "audio" | "group";
  expanded: boolean; // groups only; leaves always false
  children?: PrefillNode[];
}

/** The tree-state the dialog posts back on save — PrefillNode without keys (none are needed on the return trip). */
export type FrontierNode = Omit<PrefillNode, "key" | "children"> & {
  children?: FrontierNode[];
};

/**
 * Prefill for the dialog: one node per detected PartNode, performer names filled
 * from existing credits matched by instrument label. A group is initialised
 * EXPANDED when any descendant matched a saved credit (so prior per-track work
 * shows); otherwise it stays collapsed and is itself matched against the group
 * label. Existing credits matching no node are appended as standalone leaf nodes
 * so the human always sees everything already saved.
 */
export function buildPrefillTree(
  tree: PartNode[],
  existing: ExistingCredit[],
): PrefillNode[] {
  const claimed = new Set<ExistingCredit>();
  const matchLabel = (label: string): string => {
    const e = existing.find(
      (c) =>
        !claimed.has(c) &&
        (c.instrument ?? "").split(",").map(norm).includes(norm(label)),
    );
    if (e) {
      claimed.add(e);
      return e.credited_name;
    }
    return "";
  };
  const hasName = (n: PrefillNode): boolean =>
    n.performerName !== "" || (n.children?.some(hasName) ?? false);

  const buildNode = (n: PartNode): PrefillNode => {
    if (n.kind === "group") {
      const children = (n.children ?? []).map(buildNode);
      const expanded = children.some(hasName);
      return {
        key: n.key,
        instrument: n.instrumentLabel,
        performerName: expanded ? "" : matchLabel(n.instrumentLabel),
        kind: "group",
        expanded,
        children,
      };
    }
    return {
      key: n.key,
      instrument: n.instrumentLabel,
      performerName: matchLabel(n.instrumentLabel),
      kind: n.kind,
      expanded: false,
    };
  };

  const nodes = tree.map(buildNode);
  const extras: PrefillNode[] = existing
    .filter((e) => !claimed.has(e))
    .map((e) => ({
      key: `extra:${e.id}`,
      instrument: (e.instrument ?? "").trim(),
      performerName: e.credited_name,
      kind: "audio" as const,
      expanded: false,
    }));
  return [...nodes, ...extras];
}

/**
 * Collapse the dialog's tree-state to the flat credit rows to save: an expanded
 * group contributes its children (not itself); a collapsed group and every leaf
 * contribute themselves. A parent and its child can never both appear, so there
 * is no double-crediting. Blank names are filtered later by mergeRowsByPerson.
 */
export function serializeFrontier(nodes: FrontierNode[]): CreditRow[] {
  const out: CreditRow[] = [];
  for (const n of nodes) {
    if (n.kind === "group" && n.expanded) {
      out.push(...serializeFrontier(n.children ?? []));
    } else {
      out.push({ instrument: n.instrument, performerName: n.performerName });
    }
  }
  return out;
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

/** Per-row outcome from pica_recording_credits_bulk_update (subset we read). */
interface BulkCreditRow {
  credited_name: string;
  role: string;
  status: "created" | "skipped_existing" | "would_create" | "would_skip_existing";
}
interface BulkCreditsResult {
  results?: BulkCreditRow[];
}

/**
 * One bulk write (latency slice, 2026-06-18): all merged performer credits go to
 * the recording in a SINGLE pica_recording_credits_bulk_update call rather than
 * one pica_recording_credits_update per person. Each MCP call carries ~1.4-2.0s
 * of fixed /api/mcp overhead (measured), so an N-performer Set used to pay
 * N x that; this collapses it to one. The server resolves credited_name ->
 * person_id (ADR-255 resolve-on-write) and dedups on (recording, credited_name,
 * role), returning per-row created / skipped_existing. We pre-skip rows already
 * in `existing` (so they're not re-sent) and infer linked-vs-draft from whether
 * we sent a person_id — the bulk result carries no per-row person_id.
 */
export async function saveCredits(
  client: PicaMcpClient,
  recordingId: string,
  rows: CreditRow[],
  existing: ExistingCredit[],
  candidates: PersonCandidate[] = [],
): Promise<CreditOutcome[]> {
  const merged = mergeRowsByPerson(rows);
  if (merged.length === 0) return [];

  const existingKey = new Set(
    existing.map((e) => `${norm(e.credited_name)}|${e.role}`),
  );
  const isExisting = (name: string): boolean =>
    existingKey.has(`${norm(name)}|${ROLE}`);
  const personIdByName = new Map(
    merged.map((m) => [
      norm(m.performerName),
      resolvePersonId(m.performerName, candidates),
    ]),
  );

  const toSend = merged.filter((m) => !isExisting(m.performerName));

  let failed: string | null = null;
  const statusByName = new Map<string, BulkCreditRow["status"]>();
  if (toSend.length > 0) {
    try {
      const res = await client.callTool<BulkCreditsResult>(
        "pica_recording_credits_bulk_update",
        {
          recording_ids: [recordingId],
          credits: toSend.map((m) => {
            const personId = personIdByName.get(norm(m.performerName));
            return {
              credited_name: m.performerName,
              role: ROLE,
              instrument: m.instrument,
              ...(personId ? { person_id: personId } : {}),
            };
          }),
        },
      );
      for (const r of res?.results ?? []) {
        statusByName.set(norm(r.credited_name), r.status);
      }
    } catch (e) {
      // One call now. A 401 still reaches withReconnect (mint a fresh key and
      // re-run); re-run is safe (insert-only + dedup on
      // (recording, credited_name, role)). Any other error means the
      // all-or-nothing bulk route wrote nothing, so the whole sent batch failed.
      if (e instanceof PicaMcpError && e.code === "401") throw e;
      failed = e instanceof Error ? e.message : String(e);
    }
  }

  return merged.map((m): CreditOutcome => {
    const k = norm(m.performerName);
    if (isExisting(m.performerName)) {
      return { creditedName: m.performerName, instrument: m.instrument, status: "skipped_existing" };
    }
    if (failed) {
      return { creditedName: m.performerName, instrument: m.instrument, status: "failed", error: failed };
    }
    if (statusByName.get(k) === "skipped_existing") {
      return { creditedName: m.performerName, instrument: m.instrument, status: "skipped_existing" };
    }
    // created (or, defensively, no per-row echo) -> linked iff we sent a person_id
    return {
      creditedName: m.performerName,
      instrument: m.instrument,
      status: personIdByName.get(k) ? "saved_linked" : "saved_draft",
    };
  });
}
