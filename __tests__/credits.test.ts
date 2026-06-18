// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import {
  mergeRowsByPerson,
  buildPrefillTree,
  serializeFrontier,
  loadExistingCredits,
  saveCredits,
  summarizeCredits,
  type CreditRow,
  type ExistingCredit,
  type FrontierNode,
  type CreditOutcome,
} from "../src/pica/credits";
import { derivePartTree, type PartNode } from "../src/session/parts";
import { PicaMcpError } from "../src/pica/mcpClient";

function fakeClient() {
  return { callTool: vi.fn() } as unknown as import("../src/pica/mcpClient").PicaMcpClient & {
    callTool: ReturnType<typeof vi.fn>;
  };
}

const leaf = (instrumentLabel: string, kind: PartNode["kind"] = "audio"): PartNode => ({
  key: `k:${instrumentLabel}`,
  instrumentLabel,
  trackName: instrumentLabel,
  kind,
  deviceNames: [],
  sampleFiles: [],
});
const group = (instrumentLabel: string, children: PartNode[]): PartNode => ({
  key: `g:${instrumentLabel}`,
  instrumentLabel,
  trackName: instrumentLabel,
  kind: "group",
  deviceNames: [],
  sampleFiles: [],
  children,
});

describe("mergeRowsByPerson", () => {
  it("folds multiple rows for the same person into one with joined instruments", () => {
    const rows: CreditRow[] = [
      { instrument: "drums", performerName: "Dave Smith" },
      { instrument: "bass", performerName: "dave smith" }, // case-insensitive
      { instrument: "keys", performerName: "Maria" },
      { instrument: "synth", performerName: "  " }, // blank → ignored
    ];
    const merged = mergeRowsByPerson(rows);
    expect(merged).toEqual([
      { performerName: "Dave Smith", instrument: "drums, bass" },
      { performerName: "Maria", instrument: "keys" },
    ]);
  });
});

describe("buildPrefillTree", () => {
  it("fills a leaf's performer from an existing credit matched by instrument", () => {
    const nodes = buildPrefillTree(
      [leaf("Drums"), leaf("Vox")],
      [{ id: "c1", credited_name: "Dave Smith", role: "Performer", instrument: "drums, bass" }],
    );
    expect(nodes[0]).toMatchObject({ instrument: "Drums", performerName: "Dave Smith", expanded: false });
    expect(nodes[1]).toMatchObject({ instrument: "Vox", performerName: "" });
  });

  it("expands a group when a child matches an existing credit, leaving the group name blank", () => {
    const nodes = buildPrefillTree(
      [group("Live Drums", [leaf("Kick"), leaf("Snare")])],
      [{ id: "c1", credited_name: "Bob", role: "Performer", instrument: "kick" }],
    );
    expect(nodes[0]).toMatchObject({ kind: "group", expanded: true, performerName: "" });
    expect(nodes[0]!.children![0]).toMatchObject({ instrument: "Kick", performerName: "Bob" });
  });

  it("prefills a collapsed group from an existing credit on the group label", () => {
    const nodes = buildPrefillTree(
      [group("Live Drums", [leaf("Kick"), leaf("Snare")])],
      [{ id: "c1", credited_name: "Bob", role: "Performer", instrument: "Live Drums" }],
    );
    expect(nodes[0]).toMatchObject({ kind: "group", expanded: false, performerName: "Bob" });
    expect(nodes[0]!.children!.every((c) => c.performerName === "")).toBe(true);
  });

  it("appends existing credits that match no node as standalone leaf nodes", () => {
    const nodes = buildPrefillTree(
      [leaf("Vox")],
      [{ id: "c1", credited_name: "Maria", role: "Performer", instrument: "tambourine" }],
    );
    expect(nodes).toHaveLength(2);
    expect(nodes[1]).toMatchObject({ instrument: "tambourine", performerName: "Maria", kind: "audio", expanded: false });
  });

  it("appends a group-label credit as an extra when a child already expanded the group", () => {
    const nodes = buildPrefillTree(
      [group("Live Drums", [leaf("Kick")])],
      [
        { id: "c1", credited_name: "ChildPerson", role: "Performer", instrument: "kick" },
        { id: "c2", credited_name: "GroupPerson", role: "Performer", instrument: "Live Drums" },
      ],
    );
    // c1 expands the group via the child; c2 (group label) is left unclaimed → appended as an extra leaf
    expect(nodes[0]).toMatchObject({ kind: "group", expanded: true, performerName: "" });
    expect(nodes[0]!.children![0]).toMatchObject({ instrument: "Kick", performerName: "ChildPerson" });
    expect(nodes[1]).toMatchObject({ instrument: "Live Drums", performerName: "GroupPerson", kind: "audio" });
  });

  it("expands all ancestors when a deeply nested grandchild matches a credit", () => {
    const nodes = buildPrefillTree(
      [group("DRUMS", [group("Live Drums", [leaf("Kick")])])],
      [{ id: "c1", credited_name: "Bob", role: "Performer", instrument: "kick" }],
    );
    expect(nodes[0]).toMatchObject({ kind: "group", expanded: true }); // outer
    expect(nodes[0]!.children![0]).toMatchObject({ kind: "group", expanded: true }); // inner
    expect(nodes[0]!.children![0]!.children![0]).toMatchObject({ instrument: "Kick", performerName: "Bob" });
  });
});

