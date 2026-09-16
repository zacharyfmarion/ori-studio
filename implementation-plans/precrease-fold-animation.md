# Animate the fold in the precrease sequence

## Goal

A step of the precreasing sequence shows a dashed line and an arrow. Play it,
and the paper should actually fold: the flap swings from 0° to 180° over the
rest of the sheet, lands showing its other face with every crease on that face
where it physically is, and then the parts of the fold that the step creases
go sharp while the rest of the flap stays a rounded curl hovering just above
the paper. That last picture is the instruction — *where* to press — and it is
what today's static card cannot say.

What ships (Zach, 2026-09-16):

- **A Play button on the bottom toolbar** — the floating pill over the canvas
  (`ReferencesViewportToolbar`), where Recompute and the phone's step chevrons
  already sit.
- **Space plays it**, as `references.playFold` in the References shortcut
  scope; the simulator already uses Space for `simulator.playPause` and the two
  scopes are never in the stack together.
- **Play goes 0% → 100%; Play again goes 100% → 0%.** A step arrives flat.
  Pressing Play while it moves pauses it; pressing again continues the same
  way. Changing step resets to flat.
- **An "Auto-play folds" setting, off by default**: on, arriving at a fold card
  plays it. It never advances to the next card.
- **Not a rigid hinge.** The flap curls over with a bend radius, lands parallel
  to and a little above the paper, and *then* the creased stretches of the
  fold line go sharp — the whole line when the whole line is creased, a pinch's
  worth when it is a pinch.
- **The other face is physically right.** Past 90° the flap shows its back:
  the back face's paper colour, and its creases reflected across the fold with
  mountain and valley named from that face (`diagram/diagramModel.flipDirection`).

Out of scope, on purpose: layer ordering, folded intermediate states, folds
through several layers, inside reverse folds. The seams those will need are
named under "What this is built to grow into" so nothing here has to be undone.

## Approach

### What already exists, and what does not

