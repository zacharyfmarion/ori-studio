# Desktop Auto-Update

## Goal

A quiet, persistent **"Relaunch to update · v0.3.0"** affordance in the desktop
app, in the style of Claude Desktop: the update downloads in the background, the
chip appears only once relaunching will actually work, and one click restarts
into the new version.

Depends on [desktop-ci-release.md](desktop-ci-release.md), which produces the
signed artifacts this consumes.

## The contract

**The affordance says "Relaunch to update", so it must appear only when
relaunching will work right now** — no further download, no password prompt, no
trip to a browser. Everything below is derived from that sentence, and it is the
thing to check any future change against.

Two consequences worth stating up front:

- `downloadAndInstall()` is **forbidden**. It collapses download and install into
  one call and destroys the affordance. Use the split `download()` / `install()`.
- The unsaved-work guard lives in the **chip's click handler**, not the window
  close handler: on Windows `install()` exits the process and `onCloseRequested`
  never fires.

## Approach

### The one unrevocable secret

The updater public key is compiled into every binary via `generate_context!()`.
There is no flag, config value, or server response that disables verification.
This has two consequences that shape the whole design:

- **Losing the private key strands the entire install base.** Clients will find
  the update, download it in full, fail verification, and stay put — silently,
  forever.
- **Stealing the private key is remote code execution on every install.** An
  attacker who can also serve a manifest needs nothing else.

Unlike the Apple certificate, it cannot be revoked and reissued.

**Decided: the minisign private key lives in GitHub Actions secrets.**

This reverses the original decision, which was to keep it on the laptop and sign
the manifest locally after CI built the artifacts. That is not something Tauri
supports, and the first real release proved it: every one of the four platform
legs failed with

    A public key has been found, but no private key.
    Make sure to set `TAURI_SIGNING_PRIVATE_KEY` environment variable.

Tauri signs updater payloads **during the build**, and refuses to emit them at
all when a `pubkey` is configured and the private key is absent. It is not
limited to the `.app.tar.gz`: `.nsis`, `.deb` and `.AppImage` are themselves
update payloads and hit the same gate, so the failure is every platform, not
just macOS. The one escape hatch, `--no-sign`, skips Apple code signing too, so
it trades an unsigned update for an unnotarized app.

That leaves two possibilities, and the rejected one is worth recording. CI could
stop producing anything the updater can consume, and the payloads could be
hand-assembled locally from the published installers — re-tarring the notarized
`.app` out of the DMG, zipping the NSIS installer. It keeps the key off GitHub,
and it makes every release depend on a hand-built payload that CI never produced
and nothing verifies. That is a worse trade than it looks.

**So the control moved rather than disappeared.** The key's location was never
the real defence; what gates a signed build is *who can create a `v*` tag*. A
ruleset on `refs/tags/v*` with "Restrict creations" and a bypass list of one
account is what actually stops a leaked token minting a release — and it stops it
whether or not the key is in CI. That ruleset is no longer optional hardening; it
is the control. See [desktop-ci-release.md](desktop-ci-release.md) Phase 0.

What is genuinely given up: a compromise of the repository's Actions environment
now reaches a secret that cannot be revoked. The mitigations are the tag ruleset,
SHA-pinned actions, no shared build cache in the signing job, and `Cargo.lock`
being committed — none of which make it as good as the key never being there.

Key handling:

- Generate with a password. Store in **three** independent places: password
  manager (key and password as separate entries), offline media, and one more.
  Never in `.env.release.local` — Tauri's docs are explicit that dotenv files do
  not work for this.
- **Do a restore drill now, and quarterly.** Take the *offline* copy, sign a
  scratch file, verify with `minisign -V` against the `.pub`. A backup you have
  never restored is a belief.

### Endpoint: GitHub Releases, and nothing else

One endpoint, compiled in:

```
https://github.com/zacharyfmarion/ori-studio/releases/latest/download/latest.json
```

The endpoint list is compiled into the binary, the same as the public key, and is
immutable after release. Every copy of Ori Studio ever shipped asks exactly the
URLs that were in `tauri.conf.json` when it was built, forever. Changing them
requires shipping an update, which requires the old endpoint to still work — so
the endpoint is a permanent commitment and should be the most durable URL
available.

