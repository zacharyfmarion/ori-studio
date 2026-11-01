# oristudio-fold

The Fold workspace's engine: fold a sheet the way a person does. A flat folded
state, the one constructor that validates it, the plain fold, and the one
pipeline compound folds land through, with the reverse folds, the crimp, the
tuck and the vertex folds (squash, petal fold, rabbit ear, swivel) on it.

- `state`: the crease pattern with stable ids (`B | M | V | F`, an F crease
  remembering its last letter, every crease the step that made it; letters
  front-relative), convex faces with their lineage, isometries derived from a
  stationary root and checked, never averaged, the pairwise layer order in
  absolute terms, and the view (turn-over, rotation) kept outside the model
  frame. `State::make` is the only constructor: residual, hinge consistency,
  convexity, order completeness, the constraint families through
  `oristudio-layer-order`'s checker, and letters against the order, each
  refusal naming faces and vertices.
- `fold`: the plain fold, closed-form. Snap ℓ through landmarks unless that
  changes a vertex's class, classify once, close the moving set under
  adjacency (creases with an end on the moving side) and overlap (layers above
  for a valley, below for a mountain), split each crossed crease once, toggle
  hinges on ℓ, re-derive and check the isometries, carry the order by block and
  place the movers, derive the letters. Seeds: all layers, a depth at a sheet
  point, or flaps by sheet points; a tuck over or under a named face is accepted
  only if it validates. Precrease, refold, unfold, turn over and rotate.
