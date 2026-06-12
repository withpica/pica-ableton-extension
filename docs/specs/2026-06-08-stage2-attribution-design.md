# ADR-259 Stage 2 — Attribution → Credits (design)

**Status:** Reviewed & approved (2026-06-12) — founder decisions locked, open items resolved against the live PICA schema/tools (see "Resolved at review"); implementation plan not yet written. Stage 1 in-Live smoke test passed 2026-06-12; its field findings are folded in below.
**Context:** Stage 2 of ADR-259 ("PICA inside the DAW"). Stage 1 (register-from-Set) is built and shipped (this repo + the `pica_works_create` `metadata` param, PICA PR #909). This spec covers turning the registered Set's *parts* into *credits*. ADR-259 lives on the PICA `feature/adr-256-agent-governance` branch; the Stage-1 plan is at `docs/superpowers/plans/2026-06-06-adr-259-ableton-extension-stage1.md` in the PICA repo.

## Goal

After a Set is registered, let the producer attribute each performed part to a person with near-zero friction: the extension **notices the parts** (reading the session structure — no audio, no listening), **pre-fills the instrument**, and **asks who played each**. Names are written as **draft credits** on the master recording, **auto-linked** to existing people where they match. Offered after register, skippable, re-runnable.

The honest core: the tool does the *noticing*; the human does the *naming*. It never invents a person and never blocks the save.

## Decisions (from brainstorming)

1. **Surface — layered.** The extension does a deterministic checklist as the baseline (no AI, no MCP host). An AI-assistant flow is a documented fast-follow for the messy rows; **not v1 code**, but v1 must not preclude it.
2. **Write depth — draft + auto-link.** Each credit is written as instrument + role + name; if the name exactly matches a person already in the org, link it; otherwise leave a free-text draft. Reuses the existing ADR-255 name resolver. Attestation is a separate, later step (existing PICA flow), not in v1.
3. **Flow — after register + re-runnable.** The checklist is offered right after the Stage-1 register (skippable), and the existing right-click re-opens it later on an already-registered Set, pre-filled from credits already saved.
4. **Instrument guess — track-name-first.** Pre-fill the label from the track name (editable), with device + sample filename shown as context. The optional AI layer later improves poorly-named rows.
5. **Default role — `Performer`** (founder, 2026-06-12). Every checklist credit is stamped `role: "Performer"` (from the 16-entry `RECORDING_CREDIT_ROLES` enum) — generic enough to be true for both instrumental and vocal takes; editable later in PICA. No per-row role dropdown in v1.
6. **One merged credit per person — liner-notes rule** (founder, 2026-06-12). Prod enforces `UNIQUE (recording_id, credited_name, role)` — instrument is NOT in the key, so "Dave – drums" + "Dave – bass" as two Performer rows would violate it. v1 folds all parts attributed to the same person into ONE credit row, `instrument` carrying the combined list ("drums, bass") — exactly how liner notes read. No PICA uniqueness change.
7. **Per-row writes** (founder, 2026-06-12). One `pica_recording_credits_update` call per credit, not the bulk tool — precise per-row success/failure reporting (matches the no-silent-failure rule); a few extra seconds is acceptable for a human-driven checklist.

## Success criteria

- From a registered Set, the producer can attribute every performed part and save real credits without typing an instrument name for well-named tracks.
- A name that matches an existing org person links to that person; an unknown name is preserved as a draft.
- Re-running on the same Set shows the credits already saved and edits them rather than duplicating.
- Skipping writes nothing and never blocks; the registered work is unaffected.
- The saved credits appear live in `/inspect` (instrumented `/api/mcp` path).

## Architecture

Builds on the existing Stage-1 core (`src/pica/*`, `src/session/*`). New/changed units, each with one responsibility and unit-testable in isolation:

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `src/session/read.ts` + `snapshot.ts` (extend) | Capture **group membership** per track (the SDK `Track.groupTrack` parent), which Stage 1's flat `SongSnapshot` does not carry. Add an optional `groupName?` (or `parentKey?`) to `TrackSnapshot` so groups can be folded. **Field finding (2026-06-12 smoke test, real 53-track Set): `className`-based kind detection returned `"other"` for EVERY track, `sampleFilePaths` came back empty, and groups arrived flat — so this extension must also find a working track-kind discriminator in the SDK type defs AND capture clip presence (read.ts reads no clips today, and the Part include-rule depends on "audio track with ≥1 clip"). If the SDK is stingy, parts.ts falls back to a resilient include-rule (devices OR clips present) and lets the human delete rows.** | `@ableton-extensions/sdk` types |
| `src/session/parts.ts` (new) | Pure: turn the (group-aware) `SongSnapshot` into an ordered list of `Part`s — one per performed track, groups folded to one Part, returns/master/empty excluded. Derive the pre-filled instrument label + context lines + stable key. | `src/session/snapshot.ts` types |
| `src/pica/credits.ts` (new) | Pure orchestration: given the master recording id + the filled rows, map rows → `recording_credits` writes, auto-link names via the resolver, dedupe against existing credits, call the PICA credit MCP tool. | `src/pica/mcpClient.ts` |
| `src/pica/register.ts` (extend) | After `registerSet` succeeds, return enough to drive the credits step (work id + recording id). Add a `loadExistingCredits(recordingId)` read for the re-run path. | `src/pica/mcpClient.ts` |
| `ui/interface.html` (extend) or `ui/credits.html` (new) | The checklist panel: rows (instrument editable, "who?" input), add/delete row, save / skip. Prefilled via the same injected-global mechanism as Stage 1. | — |
| `src/extension.ts` (extend) | Host glue: after register → show credits panel; standalone re-run → detect already-registered → open credits prefilled. | all of the above |

### Data shapes

```ts
// src/session/parts.ts
export interface Part {
  key: string;            // stable: `${index}:${trackName}` — dedupe/re-run anchor
  instrumentLabel: string; // pre-filled from track name (editable)
  trackName: string;
  deviceNames: string[];   // context line
  sampleFiles: string[];   // context line (basename of clip/sample paths)
  kind: "instrument" | "audio" | "group";
}

// src/pica/credits.ts
export interface CreditRow {        // what the panel returns per filled row
  instrument: string;
  performerName: string;            // free text the user typed; "" = skip this row
}
export interface CreditWrite {      // what we send to PICA per credit — ONE per person (decision 6)
  recordingId: string;
  instrument: string;               // merged list when one person played several parts: "drums, bass"
  role: "Performer";                // v1 default (decision 5)
  creditedName: string;
  personId: string | null;          // set iff the resolver found exactly one org match
}
```

### Part detection (`parts.ts`)

- Input: the session's regular tracks (`song.tracks` — already excludes return + master tracks).
- Include a track as a Part when it carries a performance: an instrument/MIDI track (its instrument device is the performance) or an audio track with at least one clip. Drop tracks with no devices and no clips (utility/empty).
- **Groups fold up:** a group track becomes one Part (label from the group name, e.g. "Drums"); its child tracks are not emitted as separate Parts. (A group is detected via the SDK `Track.groupTrack` / `className === "GroupTrack"`.)
- `instrumentLabel` = the track (or group) name, trimmed. `deviceNames` = the track's `Device.name`s; `sampleFiles` = basenames of any `Sample.filePath` / `AudioClip.filePath` on the track.
- Order follows track order; `key` is `${index}:${trackName}` so re-runs map deterministically.

### Panel UX

- **After register:** the Stage-1 panel, on success, swaps to the credits view: a row per Part (`instrumentLabel` editable; a "who played this?" text input; a delete-row control), plus **[save credits]** and **[skip — do later]**. An "add row" control covers parts the detector missed.
- **Re-run:** when the right-click action fires on a Set already registered (matched by the Stage-1 dup-check by title), the extension loads the work's master recording + its existing `recording_credits`, pre-fills the checklist from them (instrument + name per existing credit, merged with any newly-detected parts by `key`/instrument), and the same save path applies — editing, not appending.
- Prefill uses the Stage-1 mechanism (inject a `window.__PICA_PREFILL__` global into the panel HTML; hash fallback).
- Nothing is required. Save ignores rows with an empty performer name.

### Write path (`credits.ts`)

For each row with a non-empty performer name:
1. **Merge per person first (decision 6):** group filled rows by performer name (case-insensitive); one `CreditWrite` per person, `instrument` = the joined labels ("drums, bass").
2. **Resolve** the name through the existing PICA resolver (ADR-255: exact, case-insensitive match on `name` | `stage_names`, org-scoped). Exactly one match → `personId`. Zero or ambiguous → `personId = null` (the `creditedName` carries the name as a draft). **Never auto-create a person in v1.**
3. **Dedupe** against credits already on the recording using the DB's own uniqueness key `(recording_id, credited_name, role)`: an existing row for that person → update its instrument list / person link rather than insert (re-run safety).
4. **Write** one `recording_credits` row per person via `pica_recording_credits_update` over `/api/mcp` (instrumented → flashes in `/inspect`), one call per credit (decision 7).
5. Report per-row outcome; a partial failure surfaces which rows landed and which didn't. No silent success.

### Optional AI layer (documented, not v1 code)

The baseline must be self-contained, but designed so an assistant can take over the hard rows:
- `parts.ts` output and the `credits.ts` write path are pure and reusable — an AI flow can call the same write path with assistant-proposed labels.
- The fast-follow pattern (documented, not built in v1): an MCP-host assistant reads the session via a DAW MCP (e.g. its `get_context`/`get_track`), proposes instrument labels for rows the deterministic detector left thin (e.g. an audio track named "Audio 3"), and writes the credits via PICA's MCP — the same `recording_credits` target. The contract stays "PICA's credit tool + the part list," host-agnostic (any MCP host running locally beside Ableton; PICA's MCP is reachable from anywhere).

## Error handling & honesty

- Skip is always available; the registered work is never modified by skipping.
- Instrument labels are editable suggestions; rows are deletable; the human supplies every name.
- No person is ever auto-created in v1.
- All PICA failures are surfaced explicitly (consistent with Stage 1's no-silent-failure rule); partial saves report exactly what was written.

## Testing

- **Pure core (Vitest, no Ableton):** `parts.ts` (group folding, exclusions, label derivation, stable keys) against a `SongLike`/snapshot fake; `credits.ts` (row→write mapping, resolver auto-link branch, dedupe/re-run, partial-failure reporting) with a mocked `PicaMcpClient`.
- **Host glue (manual Live smoke):** the panel transition after register, add/delete row, the re-run-prefilled-from-existing path.

## Scope / YAGNI

**In v1:** detect parts → pre-fill instrument → ask who → draft `recording_credits` + auto-link to existing org people, offered after register and re-runnable (prefilled from existing credits).

**Not in v1:** AI integration code (documented pattern only); attestation routing; auto-creating people; per-child group rows; role editing beyond a default; instrument inference beyond track-name-first (the AI layer's job later).

## Resolved at review (2026-06-12, verified against prod schema + mcp-server source)

1. **Write tool: `pica_recording_credits_update`** (ADR-213 Primitive B; required `recording_id` + `credited_name` + `role`, optional `person_id`/`notes`/`attestation_status`; credits attach by `recording_id` directly). Read path for re-run: `pica_recordings_inspect` with `sections: ["recording_credits"]`. **Gap → PICA-side prerequisite PR:** the tool does NOT yet expose `instrument` even though `recording_credits.instrument` exists (text, nullable, ADR-252 merge) — expose it on the tool schema (same shape as Stage 1's `metadata` param, PR #909) **and render the instrument column in `/inspect`'s recording contributors table (`app/inspect/components/RecordingContributors.tsx`), which currently doesn't display it** (the column was empty until Stage 2 starts writing it). One small PR, both halves.
2. **Default `role` = `Performer`** — from the live 16-entry CHECK enum (`MainArtist…Other`). Founder-confirmed.
3. **Dedupe key = the DB's `UNIQUE (recording_id, credited_name, role)`** — instrument is NOT part of uniqueness, hence decision 6 (one merged credit per person). Re-run updates the existing row (instrument list / person link) instead of inserting.

## Acceptance criteria

- When a Set has just been registered, the panel offers a credits checklist with one row per performed track, the instrument pre-filled from the track name, and device/sample context shown; the producer can save or skip.
- When the producer types a performer name that exactly matches one existing org person, the saved credit links to that person; when it matches none (or several), the credit is saved as a free-text draft with no person link and no new person created.
- When the producer skips, no credit is written and the registered work is unchanged.
- When the right-click action runs on an already-registered Set, the checklist opens pre-filled from the recording's existing credits, and saving edits those rather than creating duplicates.
- When a credit is saved, it appears in `/inspect` (written over `/api/mcp`).
- When any credit write fails, the panel reports which rows were and were not saved; it never reports success for a failed write.
