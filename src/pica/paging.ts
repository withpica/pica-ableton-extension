// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { type PicaMcpClient } from "./mcpClient";

/**
 * Where the next page starts, read from a PICA list result.
 *
 * PICA's list tools answer `has_more` and `next_offset`, either at the top
 * (pica_people_query: `{ count, items, has_more, ... }`) or under
 * `metadata.page` (pica_audio_query). A page can come back SHORTER than the
 * limit asked for while more remain: the server trims any answer over 100KB
 * to the items that fit and says so with has_more and next_offset. So a short
 * page is never the end; only has_more says that. (The loops this replaces
 * stopped at the first short page, so a big catalogue loaded only its first
 * few dozen people: founder smoke 2026-11-25.)
 *
 * Returns the next offset, or null when the list is done. A result with no
 * has_more anywhere falls back to "a full page means there may be more".
 */
export function nextOffset(raw: unknown, offset: number, returned: number, limit: number): number | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const meta = (o.metadata ?? {}) as Record<string, unknown>;
  const page = ((meta.page ?? o.page) ?? {}) as Record<string, unknown>;
  const flag = [o.has_more, o.hasMore, page.has_more, meta.has_more].find((v) => typeof v === "boolean") as
    | boolean
    | undefined;
  const more = flag ?? returned >= limit;
  if (!more || returned === 0) return null;
  const next = [o.next_offset, page.next_offset].find((v) => typeof v === "number") as number | undefined;
  const at = next ?? offset + returned;
  // Never step backwards or stand still: that would ask for the same page forever.
  return at > offset ? at : null;
}

/** What a paged load returns: every row it got, and whether it reached the end. */
export interface PagedLoad<T> {
  rows: T[];
  /** False when a page after the first failed, or the cap was reached. */
  complete: boolean;
}

/**
 * Read every page of a PICA list tool, following has_more / next_offset.
 *
 * The first page failing throws, so the caller can reconnect and retry (a 401
 * or an under-scoped key). A later page failing keeps what already loaded and
 * reports `complete: false`, so one bad page no longer loses the rest.
 */
export async function loadAllPages<T>(
  client: PicaMcpClient,
  tool: string,
  args: Record<string, unknown>,
  rowsOf: (raw: unknown) => T[],
  opts: { pageSize: number; cap: number },
): Promise<PagedLoad<T>> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    let raw: unknown;
    try {
      raw = await client.callTool(tool, { ...args, limit: opts.pageSize, offset });
    } catch (e) {
      if (offset === 0) throw e;
      return { rows, complete: false };
    }
    const page = rowsOf(raw);
    rows.push(...page);
    const next = nextOffset(raw, offset, page.length, opts.pageSize);
    if (next === null) return { rows, complete: true };
    if (next >= opts.cap) return { rows, complete: false };
    offset = next;
  }
}
