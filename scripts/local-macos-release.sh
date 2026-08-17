#!/bin/bash
#
# BREAK-GLASS ONLY. The Desktop Build workflow
# (.github/workflows/release.yml) is what produces release artifacts; it builds
# all four legs from one source ref and signs macOS in CI.
#
# Reach for this when CI cannot run at all. Understand what it does not do:
#
#   - It builds macOS only. A release made this way has no Windows or Linux
#     artifacts, and nothing will notice they are missing.
#   - It builds with `--bundles app` and hand-rolls the DMG, so it produces no
#     updater artifacts and no signatures. Once the updater ships, a release cut
#     from here has no manifest entry — and because Tauri validates the whole
#     manifest before comparing versions, a hand-written partial one would break
#     updates on *every* platform, not just macOS. Omit it instead.
#   - The artifacts it uploads are not the ones CI would have produced, and
#     nothing checks that they came from the same commit.
#
# See RELEASE.md, "Break-glass local macOS build".
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

APP_NAME="Ori Studio"
APP_ARTIFACT_NAME="OriStudio"
CHANGELOG_FILE="CHANGELOG.md"
RELEASE_GITHUB_REPO="${RELEASE_GITHUB_REPO:-zacharyfmarion/ori-studio}"
ORI_STUDIO_RELEASE_KEYCHAIN_PATH=""
ORI_STUDIO_RELEASE_ORIGINAL_KEYCHAINS=()
ORI_STUDIO_RELEASE_CLEANUP_REPO_ROOT=""
ORI_STUDIO_RELEASE_CLEANUP_BUILD_DIR=""
ORI_STUDIO_RELEASE_CLEANUP_SCRATCH_DIR=""

error() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

success() {
    echo -e "${GREEN}OK: $1${NC}"
}

info() {
    echo -e "${BLUE}Info: $1${NC}"
}

warn() {
    echo -e "${YELLOW}Warning: $1${NC}"
}

usage() {
    cat <<EOF
Usage:
  ./scripts/local-macos-release.sh build <version> [options]
  ./scripts/local-macos-release.sh publish-artifacts <version> [options]
  ./scripts/local-macos-release.sh all <version> [options]

Commands:
  build              Build, sign, notarize, staple, and verify a local macOS DMG.
  publish-artifacts  Upload an existing local DMG to GitHub Releases.
  all                Run build and publish-artifacts. The tag must already exist remotely.

Options:
  --source-ref <ref>       Git ref to build/read notes from (default: v<version>)
  --output-dir <path>      Artifact directory (default: target/release-artifacts/v<version>)
  --env-file <path>        Release env file to source (default: .env.release.local if present)
  --target <triple>        Rust target (default: aarch64-apple-darwin)
  --arch <name>            Artifact arch suffix (default: derived from target)
  --skip-deps              Do not install Rust targets, JS deps, wasm-pack, or Tauri CLI

Required environment for build:
  APPLE_SIGNING_IDENTITY   Developer ID Application signing identity name or hash
  APPLE_ID                 Apple ID for notarization
  APPLE_PASSWORD           App-specific password for notarization
  APPLE_TEAM_ID            Apple developer team ID

Optional environment for build:
  APPLE_CERTIFICATE        Base64-encoded .p12 certificate, imported into a temp keychain
  APPLE_CERTIFICATE_BASE64 Alias for APPLE_CERTIFICATE
  APPLE_CERTIFICATE_PASSWORD

Environment:
  RELEASE_GITHUB_REPO      GitHub repo slug (default: ${RELEASE_GITHUB_REPO})
EOF
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || error "$1 is required"
}

require_env() {
    local name="$1"
    if [ -z "${!name:-}" ]; then
        error "$name must be set"
    fi
}

ensure_macos() {
    [ "$(uname -s)" = "Darwin" ] || error "macOS release artifacts must be built on macOS"
}

target_to_arch() {
    case "$1" in
        aarch64-apple-darwin)
            echo "aarch64"
            ;;
        x86_64-apple-darwin)
            echo "x64"
            ;;
        *)
            error "Unsupported macOS target: $1"
            ;;
    esac
}

default_target() {
    echo "aarch64-apple-darwin"
}

