// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi } from "vitest";
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
  type Row = { id: string; name: string; stage_names?: string[] };
  /** Pages answered in order; each may say has_more / next_offset, as PICA does. */
  function pagedClient(pages: Array<{ people: Row[]; has_more?: boolean; next_offset?: number }>) {
    const calls: Array<Record<string, unknown>> = [];
    let call = 0;
    const client = {
      callTool: async (_name: string, args: Record<string, unknown>) => {
        calls.push(args);
        return pages[call++] ?? { people: [], has_more: false };
      },
    } as unknown as import("../src/pica/mcpClient").PicaMcpClient;
    return { client, calls };
  }
  const rows = (n: number, from = 0): Row[] => Array.from({ length: n }, (_, i) => ({ id: `a${from + i}`, name: `A${from + i}` }));

  it("follows has_more past a page PICA trimmed short (founder smoke 2026-11-25)", async () => {
    // PICA trims an answer over 100KB to what fits and says has_more. The old
    // loop stopped at the first short page and kept only those people.
    const { client, calls } = pagedClient([
      { people: rows(60), has_more: true, next_offset: 60 },
      { people: rows(60, 60), has_more: true, next_offset: 120 },
      { people: [{ id: "f", name: "Féz" }], has_more: false },
    ]);
    const out = await fetchPeopleCandidates(client);
    expect(out).toHaveLength(121);
    expect(out.map((c) => c.name)).toContain("Féz");
    expect(calls.map((c) => c.offset)).toEqual([0, 60, 120]);
  });

  it("stops when has_more is false, even on a full page", async () => {
    const { client, calls } = pagedClient([{ people: rows(100), has_more: false }]);
    expect(await fetchPeopleCandidates(client)).toHaveLength(100);
    expect(calls).toHaveLength(1);
  });

  it("keeps what loaded when a later page fails", async () => {
    let call = 0;
    const client = {
      callTool: async () => {
        if (call++ === 0) return { people: rows(60), has_more: true, next_offset: 60 };
        throw new Error("timeout");
      },
    } as unknown as import("../src/pica/mcpClient").PicaMcpClient;
    expect(await fetchPeopleCandidates(client)).toHaveLength(60);
  });

  it("lets the first page's error through, so the caller can say the people did not load", async () => {
    const client = { callTool: async () => { throw new Error("401"); } } as unknown as import("../src/pica/mcpClient").PicaMcpClient;
    await expect(fetchPeopleCandidates(client)).rejects.toThrow("401");
  });

  it("dedupes ids across pages", async () => {
    const { client } = pagedClient([
      { people: rows(100), has_more: true, next_offset: 100 },
      { people: [{ id: "a0", name: "A0 again" }, { id: "new", name: "New" }], has_more: false },
    ]);
    const out = await fetchPeopleCandidates(client);
    expect(out).toHaveLength(101);
    expect(out.filter((c) => c.id === "a0")).toHaveLength(1);
  });

  it("carries no email into what the dialogs receive", async () => {
    const { client } = pagedClient([
      { people: [{ id: "1", name: "Sam", email: "sam@example.com" } as Row & { email: string }], has_more: false },
    ]);
    const [p] = await fetchPeopleCandidates(client);
    expect(p).toEqual({ id: "1", name: "Sam", stageNames: [] });
    expect(JSON.stringify(p)).not.toContain("@");
  });
});

import { toEmailContacts, fetchEmailContacts } from "../src/pica/people";

describe("toEmailContacts", () => {
  it("keeps people with a name and a usable email, one per email", () => {
    expect(
      toEmailContacts({
        people: [
          { id: "1", name: "Sarah Holt", email: "sarah@band.com" },
          { id: "2", name: "Sarah H", email: "SARAH@band.com" },
          { id: "3", name: "No Email", email: null },
          { id: "4", name: "Bad", email: "not-an-email" },
          { id: "5", name: "  ", email: "blank@band.com" },
          { id: "6", name: "Tom", email: " tom@band.com " },
        ],
      }),
    ).toEqual([
      { name: "Sarah Holt", email: "sarah@band.com" },
      { name: "Tom", email: "tom@band.com" },
    ]);
  });

  it("accepts a bare array and returns [] for junk", () => {
    expect(toEmailContacts([{ name: "A", email: "a@b.co" }])).toHaveLength(1);
    expect(toEmailContacts(null)).toEqual([]);
    expect(toEmailContacts({})).toEqual([]);
  });
});

