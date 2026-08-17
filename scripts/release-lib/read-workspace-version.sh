#!/bin/bash
# Prints the `[workspace.package]` version from Cargo.toml.
#
# Scoped to the section on purpose. Both previous readers took the *first*
# `^version = ` line in the file, which is right only because
# `[workspace.package]` happens to precede `[workspace.dependencies]` — reorder
# the file, or add a top-level key that sorts earlier, and they would silently
# start reporting a dependency's version as the product version.
#
# Usage: read-workspace-version.sh [<Cargo.toml path>]
set -euo pipefail

manifest="${1:-Cargo.toml}"
[ -f "$manifest" ] || { echo "manifest not found: $manifest" >&2; exit 1; }

version=$(awk '
    /^\[workspace\.package\]$/ { in_section = 1; next }
    /^\[/ && in_section         { in_section = 0 }
    in_section && /^version = / {
        gsub(/^version = "|"$/, "")
        print
        exit
    }
' "$manifest")

if [ -z "$version" ]; then
    echo "no [workspace.package] version found in $manifest" >&2
    exit 1
fi

printf '%s\n' "$version"
