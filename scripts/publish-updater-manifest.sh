#!/bin/bash
#
# Composes and publishes a release's updater manifest (`latest.json`).
#
# The payloads and their `.sig` files are produced and signed by CI — Tauri signs
# updater artifacts during the build and will not emit them otherwise, so there
# is no "sign it afterwards" step to do here. What is left is assembling the
# manifest from the assets the release actually has, checking those signatures
# against the public key compiled into the app, and uploading the result.
#
# That check is the point of running this at all. `check()` verifies nothing:
# the plugin verifies at the *end of a completed download*, on a user's machine.
# A pubkey/private-key mismatch is otherwise invisible until the entire install
# base has downloaded a full update and refused it.
#
# Usage: ./scripts/publish-updater-manifest.sh <version>
#
# Requires: gh, jq, node, and minisign (brew install minisign).
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
error() { echo -e "${RED}Error: $1${NC}" >&2; exit 1; }
info()  { echo -e "${BLUE}Info: $1${NC}"; }
ok()    { echo -e "${GREEN}OK: $1${NC}"; }

RELEASE_GITHUB_REPO="${RELEASE_GITHUB_REPO:-zacharyfmarion/ori-studio}"
TAURI_CONF="apps/tauri/src-tauri/tauri.conf.json"

version="${1:-}"
[ -n "$version" ] || error "usage: publish-updater-manifest.sh <version>"
[ -f "$TAURI_CONF" ] || error "run this from the repository root"
command -v gh >/dev/null || error "gh is required"
command -v jq >/dev/null || error "jq is required"

tag="v${version}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

info "Reading release $tag..."
gh release view "$tag" --repo "$RELEASE_GITHUB_REPO" \
  --json assets,publishedAt,isPrerelease > "$work/release.json"

# Refuse to touch a release that is already armed: replacing latest.json under a
# live release hands a changed manifest to clients mid-poll.
if [ "$(jq -r '.isPrerelease' "$work/release.json")" != "true" ]; then
  error "$tag is not a prerelease — it is already armed. Un-arm it before re-publishing."
fi

info "Composing the manifest from the release's actual assets..."
node scripts/release-lib/compose-manifest.mjs "$tag" "$version" "$work/release.json" "$work/latest.json"

# Inline each signature. Tauri requires the *contents* of the .sig in the
# manifest; a path or a filename does not work.
info "Inlining signatures and verifying them against the shipped pubkey..."
jq -r '.plugins.updater.pubkey' "$TAURI_CONF" | base64 -d > "$work/oristudio.pub"
command -v minisign >/dev/null || error "minisign is required (brew install minisign)"

verified=0
for key in $(jq -r '.platforms | keys[]' "$work/latest.json"); do
  sig_name="$(jq -r --arg k "$key" '.platforms[$k].signature' "$work/latest.json")"
  payload="${sig_name%.sig}"

  gh release download "$tag" --repo "$RELEASE_GITHUB_REPO" \
    --pattern "$payload" --pattern "$sig_name" --dir "$work" --clobber
  [ -f "$work/$sig_name" ] || error "release has no $sig_name — did the build sign it?"

  # Both the .sig and the pubkey are base64-encoded wrappers around the real
  # minisign files — Tauri stores them that way so they survive being pasted
  # into a JSON config. minisign itself wants the decoded form, and feeding it
  # the base64 fails with "Untrusted signature comment too long" rather than
  # anything that sounds like an encoding problem.
  base64 -d < "$work/$sig_name" > "$work/$sig_name.decoded"
  minisign -V -p "$work/oristudio.pub" -x "$work/$sig_name.decoded" -m "$work/$payload" >/dev/null \
    || error "signature for $key does NOT verify against the pubkey compiled into the app"

  # The manifest carries the *base64* form, which is what the plugin expects.
  signature="$(cat "$work/$sig_name")"
  jq --arg k "$key" --arg s "$signature" '.platforms[$k].signature = $s' \
    "$work/latest.json" > "$work/latest.next.json"
  mv "$work/latest.next.json" "$work/latest.json"
  verified=$((verified + 1))
  echo "  verified $key"
done

# A loop that verified nothing exits 0 and looks identical to success, so assert
# the count rather than trusting the absence of an error.
[ "$verified" -gt 0 ] || error "no platforms were verified"
ok "$verified signature(s) verify against the shipped pubkey"

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
