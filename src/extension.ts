// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { initialize, type ActivationContext, type ExtensionContext } from "@ableton-extensions/sdk";
import interfaceHtml from "../ui/interface.html";
import creditsHtml from "../ui/credits.html";
import { PicaMcpClient } from "./pica/mcpClient";
import { readApiKey } from "./pica/keyStore";
import { readSong, type SongLike } from "./session/read";
import { buildMetadata, buildSummary } from "./session/snapshot";
import { deriveParts } from "./session/parts";
import {
  ensureIntroduced,
  registerSet,
  findExistingRegistration,
  DuplicateWorkError,
} from "./pica/register";
import {
  buildPrefillRows,
  loadExistingCredits,
  saveCredits,
  type CreditOutcome,
  type CreditRow,
  type ExistingCredit,
} from "./pica/credits";
import { messageHtml, linkMessageHtml, successBody } from "./dialogHtml";

const BASE_URL = "https://withpica.com";
const PANEL_W = 380;
const PANEL_H = 460;

export function activate(activation: ActivationContext): void {
  // Capture the host API version from the ActivationContext before initialize consumes it.
  const hostApiVersion: string = activation.hostApiVersion;

  const context = initialize(activation, "1.0.0");
  const COMMAND_ID = "pica.registerSet";

  context.commands.registerCommand(COMMAND_ID, () => {
    // Fire and forget; all surfaced state goes through dialogs.
    void runRegister(context, hostApiVersion).catch((e) => {
      void showError(context, e instanceof Error ? e.message : String(e));
    });
  });

  // No global scope exists — offer the action by right-clicking a track.
  void context.ui.registerContextMenuAction("AudioTrack", "Register Set in PICA", COMMAND_ID);
  void context.ui.registerContextMenuAction("MidiTrack", "Register Set in PICA", COMMAND_ID);
}

async function runRegister(context: ExtensionContext<"1.0.0">, hostApiVersion: string): Promise<void> {
  const storageDir = context.environment.storageDirectory;
  if (!storageDir) {
    await showError(context, "No storage directory available — cannot read the PICA key.");
    return;
  }
  const apiKey = await readApiKey(storageDir);
  if (!apiKey) {
    await showError(
      context,
      "No PICA key found. Create a write:catalog key in PICA → settings → connection, then save it to:\n" +
        storageDir + "/pica-credentials.json  →  { \"apiKey\": \"...\" }",
    );
    return;
  }

  // 1. Read the whole Set (independent of the right-clicked track).
  const snapshot = readSong(context.application.song as unknown as SongLike);
  const summary = buildSummary(snapshot);
  const metadata = buildMetadata(snapshot);
  const derivedKey = String(metadata["key"] ?? "");

  // 2. Confirm-and-edit panel. Title + artist are user-entered (the Set has neither).
  const prefillJson = JSON.stringify({ summary, key: derivedKey, workType: "song" }).replace(/</g, "\\u003c");
  const injected = interfaceHtml.replace(
    "</head>",
    `<script>window.__PICA_PREFILL__ = ${prefillJson};</script></head>`,
  );
  const url = `data:text/html,${encodeURIComponent(injected)}`;
  const raw = await context.ui.showModalDialog(url, PANEL_W, PANEL_H);

  let answer: { cancelled?: boolean; title?: string; artistName?: string; workType?: string; key?: string };
  try {
    answer = JSON.parse(raw);
  } catch {
    return; // dialog dismissed without a valid payload
  }
  if (answer.cancelled || !answer.title || !answer.artistName) return;

  // 3. Register (declare identity → dup-check → create), with a cancellable progress dialog.
  const client = new PicaMcpClient({ baseUrl: BASE_URL, apiKey });
  const liveVersion = hostApiVersion ? `(api ${hostApiVersion})` : "";

  const result = await context.ui.withinProgressDialog(
    "Registering in PICA…",
    { progress: 10 },
    async (update) => {
      await update("Declaring agent identity…", 25);
      await ensureIntroduced(client, liveVersion);
      await update("Registering work + master recording…", 65);
      return registerSet(client, {
        title: answer.title!,
        artistName: answer.artistName!,
        workType: answer.workType || "song",
        key: answer.key || derivedKey,
        metadata,
        summary,
      });
    },
  ).catch(async (e: unknown) => {
    if (e instanceof DuplicateWorkError) {
      // Re-run on an already-registered Set: open the checklist prefilled
      // from the credits already saved on the master recording.
      const workUrl = `${BASE_URL}/inspect/works/${e.existingWorkId}`;
      try {
        const found = await findExistingRegistration(client, answer.title!);
        if (found?.recordingId) {
          const existing = await loadExistingCredits(client, found.recordingId);
          const parts = deriveParts(snapshot);
          await runCreditsFlow(
            context,
            client,
            found.recordingId,
            buildPrefillRows(parts, existing),
            existing,
          );
          return undefined;
        }
      } catch {
        // fall through to the plain already-registered dialog
      }
      await showLink(
        context,
        "pica — already registered",
        "a work with this title already exists in your catalog.",
        workUrl,
      );
      return undefined;
    }
    throw e;
  });

  if (!result || typeof result !== "object" || !("inspectUrl" in result)) return;

  const r = result as { workId: string; recordingId: string; completenessScore?: number; inspectUrl: string };
  await showLink(context, "pica — registered", successBody(r.completenessScore), r.inspectUrl);

  // Stage 2: offer the attribution checklist right after register (skippable).
  // Best-effort: the registration already succeeded — a checklist failure must
  // not surface as an error dialog on top of the success dialog.
  if (r.recordingId) {
    const parts = deriveParts(snapshot);
    await runCreditsFlow(
      context,
      client,
      r.recordingId,
      buildPrefillRows(parts, []),
      [],
    ).catch(() => undefined);
  }
}

