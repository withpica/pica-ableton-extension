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
import { saveWriters, type WriterOutcome } from "./pica/writers";
import { fetchPeopleCandidates, candidateNames, resolvePersonId, type PersonCandidate } from "./pica/people";
import { detectSpliceSamples, saveSpliceSamples } from "./pica/samples";
import {
  messageHtml,
  finalReportHtml,
  duplicateChoiceHtml,
  type RegisterReport,
  type StepResult,
} from "./dialogHtml";
import { connectAndStoreKey, withReconnect, safeParse } from "./pica/connect";
import { ensureMasterOwnership, type MasterOwnershipOutcome } from "./pica/ownership";

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

  // Fetch the org's people once, up front — powers the artist typeahead here and
  // the credit/writer typeaheads later (one fetch for the whole flow). Best-effort.
  const candidates = await fetchPeopleCandidates(
    new PicaMcpClient({ baseUrl: BASE_URL, apiKey }),
  ).catch(() => []);

  // 2. Confirm-and-edit panel. Title + artist are user-entered (the Set has neither).
  const prefillJson = JSON.stringify({ summary, key: derivedKey, workType: "song" }).replace(/</g, "\\u003c");
  const namesJson = JSON.stringify(candidateNames(candidates)).replace(/</g, "\\u003c");
  const injected = interfaceHtml.replace(
    "</head>",
    `<script>window.__PICA_PREFILL__ = ${prefillJson}; window.__PICA_PEOPLE_NAMES__ = ${namesJson};</script></head>`,
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

  const primaryArtistId = resolvePersonId(answer.artistName, candidates);

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
          primaryArtistId,
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

      // RT-2: best-effort Splice capture whenever the Set is attributed to a
      // recording on the duplicate path (new version OR completing the existing
      // master). Idempotent; returns the added count so the duplicate report can
      // surface it (AC-6).
      const captureSplice = async (recId: string): Promise<number> => {
        const samples = detectSpliceSamples(snapshot);
        if (!samples.length) return 0;
        const outcome = await runWithClient((c) => saveSpliceSamples(c, recId, samples)).catch(() => undefined);
        return outcome?.added ?? 0;
      };

      // Capture 100% org master ownership on a recording WE mint on the duplicate
      // path (new version, or completing the existing work's master) — same as the
      // fresh-register path. Idempotent (skips if a master split exists) and a
      // starting position the owner refines/reassigns in /inspect. Best-effort: a
      // non-401 failure is reported, never thrown (401 is handled inside
      // runWithClient). NOT called when adding to a pre-existing recording (not
      // necessarily ours to claim).
      const captureOwnership = async (
        recId: string,
      ): Promise<MasterOwnershipOutcome["status"]> =>
        runWithClient((c) => ensureMasterOwnership(c, recId))
          .then((o) => o.status)
          .catch(() => "failed" as const);

      if (choice.action === "newVersion") {
        const versionType = coerceVersionType(choice.versionType);
        const { recordingId } = await runWithClient((c) =>
          createRecordingForWork(c, {
            workId: e.existingWorkId,
            title: answer.title!,
            artistName: answer.artistName!,
            versionType,
            primaryArtistId,
          }),
        );
        const masterOwnership = await captureOwnership(recordingId);
        const spliceLogged = await captureSplice(recordingId);
        const credits = await runCreditsFlow(context, runWithClient, recordingId, buildPrefillTree(tree, []), [], candidates);
        await showReport(context, {
          action: "version",
          title: answer.title!,
          workId: e.existingWorkId,
          recordingId,
          masterOwnership,
          spliceLogged,
          credits,
        });
        return undefined;
      }

      if (choice.action === "existing") {
        const found = await findExistingRegistration(client, answer.title!);
        let recordingId = found?.recordingId ?? null;
        let existing: ExistingCredit[] = [];
        // Only claim master ownership when WE mint the recording below; adding
        // credits to a pre-existing recording must not assert ownership over it.
        let masterOwnership: MasterOwnershipOutcome["status"] | undefined;
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
              primaryArtistId,
            }),
          );
          recordingId = created.recordingId;
          masterOwnership = await captureOwnership(recordingId);
        }
        const spliceLogged = await captureSplice(recordingId);
        const credits = await runCreditsFlow(context, runWithClient, recordingId, buildPrefillTree(tree, existing), existing, candidates);
        await showReport(context, {
          action: "existing",
          title: answer.title!,
          workId: e.existingWorkId,
          recordingId,
          masterOwnership,
          spliceLogged,
          credits,
        });
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
    inspectUrl: string;
    masterOwnership?: MasterOwnershipOutcome["status"];
  };
  // RT-2: auto-capture Splice samples used in the Set, before the success
  // dialog so its count can be surfaced. Best-effort + idempotent; a 401 reaches
  // the reconnect runner via runWithClient.
  let spliceLogged = 0;
  const detectedSplice = detectSpliceSamples(snapshot);
  if (detectedSplice.length) {
    const spliceOutcome = await runWithClient((c) =>
      saveSpliceSamples(c, r.recordingId, detectedSplice),
    ).catch(() => undefined);
    spliceLogged = spliceOutcome?.added ?? 0;
  }

  // Stage 2 + 3: offer the attribution + writers checklists right after register
  // (both skippable). Best-effort: the registration already succeeded, so a
  // checklist failure is captured into the report's StepResult, never an error
  // dialog. Their outcomes feed the ONE consolidated final report below.
  let credits: StepResult<CreditOutcome> | undefined;
  if (r.recordingId) {
    const tree = derivePartTree(snapshot);
    credits = await runCreditsFlow(
      context,
      runWithClient,
      r.recordingId,
      buildPrefillTree(tree, []),
      [],
      candidates,
    ).catch((e) => ({ state: "error" as const, error: e instanceof Error ? e.message : String(e) }));
  }

  const writers = await runWritersFlow(context, runWithClient, r.workId, candidates).catch(
    (e) => ({ state: "error" as const, error: e instanceof Error ? e.message : String(e) }),
  );

  await showReport(context, {
    action: "registered",
    title: answer.title!,
    workId: r.workId,
    recordingId: r.recordingId,
    masterOwnership: r.masterOwnership,
    spliceLogged,
    credits,
    writers,
  });
}