- `fold::partial` and `crease_marks`: a precrease of part of its line — a
  segment between two sheet anchors, or a pinch of a stored length (the
  default a sixteenth of the sheet's shorter side) centred on one, each
  projected onto the located line — through the layers the seed and closure
  pick. Every face of U the line crosses gets the part inside the extent, in
  sheet coordinates, with the letter the whole precrease would give it.
  These crease marks live beside the face graph: they split no face, change
  no order, are carried by every later operation (a crease made along one
  subsumes what it covers), and are checked by `State::make`. The scene
  carries them (and their per-face parts as the kernel's `aux_lines`), the
  landmarks their ends and crossings, the summary `marks_added`; Send to Edit
  and the FOLD export write them as auxiliary lines.
- `sheet`: convex sheets only — square, rectangle, regular polygon with its
  first vertex at −π/2, or a convex outline in the unit frame.
- `numerics`: tol = 1e-6 of the sheet (the shared `TOL`) and the minimum
  material feature μ = 1e-3, refusing near misses, short creases and thin
  pieces. Narrow image overlaps are admitted when the full arrangement agrees
  at tol; ambiguous geometry and invalid layer orders are refused.
- `refusal`: typed refusals with stable codes and the fixes the engine can offer
  (include the flaps the closure adds, fold the other way, pick a flap, fold
  along the landmark line).
- `scene`: per state, a superset of the kernel's folded paper scene, schema 3
  (faces with sheet vertex ids and edge kinds, the overlay's cells with full
  stacks, sheet points), in the view's frame the way the kernel carries its
  rear pass, plus each face's transform, the crease pattern with Fold's edge
  ids and the step that made each crease, and the faces' lineage.
- `fold::section`: the cross-section along a fold line (D14): intervals cut
  where a face's contact with ℓ starts or ends, each with its stack; display
  layers (faces joined across F creases), ordered topologically with the
  unordered pairs named and a woven fallback; each row's flap; "Layers". And
  the depth-choice preview: the distinct moving sets of the top 1, 2, …
  layers at a point.
- `fold::action`: a fold's geometry on its parent (D12): ℓ across the
  silhouette, its visible and hidden spans, the moving faces, and a grip with
  its image and the layers over each.
- `summary`: per step, the M/V/F counts, the crease-pattern diff (added,
  reversed, unfolded, refolded) and "Layers".
- `kernel` (feature `kernel`, which adds `oristudio-cp` and `treemaker-fold`):
  `fold_cp_to_model`, the one conversion to the CP kernel's model (plan D10):
  B → `Black0`, M → `Red1`, V → `Blue2`, F remembering X → `None` with the
  direction hint X, placed where the kernel's FOLD reader puts every pattern
  (`KernelFrame`), so its FOLD writer and reader return the model to the bit.
- `fold_file` (feature `kernel`): the FOLD export of a sequence path,
  `file_classes: ["diagrams", "singleModel"]`. The root frame is the final
  crease pattern from the kernel's FOLD writer, which Edit opens like Send to
  Edit; each state is a flat `foldedForm` frame (`frame_parent: 0`,
  `frame_inherit: false`) with its vertices folded as the viewer sees them,
  `F` for unfolded creases, `faceOrders` in FOLD's convention, an
  `oristudio:fold-step` marker and per-face sheet → folded matrices in
  Beloch's `beloch:faces_matrix` layout under `oristudio:faces_matrix`. The
  step frames and their matrices are in the unit sheet frame, y up; the root
  is in Oriedita's model space, y down (`KernelFrame`), with its faces
  clockwise. The two are mirror images, so a viewer draws the root mirrored
  against a flat step of the same paper; each frame reads right by itself,
  and a reader that relates a frame to the root maps through `KernelFrame`.
  The size is held against the 3D writer's element cap (`interchange.rs`),
  summed over the whole file.
- `Unordered` and `complete`: parts whose layer order is still to be decided
  (the gate's checks up to the order, a crease whose letter is unknown folded
  without one), and the engine's one "complete the rest" entry: an adapter
  from `oristudio-layer-order`'s constraint problem and cells to
  `treemaker-flatfold`'s `complete_layer_order`, with fixed pairs *carried* or
  *seed*, per-component choices, a true ‹ n of m › with truncation reported,
  and a node or deadline budget; the deadline also meters the propagation
  of the seeds, which on a deep stack is most of a completion, and is for
  interactive callers only, since where it stops depends on the clock.
  `complete_around` searches only the cells
  the faces an operation moved cover, every pair outside them carried, and
  gives the whole problem's answer. Import CP and the compound folds use it.
- `import`: Import CP (plan D16, D10's inverse) from plain segments, no kernel.
  The sheet from the border (`outline::detect_border_loops`, one loop, square
  or rectangle), matched against the sequence's sheet (a quarter turn when
  that is what fits) or adopted by an empty sequence; B, M, V kept,
  unassigned with a hint a precrease, unassigned without one folded with its
  letter left to the completion, aux a guide; the planar graph and convex
  faces, refusing a crease that is no full chord; the root continuing the
  previous state's. Completion is seeded by the letters, and "Start from
  Edit's folded figure" adds Oriedita's relations as seeds. Refusals have
  `import_*` codes and name points in the input's coordinates.
- `witness`: stored choices (plan D6) with faces named by interior sheet
  points and pairs as FOLD `faceOrders` triples, which read the same whatever
  the root's orientation; Import CP's `orderJson` and a compound fold's pick.
  Replay resolves the witnesses and completes: exactly one order, or the node
  is broken.

Compound folds (plan D4, D15, Phases 9 and 11):

- `compound`: the one pipeline every compound fold lands through. A macro (its
  scores; the faces that move, partitioned into blocks, each with its
  motion; placements of a block against named faces; the rule for pairs
  across blocks) is scored through the plain fold's split (`fold::score`) —
  along one line, along a line per layer in turn, or as a fan of rays from a
  point inside the paper — and from there every macro shares one
  implementation (`compound::pieces`):
  the hinge diff follows from the motions (a crease folds where its faces'
  orientations differ); the isometries are derived from the stayer and
  checked against the prediction; the image–image guard checks narrow overlaps
  against the full arrangement and refuses ambiguous ones; only pairs that both stay or
  share a block are carried (kept under a rotation, reversed under a
  reflection, never because two isometries agree); the placements and the
  cross-block pairs are seeds; the rest is completed around the moved faces;
  the letters come from the order and `State::make` validates, reusing the
  problem the completion was built on. No order is a refusal naming faces,
  more than one a choice whose pick is stored as witness-keyed pairs.
- `compound::reverse`: the inside and outside reverse fold (research §5.2).
  The tip is the moving side's flaps that hold the anchor; each flap opens on
  its own at a split into a lower and an upper block along one spine of
  folded creases, each block hinged on ℓ to a body that stays, the lower
  body below the upper; a flap with no spine moves whole beside one that
  opens. Openings are scanned per spine as the down-sets of the pieces left
  (`MAX_OPENINGS` per flap, truncation reported). Inside puts T1 over its
  body and T2 under its own, outside the reverse; pairs across blocks keep
  their absolute order. `reverse_kinds` says which kinds land; a refusal
  offers the other kind, the flaps in the tip's way (`reverse_tip_not_free`)
  or the flaps that open. Stored choices: each ambiguous flap's upper block
  and the order, by witnesses. A stored opening names the block its
  witnesses lie in, every flat-joined part of it holding one (so a face
  split by a precrease since still names it), read on the upper blocks and
  then on the lower ones: started the other side up (the Paper pane's Front
  up / Back up), the stack is reversed and the same split has them below. One
  that names none breaks the step.
- `compound::crimp`: the crimp (plan Phase 11): two reverse folds of one
  kind, along ℓ1 nearer the body and ℓ2 nearer the tip, folded as one
  operation and verified only at its end. The strip between the lines moves
  by ρ1, the reflection across ℓ1, and the tip beyond ℓ2 by ρ1∘ρ2; nothing
  lands between, since the first reverse alone is not flat in 4.5% (inside)
  and 5.6% (outside) of the spike's valid crimps. A mixed pair is a reverse
  and a counter-reverse, not a crimp: in 574 of the spike's 585 valid mixed
  states the first reverse lands alone, so it is left to two reverse folds.
  The tip and its openings are the reverse fold's at ℓ1, and ℓ2 must not
  meet ℓ1 over the paper that moves. ℓ1 scores the tip, a second score pass
  scores ℓ2 across what it moves, and the carry, seeds, completion, letters
  and gate run once on the result. Seeds: each strip block against its body
  on ℓ1 and each tip block against its strip on ℓ2, as a reverse fold of the
  kind puts them; the rest of the tip against the strip is the completion's
  (`Across::Alike`). `crimp_kinds` says which kinds land; the refusals
  (`crimp_lines_meet`, `crimp_misses_tip`, `crimp_no_opening`,
  `crimp_kind_infeasible` offering the other kind, `crimp_tip_not_free`)
  name faces. Stored choices are the reverse fold's.
- `compound::tuck`: the tuck (research §4.4, §5.2): a plain fold slid
  immediately under a named layer T (a valley, as the viewer sees it) or
  over it (a mountain). What moves is Beloch's bounded closure (ADR 0052):
  the seed, grown across every crease with an end on the moving side, and
  every moving-side layer the block would otherwise pass through on its way
  to T; T never moves. "Immediately under T" is read strictly (the spike's
  H1): the block lies under T, and a layer that meets T lies beyond it where
  it is under every face of T it meets (the block over it) and on T's side
  otherwise (the block under it). `State::analyse_tuck` lists every layer
  the block lands on with whether it takes the tuck, within an optional
  deadline read before each target, the targets that move least decided
  first (`feasible: None` past it); a refusal (`tuck_infeasible`, naming no
  conflict for a target the block lands nowhere on) offers up to three
  targets that do (`Fix::TuckTarget`). The plain fold's own
  `Placement::Over` and `Under` are unchanged: a closed-form placement the
  gate accepts or refuses.
- **A pleat is two plain folds**, not an operation of its own: a valley and
  a mountain along parallel lines, each of which lands a flat state by
  itself (unlike a crimp's first reverse), so a tool makes a pleat as two
  steps and the engine has no pleat op to keep in step with them.
- `compound::vertex`: the vertex folds (research §5.3). Each macro puts every
  piece in a block by its motion class (the product of the reflections
  across the creases between it and the paper that stays); the direction
  seed puts every block above what stays (valley) or below it; pairs across
  blocks are left to the completion. One report, outcome and stored choice
  for all four (`VertexReport`, `VertexOutcome`, `VertexChoices`). Each is
  pictured as a plain fold along the crease that tells it best, a crease
  from a vertex drawn from it: a squash's lower crease with its arrow onto
  the target and a push onto the spine, a petal fold's H, a fan's crease the
  far wedge turns across last (`squash_action`, `petal_action`,
  `rabbit_ear_action`, `swivel_action`).
  - `compound::squash`: a two-layer flap by a point on its upper layer, the
    spine's target (default the hinge line) and the direction. Its layers
    crease on lines of their own (h + (1 ± μ)D/2: one shared line closes only
    when the spine lands on the hinge). Refused up front, naming faces: no
    two-layer flap, an upper layer held by its spine alone, a flap held off
    its hinge (`squash_flap_not_free`), paper over or inside it
    (`squash_flap_covered`), a target outside the wedge.
  - `compound::petal`: H and the direction on a flap whose kite creases and
    H are precreased (`petal_not_precreased` otherwise, naming the paper
    they would cross); scores nothing, eight hinges change, six blocks with
    what stays.
  - `compound::fan`, `compound::rabbit`, `compound::swivel`: four rays from a
    point inside the chosen layers — a triangle's incenter to its corners,
    or a free vertex toward given points — the fourth one of Kawasaki's
    candidates (three at most, offered by the analysis; a refused ray offers
    the ones that land, `use_emergent`). A ray into paper that does not fold
    with the layers is `fan_ray_blocked`. The three given creases take the
    direction's letter and the fourth the other (a valley ear is V, V, V and
    M; a swivel is a rabbit ear on free hinges): the fourth rises as the
    ridge, one of the far wedge's rays, seeded in every layer, which settles
    the order the direction leaves open. A fourth crease beside the paper
    that stays is `fan_fourth_beside_stayer`, and one the angles will not
    let fold opposite the other three (a swivel's) `fan_fourth_cannot_rise`,
    each offering the rays that land. A stored order is replayed only when
    the fold leaves several; an older step's `ridge` is no longer read.
- `compound::sink`: the open sink, the closed sink and the unsink (research
  §5.4). The point is one flap; its geometry is the plain fold of the whole
  point, so only letters and order are decided. Refused up front: an open
  point (raw edges at its crown), and for an open sink an outline of both
  letters, no axis (two straight sides, beside a flat top), or a line off
  square to the axis, offering the square line and the closed sink. The open
  sink is a block per display layer, each tip face anchored directly
  against its own piece that stays on its pocket side (per-face anchors,
  `compound::Anchor`); the closed sink is an inside reverse of the whole
  point into a pocket (a split along outline creases whose gap one display
  layer bounds; the twisted splits are left out), stored by a face on each
  side of a seam, either way up; the unsink reflects the sunk tip back and
  leaves its whole order to the completion (`Across::Free`).
- `compound::motion`: a compound step's `StepMotion` (plan D15): legs of
  groups turning about a hinge with exact endpoints. A reverse fold is
  *visual* (it has no rigid path short of unfolding the vertex flat): its
  blocks turn opposite ways about ℓ, stacked as the parent until edge-on and
  as the landed state after. A tuck is its block turning about ℓ. A crimp
  folds both lines together, in one spread and one close: each strip block
  turns about ℓ1 as a reverse fold's block does while its tip block turns
  about ℓ2 the other way, carried by the strip's turn
  (`MotionGroup::carrier`), so the tip's pose is ρ1∘ρ2 once both are done
  and between them it slides over as a pleat does instead of standing
  edge-on with its strip. A vertex fold is staged: one half turn per crease a
  block turns across, a stage each, every leg placing every moving face
  (`MotionGroup::then`).

The axioms on flat and folded forms (plan Phase 3):

- `anchor`: what a stored step names paper by — sheet points and sheet
  segments — resolved in a state's model frame, boundaries included. A
  segment resolves while no folded crease bends it: across flat creases (a
  precrease inserted before the step splits it) and along a hinge.
- `landmarks`: vertex images, raw edges, bends, visible creases, crossings and
  Divide-line marks (passed in as sheet points), deduplicated within the
  tolerance with every source kept, each source with the anchor a step stores.
  Visibility comes from the layer order as the viewer sees it, probed just
  inside each of a feature's faces. Also the existing-crease pick and the top
  visible layer at a point, where a mark goes.
- `silhouette`: the union of the face images as the `Paper` the constructions
  fold: per-face runs along a line merged within the tolerance.
- `axioms`: O1–O7 on anchors through `oristudio_geometry::construct`, each root
  with its moving side from the axiom's movers, or none for the step to name
  (O1, O4, an O3 whose `m1` straddles the fold, an O6 whose points lie on
  opposite sides: either side moves one point and the other's line); replay
  to the candidate nearest the stored line.
- `anchored`: a plain fold whose line is an axiom and its root, an existing
  crease or bend, or a free line through two sheet points; its side from the
  axiom, a `toward` point or the seed; the axiom's movers must be on layers
  that move.
- `remedy`: a fold refused as a sliver is offered the exact O5 or O7 line its
  pins allow (a point the line passes through, a line it is perpendicular to),
  as a step it can store, only if that lands.

See `implementation-plans/fold-workspace.md` (D1–D6, D8, D10, D12, D14, D16;
Phase 3) and `research/2026-10-08-fold-workspace.md` (§3, §4, §6, §7, §10).
The core spike under `artifacts/fold-spike/core/` and the sink spike's
importer were the behavioural references; nothing is ported from them, and
Flat-Folder's search is called through `treemaker-flatfold`, not copied.

## Tests

`cargo test -p oristudio-fold` runs:

- the unit tests beside each module;
- `tests/golden.rs`: the spike's sign conventions G1–G12 (valley and mountain
  from the front and the back, two layers, the top layer's corner, precrease,
  refold, unfold, the all-moving refusal, a rectangle), the closure (i)
  qualifier, a near miss with its landmark line, a sliver, and negative
  controls the gate must refuse.
- `tests/classics.rs`: the kite base and a flap unfold, a top layer's corner
  after two folds, a precrease through four layers then refold, and a tuck,
  each recorded under `tests/fixtures/classics/` as its operations and the
  canonical outcome of every step, and replayed from the JSON alone.
  Regenerate with `ORISTUDIO_FOLD_BLESS=1` and review the diff.
- `tests/partial_precrease.rs`: partial precreases — the pinch at an edge's
  middle; a sheet folded in half, pinched through both layers along the
  other diagonal and unfolded to a valley and a mountain mark at its quarter
  points; subsumption by a later crease along a mark, whole or in part; the
  summary, the picture, the scene and the landmarks; and a property campaign
  over the random sequences (about 140 partial precreases and 140 later
  folds): no face split and nothing but the marks changed, every mark on the
  line within its extent, the whole precrease's creases cut to the extent
  letter for letter (and end to end for an extent over all the paper), marks
  carried by later folds less only what their creases cover, every state
  through the full gate. With `kernel`, the marks as Edit's aux lines and in
  the FOLD export's crease-pattern frame.
- `tests/random.rs`: seeded random sequences along lines through landmarks,
  drawn by the `random` module below. Every landed state passes the full gate
  from scratch and a freshly built checker; every applied fold keeps each
  vertex's band between the line asked for and the line folded along, moves
  vertices rigidly and leaves creases off the line alone. About 760 folds per
  run (2 s in debug). A larger campaign is ignored by default:

  ```sh
  cargo test -p oristudio-fold --release --test random -- --ignored --nocapture
  ```

  On 2026-10-08 it applied 9,224 folds over four seeds (up to 178 faces) with
  no hard failure; the refusals were 1,902 "nothing stays", 1,029 "no moving
  side", 339 slivers, 288 near misses and 23 short creases. Its ignored
  `campaign_digest` prints a hash of every step's outcome over the same
  campaign, landed states to the bit: a change meant to leave the engine's
  results alone must print the digest the build before it does.
- `random` (feature `random-sequences`): the seeded sequences and their
  SplitMix64 generator as a library module, so the oracles replay exactly the
  draws the property tests make: `crates/oracle-tests`' `fold_oracle` checks
  the campaign's sequences against Oriedita and Flat-Folder. The crate is its
  own dev-dependency with the feature, so every test and example here draws
  from it and `cargo test -p oristudio-fold` runs its tests too. It also
  draws the compound ops as the spike's campaigns do: `reverse_fold`,
  `crimp_fold` (both lines across one spine, square to it or each at
  20°–160°) and `tuck_fold` (a landed plain fold, and as T a layer on the
  side that stays which its block lies on).
- `tests/queries.rs`: the output and queries. The cross-section's display
  layers (a layer crossed by a precrease is one row; two precreased layers are
  two rows, one flap or two by where the spine is), unordered rows, the depth
  picker, the action geometry (a hidden line behind, the back view), the
  summaries, the scene's kernel schema and a golden scene for the kite base
  (`tests/fixtures/scenes/kite-base.json`, both views; bless as above), then
  seeded random sequences checking every query against the state: each
  interval's stack against the stack just inside the moving side, rows within
  one isometry and one flap, never woven, spans on ℓ, the diff against the
  fold's report, nested depth choices, each cell's stack.
- `tests/kernel_scene.rs`: a Fold scene read as the kernel's
  `FoldedPaperScene`, and the kernel's own folded figure of the same crease
  pattern (the kite base, a Z-fold) agreeing with it from the front and the
  back: the same faces up and the same stacks as seen.
- `tests/import.rs`: Import CP on hand-built patterns. The preliminary and
  waterbomb bases with the sink spike's assignments import to 1 order with
  their letters and 18 without (the spike's Flat-Folder counts), the one
  stacked as the spike derived; a book fold to 1 and 2; the shape and chord
  refusals; a stored order replayed under renumbering and against a
  pattern whose letters contradict it; every pick of the open base replayed;
  the budget; Edit's folded figure through Oriedita's relations from either
  orientation; and a round trip of 129 seeded random folded states (2 to 52
  faces) through their crease patterns, each state's own order among the
  choices its letters leave.
- `tests/beloch_replay.rs`: every Beloch fixture's final frame
  (`tests/beloch/`) through Import CP with its own `faceOrders` stored by
  witnesses. 55 of 56 replay, each with one face per frame face, all placed
  by one rigid motion of the frame's matrices, and the frame's folded
  creases; join-edge's L-shaped sheet is refused by name.
- `tests/axioms.rs`: every axiom on flat sheets (a square, a rectangle, a
  precreased square) against `oristudio-geometry`'s construction on the
  rectangle, hundreds of roots each; every axiom on the book fold and on four
  stacked layers, both stacked copies of a mover landing on its target; axioms
  over the landmarks of random folded forms, each candidate stating its axiom
  before the fold and each landed fold after it; O6 roots with the points on
  opposite sides folded from either side, on the flat square (every such root
  of 4,000 random inputs) and on the book fold, with the mover check; replay
  after an inserted precrease (renumbering the faces a point anchor names,
  and splitting a segment anchor) and after a fold that takes one root's
  landing away; the existing-crease mode unfolding and refolding; a mover
  left behind; and the sliver remedy for an O4, a free line and an O2 (none).
- `tests/sink.rs`: the sink spike's named cases (`r2-spike-sinks`, shared
  through `tests/sinks` with `crates/oracle-tests`' `fold_sink_oracle`) on the
  preliminary and waterbomb samples: the open sink one state at every depth,
  its letters the outline's and its order the inverted nest; each closed
  sink pocket one state, 6 M and 2 V on the ring, only the seams turning;
  unsinks back to the base, letters and order; deep sinks; tilt killing the
  open sink but not the closed; the open point, the fan point's seven
  pockets, a precreased ring overwritten, a second sink; and stored pockets
  and orders that replay or break.
- `tests/reverse.rs`: the reverse spike's named cases (`r2-spike-reverse-
  crimp-tuck`): the triangle's corner reversing inside only, outside only or
  both (1a–1d), the refused kind offering the other; the preliminary base by
  two inside reverses, matched against Beloch's frames (1e); a four-layer
  strip opening two ways, both kinds on each (2a); two stacked flaps each
  reversed into its own pocket, stacked as the spike found (2b); one of them
  alone (2c). Then the refusals with their fixes, stored choices that
  resolve, break or change, stored openings that break, the spike's seeded
  campaign, and `complete_around` against `complete`. Every landed state
  passes `tests/compound`: the full gate, the letter rules (spine creases
  across an opening turn, every other tip crease keeps, a new crease at the
  spine takes the body's letter inside and the other outside), the geometry
  and crease pattern of a plain fold of the whole tip, and a motion whose
  endpoints are the parent and the landed state. The campaign at the spike's
  size is ignored by default:

  ```sh
  cargo test -p oristudio-fold --release --test reverse -- --ignored --nocapture
  ```

  On 2026-10-09: 4,454 ops, 6,206 openings folded inside; 2,831 landed with
  one order and 57 left a choice of 2–6 (98.0% unique where any order
  fits, against the spike's 99.4% on Flat-Folder's own constraints; every
  order of every choice passes the gate), 3,261 had no order and 57 were
  slivers or short creases. The letter rules held on 32,788 creases; 2,696
  landed states were compared against the plain fold of their tip.
- `tests/reverse_outside.rs`: the outside reverse on its own. Beloch's kite
  point reversed outside and inside, each matched against his frames; one of
  two stacked flaps reversed outside, leaving the other unwrapped (the
  spike's case 2c, where Beloch's literal rule, T1 at the bottom and T2 on
  top, wraps the layers that are not the flap's); and the seeded campaign
  folded outside. The spike's size, ignored by default, on
  2026-10-09: 3,019 of the 3,071 ops with an order landed with one (98.3%,
  against the spike's 99.3%).
- `tests/crimp.rs`: the spike's case 3 on the triangle, ℓ2 at 36.87° (only
  inside lands), 53.13° (only outside) and parallel (both), the kind that
  does not fit offering the other; the parallel crimps stacked as the spike
  found them, body, strip and tip; a crimp that lands where its first
  reverse alone does not; a four-layer flap that opens two ways, the same
  opening at both lines and stored; each refusal naming its faces; a crimp
  the completion leaves open storing its pick, every pick replaying and a
  witness off the paper breaking the step; and the seeded campaign, every
  landed crimp through `tests/compound`'s checks. At the spike's size
  (ignored by default), on 2026-10-09: 1,472 of 1,496 feasible inside
  crimps unique (98.4%; the spike 99.0%) and 1,415 of 1,443 outside ones
  (98.1%; 98.9%).
- `tests/tuck.rs`: the bottom corner tucked under the top layer and the top
  corner over the bottom one; a band tucked into a pocket and one too deep
  for it refused naming T; a loose layer between the flap and T carried
  along (ADR 0052, the spike's case 4d, which its hinges-only closure left
  inside the taco); a target that would move refused; a tuck with two
  orders storing its pick; and the seeded campaign, valley tucks under and
  mountain tucks over, every landed tuck through the full gate, its listing
  of targets agreeing with folding each. At the spike's size (ignored by
  default), on 2026-10-09: the tuck was feasible against 624 of 1,819
  layers (34.3%; the spike 40%), and unique in 615 of those (98.6%; 99.1%).
- `tests/compound_digest.rs`, ignored by default: a hash of every report
  of the reverse, crimp and tuck campaigns, landed states to the bit, as
  `campaign_digest` is for plain folds: a change meant to leave answers
  alone must print what the build before it does. The completion's rework
  below left the reverse campaign's unchanged; the crimp's and the tuck's
  were taken after it.
- `tests/squash.rs`, `tests/petal.rs`, `tests/rabbit_ear.rs`: the vertex
  spike's named cases (`r2-spike-squash-petal-rabbit`, built in
  `tests/vertex/cases.rs`, which `crates/oracle-tests` shares). Two squashes
  along the diagonal route are Beloch's `side-preliminary-1.fold` (folded in
  mirror image; the spike's route matches it under x ↦ 1 − x), the midline
  route the waterbomb base, an asymmetric squash creases each layer on its
  own line; two petal folds on that base are `bird-base-petal.fold`'s
  creases, with eight hinge changes each; each rabbit ear's emergent ray
  lands one ear (the spike's two orders with the direction alone, one with
  the fourth crease as the ridge) whose bisectors share the direction's
  letter in every layer and whose fourth crease has the other, a ray beside
  the paper that stays and each blocked ray refused with the rays that land,
  and every swivel ray that lands is unique with the same letters. Every landed state passes `tests/vertex`: the full
  gate, and a staged motion whose every leg places every moving face,
  starting at the parent and ending at the landed state, never jumping. The
  squash campaign draws a squash on each of 400 seeded states; at the
  spike's size it is ignored by default:

  ```sh
  cargo test -p oristudio-fold --release --test squash -- --ignored --nocapture
  ```

  On 2026-10-09: 3,000 draws; 529 landed, every one with one order (the
  spike: 416 of 416 free, uncovered flaps); 1,676 had no two-layer flap
  there, 673 were held off the hinge, 120 covered and 2 near misses.
- `tests/crane.rs`: the traditional crane by Ida's route (`tests/ida`, as
  Beloch writes it in `crane.bel`): the triangle, two inside reverses to the
  preliminary base, four to the side corners and two petal folds to the bird
  base, four plain folds narrowing the legs, and the neck, tail and head
  reversed. Every step of the bird base matches `bird-base-petal.fold`'s
  frame and the crane `crane.fold` (60 faces): the same faces, isometries
  and order. The neck, tail and head also land the same crane on the bird
  base imported from Beloch's crease pattern through Import CP.
- `tests/beloch`: Beloch's fixtures read for comparison (a frame's faces and
  matrices, its own crease pattern, its `faceOrders` by witnesses), a final
  frame replayed through Import CP, and a frame matched against a state;
  shared by `tests/beloch_replay.rs`, the examples and `crates/oracle-tests`'
  `fold_compound_oracle`, which verifies the reverse campaign's states and
  the crane with seeded Oriedita and Flat-Folder. `fold_crimp_tuck_oracle`
  does the same for outside reverses, crimps and tucks: on 2026-10-09 seeded
  Oriedita verified all 218, 292 and 146 states (none unrepresentable) and
  refused 208, 290 and 128 flipped pairs, and Flat-Folder's `verify` passed
  all 120 states it was given and refused 119 flips.

`cargo test -p oristudio-fold --features kernel` adds:

- `tests/kernel.rs`: every state of the classics, a dyadic path and seeded
  random paths (square, rectangles, polygons) converts with one segment per
  crease and comes back equal, coordinates to the bit, through the kernel's
  FOLD writer and reader, and through FOLD text too (the workspace enables
  `serde_json`'s `float_roundtrip`). The folding colours of all 228 folded
  states fold to `Solved` in Oriedita.
- `tests/fold_export.rs`: the root against the kernel writer and Edit's
  opener; every step frame against its state (vertices, edges, letters,
  rings); `faceOrders` against FOLD's rule read off the frame's own winding;
  the matrices against the frame's coordinates; a turn-over and a rotation;
  the whole-file cap refusing one element short; Edit saving the file with
  the step frames kept.
- `tests/steer_source.rs`, `tests/steer_session.rs`, `tests/steer_host.rs`
  and `tests/steer_record.rs`: the Layer order dialog's engine (`steer`,
  below). `steer_host.rs` holds the open on Edit's own order spot for spot,
  Add adopting its preview even out of time, the rows a restore carries,
  previewing a list nothing committed, a second restore on an open session,
  a point now in another face of the same area, and a thin face saved by a
  point it is found at.
  The source's edge rule, frame and refusals; the constraint session against
  Fold's own import of the same square sheets (the same forced and open pairs
  and the same orders), Oriedita's own first order accepted whole, a preview
  never changing the session, Add landing on the previewed order, removal
  keeping the order on screen, the stacks against the paper scene, Apply
  drawing the session's scene, save and restore, restore after a split, a
  merge, a moved crease and a clash on kabuto, and a node budget or deadline
  that runs out reported as a timeout; the record codec against the golden
  it shares with the web's (`tests/fixtures/layer-order/record-v1.json`).
- `tests/steer_solutions.rs` and the unit tests in `src/steer/solutions.rs`:
  the solution count and the stepper against brute force (every order,
  grouped by picture) over 300 random problems of several components and
  the three fixtures, with and without constraints, whole and in slices;
  the stepper's order across Add and remove; `explain`'s sets minimal
  against every layer order of the fixture.

## The Layer order dialog's engine (`steer`, feature `kernel`)

Ori Studio original work (`implementation-plans/layer-order-dialog.md`, E4
to E6):

- `LayerSource::from_oriedita`: the solver's folded view of exactly the faces
  Edit folded (face *k* is Oriedita face *k*), by Oriedita's edge rule, with
  typed refusals.
- `ConstraintSession`: the committed constraints, the order on screen and
  what deduction forces. `open`, and `open_showing` on the order the host
  shows (its paper scene's relations, `scene_relations`), `open_pairs`,
  `preview` and `preview_list` (never commit), `commit` (the whole list) and
  `commit_preview` (Add adopting its preview, no search), `stacks` and
  `scene` per side, `oriedita_relations` for a host's `fold_with_order`,
  `save`, and `restore` / `restore_record` onto creases that may have changed
  (decision D10: intact constraints applied together or not at all, the
  saved order kept where it still fits, every constraint not applied carried
  to the next save). Every limit that runs out is a `TimedOut`, never a
  "can't fit".
- `ConstraintSession::explain` (E6): the smallest set of constraints that
  clash, every member necessary (a deletion filter over the set a check
  names), with the faces they name.
- `Solutions` (E6): the distinct pictures from each side and the layer
  orders, counted in resumable slices by the product rule over independent
  components ("at least N" past a cap), and `ConstraintSession::step`
  through them in a fixed order, or through every layer order with X-ray.
- `read_record` / `encode_record`: the saved record, byte for byte the web
  codec's.

`crates/oracle-tests/tests/layer_order_witness.rs` (census 1),
`layer_order_session.rs` and `layer_order_solutions.rs` run the same calls
over the fixtures in CI and over a corpus locally.

## Performance

`cargo run -p oristudio-fold --release --example perf`: all-layer folds along
random lines through the middle of the folded model, from the flat square to
more than 256 faces, 40 runs, bucketed by the landed state's faces like the
core spike's `perf.mjs`. Apple Silicon, native release build, 2026-10-08, one
run on a shared machine (load average 9–15; a run at load 50 was twice as
slow, so read p95 as pessimistic).

| Faces | Folds | Pairs (mean) | Closure | Fold mean / p95 | Full gate | Checker alone |
|---|---|---|---|---|---|---|
| 1–8 | 121 | 11 | 0.003 ms | 0.045 / 0.082 ms | 0.025 ms | 0.017 ms |
| 9–32 | 86 | 170 | 0.008 ms | 0.29 / 0.56 ms | 0.23 ms | 0.19 ms |
| 33–64 | 68 | 845 | 0.021 ms | 1.05 / 1.74 ms | 0.89 ms | 0.83 ms |
| 65–128 | 79 | 2,978 | 0.049 ms | 3.0 / 5.4 ms | 2.6 ms | 2.5 ms |
| 129–256 | 76 | 9,634 | 0.14 ms | 8.4 / 13.2 ms | 7.1 ms | 7.1 ms |

Against the engine before its closure index and landing were reworked (the
Wave 2 integration, `00954c01f`), three runs of each build alternated at
load 8–17: at 129–256 faces the fold was 11.8–12.1 / 21.9–22.6 ms (mean /
p95) and is 8.1–8.4 / 12.7–13.1 ms; the closure 1.6 ms and 0.14 ms; the full
gate 7.5–8.0 ms and 6.9–7.1 ms. At 65–128 faces, 3.8–4.0 / 6.9–7.1 ms and
2.9–3.2 / 5.2–6.7 ms. Every result is the same: the random campaign's
digest (`campaign_digest` in `tests/random.rs`, every landed state to the
bit over 14,774 steps) is identical on both builds. The layer order before
its own rework (commit `c0a3d44`) took 48.0 / 86.4 ms at 129–256.

*Closure* is `State::analyse_fold` (snap, classify, pieces, flaps, U); *fold*
the whole operation, its incremental gate included; *full gate* `State::make`
from scratch on the landed parts; *checker alone* `oristudio-layer-order`'s
check with a newly built problem. The example also times a top-layer fold on
each landed state; on these random stacks rule (i) usually still joins most
layers, so it is no cheaper.

- **The fold's own work is small**: fold minus gate is about 0.2 ms at 33–64
  faces and 1.3 ms at 129–256, under the JS spike's p95 for the op alone
  (2.2 ms and 17.2 ms, research §12). Most of what it was went to two
  places: the box index returned each of a stack's large boxes once per grid
  cell and sorted the repeats away, which was most of the closure; and
  landing tested every touched pair's children for overlap with a fresh
  penetration (a `hypot` per edge per test) and inserted the new order pair
  by pair. The index now takes a box in one cell and sizes its cells to the
  boxes; landing keeps each face's edge planes, stops an overlap test at the
  first plane that settles it, and builds the order in one sort.
- **The gate is most of it**, and almost all of the gate is the layer-order
  problem: above 128 faces the constraint build is 6.5 ms, 4.0 ms of it the
  overlay into cells, and the check on the built problem 0.7 ms (run the
  example with `FOLD_PERF_SPLIT=1` for the breakdown; before the layer
  order's rework they were 45 ms, 24 of it the overlay, and 11 ms).
- **Incrementality pays where an operation is local**: random all-layer
  folds touch most faces, and nearly every other face overlaps one of them,
  so their rebuild costs about what a build does. On these states a rebuild
  naming one face cost 3.9 ms against 6.3 ms for a build.
- These stacks are much deeper than real models (9,600 pairs at 129–256
  faces; Beloch's crane is 60 faces and 770 pairs), and the plan's tier-3
  budget is ≤ 50 ms at 256 faces in wasm.

`cargo run -p oristudio-fold --release --example sequences`: the same steps
on real sequences. Every state of the classic sequences with the sequence's
own next fold or precrease, and the final frame of each Beloch fixture
(`tests/fixtures/beloch/`) that replays: the frame's own crease pattern
through Import CP with its own `faceOrders` as the stored order
(`tests/beloch/`), a valley fold along each of the state's crease lines from
either side standing in for the next step. Each time is the median of 15
runs; 2026-10-08, load average 9–14 for the classics and the crane, 19 for
the other Beloch rows.

| Sequence | States | Faces | Pairs | Scene | Landmarks | Cross-section mean / max | Depth choices mean / max | Fold mean / max (landed of tried) |
|---|---|---|---|---|---|---|---|---|
| kite-base | 5 | 4 | 2 | 0.001 ms | 0.008 ms | 0.002 / 0.002 ms | 0.003 / 0.006 ms | 0.012 / 0.015 ms (4 of 4) |
| precrease-four-layers | 5 | 8 | 28 | 0.002 ms | 0.023 ms | 0.002 / 0.003 ms | 0.007 / 0.012 ms | 0.023 / 0.048 ms (4 of 4) |
| top-layer-corner | 5 | 7 | 17 | 0.004 ms | 0.025 ms | 0.002 / 0.003 ms | 0.009 / 0.019 ms | 0.017 / 0.029 ms (4 of 4) |
| tuck-under-top | 3 | 3 | 3 | 0.001 ms | 0.008 ms | 0.002 / 0.002 ms | 0.003 / 0.005 ms | 0.010 / 0.012 ms (2 of 2) |
| Beloch, 2–8 faces | 48 | 8 | 28 | 0.003 ms | 0.029 ms | 0.002 / 0.010 ms | 0.009 / 0.051 ms | 0.011 / 0.130 ms (108 of 240) |
| Beloch, 9–16 faces | 5 | 16 | 120 | 0.007 ms | 0.104 ms | 0.005 / 0.028 ms | 0.043 / 0.231 ms | 0.039 / 0.233 ms (32 of 58) |
| Beloch cube-root | 1 | 28 | 45 | 0.014 ms | 0.083 ms | 0.006 / 0.011 ms | 0.019 / 0.045 ms | 0.204 / 0.284 ms (30 of 34) |
| Beloch crane | 1 | 60 | 770 | 0.28 ms | 1.1 ms | 0.040 / 0.089 ms | 1.75 / 3.37 ms | 1.10 / 1.91 ms (34 of 38) |

Faces and pairs are the most in a row; scene and landmarks the slowest
state's. 55 of the 56 Beloch fixtures replay (`tests/beloch_replay.rs`
checks each against its frame: one face per frame face, all placed by one
rigid motion of the frame's matrices). The one that does not is join-edge,
an L-shaped sheet, which Import CP refuses as `import_shape_unsupported`:
V0 imports a square or a rectangle.

The crease pattern read is the final frame's, not the file's root. Reading
the root, 9 fixtures failed, none of them for the engine: Beloch 0.3.0-dev
writes a precreased crease into the root with its letter, `V`, where the
final frame has it flat, `F`, so cube-root, mark-overlay-regression,
marks-demo, def-diagonals and x-midpoint imported a pattern folded
differently from the frame (four valleys at a vertex, or the frame's order
against faces the frame never folded); and side-preliminary-1 to 3 carry a
construction line in the root that no frame has, which splits a frame face
so its centroid fell on the line.

Against D14's tiers, natively and nothing near a budget: per line, side and
direction (tier 2, which while a free line is dragged comes once per
pointer move, so held to tier 1's 4 ms) the crane's cross-section takes at
most 0.09 ms and its depth choices 3.4 ms, the closest to a budget, since
they analyse the fold once per layer at the point; per state (tier 2) its
scene takes 0.28 ms and its landmarks 1.1 ms; and a landed fold (tier 3,
≤ 50 ms at 256 faces in wasm) at most 1.9 ms, with the random 129–256-face
stacks at 13 ms p95.

`cargo run -p oristudio-fold --release --example reverse`: the reverse fold,
whole (tip, openings, score, gate, carry, seeds, completion, letters,
`State::make`), with its first opening per flap. 2026-10-09, native release
build, load average 8–23, after the completion's rework below (the times
before it in brackets). On the crane by Ida's route (`tests/ida`, the median
of 15 runs):

| Step | Faces | Time |
|---|---|---|
| b onto c, d onto c (preliminary base) | 2 → 4, 4 → 6 | 0.038, 0.052 ms (0.71, 0.73) |
| the four side corners | 6 → 14 | 0.085–0.14 ms (0.76–0.86) |
| neck | 36 → 44 | 1.9 ms (3.8) |
| tail | 44 → 52 | 2.3 ms (4.1) |
| head | 52 → 60 | 1.5 ms (2.5) |

On the engine's random sequences (`random::Sequence` to 256 faces, reverse
folds drawn as the spike's campaign draws them):

| Faces | Ops | Tip faces | Landed mean / p95 (n) | Refused mean / p95 (n) |
|---|---|---|---|---|
| 1–8 | 721 | 3.5 | 0.13 / 0.34 ms (382) [0.83 / 1.2] | 0.23 / 0.72 ms (335) [1.9 / 4.0] |
| 9–32 | 626 | 11.7 | 1.4 / 5.4 ms (219) [3.1 / 12.0] | 2.5 / 8.3 ms (396) [6.3 / 19.1] |
| 33–64 | 335 | 24.0 | 5.3 / 18.4 ms (70) [10.9 / 40.1] | 8.4 / 29.6 ms (260) [16.6 / 58.4] |
| 65–128 | 305 | 41.5 | 17.6 / 41.5 ms (21) [34.6 / 98.1] | 23.1 / 89.0 ms (283) [47.0 / 160] |
| 129–256 | 105 | 65.0 | 30.9 / 39.9 ms (2) [44.6 / 66.1] | 79.5 / 481 ms (103) [199 / 1,246] |

The reverse spike's JS (research §5.2) took 2.9 ms for the op, 11 ms for
Flat-Folder's arrangement and 10 ms for completion at 33–64 faces, and 15.6,
78 and 518 ms at 129–256. Most of the time is the completion's propagation
of the seeds through deep stacks; a refusal costs a few completions, since
it tries the other kind and a grown tip for its fixes. The example also
times `perf`'s all-layer stacks, where tips are half the model.

The completion's rework, and what it changed:

- **Flat-Folder's implication tables are built once.** `treemaker-flatfold`
  built them on every `complete_layer_order` call, about 0.65 ms each: most
  of a small fold's time. They are now one table per constraint kind,
  indexed by the base-3 code of the assignments rather than hashed, built
  once per process (`ImplicationMaps::shared`).
- **The propagation's inner loop** built a string key per inference and a
  vector key per pair lookup, and found each transitivity candidate by
  scanning those already met. A pair variable is now found by its faces
  (`PairIndex`), and a candidate is marked per face, in the order upstream
  meets them.
- **A refusal's diagnosis reuses the fold it diagnoses**: the other kind is
  the same scored and gated fold with its placements turned, so it costs one
  completion, and a grown tip's plan is tried once, however many ways of
  keeping the openings reach it.
- **The deadline meters the propagation**, which on a deep stack is most of
  a completion, so an interactive caller's deadline holds; without one
  nothing is metered and nothing changes.

None of it changes an answer: `tests/compound_digest.rs`' reverse campaign
prints the same digest before and after, `fold_compound_oracle` still
verifies every state, and `treemaker-flatfold`'s parity and verify tests
pass unchanged.

A second rework (2026-10-19) replaced `PairIndex` and the per-face
`BTreeMap`s with flat face × face tables and skips work that cannot change
an answer, and added `CompletionSession` for the Layer order dialog: open
once, then check many choices. The 850-face iguana's completion went from
11.0 s to 1.04 s natively (back to back, load 5); the evidence that no
answer changed (a differential
harness over the fixtures and 484 real crease patterns, the campaign digests
above, the Flat-Folder oracle) is in
`implementation-plans/fold-solver-performance.md`.

`cargo run -p oristudio-fold --release --example crimp_tuck`: on the same
random sequences, each state takes a crimp drawn as the spike's crimp
campaign draws them (inside, each flap at its first opening) and a tuck
drawn as its tuck campaign does; the crimp's analysis, each op whole when it
lands and when it is refused (its fixes tried), and the tuck's target
listing without a deadline. 2026-10-09, load average 8–20, after the
completion's rework:

| Faces | Crimp analyse | Crimp landed mean / p95 (n) | Crimp refused mean / p95 (n) | Tuck landed mean / p95 (n) | Tuck refused mean / p95 (n) | Tuck targets mean / p95 (layers) |
|---|---|---|---|---|---|---|
| 1–8 | 0.020 ms | 0.31 / 0.94 ms (99) | 0.31 / 0.98 ms (64) | 0.10 / 0.30 ms (99) | 0.16 / 0.45 ms (120) | 0.15 / 0.52 ms (1.7) |
| 9–32 | 0.049 ms | 2.1 / 5.5 ms (41) | 2.6 / 10.6 ms (47) | 0.89 / 2.3 ms (78) | 3.0 / 9.7 ms (289) | 4.6 / 19.7 ms (5.1) |
| 33–64 | 0.14 ms | 59.3 / 227 ms (4) | 13.5 / 41.7 ms (30) | 5.3 / 16.9 ms (35) | 19.6 / 62.0 ms (204) | 55 / 226 ms (10.5) |
| 65–128 | 0.48 ms | 123 ms (1) | 4.0 / 9.4 ms (10) | 17.1 / 156 ms (16) | 70.0 / 201 ms (245) | 401 / 1,564 ms (20.8) |
| 129–256 | 0.82 ms | 31.3 / 34.1 ms (2) | 45.4 / 195 ms (5) | 30.8 / 62.5 ms (4) | 198 / 712 ms (101) | 1,728 / 5,425 ms (29.3) |

The example also times `perf`'s deep stacks, where few crimps land and tucks
are refused more (at 129–256 faces 250 / 857 ms refused, the listing
1,679 / 5,158 ms). A refused tuck costs most, since it tries up to eight
other targets for its fixes; past 64 faces few draws land at all, so read
the landed columns' small counts as indications. The target listing is a
completion per layer the block lands on, about 60 ms each at 129–256 faces,
so the bridge gives it 150 ms (`TUCK_TARGETS_BUDGET_MS`) and leaves the
targets past it undecided (`feasible: None`) for the fold itself to decide.
The deadline stops the propagation as well as the search, but the search
reads the clock only every few dozen nodes, after its problem is built, and
the listing ran a preparation per moving set and a completion per target
regardless: on the square folded in half seven times (128 layers in its
corner), its bottom corner tucked, the 150 ms listing took 1.6–1.8 s, as
long with the deadline already past. The listing now reads the deadline
before each preparation and each completion, the targets that move least
first, and a completion asked for after its deadline does not run: 152 ms
(valley, four targets found) and 158 ms (mountain) natively, 163 and 160 ms
through the bridge in wasm.

`cargo run -p oristudio-fold --release --example landmarks`: every landmark of
a state and the candidates of an O2 and an O6 over them, on states made the
same way. 2026-10-08, one run at load average 138, so pessimistic:

| Faces | States | Points | Segments | Landmarks mean / p95 | O2 candidates | O6 candidates |
|---|---|---|---|---|---|---|
| 1–8 | 120 | 17 | 13 | 0.04 / 0.08 ms | 0.003 ms | 0.003 ms |
| 9–32 | 85 | 76 | 50 | 0.36 / 0.77 ms | 0.005 ms | 0.008 ms |
| 33–64 | 62 | 190 | 110 | 1.64 / 2.78 ms | 0.012 ms | 0.017 ms |
| 65–128 | 78 | 395 | 211 | 5.84 / 11.1 ms | 0.023 ms | 0.029 ms |
| 129–256 | 54 | 697 | 363 | 18.1 / 32.1 ms | 0.036 ms | 0.050 ms |

Landmarks are once per state, cached with it (plan D14 tier 2); a candidate
list is once per set of picked inputs.

Original work under `MIT OR Apache-2.0`.
