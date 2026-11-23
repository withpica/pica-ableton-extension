// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

import type { MasterOwnershipOutcome } from "./pica/ownership";
import type { StemChoice } from "./pica/shareStems";
import { summarizeCredits, type CreditOutcome } from "./pica/credits";
import { summarizeWriters, type WriterOutcome } from "./pica/writers";
import { withFlatStyle } from "./dialogStyles";

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


/** Plain message dialog (errors, info without a link). */
export function messageHtml(title: string, body: string): string {
  return withFlatStyle(
    `<div class="h">${escapeHtml(title)}</div>` +
    `<div class="hint">${escapeHtml(body)}</div>` +
    `<div class="actions"><button onclick="${CLOSE_JS}">close</button></div>`,
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
  return withFlatStyle(
    `<div class="h">${escapeHtml(title)}</div>` +
    `<div class="hint">${escapeHtml(body)}</div>` +
    `<div class="hint" style="margin-top:10px;word-break:break-all">` +
    `<a id="u" href="${safeUrl}" target="_blank">${safeUrl}</a></div>` +
    `<div class="actions"><button onclick="${escapeHtml(copyJs)}">copy link</button> ` +
    `<button onclick="${CLOSE_JS}">close</button></div>`,
  );
}

/** Stems-logged completion: result lines + a copy-able PICA link + a
 *  "share with →" follow-on (bridges 'share') + close. */
export function stemsReportHtml(body: string, url: string): string {
  const safeUrl = escapeHtml(url);
  return withFlatStyle(
    `<div class="h">pica / stems logged</div>` +
    `<div class="hint">${escapeHtml(body)}</div>` +
    `<div class="kv" style="margin-top:10px">` +
    `<span class="v"><a id="u" href="${safeUrl}" target="_blank">${safeUrl}</a></span>` +
    `<button onclick="${escapeHtml(copyLinkJs("u"))}" style="margin-left:8px">copy link</button></div>` +
    `<div class="divider"></div>` +
    `<div class="actions">` +
    `<button onclick="${CLOSE_JS}">close</button> ` +
    `<button class="btn-primary" onclick="${bridgeSend("'share'")}">share with →</button>` +
    `</div>`,
  );
}

/** Paste-key dialog: one input + connect/cancel buttons, both bridging via close_and_send. */
export function pasteKeyHtml(connectUrl: string = `${BASE_URL}/connect/ableton`): string {
  const connectJs = bridgeSend(
    "JSON.stringify({apiKey:document.getElementById('k').value.trim()})",
  );
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  // Live's window cannot open a browser itself, so "open pica in my browser"
  // hands back to the extension, which asks the OS to (openBrowser.ts) and
  // then brings this dialog back for the key.
  const openJs = bridgeSend("JSON.stringify({openBrowser:true})");
  const step = (n: number, text: string) =>
    `<div class="step"><span class="n">${n}</span><span>${text}</span></div>`;
  return withFlatStyle(
    `<style>.step{display:flex;gap:10px;align-items:baseline;margin:14px 0 6px;color:var(--ink);font-size:13px;line-height:1.45}` +
    `.step .n{flex:none;width:18px;height:18px;border:1px solid var(--muted);border-radius:50%;text-align:center;font-size:11px;line-height:18px;color:var(--muted)}` +
    `.sub{margin-left:28px}.link{color:var(--muted);font-size:11px;word-break:break-all}</style>` +
    `<div class="h">pica / connect live to your pica account</div>` +
    `<div class="hint">live needs a key from your pica account. it takes three steps:</div>` +
    step(1, "open pica in your browser and sign in.") +
    `<div class="sub actions" style="justify-content:flex-start;margin-top:6px">` +
    `<button class="btn-primary" onclick="${escapeHtml(openJs)}">open pica in my browser</button> ` +
    `<button onclick="${escapeHtml(copyLinkJs("cu"))}">copy link</button></div>` +
    `<div class="sub link">or go to <span id="cu">${escapeHtml(connectUrl)}</span></div>` +
    step(2, "check it shows your account, press <b>authorize</b>, then press <b>copy</b> next to the key it shows you (it starts withpica_live_).") +
    step(3, "come back here and paste the key below.") +
    `<div class="sub"><input class="input" id="k" placeholder="paste your key here"></div>` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(connectJs)}">connect</button></div>`,
  );
}

