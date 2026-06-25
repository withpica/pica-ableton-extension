// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { initialize, type ActivationContext, type ExtensionContext } from "@ableton-extensions/sdk";
import interfaceHtml from "../ui/interface.html";
import creditsHtml from "../ui/credits.html";
import writersHtml from "../ui/writers.html";
import audioHtml from "../ui/audio.html";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
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
  linkMessageHtml,
  finalReportHtml,
  duplicateChoiceHtml,
  titlePromptHtml,
  deliverHtml,
  deliverConfirmHtml,
  stemsReportHtml,
  shareStemsHtml,
  type RegisterReport,
  type StepResult,
} from "./dialogHtml";
import { deliverWork, isDeliverableEmail } from "./pica/deliver";
import { mapAudioQueryToStems, selectionParam } from "./pica/shareStems";
import { isAudioTrack, deriveRenderTargets, computeSongEnd, type TrackLike } from "./session/renderTargets";
import { uploadRenderedStem, exceedsCap, MAX_UPLOAD_BYTES } from "./pica/audioUpload";
import { connectAndStoreKey, withReconnect, safeParse } from "./pica/connect";
import { ensureMasterOwnership, type MasterOwnershipOutcome } from "./pica/ownership";
import {
  stemsOpenerLabel,
  stemPhaseLabel,
  IDLE_LINES,
  deliverPhaseLabel,
  registerPhaseLabel,
  creditsPhaseLabel,
  writersPhaseLabel,
} from "./storyCopy";
import { withStory } from "./progress";

