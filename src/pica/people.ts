// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { type PicaMcpClient } from "./mcpClient";

/** An existing org person the credit/writer dialogs can suggest. */
export interface PersonCandidate {
  id: string;
  name: string;
  stageNames: string[];
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Shape a pica_people_query result (envelope-tolerant) into candidates. */
export function toPersonCandidates(raw: unknown): PersonCandidate[] {
  const obj = raw as { people?: unknown; items?: unknown; data?: unknown } | null;
  const list = Array.isArray(raw)
    ? raw
    : (obj?.people ?? obj?.items ?? (obj?.data as { people?: unknown })?.people ?? []);
  if (!Array.isArray(list)) return [];
  const out: PersonCandidate[] = [];
  const seen = new Set<string>();
  for (const p of list as Array<Record<string, unknown>>) {
    const id = typeof p?.id === "string" ? p.id : "";
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const stageNames = Array.isArray(p?.stage_names)
      ? (p.stage_names as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [];
    out.push({ id, name, stageNames });
  }
  return out;
}

/** Flat, de-duplicated list of every name + stage name, for the dialog datalist. */
export function candidateNames(candidates: PersonCandidate[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    for (const n of [c.name, ...c.stageNames]) {
      const t = n.trim();
      if (!t || seen.has(norm(t))) continue;
      seen.add(norm(t));
      out.push(t);
    }
  }
  return out;
}

/**
 * Resolve a typed performer name to a person id by EXACT (case/space-insensitive)
 * match against any candidate's name or stage names. Returns the id only when
 * EXACTLY ONE candidate matches; undefined for zero or ambiguous (>1) matches —
 * the server then resolves the free-text name (ADR-255).
 */
export function resolvePersonId(name: string, candidates: PersonCandidate[]): string | undefined {
  const q = norm(name);
  if (!q) return undefined;
  const hits = candidates.filter(
    (c) => norm(c.name) === q || c.stageNames.some((s) => norm(s) === q),
  );
  return hits.length === 1 ? hits[0]!.id : undefined;
}

/**
 * Fetch the org's people for the typeahead. Best-effort: callers catch and fall
 * back to no suggestions. Paginated with a safety cap so a large org isn't
 * silently truncated to one page (the typeahead degrades gracefully if the cap
 * is hit).
 */
export async function fetchPeopleCandidates(client: PicaMcpClient): Promise<PersonCandidate[]> {
  const PAGE = 200;
  const CAP = 2000;
  const all: PersonCandidate[] = [];
  for (let offset = 0; offset < CAP; offset += PAGE) {
    const raw = await client.callTool("pica_people_query", { limit: PAGE, offset });
    const page = toPersonCandidates(raw);
    all.push(...page);
    if (page.length < PAGE) break;
  }
  const seen = new Set<string>();
  return all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}