const CREDITS_W = 430;
const CREDITS_H = 520;

function formatOutcomes(outcomes: CreditOutcome[]): string {
  if (outcomes.length === 0) return "no rows had a performer name — nothing saved.";
  const lines = outcomes.map((o) => {
    switch (o.status) {
      case "saved_linked":
        return `✓ ${o.creditedName} — ${o.instrument} (linked to existing person)`;
      case "saved_draft":
        return `✓ ${o.creditedName} — ${o.instrument} (draft — no matching person yet)`;
      case "skipped_existing":
        return `· ${o.creditedName} — already credited, left unchanged`;
      case "failed":
        return `✗ ${o.creditedName} — FAILED: ${o.error ?? "unknown error"}`;
    }
  });
  return lines.join("\n");
}

/** The Stage-2 checklist: parts → panel → per-row credit writes → outcome report. */
async function runCreditsFlow(
  context: ExtensionContext<"1.0.0">,
  client: PicaMcpClient,
  recordingId: string,
  prefillRows: CreditRow[],
  existing: ExistingCredit[],
): Promise<void> {
  const prefillJson = JSON.stringify({ rows: prefillRows }).replace(/</g, "\\u003c");
  const injected = creditsHtml.replace(
    "</head>",
    `<script>window.__PICA_PREFILL__ = ${prefillJson};</script></head>`,
  );
  const raw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(injected)}`,
    CREDITS_W,
    CREDITS_H,
  );

  let answer: { cancelled?: boolean; rows?: CreditRow[] };
  try {
    answer = JSON.parse(raw);
  } catch {
    return; // dialog dismissed
  }
  if (answer.cancelled || !Array.isArray(answer.rows)) return; // skip writes nothing

  const outcomes = (await context.ui.withinProgressDialog(
    "saving credits…",
    { progress: 30 },
    async () => saveCredits(client, recordingId, answer.rows!, existing),
  )) as CreditOutcome[];

  // Link the RECORDING page — that's where recording credits render in
  // /inspect (the work page shows the composition side only; smoke-test
  // finding 2026-06-12: a work-page link here reads as "credits missing").
  await showLink(
    context,
    "pica — credits",
    formatOutcomes(outcomes),
    `${BASE_URL}/inspect/recordings/${recordingId}`,
  );
}

async function showDialog(context: ExtensionContext<"1.0.0">, html: string, height: number): Promise<void> {
  await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 360, height);
}

function showError(context: ExtensionContext<"1.0.0">, body: string): Promise<void> {
  return showDialog(context, messageHtml("pica — error", body), 200);
}
function showLink(context: ExtensionContext<"1.0.0">, title: string, body: string, url: string): Promise<void> {
  return showDialog(context, linkMessageHtml(title, body, url), 280);
}
