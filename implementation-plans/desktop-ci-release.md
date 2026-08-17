# Desktop CI Release

## Goal

Move desktop release builds off the laptop and into CI, so that pushing a `v*`
tag produces one GitHub Release carrying signed artifacts for macOS (Apple
Silicon and Intel), Windows and Linux — and so that a weekly cadence is driven by
an agent-invocable `/ori-release` skill rather than by remembering a sequence of
commands.

Depends on [desktop-platform-parity.md](desktop-platform-parity.md). Feeds
[desktop-auto-update.md](desktop-auto-update.md).

## Getting a build to testers

The first thing this buys, and the reason it was built before the release
machinery around it: **Actions ▸ Desktop Build ▸ Run workflow**, against any
branch, optionally narrowed to one platform. Artifacts land on the run's Summary
page — a `.dmg` per macOS architecture, an NSIS `-setup.exe`, a `.deb`, and an
`.AppImage`.

No tag, no release, nobody offered an update. It exists so the platforms the
maintainer cannot run can still be validated by people who can.

macOS is signed and notarized as soon as `APPLE_CERTIFICATE` is present; until
then the run still succeeds and emits an unsigned `.app` with a warning saying
Gatekeeper will refuse it. Windows is unsigned by decision.

## Decisions taken

| Decision | Choice | Note |
| --- | --- | --- |
| macOS signing | **Moves to CI** | Apple Developer ID `.p12` + App Store Connect API key as GitHub environment secrets |
| macOS architectures | **Two separate DMGs**, `aarch64` and `x86_64` | Both cross-compiled from one arm64 runner; two notarization submissions per release |
| Windows signing | **Unsigned for now** | See "Windows and SmartScreen" below — this has a real, compounding cost |
| Linux formats | **AppImage + `.deb`** | No `.rpm`, no Flathub |
| crates.io | **Dormant** | `publish = false`; the engine crates are not published while the desktop train runs |
| Version scheme | Weekly train bumps MINOR; hotfix bumps PATCH | `0.2.0 → 0.3.0 → 0.4.0`; hotfix off `v0.3.0` is `0.3.1` |
| Cadence | Thursday morning | A week with nothing user-visible is a **skipped week**, not an empty version |

The repo is **public**, so standard GitHub-hosted runners are free and unmetered.
This removes CI cost as a design constraint. Do not switch to larger runners,
which bill even on public repos.

## Approach

### The blocker that must be fixed first

`Cargo.toml` `[workspace.dependencies]` pins intra-workspace path dependencies
with caret version requirements while `[workspace.package] version = "0.1.2"`:

```toml
treemaker-sequence     = { version = "0.1.1", path = "crates/treemaker-sequence" }
oristudio-cp           = { version = "0.1.1", path = "crates/oristudio-cp" }
oristudio-cp-compiler  = { version = "0.1.1", path = "crates/oristudio-cp-compiler" }
oristudio-cp-detect    = { version = "0.1.1", path = "crates/oristudio-cp-detect" }
```

plus `crates/treemaker-wasm/Cargo.toml:31-32` pinning `treemaker-fold` and
`treemaker-flatfold` at `"0.1.0"`. Every one of those crates inherits
`version.workspace = true`.

These resolve today **only because** `^0.1.1` admits `0.1.2`. The first weekly
minor bump takes the workspace to `0.2.0`, `^0.1.1` no longer admits it, and
`cargo build` fails workspace-wide. This is a landmine under the very first
release of the new scheme, and `release.sh` only rewrites two of these pins
(`:262-263`, `:265-267`).

**Fix:** drop the `version =` field from every intra-workspace path dependency.
`oristudio-cp = { path = "crates/oristudio-cp" }` is legal and complete — a
version requirement on a path dep only matters when publishing, and publishing is
off (see below). This also *deletes* `release.sh:262-263` and `:265-267` rather
than extending them, so the release script gets smaller.

### crates.io is dormant

Decided: the engine crates are not published while the desktop train runs.

Only `treemaker-core` is on crates.io, at `0.1.0`. `treemaker-fold` and
`treemaker-flatfold` — which `RELEASE.md:63-107` says to publish **first** — were
never published at all. The documented publish order has never been executed, and
two product releases have shipped without a crates.io publish.