describe("fetchEmailContacts", () => {
  it("asks only for people with an email, following has_more past a trimmed page", async () => {
    const calls: any[] = [];
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `P${from + i}`, email: `p${from + i}@x.co` }));
    const client = {
      callTool: async (name: string, args: any) => {
        calls.push({ name, args });
        // PICA trimmed the first page to 40 under its 100KB cap.
        return args.offset === 0
          ? { people: page(40, 0), has_more: true, next_offset: 40 }
          : { people: page(3, 40), has_more: false };
      },
    } as any;
    const contacts = await fetchEmailContacts(client);
    expect(contacts).toHaveLength(43);
    expect(calls).toEqual([
      { name: "pica_people_query", args: { has_email: true, limit: 100, offset: 0 } },
      { name: "pica_people_query", args: { has_email: true, limit: 100, offset: 40 } },
    ]);
  });

  it("lets an error through, so the caller falls back to a plain field", async () => {
    const client = { callTool: async () => { throw new Error("403"); } } as any;
    await expect(fetchEmailContacts(client)).rejects.toThrow("403");
  });
});

// Founder smoke 2026-11-23 (twice): the account owner's own one-word name,
// "Féz", sorts last in PICA's surname order, past what one dialog loads.
describe("fetchPeopleCandidates with the account's own name", () => {
  it("also searches PICA for the account's own name and keeps that person", async () => {
    const calls: any[] = [];
    const client = {
      callTool: async (name: string, args: any) => {
        calls.push(args);
        if (args.query) return { people: [{ id: "me", name: "Féz", stage_names: ["SoundsLikeFez"] }] };
        return { people: [{ id: "a1", name: "Felicia Alamu" }] };
      },
    } as any;
    const out = await fetchPeopleCandidates(client, " Féz ");
    expect(calls[0]).toEqual({ query: "Féz", limit: 50 });
    expect(out.map((c) => c.id)).toEqual(["me", "a1"]);
    expect(resolvePersonId("Féz", out)).toBe("me");
  });

  it("still loads the list when the name search fails, and skips it with no name", async () => {
    const calls: any[] = [];
    const client = {
      callTool: async (_n: string, args: any) => {
        calls.push(args);
        if (args.query) throw new Error("down");
        return { people: [{ id: "a1", name: "Felicia Alamu" }] };
      },
    } as any;
    expect((await fetchPeopleCandidates(client, "Féz")).map((c) => c.id)).toEqual(["a1"]);
    calls.length = 0;
    await fetchPeopleCandidates(client, null);
    expect(calls.some((a) => a.query)).toBe(false);
  });
});

import { searchPeople } from "../src/pica/people";

// b9 2026-11-23: any one-word name or band past the loaded list was invisible,
// so the artist is also searched in PICA by what was typed.
describe("searchPeople", () => {
  it("asks PICA with what was typed and shapes the matches", async () => {
    const calls: any[] = [];
    const client = {
      callTool: async (name: string, args: any) => {
        calls.push([name, args]);
        return { people: [{ id: "b1", name: "Lagbaja", stage_names: [] }] };
      },
    } as any;
    expect((await searchPeople(client, "  lagba ")).map((c) => c.id)).toEqual(["b1"]);
    expect(calls).toEqual([["pica_people_query", { query: "lagba", limit: 10 }]]);
  });

  it("asks nothing for an empty name", async () => {
    const client = { callTool: vi.fn() } as any;
    expect(await searchPeople(client, " ")).toEqual([]);
    expect(client.callTool).not.toHaveBeenCalled();
  });
});

import { hasExactMatch } from "../src/pica/people";

describe("hasExactMatch", () => {
  it("is true for a name or stage name, case and spaces aside, and false otherwise", () => {
    const c = [{ id: "a", name: "Jo Bloggs", stageNames: ["JB"] }];
    expect(hasExactMatch(" jo bloggs ", c)).toBe(true);
    expect(hasExactMatch("jb", c)).toBe(true);
    expect(hasExactMatch("Jo", c)).toBe(false);
    expect(hasExactMatch("", c)).toBe(false);
  });
});
