# Register-as-new-version Implementation Plan (ADR-259 Stage 2.5 #3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a duplicate-title registration, let the creator choose to register the Set as a **new version** (a new recording under the existing work, with a picked version type) instead of only re-running credits on the existing master — and make "add to existing" recover (create the master) rather than dead-end.

**Architecture:** Extension-only. A new choice dialog replaces the silent dup→re-run jump; a shared `createRecordingForWork` helper creates a recording under an existing work (reused by `registerSet` for the master and by the new-version/recovery paths); the `DuplicateWorkError` branch in `runRegister` routes the three choices. No PICA backend change — `pica_recordings_create` already accepts `work_id` + `version_type`.

**Tech Stack:** TypeScript, Vitest, esbuild, `@ableton-extensions/sdk`. Spec: `docs/specs/2026-06-14-register-as-new-version-design.md`.

**Repo/branch:** `/Users/fez/pica-ableton-extension`, branch `feat/register-as-new-version` (already created off `main`).

**Commands:** test `npx vitest run` (single file: `npx vitest run __tests__/<f>.test.ts`); typecheck `npx tsc --noEmit`; package `npm run package` (→ `dist/pica.ablx`).

---

## File Structure

- `src/pica/register.ts` — `+NEW_VERSION_TYPES` const, `+createRecordingForWork()`; `registerSet` step 3 reuses the helper. (Domain: recording creation under a work.)
- `src/dialogHtml.ts` — `+duplicateChoiceHtml(title, versionTypes)`. (Presentation: the choice dialog.)
- `src/extension.ts` — rewritten `DuplicateWorkError` branch + `CHOICE_W/H` consts + imports. (Orchestration.)
- `__tests__/register.test.ts`, `__tests__/dialogHtml.test.ts` — extended.
- `README.md` — one-line note.

---

## Task 1: `createRecordingForWork` + `NEW_VERSION_TYPES` (register.ts)

