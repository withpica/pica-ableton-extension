# Releasing the PICA Ableton extension

This is the self-contained procedure for cutting a beta release of the extension and
getting the `.ablx` to testers. Anyone (a human, or a fresh AI instance handed
"cut a release per RELEASING.md") can follow it end to end. No prior context needed.

---

## What gets distributed

A single file: **`dist/pica.ablx`** — the packaged extension. It is **build output**
(gitignored, not committed), so it does not live in the repo. The canonical home for a
shipped `.ablx` is a **GitHub Release asset** on this repo
(`withpica/pica-ableton-extension`), tagged with the version it was built from.

## Prerequisite for the *builder* (you, not the tester)

The build needs the **Ableton Extensions SDK**, which is private beta and **not on npm**.
It ships as Centercode tarballs under `vendor/*.tgz` (gitignored). A clean clone will
**not** build until those tarballs are present in `vendor/` and installed.

- If `vendor/` is empty: get the SDK tarballs from the Ableton Centercode beta program
  and drop them in `vendor/`, then `npm install`.
- A machine that has already built the extension locally already has them.

> Because the SDK is private-beta, the build can only run where the SDK is available.
> This is the single reason releases are not (yet) fully automated in CI — see
> "Automating later" at the bottom.

## Prerequisites for a *tester* (put these in the release notes)

- **Ableton Live 12.4.5 or newer** (the build with the Extensions feature). Live
  **Suite** exposes Extensions; **demo / unauthorized** mode also shows the Extensions
  page, so testers without a Suite license can still try it in demo.
- A **PICA connection key**, or use the in-extension **Connect** flow to link their
  catalog. (No key = the extension loads but can't write to PICA.)

---

## Cut a release

From a checkout of the commit you want to ship (normally `main`):

```bash
# 1. Be on the commit you intend to release, clean tree
git checkout main && git pull
git status                      # working tree should be clean

# 2. Confirm the version in package.json is what you want to tag.
#    Bump it first if needed, commit, push. Tag must match.
node -e "console.log(require('./package.json').version)"

# 3. Build the packaged extension (runs tsc + tests via the build step)
npm install                     # ensures vendor SDK is linked
npm run package                 # -> dist/pica.ablx

# 4. Sanity-check the artifact exists and has size
ls -lh dist/pica.ablx

# 5. Create the GitHub Release with the .ablx attached
gh release create v<VERSION> dist/pica.ablx \
  --repo withpica/pica-ableton-extension \
  --title "PICA Ableton extension v<VERSION> (beta)" \
  --notes-file - <<'NOTES'
## PICA Ableton extension — v<VERSION> (beta)

Right-click capture of your Ableton Set into PICA: registers the Set as a work +
master recording, with performer credits, master ownership, and writers — at the
moment of creation.

### Install
1. Download `pica.ablx` below.
2. In Ableton Live, open **Settings → Extensions** and drag `pica.ablx` onto the page.
3. **Restart Live.**

### Upgrade from a previous build
1. On the **Extensions** page, remove the old PICA extension.
2. Drag the new `pica.ablx` on.
3. Quit and relaunch Live.

### Requirements
- Ableton Live **12.4.5+** (Suite, or demo/unauthorized mode).
- A PICA connection key, or use the in-extension **Connect** flow to link your catalog.

### What's in this build
- <one or two bullets: e.g. "master ownership + writer capture", or the new feature>
NOTES
```

Replace `<VERSION>` with the `package.json` version (e.g. `0.1.0`). Keep the git tag,
the release title, and `package.json` in lockstep so a downloaded `.ablx` is traceable
to an exact commit.

### Updating an existing release (re-build, same version)

Prefer a new version. If you must replace the asset on an existing tag:

```bash
gh release upload v<VERSION> dist/pica.ablx --clobber \
  --repo withpica/pica-ableton-extension
```

---

## Open vs controlled beta

- **Open beta** → a GitHub Release on this **public** repo. The `.ablx` is then
  publicly downloadable by anyone with the link. Simplest; fine for an open beta.
- **Controlled beta** (named testers only) → do **not** publish a public Release.
  Build `dist/pica.ablx` as above and distribute through a gated channel: the Centercode
  beta program (same place the SDK ships), or a per-person link (Drive/Dropbox). The
  build steps are identical; only the distribution surface changes.

---

## Automating later (optional)

The mechanical part (build → attach to Release) suits a GitHub Actions workflow
triggered on a version tag push. The **only** blocker is making the private Centercode
SDK available to CI — e.g. storing the `vendor/*.tgz` tarballs as encrypted repo
secrets / a private artifact and restoring them in the workflow. Confirm that is
acceptable under the SDK's beta terms before doing this. Until then, releases are cut
locally with the steps above.
