# CP-detect crop pane: fit tall images instead of clipping them

## Goal

A very tall (extreme portrait) source image must be fully reachable in the
"Detect CP from Image" crop stage. Today the bottom of the image — and with it
the two bottom quad handles — is clipped off the modal and cannot be dragged,
so the user cannot define the crop at all.

## Approach

`CpDetectCropEditor` sizes its pane with `width: 100%` plus an inline
`aspect-ratio` taken from the source image. That makes the required height
`columnWidth * (h / w)`, which for a portrait image far exceeds the row the
pane sits in. `.cp-detect-modal__surface` is `overflow: hidden` with
`max-height: min(820px, 100vh - 48px)` and never scrolls, so the excess is
simply cut off and unreachable.

Fix: constrain the pane in **both** axes so the image is fitted to the pane
rather than derived from its width alone.

The constraint that shapes the fix is that three coordinate systems have to
keep agreeing, and they only agree while the pane box and the image box are
the same rectangle:

- `pointFromPointer` maps a pointer against `img.getBoundingClientRect()`,
  with no letterboxing correction,
- the `<svg>` overlay letterboxes via the default `preserveAspectRatio`,
- the `<img>` letterboxes via `object-fit: contain`.

So a bare `max-height` on the pane is wrong: it lets the pane ratio diverge
from the image ratio, the handles render letterboxed, and drags map to the
un-letterboxed element rect — the corners jump. The pane must keep the image's
aspect ratio and shrink within it.

## Affected Areas

- `apps/web/src/components/CpDetectImportModal.css` — pane sizing
- `apps/web/src/components/CpDetectCropEditor.tsx` — inline ratio, if the
  binding axis has to be chosen in JS
- `apps/web/src/components/CpDetectCropEditor.test.tsx` — new regression test

## Checklist

- [x] Reproduce the clipping in the browser with a tall image
- [x] Constrain the crop pane in both axes, preserving the image ratio
- [x] Verify tall / wide / square images all fit, with pane box == image box
- [x] Verify pointer→image mapping still lands exactly on a dragged corner
- [x] Add a regression test
- [x] lint / typecheck / unit tests
- [ ] Draft PR