const BASE_URL = "https://withpica.com";
const PANEL_W = 460;
const PANEL_H = 520;
const CHOICE_W = 480;
const CHOICE_H = 380;

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
  void context.ui.registerContextMenuAction("AudioTrack", "Register set in PICA", COMMAND_ID);
  void context.ui.registerContextMenuAction("MidiTrack", "Register set in PICA", COMMAND_ID);

  // Standalone "Send stems to PICA": resolve an already-registered work by title,
  // then run the render/upload loop against its master recording.
  const SEND_STEMS_ID = "pica.sendStems";
  context.commands.registerCommand(SEND_STEMS_ID, () => {
    void runSendStemsStandalone(context, hostApiVersion).catch((e) => {
      void showError(context, e instanceof Error ? e.message : String(e));
    });
  });
  void context.ui.registerContextMenuAction("AudioTrack", "Log stems in pica", SEND_STEMS_ID);
  void context.ui.registerContextMenuAction("MidiTrack", "Log stems in pica", SEND_STEMS_ID);

  const DELIVER_ID = "pica.deliver";
  context.commands.registerCommand(DELIVER_ID, () => {
    void runDeliverStandalone(context, hostApiVersion).catch((e) => {
      void showError(context, e instanceof Error ? e.message : String(e));
    });
  });
  void context.ui.registerContextMenuAction("AudioTrack", "Share with… (PICA)", DELIVER_ID);
  void context.ui.registerContextMenuAction("MidiTrack", "Share with… (PICA)", DELIVER_ID);
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
    registerPhaseLabel("introduce", answer.title!),
    { progress: 10 },
    async (update) => {
      // ensureIntroduced + registerSet are the register-phase network calls; run
      // them through the reconnect wrapper so a 401 mints a fresh key once and
      // retries (the whole pair re-runs on retry). A DuplicateWorkError is not a
      // 401 → it propagates unchanged to the catch below.
      return runWithClient(async (c) => {
        await update(registerPhaseLabel("introduce", answer.title!), 25);
        await ensureIntroduced(c, liveVersion);
        await update(registerPhaseLabel("register", answer.title!), 65);
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
        const action = await showReport(context, {
          action: "version",
          title: answer.title!,
          workId: e.existingWorkId,
          recordingId,
          masterOwnership,
          spliceLogged,
          credits,
        });
        await runReportFollowOn(context, runWithClient, action, e.existingWorkId, recordingId, answer.title!);
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
        const action = await showReport(context, {
          action: "existing",
          title: answer.title!,
          workId: e.existingWorkId,
          recordingId,
          masterOwnership,
          spliceLogged,
          credits,
        });
        await runReportFollowOn(context, runWithClient, action, e.existingWorkId, recordingId, answer.title!);
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

  const reportAction = await showReport(context, {
    action: "registered",
    title: answer.title!,
    workId: r.workId,
    recordingId: r.recordingId,
    masterOwnership: r.masterOwnership,
    spliceLogged,
    credits,
    writers,
  });
  await runReportFollowOn(context, runWithClient, reportAction, r.workId, r.recordingId, answer.title!);
}

const AUDIO_W = 520;
const AUDIO_H = 600;
const TITLE_W = 460;
const TITLE_H = 250;
const MAX_MB = Math.round(MAX_UPLOAD_BYTES / 1048576);
const STORY_INTERVAL_MS = 2500;

/**
 * Stage 3: render the chosen audio tracks pre-fx and upload each as a stem
 * linked to the work's master recording. Shared by the in-flow hook (after
 * register) and the standalone "Send stems to PICA" command.
 */
async function runSendStems(
  context: ExtensionContext<"1.0.0">,
  run: ClientRunner,
  workId: string,
  recordingId: string,
  workTitle: string,
): Promise<void> {
  const song = context.application.song;
  const allTracks = (song.tracks ?? []) as unknown as TrackLike[];
  const audioTracks = allTracks.filter(isAudioTrack);
  if (audioTracks.length === 0) {
    await showError(
      context,
      "no audio tracks in the arrangement. freeze & flatten the tracks you want to upload (this prints their fx), then try again.",
    );
    return;
  }
  const songEnd = computeSongEnd(allTracks);
  if (songEnd <= 0) {
    await showError(
      context,
      "the arrangement is empty. flatten or record your clips into the arrangement, then try again.",
    );
    return;
  }
  const targets = deriveRenderTargets(audioTracks);
  const masterUrl = `${BASE_URL}/inspect/recordings/${recordingId}`;

  const injected = audioHtml.replace(
    "</head>",
    `<script>window.__PICA_STEMS__ = ${JSON.stringify({
      stems: targets.map((t, i) => ({ index: i, name: t.name, label: t.label })),
      masterUrl,
    }).replace(/</g, "\\u003c")};</script></head>`,
  );
  const raw = await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(injected)}`, AUDIO_W, AUDIO_H);
  // Join back to render targets by stable array index, not by name: Live audio
  // tracks frequently share a name (default "Audio", common after freeze &
  // flatten), so a name-keyed map would collapse same-named tracks to one entry
  // and silently render the same track twice while dropping the other.
  let answer: { cancelled?: boolean; stems?: Array<{ index: number; include: boolean; label: string }> };
  try {
    answer = JSON.parse(raw);
  } catch {
    return;
  }
  if (answer.cancelled || !Array.isArray(answer.stems)) return;

  const chosen = answer.stems.filter((s) => s.include);
  const results: string[] = [];

  await context.ui.withinProgressDialog(
    stemsOpenerLabel(),
    { progress: 0 },
    async (update, signal) => {
      const total = chosen.length;
      let done = 0;
      let storyTick = 0;
      for (const s of chosen) {
        if (signal.aborted) break;
        const target = targets[s.index];
        if (!target) {
          done++;
          continue;
        }
        const label = (s.label || target.label).trim() || target.name;
        // Render takes the first half of this stem's slice, upload the second —
        // so the bar moves *within* a single stem (fixes the frozen-0% case).
        const renderPct = Math.round((done / total) * 100);
        const uploadPct = Math.round(((done + 0.5) / total) * 100);
        try {
          // The high-level Resources.renderPreFxAudio takes a typed AudioTrack; our
          // structural TrackLike is the same live object handed back unchanged from
          // deriveRenderTargets — cast at this single IO boundary.
          const wavPath = await withStory(
            update,
            signal,
            {
              steadyLabel: stemPhaseLabel("render", label),
              pct: renderPct,
              idleLines: IDLE_LINES,
              intervalMs: STORY_INTERVAL_MS,
              startTick: storyTick,
            },
            () =>
              context.resources.renderPreFxAudio(
                target.track as never,
                0,
                songEnd,
              ),
          );
          storyTick += 3;
          const size = statSync(wavPath).size;
          if (exceedsCap(size)) {
            results.push(
              `✗ ${label} — too large (${Math.round(size / 1048576)}MB > ${MAX_MB}MB); flatten a shorter range`,
            );
          } else {
            const sizeMb = Math.round(size / 1048576);
            await withStory(
              update,
              signal,
              {
                steadyLabel: stemPhaseLabel("upload", label, sizeMb),
                pct: uploadPct,
                idleLines: IDLE_LINES,
                intervalMs: STORY_INTERVAL_MS,
                startTick: storyTick,
              },
              () =>
                run((c) =>
                  uploadRenderedStem(
                    { client: c, fetchFn: fetch, readFile },
                    {
                      wavPath,
                      fileName: `${label}.wav`,
                      fileSize: size,
                      recordingId,
                      workId,
                      stemLabel: label,
                    },
                  ),
                ),
            );
            storyTick += 3;
            await update(stemPhaseLabel("queued", label), uploadPct);
            results.push(`✓ ${label}`);
          }
        } catch (e) {
          results.push(
            `✗ ${label} — ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        done++;
      }
    },
  );

  const body = results.length ? results.join("\n") : "no stems selected.";
  const url = `${BASE_URL}/inspect/recordings/${recordingId}`;
  const action = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(stemsReportHtml(body, url))}`,
    460,
    440,
  );
  // Host won't open a second modal in the same turn the previous one closes —
  // yield so the share dialog can open (same pattern as the register report).
  if (action === "share") {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await runDeliver(context, run, workId, workTitle);
  }
}

/** Standalone entry: connect (if needed) → ask which work → resolve it → send stems. */
async function runSendStemsStandalone(context: ExtensionContext<"1.0.0">, hostApiVersion: string): Promise<void> {
  const storageDir = context.environment.storageDirectory;
  if (!storageDir) {
    await showError(context, "No storage directory available — cannot read the PICA key.");
    return;
  }
  let apiKey = await readApiKey(storageDir);
  if (!apiKey) {
    apiKey = await connectAndStoreKey(context, storageDir);
    if (!apiKey) return;
  }
  let currentKey = apiKey!;
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
  const liveVersion = hostApiVersion ? `(api ${hostApiVersion})` : "";

  const titleRaw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(titlePromptHtml())}`,
    TITLE_W,
    TITLE_H,
  );
  const parsed = safeParse(titleRaw) as { title?: string; cancelled?: boolean };
  const title = parsed.title?.trim();
  if (parsed.cancelled || !title) return;

  const found = await runWithClient(async (c) => {
    await ensureIntroduced(c, liveVersion);
    return findExistingRegistration(c, title);
  });
  if (!found?.recordingId) {
    await showError(
      context,
      `no registered work titled "${title}" found. register the Set in PICA first, then send stems.`,
    );
    return;
  }
  await runSendStems(context, runWithClient, found.workId, found.recordingId, title);
}

