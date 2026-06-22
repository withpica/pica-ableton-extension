// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import type { MasterOwnershipOutcome } from "./pica/ownership";
import type { StemChoice } from "./pica/shareStems";
import { summarizeCredits, type CreditOutcome } from "./pica/credits";
import { summarizeWriters, type WriterOutcome } from "./pica/writers";

/**
 * Pure HTML builders for the extension's modal dialogs (host-independent,
 * unit-testable). The Extensions SDK has no host API to open a browser or
 * write the clipboard, so link affordances live inside the webview: a real
 * anchor (Live may forward it to the system browser), selectable text, and
 * a copy button backed by the webview clipboard with a select-fallback.
 */

export const BASE_URL = "https://withpica.com";

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;",
  );
}

/** JS expression (string) that posts `payloadExpr` back to the host and closes. */
function bridgeSend(payloadExpr: string): string {
  return (
    "(window.webkit&&webkit.messageHandlers.live?webkit.messageHandlers.live:chrome.webview)" +
    `.postMessage({method:'close_and_send',params:[${payloadExpr}]})`
  );
}

const CLOSE_JS = bridgeSend("'ok'");

const BASE_STYLE =
  "margin:0;background:#0A0A0A;color:#EDEDED;font:13px ui-monospace,Menlo,monospace;" +
  "padding:18px;white-space:pre-wrap;-webkit-user-select:text;user-select:text";

function closeButton(): string {
  return `<div style="margin-top:16px"><button onclick="${CLOSE_JS}">close</button></div>`;
}

/** Plain message dialog (errors, info without a link). */
export function messageHtml(title: string, body: string): string {
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">${escapeHtml(title)}</div>` +
    `${escapeHtml(body)}${closeButton()}`
  );
}

/** JS (string) for a copy button that copies the textContent of `#${anchorId}`. */
function copyLinkJs(anchorId: string): string {
  return (
    `var u=document.getElementById('${anchorId}');var b=this;` +
    `function ok(){b.textContent='copied';setTimeout(function(){b.textContent='copy'},1500)}` +
    `if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u.textContent).then(ok,fallback)}else{fallback()}` +
    `function fallback(){var r=document.createRange();r.selectNodeContents(u);var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy');ok()}catch(e){}}`
  );
}

/** Message dialog carrying a PICA URL: clickable anchor + copy button + selectable text. */
export function linkMessageHtml(title: string, body: string, url: string): string {
  const safeUrl = escapeHtml(url);
  const copyJs =
    `var u=document.getElementById('u');var b=this;` +
    `function ok(){b.textContent='copied';setTimeout(function(){b.textContent='copy link'},1500)}` +
    `if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(u.textContent).then(ok,fallback)}else{fallback()}` +
    `function fallback(){var r=document.createRange();r.selectNodeContents(u);var s=getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand('copy');ok()}catch(e){}}`;
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">${escapeHtml(title)}</div>` +
    `${escapeHtml(body)}` +
    `<div style="margin-top:12px;word-break:break-all">` +
    `<a id="u" href="${safeUrl}" target="_blank" style="color:#B87333">${safeUrl}</a></div>` +
    `<div style="margin-top:12px"><button onclick="${escapeHtml(copyJs)}">copy link</button> ` +
    `<button onclick="${CLOSE_JS}">close</button></div>`
  );
}

/** Stems-logged completion: result lines + a copy-able PICA link + a
 *  "share with →" follow-on (bridges 'share') + close. */
export function stemsReportHtml(body: string, url: string): string {
  const safeUrl = escapeHtml(url);
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">pica — stems logged</div>` +
    `${escapeHtml(body)}` +
    `<div style="margin-top:12px;word-break:break-all">` +
    `<a id="u" href="${safeUrl}" target="_blank" style="color:#B87333">${safeUrl}</a></div>` +
    `<div style="margin-top:12px"><button onclick="${escapeHtml(copyLinkJs("u"))}">copy link</button></div>` +
    `<div style="margin-top:14px"><button onclick="${bridgeSend("'share'")}">share with →</button></div>` +
    `<div style="margin-top:8px"><button onclick="${CLOSE_JS}">close</button></div>`
  );
}

/** Paste-key dialog: one input + connect/cancel buttons, both bridging via close_and_send. */
export function pasteKeyHtml(): string {
  const connectJs = bridgeSend(
    "JSON.stringify({apiKey:document.getElementById('k').value.trim()})",
  );
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">pica — paste your connection key</div>` +
    `paste the withpica_live_… key you copied from the browser:` +
    `<div style="margin-top:10px"><input id="k" placeholder="withpica_live_…" ` +
    `style="width:100%;box-sizing:border-box;background:#1A1A1A;color:#EDEDED;` +
    `border:1px solid #333;padding:8px;font:12px ui-monospace,Menlo,monospace"></div>` +
    `<div style="margin-top:12px"><button onclick="${escapeHtml(connectJs)}">connect</button> ` +
    `<button onclick="${escapeHtml(cancelJs)}">cancel</button></div>`
  );
}

