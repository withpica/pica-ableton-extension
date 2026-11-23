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
    const full = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));
    const short = [{ id: "z1", name: "Z1" }];
    const out = await fetchPeopleCandidates(pagedClient([full, short]));
    expect(out).toHaveLength(501);
  });

  // A nameless row is dropped, but the page PICA sent was still full.
  it("keeps paging past a full page that had a row it couldn't use", async () => {
    const full = Array.from({ length: 500 }, (_, i) => (i === 0 ? { id: "x", name: "" } : { id: `a${i}`, name: `A${i}` }));
    const short = [{ id: "z1", name: "Féz" }];
    const out = await fetchPeopleCandidates(pagedClient([full, short]));
    expect(out.map((c) => c.name)).toContain("Féz");
  });

  it("dedupes ids across pages", async () => {
    const p1 = Array.from({ length: 500 }, (_, i) => ({ id: `a${i}`, name: `A${i}` }));
    const p2 = [{ id: "a0", name: "A0 again" }, { id: "new", name: "New" }]; // a0 repeats
    const out = await fetchPeopleCandidates(pagedClient([p1, p2]));
    expect(out).toHaveLength(501); // 500 + 1 new, a0 deduped
    expect(out.filter((c) => c.id === "a0")).toHaveLength(1);
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
  it("asks only for people with an email, page by page, until a short page", async () => {
    const calls: any[] = [];
    const page = (n: number, from: number) =>
      Array.from({ length: n }, (_, i) => ({ name: `P${from + i}`, email: `p${from + i}@x.co` }));
    const client = {
      callTool: async (name: string, args: any) => {
        calls.push({ name, args });
        return { people: args.offset === 0 ? page(500, 0) : page(3, 500) };
      },
    } as any;
    const contacts = await fetchEmailContacts(client);
    expect(contacts).toHaveLength(503);
    expect(calls).toEqual([
      { name: "pica_people_query", args: { has_email: true, limit: 500, offset: 0 } },
      { name: "pica_people_query", args: { has_email: true, limit: 500, offset: 500 } },
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