/**
 * Device sign-in: the code to approve in the browser (ADR-259 device flow).
 *
 * Bridges {open:true} (open the browser on the approve page, then wait),
 * {wait:true} (the person goes there themselves), {paste:true} (fall back to
 * pasting a key) or {cancelled:true}. Copying the code stays in the window.
 */
export function deviceCodeHtml(userCode: string, verificationUri: string): string {
  const send = (o: string) => escapeHtml(bridgeSend(`JSON.stringify(${o})`));
  return withFlatStyle(
    `<style>.code{font-size:30px;letter-spacing:.18em;text-align:center;color:var(--ink);margin:18px 0 6px}` +
    `.center{text-align:center}</style>` +
    `<div class="h">pica / connect live to your pica account</div>` +
    `<div class="hint">open pica in your browser, check it's your account and that it shows this same code, then approve:</div>` +
    `<div class="code" id="uc">${escapeHtml(userCode)}</div>` +
    `<div class="hint center">it's only valid for 10 minutes, and only on this computer.</div>` +
    `<div class="actions" style="justify-content:center;margin-top:16px">` +
    `<button class="btn-primary" onclick="${send("{open:true}")}">open pica in my browser</button> ` +
    `<button onclick="${escapeHtml(copyLinkJs("uc"))}">copy code</button></div>` +
    `<div class="hint center" style="margin-top:8px">or go to ${escapeHtml(verificationUri)} and type the code.</div>` +
    `<div class="divider"></div>` +
    `<div class="actions">` +
    `<button onclick="${send("{cancelled:true}")}">cancel</button> ` +
    `<button onclick="${send("{paste:true}")}">use a key instead</button> ` +
    `<button onclick="${send("{wait:true}")}">i've opened it myself</button></div>`,
  );
}

/**
 * Before a pasted key is saved: the account and catalogue it writes into.
 *
 * A pasted key can come from any browser session, so the founder's own test
 * (2026-10-30) connected Live to a different account than the one they meant,
 * and nothing said so until after it was saved. Bridges 'connect' or
 * 'another'.
 */
export function confirmKeyAccountHtml(destination: string): string {
  return withFlatStyle(
    `<div class="h">pica / is this the right account?</div>` +
    `<div class="hint">this key writes into:</div>` +
    destinationRow(destination) +
    `<div class="hint" style="margin-top:12px">everything you register from live will go into this catalogue.</div>` +
    `<div class="divider"></div>` +
    `<div class="actions">` +
    `<button onclick="${bridgeSend("'another'")}">not me, use another key</button> ` +
    `<button class="btn-primary" onclick="${bridgeSend("'connect'")}">connect</button>` +
    `</div>`,
  );
}

/**
 * The account dialog: who this Live install writes as, and the two ways out
 * of it (ADR-259).
 *
 * Reachable without a failed write, which is the point. Before this, the ONLY
 * triggers for the connect flow were an absent key and a 401 / insufficient
 * scope, so someone validly connected to the WRONG account had no route to it
 * at all. That is what six weeks of renaming pica-credentials.json by hand was
 * working around.
 *
 * Bridges 'switch', 'disconnect', or 'ok'.
 */
