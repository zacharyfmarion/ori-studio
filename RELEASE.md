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

## Detector models

The crease-pattern detector's model (45 MB) is not in the build: Cloudflare
Pages caps a static file at 25 MiB. It lives in the `oristudio-models` R2
bucket at an immutable versioned key and is served from the site's origin by
`apps/web/functions/models/[[path]].ts`; `registry.json` in the same bucket
says which version is current. The app downloads a model once, verifies its
sha256, and keeps it (Cache API on the web, the app data directory on desktop,
listed under Settings ▸ Models).

Publishing a new model, after updating `scripts/cp-detect/current-model.json`
and copying the assets it names:

```sh
node scripts/cp-detect/publish-model.mjs --note "why this version"
```

It verifies the local sha, uploads the model and manifest if the key is new,
appends the version to the registry, and moves `current` (`--no-promote` to
publish without promoting; `--dry-run` to see what it would do). Rolling back
is running it again for the previous pointer. It needs `wrangler` logged in;
in CI, `CLOUDFLARE_API_TOKEN` must carry **Workers R2 Storage: Edit** for the
account. The deploy's `Verify model store` step fails a deploy whose registry
or model is unreachable.

The desktop build links ONNX Runtime statically; `ort-sys` downloads the
prebuilt binaries at build time, which a proxied shell may need `HTTPS_PROXY`
unset for. Release runners are not proxied.

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

The pushed tag triggers the same build, which additionally uploads to a GitHub
Release created as a **draft**. Publish it as a *prerelease*, install it
yourself, and only then arm it:

```sh
gh release edit v0.3.0 --prerelease=false
```

`releases/latest` skips drafts and prereleases, so until that command runs the
release is downloadable but offered to nobody. That is the soak gate, and it is
also the kill switch — flipping `--prerelease=true` puts `releases/latest` back
on the previous good release.

### Release states

A tag with no published release is a normal, recoverable state — not a
corruption. Do not delete or re-point a tag.

| State | What it means | What to do |
| --- | --- | --- |
| No tag, no release | Nothing started | `release.sh prepare` |
| Tag pushed, build running | Normal | Wait |
| Tag pushed, some legs failed | Draft holds a partial asset set | `gh run rerun --failed`; if the failure is real, burn the version and cut the next patch |
| Draft release, all assets | Ready to test | Publish as prerelease, install it |
| Prerelease, verified | Ready to ship | `gh release edit vX --prerelease=false` |
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
9. On your Mac, install and authenticate release tooling:
   ```sh
   brew install gh jq
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
    Mac checkout.
15. After publish, verify the GitHub Release contains the versioned and latest
    Apple Silicon DMGs, download the DMG, mount it, and launch `Ori Studio.app`.