const CREDITS_W = 430;
const CREDITS_H = 520;
const WRITERS_W = 380;
const WRITERS_H = 440;
const REPORT_H = 460;

/** A reconnect-aware runner: builds a client (possibly from a fresh key) and runs `fn`. */
type ClientRunner = <T>(fn: (c: PicaMcpClient) => Promise<T>) => Promise<T>;

/** The Stage-2 checklist: parts → panel → per-row credit writes → outcome report. */
async function runCreditsFlow(
  context: ExtensionContext<"1.0.0">,
  run: ClientRunner,
  recordingId: string,
  prefillNodes: PrefillNode[],
  existing: ExistingCredit[],
  candidates: PersonCandidate[],
): Promise<StepResult<CreditOutcome>> {
  const prefillJson = JSON.stringify({ tree: prefillNodes }).replace(/</g, "\\u003c");
  const namesJson = JSON.stringify(candidateNames(candidates)).replace(/</g, "\\u003c");
  const injected = creditsHtml.replace(
    "</head>",
    `<script>window.__PICA_PREFILL__ = ${prefillJson}; window.__PICA_PEOPLE_NAMES__ = ${namesJson};</script></head>`,
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
    return { state: "skipped" }; // dialog dismissed
  }
  if (answer.cancelled || !Array.isArray(answer.tree)) return { state: "skipped" }; // skip writes nothing

  try {
    const outcomes = (await context.ui.withinProgressDialog(
      "saving credits…",
      { progress: 30 },
      async () => run((c) => saveCredits(c, recordingId, serializeFrontier(answer.tree!), existing, candidates)),
    )) as CreditOutcome[];
    return { state: "saved", outcomes };
  } catch (e) {
    return { state: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** The Stage-3 writers step: names-only panel → pica_work_writers_add → outcome report. */
async function runWritersFlow(
  context: ExtensionContext<"1.0.0">,
  run: ClientRunner,
  workId: string,
  candidates: PersonCandidate[],
): Promise<StepResult<WriterOutcome>> {
  const namesJson = JSON.stringify(candidateNames(candidates)).replace(/</g, "\\u003c");
  const injected = writersHtml.replace(
    "</head>",
    `<script>window.__PICA_PEOPLE_NAMES__ = ${namesJson};</script></head>`,
  );
  const raw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(injected)}`,
    WRITERS_W,
    WRITERS_H,
  );

  let answer: { cancelled?: boolean; names?: string[] };
  try {
    answer = JSON.parse(raw);
  } catch {
    return { state: "skipped" }; // dialog dismissed
  }
  if (answer.cancelled || !Array.isArray(answer.names)) return { state: "skipped" }; // skip writes nothing

  try {
    const outcomes = (await context.ui.withinProgressDialog(
      "saving writers…",
      { progress: 30 },
      async () => run((c) => saveWriters(c, workId, answer.names!)),
    )) as WriterOutcome[];
    return { state: "saved", outcomes };
  } catch (e) {
    return { state: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

async function showDialog(context: ExtensionContext<"1.0.0">, html: string, height: number): Promise<void> {
  await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 360, height);
}

function showError(context: ExtensionContext<"1.0.0">, body: string): Promise<void> {
  return showDialog(context, messageHtml("pica — error", body), 200);
}

/** The ONE consolidated end-of-flow report: lead line + per-step outcomes + the three links. */
function showReport(context: ExtensionContext<"1.0.0">, report: RegisterReport): Promise<string> {
  return context.ui.showModalDialog(`data:text/html,${encodeURIComponent(finalReportHtml(report))}`, 360, REPORT_H);
}