export function accountHtml(
  destination: string,
  keyPrefix: string | null,
  connectedSince: string | null,
): string {
  const rows =
    destinationRow(destination) +
    (keyPrefix
      ? `<div class="kv"><span class="k">key</span><span class="v">${escapeHtml(keyPrefix)}</span></div>`
      : "") +
    (connectedSince
      ? `<div class="kv"><span class="k">confirmed</span><span class="v">${escapeHtml(connectedSince)}</span></div>`
      : "");
  return withFlatStyle(
    `<div class="h">pica / account</div>` +
    rows +
    `<div class="hint" style="margin-top:12px">everything you register from this set goes into the catalogue above.</div>` +
    `<div class="divider"></div>` +
    `<div class="actions">` +
    `<button onclick="${CLOSE_JS}">close</button> ` +
    `<button onclick="${bridgeSend("'disconnect'")}">disconnect</button> ` +
    `<button class="btn-primary" onclick="${bridgeSend("'switch'")}">switch account →</button>` +
    `</div>`,
  );
}

/**
 * Disconnect confirmation.
 *
 * States plainly that this forgets the key locally and does NOT revoke it,
 * because a user who believes "disconnect" killed the credential would leave a
 * live key on a machine they have walked away from. The key prefix shown here
 * is byte-identical to the one listed in /settings, so it is the string to
 * match on when revoking for real.
 *
 * Bridges {confirmed:true} or {cancelled:true}.
 */
export function disconnectConfirmHtml(
  destination: string,
  keyPrefix: string | null,
): string {
  const yesJs = bridgeSend("JSON.stringify({confirmed:true})");
  const noJs = bridgeSend("JSON.stringify({cancelled:true})");
  const revokeUrl = `${BASE_URL}/settings?tab=connection`;
  return withFlatStyle(
    `<div class="h">pica / disconnect</div>` +
    `<div class="hint">this forgets the key on this machine. live will ask you to connect again next time you register.</div>` +
    destinationRow(destination) +
    `<div class="hint" style="margin-top:12px">the key itself stays valid at pica until you revoke it. to revoke it, open your connection settings and remove the key${
      keyPrefix ? ` starting ${escapeHtml(keyPrefix)}` : ""
    }:</div>` +
    `<div class="hint" style="margin-top:8px;word-break:break-all">` +
    `<a id="u" href="${escapeHtml(revokeUrl)}" target="_blank">${escapeHtml(revokeUrl)}</a></div>` +
    `<div class="divider"></div>` +
    `<div class="actions"><button onclick="${escapeHtml(noJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(yesJs)}">disconnect</button></div>`,
  );
}

/** One-input prompt: ask for a work title; bridges {title} or {cancelled:true}. */
export function titlePromptHtml(
  subtitle = "type the title of the registered work these stems belong to:",
): string {
  const confirmJs = bridgeSend("JSON.stringify({title:document.getElementById('t').value.trim()})");
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  return withFlatStyle(
    `<div class="h">pica / which work?</div>` +
    `<div class="hint">${escapeHtml(subtitle)}</div>` +
    `<div class="label">work title</div>` +
    `<input class="input" id="t" placeholder="work title">` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(confirmJs)}">find</button></div>`,
  );
}

/**
 * The connected-identity line every about-to-write dialog carries (ADR-259).
 *
 * Rendered as a quiet row rather than a warning: it is the answer to "which
 * catalogue is this going into", which on a shared machine is the difference
 * between filing your work and filing it into whoever connected last.
 */
export function destinationRow(destination: string): string {
  return (
    `<div class="kv"><span class="k">account</span>` +
    `<span class="v">${escapeHtml(destination)}</span></div>`
  );
}

/** Share dialog: email (with the catalogue's known contacts suggested) +
 *  optional note + allow-download toggle, and a "make a link" choice that
 *  emails nobody. Bridges {cancelled:true}, {email, note, allowDownload}, or
 *  {mode:'link', note, allowDownload}. */