That URL is durable: verified `302 →
/releases/download/v0.1.2/<asset>`. GitHub redirects repo and account renames
indefinitely, and the only way to lose it is deleting the repository. This is a
much weaker commitment than a `*.pages.dev` subdomain, which is welded to one
Cloudflare Pages project — Cloudflare's docs state it cannot be changed, and there
are user reports of a subdomain being lost and unrecoverable after an account
migration. A custom domain would fix that, but only by introducing a domain
registration, a Pages Function, a KV namespace, and a failure mode described
below — to buy capabilities that GitHub gives natively.

### The two levers, native to GitHub Releases

The GitHub REST docs define it exactly: *"The latest release is the most recent
non-prerelease, non-draft release, sorted by the `created_at` attribute."*
`releases/latest/download/latest.json` therefore resolves to the newest release
that is neither a draft nor a prerelease. Both gates fall straight out of that:

**Arming = flipping off prerelease.** CI publishes the release as a **prerelease**
with every asset attached. Prerelease assets are publicly downloadable, so you can
install and test the real artifact — but `releases/latest` skips it, so no client
is offered anything. When you have launched it:

```bash
gh release edit v0.3.0 --prerelease=false
```

That single command is the arm. Nothing is offered until a human has run the
build.

**Killing = flipping it back.**

```bash
gh release edit v0.3.0 --prerelease=true
```

`releases/latest` immediately falls back to the previous good release, so offers
stop and clients still on the older version are correctly told there is nothing
new. Use `--draft` instead to also pull the assets from public download.

Both levers are instant, need no infrastructure, and — unlike a KV kill switch —
cannot fail open, because there is no second endpoint to fall through to.

### What this gives up, and the migration path if it ever matters

Lost: per-version routing (for example "0.2.x must take 0.3.0 before 0.5.0"),
which would need a dynamic endpoint. It is speculative today and there is a clean
way to add it later — ship a release that puts a dynamic endpoint first and keeps
the GitHub URL as the fallback. Clients that take that update get the new list;
stragglers keep working on GitHub-only forever. Non-fatal, unlike losing a
compiled-in URL.

**If that day comes, one trap is waiting.** Tauri advances to the next endpoint
only on a **non-2XX** status, and this project's Cloudflare Pages deployment
returns `index.html` with **status 200** for unmatched paths. So a dynamic
endpoint that is misconfigured, renamed by an unrelated frontend refactor, or not
yet deployed would return 200-of-HTML, fail to parse, and **never fall through to
GitHub** — killing update checking fleet-wide with no client-side fix. Adding a
dynamic endpoint therefore requires, in this order: a
`functions/api/update/[[path]].ts` catch-all returning non-2XX so the SPA fallback
can never answer the route, an `update-smoke.mjs` step in `deploy-web.yml`
asserting `content-type: application/json` (on content, not status — Pages status
codes prove nothing here), a handler wrapped in try/catch returning `204`, and
hand verification before any binary ships with it.

None of that is needed now. It is written down so that adding the Function later
is a known quantity rather than a rediscovery.

### Arming is the verification gate, not a timer

**Publish always; arm only after you have launched the thing.** A release sits as
a prerelease — fully downloadable, offered to nobody — until you have installed it
yourself. That is the structural idea, and the prerelease flip above is its whole
implementation.

Deliberately **no** auto-arm timer. With a Cloudflare control plane an auto-arm at
+72h was worth having, because a forgotten release was invisible. Here a
prerelease is visible on the releases page and in `/ori-release status`, and an
un-armed release is a *safe* state, not a broken one — users can still download it
manually, and the web app is unaffected. A timer would only convert "I forgot to
verify" into "it shipped unverified." If a release goes unarmed for a week, the
scheduled cadence-decay issue (see [desktop-ci-release.md](desktop-ci-release.md))
is what should notice.

Percentage rollout is deliberately not used either: the plugin sends no stable
per-install identifier, so a bucket is resampled on every check and a "10%
rollout" reaches roughly half the population in a day. A state gate needs no
identity.

### The manifest is composed once and verified against the shipped pubkey

`uploadUpdaterJson: false` on `tauri-action` — it generates `latest.json` per
matrix job by read-modify-write, and near-simultaneous jobs race and silently drop
a platform.

A single `manifest` step composes it, discovering assets **by regex against the
release's actual asset list**, never by predicting the bundler's output filename.
Then, before publishing:

- Verify **this release's own `.sig` files** with `minisign -V` against the
  `pubkey` string read out of `apps/tauri/src-tauri/tauri.conf.json`. `check()`
  verifies nothing — verification happens inside `download()`, at the *end* of a
  completed download on a user's machine. A pubkey/private-key mismatch is
  otherwise invisible until the entire install base has downloaded a full update
  and failed. This is the only check that catches a bricked fleet before it ships.
