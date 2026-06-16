// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { initialize, type ActivationContext, type ExtensionContext } from "@ableton-extensions/sdk";
import interfaceHtml from "../ui/interface.html";
import creditsHtml from "../ui/credits.html";
import writersHtml from "../ui/writers.html";
import { PicaMcpClient } from "./pica/mcpClient";
import { readApiKey } from "./pica/keyStore";
import { readSong, type SongLike } from "./session/read";
import { buildMetadata, buildSummary } from "./session/snapshot";
import { derivePartTree } from "./session/parts";
import {
  ensureIntroduced,
  registerSet,
  findExistingRegistration,
  DuplicateWorkError,
  createRecordingForWork,
  NEW_VERSION_TYPES,
  coerceVersionType,
} from "./pica/register";
import {
  buildPrefillTree,
  serializeFrontier,
  loadExistingCredits,
  saveCredits,
  type CreditOutcome,
  type ExistingCredit,
  type FrontierNode,
  type PrefillNode,
} from "./pica/credits";
import { saveWriters, summarizeWriters, type WriterOutcome } from "./pica/writers";
import { messageHtml, linkMessageHtml, successBody, duplicateChoiceHtml } from "./dialogHtml";
import { connectAndStoreKey, withReconnect, safeParse } from "./pica/connect";
import type { MasterOwnershipOutcome } from "./pica/ownership";

const BASE_URL = "https://withpica.com";
const PANEL_W = 380;
const PANEL_H = 460;
const CHOICE_W = 420;
const CHOICE_H = 320;

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
  let apiKey = await readApiKey(storageDir);
  if (!apiKey) {
    apiKey = await connectAndStoreKey(context, storageDir);
    if (!apiKey) return; // user backed out — no error dialog
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

  // Hold the live key in a mutable local so one reconnect (register OR credits
  // phase) carries the fresh key forward to every later call in this run —
  // avoids a second Connect prompt when the register phase already re-keyed.
  let currentKey = apiKey!;

  // Build the client lazily so a 401 mid-register can reconnect and swap the key.
  const runWithClient = <T>(fn: (c: PicaMcpClient) => Promise<T>) =>
    withReconnect(
      context,
      storageDir,
      (key: string) => fn(new PicaMcpClient({ baseUrl: BASE_URL, apiKey: key })),
      currentKey,
      (fresh) => {
        currentKey = fresh;
      },
    );

  const result = await context.ui.withinProgressDialog(
    "Registering in PICA…",
    { progress: 10 },
    async (update) => {
      // ensureIntroduced + registerSet are the register-phase network calls; run
      // them through the reconnect wrapper so a 401 mints a fresh key once and
      // retries (the whole pair re-runs on retry). A DuplicateWorkError is not a
      // 401 → it propagates unchanged to the catch below.
      return runWithClient(async (c) => {
        await update("Declaring agent identity…", 25);
        await ensureIntroduced(c, liveVersion);
        await update("Registering work + master recording…", 65);
        return registerSet(c, {
          title: answer.title!,
          artistName: answer.artistName!,
          workType: answer.workType || "song",
          key: answer.key || derivedKey,
          metadata,
          summary,
        });
      });
    },
  ).catch(async (e: unknown) => {
    if (e instanceof DuplicateWorkError) {
      const raw = await context.ui.showModalDialog(
        `data:text/html,${encodeURIComponent(duplicateChoiceHtml(answer.title!, NEW_VERSION_TYPES))}`,
        CHOICE_W,
        CHOICE_H,
      );
      const choice = safeParse(raw); // {} on close → treated as cancel
      const tree = derivePartTree(snapshot);

      if (choice.action === "newVersion") {
        const versionType = coerceVersionType(choice.versionType);
        const { recordingId } = await runWithClient((c) =>
          createRecordingForWork(c, {
            workId: e.existingWorkId,
            title: answer.title!,
            artistName: answer.artistName!,
            versionType,
          }),
        );
        await runCreditsFlow(context, runWithClient, recordingId, buildPrefillTree(tree, []), []);
        return undefined;
      }

      if (choice.action === "existing") {
        const found = await findExistingRegistration(client, answer.title!);
        let recordingId = found?.recordingId ?? null;
        let existing: ExistingCredit[] = [];
        if (recordingId) {
          existing = await loadExistingCredits(client, recordingId);
        } else {
          // Work exists without a recording → complete it: create the master.
          // findExistingRegistration matched by exact title; for a title-deduped catalog
          // its work and e.existingWorkId are the same work — create the master there.
          const created = await runWithClient((c) =>
            createRecordingForWork(c, {
              workId: e.existingWorkId,
              title: answer.title!,
              artistName: answer.artistName!,
              versionType: "master",
            }),
          );
          recordingId = created.recordingId;
        }
        await runCreditsFlow(context, runWithClient, recordingId, buildPrefillTree(tree, existing), existing);
        return undefined;
      }

      return undefined; // cancel / unparseable
    }
    throw e;
  });

  if (!result || typeof result !== "object" || !("inspectUrl" in result)) return;

  const r = result as {
    workId: string;
    recordingId: string;
    completenessScore?: number;
    inspectUrl: string;
    masterOwnership?: MasterOwnershipOutcome["status"];
  };
  await showLink(context, "pica — registered", successBody(r.completenessScore, r.masterOwnership), r.inspectUrl);

  // Stage 2: offer the attribution checklist right after register (skippable).
  // Best-effort: the registration already succeeded — a checklist failure must
  // not surface as an error dialog on top of the success dialog.
  if (r.recordingId) {
    const tree = derivePartTree(snapshot);
    await runCreditsFlow(
      context,
      runWithClient,
      r.recordingId,
      buildPrefillTree(tree, []),
      [],
    ).catch(() => undefined);
  }

  await runWritersFlow(context, runWithClient, r.workId).catch(() => undefined);
}