export function deliverHtml(
  workTitle: string,
  destination?: string,
  contacts: ReadonlyArray<{ name: string; email: string }> = [],
): string {
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  const sendJs = bridgeSend(
    "JSON.stringify({email:document.getElementById('e').value.trim()," +
      "note:document.getElementById('n').value.trim()," +
      "allowDownload:document.getElementById('d').checked})",
  );
  const linkJs = bridgeSend(
    "JSON.stringify({mode:'link'," +
      "note:document.getElementById('n').value.trim()," +
      "allowDownload:document.getElementById('d').checked})",
  );
  // Known contacts fill the field as "Name <email>" (recipientEmail reads the
  // address back out). Name and address are both in the value because
  // WebKit's datalist matches what is typed against the value only.
  const datalist =
    contacts.length > 0
      ? `<datalist id="contacts">` +
        contacts
          .map((c) => `<option value="${escapeHtml(`${c.name} <${c.email}>`)}"></option>`)
          .join("") +
        `</datalist>`
      : "";
  return withFlatStyle(
    `<div class="h">pica / share "${escapeHtml(workTitle)}"</div>` +
    `<div class="hint">share this work: email it to someone, or make a link to pass on. links last 30 days, and you can turn one off sooner.</div>` +
    (destination ? destinationRow(destination) : "") +
    `<div class="label">recipient</div>` +
    `<input class="input" id="e" placeholder="${contacts.length > 0 ? "name or email address" : "email address"}"` +
    `${contacts.length > 0 ? ' list="contacts" autocomplete="off"' : ""}>` +
    datalist +
    `<div class="label">message (optional)</div>` +
    `<textarea class="textarea" id="n" rows="3" placeholder="add a note"></textarea>` +
    `<label class="check"><input type="checkbox" id="d" checked> allow download of attached audio</label>` +
    `<div class="divider"></div>` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button onclick="${escapeHtml(linkJs)}">just make a link</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(sendJs)}">share</button></div>`,
  );
}

/** Body of the panel shown once a link is made (Piece C): nobody was emailed,
 *  and where to turn the link off. */
export const LINK_MADE_BODY =
  "no one was emailed. anyone with this link can open it for 30 days. " +
  "to turn it off sooner, open the song in pica and press turn off on the link, under sharing.";

/** Added to LINK_MADE_BODY when a typed note could not be put on the link. */
export const LINK_NOTE_NOT_ADDED =
  "your note wasn't added to the link, so its page won't show it. send the note to them yourself with the link.";

/** The link-made panel's text; noteSaved false = a typed note didn't go on. */
export function linkMadeBody(noteSaved?: boolean): string {
  return noteSaved === false ? `${LINK_MADE_BODY} ${LINK_NOTE_NOT_ADDED}` : LINK_MADE_BODY;
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
        `<span class="name">${escapeHtml(s.label)}</span>` +
        `<span class="type">${escapeHtml(s.fileType)}</span>` +
        `<select><option value="include">include</option><option value="skip">skip</option></select>` +
        `</div>`,
    )
    .join("");
  return withFlatStyle(
    `<div class="h">pica / which stems to share</div>` +
    `<div class="hint">choose which stems to include in the share:</div>` +
    `${rows}` +
    `<div class="divider"></div>` +
    `<div class="actions">` +
    `<button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(shareJs)}">share</button>` +
    `</div>`,
  );
}

