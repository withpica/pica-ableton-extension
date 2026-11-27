// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect } from "vitest";
import { nextOffset, loadAllPages } from "../src/pica/paging";
import { fetchWorkAudio } from "../src/pica/shareStems";
import type { PicaMcpClient } from "../src/pica/mcpClient";

describe("nextOffset", () => {
  it("reads has_more / next_offset at the top (pica_people_query)", () => {
    expect(nextOffset({ items: [], has_more: true, next_offset: 60 }, 0, 60, 100)).toBe(60);
    expect(nextOffset({ has_more: false }, 0, 100, 100)).toBeNull();
  });

  it("reads them under metadata.page (pica_audio_query)", () => {
    const raw = { items: [], metadata: { page: { has_more: true, next_offset: 8 } } };
    expect(nextOffset(raw, 0, 8, 200)).toBe(8);
  });

  it("treats a short page with has_more as NOT the end", () => {
    expect(nextOffset({ has_more: true }, 100, 40, 100)).toBe(140);
  });

  it("falls back to 'a full page may have more' when nothing says has_more", () => {
    expect(nextOffset({ people: [] }, 0, 100, 100)).toBe(100);
    expect(nextOffset({ people: [] }, 0, 99, 100)).toBeNull();
  });

  it("never stands still or steps back", () => {
    expect(nextOffset({ has_more: true, next_offset: 0 }, 0, 10, 100)).toBeNull();
    expect(nextOffset({ has_more: true }, 50, 0, 100)).toBeNull();
  });
});

describe("loadAllPages", () => {
  it("stops at the cap and says the load is incomplete", async () => {
    const client = { callTool: async (_n: string, a: any) => ({ rows: [a.offset], has_more: true, next_offset: a.offset + 10 }) } as unknown as PicaMcpClient;
    const out = await loadAllPages(client, "t", {}, (r: any) => r.rows, { pageSize: 10, cap: 30 });
    expect(out.rows).toEqual([0, 10, 20]);
    expect(out.complete).toBe(false);
  });
});

describe("fetchWorkAudio (stem picker)", () => {
  it("lists every file of a song, past a page PICA trimmed", async () => {
    const calls: any[] = [];
    const file = (i: number) => ({ id: `f${i}`, filename: `stem ${i}.wav`, file_type: "stem" });
    const client = {
      callTool: async (name: string, args: any) => {
        calls.push({ name, args });
        // pica_audio_query keeps its page under 100KB itself and says where to resume.
        return args.offset === 0
          ? { count: 8, items: Array.from({ length: 8 }, (_, i) => file(i)), metadata: { page: { has_more: true, next_offset: 8 } } }
          : { count: 52, items: Array.from({ length: 52 }, (_, i) => file(i + 8)), metadata: { page: { has_more: false, next_offset: null } } };
      },
    } as unknown as PicaMcpClient;
    const rows = await fetchWorkAudio(client, "w1");
    expect(rows).toHaveLength(60);
    expect(calls).toEqual([
      { name: "pica_audio_query", args: { work_id: "w1", limit: 200, offset: 0 } },
      { name: "pica_audio_query", args: { work_id: "w1", limit: 200, offset: 8 } },
    ]);
  });
});
