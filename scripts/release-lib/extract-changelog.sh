#!/bin/bash
# Prints the CHANGELOG.md body for one version, without its heading.
#
# This scraper existed in three near-identical copies (release.sh, the release
# workflow, local-macos-release.sh). They have to agree, because the same text
# becomes the CI gate, the GitHub Release body, and the updater's release notes —
# so it lives in one place.
#
# Exits 2 when the version has no entry, so callers can tell "no such section"
# apart from "the file could not be read".
#
# Usage: extract-changelog.sh <version> [<ref>]
set -euo pipefail

version="${1:-}"
ref="${2:-}"
[ -n "$version" ] || { echo "usage: extract-changelog.sh <version> [<ref>]" >&2; exit 1; }

if [ -n "$ref" ]; then
    source_text() { git show "${ref}:CHANGELOG.md"; }
else
    source_text() { cat CHANGELOG.md; }
fi

body=$(source_text | awk -v version="$version" '
    BEGIN { found = 0; in_section = 0 }
    $0 ~ "^## \\[" version "\\] - " { in_section = 1; found = 1; next }
    /^## \[/ && in_section          { exit }
    in_section                      { print }
    END { if (!found) exit 2 }
') || {
    status=$?
    [ "$status" -eq 2 ] && echo "no CHANGELOG.md entry for ${version}" >&2
    exit "$status"
}

if [ -z "$(printf '%s' "$body" | tr -d '[:space:]')" ]; then
    echo "CHANGELOG.md entry for ${version} is empty" >&2
    exit 1
fi

# A `## [` line inside the body would truncate the section for the next reader
# and, worse, split the public release body at an arbitrary point.
if printf '%s' "$body" | grep -q '^## \['; then
    echo "CHANGELOG.md entry for ${version} contains a '## [' line" >&2
    exit 1
fi

printf '%s\n' "$body"