/** One-input prompt: ask for a work title; bridges {title} or {cancelled:true}. */
export function titlePromptHtml(
  subtitle = "type the title of the registered work these stems belong to:",
): string {
  const confirmJs = bridgeSend("JSON.stringify({title:document.getElementById('t').value.trim()})");
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">pica — which work?</div>` +
    `${escapeHtml(subtitle)}` +
    `<div style="margin-top:10px"><input id="t" placeholder="work title" ` +
    `style="width:100%;box-sizing:border-box;background:#1A1A1A;color:#EDEDED;border:1px solid #333;padding:8px;font:12px ui-monospace,Menlo,monospace"></div>` +
    `<div style="margin-top:12px"><button onclick="${escapeHtml(confirmJs)}">find</button> ` +
    `<button onclick="${escapeHtml(cancelJs)}">cancel</button></div>`
  );
}

/** Share dialog: email + optional note + allow-download toggle.
 *  Bridges {cancelled:true} or {email, note, allowDownload}. */
export function deliverHtml(workTitle: string): string {
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  const sendJs = bridgeSend(
    "JSON.stringify({email:document.getElementById('e').value.trim()," +
      "note:document.getElementById('n').value.trim()," +
      "allowDownload:document.getElementById('d').checked})",
  );
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">pica — share "${escapeHtml(workTitle)}"</div>` +
    `share this work with someone by email. they get a private link (revocable, expires in 30 days).` +
    `<div style="margin-top:10px"><input id="e" placeholder="email address" ` +
    `style="width:100%;box-sizing:border-box;background:#1A1A1A;color:#EDEDED;border:1px solid #333;padding:8px;font:12px ui-monospace,Menlo,monospace"></div>` +
    `<div style="margin-top:10px"><textarea id="n" placeholder="optional message" rows="3" ` +
    `style="width:100%;box-sizing:border-box;background:#1A1A1A;color:#EDEDED;border:1px solid #333;padding:8px;font:12px ui-monospace,Menlo,monospace"></textarea></div>` +
    `<div style="margin-top:10px"><label style="font-size:12px"><input type="checkbox" id="d" checked> allow download of attached audio</label></div>` +
    `<div style="margin-top:12px"><button onclick="${escapeHtml(sendJs)}">share</button> ` +
    `<button onclick="${escapeHtml(cancelJs)}">cancel</button></div>`
  );
}

/** Stem picker: one include/skip row per stem, before the deliver dialog.
 *  Bridges {ids: string[]} (the chosen stem ids) or {cancelled:true}. */
export function shareStemsHtml(stems: StemChoice[]): string {
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  const shareJs = bridgeSend(
    "JSON.stringify({ids:(function(){" +
      "var ids=[];" +
      "document.querySelectorAll('.stem-row').forEach(function(row){" +
      "if(row.querySelector('select').value==='include')ids.push(row.dataset.id);" +
      "});" +
      "return ids;" +
      "}())})",
  );
  const rows = stems
    .map(
      (s) =>
        `<div class="stem-row" data-id="${escapeHtml(s.id)}">` +
        `<select style="background:#1A1A1A;color:#EDEDED;border:1px solid #444;padding:4px;font:12px ui-monospace,Menlo,monospace">` +
        `<option value="include">include</option>` +
        `<option value="skip">skip</option>` +
        `</select>` +
        ` ${escapeHtml(s.label)}` +
        ` <span style="color:#888;font-size:11px">${escapeHtml(s.fileType)}</span>` +
        `</div>`,
    )
    .join("");
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">pica: which stems to share</div>` +
    `${rows}` +
    `<div style="margin-top:12px"><button onclick="${escapeHtml(shareJs)}">share</button> ` +
    `<button onclick="${escapeHtml(cancelJs)}">cancel</button></div>`
  );
}

/** First-external-share confirmation. Bridges {confirmed:true} or {cancelled:true}. */
export function deliverConfirmHtml(email: string): string {
  const yesJs = bridgeSend("JSON.stringify({confirmed:true})");
  const noJs = bridgeSend("JSON.stringify({cancelled:true})");
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">pica — confirm recipient</div>` +
    `first time sharing with ${escapeHtml(email)}. is that address correct?` +
    `<div style="margin-top:12px"><button onclick="${escapeHtml(yesJs)}">yes, send</button> ` +
    `<button onclick="${escapeHtml(noJs)}">cancel</button></div>`
  );
}

/** Duplicate-title choice dialog: add to existing, register a new version
 *  (with a type picker), or cancel. Bridges {action, versionType?}. */
