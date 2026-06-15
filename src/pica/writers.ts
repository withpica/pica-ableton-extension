// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { type PicaMcpClient } from "./mcpClient";

export interface WriterOutcome {
  name: string;
  status: "linked_existing" | "created" | "skipped_existing" | "skipped_ambiguous";
  person_id?: string;
}

/**
 * Capture composition writers for a work: one pica_work_writers_add call with
 * the non-blank names. The server resolves each name (link existing or create a
 * tagged writer person) and additively adds it — existing collaborators are
 * never touched. A 401 propagates so the reconnect path can re-run (the add is
 * idempotent server-side via the unique (work_id, person_id, role) index).
 */
export async function saveWriters(
  client: PicaMcpClient,
  workId: string,
  names: string[],
): Promise<WriterOutcome[]> {
  const clean = names.map((n) => n.trim()).filter((n) => n.length > 0);
  if (clean.length === 0) return [];
  const res = await client.callTool<{ writers?: WriterOutcome[] }>("pica_work_writers_add", {
    work_id: workId,
    names: clean,
  });
  return res?.writers ?? [];
}

/** One-line summary for the success dialog. "" when there are no writers. */
export function summarizeWriters(outcomes: WriterOutcome[]): string {
  if (outcomes.length === 0) return "";
  const linked = outcomes.filter((o) => o.status === "linked_existing").length;
  const created = outcomes.filter((o) => o.status === "created").length;
  const review = outcomes.filter((o) => o.status === "skipped_ambiguous").length;
  return `writers: ${linked} linked, ${created} added, ${review} need review`;
}