- **Assert the cardinality.** A `while read` loop over an empty file exits 0 and
  the job goes green. If asset discovery misses the real filenames, verification
  "passes" having done nothing. Assert the expected count before the loop and that
  `minisign` ran exactly that many times.
- Extract the macOS `.app.tar.gz` and run `xcrun stapler validate` and
  `spctl -a -vvv -t install` on the extracted `.app`. This is the artifact 100% of
  macOS users actually execute, and minisign attests bytes, not notarization — an
  unstapled `.app` inside the updater tarball passes Gatekeeper online and hangs on
  a machine with no network.

`publish` must declare `needs: [draft, build, manifest]`. Without it both jobs
start when `build` finishes, `publish` lists assets before `latest.json` is
uploaded, fails its completeness check, and the release stays draft forever while
`manifest` reports green.

`publish` flips the draft to a **prerelease**, not to latest. Arming is the
separate human step above.

Tauri validates the **entire** manifest before checking `version`, so a malformed
Windows entry breaks macOS updates too. That is why it is generated
programmatically and re-parsed from outside by the post-publish `verify` job,
which HEADs every platform URL and **re-drafts the release on failure**. Note that
with the prerelease gate this job is now a backstop rather than the last line of
defence: a release that fails `verify` was never offered to anyone, because it was
never armed.

### Linux: AppImage self-updates, `.deb` is notify-only

`latest.json` has exactly one `url` under `linux-x86_64` and no per-bundle-type
resolution. The updater can install a `.deb`, but only via `pkexec` — a system
root-password dialog, weekly, which is how you teach people to disable updates.

Gate it in Rust, and **fail closed** — treat unknown as unsupported, so a wrong
answer costs a manual download rather than a weekly root prompt:

```rust
pub fn self_update_supported() -> bool {
    #[cfg(target_os = "linux")]
    { std::env::var_os("APPIMAGE").is_some() }
    #[cfg(not(target_os = "linux"))]
    { true }
}
```

Assert that `APPIMAGE` is actually set by Tauri's AppImage output in the first
Linux smoke run rather than assuming it.

This leaves an uncomfortable inversion, and it is accepted rather than solved:
**the Linux format that self-updates has the worst desktop integration.** AppImage
registers no `.desktop` entry and no MIME type by default, so `.osf` double-click
works for `.deb` users who must update by hand, and not for AppImage users who
update automatically.

### The manual fallback is the insurance policy

`latest_version_only()` — a plain Rust `reqwest` GET returning a version string —
is built as a first-class path on **every** platform, not as a Linux quirk. It is
the `.deb` affordance, and it is the only thing standing between "lost the signing
key" and a silently frozen install base: the product degrades to *tells you an
update exists and opens the download page* rather than to nothing.

It must **never accept a URL from the endpoint.** Return `{version}` only and
construct the destination client-side from the existing `RELEASES_URL` constant.
A server-controlled `notes_url` on an unsigned endpoint is an open-redirect and
phishing primitive — a page styled as Ori Studio serving a trojaned `.deb` needs
no signing key at all.

### Freeze protection

minisign gives integrity, not freshness. Anyone able to write release assets could
serve a manifest naming an **older, legitimately signed** release; every signature
check passes. `allowDowngrades: false` only refuses versions below what is
*installed*, so a fleet on 0.2.0 could be pinned at 0.3.0 indefinitely while 0.5.0
ships the fix.

Persist the highest version ever *offered* in `lib/storage.ts` and discard any
check result below it, reporting `stale_manifest`.

### The chip

| State | Chip | Why |
| --- | --- | --- |
| `idle` / `checking` | absent | A check the user didn't ask for must not render |
| `downloading` (automatic) | **absent** | Progress for something nobody requested is a nag |
| `downloading` (user-initiated) | progress | They clicked; they're owed feedback |
| `available`, auto-download off | `● Update available · v0.3.0` → downloads | Honest: the verb is "download" |
| **`ready`** | **`● Relaunch to update · v0.3.0`** | The state this exists for |
| `installing` | same text, spinner, disabled | |
| `unsupported` (`.deb`) | `● v0.3.0 available · Download` → releases page | |
| `failed` | absent unless user-initiated → toast | |

