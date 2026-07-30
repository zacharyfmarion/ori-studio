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
  #
  # Parsed rather than grepped. A regex expecting a digit straight after the
  # quote misses `opacity=" 0.17"`, which is how one exporter writes it -- and
  # that silently dropped Mooser's Train, a model whose whole point is that it
  # folds to right angles.
  if printf '%s' "$content" | node -e '
    let raw = "";
    process.stdin.on("data", (d) => { raw += d; });
    process.stdin.on("end", () => {
      const values = [...raw.matchAll(/(?:stroke-)?opacity\s*[:=]\s*"?\s*([0-9.eE+-]+)/gi)]
        .map((m) => Number.parseFloat(m[1]))
        .filter(Number.isFinite);
      process.exit(values.some((v) => v > 0.001 && v < 0.999) ? 0 : 1);
    });
  '; then
    printf '%s' "$content" > "$SVG_DIR/$name"
    kept=$((kept + 1))
  fi
done <<< "$paths"

echo "Kept $kept of $total SVGs with partial fold angles."
node "$(dirname "$0")/svg-to-fold.mjs" "$SVG_DIR" --out "$FOLD_DIR"

# The SVGs store coordinates to three decimals, which is enough to make a design
# whose sector angles are exactly 60/120/150 degrees read as 60.000131 and fail
# an exact geometric check. Patterns drawn on a regular grid can be put back onto
# it; free-form ones are left alone.
echo
echo "Snapping lattice-based patterns back onto their grid..."
node "$(dirname "$0")/snap-to-lattice.mjs" "$FOLD_DIR" --in-place

echo
echo "Open any of $FOLD_DIR/*.fold via File > Import Into Crease Pattern."
