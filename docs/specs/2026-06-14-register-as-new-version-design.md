# ADR-259 Stage 2.5 #3 — Register as a new version

**Date:** 2026-06-14
**Status:** Design — awaiting review
**Repo:** Ableton extension (`/Users/fez/pica-ableton-extension`) — extension-only, no PICA backend change.
**Predecessors:** Stage 1 (register Set), Stage 2 (credits checklist), Stage 2.5 #1 (Connect via login). All on `main`.

---

## 1. Problem & goal

When a creator opens a Set whose title already exists in their catalog (a new arrangement, remix, acoustic take, etc. of a song they've already registered), the extension currently treats it as a **re-run**: the duplicate-title path jumps straight to the prefilled credits checklist on the *existing* master recording. There's no way to say "this is a *different version* of that song" from the DAW.

**Goal:** on a duplicate title, let the creator choose to **register the Set as a new version** — a new `recordings` row under the **existing work** (same composition), with a version type they pick — then attribute credits on that new recording. Keep the existing "add credits to the existing recording" behaviour as the other choice.

**Success criteria:**
1. A duplicate title presents a clear choice: add to existing, register a new version (with a type), or cancel.
2. "New version" creates a recording under the existing work with the chosen `version_type`, then opens the credits checklist (prefilled from the current Set) on that new recording.
3. "Add to existing" never dead-ends: if the work somehow has no recording, it creates the master and proceeds.

---

## 2. Scope

**In scope (extension only):**
- `src/dialogHtml.ts`: a `duplicateChoiceHtml(title, versionTypes)` dialog.
- `src/pica/register.ts`: a `createRecordingForWork(...)` helper + a `NEW_VERSION_TYPES` constant; reuse the helper in `registerSet` step 3 (DRY).
- `src/extension.ts`: rewrite the `DuplicateWorkError` catch to show the choice dialog and branch.
- Vitest for the new pure units.

**Out of scope:**
- No PICA backend change — `pica_recordings_create` already accepts `work_id` + `version_type` (the register flow already creates a `master` this way).
- No Set snapshot attached to the new recording (the work already carries the original snapshot from Stage 1; per-version snapshots are a future enhancement).
- No new-derivative-**work** option (a new version is the same composition → a new recording, not a new work).
- Multi-version listing / picking *which* existing recording to add to — "add to existing" targets the master (or the sole recording), as today.

---

## 3. Existing building blocks (reused)

| Block | Location | Role |
| --- | --- | --- |
| Dup detection | `register.ts` `registerSet` → throws `DuplicateWorkError(existingWorkId, title)` | Already fires on a title match (and on the server 409). |
| Recording create | `register.ts:97-102` — `pica_recordings_create {title, artist_name, version_type, work_id}` | Same call we'll reuse for a new version (different `version_type`). |
| Re-run path | `extension.ts:130-157` — `findExistingRegistration` → `loadExistingCredits` → `runCreditsFlow` | Becomes the "add to existing" branch. |
| Credits flow | `extension.ts` `runCreditsFlow(context, runWithClient, recordingId, prefillRows, existing)` | Reused verbatim on whichever recording we land on. |
| Reconnect runner | `extension.ts:96-105` `runWithClient` (wraps `withReconnect`) | New create-calls run through it so a 401 reconnects. |
| Valid version types | PICA `recordings.ts` `VALID_VERSION_TYPES` | `demo, master, alternate_master, music_video, lyric_video, live_performance, acoustic, remix, cover, alternate`. |
| Captured artist | `extension.ts` `answer.artistName` | Entered in the confirm panel *before* the dup was detected — available in the catch. |

---

## 4. Choice-dialog flow

On `DuplicateWorkError`, replace the current "jump to re-run checklist / else dead-end" block with a **choice dialog** (`duplicateChoiceHtml`):

```
a work titled "X" already exists in your catalog.

[ add credits to the existing recording ]

register as a new version:  [ alternate ▾ ]   [ register version ]

[ cancel ]
```

The dialog bridges back exactly one of:
- `{ action: "existing" }`
- `{ action: "newVersion", versionType: "<selected>" }`
- `{ action: "cancel" }`
- (window-close / unparseable → treated as `cancel`)

### Branches

**`existing`** — add credits to the existing recording (today's behaviour, hardened):
1. `findExistingRegistration(client, title)` → `{ workId, recordingId }`.
2. `recordingId` present → `loadExistingCredits` → `runCreditsFlow` on it (unchanged).
3. **`recordingId` null (work exists, no recording) → create the master** via `createRecordingForWork({workId: e.existingWorkId, title, artistName, versionType: "master"})`, then `runCreditsFlow` on it with **no** existing credits. *(This replaces the old dead-end "already registered" dialog — we complete the half-finished registration instead of refusing.)*

**`newVersion`** — register a new version under the existing work:
1. `createRecordingForWork({ workId: e.existingWorkId, title, artistName, versionType: <selected> })` → new `recordingId`.
2. `runCreditsFlow` on the new recording, prefilled from the **current Set's parts** (`buildPrefillRows(deriveParts(snapshot), [])`), with no existing credits.
3. The credits outcome dialog already links `/inspect/recordings/<newId>` — correct for the new recording.

**`cancel`** — quiet return, no dialog.

All create-calls run through `runWithClient` so a 401 reconnects (consistent with the register/credits phases). The `findExistingRegistration`/`loadExistingCredits` reads keep using the raw `client`, as today.

---

## 5. Components

### 5.1 `src/pica/register.ts`

```ts
/** Version types offered for "register as a new version" — every audio version
 *  type except the original `master` and the two video deliverables. */
export const NEW_VERSION_TYPES = [
  "alternate", "alternate_master", "remix", "acoustic",
  "live_performance", "cover", "demo",
] as const;

/** Create a recording under an EXISTING work with a given version type.
 *  Shared by registerSet (master) and the new-version / recovery paths. */
export async function createRecordingForWork(
  client: PicaMcpClient,
  input: { workId: string; title: string; artistName: string; versionType: string },
): Promise<{ recordingId: string }> {
  const rec = await client.callTool<{ id: string }>("pica_recordings_create", {
    title: input.title,
    artist_name: input.artistName,
    version_type: input.versionType,
    work_id: input.workId,
  });
  if (!rec?.id) {
    throw new Error("PICA created the recording but did not return an id.");
  }
  return { recordingId: rec.id };
}
```

`registerSet` step 3 (`register.ts:97-102`) is refactored to call `createRecordingForWork(client, {workId: work.id, title, artistName, versionType: "master"})` — same behaviour, one definition.

### 5.2 `src/dialogHtml.ts`

```ts
/** Duplicate-title choice dialog: add to existing, register a new version
 *  (with a type picker), or cancel. Bridges {action, versionType?}. */
export function duplicateChoiceHtml(title: string, versionTypes: readonly string[]): string
```

- Renders the title, the three controls, and a `<select id="vt">` of `versionTypes` (first option is the default — pass `alternate` first).
- "add credits to the existing recording" → `bridgeSend("JSON.stringify({action:'existing'})")`.
- "register version" → `bridgeSend("JSON.stringify({action:'newVersion',versionType:document.getElementById('vt').value})")`.
- "cancel" → `bridgeSend("JSON.stringify({action:'cancel'})")`.
- Same `BASE_STYLE` + `escapeHtml` + `bridgeSend` helper as the other builders.

### 5.3 `src/extension.ts`

Rewrite the `DuplicateWorkError` catch (`extension.ts:130-158`):

```ts
if (e instanceof DuplicateWorkError) {
  const raw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(duplicateChoiceHtml(answer.title!, NEW_VERSION_TYPES))}`,
    CHOICE_W, CHOICE_H,
  );
  const choice = safeParse(raw); // {} on close → treated as cancel
  const parts = deriveParts(snapshot);

  if (choice.action === "newVersion") {
    const versionType = NEW_VERSION_TYPES.includes(choice.versionType as never)
      ? (choice.versionType as string) : "alternate";
    const { recordingId } = await runWithClient((c) =>
      createRecordingForWork(c, { workId: e.existingWorkId, title: answer.title!, artistName: answer.artistName!, versionType }));
    await runCreditsFlow(context, runWithClient, recordingId, buildPrefillRows(parts, []), []);
    return undefined;
  }

  if (choice.action === "existing") {
    const found = await findExistingRegistration(client, answer.title!);
    let recordingId = found?.recordingId ?? null;
    if (!recordingId) {
      // Work exists without a recording → complete it: create the master.
      const created = await runWithClient((c) =>
        createRecordingForWork(c, { workId: e.existingWorkId, title: answer.title!, artistName: answer.artistName!, versionType: "master" }));
      recordingId = created.recordingId;
    }
    const existing = recordingId === found?.recordingId
      ? await loadExistingCredits(client, recordingId) : [];
    await runCreditsFlow(context, runWithClient, recordingId, buildPrefillRows(parts, existing), existing);
    return undefined;
  }

  return undefined; // cancel / unparseable
}
throw e;
```

(`safeParse` is imported from `./pica/connect`. `CHOICE_W`/`CHOICE_H` are new dialog-size consts, e.g. 420×320.)

---

## 6. Error handling

| Condition | Behaviour |
| --- | --- |
| Dialog closed / unparseable | treated as `cancel` — quiet return |
| Unknown/invalid `versionType` from the dialog | clamped to `alternate` (defensive; the dropdown only offers valid values) |
| `createRecordingForWork` fails (e.g. server validation) | error propagates to the existing `runRegister().catch` → error dialog |
| 401 during a create | `runWithClient` reconnects once and retries (existing mechanism) |
| `existing` chosen, work has no recording | master created, then credits — no dead-end |

---

## 7. Testing (Vitest)

- **`dialogHtml.test.ts`** — `duplicateChoiceHtml`: contains the title, an `existing` action, a `newVersion` action reading `#vt`, a `cancel` action, and one `<option>` per supplied version type (default first).
- **`register.test.ts`** — `createRecordingForWork`: calls `pica_recordings_create` with `work_id` + the given `version_type` + title/artist; throws if no id returned. Plus: `registerSet` still creates a `master` (regression — the refactor to use the helper must not change its call).
- **`NEW_VERSION_TYPES`** — asserted to be a subset of the canonical list and to exclude `master`/`music_video`/`lyric_video`.
- The `extension.ts` branch wiring (existing/newVersion/cancel, recovery-create) is integration-level; verified in the founder's in-Ableton run (no unit harness for the full `runRegister`).

---

## 8. File manifest

- `src/dialogHtml.ts` — `+duplicateChoiceHtml`.
- `src/pica/register.ts` — `+NEW_VERSION_TYPES`, `+createRecordingForWork`; `registerSet` step 3 uses the helper.
- `src/extension.ts` — rewritten `DuplicateWorkError` branch; `+CHOICE_W/H`; import `duplicateChoiceHtml`, `NEW_VERSION_TYPES`, `createRecordingForWork`, `safeParse`.
- `__tests__/dialogHtml.test.ts`, `__tests__/register.test.ts` — extended.
- `README.md` — note the new-version choice on a duplicate title.

---

## 9. Build sequence (for the plan)

1. `dialogHtml.ts` `duplicateChoiceHtml` + tests.
2. `register.ts` `createRecordingForWork` + `NEW_VERSION_TYPES` + tests; refactor `registerSet` step 3 to use the helper (regression test stays green).
3. `extension.ts` rewrite the dup branch (existing-with-recovery / newVersion / cancel); tsc + full vitest; repackage `dist/pica.ablx`.
4. README note.

Each step compiles and passes `npx vitest run` before the next.