describe("serializeFrontier", () => {
  it("emits a collapsed group as one row and ignores its children", () => {
    const tree: FrontierNode[] = [
      { instrument: "Live Drums", performerName: "Bob", kind: "group", expanded: false,
        children: [{ instrument: "Kick", performerName: "ignored", kind: "audio", expanded: false }] },
    ];
    expect(serializeFrontier(tree)).toEqual([{ instrument: "Live Drums", performerName: "Bob" }]);
  });

  it("emits an expanded group's children and omits the group itself", () => {
    const tree: FrontierNode[] = [
      { instrument: "GTRS", performerName: "", kind: "group", expanded: true, children: [
        { instrument: "rhythm", performerName: "Ann", kind: "audio", expanded: false },
        { instrument: "lead", performerName: "Cy", kind: "audio", expanded: false },
      ] },
    ];
    expect(serializeFrontier(tree)).toEqual([
      { instrument: "rhythm", performerName: "Ann" },
      { instrument: "lead", performerName: "Cy" },
    ]);
  });

  it("recurses into nested expanded groups", () => {
    const tree: FrontierNode[] = [
      { instrument: "DRUMS", performerName: "", kind: "group", expanded: true, children: [
        { instrument: "Live Drums", performerName: "", kind: "group", expanded: true, children: [
          { instrument: "Kick", performerName: "Bob", kind: "audio", expanded: false },
        ] },
      ] },
    ];
    expect(serializeFrontier(tree)).toEqual([{ instrument: "Kick", performerName: "Bob" }]);
  });

  it("emits plain leaves as themselves", () => {
    const tree: FrontierNode[] = [{ instrument: "Vox", performerName: "Maria", kind: "audio", expanded: false }];
    expect(serializeFrontier(tree)).toEqual([{ instrument: "Vox", performerName: "Maria" }]);
  });
});

describe("end-to-end frontier from a derived tree", () => {
  it("a collapsed drum group with no saved credits serialises to one blank-name row", () => {
    const tree = derivePartTree({ tempo: 120, rootNote: 0, scaleName: "Major", tracks: [
      { name: "Drums", type: "group", deviceNames: [], sampleFilePaths: [], groupIndex: null, clipCount: 0 },
      { name: "Kick", type: "audio", deviceNames: ["EQ"], sampleFilePaths: [], groupIndex: 0, clipCount: 0 },
    ] });
    const prefill = buildPrefillTree(tree, []);
    // collapsed group → one row carrying the group label
    expect(serializeFrontier(prefill)).toEqual([
      { instrument: "Drums", performerName: "" },
    ]);
  });
});