/** First-external-share confirmation. Bridges {confirmed:true} or {cancelled:true}. */
export function deliverConfirmHtml(email: string): string {
  const yesJs = bridgeSend("JSON.stringify({confirmed:true})");
  const noJs = bridgeSend("JSON.stringify({cancelled:true})");
  return withFlatStyle(
    `<div class="h">pica / confirm recipient</div>` +
    `<div class="hint">first time sharing with ${escapeHtml(email)}. is that address correct?</div>` +
    `<div class="actions"><button onclick="${escapeHtml(noJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(yesJs)}">yes, send</button></div>`,
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
  return withFlatStyle(
    `<div class="h">pica / already registered</div>` +
    `<div class="hint">a work titled &quot;${escapeHtml(title)}&quot; already exists in your catalog.</div>` +
    `<div style="margin-top:14px">` +
    `<button style="width:100%;text-align:left" onclick="${escapeHtml(existingJs)}">add credits to the existing recording</button>` +
    `</div>` +
    `<div class="kv" style="margin-top:10px;align-items:center">` +
    `<select id="vt" class="select" style="width:auto;margin-right:8px">${options}</select>` +
    `<button class="btn-primary" onclick="${escapeHtml(newVersionJs)}">register version</button>` +
    `</div>` +
    `<div class="divider"></div>` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button></div>`,
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
      // The share register writes has no owner (recording_splits holds only
      // a person), so the recording page shows "unknown" (68, 2026-11-23).
      return "master ownership: who owns this master isn't set yet. on the recording page in pica, end the share with no owner, then add the owner.";
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

/** One link row: friendly anchor + selectable URL span + a copy button (flat .kv style). */
function reportLinkRow(label: string, url: string, idx: number): string {
  const safeUrl = escapeHtml(url);
  const id = `u${idx}`;
  return (
    `<div class="kv">` +
    `<span class="k">${escapeHtml(label)}</span>` +
    `<span class="v"><a href="${safeUrl}" target="_blank" class="link"><span id="${id}">${safeUrl}</span></a> ` +
    `<button onclick="${escapeHtml(copyLinkJs(id))}">copy</button></span>` +
    `</div>`
  );
}

/** The ONE consolidated report shown at the end of the register flow. */
export function finalReportHtml(report: RegisterReport): string {
  const kvRows: string[] = [];
  kvRows.push(
    `<div class="kv"><span class="k">status</span><span class="v">${escapeHtml(leadLine(report.action, report.title))}</span></div>`,
  );
  const own = ownershipLine(report.masterOwnership);
  if (own) {
    const colonIdx = own.indexOf(":");
    const k = colonIdx >= 0 ? own.slice(0, colonIdx) : "ownership";
    const v = colonIdx >= 0 ? own.slice(colonIdx + 2) : own;
    kvRows.push(`<div class="kv"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`);
  }
  const cr = creditsLine(report.credits);
  if (cr) {
    const colonIdx = cr.indexOf(":");
    const k = colonIdx >= 0 ? cr.slice(0, colonIdx) : "credits";
    const v = colonIdx >= 0 ? cr.slice(colonIdx + 2) : cr;
    kvRows.push(`<div class="kv"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`);
  }
  const wr = writersLine(report.writers);
  if (wr) {
    const colonIdx = wr.indexOf(":");
    const k = colonIdx >= 0 ? wr.slice(0, colonIdx) : "writers";
    const v = colonIdx >= 0 ? wr.slice(colonIdx + 2) : wr;
    kvRows.push(`<div class="kv"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`);
  }
  if (report.spliceLogged && report.spliceLogged > 0) {
    kvRows.push(
      `<div class="kv"><span class="k">samples</span><span class="v">${report.spliceLogged} logged (royalty-free, no clearance needed).</span></div>`,
    );
  }
  const links =
    // The master is uploaded from the song page's audio step, which files it
    // as the master of the song's recording; the recording page showed no
    // upload for it (founder smoke 2026-11-23).
    reportLinkRow("view the work (upload your master in its audio step)", `${BASE_URL}/inspect/works/${report.workId}`, 0) +
    reportLinkRow("view the recording", `${BASE_URL}/inspect/recordings/${report.recordingId}`, 1) +
    reportLinkRow("open your catalog", `${BASE_URL}/inspect`, 2);
  return withFlatStyle(
    `<div class="h">pica / registered</div>` +
    kvRows.join("") +
    links +
    `<div class="divider"></div>` +
    `<div class="actions">` +
    `<button onclick="${CLOSE_JS}">close</button> ` +
    `<button onclick="${bridgeSend("'sendStems'")}">log stems →</button> ` +
    `<button class="btn-primary" onclick="${bridgeSend("'deliver'")}">share with →</button>` +
    `</div>`,
  );
}

// ---------------------------------------------------------------------------
// Import from PICA (ADR-259)
// ---------------------------------------------------------------------------

/**
 * Which song: a plain field, nothing suggested until PICA is searched with
 * what was typed. `notice` says why it is asked again (no match). Shared by
 * import and share. Bridges {value} or {cancelled:true}.
 */
export function songSearchHtml(heading: string, hint: string, notice = "", value = ""): string {
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  const findJs = bridgeSend("JSON.stringify({value:document.getElementById('w').value.trim()})");
  return withFlatStyle(
    `<div class="h">${escapeHtml(heading)}</div>` +
    `<div class="hint">${escapeHtml(hint)}</div>` +
    (notice ? `<div class="hint">${escapeHtml(notice)}</div>` : "") +
    `<div class="label">song</div>` +
    `<input class="input" id="w" autocomplete="off" value="${escapeHtml(value)}" placeholder="part of the title, or the artist">` +
    `<div class="divider"></div>` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(findJs)}">find</button></div>`,
  );
}

/** The songs a search found, the first chosen. Bridges {id}, {again:true} or {cancelled:true}. */
export function songPickHtml(heading: string, query: string, labels: ReadonlyArray<{ id: string; label: string }>): string {
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  const againJs = bridgeSend("JSON.stringify({again:true})");
  const nextJs = bridgeSend(
    "JSON.stringify({id:(document.querySelector('input[name=s]:checked')||{}).value||''})",
  );
  const rows = labels
    .map(
      (w, i) =>
        `<label class="check"><input type="radio" name="s" value="${escapeHtml(w.id)}"${i === 0 ? " checked" : ""}> ` +
        `${escapeHtml(w.label)}</label>`,
    )
    .join("");
  return withFlatStyle(
    `<div class="h">${escapeHtml(heading)}</div>` +
    `<div class="hint">songs in your catalogue matching "${escapeHtml(query)}":</div>` +
    rows +
    `<div class="divider"></div>` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button onclick="${escapeHtml(againJs)}">search again</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(nextJs)}">next</button></div>`,
  );
}

