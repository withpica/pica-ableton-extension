// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import type { ExtensionContext } from "@ableton-extensions/sdk";
import { writeApiKey, clearCredentials } from "./keyStore";
import { resolveIdentity, destinationLine } from "./identity";
import { openInBrowser } from "./openBrowser";
import { pasteKeyHtml, confirmKeyAccountHtml } from "../dialogHtml";
import { PicaMcpError } from "./mcpClient";

type FetchFn = typeof fetch;
type OpenFn = (url: string) => Promise<boolean>;

const BASE_URL = "https://withpica.com";
/** Where a key is made from a browser: sign in, check the account, authorize. */
export const CONNECT_URL = `${BASE_URL}/connect/ableton`;
const CONFIRM_W = 420;
const CONFIRM_H = 300;
/** Opens of the browser per paste session, so a stuck loop cannot spin. */
const MAX_PASTE_ROUNDS = 6;
const CONNECT_W = 420;
const CONNECT_H = 560;
const PASTE_W = 440;
const PASTE_H = 420;

/** Mint format: withpica_live_ + 64 lowercase hex (route.ts:133-134). */
export function isKeyShaped(k: string): boolean {
  return /^withpica_live_[0-9a-f]{64}$/.test(k);
}

/** Parse a dialog result string to an object, or {} on any failure. */
export function safeParse(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Persist a freshly minted key together with the account it belongs to.
 *
 * The identity resolve happens HERE, at mint time, for two reasons: it is the
 * only moment we know the key is new (so a cached identity from the previous
 * account can never survive a switch), and it keeps the per-dialog path free of
 * a network round-trip. Best-effort: an unresolvable identity stores the key
 * alone, and the dialogs say the account is unconfirmed rather than refusing.
 */
async function persistKey(
  storageDir: string,
  apiKey: string,
  fetchFn: FetchFn,
): Promise<void> {
  const identity = await resolveIdentity(BASE_URL, apiKey, fetchFn);
  await writeApiKey(storageDir, apiKey, identity ?? undefined);
}

/**
 * Open the paste-key dialog until a key is saved or the user backs out.
 *
 * "open in browser" opens the connect page in the system browser and brings
 * the dialog back. A shaped key is NOT saved until the user has seen which
 * account and catalogue it writes into and said connect: a pasted key can come
 * from any browser session (founder, 2026-10-30). "not me" returns to the
 * paste dialog. Persists and returns the key, else null.
 */
async function promptAndStorePastedKey(
  context: ExtensionContext<"1.0.0">,
  storageDir: string,
  fetchFn: FetchFn,
  openFn: OpenFn,
): Promise<string | null> {
  for (let round = 0; round < MAX_PASTE_ROUNDS; round++) {
    const raw = await context.ui.showModalDialog(
      `data:text/html,${encodeURIComponent(pasteKeyHtml(CONNECT_URL))}`,
      PASTE_W,
      PASTE_H,
    );
    const parsed = safeParse(raw);
    if (parsed.openBrowser === true) {
      await openFn(CONNECT_URL);
      continue;
    }
    const key = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
    if (!isKeyShaped(key)) return null;
    const identity = await resolveIdentity(BASE_URL, key, fetchFn);
    const answer = await context.ui.showModalDialog(
      `data:text/html,${encodeURIComponent(confirmKeyAccountHtml(destinationLine(identity)))}`,
      CONFIRM_W,
      CONFIRM_H,
    );
    if (answer === "connect") {
      await writeApiKey(storageDir, key, identity ?? undefined);
      return key;
    }
    if (answer !== "another") return null;
  }
  return null;
}

/**
 * Run the Connect flow: open /connect/ableton in the host webview, collect the
 * key by bridge (Mode A) or, on an explicit "open in browser", by paste (Mode C).
 * Persists and returns the key, or null if the user backed out.
 */
export async function connectAndStoreKey(
  context: ExtensionContext<"1.0.0">,
  storageDir: string,
  fetchFn: FetchFn = fetch,
  openFn: OpenFn = openInBrowser,
): Promise<string | null> {
  const raw = await context.ui.showModalDialog(
    `${BASE_URL}/connect/ableton?host=ableton`,
    CONNECT_W,
    CONNECT_H,
  );
  const parsed = safeParse(raw);

  if (typeof parsed.apiKey === "string" && isKeyShaped(parsed.apiKey)) {
    await persistKey(storageDir, parsed.apiKey, fetchFn); // Mode A
    return parsed.apiKey;
  }
  // "open in browser" (connect page, signed out) opens the system browser on
  // the connect page, then the paste field; "paste a key" / "open in browser
  // instead" go straight to the paste field. A plain cancel / window-close /
  // unparseable result aborts quietly.
  if (parsed.openBrowser === true) {
    await openFn(CONNECT_URL);
    return promptAndStorePastedKey(context, storageDir, fetchFn, openFn);
  }
  if (parsed.useBrowser === true) {
    return promptAndStorePastedKey(context, storageDir, fetchFn, openFn);
  }
  return null;
}

/**
 * Forget the stored key.
 *
 * Local only: this unlinks the credentials file, it does NOT revoke the key at
 * PICA, which stays valid until revoked in /settings. No revocation surface is
 * reachable with this key's scopes — DELETE /api/admin/api-keys requires the
 * `admin` scope AND the key's row id, neither of which a connection key has.
 * The account dialog therefore says so and shows the key prefix to revoke by.
 * Scoped in docs/follow-ups/2026-07-29-adr259-self-revoke-endpoint.md.
 */
export async function disconnect(storageDir: string): Promise<boolean> {
  return clearCredentials(storageDir);
}

/**
 * Run `make(key)`; on a 401 or INSUFFICIENT_SCOPE PicaMcpError, run Connect
 * once for a fresh key and retry exactly once. A declined reconnect or any
 * other error propagates.
 */
export async function withReconnect<T>(
  context: ExtensionContext<"1.0.0">,
  storageDir: string,
  make: (key: string) => Promise<T>,
  key: string,
  onReconnect?: (freshKey: string) => void,
  // Carried through to the reconnect's identity resolve so the injection seam
  // reaches every path that can mint a key. Without it this function would be
  // the one route to connectAndStoreKey that could only be tested by stubbing
  // a global, i.e. by remembering to.
  fetchFn: FetchFn = fetch,
): Promise<T> {
  try {
    return await make(key);
  } catch (e) {
    // Reconnect-and-retry on two recoverable credential failures:
    //  - "401": the bearer is invalid/expired (PicaMcpError.code is the
    //    stringified HTTP status — mcpClient.ts).
    //  - "INSUFFICIENT_SCOPE": the key is VALID but under-scoped for this tool
    //    (e.g. an old write:catalog-only key hitting pica_audio_presigned_upload,
    //    which needs write:files). The mint now grants the full feature scope
    //    set, so re-minting fixes it — without this, an under-scoped key
    //    dead-ends with no way to refresh from inside the extension.
    if (
      e instanceof PicaMcpError &&
      (e.code === "401" || e.code === "INSUFFICIENT_SCOPE")
    ) {
      const fresh = await connectAndStoreKey(context, storageDir, fetchFn);
      if (!fresh) throw e;
      // Let the caller carry the fresh key into subsequent calls in this run.
      onReconnect?.(fresh);
      return make(fresh);
    }
    throw e;
  }
}