But the surface is still advertised: `README.md:6-7` renders crates.io and
docs.rs badges, `README.md:36-52` lists six crates under a heading "TreeMaker
engine crates (crates.io)" with docs.rs links, and `crates/treemaker-core/Cargo.toml:6-20`
carries the full publishing kit (`description`, `documentation`, `keywords`,
`categories`, `include`).

So the surface is advertised but not maintained, and a weekly train would
otherwise mint ~52 crate versions a year with no crate-level change in nearly all
of them. Make the docs match reality: delete the two README badges, cut the
crates.io heading, replace `RELEASE.md`'s Crates section with a dated note, set
`publish = false` on `[workspace.package]`, and strip the path-dep version
requirements.

This is reversible if it ever matters — re-publishing means restoring `version =`
on the published chain's path deps and setting `publish = false` per-crate on the
app/internal members instead (`ori-studio`, `oracle-tests`,
`oristudio-cp-detect-inspector`, `oristudio-cp-eval`). Worth knowing, because
`cargo publish` refuses a crate whose dependencies carry no version, so the strip
alone ends publishability even without `publish = false`.

### Build topology

One tag-triggered workflow, replacing the current `release.yml`:

```
validate ─┬─ draft ────────────────┐
          └─ frontend ─┐           │
                       ├─ build (matrix: macos ×2 arch, windows, linux) ─┐
                       │                                                  │
                                                     manifest ────────────┤
                                                                          └─ publish ─ verify
```

- **`validate`** — version agreement across the four files, CHANGELOG entry
  present and non-empty, ancestry, and **CI was green at this SHA**.
- **`frontend`** — builds the web bundle *once* on Linux (wasm bridges, simulator,
  Vite) and hands it to the three native jobs as an artifact. Rebuilding
  identical bytes on a macOS runner is the most expensive minute in the pipeline.
- **`build`** — the matrix. Consumes `web-dist` via a `beforeBuildCommand` shim.
- **`manifest`** — composes and verifies the updater manifest (see
  [desktop-auto-update.md](desktop-auto-update.md)).
- **`publish`** — flips the draft to a **prerelease**, but only after asserting the
  expected asset set is complete. Prerelease assets are publicly downloadable while
  `releases/latest` skips them, so this is the state in which you install and verify
  the build; a human then arms it with `gh release edit --prerelease=false`. See
  [desktop-auto-update.md](desktop-auto-update.md).
- **`verify`** — fetches the *published* release from outside and re-drafts it on
  any failure.

Key mechanics, each of which is a place this goes wrong quietly:

- **`bundle.targets: "all"` must be replaced with an explicit list**, and
  `--bundles` passed per matrix leg. `"all"` means DMG+app on macOS, NSIS **and**
  MSI on Windows, deb+rpm+AppImage on Linux — including formats we decided not to
  ship.
- **`Swatinem/rust-cache` must use `workspaces: '. -> target'`.** `apps/tauri/src-tauri`
  is a root workspace member, so `target/` is at the repo root; the stock Tauri
  example's `./src-tauri -> target` caches nothing here, silently.
- **`security set-key-partition-list` is not optional** after importing the Apple
  `.p12`. Without it `codesign` opens a GUI prompt and the job hangs until timeout.
- **The Linux glibc floor** determines the oldest distro the AppImage runs on.
  Building on `ubuntu-24.04` raises it from 2.35 to 2.39. Build Linux inside a
  `container: ubuntu:22.04` to decouple the floor from GitHub's runner lifecycle
  (the `ubuntu-22.04` *label* begins deprecation 2026-09-17). This is the
  highest-risk line in the workflow; `APPIMAGE_EXTRACT_AND_RUN=1` is required
  because linuxdeploy cannot mount FUSE in a container.

### An unsigned test leg must exist before the signed one

The current plan-shaped temptation is to make the pipeline tag-only and discover
whether it works by pushing `v0.2.0`. That makes a public tag the first execution
of an untested three-platform matrix holding the Apple certificate — and if the
NSIS artifact name doesn't match the completeness check, or linuxdeploy fails in
the container, the version number is burned.

