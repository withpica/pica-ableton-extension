// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { promises as fs } from "node:fs";
import { join } from "node:path";

const FILE = "pica-credentials.json";

/** Read the stored PICA API key from the extension's storage directory, or null if absent/unreadable. */
export async function readApiKey(storageDir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(join(storageDir, FILE), "utf8");
    const parsed = JSON.parse(raw) as { apiKey?: unknown };
    return typeof parsed.apiKey === "string" && parsed.apiKey.length > 0 ? parsed.apiKey : null;
  } catch {
    return null;
  }
}

/** Persist the PICA API key to the extension's storage directory (mode 0600). Never written into the .als Set. */
export async function writeApiKey(storageDir: string, apiKey: string): Promise<void> {
  await fs.mkdir(storageDir, { recursive: true });
  await fs.writeFile(join(storageDir, FILE), JSON.stringify({ apiKey }, null, 2), { mode: 0o600 });
}
