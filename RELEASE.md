# Release Checklist

Ori Studio has three release surfaces:

- Cloudflare Pages web deployment at `https://oristudio.pages.dev/`.
- Signed and notarized Apple Silicon DMGs on GitHub Releases.
- Rust crates for the reusable TreeMaker engine, CLI, FOLD helpers, and WASM
  bridge.

## Web App

The `Deploy Web App` workflow deploys `apps/web/dist` to Cloudflare Pages on
pushes to `main` and on manual dispatch.

Required GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The Cloudflare Pages project name is `oristudio`; the production URL is
`https://oristudio.pages.dev/`. Pull request previews are deployed from
non-fork PRs to `https://pr-<number>.oristudio.pages.dev/`.

## Desktop App

Desktop builds are produced by the **Desktop Build** workflow
(`.github/workflows/release.yml`). It is the only thing that makes an artifact;
`scripts/local-macos-release.sh` is break-glass only (see below).

### One-off builds for testers

Run the workflow manually — Actions ▸ Desktop Build ▸ Run workflow — against any
branch. Pick a platform set if you only need one leg. Artifacts appear on the
workflow run's Summary page: a `.dmg` per macOS architecture, an NSIS
`-setup.exe`, a `.deb`, and an `.AppImage`.

Nothing is tagged, nothing is published, and no user is offered an update. This
is the path for sending builds to people who can test the platforms you cannot.

macOS builds are signed and notarized whenever the Apple secrets are present.
Without them the run still succeeds and emits an **unsigned** `.app`, which
Gatekeeper will refuse to open anywhere but the machine that built it — the run
logs a warning saying so.

### Releases

```sh
./scripts/release.sh prepare 0.3.0    # branch, bump, changelog, PR
# ...a human reviews and merges...
./scripts/release.sh publish 0.3.0    # verify the merge, tag, push
```

