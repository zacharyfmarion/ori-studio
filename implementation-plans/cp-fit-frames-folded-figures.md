# CP framing: fit to everything that is drawn

## Goal

Make "fit the view to the document" mean *everything rendered in the viewport*.

Today one kind of drawn content is missing from the calculation, so both the
initial framing and the Fit button can leave it off screen.

## What is framed today, measured

[`cpContentBounds`](apps/web/src/cp-workspace/cpContentBounds.ts:40) loops over
three things — `lineSegments`, `images`, `overlayBoxes` — and
[`overlayBoxes`](apps/web/src/components/panels/CreasePatternPanel.tsx:1098) is
built from text annotations plus inline-simulation boxes.

| Drawn in the viewport | In the framed bounds |
| --- | --- |
| Creases (and the derived points on them) | yes |
| Reference images | yes |
| Text annotations | yes |
| Inline simulation windows | yes |
| **Folded figures** | **no** |

So text and simulation windows are already handled. **Folded figures are the
whole gap**, and it is one missing loop, not a category of missing work.

The same bounds feed the Fit button
([canvas:3144](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:3144) reads
`liveRef.current.contentBounds`), so the omission costs framing on open *and*
every time Fit is pressed.

**Measured on a real 32-figure document** (`iguana_24.osf`), in SVG user units:

```
creases only            maxX = 22299.75
folded figures          maxX = 23251.02     <- 951 units further right
everything currently framed  maxX = 24438.21
```

Two things follow, and the second is why this is not urgent:

- Folded figures genuinely extend past the creases — by 951 units here — because
  [`placeFoldedFigureBesideCp`](apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts:606)
  parks each one at `anchor.right + gap`, to the *right* of its source creases.
  Any document where a figure is the rightmost thing frames it off screen.
- On this particular file the images reach further right still, so the figures
  sit inside the existing bounds and the fit is **unchanged at 3%**. The bug is
  real but latent here; it bites the ordinary case of a pattern with a figure
  beside it and no image further out.

## Approach

One phase. Add folded figures to the bounds.

They already reduce to a box —
[`foldedFigureBox`](apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts:531)
returns `{center, width, height, rotation}` — so this is a fourth loop of
`boxCornersModel` beside the `overlayBoxes` arm.

One wrinkle worth getting right: every other input to `cpContentBounds` is in
*model* coordinates and passes through `modelToSvg`, while folded figures are
already in **SVG user** coordinates (the space their render primitives land in).
So they must be a separate parameter that skips the projection, not folded into
`overlayBoxes`. Getting this wrong would place them by a factor of the paper
scale and is exactly the confusion `bf484295` was about.

The canvas already receives `foldedFigures`; the memo at
[`canvas:1034`](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1034) gains
them as an input and a dependency.

Tests, in `cpContentBounds`'s own suite:

- A figure parked to the right of the creases widens the bounds to include it.
- A figure already inside the crease bounds changes nothing.
- A figure with no drawable geometry (`foldedFigureUserAabb` returns null)
  contributes nothing.
- A document whose *only* content is a folded figure has non-null bounds.
- Figures are not run through `modelToSvg` — a figure at a known user-space
  position lands there, not at that position scaled by the paper transform.

**This changes Fit's result on existing documents.** Intended, and the point, but
it is a visible behaviour change with no "identical at rotation 0" escape hatch,
so it should be called out in the PR rather than slipped in.

## Deliberately dropped

This plan originally proposed three further phases: an explicit `auto` / `owned`
camera mode, re-fitting whenever content bounds change while `auto`, and a note
reconciling that with
[`cp-camera-imperative-handle.md`](implementation-plans/cp-camera-imperative-handle.md).

**They were written to fix a bug that turned out to be something else.** The
report was a document opening zoomed in on part of itself; the cause was the
camera restore reading the store live and adopting a *previous* document's
camera, fixed in `018a4aa6`. The framing-race theory that motivated re-fitting
was never the cause.

And the race does not appear to be reachable. Opening a document is a single
atomic store update — `oristudioCpDocument`, `projectLoadId`,
`oristudioCpCamera`, the annotations and the folded figures all land in one
`set({...})`
([projectSlice.ts:1035-1090](apps/web/src/store/workspaceStore/slices/projectSlice.ts:1035))
— and the framing effect runs after it. By the time anything fits, the bounds are
complete. Image bounds come from stored `width`/`height`
([cpImagePlacement.ts:43](apps/web/src/cp-workspace/images/cpImagePlacement.ts:43))
and need no decode; simulation *boxes* are in the descriptor, and only their
folds rehydrate later, which does not move bounds.

Content that arrives later — a fold you just performed, a window you just opened
— arrives when the user already owns the view, and reframing then would be the
wrong behaviour anyway.

So the ownership mode is machinery for a re-fit that has nothing to trigger it.
If a case does turn up where content lands after framing, this section is the
record of what to build and why it was not built now.

## Affected Areas

| Area | Change |
| --- | --- |
| `cp-workspace/cpContentBounds.ts` | folded figures as a user-space input |
| `cp-workspace/CreasePatternWebglCanvas.tsx` | pass `foldedFigures` into the bounds memo |
| `cp-workspace/cpContentBounds.test.ts` | the five cases above |

No panel, store, kernel, or file-format change.

## Checklist

- [ ] Folded figures in `cpContentBounds`, in user space, skipping `modelToSvg`
- [ ] The five tests above
- [ ] tsc / lint / web tests green
- [ ] Browser: a document with one pattern and a figure beside it — Fit frames
      both; the same document with a wider image — framing unchanged
