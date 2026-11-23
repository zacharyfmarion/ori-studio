# Fold: squash two pockets on one lower layer

## Goal

Squash two pockets that share their lower layer, together: two doors over
one panel, each joined to the panel along an upper edge (its spine) and
folded with it round a lower edge (its hinge). The step "open the pockets and
bring the top corner down" on a blintzed preliminary base is the case: the
panel's top half folds down on the diagonal through its side corners, each
door unfolds off the panel across its spine and turns down with it, and its
part wrapped round the panel's lower edge swings out across that hinge.
Today the squash refuses `squash_flap_not_free`: squashing one door alone
would have to crease the other door where no squash creases it. Real tutorial
steps, rebuilt outside the repo, land this only through Import CP.

## Approach

- **Today's reading first.** The flap is read as before, at the spine's first
  end with a hinge, and checked free and uncovered. Every squash that lands
  today lands the same way: the new reading runs only where that one is
  refused.
- **Split the reading from its checks.** `squash_flap` becomes
  `squash_base` (stack, walls, spine, opening), `squash_vertices` (each end of
  the spine with a hinge, in today's order), `squash_reading` (creases and
  which wall each face is in) and `squash_checked` (free, hinged, uncovered,
  riders), which takes several readings as one flap.
- **Pockets on one lower layer.** Where today's reading is refused, read the
  flap at each end of its spine; for each, the paper attached off its hinge
  to the moving flap is read as a pocket of its own (a squash named at a
  point on it). A pocket joins when it is a two-layer flap whose lower layer
  is the same faces, whose symmetric squash creases that lower layer on the
  same line, laying the same side of it over, and whose upper layer is new.
  Repeat until nothing holds the union; it must then pass every check as one
  flap. Exactly one reading must hold, or the refusal stands.
- **Narrow.** Only for an inferred hinge, a symmetric squash (no target) and
  two-layer flaps: an asymmetric target would crease the lower layer off the
  pockets' shared line, and a drawn hinge or an opening names one flap.
- **Compile.** One block for the lower layer's moving side, two per pocket
  (its upper layer's spine side across its spine then the shared crease, its
  hinge side across its hinge), riders with their pocket's hinge side. The
  pockets are ordered by their upper layers' first faces, so either door
  names the same fold. The compound pipeline checks the motion and the
  layer order as for every squash.
- **Bridge and tool.** No new op field: the op is a plain squash at a point
  on either door. The analysis' `upper` lists both doors and its `pockets`
  counts them; the report's `vertices` names both side corners. The tool
  previews and folds it as any squash, but offers no spine target (none
  lands: the pockets share the symmetric crease), and the step's sentence
  says the pockets were squashed together (from the report's vertices).

## Affected Areas

- `crates/oristudio-fold/src/compound/squash.rs`
- `crates/oristudio-fold/tests/squash_pockets.rs` (synthetic blintzed
  preliminary base), `tests/vertex/cases.rs` (`two_pockets`)
- `crates/oracle-tests/tests/fold_vertex_oracle.rs` (the new landings
  verified by Oriedita and Flat-Folder)

## Not covered

- The closed pocket of a hat folded into a diamond (the hat's front and back
  joined at both slanted edges, through corner flaps folded onto the front or
  as two multi-ply halves; brims folded over both walls). Checked face by
  face against real steps, every face moves by one of this squash's four
  motions about the apex (hinge on one slanted edge, spine on the other), so
  the geometry is there. What is missing is the reading: the click names a
  corner flap's own two layers first, the walls are joined on two lines
  rather than nested on one spine, the brims must ride their walls, and the
  Squash tool's Opens stepper never offers that opening. Planned in
  `fold-squash-closed-pocket.md`; `fold-closed-flap-squash.md` (a different
  arrangement) stays as planned.
- A pocket squash with a spine target: the pockets share one crease, so an
  asymmetric target keeps today's refusal.

## Checklist

- [x] Re-run the slice's nodes on main: still refused (`squash_flap_not_free`,
      `squash_flap_covered`, `squash_no_flap`).
- [x] Split the flap's reading from its checks; existing squash tests pass
      unchanged.
- [x] Pockets on one lower layer: partner readings, union checks, compile.
- [x] Synthetic tests: both doors and both halves name one fold, mirror,
      from behind, the analysis, a target keeps today's refusal.
- [x] Vertex oracle (Oriedita, Flat-Folder) verifies the new landings.
- [x] Real steps (outside the repo): the native squash lands the same paper
      as the saved Import-CP node, both sides of the box.
- [x] fmt, clippy, fold and bridge tests, the fold web tests on the new wasm;
      every saved step of 112 real models (outside the repo) replays
      identically.
- [x] Tool polish: no spine target offered for pockets (no "Spine lands
      on" row, no aiming instruction, a click on the paper aims nothing);
      the step reads "Squash-fold the pockets together." (8 locales).
- [x] Browser check of the tool flow: both real steps made by hand with the
      Squash tool (one click on a door, Enter), each the same state as the
      scripted squash and the same paper as the saved import.
