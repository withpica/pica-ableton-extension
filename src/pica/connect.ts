// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import type { ExtensionContext } from "@ableton-extensions/sdk";
import { writeApiKey } from "./keyStore";
import { pasteKeyHtml } from "../dialogHtml";

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