Keep a `workflow_dispatch` leg (and a `pull_request` trigger filtered on
`apps/tauri/**`, `Cargo.lock`, `.github/workflows/release.yml`) that runs the same
matrix **without** the signing environment and uploads to `actions/upload-artifact`
instead of a release. Add it *before* the workflow that touches secrets.

Do delete the current `workflow_dispatch` branch of `release.yml` — its
`sed -n 's/^version = \"\\(.*\\)\"/\\1/p'` is double-escaped, matches nothing, and
always fails with `Version mismatch. Expected , found 0.1.2`. It has never worked.

### Failure states are the weak point, not the happy path

The only irreversible act in a release is `git push origin refs/tags/vX`, and it
happens *before* any build runs. So "tag pushed, release incomplete" is a state
you will be in regularly, and it must be a designed, recoverable state rather
than a corruption:

- The skill's state detection needs a fourth state: **tag exists AND a draft
  release exists** → "release in flight." In that state it enumerates the draft's
  assets against the expected set, reports which jobs failed with URLs, and offers
  `gh run rerun --failed` — rather than reporting "tag already exists" and stopping.
- `RELEASE.md` gets this as a **state table**, not prose.
- A dangling tag with no published release is normal and recoverable. Say so.

Two related gaps in the current setup:

- **`ci.yml` does not run on tags** (`push: branches: [main]` + `pull_request`).
  A hotfix tagged on a branch off `v0.3.0` that was never merged has therefore
  never had lint, typecheck, vitest, clippy or oracle parity run against it — the
  one release where you are most tired has the least protection. `validate` must
  gate on `gh run list --commit "$SHA" --workflow CI` containing a success.
- **`release.sh prepare` can only cut from `origin/main` HEAD** — there is no
  `--base`. With ~59 merges a week and parallel agents, Thursday HEAD may contain
  something you'd rather not ship, and the only outs are a revert PR or skipping
  the week. Add `--base <sha|ref>`, and have the skill default it to the newest
  commit on main with a green CI run, stating which commit it chose and why.

### Windows and SmartScreen

Shipping unsigned is a legitimate choice, but the cost compounds in a way that is
worth stating plainly, because it interacts badly with a weekly cadence:
SmartScreen reputation accrues **per file hash**, and it does not transfer between
versions unless both were signed with the same publisher identity. A new unsigned
hash every Thursday means the install base never accumulates reputation — you stay
permanently inside the "Windows protected your PC" window rather than emerging
from it after a few weeks.

Two free mitigations, both worth doing in this plan:

- **winget.** Free, requires no signing, and `winget install` users never touch a
  browser download, so the Mark-of-the-Web path that triggers SmartScreen never
  fires for them. Submit the first manifest by hand; after the first merge,
  `vedantmgoyal9/winget-releaser` automates weekly bumps with no human in the loop.
- **An honest download page note** with the SHA-256, explaining the warning and
  how to proceed.

If this becomes a conversion problem, Azure Trusted Signing is roughly $10/month
and automates cleanly via a `bundle.windows.signCommand` — but individual/sole-proprietor
eligibility has geographic restrictions and a 1–20 business day validation with no
SLA, so it is deferred rather than blocking. Deferred phase below.

### Discovery: nobody can find the app

The web app is the only discovery channel that exists, and it has zero path to a
desktop build. `constants/release.ts:7` defines `RELEASES_URL` and it has **zero
consumers**. `WelcomeLanding.test.tsx:109-115` actively asserts the opposite,
under the test name `promises no desktop download, because there is not one yet`:

```js
expect(rendered.textContent).not.toMatch(/download|install it|\.dmg|Apple Silicon/i);
expect(hrefs).not.toContain(`${REPOSITORY_URL}/releases`);
```

Three signed installers landing on a GitHub Releases page that the audience never
visits is a pipeline running for nobody. This is genuinely new UI — OS sniffing,
four download buttons, checksums, i18n across 8 locales, an analytics event — so
it is a phase, not a bullet.

Also worth one line in the first release notes: **nobody currently running 0.1.2
has an updater**, so existing macOS users must download once manually. And
`local-macos-release.sh` publishes a stable `OriStudio_latest_aarch64.dmg` alias
that anyone may have bookmarked — either keep publishing an alias or redirect.

