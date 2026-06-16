// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect } from "vitest";
import { toPersonCandidates, candidateNames, resolvePersonId, fetchPeopleCandidates } from "../src/pica/people";

describe("toPersonCandidates", () => {
  it("unwraps {people}, maps id/name/stage_names, drops blank/idless, dedupes by id", () => {
    const raw = {
      people: [
        { id: "1", name: "Elle Limebear", stage_names: ["Elle", "EL"] },
        { id: "1", name: "Elle Limebear", stage_names: [] },
        { id: "2", name: "  ", stage_names: [] },
        { id: "", name: "No Id", stage_names: [] },
        { id: "3", name: "Sam", stage_names: null },
      ],
    };
    expect(toPersonCandidates(raw)).toEqual([
      { id: "1", name: "Elle Limebear", stageNames: ["Elle", "EL"] },
      { id: "3", name: "Sam", stageNames: [] },
    ]);
  });

  it("accepts a bare array and other envelopes, returns [] for junk", () => {
    expect(toPersonCandidates([{ id: "9", name: "A", stage_names: [] }])).toHaveLength(1);
    expect(toPersonCandidates({ data: { people: [{ id: "9", name: "A" }] } })).toHaveLength(1);
    expect(toPersonCandidates(null)).toEqual([]);
    expect(toPersonCandidates({})).toEqual([]);
  });
});

describe("candidateNames", () => {
  it("flattens names + stage names, trims, dedupes case-insensitively, drops blanks", () => {
    const names = candidateNames([
      { id: "1", name: "Elle Limebear", stageNames: ["Elle", "elle"] },
      { id: "2", name: "Elle Limebear", stageNames: [] },
      { id: "3", name: "Sam", stageNames: [""] },
    ]);
    expect(names).toEqual(["Elle Limebear", "Elle", "Sam"]);
  });
});

describe("resolvePersonId", () => {
  const cands = [
    { id: "1", name: "Elle Limebear", stageNames: ["Elle"] },
    { id: "2", name: "Sam Smith", stageNames: [] },
    { id: "3", name: "Sam Smith", stageNames: [] },
  ];
  it("matches by exact name (case/space-insensitive)", () => {
    expect(resolvePersonId("  elle limebear ", cands)).toBe("1");
  });
  it("matches by stage name", () => {
    expect(resolvePersonId("Elle", cands)).toBe("1");
  });
  it("returns undefined when no match", () => {
    expect(resolvePersonId("Nobody", cands)).toBeUndefined();
  });
  it("returns undefined when ambiguous (>1 candidate matches)", () => {
    expect(resolvePersonId("Sam Smith", cands)).toBeUndefined();
  });
  it("returns undefined for blank input", () => {
    expect(resolvePersonId("  ", cands)).toBeUndefined();
  });
});

describe("fetchPeopleCandidates", () => {
  function pagedClient(pages: Array<Array<{ id: string; name: string; stage_names?: string[] }>>) {
    let call = 0;
    return {
      callTool: async (_name: string, _args: Record<string, unknown>) => {
        const page = pages[call] ?? [];
        call++;
        return { people: page };
      },
    } as unknown as import("../src/pica/mcpClient").PicaMcpClient;
  }

  it("accumulates across full pages and stops on a short page", async () => {
    const full = Array.from({ length: 200 }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));
    const short = [{ id: "z1", name: "Z1" }];
    const out = await fetchPeopleCandidates(pagedClient([full, short]));
    expect(out).toHaveLength(201);
  });

  it("dedupes ids across pages", async () => {
    const p1 = Array.from({ length: 200 }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));
    const p2 = [{ id: "a0", name: "A0 again" }, { id: "new", name: "New" }]; // a0 repeats
    const out = await fetchPeopleCandidates(pagedClient([p1, p2]));
    expect(out).toHaveLength(201); // 200 + 1 new, a0 deduped
    expect(out.filter((c) => c.id === "a0")).toHaveLength(1);
  });
});
