// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import { initialize, type ActivationContext, type ExtensionContext } from "@ableton-extensions/sdk";
import interfaceHtml from "../ui/interface.html";
import { PicaMcpClient } from "./pica/mcpClient";
import { readApiKey } from "./pica/keyStore";
import { readSong, type SongLike } from "./session/read";
import { buildMetadata, buildSummary } from "./session/snapshot";
import { ensureIntroduced, registerSet, DuplicateWorkError } from "./pica/register";

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
  const prefill = encodeURIComponent(JSON.stringify({ summary, key: derivedKey, workType: "song" }));
  const url = `data:text/html,${encodeURIComponent(interfaceHtml)}#${prefill}`;
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
      await showError(
        context,
        `Already registered. Open it in PICA:\n${BASE_URL}/inspect/works/${e.existingWorkId}`,
      );
      return undefined;
    }
    throw e;
  });

  if (!result || typeof result !== "object" || !("inspectUrl" in result)) return;

  const r = result as { completenessScore?: number; inspectUrl: string };
  const score = typeof r.completenessScore === "number" ? ` · ${r.completenessScore}% complete` : "";
  await showInfo(context, `Registered${score}.\nView in PICA:\n${r.inspectUrl}`);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

async function showMessage(context: ExtensionContext<"1.0.0">, title: string, body: string): Promise<void> {
  const html =
    `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0A0A0A;color:#EDEDED;` +
    `font:13px ui-monospace,Menlo,monospace;padding:18px;white-space:pre-wrap">` +
    `<div style="color:#B87333;margin-bottom:8px">${escapeHtml(title)}</div>${escapeHtml(body)}` +
    `<div style="margin-top:16px"><button onclick="(window.webkit&&webkit.messageHandlers.live` +
    `?webkit.messageHandlers.live:chrome.webview).postMessage({method:'close_and_send',params:['ok']})">close</button></div>`;
  await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 360, 200);
}

function showError(context: ExtensionContext<"1.0.0">, body: string): Promise<void> {
  return showMessage(context, "pica — error", body);
}
function showInfo(context: ExtensionContext<"1.0.0">, body: string): Promise<void> {
  return showMessage(context, "pica", body);
}
