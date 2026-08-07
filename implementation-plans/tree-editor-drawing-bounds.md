# Tree editor drawing bounds

## Goal

Two related complaints about the shared tree editor:

1. **ExplOri's drawing area is too small.** A tree may only reach 8 units from
   the origin. Because an ExplOri drag sets an edge's *length* as well as its
   direction, that is a hard cap on how long a branch can be, not just a layout
   annoyance.
2. **Neither ExplOri nor box pleating shows where that limit is.** The drag rule
   stops a gesture at the boundary; with nothing drawn there, the editor just
   stops responding and the user has no idea why.

## Approach

### 1. Give ExplOri more room

`HALF_EXTENT` was small for one reason, stated in its own comment: the camera's
fit divides the pane by the *whole world*, and `getViewportFitScale` never zooms
past 100%, so a large world opened uselessly far out. Room and opening zoom were
the same number.

Split them, the way the box-pleat host already does — it passes `fitRect` and
`maxFitScale` into the same `useViewportSurface`, which fits to the drawing
rather than to the world. Then raise `HALF_EXTENT` freely.

ExplOri cannot reuse box pleating's fit rect, which is the tree's own bounding
box. `centerView` centres the **world**, so a fit rect that is not centred there
sets the zoom for one region and points the camera at another: a lopsided tree
would open half off-screen. The centred frame's fit rect must therefore be
squared *about the origin* — then the rect is exactly the region the camera will
show. That belongs beside `createCenteredTreeFrame`, as the fit rule for a
centred world.

### 2. Draw the bounds on both surfaces

Put the drawable region on `TreeFrame` as `boundsRect`, in SVG units. The frame
already owns `constrain` and `contains`; the rect is the same fact in the space
the scene draws in, so the box that is drawn and the box that is enforced cannot
drift apart.

`TreeScene` then renders it once, behind everything, for whichever surface it is
hosting — ExplOri gets its centred square, box pleating gets its sheet. Purely
decorative: no pointer events, no strings to localize.

## Affected Areas

- `apps/web/src/tree-editor/frame.ts` — `boundsRect` on `TreeFrame`; the centred
  frame's own rect; `centeredTreeFitRect`.
- `apps/web/src/tree-editor/TreeScene.tsx` — render the bounds rect.
- `apps/web/src/tree-editor/TreeEditor.tsx` — pass `frame.boundsRect` through.
- `apps/web/src/explori/useExploriTreeHost.ts` — raise `HALF_EXTENT`, supply
  `fitRect` and `maxFitScale`.
- `apps/web/src/hooks/useBpTreeEditorHost.ts` — supply `boundsRect` (the sheet).
- `apps/web/src/styles/theme.css` — bounds styling.
- Tests: `frame.test.ts`, `hostContract.test.tsx`, a scene test for the rect.

## Checklist

- [x] `boundsRect` on `TreeFrame`, implemented by both frames
- [x] `centeredTreeFitRect`, origin-squared, with a minimum span
- [x] Raise ExplOri's `HALF_EXTENT`; wire `fitRect` + `maxFitScale`
- [x] Render the bounds rect in `TreeScene`, styled per surface
- [x] Unit tests for the frame rect and the fit rect
- [x] Scene test that both surfaces draw their bounds
- [x] `npm run lint:web`, `typecheck`, `test:web`
- [x] Browser check: draw to the edge on both surfaces
- [x] Draft PR
