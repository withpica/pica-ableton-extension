// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.
import { describe, it, expect } from "vitest";
import { mapAudioQueryToStems, selectionParam } from "../src/pica/shareStems";

describe("mapAudioQueryToStems", () => {
  it("prefers stem_label, falls back to filename, carries file_type + id", () => {
    const out = mapAudioQueryToStems([
      { id: "a", filename: "drums.wav", stem_label: "drums", file_type: "stem" },
      { id: "b", filename: "master.wav", stem_label: null, file_type: "master" },
    ]);
    expect(out).toEqual([
      { id: "a", label: "drums", fileType: "stem" },
      { id: "b", label: "master.wav", fileType: "master" },
    ]);
  });

  it("falls back to id when filename is also absent", () => {
    const out = mapAudioQueryToStems([{ id: "c" }]);
    expect(out[0]!.label).toBe("c");
    expect(out[0]!.fileType).toBe("file");
  });

  it("trims stem_label whitespace", () => {
    const out = mapAudioQueryToStems([{ id: "d", stem_label: "  bass  " }]);
    expect(out[0]!.label).toBe("bass");
  });

  it("treats empty-string stem_label as absent, uses filename", () => {
    const out = mapAudioQueryToStems([{ id: "e", stem_label: "", filename: "mix.wav" }]);
    expect(out[0]!.label).toBe("mix.wav");
  });
});

describe("selectionParam", () => {
  it("returns undefined when all ids are chosen (share all)", () => {
    expect(selectionParam(["a", "b"], ["a", "b"])).toBeUndefined();
  });

  it("returns the chosen subset when narrowed", () => {
    expect(selectionParam(["a", "b", "c"], ["a", "c"])).toEqual(["a", "c"]);
  });

  it("returns undefined when chosenIds is empty", () => {
    expect(selectionParam(["a", "b"], [])).toBeUndefined();
  });
});
