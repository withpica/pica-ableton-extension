// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { PicaMcpClient, PicaMcpError } from "./mcpClient";

export interface RegisterInput {
  title: string;
  artistName: string;
  workType: string; // song | instrumental | library | demo | sample
  key: string;
  metadata: Record<string, unknown>;
  summary: string;
}

export interface RegisterResult {
  workId: string;
  recordingId: string;
  completenessScore?: number;
  inspectUrl: string;
}

export class DuplicateWorkError extends Error {
  existingWorkId: string;
  constructor(existingWorkId: string, title: string) {
    super(`A work titled "${title}" already exists`);
    this.name = "DuplicateWorkError";
    this.existingWorkId = existingWorkId;
  }
}

// Idempotence is keyed on the client instance. This is correct because a
// PicaMcpClient is created fresh per register flow (short-lived per session);
// do not share one client across unrelated user sessions.
const introduced = new WeakSet<PicaMcpClient>();

/** Declare identity (ADR-247) once per client instance, so writes land in the /inspect live feed. */
export async function ensureIntroduced(client: PicaMcpClient, liveVersion: string): Promise<void> {
  if (introduced.has(client)) return;
  const agentName = liveVersion ? `Ableton Live Extension ${liveVersion}` : "Ableton Live Extension";
  await client.callTool("pica_introduce_self", {
    agent_name: agentName,
    agent_role: "DAW session capture (register-from-Set)",
  });
  introduced.add(client);
}

/** Version types offered for "register as a new version" — every audio version
 *  type except the original `master` and the two video deliverables. Default first. */
export const NEW_VERSION_TYPES = [
  "alternate", "alternate_master", "remix", "acoustic",
  "live_performance", "cover", "demo",
] as const;

/** Coerce a dialog-supplied version type to a valid NEW_VERSION_TYPES value,
 *  defaulting to "alternate" for anything unrecognised. */
export function coerceVersionType(value: unknown): string {
  return (NEW_VERSION_TYPES as readonly string[]).includes(value as string)
    ? (value as string)
    : "alternate";
}

/** Create a recording under an EXISTING work with a given version type.
 *  Shared by registerSet (master) and the new-version / recovery paths. */
export async function createRecordingForWork(
  client: PicaMcpClient,
  input: { workId: string; title: string; artistName: string; versionType: string },
): Promise<{ recordingId: string }> {
  const rec = await client.callTool<{ id: string }>("pica_recordings_create", {
    title: input.title,
    artist_name: input.artistName,
    version_type: input.versionType,
    work_id: input.workId,
  });
  if (!rec?.id) {
    throw new Error("PICA created the recording but did not return an id.");
  }
  return { recordingId: rec.id };
}

function asArray(queryResult: unknown): Array<{ id: string; title: string }> {
  if (Array.isArray(queryResult)) return queryResult as Array<{ id: string; title: string }>;
  const obj = queryResult as { items?: unknown; data?: unknown } | null;
  const list = obj?.items ?? obj?.data;
  return Array.isArray(list) ? (list as Array<{ id: string; title: string }>) : [];
}

/** Register the captured Set: dup-check → create work (with snapshot) → create master recording. */
export async function registerSet(client: PicaMcpClient, input: RegisterInput): Promise<RegisterResult> {
  if (!input.title.trim()) {
    throw new Error("Cannot register: the work title is blank.");
  }

  // 1. Duplicate check by title (weak, but cheap; the server 409 is the backstop).
  const queryResult = await client.callTool("pica_works_query", { query: input.title });
  const wanted = input.title.trim().toLowerCase();
  const dup = asArray(queryResult).find(
    (w) => Boolean(w.id) && (w.title ?? "").trim().toLowerCase() === wanted,
  );
  if (dup) throw new DuplicateWorkError(dup.id, input.title);

  // 2. Create the work, carrying the captured snapshot.
  let work: { id: string; completeness_score?: number };
  try {
    work = await client.callTool<{ id: string; completeness_score?: number }>("pica_works_create", {
      title: input.title,
      work_type: input.workType,
      key: input.key,
      notes: input.summary,
      metadata: input.metadata,
    });
  } catch (e) {
    if (e instanceof PicaMcpError) {
      const existing = (e.data as { existing_work_id?: string } | undefined)?.existing_work_id;
      if (existing) {
        throw new DuplicateWorkError(existing, input.title);
      }
      // WORK_ALREADY_EXISTS without a usable id: fall through and surface the raw error.
    }
    throw e;
  }

  // Never proceed without an id: an undefined work_id is silently dropped by
  // JSON.stringify and would create an unlinked (orphan) recording.
  if (!work?.id) {
    throw new Error(
      "PICA created the work but did not return a work id — aborting before creating an unlinked recording.",
    );
  }

  // 3. Create the master recording linked to the work.
  const { recordingId } = await createRecordingForWork(client, {
    workId: work.id,
    title: input.title,
    artistName: input.artistName,
    versionType: "master",
  });

  return {
    workId: work.id,
    recordingId,
    completenessScore: work.completeness_score,
    inspectUrl: `https://withpica.com/inspect/works/${work.id}`,
  };
}

export interface ExistingRegistration {
  workId: string;
  recordingId: string | null;
}

/**
 * Re-run anchor: an already-registered Set is matched by exact work title
 * (the same weak-but-cheap rule as the Stage-1 dup-check), then its master
 * recording is found via pica_recordings_query { work_id }.
 */
export async function findExistingRegistration(
  client: PicaMcpClient,
  title: string,
): Promise<ExistingRegistration | null> {
  const wanted = title.trim().toLowerCase();
  if (!wanted) return null;

  const workRes = await client.callTool("pica_works_query", { query: title });
  const work = asArray(workRes).find(
    (w) => Boolean(w.id) && (w.title ?? "").trim().toLowerCase() === wanted,
  );
  if (!work) return null;

  const recRes = await client.callTool("pica_recordings_query", {
    work_id: work.id,
  });
  const recs = asArray(recRes) as Array<{ id: string; version_type?: string }>;
  const master = recs.find((r) => r.version_type === "master") ?? recs[0];
  return { workId: work.id, recordingId: master?.id ?? null };
}
