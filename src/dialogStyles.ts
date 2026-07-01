// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.

/**
 * The one flat style system for every in-DAW dialog, matching PICA /inspect.
 * Carries the token vars + reusable classes AND selectors for the classes the
 * ui/*.html inline JS emits (.stem-row/.credit-row/.writer-row/.instrument/.who)
 * so those JS-built rows restyle with no JS change.
 */
export const FLAT_STYLE =
  "<style>" +
  ":root{--surface:#0A0A0A;--ink:#EDEDED;--muted:rgba(255,255,255,.45);" +
  "--faint:rgba(255,255,255,.25);--gridline:rgba(255,255,255,.10);--copper:#B87333}" +
  "*{box-sizing:border-box}" +
  "body{margin:0;background:var(--surface);color:var(--ink);" +
  "font:13px ui-monospace,Menlo,Monaco,monospace;padding:16px 18px;-webkit-user-select:text;user-select:text}" +
  ".h{color:var(--copper);font-size:13px;letter-spacing:.02em;padding-bottom:10px;" +
  "border-bottom:1px solid var(--gridline);margin-bottom:12px}" +
  ".hint{color:var(--muted);font-size:12px;line-height:1.5;white-space:pre-wrap}" +
  ".label{text-transform:uppercase;font-size:11px;letter-spacing:.09em;color:var(--muted);margin:14px 0 5px}" +
  ".input,.textarea,.select,.instrument,.who{width:100%;background:var(--surface);border:1px solid var(--gridline);" +
  "color:var(--ink);padding:8px 9px;font:inherit;outline:none}" +
  ".input:focus,.textarea:focus,.select:focus,.instrument:focus,.who:focus{border-color:var(--copper)}" +
  ".textarea{resize:none}" +
  ".check{display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px;color:var(--muted)}" +
  ".check input{accent-color:var(--copper)}" +
  ".divider{border-top:1px solid var(--gridline);margin:14px 0}" +
  ".actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}" +
  "button{background:transparent;border:1px solid var(--gridline);color:var(--ink);" +
  "padding:6px 16px;font:inherit;cursor:pointer}" +
  "button:hover{border-color:var(--copper);color:var(--copper)}" +
  ".btn-primary,button.primary{border-color:var(--copper);color:var(--copper)}" +
  ".btn-primary:hover,button.primary:hover{background:rgba(184,115,51,.12)}" +
  ".row,.stem-row,.credit-row,.writer-row{display:flex;align-items:center;gap:10px;padding:9px 0;" +
  "border-top:1px solid var(--gridline)}" +
  ".row:first-of-type,.stem-row:first-of-type,.writer-row:first-of-type{border-top:none}" +
  ".row .name{flex:1}.row .type,.type{color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.06em}" +
  ".row .select,.stem-row select{width:96px;padding:4px 6px;flex:none}" +
  ".instrument{flex:none;width:150px}.who{flex:1}" +
  ".children{margin-left:16px;border-left:1px solid var(--gridline);padding-left:10px}" +
  ".kv{display:flex;padding:6px 0;border-top:1px solid var(--gridline)}.kv:first-of-type{border-top:none}" +
  ".kv .k{width:128px;color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.07em}" +
  ".kv .v{flex:1;color:var(--ink)}" +
  "a,.link{color:var(--copper);text-decoration:none;word-break:break-all}a:hover,.link:hover{text-decoration:underline}" +
  "datalist{display:none}" +
  "</style>";

export function withFlatStyle(bodyHtml: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">${FLAT_STYLE}</head>` +
    `<body>${bodyHtml}</body></html>`
  );
}

export function injectFlatStyle(html: string): string {
  if (!html.includes("</head>")) {
    throw new Error("injectFlatStyle: document has no </head>");
  }
  return html.replace("</head>", `${FLAT_STYLE}</head>`);
}
