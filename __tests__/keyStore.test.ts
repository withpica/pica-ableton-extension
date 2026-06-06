import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApiKey, writeApiKey } from "../src/pica/keyStore";

let dir: string;
beforeEach(async () => {
  dir = join(tmpdir(), `pica-keystore-${process.pid}-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("keyStore", () => {
  it("returns null when no key file exists", async () => {
    expect(await readApiKey(dir)).toBeNull();
  });

  it("round-trips a written key", async () => {
    await writeApiKey(dir, "withpica_live_abc");
    expect(await readApiKey(dir)).toBe("withpica_live_abc");
  });

  it("returns null for a corrupt file", async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, "pica-credentials.json"), "not json");
    expect(await readApiKey(dir)).toBeNull();
  });
});
