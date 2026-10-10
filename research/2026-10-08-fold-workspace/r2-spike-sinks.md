# Sink spike report: open sink, closed sink and unsink

All code is in `/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/fold-workspace-research-c52ced/artifacts/fold-spike/compound/sinks/`, which is gitignored. Paths below are relative to that folder. Core modules (`../../core`) are imported read-only, and `git status` is clean. It is about 1,400 lines of Node ESM, runs on Node 26.8.1, and has no dependencies. `README.md` lists the run commands.

## Summary

- **Sink geometry is forced.** Each tip piece is hinged to its own stationary piece by a folded crease on the sink line, so its isometry must be R_ℓ∘T_old. Which inner creases are folded and which are flat therefore never changes; only the letters and the layer order are open. The spike takes this geometry from the core `simpleFold` of the whole point and throws away its order on every pair that involves a tip face (`sink.mjs:20`).
- **CP diff plus pinned outside orders, with letters unknown, is not enough.** On the preliminary base, Flat-Folder (FF) finds 11 valid completions at every depth from f=0.05 to 0.49. All 11 pass both the FF verifier and the independent checker. They are:
  - 1 open sink;
  - 2 closed sinks, into the front pocket or the back pocket;
  - 2 "twisted" closed sinks;
  - 4 mixes that are open on one half and closed on the other;
  - 2 simple folds of the whole point (forward or behind), which are not sinks.

  The waterbomb base also gives 11, and a second open sink on the already-sunk base gives 11 at 32 faces.
- **CP diff with letters determines the state.** Each of the 11 completions has its own letter assignment, and given those letters FF finds exactly 1 state, with or without the pinned pairs (11/11). The same holds for every rule-built state on a closed, symmetric point. The exceptions are listed under Failure modes.
- **Open and closed sinks differ in the CP, not only in the order.** On the preliminary base (`chk-letters.mjs`):
  - **Open sink:** all 8 ring creases are M; all 6 inner folded creases flip (midline parts M→V, side-flap diagonals V→M); the 2 inner flat creases stay F. This is the textbook rule.
  - **Closed sink, front pocket:** the ring is 6 M and 2 V. Only the 2 inner creases that bound the pocket (C-m1, C-m4) flip; the other 4 keep their letter.
  - **FOLD `faceOrders`:** a simple fold changes none of the tip-tip triples (12/12 unchanged). The open sink flips all 12; the closed sink flips the 6 that cross between its two blocks (`chk-foldorders.mjs`).
- **The orders follow two rules, and both are the same primitive.** That primitive is "reflect blocks with anchored placements" (`sink.mjs:89`):
  - **Open sink:** each layer is its own block, placed directly against its own stationary half on the pocket side. Every other pair inherits its parents' order.
  - **Closed sink:** two blocks, each reversed and placed into one chosen pocket. This is an inside reverse fold of the whole point, with the pocket's two bounding creases as spines.
  - Both rules match an FF completion exactly and verify in every case where they apply.
- **Preconditions are sharp:**
  - **Open sink needs an exactly symmetric line.** Tilting the line by 0.001°, 0.01°, 0.1°, 1°, 5°, 15°, 30° or 44° leaves 8 completions and no open sink. Closed sinks survive tilt.
  - **The point must be closed.** On the open point (free corners) there are 644 completions, and even a given CP admits 29 states.
  - **An open sink needs one exterior side.** On an 8-layer "fan" point there are 9 completions and no open sink.
  - **The sunk tip must fit inside.** At f ≥ 0.5 the count jumps to 220.
- **Unsink is deterministic.** It has exactly 1 completion from each of the open, closed-front and closed-back states. It restores the inner letters (6/6) and the parents' order (24/24 pairs).

## Starting states: CP importer (a product feature)

**Importer.** `importcp.mjs:78` takes `{V, EV, EA}`:

- **Faces:** a half-edge walk finds the planar faces (`importcp.mjs:17`).
- **Isometries:** the core breadth-first walk derives them from a chosen root face and root isometry.
- **Order:** FF enumerates every order the letters allow (`ffcomplete.mjs:30`; letters unknown are passed as `U`, which FF folds, `third_party/flat-folder/src/conversion.js:312`), and a `choose()` predicate picks one.

**Preliminary base** (`bases.mjs:51`). The CP has the 4 midline halves M, the side quadrants' half-diagonals C-k2 and C-k4 V, and the front and back quadrants' half-diagonals C-k1 and C-k3 flat (F, remembered as V). The center vertex has 4 M + 2 V, and the view is rotated 45° so the closed point is at the top.

