// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import {
  readCredentials,
  writeIdentity,
  type ConnectedIdentity,
} from "./keyStore";

/**
 * Who the stored key writes as (ADR-259).
 *
 * Resolved from `GET /api/admin/me`, which is the ONLY caller-identity read a
 * scoped connection key can make:
 *  - `pica_introduce_self` returns just the name the agent declared, not the
 *    account it is authenticated as.
 *  - `pica_organisation_profile` / `pica_user_profile` need the `admin` scope,
 *    and `pica_dashboard_briefing` needs `read:analytics`. The mint grants
 *    write:catalog + read:people + write:files, so none of them are callable.
 *  - `/api/admin/organisation/list` authenticates through the cookie-bound
 *    getUser() and 401s a Bearer caller outright.
 *
 * Never throws: a dialog that cannot name the destination must still open. It
 * says so instead, which is a weaker warning than a hidden one but never a
 * blocked write.
 */

type FetchFn = typeof fetch;

const ME_PATH = "/api/admin/me";

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Resolve the account + organisation a key belongs to, or null on any failure. */
export async function resolveIdentity(
  baseUrl: string,
  apiKey: string,
  fetchFn: FetchFn = fetch,
): Promise<ConnectedIdentity | null> {
  let payload: unknown;
  try {
    const res = await fetchFn(`${baseUrl}${ME_PATH}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    payload = await res.json();
  } catch {
    return null;
  }

  const data = (payload as { data?: unknown } | null)?.data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;

  const identity: ConnectedIdentity = {
    email: str(d.email),
    fullName: str(d.full_name),
    organisationId: str(d.organisation_id),
    organisationName: str(d.organisation_name),
    resolvedAt: new Date().toISOString(),
  };
  // A payload that names neither the org nor the account is no better than no
  // answer, and caching it would suppress the honest "unconfirmed" line.
  if (!identity.organisationName && !identity.organisationId && !identity.email)
    return null;
  return identity;
}

/**
 * The cached identity for the key on disk, resolving and caching it once if it
 * is missing (a key minted before identity caching, or after a re-key).
 */
export async function ensureIdentity(
  baseUrl: string,
  storageDir: string,
  apiKey: string,
  fetchFn: FetchFn = fetch,
): Promise<ConnectedIdentity | null> {
  const creds = await readCredentials(storageDir);
  if (creds?.apiKey === apiKey && creds.identity) return creds.identity;

  const resolved = await resolveIdentity(baseUrl, apiKey, fetchFn);
  if (!resolved) return null;
  // Best-effort cache: writeIdentity declines if the key changed under us, and
  // the resolved value is still correct to display for this run either way.
  await writeIdentity(storageDir, apiKey, resolved);
  return resolved;
}

/** "soundslikefez (hi@soundslikefez.com)", or the best available part. */
export function identityLabel(identity: ConnectedIdentity | null): string {
  if (!identity) return "unconfirmed account";
  const who = identity.email ?? identity.fullName;
  const org = identity.organisationName;
  if (org && who) return `${org} (${who})`;
  if (org) return org;
  if (who) return who;
  // An org we can only name by id is still worth showing: it distinguishes one
  // account from another even when it does not read as anything.
  if (identity.organisationId)
    return `organisation ${identity.organisationId.slice(0, 8)}`;
  return "unconfirmed account";
}

/** The one line every about-to-write dialog carries. */
export function destinationLine(identity: ConnectedIdentity | null): string {
  if (!identity)
    return "could not confirm which pica account this key writes into. check pica account before registering.";
  return `writing into ${identityLabel(identity)}`;
}