const CREDITS_W = 430;
const CREDITS_H = 520;
const WRITERS_W = 380;
const WRITERS_H = 440;

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

/** A reconnect-aware runner: builds a client (possibly from a fresh key) and runs `fn`. */
type ClientRunner = <T>(fn: (c: PicaMcpClient) => Promise<T>) => Promise<T>;

/** The Stage-2 checklist: parts → panel → per-row credit writes → outcome report. */
async function runCreditsFlow(
  context: ExtensionContext<"1.0.0">,
  run: ClientRunner,
  recordingId: string,
  prefillNodes: PrefillNode[],
  existing: ExistingCredit[],
): Promise<void> {
  const prefillJson = JSON.stringify({ tree: prefillNodes }).replace(/</g, "\\u003c");
  const injected = creditsHtml.replace(
    "</head>",
    `<script>window.__PICA_PREFILL__ = ${prefillJson};</script></head>`,
  );
  const raw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(injected)}`,
    CREDITS_W,
    CREDITS_H,
  );

  let answer: { cancelled?: boolean; tree?: FrontierNode[] };
  try {
    answer = JSON.parse(raw);
  } catch {
    return; // dialog dismissed
  }
  if (answer.cancelled || !Array.isArray(answer.tree)) return; // skip writes nothing

  const outcomes = (await context.ui.withinProgressDialog(
    "saving credits…",
    { progress: 30 },
    async () => run((c) => saveCredits(c, recordingId, serializeFrontier(answer.tree!), existing)),
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

/** The Stage-3 writers step: names-only panel → pica_work_writers_add → outcome report. */
async function runWritersFlow(
  context: ExtensionContext<"1.0.0">,
  run: ClientRunner,
  workId: string,
): Promise<void> {
  const raw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(writersHtml)}`,
    WRITERS_W,
    WRITERS_H,
  );

  let answer: { cancelled?: boolean; names?: string[] };
  try {
    answer = JSON.parse(raw);
  } catch {
    return; // dialog dismissed
  }
  if (answer.cancelled || !Array.isArray(answer.names)) return; // skip writes nothing

  const outcomes = (await context.ui.withinProgressDialog(
    "saving writers…",
    { progress: 30 },
    async () => run((c) => saveWriters(c, workId, answer.names!)),
  )) as WriterOutcome[];

  await showLink(
    context,
    "pica — writers",
    summarizeWriters(outcomes) || "no writers added.",
    `${BASE_URL}/inspect/works/${workId}`,
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