## Affected Areas

| Area | Files |
| --- | --- |
| Version hygiene | `Cargo.toml`, `crates/treemaker-wasm/Cargo.toml:31-32`, every `crates/*/Cargo.toml` |
| Release scripts | `scripts/release.sh` (add `--base`, dead seds deleted, publish local-build flag inverted), `scripts/local-macos-release.sh` (demoted to break-glass), new `scripts/release-lib/{read-workspace-version,check-versions,extract-changelog}.sh`, new `scripts/build-frontend.mjs` |
| CI | `.github/workflows/release.yml` (rewritten), `.github/workflows/ci.yml` (Windows Rust job), `.github/actions/install-wasm-pack/action.yml` (checksum pinned) |
| Tauri shell | `apps/tauri/src-tauri/tauri.conf.json` (explicit `bundle.targets`, `beforeBuildCommand`), `apps/tauri/package.json` (add a `tauri` script) |
| Discovery | new download route/section, `apps/web/src/components/landing/WelcomeLanding.tsx` + its test, `README.md:26-28`, `apps/web/src/analytics/events.ts` |
| Skill | new `.agents/skills/ori-release/SKILL.md` |
| Docs | `RELEASE.md` (rewrite around CI, add the state table and a "Clocks" section), `AGENTS.md` (one line) |

## Checklist

### Phase 0 — Long-lead and one-way doors

- [x] Set `publish = false` on `[workspace.package]` (plus `publish.workspace = true` on all 17 members); delete the README crates.io/docs.rs badges and rewrite the crates heading; replace `RELEASE.md`'s Crates section with a dormant note including the revival path
- [x] Strip `version =` from all 13 intra-workspace path deps; delete the now-dead crate-pin seds and the `sed_in_place` helper they were the only caller of, and drop the three crate manifests from the release commit's `git add` list
- [x] Confirm a scratch bump to `0.2.0` resolves and checks — **and confirm it failed before the fix**: `failed to select a version for the requirement oristudio-cp = "^0.1.1"` / `candidate versions found which didn't match: 0.2.0`
- [x] Record credential expiry dates in `RELEASE.md` under a "Clocks" heading

**Needs you (credentials / GitHub admin):**

- [ ] Export the Apple Developer ID `.p12` as base64 (`openssl base64 -A -in DeveloperIDApplication.p12`) and add it as `APPLE_CERTIFICATE`, with `APPLE_CERTIFICATE_PASSWORD`
- [ ] Create an App Store Connect API key and add `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_CONTENT` (revocable and scoped, unlike the Apple-ID + app-specific-password triple — keep that triple in `.env.release.local` for break-glass)
- [ ] Add `VITE_PUBLIC_POSTHOG_KEY` / `VITE_PUBLIC_SENTRY_DSN` so desktop builds are not telemetry-blind
- [ ] Add a `v*` tag deployment rule to the `release-signing` environment (the workflow already references it; with no rules it is just a scope)
- [ ] **Enable the existing "Protect main" ruleset** — it exists (`id 16904925`) and is `"enforcement": "disabled"`
- [ ] **Add a tag ruleset** on `refs/tags/v*` with "Restrict creations" and a bypass list containing only your account — this, not the environment gate, is what actually prevents a leaked token from minting a release tag

### Phase 1 — The build pipeline

- [x] `scripts/build-frontend.mjs` shim honoring `ORI_PREBUILT_FRONTEND=1`, with an existence check on `apps/web/dist/index.html` (without it, a dropped artifact silently ships an app with no frontend). Both branches tested
- [x] Repoint `beforeBuildCommand` at it; add a `tauri` script to `apps/tauri/package.json`
- [x] Replace `bundle.targets: "all"` with `["app","dmg","nsis","deb","appimage"]` — no MSI, no RPM
- [x] Delete the broken `workflow_dispatch` version branch (whole workflow rewritten)
- [x] `workflow_dispatch` matrix with a platform selector, **signed**, uploading via `uploadWorkflowArtifacts`
- [x] `Swatinem/rust-cache` with `workspaces: '. -> target'`, and `save-if: false` in the signing job
- [x] Run `node scripts/verify-analytics-build.mjs apps/web/dist` after the frontend build
- [ ] ~~Linux leg in `container: ubuntu:22.04`~~ — using `runs-on: ubuntu-22.04` instead for the first working build, since the container was the plan's own highest-risk line and cannot be tested from here. The glibc floor is the same (2.35); what differs is that the label is on GitHub's deprecation clock. **The 2026-09-17 deadline is written into the workflow as a comment**, along with a warning not to "fix" it by bumping to 24.04
- [x] Green on all four legs — run 32065856218: macOS aarch64 + x86_64 signed, notarized (Apple: `Accepted`) and stapled, Windows NSIS, Linux deb + AppImage. The CI-built DMG was downloaded and independently checked: `spctl` returns `accepted / source=Notarized Developer ID`