Merge nothing else to `main` between merging the release PR and `publish` —
see [why below](#do-not-merge-to-main-while-a-release-is-in-flight).

The pushed tag triggers the same build, which additionally uploads to a GitHub
Release created as a **draft**. From there it is four steps, and the order
matters:

```sh
# 1. Publish the draft as a PRERELEASE.
gh release edit v0.3.0 --draft=false --prerelease=true

# 2. Compose, verify and attach the updater manifest. Nothing in CI does this.
./scripts/publish-updater-manifest.sh 0.3.0

# 3. Install the build yourself and confirm it launches.

# 4. Arm it. This is what starts offering the update to users.
gh release edit v0.3.0 --prerelease=false
```

`releases/latest` skips drafts and prereleases, so until step 4 runs the
release is downloadable but offered to nobody. That is the soak gate, and it is
also the kill switch — flipping `--prerelease=true` puts `releases/latest` back
on the previous good release.

#### Step 2 is mandatory, and its position is not arbitrary

`latest.json` is the updater manifest: the one file the desktop updater reads
to learn a new version exists. **No CI job composes it.** The
`uploadUpdaterJson: false` comment in `release.yml` says it is "composed once by
a later job instead", but that job was never built — the `manifest` and
`publish` items are still unchecked in
[implementation-plans/desktop-auto-update.md](implementation-plans/desktop-auto-update.md).
`scripts/publish-updater-manifest.sh` is the live path. It composes the manifest
from the release's actual assets, inlines the `.sig` contents CI produced, and
checks each one against the pubkey compiled into the app before uploading — a
pubkey/private-key mismatch is otherwise invisible until the whole install base
has downloaded an update and refused it.

It needs `minisign` on top of the usual `gh`, `jq` and `node`:

```sh
brew install minisign
```

The window between steps 1 and 4 is the only time it will run:

- **After** the draft becomes a prerelease. The script hard-errors on a release
  whose `isPrerelease` is not `true`, because replacing `latest.json` under a
  live release hands a changed manifest to clients mid-poll.
- **Before** arming, because arming is what makes this release
  `releases/latest` — which is exactly where the updater endpoint reads from.

Skipping it fails silently, and not on the release you are looking at. The
armed release becomes `releases/latest` with no `latest.json` asset, so the
endpoint compiled into every shipped app,

```text
https://github.com/zacharyfmarion/ori-studio/releases/latest/download/latest.json
```

404s, and every existing install quietly stops being offered updates. The new
release looks perfect; the fleet you already shipped to is the part that breaks.

### Do not merge to `main` while a release is in flight

Between merging the release PR and `release.sh publish`, `main` has to stay
still.

`ci.yml` sets `cancel-in-progress: true` on a concurrency group keyed on the
ref, so the next push to `main` cancels the CI run for the release merge commit.
That run is a gate: `release.yml`'s `validate` job asks GitHub for a *successful*
CI run at the tagged commit, and a cancelled one does not count. The release
build fails immediately with `no successful CI run for <sha>`.

`ci.yml` has no `workflow_dispatch`, so there is no way to start a fresh run at
that commit. Re-running the cancelled run is the only recovery:

```sh
gh run list --commit <merge-sha> --workflow CI
gh run rerun <cancelled-run-id>
```

If the tag is not pushed yet, that is the whole fix — wait for green, then run
`release.sh publish`. If it is, re-run the failed Desktop Build run once CI is
green. Do not delete or re-point the tag:

```sh
gh run rerun <failed-desktop-build-run-id>
```

### Release states

A tag with no published release is a normal, recoverable state — not a
corruption. Do not delete or re-point a tag.

| State | What it means | What to do |
| --- | --- | --- |
| No tag, no release | Nothing started | `release.sh prepare` |
| Tag pushed, build running | Normal | Wait |
| Tag pushed, `no successful CI run` | Something else was merged to `main` and cancelled the merge commit's CI | `gh run rerun` the cancelled CI run, then the failed Desktop Build run — see above |
| Tag pushed, some legs failed | Draft holds a partial asset set | `gh run rerun --failed`; if the failure is real, burn the version and cut the next patch |
| Draft release, all assets | Ready to test | Publish as prerelease, then `publish-updater-manifest.sh X.Y.Z` |
| Prerelease, no `latest.json` | The manifest step was skipped; arming now silently strands every install | `./scripts/publish-updater-manifest.sh X.Y.Z` before arming |
| Prerelease with `latest.json`, verified | Ready to ship | `gh release edit vX --prerelease=false` |
| Latest, no `latest.json` | Already stranded: the updater endpoint 404s fleet-wide | `gh release edit vX --prerelease=true`, run the manifest script, re-arm |
| Latest, and wrong | Shipped a bad build | `gh release edit vX --prerelease=true`, then hotfix forward |

### Required secrets

Either repo-level Actions secrets or, better, secrets on the `release-signing`
environment. All are optional — their absence degrades the build rather than
failing it.

| Secret | Used for |
| --- | --- |
| `APPLE_CERTIFICATE` | base64 of the Developer ID Application `.p12`. Its presence is what switches macOS signing on |
| `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
| `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_CONTENT` | App Store Connect API key for notarization. Preferred over an Apple ID + app-specific password: revocable, scoped, and unaffected by an Apple ID password change |
| `VITE_PUBLIC_POSTHOG_KEY`, `VITE_PUBLIC_SENTRY_DSN` | telemetry in the shipped bundle. Absent means a telemetry-blind build, which for desktop stays blind until the user updates |

To produce the certificate value:

```sh
openssl base64 -A -in DeveloperIDApplication.p12 -out cert-base64.txt
```

Paste it straight into the GitHub secrets UI; do not leave it on disk.

### Clocks

Three expiries that will otherwise surface as a failed build on a release day.
Set calendar reminders at minus 60 days.

| Item | Expires | Effect |
| --- | --- | --- |
| Developer ID Application certificate | ~5 years from issue | macOS signing stops. The build prints days remaining and warns under 60 |
| App Store Connect API key | Until revoked | Notarization stops |
| Updater signing key | Never | Cannot be revoked or replaced — see below |

### Break-glass local macOS build

`scripts/local-macos-release.sh` still builds, signs, notarizes and uploads a
macOS DMG from a Mac. Use it only when CI cannot.

It produces a **downloadable DMG only**. It does not build the other platforms
and does not produce updater artifacts, so a release made this way has no
updater manifest and reaches no one automatically.

## Crates

**The engine crates are not published.** The workspace is `publish = false`.

Only `treemaker-core` was ever on crates.io, at `0.1.0` — `treemaker-fold` and
`treemaker-flatfold`, which the old publish order said to release *first*, never
went out at all, and two product releases shipped without a publish. A weekly
desktop cadence would otherwise mint roughly fifty crate versions a year with no
crate-level change in nearly any of them.

This is also what lets intra-workspace path dependencies drop their version
requirements, which is what stops the first bump past `0.1.x` from failing to
resolve the workspace. See
[implementation-plans/desktop-ci-release.md](implementation-plans/desktop-ci-release.md).

To revive publishing: restore `version = ` on the published chain's path
dependencies (`cargo publish` refuses a crate whose dependencies carry none) and
set `publish = false` per-crate on the app and internal members instead —
`ori-studio`, `oracle-tests`, `oristudio-cp-detect-inspector`, `oristudio-cp-eval`.

## Manual Setup

1. In Cloudflare, create or confirm a Pages project named `oristudio` with
   production branch `main`.
2. Locally authenticate Wrangler if needed:
   ```sh
   npx wrangler@4 login
   ```
3. If the project does not exist yet, create it:
   ```sh
   npx wrangler@4 pages project create oristudio --production-branch main
   ```
4. In Cloudflare, create an API token that can edit Cloudflare Pages for the
   account.
5. Copy the Cloudflare account ID from the dashboard.
6. In GitHub repo settings, add Actions secrets `CLOUDFLARE_ACCOUNT_ID` and
   `CLOUDFLARE_API_TOKEN`.
7. Trigger `Deploy Web App` manually and verify
   `https://oristudio.pages.dev/`.
8. Open a test PR that changes web code and verify the preview comment points to
   `https://pr-<number>.oristudio.pages.dev/`.
9. On your Mac, install and authenticate release tooling. `minisign` is used by
   `publish-updater-manifest.sh` to verify updater signatures before upload:
   ```sh
   brew install gh jq minisign
   gh auth login
   ```
10. Ensure Rust, Node, npm, Xcode, and Xcode command-line tools are available.
11. In Apple Developer, ensure you have a Developer ID Application certificate,
    an app-specific password for notarization, and your Team ID.
12. Confirm the certificate is installed locally:
    ```sh
    security find-identity -v -p codesigning
    ```
13. Copy `.env.release.example` to `.env.release.local` and fill the required
    Apple values.
14. For each release, run `./scripts/release.sh prepare X.Y.Z`, merge the
    release PR, then run `./scripts/release.sh publish X.Y.Z` from a clean local
    Mac checkout. Merge nothing else to `main` in between.
15. After publish, verify the GitHub Release contains the versioned and latest
    Apple Silicon DMGs, download the DMG, mount it, and launch `Ori Studio.app`.
16. Publish the draft as a prerelease, run
    `./scripts/publish-updater-manifest.sh X.Y.Z`, confirm `latest.json` is
    attached to the release, and only then arm it with
    `gh release edit vX.Y.Z --prerelease=false`.
