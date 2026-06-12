// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import {
  mergeRowsByPerson,
  buildPrefillRows,
  loadExistingCredits,
  saveCredits,
  type CreditRow,
  type ExistingCredit,
} from "../src/pica/credits";
import type { Part } from "../src/session/parts";

function fakeClient() {
  return { callTool: vi.fn() } as unknown as import("../src/pica/mcpClient").PicaMcpClient & {
    callTool: ReturnType<typeof vi.fn>;
  };
}

const part = (over: Partial<Part> & { instrumentLabel: string }): Part => ({
  key: `0:${over.instrumentLabel}`,
  trackName: over.instrumentLabel,
  deviceNames: [],
  sampleFiles: [],
  kind: "audio",
  ...over,
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

describe("buildPrefillRows", () => {
  it("fills performer names from existing credits matched by instrument", () => {
    const parts = [part({ instrumentLabel: "Drums" }), part({ instrumentLabel: "Vox" })];
    const existing: ExistingCredit[] = [
      { id: "c1", credited_name: "Dave Smith", role: "Performer", instrument: "drums, bass" },
    ];
    const rows = buildPrefillRows(parts, existing);
    expect(rows[0]).toEqual({ instrument: "Drums", performerName: "Dave Smith" });
    expect(rows[1]).toEqual({ instrument: "Vox", performerName: "" });
  });

  it("appends existing credits that match no detected part", () => {
    const rows = buildPrefillRows([part({ instrumentLabel: "Vox" })], [
      { id: "c1", credited_name: "Maria", role: "Performer", instrument: "tambourine" },
    ]);
    expect(rows).toEqual([
      { instrument: "Vox", performerName: "" },
      { instrument: "tambourine", performerName: "Maria" },
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
});
