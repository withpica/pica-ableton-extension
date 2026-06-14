# PICA — Register Set (Ableton Live Extension)

Register your Ableton Live Set as a **work + master recording** in [PICA](https://withpica.com) from a right-click — at the moment you make the music, not as admin afterwards.

Right-click a track → **Register Set in PICA** → a confirm panel shows the captured session (tracks, devices, samples, tempo, key). You add a title + artist; it creates one `work` and its master `recording` in your catalog and gives you the link. The full session snapshot is stashed on the work for later enrichment. Nothing is written until you confirm.

This covers **Stages 1–2** of ADR-259 ("PICA inside the DAW"): register-from-Set plus the attribution checklist (per-instrument draft credits). Later stages add bounce/stem upload, sample clearance, and deliver-from-DAW.

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

Right-click a track → **Register Set in PICA**. The confirm panel is editable; a duplicate title offers to open the existing work instead of creating a second. On success you get the work's completeness score and an `/inspect` link.

After a successful register (or when re-running on an already-registered Set), a
credits checklist opens: one row per performed part with the instrument
pre-filled from the track/group name. Type who played each part and save —
credits land on the master recording as `Performer` rows (one per person,
instruments combined), auto-linked to existing people in your org by exact
name match, kept as free-text drafts otherwise. Skipping writes nothing.
Re-running shows what's already saved and never duplicates.

## How it works

- Reads the **whole Set** via `context.application.song` — independent of which track you right-clicked (the SDK has no global/Set menu scope, so the action is offered on tracks).
- Writes over PICA's **MCP JSON-RPC endpoint** (`/api/mcp`): declares identity (`pica_introduce_self`), then `pica_works_create` (with the session snapshot in `metadata`) and `pica_recordings_create`. This instrumented path makes the new work appear **live in PICA's `/inspect` activity rail**.
- **Architecture:** a pure, host-independent core (`src/pica/*`, `src/session/snapshot.ts`) unit-tested with Vitest, plus thin Ableton host glue (`src/extension.ts`, `ui/interface.html`). Run `npm test` to exercise the core without Live.

## License / IP

Copyright © 2024–2026 Withpica Ltd. The extension calls only PICA's public API contract and bundles no Ableton SDK code — you supply the SDK yourself (see Setup).