absolute_path() {
    local path="$1"
    local base="$2"

    case "$path" in
        /*)
            printf '%s\n' "$path"
            ;;
        *)
            printf '%s/%s\n' "$base" "$path"
            ;;
    esac
}

load_env_file() {
    local env_file="$1"
    local explicit="$2"

    if [ -f "$env_file" ]; then
        info "Loading release environment from $env_file"
        set -a
        # shellcheck disable=SC1090
        . "$env_file"
        set +a
    elif [ "$explicit" = "true" ]; then
        error "Env file not found: $env_file"
    fi
}

extract_changelog_section() {
    local ref="$1"
    local version="$2"
    local output="$3"

    git show "${ref}:${CHANGELOG_FILE}" | awk -v version="$version" '
        BEGIN {
            in_section = 0
            found = 0
        }
        $0 ~ "^## \\[" version "\\] - " {
            in_section = 1
            found = 1
            next
        }
        /^## \[/ && in_section {
            exit
        }
        in_section {
            print
        }
        END {
            if (!found) {
                exit 2
            }
        }
    ' > "$output"

    if [ ! -s "$output" ] || [ -z "$(tr -d '[:space:]' < "$output")" ]; then
        error "CHANGELOG.md entry for $version is empty at $ref"
    fi
}

install_build_dependencies() {
    local target_triple="$1"

    info "Installing local release build dependencies when missing..."
    rustup target add "$target_triple"
    npm ci

    if ! command -v wasm-pack >/dev/null 2>&1; then
        info "Installing wasm-pack..."
        cargo install wasm-pack --version 0.13.1 --locked
    fi

    if ! cargo tauri --version >/dev/null 2>&1; then
        info "Installing Tauri CLI..."
        cargo install tauri-cli --version '^2' --locked
    fi
}

decode_certificate() {
    local input="$1"
    local output="$2"

    if ! base64 --decode "$input" > "$output" 2>/dev/null; then
        base64 -D -i "$input" -o "$output"
    fi
}

remember_keychain_list() {
    ORI_STUDIO_RELEASE_ORIGINAL_KEYCHAINS=()
    while IFS= read -r keychain; do
        keychain="${keychain#\"}"
        keychain="${keychain%\"}"
        [ -n "$keychain" ] && ORI_STUDIO_RELEASE_ORIGINAL_KEYCHAINS+=("$keychain")
    done < <(security list-keychains -d user | sed 's/^[[:space:]]*//')
}

restore_keychain_list() {
    if [ "${#ORI_STUDIO_RELEASE_ORIGINAL_KEYCHAINS[@]}" -gt 0 ]; then
        security list-keychains -d user -s "${ORI_STUDIO_RELEASE_ORIGINAL_KEYCHAINS[@]}" 2>/dev/null || true
    fi
}

import_certificate_if_provided() {
    local scratch_dir="$1"
    local certificate_base64="${APPLE_CERTIFICATE:-${APPLE_CERTIFICATE_BASE64:-}}"

    if [ -z "$certificate_base64" ]; then
        info "No APPLE_CERTIFICATE provided; using certificates already available in the local keychain"
        security find-identity -v -p codesigning | grep -F "$APPLE_SIGNING_IDENTITY" >/dev/null \
            || error "Signing identity is not available in the local keychain: $APPLE_SIGNING_IDENTITY"
        return
    fi

    require_env APPLE_CERTIFICATE_PASSWORD

    ORI_STUDIO_RELEASE_KEYCHAIN_PATH="$scratch_dir/app-signing.keychain-db"
    local keychain_password
    local encoded_certificate="$scratch_dir/certificate.p12.b64"
    local certificate_path="$scratch_dir/certificate.p12"

    keychain_password=$(openssl rand -base64 32)
    printf '%s' "$certificate_base64" > "$encoded_certificate"
    decode_certificate "$encoded_certificate" "$certificate_path"

    info "Importing Apple certificate into a temporary keychain..."
    remember_keychain_list
    security create-keychain -p "$keychain_password" "$ORI_STUDIO_RELEASE_KEYCHAIN_PATH"
    security set-keychain-settings -lut 21600 "$ORI_STUDIO_RELEASE_KEYCHAIN_PATH"
    security unlock-keychain -p "$keychain_password" "$ORI_STUDIO_RELEASE_KEYCHAIN_PATH"
    security import "$certificate_path" \
        -P "$APPLE_CERTIFICATE_PASSWORD" \
        -A \
        -t cert \
        -f pkcs12 \
        -k "$ORI_STUDIO_RELEASE_KEYCHAIN_PATH"
    security list-keychain -d user -s "$ORI_STUDIO_RELEASE_KEYCHAIN_PATH" "${ORI_STUDIO_RELEASE_ORIGINAL_KEYCHAINS[@]}"
    security set-key-partition-list -S apple-tool:,apple:,codesign: \
        -s -k "$keychain_password" "$ORI_STUDIO_RELEASE_KEYCHAIN_PATH"

    local imported_identity
    imported_identity=$(security find-identity -v -p codesigning "$ORI_STUDIO_RELEASE_KEYCHAIN_PATH" \
        | grep -F "$APPLE_SIGNING_IDENTITY" \
        | awk '{ print $2; exit }')
    if [ -n "$imported_identity" ]; then
        APPLE_SIGNING_IDENTITY="$imported_identity"
        export APPLE_SIGNING_IDENTITY
    fi

    unset APPLE_CERTIFICATE
    unset APPLE_CERTIFICATE_BASE64
    unset APPLE_CERTIFICATE_PASSWORD
}

