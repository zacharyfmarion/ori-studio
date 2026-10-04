# Diagram Pose: Spread Layers (affine distortion)

**Status: for discussion with Zach (2026-10-04). Nothing is built.** Phase 13
of `implementation-plans/diagram-workspace.md`. The research behind it (four
readers, a synthesis and a critic) and its scratch checks are not in the repo;
the findings that matter are here. A playground to try the options on real
folds — Zach's crane diagram step by step, twelve cpoogle crease patterns
folded to their bases with Flat-Folder, simple bases and DEFOX's sample:
https://claude.ai/artifact/NrqrBDkkmEVMbNjJSbVezf (private).

## Goal

A tool in Pose that draws a flat-folded step with its layers slightly offset —
Zach: "display layers on parts of the design to give the folder more
information about how they are distributed (otherwise a bunch of faces are
coplanar and it's harder to tell what is going on)". The source is the
distortion of DEFOX / step-folder by Kei Morisue
(https://kei-morisue.github.io/step-folder/; a branch of Jason Ku's
Line-Folder, built on Flat-Folder), and its paper, *Affine Distortions*
(14 pp., in that repository).

Constraints:
- It is a choice about the picture, as Turn Over is: the fold and its layer
  order never change ("pose applied to the picture, never to the fold",
  `captureFolded.ts`).
- It works on parts of the design, not only the whole model.
- The math is DEFOX's, under a parity test; how it is set is ours, because
  DEFOX's controls are its least clear part.
- It never draws a physically impossible picture without saying so.

## Approach

### What distortion is

Move every point of the folded picture a fraction τ of the way back toward
where it lies on the unfolded sheet; one face — the **anchor** — stays put.
Layers that lie on top of each other came from different places on the sheet,
so they drift apart and hidden edges peek out. A flap folded once is drawn as
if left slightly unpressed: foreshortened toward its crease, the layer under
it showing.

Precisely (DEFOX `src/distortionfolder/distortion.js:39-55`):
`VD = (I + A)⁻¹ (Vf + A·C)` with `A = r1·I + r2·[[cos φ, sin φ], [sin φ, −cos φ]]`,
`r1 = p(1−q)`, `r2 = p·q`, `p = exp(−1/Level)`, `q = Skew`, `φ = (2·Angle−1)π`;
`Vf` the folded position, `C` the sheet position — or, with a **catalyst**,
the position in a second fold of the step's creases with some left open. The
same thing as a blend: `VD = Vf + T·(C − Vf)`, `T = (I + A)⁻¹A`; isotropic
(`q = 0`), `T = τ·I` with `τ = p/(1+p)`. The `(I + A)⁻¹` is what holds the
anchor still. The paper's Theorem 26 (p. 13) keeps the picture regular,
continuous and affine for `r⁺ + r⁻ < 1`; it says nothing of layer order
(pp. 2, 8), and gives no rule for choosing the parameters. DEFOX's Level ≤ 1
reaches τ ≈ 0.27.

Three consequences shape the design:
1. **Gaps follow distance on the sheet, not depth in the stack.**
2. **One transform for the whole model** — unless the target changes: the
   catalyst (open only some folds) is how DEFOX gets local spreads, and it
   stays inside the paper's valid class.
3. **It never looks at the layer order**, so a layer can poke out through a
   fold that wraps it. In the rolled letter fold (playground's default),
   keeping the bottom or DEFOX's face 0 still pokes the tucked panel through
   the fold; keeping the top still, or opening only the last fold made, does
   not. On real crease patterns the same holds at scale (a quick check, which
   can over-report; τ = 0.05, the top layer still): opening every fold pokes
   in 7–34 places on 11 of 12 cpoogle models (Kei Morisue's Rain Frog 23,
   Smile 24, Inside-Out 34; Jason Ku's Angel 29, Lizard 14; Jordan Langerak's
   921-face crane 22) and on 7 of Zach's 12 crane steps (up to 24); opening
   only the folds each crane step adds pokes nowhere, and refuses on two
   steps (9 and 11) whose new folds cannot open on their own.

The alternative the paper sets aside (Fig. 4, p. 10): Akitaya's **depth
shift**, `D(v) = D̄(v) + p·z_v/z_max` — every point steps by its depth, so
the picture shows layer *count* directly, but it is not affine: creases kink.
The playground has it as "Depth steps".

### Two decisions, not one

The research's option list mixed two separate choices:
- **What opens**: every fold (DEFOX with no catalyst); only picked folds
  (DEFOX's catalyst, picked on the picture or the sheet instead of drawn as a
  second crease pattern); only the folds this step adds (picked for you); or
  depth steps instead.
- **How it is set**: a slider (plus which layer stays still, plus an optional
  slant); a drag on the picture; or automatic candidates paged like layer
  orders.

What DEFOX makes unclear, specifically: the controls name the matrix
(Level, Skew, Angle), not the picture; Angle does nothing at the default Skew
0; Level is exponential (the first ~15% does nothing visible); which edge
shows depends on an arbitrary face 0; the catalyst is a second crease pattern
edited on the sheet with no preview, refused unless it passes Kawasaki, and
its save silently resets unsaved slider moves; nothing warns of a poke.

### Picking folds on a real model

A single crease inside a real model usually cannot open on its own: picking
two folds at random on a sample step made six points land in two places. So
picking has to work by what a folder means — a flap's hinge, every fold along
a line, a region — with "can't open alone" offering the folds that meet it.
The research's "every crease folded onto the tapped line" is one rule; a flap
picked by its face is another (question 3).

### Architecture

- **Live** (while dragging): TS, O(V) per frame from cached per-fold data
  (each face's folded and sheet rings, the targets, the undistorted order),
  painting whole faces in the posed order as DEFOX does live. A spike decides
  whether this tier is needed at all: if a commit is fast enough on real
  steps (< ~100 ms), drop it.
- **Commit**: a kernel entry that takes the deformed folded points and
  rebuilds the paper scene — subfaces from the deformed wireframe, stacked
  from the held `HierarchyTable` (a new stacking function; ties for newly
  overlapping pairs broken by the undistorted painter's order) — then the
  existing `foldedFlatPaperScene` and `storeScene`. The camera is placed from
  the *undistorted* points, or the anchor moves. The kernel never knows what
  a distortion is; the math lives once, in TS, under the oracle.
- **Targets for opened folds**: a kernel entry that refolds the step's
  creases with the opened ones flat, from the same starting face, and refuses
  (listing them) when a point would land in two places — the paper's flatness
  condition (2.38–2.39), which also covers patterns with holes, unlike
  DEFOX's Kawasaki-only check.
- **One poke check**, in one place (the research's two-tier version was two
  predicates for one question).
- **What a step stores**: an optional `spread` on the `folded-flat` render —
  amount (τ), what opens (every fold / opened creases in sheet space, never
  kernel indices), the layer that stays still (top / bottom by area / a sheet
  point), optional slant. Threaded through capture, Refresh, turn-over,
  layer-order paging, show-as and remembered poses, Reset (question 8),
  annotation carry. An older build reading a newer render must see it as
  newer, remembered renders included — a rule to add on this branch before
  merge (it would otherwise silently drop `spread`).
- **Page layout**: a spread grows the picture's bounds, so its cell's scale
  depends on the spread; and revealed slivers enlarge the stored scene (more
  steps over the 2 MB budget fall back to a bitmap).
- **Porting**: vendor a curated subset of step-folder into
  `third_party/step-folder/` with its `LICENSE` (MIT, "Copyright (c) 2022
  Jason S. Ku (origamimagiro)", inherited from Line-Folder; Kei Morisue's code
  carries no separate notice), aliasing its `flatfolder/` imports to
  `third_party/flat-folder/src` (which differs in three files: an import in
  `conversion.js`, `note.js`, and `gui.js:85-87`); link the paper rather than
  vendor it. `upstream-sync.json` entry; the AGENTS.md porting table; a
  `PORTING.md` section. The oracle checks parity per function (our layer
  order is Oriedita's, not Flat-Folder's): the blend against `DIST.FOLD_2_VD`;
  opened-fold targets against DEFOX's catalyst positions modulo its frame
  (its catalyst lines are centred, the step's are not).
- **Analytics**: the spread is a pose verb, tracked once by the existing
  chokepoint (`poseController.ts` `TRACKED`) with enum properties — not a
  second hand-placed event.

## Affected Areas

- Kernel: `crates/oristudio-cp/src/folding.rs` (scene fields, the deformed
  scene, opened-fold targets, stacking), `crates/oristudio-cp-wasm`, the
  worker API and bindings.
- Web: `apps/web/src/diagram/spread/` (new: math, check, hook);
  `diagram/capture/` (linkedPose, captureFolded, captureSession,
  poseController); `diagram/document/` (types, file reader, validators);
  `diagram/actions/diagramLinkedPoseActions.ts`; the Pose components and the
  Step pane; keyboard registry; analytics; i18n.
- Upstream: `third_party/step-folder/`, `upstream-sync.json`, an oracle,
  `PORTING.md`, AGENTS.md.

## Decisions for Zach

1. **Spread by distance on the sheet, or by depth?** Every fold / Picked
   folds are DEFOX's (affine, exact, gaps by sheet distance); Depth steps
   shows layer count but kinks creases. *Recommend distance, with picked
   folds* — unless the playground's depth steps read better to you.
2. **What opens by default?** Every fold (DEFOX parity, pokes on real models)
   vs only the folds this step adds (needs the previous step to be an earlier
   state of the same sheet, aligned) vs nothing until picked. *Recommend: the
   step's new folds when they can be found, else nothing picked yet.*
3. **How a fold is picked**: a crease line (with every crease folded onto it
   under the tap), or a flap (tap a layer: its hinge opens), on the picture or
   the sheet. *Recommend tapping on the picture, by line, with "Also open the
   folds that meet it" when it can't open alone* — the playground shows how
   often that is.
4. **Which layer stays still by default?** Top by area (the only valid anchor
   in the letter fold), bottom, or DEFOX's face 0. *Recommend top, pickable.*
5. **A poke-through**: refuse it, or allow it with a mark and the fix that
   clears it (another layer still, or fewer folds open — less spread never
   clears one)? *Recommend allow with a mark and the fix.*
6. **Turn Over with a spread**: keep the same anchor (physically consistent;
   what showed on the front hides on the back), or re-resolve "top" to the new
   top? *Recommend re-resolve.*
7. **Slant** (DEFOX's Skew and Angle): drop it, an Advanced pair, or a handle
   on the picture? *Recommend drop it from the first cut.*
8. **Reset Pose**: does it remove the spread? *Recommend no — the spread has
   its own Remove — but Reset's "front, upright, first order" moves an Auto
   anchor, so it must re-resolve.*
9. **How the amount reads**: DEFOX's Level, a percentage of the model, or mm
   at print size (circular with the page layout). *Recommend a percentage of
   the model, τ stored.*
10. **Annotations with a spread**: today's "picture changed" notice, or
    anchored in sheet space so they follow (Phase 14's vertex-snapped circles
    will sit on distorted vertices). *Recommend sheet-space anchors for
    snapped marks.*
11. **A spread across steps**: per step only, or a diagram-wide default amount
    (DEFOX's "infer prev/next" copies its parameters)? *Recommend a default
    amount.*

## Checklist

### 13a. Decide
- [ ] Zach tries the playground and answers the decisions above.

### 13b. Spike (nothing merges)
- [ ] A TS blend equal to vendored `DIST.FOLD_2_VD` to 1e-12 on fixtures and
  random parameters.
- [ ] Kernel spike: scene sheet rings and vertex ids; the deformed-scene
  entry; before/after renders of real Ori Studio steps, each with its own
  confidence note; timings (scene size, worker transfer, subface rebuild, TS
  frame) — decide whether the live tier is needed.
- [ ] Opened-fold targets with the consistency refusal; the poke check against
  the letter fold and real steps, its false alarms counted.
- [ ] A face that distortion reveals is drawn after a commit.
- [ ] Zach approves the pictures; the figures recorded here.

### 13c. Upstream
- [ ] Vendor the subset, `upstream-sync.json`, AGENTS.md row, `PORTING.md`,
  the oracle.

### 13d. Kernel
- [ ] Scene fields, the deformed scene, opened-fold targets, stacking; wasm
  bridge, worker API, bindings; `cargo fmt`, `clippy`, tests.

### 13e. Document and capture
- [ ] The "unknown key is newer" rule for renders and remembered renders;
  `spread` with validators and round trips; threading; session caching and
  newest-waits commits; undo joining.

### 13f. Pose UI
- [ ] The tool per the decisions: catalog, hook, live view, Step pane group,
  picking, poke marks, "can't open alone", phone (the Step pane drawer),
  shortcuts, i18n, analytics.
- [ ] Validation and browser checks: real steps before/after; turn over,
  rotate, layer orders with a spread on; undo; save, reload, export.

### 13g. Review
- [ ] Review and fixes; the PR and Phase 13 updated.

## Risks

1. Validity on real models: the quick check flags many pokes with every fold
   open; newly overlapping faces get a tie-break that may look wrong.
2. Picking: single creases rarely open alone in a real model; "the step's new
   folds" needs aligned, congruent consecutive steps.
3. Kernel geometry: distorted stacks no longer deduplicate coincident edges;
   the intersection pass is O(n²) and tolerances (`epsilon.rs`) are coarser
   than the slivers a small spread makes.
4. The live preview and the committed picture can differ (ties, woven
   patches), so the picture may jump on release.
5. Licence and attribution as above; the paper's licence is unstated.
