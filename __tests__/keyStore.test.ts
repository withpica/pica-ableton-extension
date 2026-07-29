import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readApiKey,
  writeApiKey,
  readCredentials,
  writeIdentity,
  clearCredentials,
  keyPrefix,
  type ConnectedIdentity,
} from "../src/pica/keyStore";

let dir: string;
beforeEach(async () => {
  dir = join(tmpdir(), `pica-keystore-${process.pid}-${Math.random().toString(36).slice(2)}`);
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const FILE = "pica-credentials.json";
const KEY_A = "withpica_live_" + "a".repeat(64);
const KEY_B = "withpica_live_" + "b".repeat(64);

const IDENTITY: ConnectedIdentity = {
  email: "hi@soundslikefez.com",
  fullName: "Fez",
  organisationId: "c0c31e65-7749-4af4-a4f8-c4d3641204ae",
  organisationName: "soundslikefez",
  resolvedAt: "2026-07-29T10:00:00.000Z",
};

async function modeOf(path: string): Promise<string> {
  const st = await fs.stat(path);
  return (st.mode & 0o777).toString(8);
}

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
    await fs.writeFile(join(dir, FILE), "not json");
    expect(await readApiKey(dir)).toBeNull();
  });
});

describe("keyStore — stored identity", () => {
  it("round-trips a key with its identity", async () => {
    await writeApiKey(dir, KEY_A, IDENTITY);
    const creds = await readCredentials(dir);
    expect(creds?.apiKey).toBe(KEY_A);
    expect(creds?.identity).toEqual(IDENTITY);
  });

  it("reads a pre-identity file (key only) without complaint", async () => {
    // v0.9.0 and earlier wrote { apiKey }. Those installs must keep working and
    // simply resolve their identity on first use.
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, FILE), JSON.stringify({ apiKey: KEY_A }));
    const creds = await readCredentials(dir);
    expect(creds?.apiKey).toBe(KEY_A);
    expect(creds?.identity).toBeUndefined();
  });

  /**
   * The load-bearing invariant. A new key may belong to a different account, so
   * a cached identity must never survive a re-key: if it did, the account line
   * would name the previous org while writes went to the new one, which is
   * exactly the silent wrong-catalogue write this feature exists to prevent.
   */
  it("DROPS a cached identity when a new key is written without one", async () => {
    await writeApiKey(dir, KEY_A, IDENTITY);
    await writeApiKey(dir, KEY_B);
    const creds = await readCredentials(dir);
    expect(creds?.apiKey).toBe(KEY_B);
    expect(creds?.identity).toBeUndefined();
  });

  it("replaces a cached identity when a new key is written with one", async () => {
    await writeApiKey(dir, KEY_A, IDENTITY);
    await writeApiKey(dir, KEY_B, { ...IDENTITY, organisationName: "other org" });
    expect((await readCredentials(dir))?.identity?.organisationName).toBe("other org");
  });

  it("ignores a partial cached identity rather than showing half an answer", async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      join(dir, FILE),
      JSON.stringify({ apiKey: KEY_A, identity: { email: "x@y.com" } }),
    );
    // No resolvedAt → treated as absent, so the caller re-resolves.
    expect((await readCredentials(dir))?.identity).toBeUndefined();
  });

  it("treats a file with no key as no credentials", async () => {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(join(dir, FILE), JSON.stringify({ identity: IDENTITY }));
    expect(await readCredentials(dir)).toBeNull();
  });
});

describe("keyStore — writeIdentity", () => {
  it("attaches an identity to the key already on disk", async () => {
    await writeApiKey(dir, KEY_A);
    expect(await writeIdentity(dir, KEY_A, IDENTITY)).toBe(true);
    const creds = await readCredentials(dir);
    expect(creds?.apiKey).toBe(KEY_A);
    expect(creds?.identity).toEqual(IDENTITY);
  });

  it("declines when the stored key changed under it (lost race with a reconnect)", async () => {
    await writeApiKey(dir, KEY_B);
    expect(await writeIdentity(dir, KEY_A, IDENTITY)).toBe(false);
    // The new key must NOT end up labelled with the old key's account.
    expect((await readCredentials(dir))?.identity).toBeUndefined();
  });

  it("declines when there is nothing stored, and creates no file", async () => {
    expect(await writeIdentity(dir, KEY_A, IDENTITY)).toBe(false);
    await expect(fs.stat(join(dir, FILE))).rejects.toThrow();
  });
});

describe("keyStore — clearCredentials", () => {
  it("removes the credentials file", async () => {
    await writeApiKey(dir, KEY_A, IDENTITY);
    expect(await clearCredentials(dir)).toBe(true);
    expect(await readCredentials(dir)).toBeNull();
  });

  it("returns false when there was nothing to remove", async () => {
    expect(await clearCredentials(dir)).toBe(false);
  });

  /**
   * The founder's own credentials directory holds three hand-made backups
   * (.bak-20260620, .main.bak, .off), two of them 0644. They pre-date this code
   * and are his files: disconnect forgets our key, it does not tidy his
   * directory.
   */
  it("leaves hand-made sibling files alone", async () => {
    await writeApiKey(dir, KEY_A);
    const siblings = [`${FILE}.bak-20260620`, `${FILE}.main.bak`, `${FILE}.off`];
    for (const name of siblings) {
      await fs.writeFile(join(dir, name), JSON.stringify({ apiKey: KEY_B }));
    }

    await clearCredentials(dir);

    for (const name of siblings) {
      await expect(fs.stat(join(dir, name))).resolves.toBeTruthy();
    }
  });
});

describe("keyStore — file mode", () => {
  it("writes the key 0600", async () => {
    await writeApiKey(dir, KEY_A, IDENTITY);
    expect(await modeOf(join(dir, FILE))).toBe("600");
  });

  it("keeps 0600 when only the identity is updated", async () => {
    // A rewrite that widened the mode would hand the plaintext key to every
    // account on the machine, which is how two of the stale backups became
    // world-readable in the first place.
    await writeApiKey(dir, KEY_A);
    await writeIdentity(dir, KEY_A, IDENTITY);
    expect(await modeOf(join(dir, FILE))).toBe("600");
  });

  it("re-tightens the mode if the existing file was loosened", async () => {
    await writeApiKey(dir, KEY_A);
    await fs.chmod(join(dir, FILE), 0o644);
    await writeApiKey(dir, KEY_B);
    expect(await modeOf(join(dir, FILE))).toBe("600");
  });
});

describe("keyPrefix", () => {
  it("matches the key_prefix PICA stores and shows in /settings", () => {
    // app/api/admin/api-keys/route.ts: apiKey.substring(0, 20) + "..."
    expect(keyPrefix(KEY_A)).toBe(`${KEY_A.slice(0, 20)}...`);
    expect(keyPrefix(KEY_A)).toBe("withpica_live_aaaaaa...");
  });
});
