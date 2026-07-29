// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { promises as fs } from "node:fs";
import { join } from "node:path";

const FILE = "pica-credentials.json";

/**
 * The account + organisation a stored key writes into, cached beside the key.
 *
 * Cached rather than resolved per dialog for two reasons: every dialog that is
 * about to write needs to name its destination, and a round-trip per dialog
 * open would make the panel feel slow (and would fail closed offline, hiding
 * the destination exactly when the user most needs to see it). Re-resolved
 * whenever a key is minted, because a new key may belong to another account.
 */
export interface ConnectedIdentity {
  /** The auth email of the user the key was minted by. */
  email: string | null;
  /** That user's profile name, when they have one. */
  fullName: string | null;
  organisationId: string | null;
  /** The organisation's display name — the catalogue writes land in. */
  organisationName: string | null;
  /** ISO timestamp of the resolve that produced this. */
  resolvedAt: string;
}

export interface StoredCredentials {
  apiKey: string;
  /** Absent on files written before identity caching, and after a re-key. */
  identity?: ConnectedIdentity;
}

function coerceString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Accept a cached identity only if it carries the resolve timestamp; a partial
 *  blob is treated as absent so the caller re-resolves rather than displaying
 *  half an answer. */
function parseIdentity(v: unknown): ConnectedIdentity | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const resolvedAt = coerceString(o.resolvedAt);
  if (!resolvedAt) return undefined;
  return {
    email: coerceString(o.email),
    fullName: coerceString(o.fullName),
    organisationId: coerceString(o.organisationId),
    organisationName: coerceString(o.organisationName),
    resolvedAt,
  };
}

/** Read the stored credentials, or null if absent/unreadable/keyless. */
export async function readCredentials(
  storageDir: string,
): Promise<StoredCredentials | null> {
  try {
    const raw = await fs.readFile(join(storageDir, FILE), "utf8");
    const parsed = JSON.parse(raw) as { apiKey?: unknown; identity?: unknown };
    const apiKey = coerceString(parsed.apiKey);
    if (!apiKey) return null;
    return { apiKey, identity: parseIdentity(parsed.identity) };
  } catch {
    return null;
  }
}

/** Read the stored PICA API key from the extension's storage directory, or null if absent/unreadable. */
export async function readApiKey(storageDir: string): Promise<string | null> {
  const creds = await readCredentials(storageDir);
  return creds?.apiKey ?? null;
}

/**
 * Persist the PICA API key to the extension's storage directory (mode 0600).
 * Never written into the .als Set.
 *
 * Any previously cached identity is dropped unless a fresh one is supplied —
 * a new key may belong to a different account, and a stale identity line would
 * name the wrong catalogue, which is the exact failure this cache exists to
 * prevent.
 */
export async function writeApiKey(
  storageDir: string,
  apiKey: string,
  identity?: ConnectedIdentity,
): Promise<void> {
  await writeCredentials(storageDir, { apiKey, identity });
}

/** Persist the whole credential record (mode 0600). */
export async function writeCredentials(
  storageDir: string,
  creds: StoredCredentials,
): Promise<void> {
  await fs.mkdir(storageDir, { recursive: true });
  const body: StoredCredentials = creds.identity
    ? { apiKey: creds.apiKey, identity: creds.identity }
    : { apiKey: creds.apiKey };
  const path = join(storageDir, FILE);
  await fs.writeFile(path, JSON.stringify(body, null, 2), { mode: 0o600 });
  // `mode` on writeFile applies only when the file is CREATED, so a file that
  // has been loosened once stays loose through every later write. That is not
  // hypothetical: two of the hand-made backups in the real credentials
  // directory are 0644, because a manual `mv` does not preserve the mode. Chmod
  // unconditionally so the permission is a property of this function rather
  // than of the file's history.
  await fs.chmod(path, 0o600);
}

/**
 * Cache a resolved identity against the key already on disk.
 *
 * No-ops when there is no stored key (nothing to attribute the identity to)
 * and when the key has changed under us, so a resolve that lost a race with a
 * reconnect can never label the new key with the old account.
 */
export async function writeIdentity(
  storageDir: string,
  apiKey: string,
  identity: ConnectedIdentity,
): Promise<boolean> {
  const existing = await readCredentials(storageDir);
  if (!existing || existing.apiKey !== apiKey) return false;
  await writeCredentials(storageDir, { apiKey, identity });
  return true;
}

/**
 * Delete the stored credentials. Returns true when a file was removed, false
 * when there was nothing stored.
 *
 * Touches only `pica-credentials.json` — hand-made siblings in the same
 * directory (`.bak`, `.off`) are the user's files, not ours to remove.
 *
 * NOTE: this unlinks the local key. It does not revoke it at PICA — the key
 * stays valid until revoked in /settings. See
 * docs/follow-ups/2026-07-29-adr259-self-revoke-endpoint.md.
 */
export async function clearCredentials(storageDir: string): Promise<boolean> {
  try {
    await fs.unlink(join(storageDir, FILE));
    return true;
  } catch {
    return false;
  }
}

/**
 * The key's display prefix, byte-identical to `api_keys.key_prefix` as minted
 * by PICA (`app/api/admin/api-keys/route.ts`: first 20 chars + "..."), so the
 * string shown in Live can be matched against the key list in /settings —
 * which is how a user identifies the right key to revoke.
 */
export function keyPrefix(apiKey: string): string {
  return `${apiKey.slice(0, 20)}...`;
}