/**
 * After the register panel: the people PICA found for the typed artist name,
 * or a new person by that name. A match whose name is the typed one, accents
 * and case aside, is chosen first; otherwise "a new person". Bridges {id}
 * ("" = a new person) or {cancelled:true}.
 */
export function artistPickHtml(
  typed: string,
  matches: ReadonlyArray<{ id: string; label: string; same: boolean }>,
): string {
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  const nextJs = bridgeSend(
    "JSON.stringify({id:(document.querySelector('input[name=a]:checked')||{value:''}).value})",
  );
  const sameIdx = matches.findIndex((m) => m.same);
  const rows =
    matches
      .map(
        (m, i) =>
          `<label class="check"><input type="radio" name="a" value="${escapeHtml(m.id)}"${i === sameIdx ? " checked" : ""}> ` +
          `${escapeHtml(m.label)}</label>`,
      )
      .join("") +
    `<label class="check"><input type="radio" name="a" value=""${sameIdx < 0 ? " checked" : ""}> ` +
    `a new person named "${escapeHtml(typed)}"</label>`;
  return withFlatStyle(
    `<div class="h">pica / which artist?</div>` +
    `<div class="hint">people in your catalogue matching "${escapeHtml(typed)}":</div>` +
    rows +
    `<div class="divider"></div>` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(nextJs)}">next</button></div>`,
  );
}

/** Which recording, when a song has more than one. Bridges {id} or {cancelled:true}. */
export function importRecordingHtml(
  songTitle: string,
  recordings: ReadonlyArray<{ id: string; title: string; versionType: string }>,
): string {
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  const nextJs = bridgeSend(
    "JSON.stringify({id:(document.querySelector('input[name=r]:checked')||{}).value||''})",
  );
  const rows = recordings
    .map(
      (r, i) =>
        `<label class="check"><input type="radio" name="r" value="${escapeHtml(r.id)}"${i === 0 ? " checked" : ""}> ` +
        `${escapeHtml(r.title)}${r.versionType ? ` <span class="type">${escapeHtml(r.versionType)}</span>` : ""}</label>`,
    )
    .join("");
  return withFlatStyle(
    `<div class="h">pica / which recording of "${escapeHtml(songTitle)}"</div>` +
    rows +
    `<div class="divider"></div>` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(nextJs)}">next</button></div>`,
  );
}

