// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withStory } from "../src/progress";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("withStory", () => {
  it("shows the steady label first, then rotates idle lines on the timer", async () => {
    const calls: string[] = [];
    const update = (t: string) => {
      calls.push(t);
      return Promise.resolve();
    };
    const d = deferred<string>();
    const p = withStory(
      update,
      new AbortController().signal,
      {
        steadyLabel: "steady",
        pct: 50,
        idleLines: ["a", "b"],
        intervalMs: 1000,
      },
      () => d.promise,
    );
    await Promise.resolve(); // flush the initial update
    expect(calls[0]).toBe("steady");
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toContain("b"); // tick 1 -> idleLines[1]
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toContain("a"); // tick 2 -> idleLines[0]
    d.resolve("done");
    await expect(p).resolves.toBe("done");
  });

  it("offsets the first rotated line by startTick", async () => {
    const calls: string[] = [];
    const update = (t: string) => {
      calls.push(t);
      return Promise.resolve();
    };
    const d = deferred<void>();
    const p = withStory(
      update,
      new AbortController().signal,
      {
        steadyLabel: "s",
        pct: 0,
        idleLines: ["a", "b", "c"],
        intervalMs: 100,
        startTick: 1,
      },
      () => d.promise,
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toContain("c"); // (startTick 1 + tick 1) -> idleLines[2]
    d.resolve();
    await p;
  });

  it("stops updating once work settles", async () => {
    const calls: string[] = [];
    const update = (t: string) => {
      calls.push(t);
      return Promise.resolve();
    };
    const d = deferred<string>();
    const p = withStory(
      update,
      new AbortController().signal,
      { steadyLabel: "s", pct: 0, idleLines: ["x"], intervalMs: 500 },
      () => d.promise,
    );
    await Promise.resolve();
    d.resolve("ok");
    await p;
    const countAfter = calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(calls.length).toBe(countAfter); // no updates after settle
  });

  it("does not throw if an update rejects", async () => {
    const update = () => Promise.reject(new Error("late"));
    const d = deferred<number>();
    const p = withStory(
      update,
      new AbortController().signal,
      { steadyLabel: "s", pct: 0, idleLines: ["x"], intervalMs: 100 },
      () => d.promise,
    );
    await vi.advanceTimersByTimeAsync(300);
    d.resolve(42);
    await expect(p).resolves.toBe(42);
  });

  it("does not rotate when the signal is already aborted", async () => {
    const calls: string[] = [];
    const update = (t: string) => {
      calls.push(t);
      return Promise.resolve();
    };
    const ac = new AbortController();
    ac.abort();
    const d = deferred<void>();
    const p = withStory(
      update,
      ac.signal,
      { steadyLabel: "s", pct: 0, idleLines: ["x"], intervalMs: 100 },
      () => d.promise,
    );
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(500);
    d.resolve();
    await p;
    expect(calls.filter((c) => c === "x")).toHaveLength(0);
  });
});
