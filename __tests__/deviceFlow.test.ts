// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import {
  startDeviceSignIn,
  pollDeviceToken,
  waitForApproval,
  type DeviceStart,
} from "../src/pica/deviceFlow";

const BASE = "https://withpica.com";
const KEY = "withpica_live_" + "c".repeat(64);

function reply(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
function seq(...responses: Response[]) {
  const f = vi.fn();
  responses.forEach((r) => f.mockResolvedValueOnce(r));
  return f as unknown as typeof fetch;
}

const START: DeviceStart = {
  deviceCode: "dev-code",
  userCode: "BCDF-GHJK",
  verificationUri: `${BASE}/connect/device`,
  verificationUriComplete: `${BASE}/connect/device?code=BCDF-GHJK`,
  expiresIn: 600,
  interval: 5,
};

describe("startDeviceSignIn", () => {
  it("returns the code and where to approve it", async () => {
    const f = seq(
      reply(200, {
        device_code: "dev-code",
        user_code: "BCDF-GHJK",
        verification_uri: `${BASE}/connect/device`,
        verification_uri_complete: `${BASE}/connect/device?code=BCDF-GHJK`,
        expires_in: 600,
        interval: 5,
      }),
    );
    expect(await startDeviceSignIn(BASE, f)).toEqual(START);
    expect(f).toHaveBeenCalledWith(`${BASE}/api/connect/device`, expect.objectContaining({ method: "POST" }));
  });

  it("is null on an older PICA without device sign-in, so the paste flow runs", async () => {
    expect(await startDeviceSignIn(BASE, seq(reply(404, {})))).toBeNull();
  });

  it("is null when the approve page is not on PICA", async () => {
    const f = seq(reply(200, { device_code: "d", user_code: "u", verification_uri: "https://evil.example/x" }));
    expect(await startDeviceSignIn(BASE, f)).toBeNull();
  });

  it("is null when PICA cannot be reached", async () => {
    const f = vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await startDeviceSignIn(BASE, f)).toBeNull();
  });
});

describe("pollDeviceToken", () => {
  it("maps the RFC 8628 answers", async () => {
    const cases: Array<[Response, string]> = [
      [reply(200, { api_key: KEY }), "approved"],
      [reply(400, { error: "authorization_pending" }), "pending"],
      [reply(400, { error: "slow_down" }), "slow_down"],
      [reply(400, { error: "access_denied" }), "denied"],
      [reply(400, { error: "expired_token" }), "expired"],
      [reply(400, { error: "invalid_grant" }), "invalid"],
      [reply(503, {}), "unreachable"],
    ];
    for (const [res, status] of cases) {
      expect((await pollDeviceToken(BASE, "d", seq(res))).status).toBe(status);
    }
  });
});

describe("waitForApproval", () => {
  const noSleep = vi.fn(async () => true);
  const signal = new AbortController().signal;

  it("waits through pending, then returns the key", async () => {
    const f = seq(
      reply(400, { error: "authorization_pending" }),
      reply(400, { error: "authorization_pending" }),
      reply(200, { api_key: KEY }),
    );
    expect(await waitForApproval(BASE, START, signal, f, noSleep)).toEqual({ kind: "key", apiKey: KEY });
  });

  it("slows down by 5 seconds when told to", async () => {
    const sleep = vi.fn(async (_ms: number, _s: AbortSignal) => true);
    const f = seq(reply(400, { error: "slow_down" }), reply(200, { api_key: KEY }));
    await waitForApproval(BASE, START, signal, f, sleep);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([5000, 10000]);
  });

  it("stops on denied and on expired", async () => {
    expect(await waitForApproval(BASE, START, signal, seq(reply(400, { error: "access_denied" })), noSleep)).toEqual({ kind: "denied" });
    expect(await waitForApproval(BASE, START, signal, seq(reply(400, { error: "expired_token" })), noSleep)).toEqual({ kind: "expired" });
  });

  it("stops when the person cancels", async () => {
    const cancelled = vi.fn(async () => false);
    expect(await waitForApproval(BASE, START, signal, seq(), cancelled)).toEqual({ kind: "cancelled" });
  });

  it("gives up after five unreachable polls in a row", async () => {
    const f = vi.fn(async () => reply(503, {})) as unknown as typeof fetch;
    expect(await waitForApproval(BASE, START, signal, f, noSleep)).toEqual({ kind: "failed" });
    expect(f).toHaveBeenCalledTimes(5);
  });

  it("ends as expired at the code's deadline without asking again", async () => {
    let t = 0;
    const clock = () => t;
    const sleep = vi.fn(async (ms: number) => { t += ms; return true; });
    const f = vi.fn(async () => reply(400, { error: "authorization_pending" })) as unknown as typeof fetch;
    expect(await waitForApproval(BASE, { ...START, expiresIn: 12 }, signal, f, sleep, clock)).toEqual({ kind: "expired" });
  });
});