### Phase 1b — Shared release library

- [x] `scripts/release-lib/read-workspace-version.sh` — `[workspace.package]`-scoped, replacing two readers that took the *first* `^version = ` line and were correct only by file ordering
- [x] `scripts/release-lib/check-versions.sh` — all four files, worktree or a git ref
- [x] `scripts/release-lib/extract-changelog.sh` — one copy of the scraper that existed in three places; exits 2 on a missing section and rejects a body containing `## [`
- [x] All three exercised locally, including against a git ref and in their failure modes

### Phase 2 — Signed release on tag push

- [x] `validate` job: version agreement, CHANGELOG, ancestry (the hotfix branch **asserts** rather than printing a notice — the old gate must not regress), and **CI green at the SHA**, which closes the hole where a hotfix tag ships having had no tests run
- [x] `draft` job creating/reusing a draft release, once, rather than four legs racing
- [x] `frontend` job producing `web-dist` once
- [x] `build` matrix: macOS `aarch64` + `x86_64`, Windows NSIS, Linux AppImage + `.deb` — emitted as a full `{"include": […]}` object from `validate`, because a static `include:` filtered by a name list **creates** combinations rather than dropping them, so a one-platform request would have built all four
- [x] Apple keychain import with `security set-key-partition-list` and a random per-run keychain password, plus an `if: always()` cleanup deleting the keychain and the `.p8`
- [x] Port `local-macos-release.sh`'s verification, and extend it with `xcrun stapler validate`
- [x] Print the signing identity's expiry and `::warning::` under 60 days
- [x] **Pin every third-party action by full 40-char SHA**, `dtolnay/rust-toolchain` included
- [x] `save-if: false` on the cache in the signing job
- [x] Pin a SHA-256 for the wasm-pack tarball, verified before extraction, fatal rather than retried
- [x] `scripts/release.sh publish` inverted to tag-and-push by default; local build is now `--local-build`, and the closing message tells you the prerelease → arm sequence
- [x] `local-macos-release.sh` gains a break-glass header stating what it does **not** produce
- [ ] `publish` job asserting an **exact expected-name map per platform** — currently the draft is published by hand, so a missing platform is visible but not enforced
- [x] Artifact upload done by an explicit `actions/upload-artifact` with `if-no-files-found: error`, not tauri-action's uploader — that one creates an artifact *per file* from a name pattern and its Linux list contains the AppImage twice, so every run 409'd
- [ ] Generate `SHA256SUMS` (one file; the old `sha256-<arch>.txt` scheme collides between `x86_64-apple-darwin` and `x86_64-pc-windows-msvc`)
- [ ] Add a CI grep asserting no `uses:` in `release.yml` matches `@v\d|@main|@stable|@master`, so the SHA pinning cannot rot

### Phase 3 — Discovery

- [ ] Download route/section with OS sniffing, four buttons, `SHA256SUMS`, and the SmartScreen note
- [ ] Delete/invert the `WelcomeLanding.test.tsx:109` assertion; update the `WelcomeLanding.tsx:38-39` comment and `README.md:26-28`
- [ ] Wire `RELEASES_URL` (currently unused) into the download surface
- [ ] `download clicked { platform }` analytics event
- [ ] i18n across 8 locales
- [ ] Submit the first winget manifest by hand; wire `winget-releaser` for subsequent bumps
- [ ] Note in the first release notes that existing 0.1.2 users must download once manually; keep or redirect the `OriStudio_latest_*` alias