cleanup_keychain() {
    restore_keychain_list
    if [ -n "${ORI_STUDIO_RELEASE_KEYCHAIN_PATH:-}" ]; then
        security delete-keychain "$ORI_STUDIO_RELEASE_KEYCHAIN_PATH" 2>/dev/null || true
        ORI_STUDIO_RELEASE_KEYCHAIN_PATH=""
    fi
}

build_tauri_app() {
    local build_dir="$1"
    local target_triple="$2"

    (
        cd "$build_dir/apps/tauri/src-tauri"
        cargo tauri build --target "$target_triple" --bundles app
    )
}

create_dmg() {
    local app_path="$1"
    local dmg_path="$2"
    local temp_dmg_path="$3"
    local staging_dir="$4"

    rm -rf "$staging_dir" "$(dirname "$dmg_path")"
    mkdir -p "$staging_dir" "$(dirname "$dmg_path")"

    ditto "$app_path" "$staging_dir/${APP_NAME}.app"
    ln -s /Applications "$staging_dir/Applications"

    local attempt=1
    until hdiutil create \
        -volname "$APP_NAME" \
        -srcfolder "$staging_dir" \
        -fs HFS+ \
        -format UDZO \
        -imagekey zlib-level=9 \
        -ov \
        "$temp_dmg_path"; do
        if [ "$attempt" -ge 3 ]; then
            error "hdiutil create failed after $attempt attempts"
        fi

        warn "Retrying hdiutil create after transient failure (attempt $attempt)"
        rm -f "$temp_dmg_path"
        pkill -x diskimages-helper 2>/dev/null || true
        sleep $((attempt * 5))
        attempt=$((attempt + 1))
    done

    mv "$temp_dmg_path" "$dmg_path"
}

verify_dmg() {
    local dmg_path="$1"
    local mount_dir="$2"

    info "Verifying signed DMG: $dmg_path"
    codesign --verify --verbose=2 "$dmg_path"
    codesign -dv --verbose=4 "$dmg_path"

    rm -rf "$mount_dir"
    mkdir -p "$mount_dir"

    cleanup_mount() {
        hdiutil detach "$mount_dir" -quiet 2>/dev/null || true
    }
    trap cleanup_mount RETURN

    hdiutil attach "$dmg_path" -mountpoint "$mount_dir" -nobrowse -quiet

    if [ ! -d "$mount_dir/${APP_NAME}.app" ]; then
        error "Mounted DMG is missing ${APP_NAME}.app"
    fi

    codesign --verify --deep --strict --verbose=2 "$mount_dir/${APP_NAME}.app"
    codesign -dv --verbose=4 "$mount_dir/${APP_NAME}.app"
    cleanup_mount
    trap - RETURN
}

notarize_dmg() {
    local dmg_path="$1"
    local output_dir="$2"
    local arch="$3"
    local submission_json="$output_dir/notarytool-submit-$arch.json"
    local log_json="$output_dir/notarytool-log-$arch.json"
    local submit_exit
    local submission_id
    local submission_status

    info "Notarizing $dmg_path"
    set +e
    xcrun notarytool submit "$dmg_path" \
        --apple-id "$APPLE_ID" \
        --password "$APPLE_PASSWORD" \
        --team-id "$APPLE_TEAM_ID" \
        --wait \
        --output-format json | tee "$submission_json"
    submit_exit=${PIPESTATUS[0]}
    set -e

    submission_id=$(jq -r '.id // empty' "$submission_json" 2>/dev/null || true)
    submission_status=$(jq -r '.status // empty' "$submission_json" 2>/dev/null || true)

    if [ -n "$submission_id" ] && { [ "$submit_exit" -ne 0 ] || [ "$submission_status" != "Accepted" ]; }; then
        xcrun notarytool log "$submission_id" \
            --apple-id "$APPLE_ID" \
            --password "$APPLE_PASSWORD" \
            --team-id "$APPLE_TEAM_ID" \
            --output-format json | tee "$log_json"
    fi

    if [ "$submit_exit" -ne 0 ]; then
        error "notarytool submit exited with status $submit_exit"
    fi

    if [ "$submission_status" != "Accepted" ]; then
        error "Notarization failed with status '$submission_status'"
    fi

    xcrun stapler staple "$dmg_path"
}