Caret menu: **What's new** / **Skip v0.3.0** / **Remind me later** (session only).
Skip hides the chip; it does not discard the staged download.

**Timing.** First check T+60s after `App` mount, not on mount — cold start already
contends with four wasm bridges plus the simulator. Then every 4h,
**wall-clock-guarded** (`Date.now() - lastCheckedAt >= 4h`) plus the same guarded
check on `visibilitychange → visible`. A laptop that sleeps for two days must
check on wake, not on tick 12.

**Failure is silent.** Network failure on an automatic check shows nothing and
goes to PostHog only. Signature verification failure is the one automatic failure
that also goes to Sentry — it means a corrupted CDN object or an attack. The app
is fully functional offline and has no `navigator.onLine` check anywhere; do not
add one.

**A staged update must be revocable.** Un-arming stops *new* offers and does
nothing about the population that already downloaded and hasn't relaunched —
which, given a staged update sits for hours to days, is most of the exposed
population. While an update is staged, re-check on a short interval; if the
manifest now names a different version, or the check errors persistently, drop the
staged update and clear the chip. This is the difference between a kill switch and
a kill suggestion, and the prerelease flip does not provide it on its own.

**Placement.** `components/UpdateChip.tsx` in `.toolbar__brand`
(`WorkspaceShell.tsx:119-122`), inside the existing
`<ErrorBoundary surface="shell:toolbar" variant="strip">`. Not `.toolbar__actions`
— it is `flex-wrap: wrap; overflow: hidden` and would wrap Optimize/Send onto a
second row.

**Do not touch `connect-src`.** The updater's HTTP is `reqwest` in Rust, outside
the webview. Add a comment at `tauri.conf.json` saying so — the failure mode is a
future contributor "fixing" an updater bug by widening the CSP. This holds only as
long as every one of these paths stays in Rust; if "What's new" becomes a JS
`fetch`, the CSP blocks it with no `*` fallback.

**Reuse the dirty-document predicate.** `App.tsx:94` (`beforeunload`) and
`App.tsx:105` (`onCloseRequested`) already own this question with this dialog.
AGENTS.md's rule is "one predicate per question," and its cited failure mode is a
near-copy in a component. Extract `confirmDiscardUnsaved()` and call it from all
three sites.

### A dead updater must be visible

Six events that fire only when something happens cannot distinguish "every client
has been failing to reach the manifest for a month" from "no release this week."
Add `app update checked { result: 'none' | 'available' | 'error', check_source }`
on every completed check, and alert on **absence** — `result: 'available'` below
threshold within 6h of arming a release.

### Version skew, which auto-update creates

`lib/nativeProjectFile.ts` carries `schemaVersion` and a
`minimumReaderSchemaVersion` gate that hard-rejects a newer file (`:439`). Until
now everyone was on whatever they last downloaded. With a weekly train and a
**Skip this version** button, the population spreads across many schema versions
within two months.

A user who skipped four Thursdays opens a collaborator's file and gets *"requires
reader schema 9, but this app supports 8"* — with the update already staged on
their disk. When that error is a `minimumReaderSchemaVersion` rejection and the
update store is `ready`, the error surface must offer **Relaunch to update**
inline. And `/ori-release`'s `### Breaking` trigger should key on
`NATIVE_PROJECT_SCHEMA_VERSION` changing in range — a mechanical diff — rather
than a fuzzy "touches the `.osf` codec."

## Affected Areas

| Area | Files |
| --- | --- |
| Tauri shell | `apps/tauri/src-tauri/{Cargo.toml,tauri.conf.json,capabilities/default.json,src/lib.rs}`, new `src/updater.rs` |
| Release | new `scripts/release-lib/compose-manifest.mjs`, new `scripts/publish-updater-manifest.sh`, `.github/workflows/release.yml` |
| Frontend | new `platform/updateService.ts`, `store/updateStore.ts`, `hooks/useUpdateCheck.ts`, `components/UpdateChip.tsx`; edits to `App.tsx`, `WorkspaceShell.tsx`, `App.css`, `SettingsModal.tsx`, `HelpModal.tsx`, `menus/menuDefinition.ts`, `menus/nativeMenu.ts:132-153`, `commands/menuActions.ts`, `lib/storage.ts`, `analytics/events.ts` |
| Docs | `RELEASE.md` (incident runbook, key restore drill) |

## Checklist

### Phase 1 — Keys

