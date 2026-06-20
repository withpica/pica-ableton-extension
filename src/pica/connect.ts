// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import type { ExtensionContext } from "@ableton-extensions/sdk";
import { writeApiKey } from "./keyStore";
import { pasteKeyHtml } from "../dialogHtml";
import { PicaMcpError } from "./mcpClient";

const BASE_URL = "https://withpica.com";
const CONNECT_W = 420;
const CONNECT_H = 560;
const PASTE_W = 400;
const PASTE_H = 300;

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

/** Open the paste-key dialog; persist + return a shaped key, else null. */
async function promptAndStorePastedKey(
  context: ExtensionContext<"1.0.0">,
  storageDir: string,
): Promise<string | null> {
  const raw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(pasteKeyHtml())}`,
    PASTE_W,
    PASTE_H,
  );
  const parsed = safeParse(raw);
  const key = typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "";
  if (!isKeyShaped(key)) return null;
  await writeApiKey(storageDir, key);
  return key;
}

/**
 * Run the Connect flow: open /connect/ableton in the host webview, collect the
 * key by bridge (Mode A) or, on an explicit "open in browser", by paste (Mode C).
 * Persists and returns the key, or null if the user backed out.
 */
export async function connectAndStoreKey(
  context: ExtensionContext<"1.0.0">,
  storageDir: string,
): Promise<string | null> {
  const raw = await context.ui.showModalDialog(
    `${BASE_URL}/connect/ableton?host=ableton`,
    CONNECT_W,
    CONNECT_H,
  );
  const parsed = safeParse(raw);

  if (typeof parsed.apiKey === "string" && isKeyShaped(parsed.apiKey)) {
    await writeApiKey(storageDir, parsed.apiKey); // Mode A
    return parsed.apiKey;
  }
  // Only an explicit "open in browser instead" opens the paste field. A plain
  // cancel / window-close / unparseable result aborts quietly.
  if (parsed.useBrowser === true) {
    return promptAndStorePastedKey(context, storageDir);
  }
  return null;
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
      const fresh = await connectAndStoreKey(context, storageDir);
      if (!fresh) throw e;
      // Let the caller carry the fresh key into subsequent calls in this run.
      onReconnect?.(fresh);
      return make(fresh);
    }
    throw e;
  }
}
