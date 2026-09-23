#!/usr/bin/env bash
#
# Regenerate the landing screenshots' responsive variants from their masters.
#
# The masters are the 3456px `public/landing/<name>-<light|dark>.webp` files. Each gets
# `<name>-<theme>-<width>w.webp` beside it at every width in `LANDING_FIGURE_WIDTHS`
# (`src/components/landing/LandingFigure.tsx`), which `srcset` then chooses from, with the
# master itself as the largest candidate. The figures display at 424–1,120 CSS px, so
# serving only the masters cost a first view about 1.3 MB for nothing.
#
# Committed so the variants are reviewable as a recipe rather than as opaque binaries: run
# this, and `git status` should be clean. Not wired into any build — ImageMagick and libwebp
# are not dependencies of this repo. `landingFigureAssets.test.ts` fails when a master is
# missing a width, so a new screenshot cannot ship without its variants.
#
#   apps/web/scripts/gen-landing-images.sh     # needs ImageMagick 7 (`magick`) and `cwebp`

set -euo pipefail

cd "$(dirname "$0")/.."

# Keep in step with `LANDING_FIGURE_WIDTHS`.
widths=(640 960 1280 1920)

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

shopt -s nullglob
for master in public/landing/*-light.webp public/landing/*-dark.webp; do
  base=${master%.webp}
  for width in "${widths[@]}"; do
    # Lanczos down from the master, then libwebp with sharp RGB→YUV conversion: thin
    # crease lines are the first thing chroma subsampling smears.
    magick "$master" -filter Lanczos -resize "${width}x" "$work/frame.png"
    cwebp -quiet -q 88 -m 6 -sharp_yuv "$work/frame.png" -o "$base-${width}w.webp"
  done
  echo "  $(basename "$base")"
done