| | Preliminary base | Waterbomb base |
|---|---|---|
| Orders from the geometry alone | 18 | 18 |
| Orders with letters | 1 | 1 |
| Left half, top to bottom | T1>T2>T3>T4 | T2>T3>T4>T5 |
| Right half, top to bottom | T8>T7>T6>T5 | T1>T8>T7>T6 |
| Core verify (FF + solve) | ok | ok |
| Independent checker | ok | ok |

(`t-import.mjs`, `chk-import-noletters.mjs`.) This order matches a hand derivation from the physical base.

## Operation: open sink

**User inputs:** the point (a click inside it), the sink line (a depth), and "open".

**Preconditions, all measured:**
1. The point is closed: the outline of the tip region, apart from ℓ, consists of folded creases.
2. The outline creases share one letter, i.e. the point has a single exterior side (`rules.mjs:146`).
3. The line is exactly perpendicular to the point's mirror axis.
4. For the result to be an actual sink, the reflected tip lies inside the stationary outline (f < 0.5 on the preliminary base).

**What moves:** every layer of the point beyond ℓ. In the spike that is every face under the click point plus the core closure.

**CP change** (preliminary base, f=0.3):
- 8 faces are split into 16, adding 8 ring creases (a diamond around C in the sheet).
- Ring creases take the exterior letter: all M.
- Inner folded creases flip. Inner F creases stay F.

**Order rule** (`rules.mjs:69` with `placeBlocks`):
- Each tip piece t_i sits directly against its stationary half s_i.
- It goes on the "pocket" side: towards the layer s_i is joined to along the point's outline. For flat-joined faces the side carries across the F crease.
- Every other pair inherits its parents' order: t_i vs s_j and t_i vs t_j behave like T_i vs T_j.
- Left half result: s1>t1>t2>s2>s3>t3>t4>s4. The side flap's sunk spine (t2,t3) wraps around its stationary spine (s2,s3); this is the "inverted nest".

**Unique?** Yes, given the inputs. The rule leaves 0 undecided pairs and equals FF completion #6 of 11. Its CP admits 1 state with or without pins. The letter-only rule (`openSinkLetters`) also gives FF exactly 1 state, the same one, on the preliminary base at f=0.3 and f=0.6, the waterbomb base, and the second sink (`exp6.mjs`).

**Verification:** core `verify` (FF seeded, with solve) is ok, `indepCheck` is ok, and residual ≤ 1.3e-15.

**Renders:** `renders/prelim-open.svg`, `waterbomb-open.svg`, `second-sink-open.svg`.

## Operation: closed sink

**User inputs:** the point, the sink line, "closed", and **the pocket**, meaning the gap in the stack the tip goes into. On the preliminary base the natural pockets are the front one (between Q1 and the rest) and the back one. In the spike the pocket is passed as the set of layers in front of it (`closedSinkSpec`, `rules.mjs:116`).

**Preconditions:**
- The point is closed.
- A gap is a valid pocket only if the crease joining its two sides lies on the point's outline.
  - On the preliminary base, gap g2 (between the two layers of the side flap, which are hinged on the axis) never appears in any of the 11 completions.
  - On the fan point, whose layers are hinged alternately on its two outline edges, all 7 gaps are valid. The rule reproduces completions #1–#7, and each CP admits exactly 1 state (`exp7.mjs`).
- A symmetric line is **not** required. At 15° tilt, front and back closed sinks are still valid.

**What moves:** the same geometry as the open sink.

**CP change** (front pocket):
- Ring letters by triangle: T1 M, T2 M, T3 V, T4 M, T5 M, T6 V, T7 M, T8 M.
- Inner creases: only the pocket's seams flip (C-m1 and C-m4, M→V). C-m2, C-m3, C-k2 and C-k4 keep their letters.

**Order rule:**
- The front block (here just T1/T8) is reversed and placed under the lowest front layer.
- The back block is reversed and placed over the highest back layer.
- Left half: s1>t1>t4>t3>t2>s2>s3>s4.
- The ring hinges (s2,t2) ⊂ (s3,t3) ⊂ (s4,t4) are nested, which locks s2 and s3 inside. That matches the usual "layers locked" description.