export function duplicateChoiceHtml(title: string, versionTypes: readonly string[]): string {
  const existingJs = bridgeSend("JSON.stringify({action:'existing'})");
  const newVersionJs = bridgeSend(
    "JSON.stringify({action:'newVersion',versionType:document.getElementById('vt').value})",
  );
  const cancelJs = bridgeSend("JSON.stringify({action:'cancel'})");
  const options = versionTypes
    .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
    .join("");
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">pica — already registered</div>` +
    `a work titled "${escapeHtml(title)}" already exists in your catalog.` +
    `<div style="margin-top:14px"><button onclick="${escapeHtml(existingJs)}">add credits to the existing recording</button></div>` +
    `<div style="margin-top:14px">register as a new version: ` +
    `<select id="vt" style="background:#1A1A1A;color:#EDEDED;border:1px solid #333;padding:4px">${options}</select> ` +
    `<button onclick="${escapeHtml(newVersionJs)}">register version</button></div>` +
    `<div style="margin-top:14px"><button onclick="${escapeHtml(cancelJs)}">cancel</button></div>`
  );
}

/** A captured step's honest end-state for the consolidated report. */
export type StepResult<T> =
  | { state: "skipped" }
  | { state: "saved"; outcomes: T[] }
  | { state: "error"; error: string };

export interface RegisterReport {
  action: "registered" | "version" | "existing";
  title: string;
  workId: string;
  recordingId: string;
  masterOwnership?: MasterOwnershipOutcome["status"];
  spliceLogged?: number;
  credits?: StepResult<CreditOutcome>;
  writers?: StepResult<WriterOutcome>;
}

function leadLine(action: RegisterReport["action"], title: string): string {
  const t = `"${title}"`;
  switch (action) {
    case "registered":
      return `the work ${t} and its master recording are now in your catalog.`;
    case "version":
      return `registered ${t} as a new version in your catalog.`;
    case "existing":
      return `updated ${t} in your catalog.`;
  }
}

function ownershipLine(status?: MasterOwnershipOutcome["status"]): string | null {
  switch (status) {
    case "created":
      return "master ownership: your org now owns 100% of this master. refine splits in PICA.";
    case "skipped_existing":
      return "master ownership: already set.";
    case "failed":
      return "master ownership: could not be saved automatically. set it in PICA.";
    default:
      return null;
  }
}

function creditsLine(c?: StepResult<CreditOutcome>): string | null {
  if (!c) return null;
  if (c.state === "skipped") return "credits: skipped.";
  if (c.state === "error") return "credits: could not be saved.";
  return summarizeCredits(c.outcomes);
}

function writersLine(w?: StepResult<WriterOutcome>): string | null {
  if (!w) return null;
  if (w.state === "skipped") return "writers: skipped.";
  if (w.state === "error") return "writers: could not be saved.";
  return summarizeWriters(w.outcomes) || "writers: none added.";
}

/** One link row: friendly anchor + selectable URL span + a copy button. */
function reportLinkRow(label: string, url: string, idx: number): string {
  const safeUrl = escapeHtml(url);
  const id = `u${idx}`;
  return (
    `<div style="margin-top:10px;word-break:break-all">` +
    `<a href="${safeUrl}" target="_blank" style="color:#B87333">${escapeHtml(label)}</a> ` +
    `<span id="${id}" style="color:#888">${safeUrl}</span> ` +
    `<button onclick="${escapeHtml(copyLinkJs(id))}">copy</button></div>`
  );
}

/** The ONE consolidated report shown at the end of the register flow. */
export function finalReportHtml(report: RegisterReport): string {
  const lines: string[] = [leadLine(report.action, report.title)];
  const own = ownershipLine(report.masterOwnership);
  if (own) lines.push(own);
  const cr = creditsLine(report.credits);
  if (cr) lines.push(cr);
  const wr = writersLine(report.writers);
  if (wr) lines.push(wr);
  if (report.spliceLogged && report.spliceLogged > 0) {
    lines.push(`splice samples: ${report.spliceLogged} logged (royalty-free — no clearance needed).`);
  }
  const links =
    reportLinkRow("view the work", `${BASE_URL}/inspect/works/${report.workId}`, 0) +
    reportLinkRow("view the recording (upload your master here)", `${BASE_URL}/inspect/recordings/${report.recordingId}`, 1) +
    reportLinkRow("open your catalog", `${BASE_URL}/inspect`, 2);
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">pica — registered</div>` +
    `${escapeHtml(lines.join("\n"))}` +
    `<div style="margin-top:14px">${links}</div>` +
    `<div style="margin-top:14px"><button onclick="${bridgeSend("'sendStems'")}">log stems →</button></div>` +
    `<div style="margin-top:8px"><button onclick="${bridgeSend("'deliver'")}">share with →</button></div>` +
    closeButton()
  );
}
