#!/bin/bash
# Asserts that all four version files agree with the expected version.
#
# The four are the release's whole contract: Cargo's `[workspace.package]`
# (every crate and the Tauri binary inherit it), the web package, the Tauri
# package, and tauri.conf.json — which is the one the bundler stamps into the
# installer and the one the updater compares against.
#
# Usage: check-versions.sh <version> [<ref>]
#
# With <ref>, reads each file out of that git ref instead of the worktree. The
# release path needs that: what matters is the versions at the *merge commit*
# being tagged, not whatever is checked out.
set -euo pipefail

version="${1:-}"
ref="${2:-}"
[ -n "$version" ] || { echo "usage: check-versions.sh <version> [<ref>]" >&2; exit 1; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

read_file() {
    if [ -n "$ref" ]; then
        git show "${ref}:${1}"
    else
        cat "$1"
    fi
}

workspace_version() {
    if [ -n "$ref" ]; then
        local tmp
        tmp="$(mktemp)"
        read_file Cargo.toml > "$tmp"
        bash "$here/read-workspace-version.sh" "$tmp"
        rm -f "$tmp"
    else
        bash "$here/read-workspace-version.sh" Cargo.toml
    fi
}

failed=0
check() {
    local label="$1" actual="$2"
    if [ "$actual" != "$version" ]; then
        echo "::error::${label} is ${actual:-<empty>}, expected ${version}"
        failed=1
    else
        echo "  ok  ${label} = ${actual}"
    fi
}

check "Cargo.toml [workspace.package]" "$(workspace_version)"
check "apps/web/package.json"          "$(read_file apps/web/package.json | jq -r '.version')"
check "apps/tauri/package.json"        "$(read_file apps/tauri/package.json | jq -r '.version')"
check "apps/tauri/src-tauri/tauri.conf.json" \
      "$(read_file apps/tauri/src-tauri/tauri.conf.json | jq -r '.version')"

[ "$failed" -eq 0 ] || exit 1
echo "all version files agree on ${version}"