**Unique?** Yes, given the pocket.
- Front pocket = completion #1, back pocket = #8; each CP admits 1 state.
- With a tilted line the rule leaves 19 pairs undecided, because those pairs cross between the two halves. FF completes them uniquely (to #1 and #6 respectively).
- The two twisted variants (front pocket on one half, back on the other; #2 and #7) are valid flat states. My reading that #1/#8 are what diagrams call a closed sink is an inference from "the tip layers stay together" and "one pocket that continues across the flat front quadrant". I have not checked it against a physical fold.

**Renders:** `renders/prelim-closedFront.svg`, `prelim-closedBack.svg`, `prelim-tilt15-closedFront.svg`, `waterbomb-closed*.svg`, and all 11 completions as `prelim-completion-*.svg`.

## Operation: unsink

**Inputs:** the sunk state and its ring. No choice is needed.

**CP change:**
- Ring creases become F and remember their letter.
- Inner creases have unknown letters, and the tip's isometries return to T_old.

**Order:** FF completion with the stationary pairs pinned.

**Result:** exactly 1 completion from each of the open, closed-front and closed-back states. It verifies, inner letters return to the originals (6/6), and the parents' order is restored (24/24), with residual 7.9e-17 (`exp5.mjs`, `results/exp5.json`). The result is the base with a precreased ring.

**Precreased-ring path.** Fold-and-unfold the ring first (core `foldAndUnfold`), then sink. This gives the same 11 completions and the same rule results. However, the precrease remembers VMVMMVMV (alternating per layer), while the open sink needs MMMMMMMM. A sink must overwrite the remembered letters of the F creases it refolds.

## Mapping to engine primitives

1. **Geometry.** A sink is the simple-fold split and reflect applied to every layer of the point. No new geometry code is needed.
2. **Order: "reflect blocks with anchored placements"** (`placeBlocks`, `sink.mjs:89`). One primitive covers all four operations:

   | Operation | Blocks | Placement |
   |---|---|---|
   | Simple fold | 1 | top / bottom |
   | Reverse fold, closed sink | 2 | into one pocket |
   | Open sink | n singletons | each against its own sibling |
   | Mixed variants | per stack | per stack |

   Anchors must be **per face**, not per block. A Beloch-style single anchor per block ("under s1") left 16 pairs undecided on the two-stack preliminary base. FF still completed them uniquely to the right state (`exp7.mjs`).
3. **"CP diff + seeded completion" as fallback and validator.** Feed the operation's letters plus the pinned stationary pairs to a completion solver; it was unique in every closed-point case. FF enumeration cost 2.5–42 ms at 16–32 faces.
4. **Fan primitive.** Not needed for sinks, since a sink reflects across a single line. It remains needed for squash and petal folds.

## Verification table

Completions are counted with the ring and inner letters unknown and the outside pinned (`summary.mjs` → `results/summary.json`). "States|CP" is the number of states FF finds given that rule's letters, without pins.

| Case | Faces / FF vars | Completions (all verified, FF + indep) | Open rule | Closed front | Closed back |
|---|---|---|---|---|---|
| Prelim f=0.05 / 0.3 / 0.49 | 16 / 56 | 11 | valid, #6, states\|CP 1 | valid, #1, 1 | valid, #8, 1 |
| Prelim f=0.6 (tip pokes out) | 16 / 56 | 220 | valid, #74, 1 | valid, #63, **4** (1 pinned) | valid, #192, **4** (1 pinned) |
| Prelim tilt 0.001° | 16 / 72 | 8 | none: taco-tortilla conflict | valid via 19 undecided → FF 1 | same |
| Prelim tilt 15° | 16 / 72 | 8 | none | valid, 1 | valid, 1 |
| Prelim, precreased ring | 16 / 56 | 11 | valid, #6, 1 | valid, #1, 1 | valid, #8, 1 |
| Waterbomb f=0.3 (also 0.2, 0.45) | 16 / 56 | 11 | valid, #5, 1 | valid, #1, 1 | valid, #9, 1 |
| Second open sink, f=0.4 | 32 / 240 | 11 | valid, #5, 1 | – | – |
| Fan point (prelim folded in half) | 16 / 120 | 9 | none: outline letters mixed | pocket rule at every gap: 7/7 valid, each 1 | |
| Open point (free corners) | 16 / 56 | 644 | undefined: no outline creases | valid, but **29** | – |
| Unsink (from open / closed front / closed back) | 16 | 1 / 1 / 1 | – | – | – |

**Numerics.** 955 completion states were checked:
- Maximum residual: 1.3e-15.
- 8 states needed FF arrangement retries. All of them are the 0.001° tilt case (12 retries each); 0.01° needs 9 retries per state; 15° needs none (`retries.mjs`).
- Verification took 0.9–5.2 ms per state.

## Ambiguities and user inputs

- **Point.** A click inside it. Seeding must be "the paper-connected point", not "every layer under the click"; the spike does the latter (k=1e9 in `sinkGeometry`).
- **Line.** A depth. For an open sink it must be snapped exactly perpendicular to the point's mirror axis, and the UI should offer that as a landmark.
- **Open or closed.**
- **Pocket, for closed sinks.** The valid pockets are the gaps whose bounding crease lies on the outline: 2 natural ones on the preliminary base, 7 on the fan point.
- **Not offered by default:** the twisted and mixed variants (6 of 11 on the preliminary base). They are valid flat states, but no common operation produces them.
- **No valley/mountain direction is needed.** The two "outside" completions are ordinary simple folds of the whole point.

## Failure modes

1. **Tilted line.** The open sink does not exist at any tilt tested, 0.001° to 44°; the open rule plus FF fails with a taco-tortilla conflict. Below about 0.01° the near-symmetric overlap slivers (about 7e-6 wide) force 9–12 FF eps retries. The core's min-feature μ would not catch this, because the sliver is an overlap, not a face or a near vertex.
2. **Open point** (raw edges on the outline). 644 completions, no pocket side, and a closed-rule CP that admits 29 states, so the CP does not determine the state.
3. **Fan / accordion point** (mixed outline letters). No open sink; only pocket choices exist.
4. **Deep line** (f ≥ 0.5). 220 completions, and closed-sink CPs admit 4 states without the pinned pairs.
5. **Spike bug, fixed.** Ring detection by "new chords" missed a precreased ring: it found 0 ring edges and 1 completion. Now every tip/stationary hinge counts as ring (`sink.mjs:30`).
6. **Precrease letters.** Remembered precrease letters ≠ sink letters, so reusing them yields the simple fold, not the sink.
7. **Core issues hit:**
   - `core/index.mjs` does not export `indepCheck`, although `core/README.md:71` says it does; I imported `core/indep.mjs` directly.
   - A point seed exactly on an edge returns `empty-seed`.

## What production must handle that the spike skipped

- Detecting the point's axis and snapping the sink line to it.
- Enumerating pockets automatically, including following a pocket across flat creases between stacks. The spike names pockets by hand (`facesInTriangles`).
- Points whose layers do not all reach ℓ, or that have no stationary sibling: the open rule needs one (`siblings`, `rules.mjs:6`).
- Other flaps overlapping the tip.
- Points with 3 or more stacks.
- Scale: only ≤32 faces were tested.
- Exact predicates.
- 3D motion and reachability: FF validity says nothing about the motion.

## Recommendations

1. Implement sinks as the shared reflect-and-split geometry plus a block-placement order rule (open = per-layer pocket, closed = two blocks into a chosen pocket). Use completion only for pairs the rule leaves undecided, and always verify.
2. Before offering an open sink, check its preconditions: closed outline, single exterior letter, exact perpendicular line. Otherwise offer only closed sinks and reverse folds.
3. Ship "Unsink" as a deterministic operation.
4. Store the layer order. Letters determined it here, but not on open points or deep closed sinks.
5. Keep the CP importer (CP + chosen solution) as a product feature. It recovered both bases (1 of 18 orders) with no hand-written faces.

## Open questions

- Do physical closed sinks of a preliminary base land in the front or back pocket, and do the twisted or mixed variants ever appear in diagrams? This needs checking against real folds or diagrams.
- How should a pocket be defined for points with 3 or more stacks or rotational symmetry?
- Do double and triple sinks (alternating open and closed at several depths) compose cleanly with these rules? Only one second open sink was tested.
- Is "the letters determine the state" generic for closed points? Every closed case here says yes; open points and deep sinks say no.
- What do performance and numerics look like at hundreds of faces, and with exact arithmetic?

Files are in `/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/fold-workspace-research-c52ced/artifacts/fold-spike/compound/sinks/`:
- `README.md` — how to run everything
- `renders/index.html` — contact sheet, 22 cards
- `results/summary.json` — the verification table
- `results/prelim-sweep.json`, `results/exp5.json`, `results/exp6.json`, `results/exp7.json` — the individual experiments