The main view is a `CpRenderer` behind `ReferencesCpView` (plan
`references-step-diagram-unification.md` kept it on the GPU "for the folding
simulation it will host"). The renderer already has the one channel this needs:
**`setFolded(FoldedGeometry)`** — depth-ordered triangle fills plus
depth-ordered strokes, in SVG user coordinates, drawn after the crease pattern
and its vertex dots and before the diagnostic, preview and overlay channels
(`reglRenderer.ts`, `render()`). The fill program takes a 2D position, a colour
and a depth in `[0, 1]`; the stroke program takes the same plus the CP's dash
table. The References view never calls it today. So a moving flap is a
top-down orthographic projection of a 3D surface — `(x, y)` from the surface
point, `depth` from its height — packed into that channel each frame, and the
renderer needs no new program. The generated folded figure is already drawn
this way (`foldedFigure3dProjection.ts` projects a 3D model to this same
stream), which is the precedent for the whole approach.

What does not exist: any notion of a step's *motion* as data. The card's arrow
is computed in `diagram/plannerDiagram.ts` from the witness's `who_moves` — the
moving input, its reflection across the fold, and which side of the fold is the
flap (`movingSide`, `perpendicularMotion`, `flapArea`, all private) — and that
is exactly the decision the animation needs. It must not be decided twice.

### D1 — one decision of what moves, shared with the arrow

Extract from `plannerDiagram.ts` a React-free, exported

```ts
stepFoldMotion(sequence, frame, index): FoldMotion | null
// { chord: DiagramSegment; side: 1 | -1; creased: DiagramSegment[]; kind }
```

`chord` is the fold line in the frame's coordinates (`frame.chord(step)`),
`side` is the half-plane that swings (the sign `sideOf` returns), `creased` is
what the step actually presses along the line (`creasedSpans` — the pattern's
pieces joined and carried to references, the pinches, the whole chord of an
auxiliary fold pressed in full, a press step's spans). The rule for `side` is
the arrow's own, verbatim:

- O2/O3/O5/O6/O7 — the side `movingSide` picks: the arm that lands on crease,
  then the smaller flap.

  **Revised 2026-09-16, markhor card 47.** The crate's `who_moves` names the
  input whose motion makes the alignment *legible* (a corner brought onto a
  mark), and the card's arrow followed it. On a fold through a mark near the
  bottom edge that brings a top corner onto a line, that swung nine tenths
  of the sheet over a strip; Zach: "step 46 of markhor should fold the
  bottom part up … instead it folds the top part of the paper down". So the
  picture now has movers of its own, `movingInputs` in `plannerDiagram.ts`:
  the crate's, unless the axiom has a symmetric alternative (O2, O5, O6, O7)
  and the crate's side is the larger flap by more than a quarter, in which
  case the alternative moves — the arrow starts from where the mark lands,
  the sentence says "bringing A onto Q", and the animation lifts the strip.
  One decision, three readers. On markhor that flips cards 23 and 47 and
  leaves the other eight O5 cards as they were.
- O4 — `perpendicularMotion`'s `moving` side (the shorter arm swings).
- O1, and any witness with an empty `who_moves` — nothing is brought onto
  anything, so the card draws no arrow; the animation still has to move
  something, and a folder picks up the **smaller flap** (`flapArea`).
- A press step — the line is already there; the smaller flap, sharpening only
  the press's spans.
- A **grid** step (a pleat) — `null` in V1: a pleat is not one fold, and an
  accordion animation is its own piece of work. Play is disabled on the card
  with the hint "Pleats aren't animated yet".
- A **twin** pair — two motions, one per fold, animated together when their
  flaps are disjoint; the first alone when they overlap.

The arrow code then reads `side` from the same call, and a test pins that the
side the arrow is drawn from and the side that swings are one value for every
step of the `plannerSequence` fixture. This is the only change to the diagram
module, and it moves no rule — it names one.

Nothing here touches Rust. Plan D6 of the integration plan keeps *planner*
geometry out of TypeScript; the arrow arc is already view geometry in
`stepDiagramGeometry.ts`, and this is the same kind of thing.

### D2 — the surface: a curl with a per-position bend radius

In the fold's own frame — `s` along the chord, `u` the distance from it into
the flap (`u ≥ 0` is paper that moves), `z` towards the reader — the flap at
swing angle `θ ∈ [0, π]` and press `p ∈ [0, 1]` is

```
r(s) = R₀ · (1 − p · c(s))              bend radius along the line
L(s) = r(s) · θ                         material length in the bend
u ≤ L:  ( s,  r·sin(u/r),                     r·(1 − cos(u/r)) )
u > L:  ( s,  r·sin θ + (u−L)·cos θ,          r·(1 − cos θ) + (u−L)·sin θ )
```

`c(s)` is the creasedness profile: 1 on `creased` spans, 0 elsewhere, with a
short linear ramp between (a few percent of the sheet) so the surface has no
seam. `R₀` is a share of the sheet's short side — a *paper* size, so it is the
same at every zoom, unlike the ink unit of plan D3 — starting at 0.02 (8 units
on a 400 sheet) and tuned in the pane.

This one function is the whole model, and it has the properties the request
lists:

- `θ = 0`: the identity — the flap is seamless with the paper at rest.
- `r → 0`: the rigid hinge, `(s, u·cos θ, u·sin θ)`; at `θ = π` that is exactly
  the reflection across the chord (`reflectAcross`), which is what a test
  compares it against.
- `θ = π`, `r = R₀`: the flat part lies at height `2R₀`, parallel to the paper,
  its far edge `π·R₀` short of the mirror position, and the curl bulges `R₀`
  past the fold line on the flap's *original* side — the "hovering a little
  above" picture, read from above through the overhang, the shortfall, the
  shading and the shadow (D5).
- Pressing (`p: 0 → 1`) takes `r(s)` to zero *only where the step creases*, so
  the flap drops flat onto the paper along the creased stretches and stays a
  curl elsewhere — a pinch drops a pinch's width, a full crease drops the lot.
  That is the instruction, and it falls straight out of `c(s)`.

The normal is analytic (`(0, −sin φ, cos φ)` with `φ = min(u, L)/r`, `θ` past
the bend); its `z` sign says which face the reader sees at that point.

**Revised 2026-09-16, after markhor step 11.** The material bookkeeping above
lands the flat part `πr` short of the mirror, and on a step that brings a
mark onto a line the mark then stops short of the line — the one thing the
picture must not say. Zach: "stretch the truth a bit … the paper always folds
to exactly the place where it would if the entire crease was made, but we
render the part of the paper that should not be creased as rounded." So the
flat part is now the rigid hinge's own position lifted by the bend's height
(`u·(cos θ, sin θ) + r·(sin θ, 1 − cos θ)`), the bend is the arc sheared along
the flap's direction by `u` so it meets that flat part continuously, and the
rounding shows only as the bend's shading and the hover's shadow. Nothing
about where a point lands depends on `r` any more, in the plane.

**Mesh.** The flap polygon is the sheet (`ReferencesPlanModel.edges`, a
rectangle in model space) clipped to the moving half-plane — convex, so each
cell of an `(s, u)` grid clips to a convex polygon that fans into triangles.
`s` is sampled uniformly with extra samples at every edge of the creasedness
ramps; `u` densely through the bend (`[0, R₀π]`, ~16 rows) and then one row to
the flap's far extent, because the surface is exactly linear in `u` past the
bend. Order of 5–10k triangles a frame, rebuilt in JavaScript in well under a
millisecond and re-uploaded through `setFolded` (the same buffer churn a
folded-figure scale drag already does).

**Depth.** `depth = 0.05 + 0.9 · z / zRange`, `zRange` the flap's full extent
(constant per step, so nothing pops between frames); creases on the surface
sit at their surface depth plus a hair, the cast shadow at 0.02.

### D3 — what each channel draws while a pose is set

At rest (pose `null`) nothing changes: the base strokes are the whole build-up
as `referencesCreaseVisibility` decides it, the step's dashed fold line is in
the preview channel, the symbols in the DOM layer. The moment a pose is set:

- **Every line on the paper is split at the fold line, once, at play start**
  (`fold/foldSplit.ts`, on the packed `StrokeGeometry` *after*
  `applyCreaseVisibility`, so the flap inherits the dimming, the settled
  directions and the emphasis). The base keeps the pieces on the resting side
  and on the line itself; the flap's pieces keep their appearance and their
  model-space endpoints. A segment crossing the line becomes two. The same
  split is applied to the diagram's line primitives — the pinches and
  auxiliary folds the pattern does not hold — so an earlier pinch on the flap
  moves with the flap. The fold line itself (`u = 0`) stays in the preview
  channel, on top, where the instruction belongs.
- **The flap's vertex dots are dropped** from the point layer for the duration:
  a dot left at its original position under a lifted flap gives the game away,
  and the point program has no depth to lift it with.
- **The folded channel gets, in order:** the cast shadow (D5); the surface
  fills, one colour per vertex — the paper colour of the face showing there
  (`n_z ≥ 0`: the face the reader is on; otherwise the other face) times the
  shading (D5); then the flap's creases, each sampled through the surface,
  with its colour swapped to the other face's naming (`--fold-mountain` ↔
  `--fold-valley`) on the samples where the other face shows. Creases that do
  not enter the bend strip stay single segments — the surface is linear there
  and the error is the width of the ramp, a hair — so a dense pattern's flap
  costs about what its creases already cost.
- **Face colours.** The face the reader is on is the ground (`--bg-primary`,
  which is why the front is not filled at rest) and the other face is
  `--paper-back` — the same two tokens the sheet fill and the cards use, so the
  flap landing back-side-up is the same colour as the sheet turned over on the
  next card. When the view is `mirrored` the roles swap, and the geometry goes
  through the view's own `modelToSvg` when packed, so the reflection that folds
  the paper over for the back view carries the flap with it and the two never
  disagree.
- **Stroke width.** `foldedStrokes` draws at `viewport.dpr` per width unit (the
  folded figure's rule); the crease pattern draws at `frame.strokeWidthPx`.
  `CpRenderFrame` gains an optional `foldedStrokeWidthPx`, defaulting to the
  old value, and this view passes its crease width so a crease is the same
  weight on the flap as beside it.
- **The camera never moves.** Selecting a step must not move it (Zach's
  loudest complaint on this workspace); neither does playing one.
- **The DOM symbols stay put.** The arrow, the rings and the letters are the
  instruction; the animation is the demonstration under it. A mark on the flap
  ends up under its ring on the target, which is the point.

### D4 — the transport

`fold/foldPlayback.ts` is a pure state machine: `{ at: 0…1, heading: 'fold' |
'unfold' | null }`. `toggle()` at rest heads towards the far end (`at < 1` →
fold, `at = 1` → unfold); mid-flight it pauses; paused it resumes the same way.
`tick(dt)` advances at a fixed duration and comes to rest at either end.
Progress maps to a pose in two phases: `t ∈ [0, 0.8]` swings `θ` to `π` on an
ease-in-out, `t ∈ [0.8, 1]` presses `p` to 1 on an ease-out — about 0.9 s and
0.25 s. Unfolding is the same path backwards: the crease releases, then the
flap swings up.

`useFoldPlayback` binds it: a `requestAnimationFrame` loop that holds progress
in a ref and pushes each frame's pose straight to the view through a new
`ReferencesCpViewHandle.setFoldPose(pose | null)` — never through React state,
for the reason `SimulatorPanel` gives at 60 fps — and publishes only the
transitions (`playing`, `folded`) for the button. Step changes, mode changes, a
re-plan and unmount all reset to flat. `prefers-reduced-motion` snaps between
the two rest poses instead of animating. Auto-play arms once per arrival at a
fold card after a short settle (~120 ms, so stepping through with the arrow key
does not start ten animations), never on the card the panel mounts on.

Where things live, per AGENTS.md's panel table: the verb goes in the action
catalog (`referencesActions.ts`: `play-fold`, gated on there being a motion,
labelled Play fold / Pause / Unfold by state), the key in the registry
(`references.playFold`, `{ key: ' ' }`), the executor case in
`runReferencesShortcut`, the store binding in the hook. The panel gains one
hook call and one prop; the context menu gets the row for free.

The setting is a **persisted preference**, not a transient references setting:
`referencesAutoPlayFolds` in `settingsStore` with a `STORAGE_KEYS` entry, read
by `useReferencesSettings` beside the plan-shaping toggles and shown in
`ReferencesViewControlsPanel` under "Precreasing sequence". A reader who wants
folds to play should not have to say so every session; the references slice
is transient because it describes one plan, which this does not.

### D5 — reading height from above: shading and a cast shadow

Seen from straight above, a flat flap hovering at `2R₀` looks like a flat flap
on the paper. Three cues carry the height, all cheap in this channel:

- **Shading** on the surface: the face colour scaled by `1 − k·(1 − |n_z|)`,
  `k ≈ 0.35` — exactly 1 when flat, so the flap is invisible at rest and the
  curl reads as a rounded ridge. Applied as a mix toward `--paper-shadow`, the
  token the folded figure's shadow already uses, so it darkens in both theme
  families.
- **A cast shadow** from a light tilted a little off vertical: the flat part
  of the flap (a convex polygon, so a single fan and no double-blending)
  projected along the light onto the paper, filled with `--paper-shadow` at
  depth 0.02. Under the flat part it is hidden by the flap; along the far
  edge it shows as a rim proportional to the height, and during the swing it
  sweeps across the paper. This is the cue that says "above", and it is
  separable: if it reads badly it comes out without touching the surface.
- The geometry itself: the curl's overhang and the flat part's shortfall
  (D2).

**Revised 2026-09-16.** The cast shadow went first (a raised flap's shadow
landed a flap's width away and read as a second sheet), then the contact
rim that replaced it: Zach had shadows removed altogether. What remains of
the height cues is the shading of the bend. Two more calls from the same
round: a **twin card plays its folds one after the other** — fold the first,
hold a moment, unfold it, then the second — and rests flat, since that is
how a folder makes them; and a **turn-over card plays the sheet turning
over**, a rigid turn about its vertical centre line lifted so the low side
never passes through the table, which ends in exactly the picture the next
card starts from.

Both dark and light themes are checked in the pane, since the back face's
contrast rule (`themes/paperBack.ts`) was tuned by luminance step and a shading
multiplier moves it.

### What this is built to grow into

Zach's stated direction is inside reverse folds and folds through several
layers, which need layer ordering and a folded state per step. Three seams are
kept so that arrives as additions:

1. **The renderer's input is "3D paper, top-down, with depth"** — the
   `setFolded` stream — and the folded figure already produces it from a
   kernel layer order (`foldedFigure3dProjection.ts`). A future step whose
   start state is folded draws its stationary layers through the same channel
   with depths from the order, and the moving piece on top.
2. **`FoldMotion` is per step and data.** V1 has one kind (a flap about a
   chord with a creasedness profile); a reverse fold is another kind with two
   chords and a sign change; the transport, the button, the setting and the
   analytics do not care which.
3. **The surface is one function of `(s, u)`.** A multi-layer fold is the same
   function applied to every layer in the flap with a per-layer `z` offset.

What is *not* pre-built: no folded-state cache, no layer solver, no per-step
paper state in the store. The precrease model stays "every step starts and
ends flat".

### Analytics

Hand-placed — nothing in the References workspace dispatches through
`handleMenuAction`:

- `references fold played` — `trigger` (`button` / `shortcut` / `auto`),
  `direction` (`fold` / `unfold`), `step_kind` (`cp` / `aux` / `press`).
  Whether the animation is used at all, and whether auto-play is how.
- `references fold autoplay changed` — `enabled` (`on` / `off`).

Enums only; no step numbers, no geometry.

## Affected Areas

- `apps/web/src/cp-workspace/references/diagram/plannerDiagram.ts` — export
  `stepFoldMotion`; the arrow reads its side from it.
- `apps/web/src/cp-workspace/references/fold/` (new) — `foldMotion.ts` (the
  step → motion adapter and the `FoldMotion` type), `foldSurface.ts` (D2:
  the surface, normals, creasedness profile, mesh), `foldSplit.ts` (D3: strokes
  and diagram lines split at the chord, flap creases remapped),
  `foldShadow.ts` (D5), `foldScene.ts` (pose → `FoldedGeometry`, model → user
  through the view's map), `foldPlayback.ts` (D4 state machine, pose curve),
  `useFoldPlayback.ts` (rAF loop, auto-play, analytics). Tests beside each.
- `apps/web/src/cp-workspace/references/ReferencesCpView.tsx` — `fold` prop,
  `setFoldPose` on the handle, the split applied in the stroke and point
  uploads while a pose is set, `setFolded` upload, `foldedStrokeWidthPx`.
- `apps/web/src/cp-workspace/renderer/CpRenderer.ts`, `reglRenderer.ts` —
  optional `foldedStrokeWidthPx` on the frame (default unchanged).
- `apps/web/src/cp-workspace/references/referencesActions.ts`,
  `referencesShortcuts.ts`, `ReferencesViewportToolbar.tsx`,
  `referencesContextMenu.ts` — the `play-fold` verb.
- `apps/web/src/keyboard/shortcuts.ts` — `references.playFold` on Space.
- `apps/web/src/store/settingsStore.ts`, `lib/storage.ts` —
  `referencesAutoPlayFolds`; `useReferencesSettings.ts`,
  `components/panels/ReferencesViewControlsPanel.tsx` — the toggle.
- `apps/web/src/components/panels/ReferencesPanel.tsx` — composition only:
  one hook, one prop, one catalog field. About twenty lines, under the cap.
- `apps/web/src/analytics/events.ts`, `docs/analytics.md`.
- Locales (8) for Play fold / Pause / Unfold / Auto-play folds / the pleat
  hint, through `i18n:extract`.

## Checklist

- [x] **Phase 0 — name the motion.** `stepFoldMotion` extracted from the
      arrow code; the arrow reads it; a test over the `plannerSequence`
      fixture pins arrow side = swing side; the O1 / press / grid / twin rules
      above pinned by case.
- [x] **Phase 1 — the pipeline, with a rigid hinge.** Transport state machine
      and hook, `setFoldPose`, the split, the folded-channel upload with
      `r = 0`, face colours and depth, the Play button, Space, the setting,
      analytics, locales. Visible result: the flap swings over as a flat plate
      and lands mirrored, showing the other face's creases. Verified in the
      pane on markhor front and back (`mirrored`) in both theme families.
      Check that Space with the Play button focused toggles once (the
      dispatcher's `preventDefault` on keydown should suppress the button's
      keyup activation; if not, the button drops focus on press).
- [x] **Phase 2 — the curl.** `foldSurface` with `R₀`, the creasedness
      profile, the press phase and shading; tests for the identity at `θ = 0`,
      the reflection at `r = 0`, the overhang and shortfall at `θ = π`, and
      `c(s)` on a pinch versus a full crease. Verified on a pinch step and a
      full-crease step side by side.
- [x] **Phase 3 — height cues.** The cast shadow of the flat part;
      `prefers-reduced-motion` snaps between the rest poses. Constants as
      shipped: `R₀` 2% and the ramp 3% of the short side, the shade the text
      colour at the theme's shadow share (18% light, 28% dark — the
      `--paper-shadow` token itself is a `color-mix()` the GPU colour reader
      cannot parse), the shadow 0.55 of the height along the light, the swing
      1150 ms with the last fifth the press. Looked at in One Dark and Atom
      One Light; Zach's eye decides the rest.
- [x] **Phase 4 — the awkward cases.** Twins (two corner flaps swinging in
      together, checked in the pane), press steps, O4 and O1 (unit tests on
      the motion), a flap landing off the sheet (drawn wherever it lands —
      nothing special), pleats disabled with the hint. Cost, measured on a
      synthetic 50k-segment pattern under vitest: the one-off split at play
      start 33 ms, a frame 37 ms with 25k strokes on the flap — allocation
      bound, so a real pattern (hundreds to a few thousand creases) is well
      under a frame. A typed-array packer with no per-stroke objects is the
      lever if a pattern that size ever needs to play smoothly. A split is now
      cached per upload, so a hover no longer re-splits the pattern under it.
- [x] The panel's hook-order test passes as is — the transport hook is
      unconditional, and the view is mocked out of it; the renderer's layer
      order is untouched (the folded channel already sat between the points
      and the preview), so its test needed no extension. Lint, typecheck and
      the whole web suite are green.
- [ ] Zach tries it on a desktop and a phone.
- [x] A turn-over card animates the sheet turning over (the same rig,
      rigid, hinge at the sheet's centre line), and a twin card plays its
      two folds in turn.
- [ ] *Later, not this plan:* Find-mode candidates (ReferenceFinder steps
      are folds too, with the moving point in the diagram); pleats.