/**
 * Stage 5: send a registered work to a recipient by email via pica_share_send.
 * Shared by the in-flow report hook and the standalone command. Surfaces every
 * failure to the user via showError, like the stems follow-on (runReportFollowOn
 * now reports a stems failure rather than swallowing it).
 */
async function runDeliver(
  context: ExtensionContext<"1.0.0">,
  run: ClientRunner,
  workId: string,
  workTitle: string,
): Promise<void> {
  // Query audio files for this work and show a stem picker when there are multiple.
  // Best-effort: any failure or empty result skips the picker (never blocks the share).
  let includedFileIds: string[] | undefined;
  try {
    const audioRaw = await run((c) => c.callTool("pica_audio_query", { work_id: workId }));
    const obj = audioRaw as { data?: unknown; items?: unknown } | null;
    const rows = Array.isArray(audioRaw)
      ? audioRaw
      : Array.isArray(obj?.data)
        ? (obj.data as unknown[])
        : Array.isArray(obj?.items)
          ? (obj.items as unknown[])
          : [];
    const audioRows = rows as Array<{ id: string; filename?: string; stem_label?: string | null; file_type?: string }>;
    const stems = mapAudioQueryToStems(audioRows);
    if (stems.length > 1) {
      const pickerRaw = await context.ui.showModalDialog(
        `data:text/html,${encodeURIComponent(shareStemsHtml(stems))}`,
        DELIVER_W,
        STEM_PICKER_H,
      );
      const pickerAns = safeParse(pickerRaw) as { cancelled?: boolean; ids?: string[] };
      if (pickerAns.cancelled) return;
      const chosen = pickerAns.ids ?? [];
      if (chosen.length === 0) {
        await showError(context, "select at least one stem, or cancel.");
        return;
      }
      includedFileIds = selectionParam(stems.map((s) => s.id), chosen);
    }
    // stems.length <= 1: share all (includedFileIds stays undefined)
  } catch {
    // best-effort: skip the picker on any query error
  }

  const raw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(deliverHtml(workTitle))}`,
    DELIVER_W,
    DELIVER_H,
  );
  const ans = safeParse(raw) as { cancelled?: boolean; email?: string; note?: string; allowDownload?: boolean };
  if (ans.cancelled) return;
  const email = (ans.email ?? "").trim();
  if (!isDeliverableEmail(email)) {
    if (email) await showError(context, `"${email}" doesn't look like an email address. nothing was sent.`);
    return;
  }
  const note = ans.note?.trim() || undefined;
  const allowDownload = ans.allowDownload !== false; // default ON

  let result = (await context.ui.withinProgressDialog(
    deliverPhaseLabel(workTitle, email),
    { progress: 40 },
    async () =>
      run((c) =>
        deliverWork({ client: c }, { workId, email, note, allowDownload, includedFileIds }),
      ),
  )) as Awaited<ReturnType<typeof deliverWork>>;

  if (result.state === "needs_confirm") {
    const confirmRaw = await context.ui.showModalDialog(
      `data:text/html,${encodeURIComponent(deliverConfirmHtml(email))}`,
      DELIVER_W,
      DELIVER_CONFIRM_H,
    );
    const c = safeParse(confirmRaw) as { confirmed?: boolean; cancelled?: boolean };
    if (!c.confirmed) return;
    result = (await context.ui.withinProgressDialog(
      deliverPhaseLabel(workTitle, email),
      { progress: 60 },
      async () =>
        run((cl) =>
          deliverWork(
            { client: cl },
            { workId, email, note, allowDownload, confirmFirstExternal: true, includedFileIds },
          ),
        ),
    )) as Awaited<ReturnType<typeof deliverWork>>;
  }

  if (result.state === "sent") {
    await showLink(
      context,
      "pica — shared",
      `emailed ${result.displayName ?? email} (${result.classification}).`,
      result.shareUrl || `${BASE_URL}/inspect/works/${workId}`,
    );
  } else if (result.state === "error") {
    await showError(context, `couldn't deliver: ${result.message}`);
  }
}

