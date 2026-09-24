# Release Scripts

This directory contains local release helpers for Ori Studio.

## `release.sh`

`release.sh` uses a protected-branch-friendly two-step flow. GitHub Actions
validates release tags, but the signed and notarized macOS DMG is built locally
on your Mac so Apple signing credentials do not need to live in CI.

Prepare the release PR:

```sh
./scripts/release.sh prepare 0.2.0
```

After that PR is merged to `main`, publish the release from a local Mac:

```sh
./scripts/release.sh publish 0.2.0
```

`publish` builds, signs, notarizes, staples, and verifies an Apple Silicon DMG
before it pushes the annotated tag and creates or updates the GitHub Release.

## Local Secrets

Copy `.env.release.example` to `.env.release.local` and fill it from your
password manager. `.env.release.local` is ignored and must never be committed.

Required values:

- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

Optional values, only needed when the Developer ID certificate is not already
installed in the local login keychain:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`

## Lower-Level Builder

`local-macos-release.sh` can be run directly for recovery or local testing:

```sh
./scripts/local-macos-release.sh build 0.2.0 --source-ref v0.2.0
./scripts/local-macos-release.sh publish-artifacts 0.2.0 --source-ref v0.2.0
./scripts/local-macos-release.sh all 0.2.0 --source-ref v0.2.0
```

Artifacts are written to `target/release-artifacts/vX.Y.Z/` by default:

- `OriStudio_X.Y.Z_aarch64.dmg`
- `OriStudio_latest_aarch64.dmg`
- `sha256-aarch64.txt`

## `explori/`

Offline tooling for the ExplOri design kind: exporting the local tiling
databases as a tree corpus, building API-shaped fixtures from them, and running
the dev server against those fixtures instead of the archive's own server. See
[explori/README.md](explori/README.md).
