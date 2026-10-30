// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

/**
 * Sign in without a key to copy (ADR-259 amendment, device sign-in; founder
 * 2026-10-30: "like a TV app").
 *
 * Live asks PICA for a short code, shows it, and opens withpica.com where the
 * signed-in person approves it; the extension polls until PICA hands over a
 * key, exactly once. The shape is RFC 8628's device authorization grant.
 * Pure transport here: the dialogs live in connect.ts.
 */

type FetchFn = typeof fetch;

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export type PollResult =
  | { status: "approved"; apiKey: string }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "invalid" }
  | { status: "unreachable" };

/** Ask PICA for a code. Null when the server has no device sign-in (older
 *  PICA) or cannot be reached, so the caller falls back to pasting a key. */
export async function startDeviceSignIn(
  baseUrl: string,
  fetchFn: FetchFn,
): Promise<DeviceStart | null> {
  try {
    const res = await fetchFn(`${baseUrl}/api/connect/device`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client: "ableton" }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const s = (k: string) => (typeof j[k] === "string" ? (j[k] as string) : "");
    const n = (k: string, d: number) =>
      typeof j[k] === "number" && Number.isFinite(j[k]) ? (j[k] as number) : d;
    const start: DeviceStart = {
      deviceCode: s("device_code"),
      userCode: s("user_code"),
      verificationUri: s("verification_uri"),
      verificationUriComplete: s("verification_uri_complete") || s("verification_uri"),
      expiresIn: n("expires_in", 600),
      interval: Math.max(1, n("interval", 5)),
    };
    if (!start.deviceCode || !start.userCode || !start.verificationUri.startsWith(baseUrl)) {
      return null;
    }
    return start;
  } catch {
    return null;
  }
}

/** One poll of the token endpoint, mapped to what the extension does next. */
export async function pollDeviceToken(
  baseUrl: string,
  deviceCode: string,
  fetchFn: FetchFn,
): Promise<PollResult> {
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/api/connect/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });
  } catch {
    return { status: "unreachable" };
  }
  let j: Record<string, unknown> = {};
  try {
    j = (await res.json()) as Record<string, unknown>;
  } catch {
    return { status: "unreachable" };
  }
  if (res.ok && typeof j.api_key === "string" && j.api_key) {
    return { status: "approved", apiKey: j.api_key };
  }
  switch (j.error) {
    case "authorization_pending":
      return { status: "pending" };
    case "slow_down":
      return { status: "slow_down" };
    case "access_denied":
      return { status: "denied" };
    case "expired_token":
      return { status: "expired" };
    case "invalid_grant":
      return { status: "invalid" };
    default:
      return res.status >= 500 ? { status: "unreachable" } : { status: "invalid" };
  }
}

/** Sleep that ends early, resolving false, when the signal aborts. */
export function waitOrAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export type WaitOutcome =
  | { kind: "key"; apiKey: string }
  | { kind: "denied" }
  | { kind: "expired" }
  | { kind: "cancelled" }
  | { kind: "failed" };

/**
 * Poll until the code is approved, denied or expired, or the user cancels.
 * Honours the server's interval and RFC 8628 slow_down (+5 s each time); a
 * few unreachable polls in a row give up rather than spin.
 */
export async function waitForApproval(
  baseUrl: string,
  start: DeviceStart,
  signal: AbortSignal,
  fetchFn: FetchFn,
  sleep: (ms: number, signal: AbortSignal) => Promise<boolean> = waitOrAbort,
  now: () => number = Date.now,
): Promise<WaitOutcome> {
  let interval = start.interval;
  const deadline = now() + start.expiresIn * 1000;
  let unreachable = 0;
  while (now() < deadline) {
    if (!(await sleep(interval * 1000, signal))) return { kind: "cancelled" };
    const r = await pollDeviceToken(baseUrl, start.deviceCode, fetchFn);
    if (r.status === "approved") return { kind: "key", apiKey: r.apiKey };
    if (r.status === "denied") return { kind: "denied" };
    if (r.status === "expired") return { kind: "expired" };
    if (r.status === "invalid") return { kind: "failed" };
    if (r.status === "slow_down") interval += 5;
    if (r.status === "unreachable") {
      if (++unreachable >= 5) return { kind: "failed" };
    } else {
      unreachable = 0;
    }
  }
  return { kind: "expired" };
}
