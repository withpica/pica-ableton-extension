// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect } from "vitest";
import {
  stemPhaseLabel,
  registerPhaseLabel,
  deliverPhaseLabel,
  creditsPhaseLabel,
  writersPhaseLabel,
  IDLE_LINES,
  rotateLine,
  obeysCopyInvariants,
} from "../src/storyCopy";

describe("stemPhaseLabel", () => {
  it("renders the render phase with the stem name", () => {
    expect(stemPhaseLabel("render", "drum loop")).toBe(
      "rendering drum loop, straight from the session…",
    );
  });
  it("includes the size on upload when given", () => {
    expect(stemPhaseLabel("upload", "drum loop", 33)).toBe(
      "drum loop, onto your master… (33 mb)",
    );
  });
  it("omits the size on upload when absent", () => {
    expect(stemPhaseLabel("upload", "drum loop")).toBe(
      "drum loop, onto your master…",
    );
  });
  it("renders the queued phase", () => {
    expect(stemPhaseLabel("queued", "drum loop")).toBe(
      "drum loop's in. analysis to follow…",
    );
  });
  it("falls back when the name is blank", () => {
    expect(stemPhaseLabel("render", "  ")).toBe(
      "rendering this stem, straight from the session…",
    );
  });
  it("preserves the data's own case (interpolation)", () => {
    expect(stemPhaseLabel("render", "Kick")).toContain("Kick");
  });
});

describe("rotateLine", () => {
  it("cycles through the pool by tick", () => {
    expect(rotateLine(["a", "b", "c"], 0)).toBe("a");
    expect(rotateLine(["a", "b", "c"], 1)).toBe("b");
    expect(rotateLine(["a", "b", "c"], 3)).toBe("a");
  });
  it("is safe for an empty pool", () => {
    expect(rotateLine([], 2)).toBe("");
  });
});

describe("IDLE_LINES voice invariants", () => {
  it("is the agreed blend pool", () => {
    expect(IDLE_LINES).toHaveLength(7);
    expect(IDLE_LINES[0]).toBe("made together. credited together.");
    expect(IDLE_LINES).toContain("a session forgets. the record won't.");
  });
  it("every line obeys the loading-copy invariants", () => {
    for (const line of IDLE_LINES) expect(obeysCopyInvariants(line)).toBe(true);
  });
});

describe("obeysCopyInvariants", () => {
  it("rejects an em dash", () => {
    expect(obeysCopyInvariants("a — b")).toBe(false);
  });
  it("rejects uppercase in static copy", () => {
    expect(obeysCopyInvariants("Made together")).toBe(false);
  });
  it("accepts clean lowercase copy", () => {
    expect(obeysCopyInvariants("made together. credited together.")).toBe(true);
  });
});

describe("round-trip phase labels", () => {
  it("register introduce + register", () => {
    expect(registerPhaseLabel("introduce", "Wave")).toBe(
      "declaring you as the maker…",
    );
    expect(registerPhaseLabel("register", "Wave")).toBe(
      'registering "Wave" in your catalog…',
    );
  });
  it("deliver with and without a recipient", () => {
    expect(deliverPhaseLabel("Wave", "alex@x.com")).toBe(
      'sending "Wave" to alex@x.com…',
    );
    expect(deliverPhaseLabel("Wave")).toBe('sending "Wave"…');
  });
  it("credits + writers", () => {
    expect(creditsPhaseLabel()).toBe("crediting who played what…");
    expect(writersPhaseLabel()).toBe("naming the writers…");
    expect(writersPhaseLabel("Wave")).toBe('naming the writers on "Wave"…');
  });
  it("all labels obey the invariants when fed lowercase data", () => {
    expect(obeysCopyInvariants(stemPhaseLabel("render", "x"))).toBe(true);
    expect(obeysCopyInvariants(stemPhaseLabel("upload", "x", 5))).toBe(true);
    expect(obeysCopyInvariants(stemPhaseLabel("queued", "x"))).toBe(true);
    expect(obeysCopyInvariants(registerPhaseLabel("introduce", "x"))).toBe(
      true,
    );
    expect(obeysCopyInvariants(registerPhaseLabel("register", "x"))).toBe(true);
    expect(obeysCopyInvariants(deliverPhaseLabel("x", "y"))).toBe(true);
    expect(obeysCopyInvariants(creditsPhaseLabel())).toBe(true);
    expect(obeysCopyInvariants(writersPhaseLabel("x"))).toBe(true);
  });
});