/** Which files: every stem ticked, the master unticked, each with its length.
 *  Bridges {ids, prefix} or {cancelled:true}. */
export function importFilesHtml(
  songTitle: string,
  files: ReadonlyArray<{ id: string; label: string; length: string; master: boolean }>,
): string {
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  const importJs = bridgeSend(
    "JSON.stringify({ids:Array.prototype.map.call(document.querySelectorAll('input[name=f]:checked'),function(c){return c.value})," +
      "prefix:document.getElementById('p').checked})",
  );
  const rows = files
    .map(
      (f) =>
        `<label class="check"><input type="checkbox" name="f" value="${escapeHtml(f.id)}"${f.master ? "" : " checked"}> ` +
        `${escapeHtml(f.label)}${f.master ? " (master)" : ""}` +
        `${f.length ? ` <span class="type">${escapeHtml(f.length)}</span>` : ""}</label>`,
    )
    .join("");
  return withFlatStyle(
    `<div class="h">pica / import "${escapeHtml(songTitle)}"</div>` +
    `<div class="hint">each file goes on its own new track, all starting at bar 1.</div>` +
    rows +
    `<div class="divider"></div>` +
    `<label class="check"><input type="checkbox" id="p"> start each track name with the song title</label>` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(importJs)}">import</button></div>`,
  );
}

/** The tempo question, asked only when the song and the set differ.
 *  Bridges {tempo:'song'|'session'} or {cancelled:true}. */
export function importTempoHtml(songBpm: number, source: "session" | "measured", sessionBpm: number): string {
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  const nextJs = bridgeSend(
    "JSON.stringify({tempo:(document.querySelector('input[name=t]:checked')||{}).value||'song'})",
  );
  const from = source === "session" ? "from the session it was made in" : "measured from the audio";
  return withFlatStyle(
    `<div class="h">pica / tempo</div>` +
    `<div class="hint">the song is ${escapeHtml(fmtBpm(songBpm))} bpm (${from}). this set is ${escapeHtml(fmtBpm(sessionBpm))} bpm.</div>` +
    `<label class="check"><input type="radio" name="t" value="song" checked> use the song's tempo (${escapeHtml(fmtBpm(songBpm))} bpm). the stems play exactly as recorded.</label>` +
    `<label class="check"><input type="radio" name="t" value="session"> keep this set's tempo (${escapeHtml(fmtBpm(sessionBpm))} bpm) and stretch the stems. stretching may not sound perfect.</label>` +
    `<div class="divider"></div>` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(nextJs)}">import</button></div>`,
  );
}

function fmtBpm(bpm: number): string {
  return Number.isInteger(bpm) ? String(bpm) : bpm.toFixed(1);
}

/** The end of an import: one line per file, the tempo and key lines, and the
 *  link back to the song in PICA. */
export function importReportHtml(lines: readonly string[], songUrl: string): string {
  const safeUrl = escapeHtml(songUrl);
  return withFlatStyle(
    `<div class="h">pica / imported</div>` +
    lines.map((l) => `<div class="hint">${escapeHtml(l)}</div>`).join("") +
    `<div class="label" style="margin-top:12px">credits on this song</div>` +
    `<div class="kv"><span class="v"><a id="u" href="${safeUrl}" target="_blank">${safeUrl}</a></span>` +
    `<button onclick="${escapeHtml(copyLinkJs("u"))}" style="margin-left:8px">copy link</button></div>` +
    `<div class="divider"></div>` +
    `<div class="actions"><button onclick="${CLOSE_JS}">close</button></div>`,
  );
}
