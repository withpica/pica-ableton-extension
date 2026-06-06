# PICA — Register Set (Ableton Live Extension)

Register your Ableton Live Set as a **work + master recording** in [PICA](https://withpica.com) from a right-click — at the moment you make the music, not as admin afterwards.

Right-click a track → **Register Set in PICA** → a confirm panel shows the captured session (tracks, devices, samples, tempo, key). You add a title + artist; it creates one `work` and its master `recording` in your catalog and gives you the link. The full session snapshot is stashed on the work for later enrichment. Nothing is written until you confirm.

This is **Stage 1** of ADR-259 ("PICA inside the DAW"). Later stages add per-instrument credits, bounce/stem upload, sample clearance, and deliver-from-DAW.

## Requirements

- **Ableton Live 12.4.5+ Suite** (Beta) with the Extensions SDK enabled — Extensions are Suite-only.
- **Node.js ≥ 24.14.1** (required by the Ableton CLI).
- A **PICA** account with a `write:catalog` API key.

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

### 2. Add your PICA key

Create a `write:catalog` key in PICA → **settings → connection**. Run the extension once (`npm start`); if no key is found it shows a dialog with the exact storage-directory path. Save your key there:

```jsonc
// <storageDirectory>/pica-credentials.json
{ "apiKey": "withpica_live_..." }
```

The key is read from the SDK storage directory and is **never** written into your `.als` Set.

## Develop · build · package

```bash
npm start      # build + run inside Live's Extension Host (dev)
npm test       # unit tests (the host-independent core)
npm run build  # production bundle → dist/extension.js
npm run package  # → dist/pica.ablx
```

Install the packaged extension by dropping `dist/pica.ablx` onto Live's **Extensions** settings page.

## Use

Right-click a track → **Register Set in PICA**. The confirm panel is editable; a duplicate title offers to open the existing work instead of creating a second. On success you get the work's completeness score and an `/inspect` link.

## How it works

- Reads the **whole Set** via `context.application.song` — independent of which track you right-clicked (the SDK has no global/Set menu scope, so the action is offered on tracks).
- Writes over PICA's **MCP JSON-RPC endpoint** (`/api/mcp`): declares identity (`pica_introduce_self`), then `pica_works_create` (with the session snapshot in `metadata`) and `pica_recordings_create`. This instrumented path makes the new work appear **live in PICA's `/inspect` activity rail**.
- **Architecture:** a pure, host-independent core (`src/pica/*`, `src/session/snapshot.ts`) unit-tested with Vitest, plus thin Ableton host glue (`src/extension.ts`, `ui/interface.html`). Run `npm test` to exercise the core without Live.

## License / IP

Copyright © 2024–2026 Withpica Ltd. The extension calls only PICA's public API contract and bundles no Ableton SDK code — you supply the SDK yourself (see Setup).
