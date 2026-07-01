<!-- Copyright (c) 2024-2026 Withpica Ltd. All rights reserved. -->

# ADR-259 — flat in-DAW dialogs — Design

**Date:** 2026-07-01 · **Owner:** Fez
**Repo:** `withpica/pica-ableton-extension` · **Branch:** `feat/adr259-flat-dialogs` (stacked on `feat/adr259-share-stem-picker` / PR #26, which adds `shareStemsHtml`)

## Goal

Give every in-DAW Ableton dialog one shared flat visual language matching PICA's `/inspect` surface and the new web share page (Piece A), so the DAW dialogs and the web app look like one product. Founder-approved the look via a live mockup (`~/Desktop/pica-dialog-mockup.html`, 2026-07-01).

**Level 2 (approved):** shared visual tokens **and** `/inspect`-style layout. **Same flows, same steps, same copy, same behavior.** No dialog is added, removed, merged, or re-ordered; no user-facing string changes except where a label is newly introduced as structure (e.g. an uppercase field-label above an existing input). Purely presentational.

## The problem being fixed

The dialogs are rendered by **two drifted styling systems**:

1. **`src/dialogHtml.ts`** — 10 string-built dialogs sharing a crude inline `BASE_STYLE` (`#0A0A0A` mono + copper headings, but `#1A1A1A`/`#333` inputs, browser-default `<button>`s, ad-hoc spacing).
2. **`ui/*.html`** — 4 static files (`interface.html`, `credits.html`, `writers.html`, `audio.html`), each with its own `<style>` block.

The drift between them is why the dialogs look inconsistent and crude. The fix is one source of truth for the look, applied to both families.

## Approach (approved: A)

**A — one shared style module, restructure each surface's markup to it.**
- New `src/dialogStyles.ts` exports `FLAT_STYLE` (a `<style>…</style>` string with the token set + reusable classes below) and a helper `withFlatStyle(bodyHtml)` that wraps a `<body>` fragment in a full document carrying `FLAT_STYLE`.
- `dialogHtml.ts` builders emit markup using the shared classes, wrapped via `withFlatStyle`.
- `ui/*.html` files: their per-file `<style>` blocks are removed and `FLAT_STYLE` is injected the same way stem/candidate data already is (the extension does `html.replace("</head>", "<style>…</style></head>")` at load — see `extension.ts` audio-picker injection). Each file's markup is restructured to the shared classes.

**Rejected — B: convert `ui/*.html` into `dialogHtml.ts` builders.** Cleaner long-term (one testable TS module, no static HTML), but requires re-porting each file's inline event-handler JS into TS — real regression risk on the register/credits/writers pickers. Deferred to a possible follow-up; not in this spec.

## Token set (`src/dialogStyles.ts` `FLAT_STYLE`)

CSS custom properties + classes, matched to `/inspect` / `components/flat`:

```
--surface #0A0A0A · --ink #EDEDED · --muted rgba(255,255,255,.45)
--faint rgba(255,255,255,.25) · --gridline rgba(255,255,255,.10) · --copper #B87333
```

- Global: `box-sizing:border-box`; `body{margin:0;background:var(--surface);color:var(--ink);font:13px ui-monospace,Menlo,Monaco,monospace}`. Sharp corners everywhere (no border-radius); no glass, no shadow.
- `.h` — copper header, 13px, `padding-bottom:10px;border-bottom:1px solid var(--gridline);margin-bottom:12px`.
- `.hint` — `color:var(--muted);font-size:12px;line-height:1.5`.
- `.label` — `text-transform:uppercase;font-size:11px;letter-spacing:.09em;color:var(--muted);margin:14px 0 5px`.
- `.input,.textarea,.select` — `width:100%;background:var(--surface);border:1px solid var(--gridline);color:var(--ink);padding:8px 9px;font:inherit;outline:none`; `:focus{border-color:var(--copper)}`; `.textarea{resize:none}`.
- `.check` — flex row, 12px muted, `input{accent-color:var(--copper)}`.
- `.divider` — `border-top:1px solid var(--gridline);margin:14px 0`.
- `.actions` — `display:flex;justify-content:flex-end;gap:8px;margin-top:14px`.
- `.btn` — `background:transparent;border:1px solid var(--gridline);color:var(--ink);padding:6px 16px;font:inherit;cursor:pointer`; `:hover{border-color:var(--copper);color:var(--copper)}`.
- `.btn-primary` — `border-color:var(--copper);color:var(--copper)`; `:hover{background:rgba(184,115,51,.12)}`.
- `.row` — picker row: `display:flex;align-items:center;gap:12px;padding:9px 0;border-top:1px solid var(--gridline)`; `:first-of-type{border-top:none}`; `.row .name{flex:1}`; `.row .type{color:var(--faint);font-size:11px;text-transform:uppercase;letter-spacing:.06em}`; `.row .select{width:90px;padding:4px 6px}`.
- `.kv` — report row: `display:flex;padding:6px 0;border-top:1px solid var(--gridline)`; `:first-of-type{border-top:none}`; `.kv .k{width:128px;color:var(--muted);text-transform:uppercase;font-size:11px;letter-spacing:.07em}`; `.kv .v{flex:1;color:var(--ink)}`.
- `.link` — `color:var(--copper);text-decoration:none;word-break:break-all`; `:hover{text-decoration:underline}`.

Copper is reserved for the header, links, and the single primary action only; everything structural is gridline-gray.

## Four archetypes → layout pattern

Every surface maps to exactly one archetype. Copy and fields are unchanged; only the structure/classes change.

- **form** — `.h` header · `.hint` · `.label`+`.input`/`.textarea` per field · optional `.check` · `.divider` · `.actions` (ghost `cancel` + `.btn-primary`). Surfaces: `deliverHtml`, `titlePromptHtml`, `pasteKeyHtml`, `deliverConfirmHtml`, `ui/interface.html` (register: title/artist/type/key).
- **picker** — `.h` · `.hint` · one `.row` per item (`.name` · `.type` · `.select` include/skip, or an `.input` for a per-item label where the current picker has one) · `.divider` · `.actions`. Surfaces: `shareStemsHtml`, `ui/audio.html` (stem upload), `ui/credits.html`, `ui/writers.html`.
- **report** — `.h` · `.hint` · one `.kv` per fact · `.link`(s) · `.divider` · `.actions` (ghost + follow-on `.btn-primary`). Surfaces: `finalReportHtml`, `stemsReportHtml`, `linkMessageHtml`, `messageHtml` (simple message: header + body + close).
- **choice** — `.h` · `.hint` · stacked option buttons (full-width `.btn`, the recommended one `.btn-primary`) · `.divider` · `cancel`. Surface: `duplicateChoiceHtml`.

## Surfaces in scope (14)

`src/dialogHtml.ts` (10): `messageHtml`, `linkMessageHtml`, `stemsReportHtml`, `pasteKeyHtml`, `titlePromptHtml`, `deliverHtml`, `shareStemsHtml`, `deliverConfirmHtml`, `duplicateChoiceHtml`, `finalReportHtml`.
`ui/*.html` (4): `interface.html`, `credits.html`, `writers.html`, `audio.html`.

## Constraints (binding)

- **Fixed-size modals** (`showModalDialog(url, W, H)` — no resize; content scrolls within). Keep the existing per-dialog W/H constants; the flat layout must read well at those sizes (long lists scroll).
- **Raw HTML only** — no framework, no build step for the dialog markup; `FLAT_STYLE` is a plain string. `ui/*.html` remain static files loaded via their existing mechanism.
- **Security unchanged** — every dynamic value keeps its existing `escapeHtml(...)`; the restyle must not drop an escape. The `bridgeSend`/`data-*` posting contract and every element `id`/`name`/`dataset` the JS reads stay byte-identical (the interactive JS is untouched).
- **No behavior/flow/copy change** — same dialogs, same order, same posted payload shapes, same button actions. Lowercase (proper nouns/codes excepted); no em dashes.
- **Copyright header** first line on `src/dialogStyles.ts`.

## Testing

- **Vitest** — extend `__tests__/dialogHtml.test.ts`: assert each restyled builder emits the shared classes and its archetype structure (header `.h`, expected `.label`/`.row`/`.kv`, `.actions` with the right buttons), and — regression-critical — that every existing element `id`/`name`/`data-*` and each `escapeHtml`'d value is still present (so the untouched JS still finds its hooks and nothing is unescaped). Add a test that `FLAT_STYLE` is embedded once per dialog.
- **`ui/*.html`** — not unit-testable (node env never loads them). Verified by the founder visually + by `npm run build` succeeding.
- **Gates:** `npm test` (vitest) green, `npm run typecheck` clean, `npm run build` produces `dist/pica.ablx`; then founder in-Live visual verification of all 14 surfaces (the real proof for the `ui/*.html` four).

## Scope / out

- **In:** `src/dialogStyles.ts` (new) + restyle of all 10 `dialogHtml.ts` builders + all 4 `ui/*.html` to the shared flat classes; vitest; rebuilt `.ablx`.
- **Out:** Approach B (converting `ui/*.html` to TS builders); any flow/step/copy change; the web share page (already flat via Piece A, merged to develop); the Splice/samples or other non-dialog UI.

## Acceptance criteria

1. `src/dialogStyles.ts` exports `FLAT_STYLE` + `withFlatStyle`; all 14 surfaces render from the one token set (no per-file `<style>` blocks remain in `ui/*.html`; no `#1A1A1A`/`#333`/default-button styling remains in `dialogHtml.ts`).
2. Each surface matches its archetype layout from this spec; copper appears only on header/links/primary action.
3. Every interactive dialog still works: all element hooks (`id`/`name`/`data-*`) and `escapeHtml` calls preserved; posted payloads unchanged (vitest-locked for the string dialogs).
4. `npm test` + `npm run typecheck` + `npm run build` all green; founder visual sign-off on all 14 in Live.