### Phase 4 — `/ori-release`

`.agents/skills/ori-release/SKILL.md`. The `ori-` prefix is deliberate: an
`openscad-release` skill is installed globally at `~/.claude/skills/` and will
otherwise compete for every "release version 0.3.0" prompt.

- [ ] Preconditions: `git rev-parse --show-toplevel` as the only path prefix; `gh auth status`; clean worktree — and report the offending paths itself, since `require_clean_worktree` (`release.sh:81-85`) counts **untracked** files and `build:web` deletes the tracked `apps/web/dist/.gitkeep`
- [ ] Four-way state detection: tag exists / **release in flight** / merged PR no tag / fresh
- [ ] PR range via merge commits — the repo uses merge commits, not squash, so `git log --merges --pretty=%s "v$LAST..origin/main" | grep -oE '#[0-9]+'`. Conventional-commit prefixes and PR labels are both unavailable, so the classifier reads titles and bodies
- [ ] Draft notes grouped by user-facing surface, 5–10 bullets regardless of PR count, refactors/tests/CI/docs dropped. Verify no line begins with `## [` — that truncates the section for both the CI validator and the public release body
- [ ] If nothing survives the filter: report "no user-visible change — recommend skipping this week" and stop
- [ ] Human gate on version + notes exactly as they will appear publicly
- [ ] `./scripts/release.sh prepare <v> --notes-file "$tmp" --yes` — **both flags mandatory**; `--yes` covers the `confirm` at `:449` but *not* `collect_release_notes` (`:141-160`), which falls through to a bare `cat` from stdin and blocks forever. Scratch files go to `mktemp` outside the tree
- [ ] Check the branch back out after `prepare` (it leaves the worktree on `release/vX` for days, with parallel agents in the same tree)
- [ ] Stop. Tagging is a separate invocation after a human merges
- [ ] Phase 9 reports the run URL and **stops** rather than blocking on `gh run watch` for 50 minutes across an approval, three builds and Apple's notarization queue
- [ ] Separate `/ori-release status <version>` entry point querying jobs, draft/prerelease state, asset set and the `verify` conclusion — this is also what the in-flight recovery path needs, and it is how an un-armed release stays visible
- [ ] `/ori-release arm <version>` wrapping `gh release edit --prerelease=false`, gated on a human confirming they installed and launched the build
- [ ] Guardrails: never merge the release PR, never push to `main`, never tag before merge, never read or print any credential, never force-push or re-point a tag, never build locally, never claim a change the merged PRs don't support
- [ ] Dry-run it against the *previous* release range first — have it draft notes for v0.1.2 from real PRs and compare to what actually shipped
- [ ] A scheduled Thursday workflow that opens an issue if no tag was pushed in 8 days — the only thing that will tell you the cadence has decayed

**Done when:** two consecutive Thursday releases have been cut end-to-end by
`/ori-release`, with the human touching only: approve the notes, merge the PR,
and install-and-launch the artifacts.

## Deferred

| Item | Trigger |
| --- | --- |
| **Windows code signing** (Azure Trusted Signing, ~$10/mo) | SmartScreen measurably costs conversion. Uses `bundle.windows.signCommand` rather than a folder-signing action, because Tauri needs inner binaries signed *before* NSIS packaging and the installer signed after. The `Artifact Signing Certificate Profile Signer` role must be assigned to the **service principal**, not your user account. |
| **`.rpm`** | Fedora/openSUSE users ask |
| **Flathub** | Linux exceeds ~15% of installs. Decide the app identifier before 1.0 — `com.zacharymarion.oristudio` requires owning and verifying `zacharymarion.com`; changing a Tauri identifier post-ship moves config/window-state paths and breaks `.osf` associations. The blocker is that `wasm-pack` downloads binaries and Flathub builds are fully offline. |
| **Homebrew cask** | Cheap. Casks for self-updating apps set `auto_updates true` so brew and the in-app updater don't fight |
| **Splitting build-from-sign into isolated jobs** | ~400 crates' `build.rs` currently execute in the job holding the signing keys. `Cargo.lock` being committed is the real mitigation |
