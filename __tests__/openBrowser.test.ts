// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { openInBrowser } from "../src/pica/openBrowser";

function fakeSpawn(outcome: "spawn" | "error") {
  return vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    setTimeout(() => child.emit(outcome, new Error("nope")), 0);
    return child;
  }) as unknown as typeof import("node:child_process").spawn;
}

const URL = "https://withpica.com/connect/ableton";

describe("openInBrowser", () => {
  it("uses `open` on macOS", async () => {
    const spawn = fakeSpawn("spawn");
    expect(await openInBrowser(URL, "darwin", spawn)).toBe(true);
    expect(spawn).toHaveBeenCalledWith("open", [URL], expect.objectContaining({ detached: true }));
  });

  it("uses `start` through cmd on Windows", async () => {
    const spawn = fakeSpawn("spawn");
    expect(await openInBrowser(URL, "win32", spawn)).toBe(true);
    expect(spawn).toHaveBeenCalledWith("cmd", ["/c", "start", '""', URL], expect.anything());
  });

  it("resolves false when the command cannot start", async () => {
    expect(await openInBrowser(URL, "darwin", fakeSpawn("error"))).toBe(false);
  });

  it("opens only https URLs", async () => {
    const spawn = fakeSpawn("spawn");
    expect(await openInBrowser("file:///etc/passwd", "darwin", spawn)).toBe(false);
    expect(await openInBrowser('https://x.com/" & calc', "win32", spawn)).toBe(false);
    expect(await openInBrowser("https://x.com/a&calc", "win32", spawn)).toBe(false);
    expect(await openInBrowser("https://x.com/%PATH%", "win32", spawn)).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
});
