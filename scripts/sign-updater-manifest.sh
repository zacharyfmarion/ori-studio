#!/bin/bash
#
# Signs a release's updater payloads and publishes `latest.json`.
#
# This runs on *your machine*, not in CI, and that is the whole point. The
# minisign key is the one secret in this project that cannot be revoked: lose it
# and every install silently stops updating, forever; steal it and it is code
# execution on every machine running Ori Studio. CI still builds, signs (Apple)
# and notarizes everything — this only signs artifacts CI already produced, so
# there is no second producer and nothing about the build is less reproducible.
#
# Usage: ./scripts/sign-updater-manifest.sh <version> [--key <path>]
#
# Requires: gh, jq, node, and the Tauri CLI (for `tauri signer sign`).
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
error() { echo -e "${RED}Error: $1${NC}" >&2; exit 1; }
info()  { echo -e "${BLUE}Info: $1${NC}"; }
ok()    { echo -e "${GREEN}OK: $1${NC}"; }

RELEASE_GITHUB_REPO="${RELEASE_GITHUB_REPO:-zacharyfmarion/ori-studio}"
KEY_PATH="${TAURI_SIGNING_PRIVATE_KEY_PATH:-$HOME/.tauri/oristudio-updater.key}"
TAURI_CONF="apps/tauri/src-tauri/tauri.conf.json"

version="${1:-}"
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --key) KEY_PATH="$2"; shift 2 ;;
    *) error "unknown option: $1" ;;
  esac
done

[ -n "$version" ] || error "usage: sign-updater-manifest.sh <version> [--key <path>]"
[ -f "$TAURI_CONF" ] || error "run this from the repository root"
[ -f "$KEY_PATH" ] || error "no signing key at $KEY_PATH"
command -v gh >/dev/null || error "gh is required"
command -v jq >/dev/null || error "jq is required"

tag="v${version}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

info "Reading release $tag..."
gh release view "$tag" --repo "$RELEASE_GITHUB_REPO" \
  --json assets,publishedAt > "$work/release.json"

# Refuse to sign a release that is already armed. Replacing latest.json under a
# live release would hand a changed manifest to clients mid-poll.
if [ "$(gh release view "$tag" --repo "$RELEASE_GITHUB_REPO" --json isPrerelease --jq '.isPrerelease')" != "true" ]; then
  error "$tag is not a prerelease — it is already armed. Un-arm it before re-signing."
fi

info "Composing the manifest from the release's actual assets..."
node scripts/release-lib/compose-manifest.mjs "$tag" "$version" "$work/release.json" "$work/latest.json"

# Sign each payload, then inline the signature. Tauri requires the *contents* of
# the .sig in the manifest; a path or a filename does not work.
info "Signing payloads..."
signed=0
for key in $(jq -r '.platforms | keys[]' "$work/latest.json"); do
  asset="$(jq -r --arg k "$key" '.platforms[$k].signature' "$work/latest.json")"
  payload="${asset%.sig}"

  gh release download "$tag" --repo "$RELEASE_GITHUB_REPO" \
    --pattern "$payload" --dir "$work" --clobber
  [ -f "$work/$payload" ] || error "could not download $payload"

  npm --workspace @treemaker/tauri run tauri -- signer sign \
    --private-key-path "$KEY_PATH" "$work/$payload" >/dev/null

  [ -f "$work/$payload.sig" ] || error "signing produced no .sig for $payload"
  signature="$(cat "$work/$payload.sig")"
  jq --arg k "$key" --arg s "$signature" '.platforms[$k].signature = $s' \
    "$work/latest.json" > "$work/latest.next.json"
  mv "$work/latest.next.json" "$work/latest.json"

  gh release upload "$tag" --repo "$RELEASE_GITHUB_REPO" "$work/$payload.sig" --clobber
  signed=$((signed + 1))
  echo "  signed $key"
done

# A loop that signed nothing exits 0 and looks identical to success, so assert
# the count rather than trusting the absence of an error.
[ "$signed" -gt 0 ] || error "no payloads were signed"
info "Signed $signed payload(s)"

# The check that catches a bricked fleet *before* it ships. `check()` verifies
# nothing; verification happens at the end of a completed download on a user's
# machine. Without this, a key/pubkey mismatch is invisible until every install
# has downloaded a full update and refused it.
info "Verifying signatures against the pubkey compiled into the app..."
jq -r '.plugins.updater.pubkey' "$TAURI_CONF" | base64 -d > "$work/oristudio.pub"
verified=0
for key in $(jq -r '.platforms | keys[]' "$work/latest.json"); do
  url="$(jq -r --arg k "$key" '.platforms[$k].url' "$work/latest.json")"
  payload="$(basename "$url")"
  if command -v minisign >/dev/null; then
    minisign -V -p "$work/oristudio.pub" -x "$work/$payload.sig" -m "$work/$payload" >/dev/null \
      || error "signature for $key does NOT verify against the shipped pubkey"
    verified=$((verified + 1))
  fi
done
if [ "$verified" -eq 0 ]; then
  echo "::warning::minisign not installed — signatures were NOT independently verified."
  echo "  brew install minisign, then re-run, before arming this release."
else
  [ "$verified" -eq "$signed" ] || error "verified $verified of $signed payloads"
  ok "all $verified signature(s) verify against the shipped pubkey"
fi

gh release upload "$tag" --repo "$RELEASE_GITHUB_REPO" "$work/latest.json" --clobber
ok "latest.json published for $tag"

cat <<EOF

Next:
  1. Install this build yourself and confirm it launches.
  2. Arm it — this is what starts offering the update to users:

       gh release edit $tag --repo $RELEASE_GITHUB_REPO --prerelease=false

  Until then \`releases/latest\` still points at the previous release, so the
  build is downloadable but offered to nobody.
EOF
