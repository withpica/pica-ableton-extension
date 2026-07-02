// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.
import { describe, it, expect } from "vitest";
import { FLAT_STYLE, withFlatStyle, injectFlatStyle } from "../src/dialogStyles";

describe("FLAT_STYLE", () => {
  it("is a style block carrying the token vars and core + row classes", () => {
    expect(FLAT_STYLE).toContain("<style>");
    expect(FLAT_STYLE).toContain("--copper:#B87333");
    expect(FLAT_STYLE).toContain("#0A0A0A");
    for (const cls of [".h", ".hint", ".label", ".input", ".textarea", ".select", ".btn", ".btn-primary", ".divider", ".actions", ".row", ".kv", ".link",
      ".stem-row", ".credit-row", ".writer-row", ".instrument", ".who",
      ".caret", ".caret.leaf", ".remove", ".add"]) {
      expect(FLAT_STYLE).toContain(cls);
    }
    expect(FLAT_STYLE).not.toContain("border-radius");
  });
});
describe("withFlatStyle", () => {
  it("wraps body content in a doc that includes FLAT_STYLE once", () => {
    const out = withFlatStyle(`<div class="h">hi</div>`);
    expect(out).toContain("<!doctype html>");
    expect(out).toContain(FLAT_STYLE);
    expect(out).toContain(`<div class="h">hi</div>`);
    expect(out.match(/<style>/g)?.length).toBe(1);
  });
});
describe("injectFlatStyle", () => {
  it("splices FLAT_STYLE before </head>", () => {
    const out = injectFlatStyle("<html><head><title>x</title></head><body>y</body></html>");
    expect(out).toContain(`<title>x</title><style>`);
    expect(out.indexOf("<style>")).toBeLessThan(out.indexOf("</head>"));
  });
  it("throws when there is no </head>", () => {
    expect(() => injectFlatStyle("<html><body>y</body></html>")).toThrow();
  });
});