describe("loadExistingCredits", () => {
  it("reads recording_credits via pica_recordings_inspect", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValue({
      recording_credits: [
        { id: "c1", credited_name: "Dave Smith", role: "Performer", instrument: "drums" },
      ],
    });
    const out = await loadExistingCredits(c, "rec-1");
    expect(c.callTool).toHaveBeenCalledWith("pica_recordings_inspect", {
      id: "rec-1",
      sections: ["recording_credits"],
    });
    expect(out).toHaveLength(1);
  });

  it("returns [] when the section is missing or null", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValue({ recording_credits: null });
    expect(await loadExistingCredits(c, "rec-1")).toEqual([]);
  });
});

describe("saveCredits (one bulk call)", () => {
  const rows: CreditRow[] = [
    { instrument: "drums", performerName: "Dave Smith" },
    { instrument: "keys", performerName: "Maria" },
  ];

  type BulkRow = {
    recording_id: string;
    credited_name: string;
    role: string;
    status: "created" | "skipped_existing";
    credit_id?: string;
  };
  const bulkResult = (results: BulkRow[]) => ({
    dry_run: false,
    target_recording_count: 1,
    total_rows: results.length,
    created: results.filter((r) => r.status === "created").length,
    skipped_existing: results.filter((r) => r.status === "skipped_existing").length,
    would_create: 0,
    would_skip_existing: 0,
    results,
  });
  const row = (
    credited_name: string,
    status: BulkRow["status"] = "created",
  ): BulkRow => ({ recording_id: "rec-1", credited_name, role: "Performer", status });

  it("issues ONE pica_recording_credits_bulk_update call for all merged people", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce(bulkResult([row("Dave Smith"), row("Maria")]));

    const outcomes = await saveCredits(c, "rec-1", rows, []);

    expect(c.callTool).toHaveBeenCalledTimes(1);
    expect(c.callTool).toHaveBeenCalledWith("pica_recording_credits_bulk_update", {
      recording_ids: ["rec-1"],
      credits: [
        { credited_name: "Dave Smith", role: "Performer", instrument: "drums" },
        { credited_name: "Maria", role: "Performer", instrument: "keys" },
      ],
    });
    // no person_id sent → both draft
    expect(outcomes).toEqual([
      { creditedName: "Dave Smith", instrument: "drums", status: "saved_draft" },
      { creditedName: "Maria", instrument: "keys", status: "saved_draft" },
    ]);
  });

  it("labels saved_linked for a row whose person_id we sent", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce(bulkResult([row("Elle")]));
    const cands = [{ id: "p1", name: "Elle Limebear", stageNames: ["Elle"] }];

    const out = await saveCredits(
      c,
      "rec-1",
      [{ instrument: "guitar", performerName: "Elle" }],
      [],
      cands,
    );

    expect(c.callTool).toHaveBeenCalledWith("pica_recording_credits_bulk_update", {
      recording_ids: ["rec-1"],
      credits: [
        { credited_name: "Elle", role: "Performer", instrument: "guitar", person_id: "p1" },
      ],
    });
    expect(out[0]).toMatchObject({ status: "saved_linked" });
  });

  it("maps a server-reported skipped_existing row to skipped_existing", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce(
      bulkResult([row("Dave Smith", "skipped_existing"), row("Maria")]),
    );

    const out = await saveCredits(c, "rec-1", rows, []);

    expect(out[0]).toMatchObject({ status: "skipped_existing" });
    expect(out[1]).toMatchObject({ status: "saved_draft" });
  });

  it("pre-skips rows already in `existing` and sends only the rest, preserving order", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce(bulkResult([row("Maria")]));
    const existing: ExistingCredit[] = [
      { id: "c1", credited_name: "dave smith", role: "Performer", instrument: "drums" },
    ];

    const out = await saveCredits(c, "rec-1", rows, existing);

    expect(c.callTool).toHaveBeenCalledWith("pica_recording_credits_bulk_update", {
      recording_ids: ["rec-1"],
      credits: [{ credited_name: "Maria", role: "Performer", instrument: "keys" }],
    });
    expect(out).toEqual([
      { creditedName: "Dave Smith", instrument: "drums", status: "skipped_existing" },
      { creditedName: "Maria", instrument: "keys", status: "saved_draft" },
    ]);
  });

  it("makes no call and returns [] when there are no named rows", async () => {
    const c = fakeClient();
    const out = await saveCredits(c, "rec-1", [{ instrument: "drums", performerName: "" }], []);
    expect(c.callTool).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("makes no call when every merged row already exists", async () => {
    const c = fakeClient();
    const existing: ExistingCredit[] = [
      { id: "c1", credited_name: "dave smith", role: "Performer" },
      { id: "c2", credited_name: "maria", role: "Performer" },
    ];
    const out = await saveCredits(c, "rec-1", rows, existing);
    expect(c.callTool).not.toHaveBeenCalled();
    expect(out).toEqual([
      { creditedName: "Dave Smith", instrument: "drums", status: "skipped_existing" },
      { creditedName: "Maria", instrument: "keys", status: "skipped_existing" },
    ]);
  });

  it("rethrows a 401 PicaMcpError (so withReconnect can reconnect)", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValueOnce(new PicaMcpError("unauthorised", "401"));
    await expect(saveCredits(c, "rec-1", rows, [])).rejects.toBeInstanceOf(PicaMcpError);
  });

  it("marks the whole batch failed on a non-401 error (route is all-or-nothing)", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValueOnce(new PicaMcpError("server error", "500"));

    const out = await saveCredits(c, "rec-1", rows, []);

    expect(out).toEqual([
      { creditedName: "Dave Smith", instrument: "drums", status: "failed", error: "server error" },
      { creditedName: "Maria", instrument: "keys", status: "failed", error: "server error" },
    ]);
  });

  it("omits person_id for new (free-text) and ambiguous names", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce(bulkResult([row("Brand New Person"), row("Sam")]));
    const cands = [
      { id: "p1", name: "Elle Limebear", stageNames: ["Elle"] },
      { id: "p2", name: "Sam", stageNames: [] },
      { id: "p3", name: "Sam", stageNames: [] }, // ambiguous → no link
    ];

    await saveCredits(
      c,
      "rec-1",
      [
        { instrument: "keys", performerName: "Brand New Person" },
        { instrument: "bass", performerName: "Sam" },
      ],
      [],
      cands,
    );

    const sent = c.callTool.mock.calls[0]![1] as { credits: Array<Record<string, unknown>> };
    expect(sent.credits[0]!.person_id).toBeUndefined();
    expect(sent.credits[1]!.person_id).toBeUndefined();
  });
});

describe("summarizeCredits", () => {
  const oc = (status: CreditOutcome["status"]): CreditOutcome => ({
    creditedName: "x",
    instrument: "y",
    status,
  });

  it("reports none saved for an empty list", () => {
    expect(summarizeCredits([])).toBe("credits: none saved.");
  });

  it("counts saved (linked + draft) and surfaces draft/unchanged/failed, omitting zero categories", () => {
    const out = [
      oc("saved_linked"),
      oc("saved_linked"),
      oc("saved_draft"),
      oc("skipped_existing"),
      oc("skipped_existing"),
      oc("failed"),
    ];
    expect(summarizeCredits(out)).toBe(
      "credits: 3 saved, 1 draft, 2 unchanged, 1 failed.",
    );
  });

  it("shows only the non-zero category", () => {
    expect(summarizeCredits([oc("saved_linked"), oc("saved_linked")])).toBe(
      "credits: 2 saved.",
    );
    expect(summarizeCredits([oc("skipped_existing")])).toBe(
      "credits: 1 unchanged.",
    );
  });
});
