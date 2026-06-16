// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { PicaMcpError, type PicaMcpClient } from "./mcpClient";
import type { SongSnapshot } from "../session/snapshot";

const SOURCE = "splice";
const CLEARANCE = "not_required";

/** A Splice sample detected in the Set, ready to log. */
export interface DetectedSample {
  /** Filename basename → pica_recording_samples_add sample_name. */
  sampleName: string;
  /** Full path (context; not sent to PICA in v1). */
  filePath: string;
}

export interface SpliceSamplesOutcome {
  added: number;
  failed: number;
  errors: string[];
}

/**
 * True iff a FOLDER segment (any segment except the last, the filename) equals
 * "splice" case-insensitively. So a sample merely named `splice_*.wav` — or even
 * a file literally named `Splice` — under a non-Splice folder does not match;
 * only a file living under a `…/Splice/…` folder does.
 */
function hasSpliceFolder(segments: string[]): boolean {
  // segments[length-1] is the filename; check folders only.
  for (let i = 0; i < segments.length - 1; i++) {
    if (segments[i]!.toLowerCase() === SOURCE) return true;
  }
  return false;
}

/**
 * Pure: pick the Splice samples out of a snapshot. Reads sampleFilePaths across
 * all tracks (covers audio clips AND Simpler/Sampler device samples — both are
 * already collected there by readTrack). Deduped by basename so the same sample
 * used on several tracks yields one row (the first occurrence wins).
 */
export function detectSpliceSamples(snapshot: SongSnapshot): DetectedSample[] {
  const byName = new Map<string, DetectedSample>();
  for (const track of snapshot.tracks) {
    for (const filePath of track.sampleFilePaths) {
      const segments = filePath.split(/[\\/]/);
      if (!hasSpliceFolder(segments)) continue;
      const sampleName = segments[segments.length - 1] ?? filePath;
      if (!byName.has(sampleName)) byName.set(sampleName, { sampleName, filePath });
    }
  }
  return Array.from(byName.values());
}

/**
 * Best-effort: log each detected Splice sample to the recording via
 * pica_recording_samples_add (idempotent on recording+source+sample_name, so
 * re-registering never duplicates). A 401 propagates so the reconnect path can
 * mint a fresh key and re-run (the idempotent adds make that safe). Any other
 * per-sample error is recorded, not thrown — the registration already succeeded
 * and a sample-write failure must never surface an error dialog over success.
 */
export async function saveSpliceSamples(
  client: PicaMcpClient,
  recordingId: string,
  samples: DetectedSample[],
): Promise<SpliceSamplesOutcome> {
  const outcome: SpliceSamplesOutcome = { added: 0, failed: 0, errors: [] };
  for (const s of samples) {
    try {
      await client.callTool("pica_recording_samples_add", {
        recording_id: recordingId,
        source: SOURCE,
        sample_name: s.sampleName,
        clearance_status: CLEARANCE,
      });
      outcome.added += 1;
    } catch (e) {
      if (e instanceof PicaMcpError && e.code === "401") throw e;
      outcome.failed += 1;
      outcome.errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return outcome;
}
