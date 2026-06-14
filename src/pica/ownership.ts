// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { PicaMcpError, type PicaMcpClient } from "./mcpClient";

export interface MasterOwnershipOutcome {
  status: "created" | "skipped_existing" | "failed";
  error?: string;
}

/**
 * The single org-owned master split written for a DAW-registered recording.
 * person_id is omitted on purpose: recording_splits.person_id is optional and
 * the route sets organisation_id server-side from the connection key, so the
 * registering org owns 100% of the master. Refined to per-person/co-ownership
 * later in /inspect. Canonical home = recording_splits (NOT the
 * recordings.ownership_percentage shadow column).
 */
export function masterSplitPayload(recordingId: string): Record<string, unknown> {
  return {
    recording_id: recordingId,
    split_type: "master",
    percentage: 100,
    role: "owner",
  };
}

/**
 * Normalise pica_recording_splits_list output to a list. Through `callTool` the
 * result arrives already envelope-unwrapped (mcpClient peels a top-level
 * `{data}`), so in the `ensureMasterOwnership` path the input is the bare array
 * or a `{splits}` / `{items}` shape. The `{data}` arm is a defensive backstop
 * for any direct caller and harmless if unreachable via callTool.
 */
export function asSplitArray(result: unknown): Array<{ split_type?: string }> {
  if (Array.isArray(result)) return result as Array<{ split_type?: string }>;
  const obj = result as { splits?: unknown; data?: unknown; items?: unknown } | null;
  const list = obj?.splits ?? obj?.data ?? obj?.items;
  return Array.isArray(list) ? (list as Array<{ split_type?: string }>) : [];
}

/**
 * Insert-once master ownership: skip if a master split already exists on the
 * recording; otherwise create one org-owned 100% master split. Best-effort — a
 * non-auth failure is reported, not thrown (the registration already succeeded;
 * we must not lose it). A 401 propagates so the reconnect path can mint a fresh
 * key and re-run (the skip-existing check makes re-run safe — no double row).
 */
export async function ensureMasterOwnership(
  client: PicaMcpClient,
  recordingId: string,
): Promise<MasterOwnershipOutcome> {
  try {
    const existing = await client.callTool("pica_recording_splits_list", {
      recording_id: recordingId,
    });
    if (asSplitArray(existing).some((s) => s.split_type === "master")) {
      return { status: "skipped_existing" };
    }
    await client.callTool("pica_recording_splits_create", masterSplitPayload(recordingId));
    return { status: "created" };
  } catch (e) {
    if (e instanceof PicaMcpError && e.code === "401") throw e;
    return { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
}