build_release_artifacts() {
    local version="$1"
    local source_ref="$2"
    local output_dir="$3"
    local target_triple="$4"
    local arch="$5"
    local skip_deps="$6"
    local repo_root="$7"
    local scratch_dir
    local build_dir

    ensure_macos
    require_command git
    require_command cargo
    require_command rustup
    require_command npm
    require_command jq
    require_command codesign
    require_command hdiutil
    require_command xcrun
    require_command ditto
    require_command shasum
    require_command openssl
    require_env APPLE_SIGNING_IDENTITY
    require_env APPLE_ID
    require_env APPLE_PASSWORD
    require_env APPLE_TEAM_ID

    mkdir -p "$output_dir"

    scratch_dir=$(mktemp -d "${TMPDIR:-/tmp}/oristudio-release.XXXXXX")
    build_dir="$scratch_dir/source"
    ORI_STUDIO_RELEASE_CLEANUP_REPO_ROOT="$repo_root"
    ORI_STUDIO_RELEASE_CLEANUP_BUILD_DIR="$build_dir"
    ORI_STUDIO_RELEASE_CLEANUP_SCRATCH_DIR="$scratch_dir"

    cleanup_build() {
        cleanup_keychain
        git -C "$ORI_STUDIO_RELEASE_CLEANUP_REPO_ROOT" worktree remove --force "$ORI_STUDIO_RELEASE_CLEANUP_BUILD_DIR" >/dev/null 2>&1 || true
        rm -rf "$ORI_STUDIO_RELEASE_CLEANUP_SCRATCH_DIR"
    }
    trap cleanup_build EXIT

    info "Creating temporary release worktree from $source_ref"
    git -C "$repo_root" worktree add --detach "$build_dir" "$source_ref"

    import_certificate_if_provided "$scratch_dir"

    if [ "$skip_deps" != "true" ]; then
        (cd "$build_dir" && install_build_dependencies "$target_triple")
    fi

    info "Building signed Tauri app bundle for $target_triple"
    build_tauri_app "$build_dir" "$target_triple"

    local app_path="$build_dir/target/$target_triple/release/bundle/macos/${APP_NAME}.app"
    local dmg_dir="$build_dir/target/$target_triple/release/bundle/dmg"
    local dmg_path="$dmg_dir/${APP_ARTIFACT_NAME}_${version}_${arch}.dmg"
    local temp_dmg_path="$scratch_dir/${APP_ARTIFACT_NAME}_${version}_${arch}.dmg"
    local staging_dir="$scratch_dir/dmg-root-$arch"

    [ -d "$app_path" ] || error "Missing signed app bundle at $app_path"

    info "Verifying signed app bundle"
    codesign --verify --deep --strict --verbose=2 "$app_path"
    codesign -dv --verbose=4 "$app_path"

    info "Creating DMG"
    create_dmg "$app_path" "$dmg_path" "$temp_dmg_path" "$staging_dir"

    info "Signing DMG"
    codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$dmg_path"

    verify_dmg "$dmg_path" "$scratch_dir/dmg-mount-$arch"
    notarize_dmg "$dmg_path" "$output_dir" "$arch"
    verify_dmg "$dmg_path" "$scratch_dir/dmg-mount-stapled-$arch"

    local versioned_path="$output_dir/${APP_ARTIFACT_NAME}_${version}_${arch}.dmg"
    local stable_path="$output_dir/${APP_ARTIFACT_NAME}_latest_${arch}.dmg"
    local sha_file="$output_dir/sha256-$arch.txt"

    cp "$dmg_path" "$versioned_path"
    cp "$dmg_path" "$stable_path"
    shasum -a 256 "$dmg_path" | cut -d ' ' -f 1 > "$sha_file"

    success "Built local release artifacts in $output_dir"
    echo "DMG:    $versioned_path"
    echo "Stable: $stable_path"
    echo "SHA256: $(cat "$sha_file")"
}

