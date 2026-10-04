# Diagram Pose: Spread Layers (depth steps)

**Status: decided (2026-10-04), being built.** Phase 13 of
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
on a render — this one included, on a build without it — must read as a newer
build's render rather than be dropped, remembered renders included: that rule
is added here, before the format leaves this branch.

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
when the picture is not a flat fold or the fold has no paper scene (the
bitmap fallback). One undo entry per change; a slider drag is one change.
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
2. Depth by layer count from the viewer, not the painter's rank — *for Zach*:
   the playground's "Depth steps by" switch shows both on his models.
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
- [ ] `FoldedPaperFace.points`, schema 2; Rust tests; `cargo fmt`, `clippy`;
  wasm rebuilt; TS types.

### 13c. The spread
- [ ] `foldedLayerSpread.ts`: levels (acyclic, woven, a face in no stack),
  vertex means, mean value coordinates; unit tests with hand-checked figures
  (a book fold, a rolled letter fold, a woven three-flap fixture).
- [ ] `foldedFlatPaperScene` displacement; the empty and unspread cases
  unchanged byte for byte.

### 13d. Document and capture
- [ ] `spread` on the render; reader, writer, validators, round trips; the
  "unknown render field is newer" rule, remembered renders included.
- [ ] Threading through capture, Refresh, Turn Over, Rotate, paging, Show As,
  remembered poses, Reset; the session's held scene; annotation carry.

### 13e. Pose UI
- [ ] Verbs, toolbar, Step pane (amount, direction), phone drawer, undo,
  analytics, i18n.
- [ ] Browser: real crane steps before/after; Turn Over, Rotate and layer
  orders with a spread on; undo; save, reload; a PDF export.

### 13f. Review
- [ ] Review and fixes; the PR and Phase 13 updated.

## Risks

1. Faces that newly overlap after the shift keep the painter's order, which
   was arbitrary between faces that did not overlap: a sliver can be drawn in
   the wrong order. Small at small amounts; watched on the real steps.
2. Woven regions: patches move with their face, but the levels there follow
   a broken cycle.
3. Size: every face is stored with a spread on, so more large steps exceed the
   2 MB stored-scene budget and fall back to a bitmap.
4. A layer wrapped by a fold steps by its own level while the fold's vertices
   step by the mean of the two faces it joins; where the wrapped layer is
   deeper than that mean it pokes past the fold. Rare in the playground's
   models; looked for on the real steps.
5. Deep stacks: a 40-layer model steps each layer 1/40 of the amount, so its
   middle layers barely part; a per-layer step would explode instead.

## Why not the affine distortion

DEFOX moves every point a fraction τ back toward where it lies on the sheet
(`VD = (I + A)⁻¹(Vf + A·C)`, `src/distortionfolder/distortion.js:39-55`): exact
and affine, but gaps follow distance on the sheet, not depth, and it never
looks at the layer order, so on real models opening every fold pokes layers
through the folds that wrap them (7–34 places on 11 of 12 cpoogle models and
on 7 of Zach's 12 crane steps); opening only a step's new folds avoids that
but often cannot open alone. Zach compared it with depth steps on the same
models and chose depth steps.
