import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveIdentity,
  ensureIdentity,
  identityLabel,
  destinationLine,
} from "../src/pica/identity";
import { writeApiKey, readCredentials } from "../src/pica/keyStore";

const BASE = "https://withpica.com";
const KEY = "withpica_live_" + "a".repeat(64);

const ME = {
  success: true,
  data: {
    full_name: "Fez",
    email: "hi@soundslikefez.com",
    organisation_id: "c0c31e65-7749-4af4-a4f8-c4d3641204ae",
    organisation_name: "soundslikefez",
  },
};

function fakeFetch(response: { ok: boolean; payload?: unknown }) {
  return vi.fn(async () => ({
    ok: response.ok,
    json: async () => response.payload,
  })) as unknown as typeof fetch;
}

describe("resolveIdentity", () => {
  it("reads the account and org from /api/admin/me", async () => {
    const f = fakeFetch({ ok: true, payload: ME });
    const out = await resolveIdentity(BASE, KEY, f);
    expect(out).toMatchObject({
      email: "hi@soundslikefez.com",
      fullName: "Fez",
      organisationName: "soundslikefez",
      organisationId: "c0c31e65-7749-4af4-a4f8-c4d3641204ae",
    });
    expect(out?.resolvedAt).toBeTruthy();
    expect(f).toHaveBeenCalledWith(
      `${BASE}/api/admin/me`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${KEY}` }),
      }),
    );
  });

  it("returns null on a refusal rather than throwing", async () => {
    // A dialog that cannot name the destination must still open.
    expect(await resolveIdentity(BASE, KEY, fakeFetch({ ok: false }))).toBeNull();
  });

  it("returns null when the request throws (offline)", async () => {
    const f = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    expect(await resolveIdentity(BASE, KEY, f)).toBeNull();
  });

  it("returns null on a payload with no data envelope", async () => {
    expect(
      await resolveIdentity(BASE, KEY, fakeFetch({ ok: true, payload: {} })),
    ).toBeNull();
  });

  it("returns null when the payload names neither org nor account", async () => {
    // Caching an empty answer would suppress the honest "unconfirmed" line.
    const out = await resolveIdentity(
      BASE,
      KEY,
      fakeFetch({
        ok: true,
        payload: { data: { full_name: null, email: null } },
      }),
    );
    expect(out).toBeNull();
  });

  it("keeps a partial identity when only the org is known", async () => {
    const out = await resolveIdentity(
      BASE,
      KEY,
      fakeFetch({
        ok: true,
        payload: { data: { organisation_name: "soundslikefez" } },
      }),
    );
    expect(out).toMatchObject({ organisationName: "soundslikefez", email: null });
  });
});

describe("ensureIdentity", () => {
  let dir: string;
  beforeEach(() => {
    dir = join(
      tmpdir(),
      `pica-identity-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
  });
  afterEach(() => fs.rm(dir, { recursive: true, force: true }));

  it("resolves and caches when the stored key has no identity", async () => {
    await writeApiKey(dir, KEY);
    const f = fakeFetch({ ok: true, payload: ME });

    const out = await ensureIdentity(BASE, dir, KEY, f);

    expect(out?.organisationName).toBe("soundslikefez");
    const stored = await readCredentials(dir);
    expect(stored?.identity?.organisationName).toBe("soundslikefez");
  });

  it("uses the cache on the second call, with no further request", async () => {
    await writeApiKey(dir, KEY);
    const f = fakeFetch({ ok: true, payload: ME });
    await ensureIdentity(BASE, dir, KEY, f);
    await ensureIdentity(BASE, dir, KEY, f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("re-resolves when the stored key is NOT the key being asked about", async () => {
    // The cached identity describes the OLD key. Reusing it would name the
    // wrong catalogue, which is the whole failure being prevented.
    await writeApiKey(dir, "withpica_live_" + "b".repeat(64), {
      email: "old@example.com",
      fullName: "Old",
      organisationId: "old-org",
      organisationName: "old org",
      resolvedAt: "2026-01-01T00:00:00.000Z",
    });
    const f = fakeFetch({ ok: true, payload: ME });

    const out = await ensureIdentity(BASE, dir, KEY, f);

    expect(f).toHaveBeenCalledTimes(1);
    expect(out?.organisationName).toBe("soundslikefez");
  });

  it("returns null without caching when the resolve fails", async () => {
    await writeApiKey(dir, KEY);
    expect(
      await ensureIdentity(BASE, dir, KEY, fakeFetch({ ok: false })),
    ).toBeNull();
    expect((await readCredentials(dir))?.identity).toBeUndefined();
  });
});

describe("identityLabel / destinationLine", () => {
  const base = {
    email: "hi@soundslikefez.com",
    fullName: "Fez",
    organisationId: "c0c31e65-7749-4af4-a4f8-c4d3641204ae",
    organisationName: "soundslikefez",
    resolvedAt: "2026-07-29T00:00:00.000Z",
  };

  it("names the org and the account", () => {
    expect(identityLabel(base)).toBe("soundslikefez (hi@soundslikefez.com)");
    expect(destinationLine(base)).toBe(
      "writing into soundslikefez (hi@soundslikefez.com)",
    );
  });

  it("falls back through org, account, then org id", () => {
    expect(identityLabel({ ...base, email: null, fullName: null })).toBe(
      "soundslikefez",
    );
    expect(identityLabel({ ...base, organisationName: null })).toBe(
      "hi@soundslikefez.com",
    );
    expect(
      identityLabel({
        ...base,
        organisationName: null,
        email: null,
        fullName: null,
      }),
    ).toBe("organisation c0c31e65");
  });

  it("uses the full name when there is no email", () => {
    expect(identityLabel({ ...base, organisationName: null, email: null })).toBe(
      "Fez",
    );
  });

  it("says so plainly when the account is unknown", () => {
    expect(identityLabel(null)).toBe("unconfirmed account");
    expect(destinationLine(null)).toContain("could not confirm");
    // It must point at the remedy, not just state the problem.
    expect(destinationLine(null)).toContain("pica account");
  });
});