- [ ] Generate the keypair with a password; three independent copies; **restore drill from the offline copy**
- [ ] Confirm `releases/latest/download/latest.json` resolves as expected against a scratch prerelease: create a prerelease and assert `releases/latest` still points at the previous release, then flip it and assert it moves

### Phase 2 — Updater artifacts and manifest

- [ ] `tauri-plugin-updater` (target-gated) and `tauri-plugin-process`; register both
- [ ] `capabilities/default.json` gains `updater:default` and `process:allow-restart`
- [ ] `tauri.conf.json`: `createUpdaterArtifacts: true`, `pubkey` (content, not a path), the single GitHub endpoint, `windows.installMode: "passive"`
- [ ] `apps/tauri/src-tauri/src/updater.rs`: `self_update_supported()` and `latest_version_only()` returning **version only**
- [x] `compose-manifest.mjs` discovering assets by regex against the actual asset list, refusing any platform whose `.sig` is missing
- [x] `scripts/publish-updater-manifest.sh` — composes `latest.json`, inlines the `.sig` contents CI produced, and verifies each against the compiled-in pubkey before uploading
- [ ] minisign verification against the pubkey read from `tauri.conf.json`, **with a cardinality assertion**
- [ ] Extract the `.app.tar.gz` and run `stapler validate` + `spctl` on the extracted `.app`
- [ ] `publish` gains `needs: [..., manifest]`, flips the draft to a **prerelease**, and carries `latest.json` / `.sig` in its expected-name map — an exact count per platform, since one `.sig` otherwise satisfies a `/\.sig$/` check for all three
- [ ] Post-publish `verify` job that fetches from outside and re-drafts on failure
- [ ] `local-macos-release.sh`'s header states honestly that break-glass produces a downloadable DMG only, and that the manifest for that release must be composed by hand or omitted

**Done when:** the release lands as a prerelease with `latest.json` attached,
`minisign -V` passes against the config pubkey for every updater bundle, `verify`
passes from outside, deliberately deleting an asset causes `verify` to re-draft,
and `gh release edit --prerelease=false` demonstrably starts the offer while
`--prerelease=true` demonstrably stops it.

### Phase 3 — The chip

- [ ] `platform/updateService.ts` beside `fileService.ts`; every `@tauri-apps/plugin-updater` import is a dynamic `import()` inside an `isDesktopRuntime()` guard so the web bundle never pulls it in
- [ ] `store/updateStore.ts` as a top-level single-purpose store, not a `workspaceStore` slice
- [ ] `hooks/useUpdateCheck.ts` with a **module-level once-guard, not a ref**, so StrictMode's double-mount cannot refire; exports `resetForTest`
- [ ] `components/UpdateChip.tsx` in `.toolbar__brand`, inside the existing ErrorBoundary; mobile collapses to the dot
- [ ] Staged-update revocation on a short re-check interval
- [ ] Highest-version-seen persistence and `stale_manifest` rejection
- [ ] Extract `confirmDiscardUnsaved()`; call it from the chip, `beforeunload` and `onCloseRequested`
- [ ] `lib/storage.ts` keys: `updateAutoDownload`, `updateSkippedVersion`, `updateHighestSeenVersion`
- [ ] Settings ▸ General ▸ Updates: **Automatic / Notify only / Off**, "Check now", "Last checked", current version. Tauri has no delta updates, so every check is a full download; a user on hotel wifi needs a way to stop it
- [ ] Measure the payload size before defaulting to automatic; if it is large, default to notify-only
- [ ] Menu entry in `menuDefinition.ts`, desktop-gated — **and `menus/nativeMenu.ts:132-153`**, since the macOS app submenu is hand-built and not generated from `menuDefinition`
- [ ] Surface the current version in `HelpModal.tsx` — `APP_VERSION` is rendered nowhere in the UI today, which is odd if the chip names v0.3.0 while nothing says you're on v0.2.0
- [ ] Inline `Relaunch to update` on a `minimumReaderSchemaVersion` rejection when an update is staged
- [ ] Add an `App.layout.test.ts` assertion that `useUpdateCheck()` is mounted — this is exactly the untested-wiring shape that has bitten before
- [ ] Analytics: `app update checked` (the heartbeat), `available`, `download started`, `downloaded`, `relaunched`, `failed`, `dismissed`. New `install_kind` enum (`app`/`nsis`/`appimage`/`deb`/`other`). `pending_ms` needs an hours-to-days bucket ladder and is *the* metric that says whether the affordance works. Do not resend `app_version` / `app_commit` / `runtime_surface` — already super properties. Do not double-instrument the menu action; `handleMenuAction` already captures it
- [ ] PostHog alerts: `app update failed { reason: 'signature' }` (fleet-wide key mismatch), and **absence** of `app update checked { result: 'available' }` after a publish
- [ ] i18n: realistically 25–35 keys × 8 locales, and `i18n:check` fails on a missing *or empty* value. **What's new** opens English CHANGELOG text in an app that localizes its whole menu bar — either link to the Releases page or label it as English

