# Diagram Pose: Spread Layers (depth steps)

**Status: depth steps built (13a–13f); depth and affine as two kinds, depth
on by default, being built (13g).** Phase 13 of
`implementation-plans/diagram-workspace.md`. Zach tried the options in the
playground (https://claude.ai/artifact/NrqrBDkkmEVMbNjJSbVezf, private: his
crane diagram step by step, twelve cpoogle crease patterns folded to their
bases, simple bases, DEFOX's sample) and chose **Depth steps**: "depth steps
clearly looks the best. I want to use that to implement this." The affine
distortion of DEFOX / step-folder is not built; why is kept at the end.

## Goal

A tool in Pose that draws a flat-folded step with its layers stepped apart —
Zach: "display layers on parts of the design to give the folder more
information about how they are distributed (otherwise a bunch of faces are
coplanar and it's harder to tell what is going on)".

Constraints:
- A choice about the picture, as Turn Over is: the fold and its layer order
  never change ("pose applied to the picture, never to the fold",
  `captureFolded.ts`).
- Flat folded pictures only (`folded-flat`); the crease pattern, 3D and the
  simulator have nothing to spread.
- Prints as it shows: the spread picture is the stored scene, so cards, pages
  and the PDF need nothing new.

## Approach

### What it draws

Akitaya's depth shift — the alternative *Affine Distortions* (Morisue, in the
step-folder repository) sets aside in its Fig. 4, p. 10:
`D(v) = V(v) + p · z(v) / z_max · d`. Every point of the folded picture steps
by its depth `z` in one direction `d`; the layer nearest the viewer stays put
and each layer beneath it steps a little further, so hidden edges peek out.
It is not affine — a crease between layers at different depths kinks — which
is what makes it show depth where an affine map shows distance on the sheet.

- **Depth is the layer count from the viewer.** A face's level is the longest
  chain of faces stacked over it as seen (`faces_top_to_bottom`, consecutive
  pairs, over every subface): a face nothing lies on is 0, and every layer is
  one level below the one on it. `z_max` is the deepest level in the picture.
  The playground's first version used each face's rank in the global painter's
  order instead; on real models that shifts parts of the model by an amount
  the topological sort chose — the 921-face crane's two symmetric halves sit at
  different offsets, the Rain Frog's legs spread unevenly — where the layer
  count keeps symmetric parts symmetric and steps every layer by the same
  amount (`artifacts/diagram-distortion/levels-pair-*.png`, paint order left,
  layer count right; the playground's "Depth steps by" switch shows both). In a
  woven (cyclic) region the chain follows the painter's order
  (`wovenDrawOrder`): a stacking edge against it is the one the order broke and
  is left out.
- **A sheet vertex steps by the mean level of the faces around it.** Faces
  that meet at a crease share its vertices, so they stay joined and the crease
  kinks between their depths. This needs the faces' vertex identities, which
  the kernel scene does not carry today (below); keying vertices by folded
  position would merge the coincident corners of a stack, the very points
  that should part.
- **Points inside a face** — aux lines, woven patches, outline points the
  wireframe could not name — move by the face's own field: mean value
  coordinates over its ring's vertex steps, which on the ring is linear along
  each edge, so a line ending on a crease stays on it.
- **Direction is on the screen**: deeper layers step toward one of eight
  directions after the pose's turn and side, default **up-left** (what Zach's
  chosen picture showed: the Frog from the back, its far layers up and to the
  left). It is a diagram convention — the reader learns "the peeking edges are
  the layers beneath" — so Turn Over and Rotate keep it on screen rather than
  turning it with the model. An edge parallel to the direction does not part
  (the Lizard's long diagonal under up-left), which is why the direction is a
  choice.
- **Amount**: how far the deepest layer steps, as a fraction of the model's
  size — the longest side of the folded faces' bounds before the pose's turn,
  so rotating does not change it. Default 5% (Zach's picture: 5.2%), from 0.5%
  to 20%.

### Where it runs

All in TypeScript, after the kernel's fold and before `storeScene`:

- **Kernel** (`crates/oristudio-cp/src/folding.rs`, schema 2, additive):
  `FoldedPaperFace.points` — per outline point, its index in the folded
  wireframe's points (the crease pattern's vertex), the same ring
  `paper_scene_faces` already walks; empty when the ring named a point the
  wireframe lacks, as `edges` is. Wasm bridge types, `oristudioCpTypes.ts`,
  Rust tests (rings and indices agree; shared vertices are shared indices).
- **`cp-workspace/folded/foldedLayerSpread.ts`** (new, pure, unit-tested):
  levels from the stacks and the painter's order; per-vertex mean level; the
  per-face displacement (vertex steps, mean value coordinates inside).
- **`foldedFlatPaperScene`** takes an optional displacement and applies it to
  every face-attached point it emits (outlines, outline edges, aux lines,
  patches) before `toScenePx`. With a spread no face is hidden
  (`markHidden: false`): a layer the drawer covered may now show an edge.
- **`readFlatPicture`** passes the render's spread through. The Pose session
  keeps the last kernel scene for its fold, side, order and turn, so changing
  the amount or direction is TS work on a held scene, not a refold: it
  previews live under a slider drag and commits once on release.

### What a step stores

`DiagramCpRender` `folded-flat` gains an optional
`spread: { amount: number; toward: SpreadDirection }` (`toward` one of
`up-left | up | up-right | right | down-right | down | down-left | left`;
`amount` in (0, 0.2]). No `spread` is no spread. Threaded through capture,
Refresh, Turn Over, Rotate, layer-order paging, Show As and remembered poses
(`withRememberedPoses`, `renderToShowAs`), and Reset Pose (which keeps it: the
spread has its own off switch). The file reader validates it; an unknown field
on a render — this one included, on a build without it — must make the step a
newer build's, carried whole and locked, rather than be dropped, remembered
renders included: that rule is added here, before the format leaves this
branch.

### Annotations

A spread change (on, off, amount, direction) carries the step's annotations
by the frame change: the nearest layer does not move in scene space, so a mark
on the picture's top surface stays where it was drawn
(`annotationCarry.ts`: `pictureMove` today returns null unless the turn
changed; it gains the spread case, a `sceneTurnMove` with the turn the poses
differ by, zero when only the spread changed). A mark on a deeper layer is off
by that layer's step — said in the as-built notes, not fixed in v1.

### Pose UI

A pose verb like the others (`diagramLinkedPoseActions.ts` catalog,
`poseController.ts`, `TRACKED` for analytics with enum properties — the
direction and a bucketed amount, never a raw value): **Spread layers**
(on/off) in the Pose toolbar and in the Step pane's Pose group, and, while on,
the amount (a slider with a percentage readout) and the direction (eight
buttons around a centre, the selected one pressed) in the Step pane; the
phone's Step pane drawer has them too. Turning it on starts from the nearest
earlier step's spread when there is one, else the defaults — consistency
across a diagram without a diagram-wide setting. Disabled, with the reason,
when the picture is not a flat fold or the fold has no paper scene — the
see-through development the kernel draws for a fold with no layer order
(corrected: not the bitmap a scene past the budget is kept as, which has a
scene and spreads). One undo entry per change; a slider drag is one change.
i18n in every locale.

## Affected Areas

- Kernel: `crates/oristudio-cp/src/folding.rs` (`FoldedPaperFace.points`,
  schema 2), `crates/oristudio-cp/tests/folding.rs`, the wasm bridge.
- Web: `cp-workspace/folded/foldedLayerSpread.ts` (new),
  `cp-workspace/folded/foldedFlatScene.ts`, `engine/oristudioCpTypes.ts`;
  `diagram/capture/` (`captureFolded`, `captureSession`, `linkedPose`,
  `poseController`); `diagram/document/` (`diagramDocument`, `diagramFile`);
  `diagram/annotate/annotationCarry.ts`;
  `diagram/actions/diagramLinkedPoseActions.ts`; the Pose components and the
  Step pane; analytics (`analytics/events.ts`, `docs/analytics.md`); i18n.

## Decisions

Settled with the choice of depth steps; the ones marked *for Zach* are
defaults he has not seen yet and are cheap to change.

1. Depth steps, not DEFOX's affine distortion (Zach, 2026-10-04).
2. Depth by the whole face's layer count from the viewer, not the painter's
   rank, nor a count per corner — Zach, 2026-10-04: "keep whole face, other
   one clearly breaks on cases like gen hagiwaras frog" (counted at each
   corner, the visible layer stays put but faces skew).
3. The direction is a screen convention kept through Turn Over and Rotate;
   eight directions; default up-left — *for Zach*.
4. The amount is the deepest layer's step as a fraction of the model, default
   5%, 0.5–20%.
5. No poke check in v1: the shift keeps every stack's order. A layer can
   still cross a fold that wraps it where its level is deeper than the fold's
   mean (Risks).
6. Reset Pose keeps the spread.
7. Turning it on copies the nearest earlier step's spread.
8. Annotations carry with the nearest layer.

## Checklist

### 13a. Decide
- [x] Zach chose depth steps in the playground (2026-10-04).
- [x] Depth by layer count measured against the painter's rank on four real
  models (pairs in `artifacts/diagram-distortion/`).

### 13b. Kernel
- [x] `FoldedPaperFace.points`, schema 2; Rust tests; `cargo fmt`, `clippy`;
  wasm rebuilt; TS types. As built: `points` is the wireframe face ring
  itself (`folded.faces[i]`, the fold graph's vertex ids), `#[serde(default)]`
  so a schema 1 scene reads as empty; the test holds every face to its
  wireframe ring, every fold to exactly one other face naming its ends, and
  shows a place holding two vertices (so it is not a position key).

### 13c. The spread
- [x] `foldedLayerSpread.ts`: levels (acyclic, woven, a face in no stack),
  vertex means, mean value coordinates; unit tests with hand-checked figures
  (a book fold, a rolled letter fold, a woven three-flap fixture). As built:
  `layerSpread(kernel, order, {amount, toward}, {scale, epsilon})` returns
  `{levels, zMax, offset(face, kernelPoint)}`, the offset a scene-px vector
  added after `toScenePx`; `order` is `foldedFlatPaperScene`'s own
  (`foldedPaintOrder` exports it, computed once per scene). The three-flap
  weave is tested at the level of stacks and `wovenDrawOrder` (three
  axis-aligned flaps cannot weave without a triple overlap); the scene-level
  woven tests use the four-strip weave and `glitch.cp`.
- [x] `foldedFlatPaperScene` displacement; the empty and unspread cases
  unchanged byte for byte. As built: every emitted point goes through one
  `at(face, point)`, which without a spread is `toScenePx` itself; a digest
  test pins the unspread scenes of the real folds and the weave to what the
  producer drew before. `readFlatPicture` takes an optional spread (last
  argument) and passes `markHidden: !spread`; nothing threads it yet (13d).
  Before/after pictures of Zach's crane and four cpoogle bases:
  `artifacts/diagram-spread/pair-*.png` (`spread-pictures.mjs`).

### 13d. Document and capture
- [x] `spread` on the render; reader, writer, validators, round trips; the
  "unknown render field is newer" rule, remembered renders included. As
  built: the reader knows each render mode's fields (`CP_RENDER_FIELDS`); a
  key it does not know on the render or on any remembered render, a
  remembered render of a mode it does not know, a way under `remembered` it
  does not know, or a spread with an unknown field, an unknown direction or
  an amount past 20% makes the *step* a newer build's, carried whole and
  locked — the file's existing rule for unknown content at any depth (plan
  text corrected: not "a newer build's render", which has no carrier of its
  own). A spread of the wrong type, with no step (`amount <= 0`) or no
  direction is damage, judged as any other render field's: the link and its
  picture are dropped and the words kept. `clampSpreadAmount` holds what a
  verb writes to 0.5%–20%, to a hundredth of a percent.
- [x] Threading through capture, Refresh, Turn Over, Rotate, paging, Show As,
  remembered poses, Reset; the session's held scene; annotation carry. As
  built: the session keeps what it read of its flat fold (`FlatHold.read`,
  the kernel's paper scene and snapshot) until the fold changes, so a turn
  or a spread draws again with no kernel call (`flatPicture`, split out of
  `readFlatPicture`); `heldFlatPicture` draws it synchronously for a
  preview. The controller's `previewSpread` draws from the held fold (or
  folds once, as a capture, when nothing is held) and `commitSpread` commits
  the newest amount, waiting for the controller's own capture rather than
  being refused as busy; the preview ends when the newest lands. Spread
  Layers starts from `nearestEarlierSpread` (the current render of the
  nearest earlier linked step, turns and newer steps skipped). Carry:
  `pictureMove` takes a changed spread at the same side and order as a move
  by the turn alone. Not kept: a flat fold whose creases now fold in 3D (a
  partial fold added) is captured in 3D, which has no spread, and comes back
  flat without one.

### 13e. Pose UI
- [x] Verbs, toolbar, Step pane (amount, direction), phone drawer, undo,
  analytics, i18n. As built: Spread Layers is a pose verb, a toggle
  (`aria-pressed`, tinted as the Show As pill is) in the toolbar of a flat
  fold and of a 3D one, where it is held with "Only a flat folded picture has
  layers to spread" (not offered for a crease pattern or a simulation, whose
  toolbars have nothing folded); held too, with its reason, for a fold shown
  see-through for want of a layer order. The Step pane's Pose group
  (`DiagramSpreadRows`, CSS module beside it) has the switch and, while on,
  the amount (`SliderRow`, 0.5%–20% in half percents, the readout and
  `aria-valuetext` as a locale percentage — `SliderRow` gained optional
  `ariaLabel` and `valueText`, `GestureSlider` `aria-valuetext`) and eight
  direction buttons round a decorative centre, each named ("Deeper layers
  up and left"), the chosen one pressed. The phone's drawer is the same pane.
  A drag previews in the detail (`DiagramLinkedPose.preview`, annotations
  carried) and commits once on the slider's native `change`, so a key press
  is one entry too. The catalog's `buildDiagramSpreadControls` gives the
  direction descriptors; `useDiagramLinkedPose` binds the drag. No shortcut:
  no Pose verb has one. Analytics: `spread_on` / `spread_off` /
  `spread_amount` / `spread_direction` with `spread_direction` and
  `spread_amount_bucket` (`<=2.5`/`<=7.5`/`<=12.5`/`>12.5` percent).
- [x] Browser: real crane steps before/after; Turn Over, Rotate and layer
  orders with a spread on; undo; save, reload; a PDF export. As built
  (`artifacts/diagram-spread/pose-ui.mjs`, `pose-phone.mjs`, light and dark,
  1440 × 900 and 390 × 844): step 11 of Zach's crane — on (5% up-left), a
  drag to 13% previewed with no undo entry and committed as one, down-right,
  Turn Over, Rotate Right, Next Layer Order, Show As Crease Pattern (the fold
  with its spread remembered) and back, Reset Pose (spread kept), undo twice
  and redo, save and reopen (spread in the file and back), step 12 turned on
  from step 11's spread and ArrowRight on its slider (+0.5%, one entry), the
  card, the Pages view and the exported PDF all showing the spread picture.
  On a phone the Pose toolbar wraps to a third row for Reset Pose.

### 13f. Review
- [x] Review and fixes. 13b/13c: one finding (an aux line's pieces over a
  woven patch left the line under the spread's non-linear field) — fixed.
  13d/13e: nine confirmed, all fixed with tests that fail before: the
  commit loop read its amount before waiting (an undo or close committed the
  5% default and a closed controller folded again); a busy refusal took the
  running capture's place; a close left its preview in the view; a preview
  kept its own direction and outlived a drag that ended where it began;
  previews filled the 48 MB picture cache; Spread Layers could not turn off
  on a fold with no layer order; and a mark near a crease was carried as if
  the nearest layer stood still — marks now move with the face under them
  (mean value coordinates over its outline). Also: Spread Layers left the
  phone's Pose toolbar for the Step drawer (it wrapped a third row).
- [x] Merged into the diagram branch; the PR updated.

### 13g. Two spreads: depth and affine, depth on by default

Zach, 2026-10-04, after trying DEFOX's skew on the bird base ("generally you
want to show a gap between two flaps that are not connected… I was able to
kind of get this to work in defox"): "I want two options, 1 for depth based,
and one for affine (or whatever defox uses). Default to having depth based ON
for folded figures, set to down and 2.5% as the amount." The two are
alternatives — a spread is one kind or the other; the depth-and-open
combination the playground showed is not built.

**What a step stores.** `spread` becomes a union, `kind` first:
- `{ kind: 'depth', amount, toward }` — today's, unchanged in meaning;
- `{ kind: 'affine', amount, keep: 'top' | 'bottom', skew, axisDeg }` —
  DEFOX's distortion, `VD = (I + A)⁻¹(Vf + A·C)` with `p = τ / (1 − τ)`,
  `A = p((1 − q)I + q·R(2θ))`, `R(φ) = [[cos φ, sin φ], [sin φ, −cos φ]]`
  (a reflection about the line at θ): `amount` is τ (0.5%–25%), `skew` q
  (0–1, to a hundredth), `axisDeg` θ (0–179, whole degrees) in the sheet's
  frame. At skew 0 every point moves τ of the way back to where it lies on
  the sheet; at skew 1 points move toward the sheet along the axis and away
  across it — the gap between unjoined flaps.

A spread with no `kind` reads as depth (files saved on this branch before
13g); an unknown kind or field, or a value out of range, makes the step a
newer build's, as today.

**Defaults.** A folded-flat pose made from anything that is not one — a new
step, Show As Folded from a crease pattern or 3D, a fold reread flat — starts
with the nearest earlier step's spread, else depth 2.5% down. A flat fold that
already has a pose keeps it: a file whose step has no spread stays unspread,
and Spread Layers still turns it off. Turning the affine kind on starts from
the nearest earlier affine spread, else amount 3%, keep bottom, skew 1, axis
81° — the playground's bird base (DEFOX's Angle 0.95 is φ = 162°, θ = 81°).

**The kernel (schema 3).** `FoldedPaperScene.sheet_points: Vec<Point>`: where
each wireframe point (`FoldedPaperFace.points` names them) lies on the
unfolded sheet — `graph.points`, the crease pattern's own coordinates. Units
do not matter to the web: each face's map from sheet to scene is fitted from
its own corners. Test: for every named face, that map is a similarity whose
scale is the scene's (`model.scale`), mirrored exactly when the face is
`front_up` differently from the anchor.

**The math, in `foldedLayerSpread.ts`.** `affineSpread(kernel, spread,
frame)`:
1. The face kept still. `top`: the face seen on top over the most area (sum
   of subface polygon areas where it is `faces_top_to_bottom[0]`); `bottom`:
   the last face of a stack, by area. These are as seen in the front pass; a
   `flipped` (back) scene swaps them, so the same paper stays still when the
   model is turned over.
2. `T_a`: the anchor's sheet → scene map, a least-squares affine over its
   corners (`sheet_points[points[i]]` → `outline[i]`); `M` its linear part.
3. In the scene, `A_s = M·A·M⁻¹` (the axis and the skew turn and mirror with
   the paper, as DEFOX's do in the anchor's frame), and each point's place on
   the sheet laid under the anchor is `C' = T_a(C)`.
4. Per wireframe point, `VD = (I + A_s)⁻¹(X + A_s·C')`; the displacement
   `VD − X` in kernel units. A point inside a face moves by mean value
   coordinates over its corners' displacements — exact, since the map is
   affine on each face. A face whose ring is not named does not move.
5. The picture places `X + d` through `toScenePx`, where depth adds a scene-px
   step after it: `placement` dispatches on the kind.

The anchor does not move (its `X = C'`), so neither do marks on it; the
annotation carry already moves a mark with the face under it, either kind.

**Pose UI.** The Step pane's spread rows gain a segmented **Depth | Affine**
under the switch. Depth: today's amount and eight directions. Affine: the
amount, **Keep still: Top | Bottom**, **Skew** (0–100%) and **Axis** (0°–179°,
the readout in degrees), sliders previewing as the amount does. Verbs:
`spread-kind`, `spread-keep`, `spread-skew`, `spread-axis` beside
`spread-amount` / `spread-direction`; one undo entry each, a drag one entry.
Analytics: the existing events gain `spread_kind` (`depth` / `affine`); new
`spread_kind`, `spread_keep`, `spread_skew`, `spread_axis` actions; skew and
axis only bucketed. i18n in every locale.

**Checklist.**
- [ ] Kernel schema 3 `sheet_points`; Rust tests; fmt, clippy; wasm rebuilt;
  TS types.
- [ ] `affineSpread` with unit tests: the anchor still; skew 0 is a lerp
  toward the sheet; skew 1 moves toward along the axis and away across it;
  a turned-over pass mirrors the front's picture; a rotated pose turns it;
  top and bottom on a book fold and a letter fold; an unnamed face.
- [ ] The document union, reader, writer, defaults, `sameSpread`; the
  no-kind compatibility read.
- [ ] Defaults on: depth 2.5% down for every new flat pose.
- [ ] Verbs, controller previews, Step pane, phone drawer, analytics, i18n.
- [ ] Browser: the bird base (`rabbit-ear/tests/files/cp/bird-base.cp`)
  affine against the playground's picture; Zach's crane with depth on by
  default; Turn Over, Rotate, undo, save and reopen, the PDF.
- [ ] Review.

## Risks

1. Faces that newly overlap after the shift keep the painter's order, which
   was arbitrary between faces that did not overlap: a sliver can be drawn in
   the wrong order. Small at small amounts; watched on the real steps.
2. Woven regions: patches move with their face, but the levels there follow
   a broken cycle.
3. Size: every face is stored with a spread on, so more large steps exceed the
   2 MB stored-scene budget and fall back to a bitmap. Measured (13c): 6.8 KB
   to 150 KB for Langerak's 921-face crane, 1 KB to 7 KB for Zach's step 14 —
   far inside the budget.
4. A layer wrapped by a fold steps by its own level while the fold's vertices
   step by the mean of the two faces it joins; where the wrapped layer's
   level differs from that mean it pokes past the fold — deeper, through a
   fold on the side the layers step toward; shallower, through one on the
   far side. Measured on the real steps (13c, 5% up-left, a fold's midpoint
   more than 0.2% of the model inside a layer it wraps, each step at its own
   turn): on Zach's crane 1 of 2 wrapped folds (step 5), 1 of 10 (10), 3 of
   14 (11), 9 of 22 (12), 11 of 20 (13), 20 of 36 (14), none on steps 4 and
   6–9; on whole cpoogle bases from the front 19 of 126 (Rain Frog), 20 of 92
   (Lizard), 121 of 778 (Langerak's crane), none on Hagiwara's frog. The
   count changes with the turn, since the direction stays on the screen. On
   step 14 most lie inside the outline, under the layers above them; where
   one reaches the outline it shows as a sliver past a folded edge, a few px
   at card size (step 11's right edge). Not rare: decision 5 (no poke check in v1) now stands on the
   slivers being small, not on there being few — for Zach.
5. Deep stacks: a 40-layer model steps each layer 1/40 of the amount, so its
   middle layers barely part; a per-layer step would explode instead. The
   level is the longest chain over a face through every stack, so `z_max`
   runs past the deepest single stack: 20 levels for 16 layers (crane step
   11), 86 for 37 (Rain Frog), 148 for 86 (Lizard), 450 for 123 (Langerak's
   crane) — each level's step is that much smaller.
6. The nearest layer is still only where no deeper face shares its vertex: a
   top face's corner on a fold to a deep face steps by their mean, so the
   top face's own outline kinks there, and a layer between can show on the
   far side of it (Zach's crane step 11, the right edge).

## Why not the affine distortion

DEFOX moves every point a fraction τ back toward where it lies on the sheet
(`VD = (I + A)⁻¹(Vf + A·C)`, `src/distortionfolder/distortion.js:39-55`): exact
and affine, but gaps follow distance on the sheet, not depth, and it never
looks at the layer order, so on real models opening every fold pokes layers
through the folds that wrap them (7–34 places on 11 of 12 cpoogle models and
on 7 of Zach's 12 crane steps); opening only a step's new folds avoids that
but often cannot open alone. Zach compared it with depth steps on the same
models and chose depth steps.
