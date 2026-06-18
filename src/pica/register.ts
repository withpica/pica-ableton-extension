// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { PicaMcpClient, PicaMcpError } from "./mcpClient";
import { type MasterOwnershipOutcome } from "./ownership";

export interface RegisterInput {
  title: string;
  artistName: string;
  primaryArtistId?: string;
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
  masterOwnership?: MasterOwnershipOutcome["status"];
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
  input: { workId: string; title: string; artistName: string; versionType: string; primaryArtistId?: string },
): Promise<{ recordingId: string }> {
  const rec = await client.callTool<{ id: string }>("pica_recordings_create", {
    title: input.title,
    artist_name: input.artistName,
    version_type: input.versionType,
    work_id: input.workId,
    ...(input.primaryArtistId ? { primary_artist_id: input.primaryArtistId } : {}),
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

/** Pull the existing work id out of a pica_register_set duplicate error. The
 *  server nests it under `details` (the MCP error formatter only forwards
 *  error/message/details), with a flat fallback for direct callers. */
function existingWorkIdFromError(e: PicaMcpError): string | undefined {
  const data = e.data as
    | { existing_work_id?: string; details?: { existing_work_id?: string } }
    | undefined;
  return data?.details?.existing_work_id ?? data?.existing_work_id;
}

/**
 * Register the captured Set in ONE round-trip via pica_register_set: the server
 * creates the work (with snapshot), the linked master recording, and 100% org
 * master ownership in a single in-process operation. This replaces the five
 * sequential calls the extension used to make (works_query dup-check →
 * works_create → recordings_create → splits_list → splits_create) — the bulk of
 * the "Registering…" latency was those serialized internet round-trips.
 *
 * The server's own title+artist dedup gate is the duplicate backstop (the
 * client-side pre-query is gone): a duplicate surfaces as a PicaMcpError whose
 * details carry existing_work_id, which we convert to DuplicateWorkError so the
 * caller can offer add-version / complete.
 */
export async function registerSet(client: PicaMcpClient, input: RegisterInput): Promise<RegisterResult> {
  if (!input.title.trim()) {
    throw new Error("Cannot register: the work title is blank.");
  }

  let res: {
    work_id?: string;
    recording_id?: string;
    completeness_score?: number;
    master_ownership?: MasterOwnershipOutcome["status"];
  };
  try {
    res = await client.callTool("pica_register_set", {
      title: input.title,
      artist_name: input.artistName,
      work_type: input.workType,
      key: input.key,
      notes: input.summary,
      metadata: input.metadata,
      ...(input.primaryArtistId ? { primary_artist_id: input.primaryArtistId } : {}),
    });
  } catch (e) {
    if (e instanceof PicaMcpError) {
      const existing = existingWorkIdFromError(e);
      if (existing) {
        throw new DuplicateWorkError(existing, input.title);
      }
      // A duplicate without a usable id (or any other failure): surface raw.
    }
    throw e;
  }

  // Never proceed without ids: the server returns both on success.
  if (!res?.work_id || !res?.recording_id) {
    throw new Error(
      "PICA registered the set but did not return work + recording ids.",
    );
  }

  return {
    workId: res.work_id,
    recordingId: res.recording_id,
    completenessScore: res.completeness_score,
    inspectUrl: `https://withpica.com/inspect/works/${res.work_id}`,
    masterOwnership: res.master_ownership,
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
