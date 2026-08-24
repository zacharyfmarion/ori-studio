#!/usr/bin/env bash
#
# Regenerate `public/icons/` from `public/favicon.png`.
#
# Committed so the PNGs in the tree are reviewable as a recipe rather than as
# opaque binaries: run this, and `git status` should be clean. Not wired into any
# build — ImageMagick is not a dependency of this repo, and the icons change
# roughly never.
#
#   apps/web/scripts/gen-pwa-icons.sh        # needs ImageMagick 7 (`magick`)
#
# The source is a 1024x1024 squircle with *transparent corners*, which matters
# twice:
#
#   - iOS composites a transparent home-screen icon onto black, so an
#     `apple-touch-icon` cut straight from it would wear a dark ring inside
#     iOS's own (rounder) mask. The full-bleed step below fills the corners by
#     laying an enlarged copy of the artwork underneath, which continues the
#     background gradient instead of butting a flat fill against it.
#   - A maskable icon may be cropped to a circle of 80% diameter, and this
#     artwork's leaf runs most of the width. So the maskable inlays the
#     full-bleed square at 80% over a gradient sampled from the artwork's own
#     top and bottom edges — the leaf then clears the safe circle with margin
#     and the inlay seam lands on matching colour.
#
# The `any`-purpose icons keep their transparency: nothing masks those, and the
# rounded silhouette is the intended shape on a desktop tab or an Android
# adaptive-icon foreground.

set -euo pipefail

cd "$(dirname "$0")/.."

src=public/favicon.png
out=public/icons
mkdir -p "$out"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# Fill the transparent corners with an enlarged copy of the artwork, so the
# background gradient continues to the edge, then drop the alpha channel.
magick "$src" \
  \( +clone -resize 130% -gravity center -extent 1024x1024 \) \
  +swap -gravity center -composite \
  -alpha remove -alpha off "$work/fullbleed.png"

# Sampled from the full-bleed square's own top and bottom edge rows.
gradient='#1462B4-#094487'

# The artwork is a photograph of textured paper, which truecolour PNG stores
# badly: a straight 512 came out at 476 KiB. A 256-colour palette takes it to
# 148 KiB at an RMSE of 0.8% — invisible at icon sizes, and worth it for a file
# every install downloads. Dithering is off deliberately: on this texture it
# adds noise the encoder then has to store, so it costs both size and fidelity.
# `-depth 8` matters for the maskable, whose `gradient:` source is 16-bit and
# would otherwise triple the file on its own.
quantize=(-depth 8 -dither None -colors 256 -define png:compression-level=9 -strip)

magick "$src" -resize 32x32 "${quantize[@]}" "$out/favicon-32.png"
magick "$src" -resize 192x192 "${quantize[@]}" "$out/icon-192.png"
magick "$src" -resize 512x512 "${quantize[@]}" "$out/icon-512.png"
magick "$work/fullbleed.png" -resize 180x180 "${quantize[@]}" "$out/apple-touch-icon.png"
magick -size 1024x1024 "gradient:$gradient" \
  \( "$work/fullbleed.png" -resize 80% \) -gravity center -composite \
  -resize 512x512 "${quantize[@]}" "$out/icon-maskable-512.png"

ls -l "$out"