**Files:**
- Modify: `src/pica/register.ts`
- Test: `__tests__/register.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/register.test.ts` (it already imports from `../src/pica/register` and has a `fakeClient` helper — reuse the file's existing client-fake style):

```ts
import { createRecordingForWork, NEW_VERSION_TYPES } from "../src/pica/register";

describe("NEW_VERSION_TYPES", () => {
  it("excludes master and the video deliverables", () => {
    expect(NEW_VERSION_TYPES).not.toContain("master");
    expect(NEW_VERSION_TYPES).not.toContain("music_video");
    expect(NEW_VERSION_TYPES).not.toContain("lyric_video");
    expect(NEW_VERSION_TYPES[0]).toBe("alternate"); // default-first
  });
});

describe("createRecordingForWork", () => {
  it("creates a recording under the work with the given version type", async () => {
    const client = { callTool: vi.fn().mockResolvedValue({ id: "rec-1" }) } as any;
    const out = await createRecordingForWork(client, {
      workId: "work-1", title: "Song", artistName: "Féz", versionType: "remix",
    });
    expect(out).toEqual({ recordingId: "rec-1" });
    expect(client.callTool).toHaveBeenCalledWith("pica_recordings_create", {
      title: "Song", artist_name: "Féz", version_type: "remix", work_id: "work-1",
    });
  });

  it("throws if no id is returned (never returns an undefined recording id)", async () => {
    const client = { callTool: vi.fn().mockResolvedValue({}) } as any;
    await expect(
      createRecordingForWork(client, { workId: "w", title: "t", artistName: "a", versionType: "alternate" }),
    ).rejects.toThrow(/did not return an id/);
  });
});
```

(If `vi` isn't already imported at the top of the file, add it to the existing `vitest` import.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/register.test.ts`
Expected: FAIL — `createRecordingForWork` / `NEW_VERSION_TYPES` not exported.

- [ ] **Step 3: Implement**

In `src/pica/register.ts`, add after the imports / near `RegisterInput`:

```ts
/** Version types offered for "register as a new version" — every audio version
 *  type except the original `master` and the two video deliverables. Default first. */
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

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run __tests__/register.test.ts`
Expected: PASS (new cases + existing register tests).

- [ ] **Step 5: Commit**

```bash
git add src/pica/register.ts __tests__/register.test.ts
git commit -m "feat(stage2.5): createRecordingForWork helper + NEW_VERSION_TYPES"
```

---

## Task 2: `registerSet` step 3 reuses the helper

**Files:**
- Modify: `src/pica/register.ts` (the master-recording creation block, currently `register.ts:96-110`)
- Test: `__tests__/register.test.ts` (existing `registerSet` test must stay green)

- [ ] **Step 1: Replace step 3 with the helper**

In `registerSet`, replace the inline `pica_recordings_create` master block (currently around `register.ts:96-109`) with:

```ts
  // 3. Create the master recording linked to the work.
  const { recordingId } = await createRecordingForWork(client, {
    workId: work.id,
    title: input.title,
    artistName: input.artistName,
    versionType: "master",
  });

  return {
    workId: work.id,
    recordingId,
    completenessScore: work.completeness_score,
    inspectUrl: `https://withpica.com/inspect/works/${work.id}`,
  };
```

- [ ] **Step 2: Run the full suite (regression)**

Run: `npx vitest run`
Expected: PASS — `registerSet` still creates a `master` recording linked to the work (the existing register tests assert the `pica_recordings_create` call with `version_type: "master"` + `work_id`; behaviour is unchanged). If a test asserts the call inline vs via helper, it still sees the same `callTool` invocation, so it stays green.

- [ ] **Step 3: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.

```bash
git add src/pica/register.ts
git commit -m "refactor(stage2.5): registerSet reuses createRecordingForWork for the master"
```

---

## Task 3: `duplicateChoiceHtml` dialog (dialogHtml.ts)

**Files:**
- Modify: `src/dialogHtml.ts`
- Test: `__tests__/dialogHtml.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/dialogHtml.test.ts`:

```ts
import { duplicateChoiceHtml } from "../src/dialogHtml";

describe("duplicateChoiceHtml", () => {
  const html = duplicateChoiceHtml("My Song", ["alternate", "remix", "demo"]);
  it("shows the title and all three actions", () => {
    expect(html).toContain("My Song");
    expect(html).toContain("action:'existing'");
    expect(html).toContain("action:'newVersion'");
    expect(html).toContain("action:'cancel'");
  });
  it("reads the selected version type from the #vt select", () => {
    expect(html).toContain('id="vt"');
    expect(html).toContain("document.getElementById('vt').value");
  });
  it("renders one option per supplied version type, default first", () => {
    expect(html).toContain('<option value="alternate">');
    expect(html).toContain('<option value="remix">');
    expect(html).toContain('<option value="demo">');
    expect(html.indexOf('value="alternate"')).toBeLessThan(html.indexOf('value="remix"'));
  });
  it("escapes the title", () => {
    expect(duplicateChoiceHtml('<x>', ["alternate"])).toContain("&lt;x&gt;");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run __tests__/dialogHtml.test.ts`
Expected: FAIL — `duplicateChoiceHtml` not exported.

- [ ] **Step 3: Implement**

In `src/dialogHtml.ts`, add (uses the existing `BASE_STYLE`, `escapeHtml`, and `bridgeSend` helpers):

```ts
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
  return (
    `<!doctype html><meta charset="utf-8"><body style="${BASE_STYLE}">` +
    `<div style="color:#B87333;margin-bottom:8px">pica — already registered</div>` +
    `a work titled "${escapeHtml(title)}" already exists in your catalog.` +
    `<div style="margin-top:14px"><button onclick="${escapeHtml(existingJs)}">add credits to the existing recording</button></div>` +
    `<div style="margin-top:14px">register as a new version: ` +
    `<select id="vt" style="background:#1A1A1A;color:#EDEDED;border:1px solid #333;padding:4px">${options}</select> ` +
    `<button onclick="${escapeHtml(newVersionJs)}">register version</button></div>` +
    `<div style="margin-top:14px"><button onclick="${escapeHtml(cancelJs)}">cancel</button></div>`
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run __tests__/dialogHtml.test.ts`
Expected: PASS (new cases + existing `messageHtml`/`linkMessageHtml`/`pasteKeyHtml`).

- [ ] **Step 5: Commit**

```bash
git add src/dialogHtml.ts __tests__/dialogHtml.test.ts
git commit -m "feat(stage2.5): duplicateChoiceHtml choice dialog"
```

---

## Task 4: Wire the choice into the `DuplicateWorkError` branch (extension.ts)

**Files:**
- Modify: `src/extension.ts` (imports; the `DuplicateWorkError` catch at `extension.ts:130-158`; new size consts)

- [ ] **Step 1: Add imports + size consts**

Add to the imports:
```ts
import { ensureIntroduced, registerSet, findExistingRegistration, DuplicateWorkError, createRecordingForWork, NEW_VERSION_TYPES } from "./pica/register";
import { duplicateChoiceHtml, messageHtml, linkMessageHtml, successBody } from "./dialogHtml";
import { connectAndStoreKey, safeParse } from "./pica/connect";
```
(Merge with the existing import lines for those modules — do not duplicate. `safeParse` is already exported from `./pica/connect`.)

Near the other dialog-size consts add:
```ts
const CHOICE_W = 420;
const CHOICE_H = 320;
```

- [ ] **Step 2: Replace the `DuplicateWorkError` branch**

Replace the body of `if (e instanceof DuplicateWorkError) { ... }` (currently `extension.ts:130-157`, the `try/findExistingRegistration…` through the `showLink("pica — already registered" …)`) with:

```ts
    if (e instanceof DuplicateWorkError) {
      const raw = await context.ui.showModalDialog(
        `data:text/html,${encodeURIComponent(duplicateChoiceHtml(answer.title!, NEW_VERSION_TYPES))}`,
        CHOICE_W,
        CHOICE_H,
      );
      const choice = safeParse(raw); // {} on close → treated as cancel
      const parts = deriveParts(snapshot);

      if (choice.action === "newVersion") {
        const versionType = NEW_VERSION_TYPES.includes(choice.versionType as never)
          ? (choice.versionType as string)
          : "alternate";
        const { recordingId } = await runWithClient((c) =>
          createRecordingForWork(c, {
            workId: e.existingWorkId,
            title: answer.title!,
            artistName: answer.artistName!,
            versionType,
          }),
        );
        await runCreditsFlow(context, runWithClient, recordingId, buildPrefillRows(parts, []), []);
        return undefined;
      }

      if (choice.action === "existing") {
        const found = await findExistingRegistration(client, answer.title!);
        let recordingId = found?.recordingId ?? null;
        let existing: ExistingCredit[] = [];
        if (recordingId) {
          existing = await loadExistingCredits(client, recordingId);
        } else {
          // Work exists without a recording → complete it: create the master.
          const created = await runWithClient((c) =>
            createRecordingForWork(c, {
              workId: e.existingWorkId,
              title: answer.title!,
              artistName: answer.artistName!,
              versionType: "master",
            }),
          );
          recordingId = created.recordingId;
        }
        await runCreditsFlow(context, runWithClient, recordingId, buildPrefillRows(parts, existing), existing);
        return undefined;
      }

      return undefined; // cancel / unparseable
    }
    throw e;
```

(`ExistingCredit` is already imported in `extension.ts`. If not, add it to the `./pica/credits` import.)

- [ ] **Step 3: Typecheck + full suite + package**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests green (no test asserted the old dead-end dialog string; if one does, update it — the dead-end is intentionally removed).

Run: `npm run package`
Expected: `dist/pica.ablx` rebuilt.

- [ ] **Step 4: Commit**

```bash
git add src/extension.ts
git commit -m "feat(stage2.5): duplicate-title choice — new version / add-to-existing (with master recovery)"
```

---

## Task 5: README note

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the note**

Under the registration section, add:

```markdown
**Registering a new version.** If a Set's title already matches a work in your
catalog, you can either add credits to the existing recording or **register the
Set as a new version** (a new recording under the same work) — pick the version
type (alternate, remix, acoustic, live, cover, alternate master, demo).
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(stage2.5): README — register-as-new-version on a duplicate title"
```

---

## Self-Review

**Spec coverage:** §4 choice flow → Tasks 3 (dialog) + 4 (branch incl. existing-recovery, newVersion, cancel); §5.1 helper/const → Task 1, registerSet reuse → Task 2; §5.2 dialog → Task 3; §5.3 branch → Task 4; §6 error handling (clamp invalid type, cancel-on-close, 401 via runWithClient, recovery) → Task 4; §7 testing → Tasks 1 & 3 (+ regression Task 2); README → Task 5.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `createRecordingForWork(client, {workId,title,artistName,versionType})` returning `{recordingId}`, `NEW_VERSION_TYPES`, `duplicateChoiceHtml(title, versionTypes)`, the `{action, versionType?}` bridge payload, and `runCreditsFlow(context, runWithClient, recordingId, prefillRows, existing)` are used identically across tasks and match the existing `runCreditsFlow` signature (`extension.ts:206`). `safeParse` returns `{}` on bad input (from `connect.ts`), so `choice.action` is safely `undefined` → cancel.
