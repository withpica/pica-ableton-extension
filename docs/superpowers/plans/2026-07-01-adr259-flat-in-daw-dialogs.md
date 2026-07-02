<!-- Copyright (c) 2024-2026 Withpica Ltd. All rights reserved. -->

# ADR-259 flat in-DAW dialogs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give all 14 in-DAW Ableton dialogs one shared flat visual language (matching `/inspect` + the web share page) via a single `src/dialogStyles.ts`, with zero behavior/flow/copy changes.

**Architecture:** New `src/dialogStyles.ts` exports `FLAT_STYLE` (a `<style>` string carrying the token set + reusable classes AND selectors for the existing JS-built row classes), plus `withFlatStyle(body)` (wraps a string dialog's body in a full doc) and `injectFlatStyle(html)` (splices `FLAT_STYLE` into a `ui/*.html` document). The 10 `dialogHtml.ts` builders emit shared-class markup via `withFlatStyle`; the 4 `ui/*.html` files drop their own `<style>` blocks and receive `FLAT_STYLE` via `injectFlatStyle` at load — their inline JS (row builders, datalists, event handlers) is untouched because `FLAT_STYLE` styles the classes that JS already emits.

**Tech Stack:** TypeScript, **Vitest** (`npm test`), `npm run typecheck`, `npm run build` → `dist/pica.ablx`. Raw HTML strings; no framework.

## Global Constraints

- **Repo:** `/Users/fez/pica-ableton-extension`, branch `feat/adr259-flat-dialogs` (stacked on `feat/adr259-share-stem-picker`). Confirm `git branch --show-current` before editing.
- **Purely presentational.** No dialog added/removed/merged/reordered. Every element `id`, `class` the JS reads (`.stem-row`, `.credit-row`, `.writer-row`, `.instrument`, `.who`, `.children`), `data-*`, `datalist`, `name`, every `escapeHtml(...)` call, and every `bridgeSend(...)` payload stays byte-identical. Only visual markup + styles change.
- **Vitest is transpile-only** → ALSO run `npm run typecheck` (use `arr[0]!` for indexed access). Every new `.ts` first line: `// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.`
- **Lowercase** (proper nouns/codes excepted); **NO em dashes** (this includes fixing the existing em dash in `finalReportHtml`).
- **Fixed-size modals** — keep existing W/H constants; long lists scroll.
- Token values (verbatim from the approved mockup): surface `#0A0A0A`, ink `#EDEDED`, muted `rgba(255,255,255,.45)`, faint `rgba(255,255,255,.25)`, gridline `rgba(255,255,255,.10)`, copper `#B87333`. Sharp corners, no glass/shadow. Copper only on header/links/primary.

---

## Task 1: `src/dialogStyles.ts` — the shared style module

**Files:** Create `src/dialogStyles.ts`; Test `__tests__/dialogStyles.test.ts`.

**Interfaces — Produces (consumed by Tasks 2-4):**
- `FLAT_STYLE: string` — a `<style>…</style>` block.
- `withFlatStyle(bodyHtml: string): string` — returns a full `<!doctype html>` doc with `FLAT_STYLE` in the head and `bodyHtml` inside `<body>`.
- `injectFlatStyle(html: string): string` — returns `html` with `<style>${FLAT_STYLE}</style>` inserted before `</head>` (throws if no `</head>`).

- [ ] **Step 1: Write the failing test** (`__tests__/dialogStyles.test.ts`)
```ts
// Copyright (c) 2024-2026 Withpica Ltd. All rights reserved.
import { describe, it, expect } from "vitest";
import { FLAT_STYLE, withFlatStyle, injectFlatStyle } from "../src/dialogStyles";

describe("FLAT_STYLE", () => {
  it("is a style block carrying the token vars and core + row classes", () => {
    expect(FLAT_STYLE).toContain("<style>");
    expect(FLAT_STYLE).toContain("--copper:#B87333");
    expect(FLAT_STYLE).toContain("#0A0A0A");
    for (const cls of [".h", ".hint", ".label", ".input", ".textarea", ".select", ".btn", ".btn-primary", ".divider", ".actions", ".row", ".kv", ".link",
      ".stem-row", ".credit-row", ".writer-row", ".instrument", ".who"]) {
      expect(FLAT_STYLE).toContain(cls);
    }
    expect(FLAT_STYLE).not.toContain("border-radius");
  });
});
describe("withFlatStyle", () => {
  it("wraps body content in a doc that includes FLAT_STYLE once", () => {
    const out = withFlatStyle(`<div class="h">hi</div>`);
    expect(out).toContain("<!doctype html>");
    expect(out).toContain(FLAT_STYLE);
    expect(out).toContain(`<div class="h">hi</div>`);
    expect(out.match(/<style>/g)?.length).toBe(1);
  });
});
describe("injectFlatStyle", () => {
  it("splices FLAT_STYLE before </head>", () => {
    const out = injectFlatStyle("<html><head><title>x</title></head><body>y</body></html>");
    expect(out).toContain(`<title>x</title><style>`);
    expect(out.indexOf("<style>")).toBeLessThan(out.indexOf("</head>"));
  });
  it("throws when there is no </head>", () => {
    expect(() => injectFlatStyle("<html><body>y</body></html>")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- dialogStyles` → FAIL (module missing).

- [ ] **Step 3: Implement `src/dialogStyles.ts`**
```ts
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
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- dialogStyles` PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `git add src/dialogStyles.ts __tests__/dialogStyles.test.ts && git commit -m "feat(dialogs): shared flat style module (FLAT_STYLE + withFlatStyle + injectFlatStyle)"`

---

## Task 2: `dialogHtml.ts` — form + message dialogs

**Files:** Modify `src/dialogHtml.ts`; Test `__tests__/dialogHtml.test.ts` (extend).
**Interfaces — Consumes:** `withFlatStyle`, `escapeHtml` (Task 1 / existing).

Restyle these SIX builders to use `withFlatStyle` + the flat classes, **preserving every id/payload**: `messageHtml` (`#`close), `linkMessageHtml` (`#u`, copyJs, close), `pasteKeyHtml` (`#k`→connect `{apiKey}`, cancel), `titlePromptHtml` (`#t`→find `{title}`, cancel), `deliverHtml` (`#e`/`#n`/`#d`→share `{email,note,allowDownload}`, cancel), `deliverConfirmHtml` (yes `{confirmed}`, cancel).

Remove the module-level `BASE_STYLE` const and the `closeButton()` inline-styled helper; replace `closeButton()` with a shared `<div class="actions"><button onclick="${CLOSE_JS}">close</button></div>` (keep `CLOSE_JS`).

- [ ] **Step 1: Extend the failing test** — add to `__tests__/dialogHtml.test.ts` (reuse the file's existing imports/style):
```ts
import { withFlatStyle } from "../src/dialogStyles";
// ...
describe("flat form dialogs", () => {
  it("deliverHtml is flat + keeps its field ids and share payload", () => {
    const h = deliverHtml('a "b" work');
    expect(h).toContain(FLAT_STYLE_MARKER); // = a string only present via withFlatStyle, e.g. "--copper:#B87333"
    expect(h).toContain('class="h"');
    expect(h).toContain('id="e"'); expect(h).toContain('id="n"'); expect(h).toContain('id="d"');
    expect(h).toContain("document.getElementById('e').value.trim()");
    expect(h).toContain("allowDownload:document.getElementById('d').checked");
    expect(h).toContain("&quot;b&quot;");           // escaped title preserved
    expect(h).not.toContain("#1A1A1A");             // old crude input style gone
  });
  it("pasteKeyHtml keeps #k + apiKey payload", () => {
    const h = pasteKeyHtml();
    expect(h).toContain('id="k"');
    expect(h).toContain("apiKey:document.getElementById('k').value.trim()");
  });
  it("titlePromptHtml keeps #t + title payload", () => {
    expect(titlePromptHtml()).toContain("title:document.getElementById('t').value.trim()");
  });
  it("linkMessageHtml keeps the #u anchor + copy", () => {
    const h = linkMessageHtml("t", "b", "https://x/y");
    expect(h).toContain('id="u"'); expect(h).toContain("https://x/y");
  });
});
```
(Define `FLAT_STYLE_MARKER = "--copper:#B87333"` at the top of the describe, or assert `.toContain("--copper:#B87333")` directly.)

- [ ] **Step 2: Run to verify it fails** — `npm test -- dialogHtml` → FAIL.

- [ ] **Step 3: Implement** — rewrite the six builders. Example (`deliverHtml`), full:
```ts
export function deliverHtml(workTitle: string): string {
  const cancelJs = bridgeSend("JSON.stringify({cancelled:true})");
  const sendJs = bridgeSend(
    "JSON.stringify({email:document.getElementById('e').value.trim()," +
      "note:document.getElementById('n').value.trim()," +
      "allowDownload:document.getElementById('d').checked})",
  );
  return withFlatStyle(
    `<div class="h">pica / share "${escapeHtml(workTitle)}"</div>` +
    `<div class="hint">share this work with someone by email. they get a private link, revocable, expires in 30 days.</div>` +
    `<div class="label">recipient</div>` +
    `<input class="input" id="e" placeholder="email address">` +
    `<div class="label">message (optional)</div>` +
    `<textarea class="textarea" id="n" rows="3" placeholder="add a note"></textarea>` +
    `<label class="check"><input type="checkbox" id="d" checked> allow download of attached audio</label>` +
    `<div class="divider"></div>` +
    `<div class="actions"><button onclick="${escapeHtml(cancelJs)}">cancel</button> ` +
    `<button class="btn-primary" onclick="${escapeHtml(sendJs)}">share</button></div>`,
  );
}
```
Apply the same treatment to the other five (header→`.h`, description→`.hint`, each labeled input→`.label`+`.input`/`.textarea`, buttons→`.actions` with the primary getting `class="btn-primary"`; `messageHtml` = `.h` + `.hint` body + close; `deliverConfirmHtml` = `.h` + `.hint` + actions with `yes, send` primary; `linkMessageHtml` keeps its `<a id="u">` inside a `.hint`/link block + copy/close in `.actions`). Do NOT change any `id`, the `bridgeSend` payload strings, or any `escapeHtml` call. Delete `BASE_STYLE`; keep `CLOSE_JS`, `copyLinkJs`, `bridgeSend`, `escapeHtml`.

- [ ] **Step 4: Run to verify it passes** — `npm test -- dialogHtml` PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — stage `src/dialogHtml.ts __tests__/dialogHtml.test.ts`; `git commit -m "feat(dialogs): flat restyle of form + message dialogs (ids/payloads preserved)"`

---

## Task 3: `dialogHtml.ts` — picker + report + choice dialogs

**Files:** Modify `src/dialogHtml.ts`; Test `__tests__/dialogHtml.test.ts` (extend).

Restyle FOUR builders, preserving hooks: `shareStemsHtml` (`.stem-row`/`data-id`/`select` include-skip → `{ids}`), `stemsReportHtml` (`#u`, copy, `bridgeSend('share')`, close), `finalReportHtml` (`#u0/#u1/#u2` copy rows, `bridgeSend('sendStems')`, `bridgeSend('deliver')`, close), `duplicateChoiceHtml` (`#vt` select, `existing`/`newVersion`/`cancel`).

- [ ] **Step 1: Extend the failing test**
```ts
describe("flat picker/report/choice dialogs", () => {
  it("shareStemsHtml keeps .stem-row/data-id/select include payload, adds flat header", () => {
    const h = shareStemsHtml([{ id: "a", label: "drums", fileType: "stem" }]);
    expect(h).toContain("--copper:#B87333");
    expect(h).toContain('class="h"');
    expect(h).toContain('class="stem-row" data-id="a"');
    expect(h).toContain("row.querySelector('select').value==='include'");
  });
  it("finalReportHtml keeps the 3 copy link ids + follow-on payloads + no em dash", () => {
    const h = finalReportHtml({ action: "registered", title: "T", workId: "w", recordingId: "r", spliceLogged: 1 });
    expect(h).toContain('id="u0"'); expect(h).toContain('id="u1"'); expect(h).toContain('id="u2"');
    expect(h).toContain("'sendStems'"); expect(h).toContain("'deliver'");
    expect(h).not.toContain("—"); // em dash removed (royalty-free, no clearance needed)
  });
  it("duplicateChoiceHtml keeps #vt + the three actions", () => {
    const h = duplicateChoiceHtml("T", ["remix", "edit"]);
    expect(h).toContain('id="vt"');
    expect(h).toContain("action:'existing'"); expect(h).toContain("action:'newVersion'"); expect(h).toContain("action:'cancel'");
  });
  it("stemsReportHtml keeps #u + share follow-on", () => {
    const h = stemsReportHtml("body", "https://x/y");
    expect(h).toContain('id="u"'); expect(h).toContain("'share'");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- dialogHtml` → FAIL.

- [ ] **Step 3: Implement** — rewrite the four via `withFlatStyle`. Key structures:
  - `shareStemsHtml`: `.h` header "pica / which stems to share" + `.hint` + the rows (KEEP `class="stem-row" data-id` and the inner `<select>`; the flat `.stem-row`/`select` styling comes from FLAT_STYLE — just structure each row as `<div class="stem-row" data-id="…"><span class="name">label</span><span class="type">fileType</span><select>…</select></div>`, preserving the `.querySelectorAll('.stem-row')…select.value==='include'` contract) + `.divider` + `.actions` (cancel + `btn-primary` share). KEEP the exact `shareJs` payload string.
  - `stemsReportHtml`: `.h` "pica / stems logged" + `.hint` body + a `.kv`-style link block with `<a id="u">` + copy button, `.divider`, `.actions` with `share with →` as `btn-primary` + close. KEEP `#u`, `copyLinkJs("u")`, `bridgeSend('share')`.
  - `finalReportHtml`: `.h` "pica / registered" + `.hint` lead + one `.kv` per line (ownership/credits/writers/samples) instead of the `\n`-joined block (keep the same text, split into rows) + the three `reportLinkRow`s (keep `#u0/#u1/#u2` + copy) + `.divider` + `.actions` (`log stems →`, `share with →` as `btn-primary`, close). **Fix the em dash**: change "royalty-free — no clearance needed" to "royalty-free, no clearance needed". Update `reportLinkRow` to emit flat `.kv`/`.link` markup (keep the `#u{idx}` span + copy button + `escapeHtml`).
  - `duplicateChoiceHtml`: `.h` "pica / already registered" + `.hint` + stacked full-width option buttons ("add credits to the existing recording" = plain `.btn`; a row with the `#vt` select + "register version" = `btn-primary`) + `.divider` + cancel. KEEP `#vt`, the three payloads.

  Do NOT alter any `id`, `data-id`, `bridgeSend`/action payload, `escapeHtml`, or `copyLinkJs` call.

- [ ] **Step 4: Run to verify it passes** — `npm test -- dialogHtml` (all form + picker/report tests) PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(dialogs): flat restyle of picker/report/choice dialogs; drop em dash in report"`

---

## Task 4: `ui/*.html` restyle + `FLAT_STYLE` injection + build

**Files:** Modify `ui/audio.html`, `ui/interface.html`, `ui/credits.html`, `ui/writers.html`; Modify `src/extension.ts` (the 4 loaders that read these files); Test `__tests__/dialogStyles.test.ts` (extend for injection wiring where feasible).

**Interfaces — Consumes:** `injectFlatStyle` (Task 1).

For EACH of the four html files:
1. **Delete its `<style>…</style>` block.** (Its structural markup stays; the classes it uses — headers, `.note`/`.hint`, `.primary` buttons, and the JS-built `.stem-row`/`.credit-row`/`.writer-row`/`.instrument`/`.who` — are now styled by `FLAT_STYLE`.)
2. **Tidy the static markup to the flat classes** WITHOUT touching any element the JS reads: wrap the title line in `class="h"`, hint/note lines in `class="hint"`, and leave every `id=` (`#summary`/`#title`/`#artist`/`#people`/`#workType`/`#key`/`#err`/`#rows`/`#add`/`#skip`/`#save`/`#cancel`/`#register`/`#masterlink`/`#hint`) exactly as-is. Put the action buttons in a `<div class="actions">…</div>` and give the primary button `class="primary"` (already present) — do not rename ids. Add `class="label"` above the register form's inputs in `interface.html` (title/artist/type/key) for the /inspect look; the input ids are unchanged. Do NOT edit any `<script>`.
3. In `src/extension.ts`, find where this file's HTML is loaded (it is read then `.replace("</head>", "<script>window.__PICA_*__=…</script></head>")` before becoming a `data:text/html,` URL). **Wrap the loaded html with `injectFlatStyle(...)`** (import it from `./dialogStyles`) so `FLAT_STYLE` is spliced in — order does not matter relative to the `__PICA_*__` script as long as both land before `</head>`. Every `window.__PICA_STEMS__`/`__PICA_PREFILL__`/`__PICA_PEOPLE_NAMES__` injection and every `showModalDialog(...)` call stays unchanged.

- [ ] **Step 1: Apply the four html edits + the four `injectFlatStyle` wrappings.** (No new failing unit test drives the html — node env never loads them; the proof is typecheck + build + founder visual. Where a loader is a pure helper you can import, add a light assertion that its output contains `--copper:#B87333`; otherwise skip.)
- [ ] **Step 2: Typecheck + build**
```
npm run typecheck            # clean
npm test                     # full vitest suite still green (dialogStyles + dialogHtml + existing)
npm run build && npm run package   # build succeeds; produces dist/pica.ablx
```
- [ ] **Step 3: Grep-verify no crude styles or lost hooks remain**
```
grep -rn "#1A1A1A\|#333\|<style" ui/ src/dialogHtml.ts   # expect: no matches (all <style> gone, no crude inputs)
grep -rn "id=\"title\"\|id=\"rows\"\|id=\"vt\"\|__PICA_" ui/ | head   # hooks still present
```
- [ ] **Step 4: Commit** — stage the 4 html files + `src/extension.ts` (+ any test); `git commit -m "feat(dialogs): flat restyle ui/*.html via injected FLAT_STYLE; drop per-file styles"`

---

## Task 5: Whole-set verify + handoff

- [ ] **Step 1:** `npm test` (all green) + `npm run typecheck` (clean) + `npm run package` (fresh `dist/pica.ablx`).
- [ ] **Step 2: Founder visual verification (the real proof for the 4 `ui/*.html`).** Install the rebuilt `.ablx` in Live and open each of the 14 surfaces (register panel, credits, writers, stem-upload picker, share-stems picker, deliver, share-confirm, stems-report, final report, duplicate choice, paste-key, title prompt, link message, plain message). Confirm each is flat (`#0A0A0A`, gridlines, mono, copper only on header/links/primary), each interactive dialog still works end to end (register, credits save, writers save, stems upload, share), and no dialog lost a field or button. Founder-gated.
- [ ] **Step 3: Finish** — `superpowers:finishing-a-development-branch` → PR `feat/adr259-flat-dialogs` → (extension `main`, after / alongside the stem-picker PR #26). Release via GitHub Release when the founder is ready.

---

## Self-Review (completed)

**Spec coverage:** shared token module → Task 1. Approach A (inject into both families) → Task 1 helpers + Task 4 wiring. All 14 surfaces → Task 2 (6 form/msg), Task 3 (4 picker/report/choice), Task 4 (4 html). Archetype patterns → Tasks 2-4. Security/hooks preservation → each task's "keep every id/payload/escape" + the vitest hook assertions + Task 4 grep. No em dashes → Task 3 (report line). Testing (vitest for string dialogs, visual for html) → Tasks 2-3 tests + Task 5 founder verify.

**Placeholder scan:** Full code given for Task 1 and the representative `deliverHtml`; the other string dialogs are described field-by-field with their exact ids/payloads to preserve (the originals are short and in `src/dialogHtml.ts`). Task 4 html edits are structural with an explicit preserve-list rather than full transcription because the inline JS must stay byte-identical and `FLAT_STYLE` carries the row styling — full-file rewrites would risk the JS. No "TBD"/"handle edge cases".

**Type/name consistency:** `FLAT_STYLE`/`withFlatStyle`/`injectFlatStyle` defined in Task 1, consumed verbatim in Tasks 2-4. Class names (`.h`/`.hint`/`.label`/`.input`/`.textarea`/`.check`/`.divider`/`.actions`/`.btn-primary`/`.stem-row`/`.credit-row`/`.writer-row`/`.instrument`/`.who`/`.kv`/`.link`) identical between the FLAT_STYLE definition (Task 1) and every consumer. Preserved hooks (`#e`/`#n`/`#d`/`#k`/`#t`/`#u`/`#u0-2`/`#vt`/`.stem-row`/`data-id`/`#title`/`#rows`/`__PICA_*`) match the current `dialogHtml.ts` + `ui/*.html` source.
