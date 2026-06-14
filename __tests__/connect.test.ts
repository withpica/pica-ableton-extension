import { describe, it, expect } from "vitest";
import { isKeyShaped, safeParse } from "../src/pica/connect";

describe("isKeyShaped", () => {
  it("accepts the real mint format", () => {
    expect(isKeyShaped("withpica_live_" + "a".repeat(64))).toBe(true);
  });
  it("rejects wrong prefix / length / case", () => {
    expect(isKeyShaped("withpica_test_" + "a".repeat(64))).toBe(false);
    expect(isKeyShaped("withpica_live_" + "a".repeat(10))).toBe(false);
    expect(isKeyShaped("withpica_live_" + "A".repeat(64))).toBe(false);
    expect(isKeyShaped("")).toBe(false);
  });
});

describe("safeParse", () => {
  it("returns {} on non-JSON and on non-object JSON", () => {
    expect(safeParse("not json")).toEqual({});
    expect(safeParse("42")).toEqual({});
  });
  it("parses an object", () => {
    expect(safeParse('{"apiKey":"x"}')).toEqual({ apiKey: "x" });
  });
});
