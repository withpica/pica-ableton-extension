// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

/**
 * Pure HTML builders for the extension's modal dialogs (host-independent,
 * unit-testable). The Extensions SDK has no host API to open a browser or
 * write the clipboard, so link affordances live inside the webview: a real
 * anchor (Live may forward it to the system browser), selectable text, and
 * a copy button backed by the webview clipboard with a select-fallback.
 */

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

/** Success dialog body: an unambiguous "it's in PICA" + a non-alarming completeness line. */
export function successBody(
  completenessScore?: number,
  masterOwnership?: "created" | "skipped_existing" | "failed",
): string {
  const lines = ["the work and its master recording are now in your catalog."];
  if (typeof completenessScore === "number") {
    lines.push(
      `completeness ${completenessScore}% — normal for a fresh registration; it grows as you add credits, identifiers and audio.`,
    );
  }
  if (masterOwnership === "created") {
    lines.push(
      "master ownership: your org now owns 100% of this master — refine splits in PICA.",
    );
  } else if (masterOwnership === "skipped_existing") {
    lines.push("master ownership: already set.");
  } else if (masterOwnership === "failed") {
    lines.push(
      "master ownership could not be saved automatically — set it in PICA.",
    );
  }
  return lines.join("\n");
}