**Done when:** an installed v0.2.0 on macOS, Windows and Linux-AppImage shows
`Relaunch to update · v0.3.0` within 60s of launch; one click relaunches into
0.3.0 with no admin prompt; a `.deb` install shows the Download variant; unplugging
the network produces no UI at all; a dirty document routes through the existing
confirmation; and a deliberately corrupted `.sig` produces `reason: 'signature'`
rather than an install.

## Incident runbook

Put this in `RELEASE.md` as an ordered list, and drill it quarterly alongside the
key restore.

**A bad release is live** (i.e. armed — you flipped off prerelease and people are
taking it):

1. `gh release edit v0.X.0 --prerelease=true` — `releases/latest` immediately falls
   back to the previous good release, so offers stop. Add `--draft` instead if you
   also want the assets pulled from public download.
2. Confirm: `curl -sI https://github.com/zacharyfmarion/ori-studio/releases/latest`
   should now redirect to the previous tag.
3. Hotfix off the tag within hours — clients reach it inside one 4h poll.

Note step 1 does **not** un-stage the update for anyone who already downloaded it;
that is what the client-side staged-update revocation above is for. This is the
main reason arming late matters more than killing fast.

**Rollback, stated plainly: you cannot pull anyone back.** The updater refuses
downgrades and `allowDowngrades` is compiled into the client. Rollback for
installed clients means a forward patch. If the bad build cannot launch at all, no
server-side lever reaches those users — which is why the DMG/EXE/AppImage stay
first-class assets and why the web app, deployed from `main` independently of this
pipeline, is a genuine asset.

**The signing key is lost.** There is no recovery. The install base stops
updating silently. `latest_version_only()` degrades the product to "tells you an
update exists and opens the download page." Everyone must reinstall manually to
get onto a new keypair.

## Risks accepted

1. **The Apple certificate lives in GitHub Actions secrets, in the same job that
   compiles ~400 third-party crates.** `build.rs` runs with full runner privileges
   alongside the `.p12`. Accepted because keeping macOS on a laptop costs more in
   producer drift than it buys in blast radius, and because the certificate is
   revocable. Mitigated by `Cargo.lock` being committed, the tag ruleset, SHA-pinned
   actions, no shared build cache in the signing job, and never adding a
   `pull_request_target` workflow. The minisign key is treated differently
   precisely because it is *not* revocable.
2. **The Linux build that self-updates has the worst desktop integration, and vice
   versa.** Resolving it means custom updater targets that `tauri-action` will not
   generate — real Rust work for an audience that is currently a rounding error.
3. **`entitlements.plist` grants `com.apple.security.cs.allow-unsigned-executable-memory`
   fleet-wide.** Required for the wasm JIT and not introduced here, but it means a
   memory-safety bug yields RWX pages under the hardened runtime — worth noting now
   that an always-on network channel is being added to the same process.

## Verify, don't assume

| Uncertainty | How the design absorbs it |
| --- | --- |
| Whether the Linux updater artifact is `*.AppImage` + `.sig` or `*.AppImage.tar.gz` + `.sig` | `compose-manifest.cjs` discovers by regex accepting both; delete the dead branch after one real run |
| How `releaseAssetNamePattern` treats `.sig` and doubled extensions | Never predict a filename; read the release's actual asset list |
| Whether `--bundles updater` is a valid v2 CLI value | Rely on `bundle.createUpdaterArtifacts`; confirm the artifacts appear before wiring the manifest |
| Whether one client accepts the flat dynamic manifest *and* the nested static one across a fallback | Deliberately 500 the Function and confirm the client updates from GitHub |
| Whether `APPIMAGE` is set by Tauri's AppImage output specifically | Assert in the first Linux smoke run; fail closed |
| Whether `tauri-action` deletes-then-uploads or 422s on an existing asset name | Verify before depending on `gh run rerun --failed` as the in-flight recovery path |
