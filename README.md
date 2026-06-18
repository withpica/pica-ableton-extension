# PICA — Register Set (Ableton Live Extension)

Register your Ableton Live Set as a **work + master recording** in [PICA](https://withpica.com) from a right-click — at the moment you make the music, not as admin afterwards.

Right-click a track → **Register Set in PICA** → a confirm panel shows the captured session (tracks, devices, samples, tempo, key). You add a title + artist; it creates one `work` and its master `recording` in your catalog and gives you the link. The full session snapshot is stashed on the work for later enrichment. Nothing is written until you confirm.

This covers **Stages 1–3** of ADR-259 ("PICA inside the DAW") plus the register-flow refinements that followed: register-from-Set, the attribution checklist (per-instrument draft credits, expandable per group), composition writers, automatic Splice-sample attribution, master-ownership capture, an existing-people typeahead for the artist/credit/writer fields, a single consolidated final report, and uploading audio (stems rendered in-extension; the master via a one-click web upload). A later stage adds deliver-from-DAW.

## Requirements

- **Ableton Live 12.4.5+ beta** with the Extensions SDK. Extensions are
  Suite-gated — but the **unauthorized beta (demo mode) shows them too**, and
  registration never needs to save the Set, so a license is not required for
  testing. (A Standard authorization *hides* the Extensions page.)
- **Node.js ≥ 24.14.1** (required by the Ableton CLI).
- A **PICA** account (the extension mints the `write:catalog` key for you on
  first use — see Connecting to PICA below).

## Setup

### 1. Supply the Ableton Extensions SDK

The Ableton Extensions SDK is a private beta distributed via Centercode and is **not on npm**, so it is not (and cannot be) committed to this repo. Download the SDK package from Centercode and copy these two tarballs into `vendor/`:

```
vendor/ableton-extensions-sdk-1.0.0-beta.0.tgz
vendor/ableton-extensions-cli-1.0.0-beta.0.tgz
```

`package.json` references them via `file:vendor/...`, and `vendor/*.tgz` is gitignored. Then install:

```bash
npm install
```

> If your Centercode download is a newer beta, the filenames/version will differ — update the two `file:vendor/...` paths in `package.json` to match, then `npm install`.

### 2. Connecting to PICA

The first time you run **Register Set in PICA** with no stored key, the extension
opens a Connect window: log in (or create an account) and click **authorize** —
the extension stores a `write:catalog` connection key for you. No file editing.

If the in-app window can't sign you in, click **open in browser instead**, copy
the key shown after you authorize, and paste it into the extension's paste field.

If a stored key has been revoked or expired, a register will detect the 401 and
re-open Connect once to mint a fresh key, then retry automatically.

**Manual fallback (advanced):** write `{ "apiKey": "withpica_live_..." }` to
`<storageDirectory>/pica-credentials.json` yourself.

The key is read from the SDK storage directory and is **never** written into your `.als` Set.

## Develop · build · package

```bash
npm start      # build + run inside Live's Extension Host (dev)
npm test       # unit tests (the host-independent core)
npm run build  # production bundle → dist/extension.js
npm run package  # → dist/pica.ablx
```

Install the packaged extension by dropping `dist/pica.ablx` onto Live's **Extensions** settings page.

> **Restart Live after ANY extension change** (install, remove, re-install, or
> toggling Developer Mode). The 12.4.5 beta's Extension Host restarts on these
> events and can die with "Address already in use" (visible in Log.txt) — the
> context-menu item then silently does nothing until Live is fully quit and
> relaunched. To upgrade an installed extension: remove it on the Extensions
> page, drag the new `.ablx` in, then quit and relaunch Live.

## Use

Right-click a track → **Register Set in PICA**. The confirm panel is editable; a duplicate title offers a choice instead of creating a second work.

**Pick existing people.** The artist field (confirm panel) and the credit/writer name fields show a typeahead of the people already in your catalog — start typing and pick one to link the existing person instead of creating a near-duplicate. Picking is never forced: a genuinely new name still creates a person. (If the catalog can't be reached the fields just fall back to plain text.)

The flow runs the capture steps quietly and ends in **one consolidated final
report** — what was captured (master ownership, credits, writers, Splice
samples, each reported honestly including skips/failures) plus three links to
view it: the **work**, the **recording** (where credits and samples render),
and your **catalog**. The old per-step success popups are gone.

**Registering a new version.** If a Set's title already matches a work in your
catalog, you can either add credits to the existing recording or **register the
Set as a new version** (a new recording under the same work) — pick the version
type (alternate, remix, acoustic, live, cover, alternate master, demo). Any
recording the extension *mints* (a fresh master, or a new version) is claimed
as 100% org master ownership by default — a starting position you refine or
reassign in `/inspect`; adding credits to a pre-existing recording claims nothing.

**Credits checklist.** After register (or when re-running on an already-registered
Set) a checklist opens: one row per performed part, instrument pre-filled from the
track/group name. Tracks inside a Live group can be credited individually
(expand the group) or as the whole group collapsed — never both. Credits land on
the master recording as `Performer` rows (one per person, instruments combined),
linked to the person you pick from the typeahead (or auto-linked by exact name), kept as free-text drafts otherwise.

**Writers + Splice.** A writers step captures composition writers for the work,
and any Splice samples used in the Set are auto-attributed to the recording
(royalty-free, no clearance needed). Every step is skippable and best-effort —
skipping or a failure is reported in the final report, never blocks it, and
re-running never duplicates.

**Send stems / master.** From the final report (or right-click → **Send stems
to PICA** on an already-registered Set), pick which arrangement audio tracks to
upload — each is rendered and filed as a `stem` under the recording, auto-linked.
Rendering is **pre-FX**, so freeze & flatten a track first to capture it as you
hear it. For the **master**, use the "upload your master" link to the recording's
page and drop your exported mixdown there (browser upload, attaches automatically).
Each stem is best-effort and reported individually; files over 800MB are skipped.

## How it works

- Reads the **whole Set** via `context.application.song` — independent of which track you right-clicked (the SDK has no global/Set menu scope, so the action is offered on tracks).
- Writes over PICA's **MCP JSON-RPC endpoint** (`/api/mcp`): declares identity (`pica_introduce_self`), then `pica_register_set` — a single call that creates the work (with the session snapshot in `metadata`), its master recording, and the 100% org-owned master ownership split in one round-trip (collapsing what used to be `pica_works_create` + `pica_recordings_create` + `pica_recording_splits_create`). The capture steps follow — `pica_recording_credits_*` (performer credits), `pica_work_writers_add`, and `pica_recording_samples_add` (Splice). Stems render via the SDK's `renderPreFxAudio` and upload direct-to-storage (`pica_audio_presigned_upload` → HTTP PUT → `pica_audio_complete_upload` → `pica_audio_analyze`). This instrumented path makes the new work appear **live in PICA's `/inspect` activity rail**.
- **Architecture:** a pure, host-independent core (`src/pica/*`, `src/session/snapshot.ts`) unit-tested with Vitest, plus thin Ableton host glue (`src/extension.ts`, `ui/interface.html`). Run `npm test` to exercise the core without Live.

## License / IP

Copyright © 2024–2026 Withpica Ltd. The extension calls only PICA's public API contract and bundles no Ableton SDK code — you supply the SDK yourself (see Setup).