publish_github_release() {
    local version="$1"
    local source_ref="$2"
    local output_dir="$3"
    local arch="$4"
    local repo_root="$5"
    local tag_name="v$version"
    local versioned_path="$output_dir/${APP_ARTIFACT_NAME}_${version}_${arch}.dmg"
    local stable_path="$output_dir/${APP_ARTIFACT_NAME}_latest_${arch}.dmg"
    local notes_file

    require_command gh
    [ -f "$versioned_path" ] || error "Missing versioned DMG: $versioned_path"
    [ -f "$stable_path" ] || error "Missing stable DMG: $stable_path"

    notes_file=$(mktemp "${TMPDIR:-/tmp}/oristudio-release-notes.XXXXXX")
    extract_changelog_section "$source_ref" "$version" "$notes_file"

    if gh release view "$tag_name" --repo "$RELEASE_GITHUB_REPO" >/dev/null 2>&1; then
        info "Updating existing GitHub Release $tag_name"
        gh release edit "$tag_name" \
            --repo "$RELEASE_GITHUB_REPO" \
            --title "Ori Studio v$version" \
            --notes-file "$notes_file"
        gh release upload "$tag_name" \
            "$versioned_path" \
            "$stable_path" \
            --repo "$RELEASE_GITHUB_REPO" \
            --clobber
    else
        info "Creating GitHub Release $tag_name"
        gh release create "$tag_name" \
            "$versioned_path" \
            "$stable_path" \
            --repo "$RELEASE_GITHUB_REPO" \
            --title "Ori Studio v$version" \
            --notes-file "$notes_file" \
            --verify-tag
    fi

    rm -f "$notes_file"
    (cd "$repo_root" && success "GitHub Release artifacts published for $tag_name")
}

main() {
    local command="${1:-}"
    local version="${2:-}"
    local repo_root
    local source_ref=""
    local output_dir=""
    local env_file=".env.release.local"
    local env_file_explicit="false"
    local target_triple=""
    local arch=""
    local skip_deps="false"

    if [ -z "$command" ] || [ "$command" = "-h" ] || [ "$command" = "--help" ] || [ "$command" = "help" ]; then
        usage
        exit 0
    fi

    if [ -z "$version" ]; then
        usage
        error "Version number is required"
    fi

    shift 2

    repo_root=$(git rev-parse --show-toplevel)

    while [ $# -gt 0 ]; do
        case "$1" in
            --source-ref)
                [ $# -ge 2 ] || error "--source-ref requires a ref"
                source_ref="$2"
                shift 2
                ;;
            --output-dir)
                [ $# -ge 2 ] || error "--output-dir requires a path"
                output_dir="$2"
                shift 2
                ;;
            --env-file)
                [ $# -ge 2 ] || error "--env-file requires a path"
                env_file="$2"
                env_file_explicit="true"
                shift 2
                ;;
            --target)
                [ $# -ge 2 ] || error "--target requires a Rust target triple"
                target_triple="$2"
                shift 2
                ;;
            --arch)
                [ $# -ge 2 ] || error "--arch requires an artifact arch suffix"
                arch="$2"
                shift 2
                ;;
            --skip-deps)
                skip_deps="true"
                shift
                ;;
            *)
                error "Unknown option: $1"
                ;;
        esac
    done

    source_ref="${source_ref:-v$version}"
    output_dir="${output_dir:-target/release-artifacts/v$version}"
    target_triple="${target_triple:-$(default_target)}"
    arch="${arch:-$(target_to_arch "$target_triple")}"

    output_dir=$(absolute_path "$output_dir" "$repo_root")
    env_file=$(absolute_path "$env_file" "$repo_root")

    load_env_file "$env_file" "$env_file_explicit"

    case "$command" in
        build)
            build_release_artifacts "$version" "$source_ref" "$output_dir" "$target_triple" "$arch" "$skip_deps" "$repo_root"
            ;;
        publish-artifacts)
            publish_github_release "$version" "$source_ref" "$output_dir" "$arch" "$repo_root"
            ;;
        all)
            build_release_artifacts "$version" "$source_ref" "$output_dir" "$target_triple" "$arch" "$skip_deps" "$repo_root"
            publish_github_release "$version" "$source_ref" "$output_dir" "$arch" "$repo_root"
            ;;
        *)
            usage
            error "Unknown command: $command"
            ;;
    esac
}

main "$@"