/** Standalone entry: connect (if needed) → ask which work → resolve it → deliver. */
async function runDeliverStandalone(context: ExtensionContext<"1.0.0">, hostApiVersion: string): Promise<void> {
  const storageDir = context.environment.storageDirectory;
  if (!storageDir) {
    await showError(context, "No storage directory available — cannot read the PICA key.");
    return;
  }
  let apiKey = await readApiKey(storageDir);
  if (!apiKey) {
    apiKey = await connectAndStoreKey(context, storageDir);
    if (!apiKey) return;
  }
  let currentKey = apiKey!;
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
  const liveVersion = hostApiVersion ? `(api ${hostApiVersion})` : "";

  const titleRaw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(titlePromptHtml("type the title of the work you want to share:"))}`,
    TITLE_W,
    TITLE_H,
  );
  const parsed = safeParse(titleRaw) as { title?: string; cancelled?: boolean };
  const title = parsed.title?.trim();
  if (parsed.cancelled || !title) return;

  const found = await runWithClient(async (c) => {
    await ensureIntroduced(c, liveVersion);
    return findExistingRegistration(c, title);
  });
  if (!found?.workId) {
    await showError(context, `no registered work titled "${title}" found. register it in PICA first, then deliver.`);
    return;
  }
  await runDeliver(context, runWithClient, found.workId, title);
}

const CREDITS_W = 540;
const CREDITS_H = 620;
const WRITERS_W = 480;
const WRITERS_H = 520;
const REPORT_H = 540;
const DELIVER_W = 460;
const DELIVER_H = 400;
const DELIVER_CONFIRM_H = 240;
const STEM_PICKER_H = 320;

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
      creditsPhaseLabel(),
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
      writersPhaseLabel(),
      { progress: 30 },
      async () => run((c) => saveWriters(c, workId, answer.names!)),
    )) as WriterOutcome[];
    return { state: "saved", outcomes };
  } catch (e) {
    return { state: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

async function showDialog(context: ExtensionContext<"1.0.0">, html: string, height: number): Promise<void> {
  await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 440, height);
}

function showError(context: ExtensionContext<"1.0.0">, body: string): Promise<void> {
  return showDialog(context, messageHtml("pica — error", body), 240);
}

/** Info dialog carrying a PICA link (clickable anchor + copy + selectable text). */
function showLink(context: ExtensionContext<"1.0.0">, title: string, body: string, url: string): Promise<void> {
  return showDialog(context, linkMessageHtml(title, body, url), 400);
}

/** The ONE consolidated end-of-flow report: lead line + per-step outcomes + the three links. */
function showReport(context: ExtensionContext<"1.0.0">, report: RegisterReport): Promise<string> {
  return context.ui.showModalDialog(`data:text/html,${encodeURIComponent(finalReportHtml(report))}`, 460, REPORT_H);
}

/** Apply a register-report follow-on (log stems / share with), carrying work context.
 *  Shared by the fresh-register path and both duplicate-path branches so the
 *  report buttons work identically everywhere. */
async function runReportFollowOn(
  context: ExtensionContext<"1.0.0">,
  run: ClientRunner,
  action: string,
  workId: string,
  recordingId: string,
  workTitle: string,
): Promise<void> {
  if (action !== "sendStems" && action !== "deliver") return;
  // The report is a webview modal; the host won't open a second modal in the
  // same turn the previous one closes — yield so the follow-up dialog opens.
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (action === "sendStems") {
    if (!recordingId) {
      await showError(context, "couldn't start stems — no recording was created for this work.");
      return;
    }
    await runSendStems(context, run, workId, recordingId, workTitle).catch((e) =>
      showError(context, e instanceof Error ? e.message : String(e)),
    );
  } else {
    await runDeliver(context, run, workId, workTitle);
  }
}
