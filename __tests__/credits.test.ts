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

describe("saveCredits", () => {
  const rows: CreditRow[] = [
    { instrument: "drums", performerName: "Dave Smith" },
    { instrument: "keys", performerName: "Maria" },
  ];

  it("writes one Performer credit per person and reports linked vs draft", async () => {
    const c = fakeClient();
    c.callTool
      .mockResolvedValueOnce({ id: "rc-1", person_id: "p-9" }) // Dave → linked
      .mockResolvedValueOnce({ id: "rc-2", person_id: null }); // Maria → draft

    const outcomes = await saveCredits(c, "rec-1", rows, []);

    expect(c.callTool).toHaveBeenNthCalledWith(1, "pica_recording_credits_update", {
      recording_id: "rec-1",
      credited_name: "Dave Smith",
      role: "Performer",
      instrument: "drums",
    });
    expect(outcomes).toEqual([
      { creditedName: "Dave Smith", instrument: "drums", status: "saved_linked" },
      { creditedName: "Maria", instrument: "keys", status: "saved_draft" },
    ]);
  });

  it("skips rows whose name+role already exist (re-run safety) without calling the tool", async () => {
    const c = fakeClient();
    c.callTool.mockResolvedValueOnce({ id: "rc-2", person_id: null });
    const existing: ExistingCredit[] = [
      { id: "c1", credited_name: "dave smith", role: "Performer", instrument: "drums" },
    ];

    const outcomes = await saveCredits(c, "rec-1", rows, existing);

    expect(c.callTool).toHaveBeenCalledTimes(1); // only Maria
    expect(outcomes[0]).toMatchObject({
      creditedName: "Dave Smith",
      status: "skipped_existing",
    });
  });

  it("reports a failed row and continues with the rest", async () => {
    const c = fakeClient();
    c.callTool
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "rc-2", person_id: null });

    const outcomes = await saveCredits(c, "rec-1", rows, []);

    expect(outcomes[0]).toMatchObject({ status: "failed", error: "boom" });
    expect(outcomes[1]).toMatchObject({ status: "saved_draft" });
  });

  it("rethrows a 401 PicaMcpError (so withReconnect can reconnect) instead of recording a failed outcome", async () => {
    const c = fakeClient();
    c.callTool.mockRejectedValueOnce(new PicaMcpError("unauthorised", "401"));

    await expect(saveCredits(c, "rec-1", rows, [])).rejects.toBeInstanceOf(
      PicaMcpError,
    );
    // aborted on the first row — the second row never ran
    expect(c.callTool).toHaveBeenCalledTimes(1);
  });

  it("records a failed outcome (does NOT rethrow) for a non-401 PicaMcpError", async () => {
    const c = fakeClient();
    c.callTool
      .mockRejectedValueOnce(new PicaMcpError("server error", "500"))
      .mockResolvedValueOnce({ id: "rc-2", person_id: null });

    const outcomes = await saveCredits(c, "rec-1", rows, []);

    expect(outcomes[0]).toMatchObject({ status: "failed", error: "server error" });
    expect(outcomes[1]).toMatchObject({ status: "saved_draft" });
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
