#!/usr/bin/env bash
# Fetch the Origami Simulator crease patterns that carry partial fold angles,
# and convert them to FOLD.
#
# Why this exists: there is essentially no non-flat `.fold` material in public.
# Every `.fold` in the Origami Simulator repository — the largest collection
# there is — carries only +/-180 and 0, because the simulator computes a 3D form
# from a *flat-foldable* pattern. The partial angles live in its SVGs instead,
# encoded as stroke opacity, so this pulls those and runs them through
# `scripts/svg-to-fold.mjs`.
#
# Output lands in `artifacts/` (gitignored). The models are published designs by
# named artists -- Lang, Huffman, Resch and others -- so they are fetched on
# demand rather than committed, matching `tests/corpus/README.md`.
#
# What you get: 34 patterns, ~5MB, fold angles from about 7 degrees to 176.
#
# Usage:  scripts/fetch-non-flat-corpus.sh [output-dir]
set -euo pipefail

REPO="amandaghassaei/OrigamiSimulator"
OUT="${1:-artifacts/non-flat-corpus}"
SVG_DIR="$OUT/svg"
FOLD_DIR="$OUT/fold"

command -v gh >/dev/null || { echo "needs the GitHub CLI (gh)"; exit 1; }

mkdir -p "$SVG_DIR" "$FOLD_DIR"
echo "Listing assets in $REPO..."
paths=$(gh api "repos/$REPO/git/trees/main?recursive=1" \
  --jq '.tree[] | select(.path|test("^assets/.*\\.svg$")) | .path')

kept=0
total=0
while read -r path; do
  [ -z "$path" ] && continue
  total=$((total + 1))
  name=$(basename "$path")
  content=$(gh api "repos/$REPO/contents/$path" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null) || continue
  [ -z "$content" ] && continue
  # Keep only patterns with a partial opacity somewhere: opacity is the fold
  # angle (1.0 = 180 degrees), so a file using only 0 and 1 is flat and adds
  # nothing this branch cannot already test.
  if printf '%s' "$content" \
    | grep -oE '(stroke-)?opacity[:=]"?[0-9.eE+-]+' \
    | grep -oE '[0-9.eE+-]+$' \
    | awk '{ if ($1+0 > 0.001 && $1+0 < 0.999) found=1 } END { exit !found }'; then
    printf '%s' "$content" > "$SVG_DIR/$name"
    kept=$((kept + 1))
  fi
done <<< "$paths"

echo "Kept $kept of $total SVGs with partial fold angles."
node "$(dirname "$0")/svg-to-fold.mjs" "$SVG_DIR" --out "$FOLD_DIR"
echo
echo "Open any of $FOLD_DIR/*.fold via File > Import Into Crease Pattern."
