# 3D Kawasaki vertex autocomplete

Phase 7's first item from [`non-180-fold-angles.md`](non-180-fold-angles.md):
*"§4 unknown-crease insertion, generalising `FlatFoldableVertexCandidates`"*.

## Goal

Generalise the `T` tool — Oriedita's flat-foldable line
(`VERTEX_MAKE_ANGULARLY_FLAT_FOLDABLE_38`) — from 2D Kawasaki to the quaternion
closure condition, so it completes a vertex whose creases carry any fold angle,
not only ±180.

Today the tool answers *"where does one more crease go so this vertex folds
flat?"* by an alternating angle sum over an odd-degree fan. The generalisation
answers *"where does one more crease go, and how far does it fold, so this vertex
closes?"* — Wong, *3d Kawasaki's theorem with quaternions*, §4.

The flat case is not replaced. It is the special case where every incident crease
is ±180, and the generalised solver reproduces its answers exactly (see
Equivalence below) — but the port stays the authority for it, per-vertex, the
same dispatch [`checks_spatial::dispatched_camv`] already uses.

## Approach

### The solve (§4)

For a fan of `n` creases sorted by θ, with `q_i = [cos(ρ_i/2), sin(ρ_i/2)cos θ_i,
sin(ρ_i/2)sin θ_i, 0]` and `Q_tot = q_{n-1}···q_0`, inserting a new crease into
angular gap `i` means

```text
Q_L q_new Q_R = 1,   Q_L = q_{n-1}···q_{i+1},   Q_R = q_i···q_0
q_new = Q_L^-1 Q_tot^-1 Q_L
```

**The paper's eq. 35 prints `q_new = Q_L^-1 Q_tot Q_L`, which is a typo.** Its own
derivation gives `Q_R^-1 = Q_tot^-1 Q_L`, hence `q_new = Q_L^-1 Q_R^-1 =
Q_L^-1 Q_tot^-1 Q_L`. The inverse is load-bearing: without it a *closed* vertex
solves to `q_new = 1`'s antipode rather than to "nothing to add". Implement the
derivation, not the printed line.

Three consequences fall out of that form, and each one shapes the code:

- **`w_new = w_tot` in every gap.** Conjugation preserves the scalar part, so the
  *magnitude* `|ρ_new|` is fixed by `Q_tot` alone; only the direction varies by
  gap. `w_tot < 0` therefore means no single crease closes this vertex from any
  gap — it would need `|ρ| > 180`.
- **The problem is overdetermined**: 3 constraints, 2 unknowns. `q_new`'s axis
  must lie in the sheet plane, so a candidate exists only when its `z` component
  is 0. When it is not, at least two creases are needed and the tool must say so
  rather than silently finding nothing.
- **Each gap admits two readings of the same quaternion**: `(θ, ρ)` and
  `(θ+π, −ρ)` are the same `q_new`. Both are tested against the gap; the wedge
  test picks at most one in the common case, and both are real answers when a
  reflex gap admits them.

### Equivalence with the flat path

For an all-classic fan every `q_i` is a pure quaternion in the xy-plane, so:

- odd degree → `Q_tot` is pure → `w_tot = 0` → `ρ_new = ±180`, and the axis stays
  in the plane exactly. The solver returns Oriedita's rays, and additionally
  states the M/V the new crease must take (which Maekawa forces and the port
  leaves to the active colour).
- even degree → `Q_tot` lies in `span{1, k}`, its axis is `z`, so no gap passes
  the planarity test. No candidates — which is right, since one more crease would
  make the degree odd and no odd flat vertex satisfies Maekawa.

So the generalisation adds candidates exactly where the flat path has none to
give. `closure_completion_matches_oriedita_on_classic_fans` asserts this over the
port's own output rather than trusting the argument.

### Dispatch

Per vertex, from the same regime test the checker uses:

> A vertex whose incident creases are all classic runs Oriedita's candidate
> generation unchanged. A vertex touching any non-classic crease runs the solver.

The regime is read from the *checker's* extraction (`point_line_map`'s ε and
colour filter), not the port's, so the tool and the `Creases do not close`
diagnostic can never disagree about which regime a vertex is in — a user reaches
for this tool *because* of that diagnostic.

### Committing

The port's commit builds `LineSegment::with_color(cross, vertex, color)`. It
gains the fold magnitude, which is `None` on the flat path — behaviour there is
unchanged. The spatial path takes colour *and* magnitude from the chosen
candidate, because the solver determined both.

### UI

The candidate rays are the whole interaction, so they must show what they are:

- **Stroked in the crease colour they would commit**, through the same
  `foldAngleRamp` the document uses. A 90° valley candidate looks like a 90°
  valley. The preview channel carries one colour per group already; candidates
  that name a colour form their own groups and everything else keeps
  `toolPreviewColor` untouched.
- **Badged with their angle**, reusing `CpFoldAngleLayer`. Candidate badges are
  *not* gated by the fold-angle-labels view toggle: the angle is the tool's
  output, not document decoration.
- **A diagnostic when there is no completion**, since "overdetermined, no
  solution" is the common answer on a freely-drawn spatial vertex and an empty
  canvas would read as a broken tool.

## Affected Areas

**Rust kernel**
- `crates/oristudio-cp/src/checks_spatial.rs` — quaternion helpers visible to the
  solver; `vertex_fan_at` for a single vertex without a whole-document map
- `crates/oristudio-cp/src/solve_spatial.rs` — **new**: the §4 solver and the
  regime dispatch
- `crates/oristudio-cp/src/operations/construction.rs` — the commit carries a
  fold magnitude
- `crates/oristudio-cp/src/lib.rs` — `VertexMakeAngularlyFlatFoldable` and
  `FoldableLineDraw` route through the dispatcher, in both commit and preview
- `crates/oristudio-cp-wasm/` — committed `.wasm` rebuild

**Web**
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — preview state keeps
  the candidate's colour and magnitude
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — per-candidate stroke
  colour through the ramp
- `apps/web/src/cp-workspace/foldAngle/CpFoldAngleLayer.tsx` — candidate badges
- `apps/web/src/lib/oristudioCpCommands.ts` — tool label and step prompts
- `apps/web/public/locales/*` — new strings, `i18n:check` gate

## Checklist

- [x] `closure_completions` per §4, with the corrected eq. 35
- [x] Candidate readings `(θ, ρ)` and `(θ+π, −ρ)`, gap-tested exclusively
- [x] `w_tot < 0` and a closed vertex both return no candidates
- [x] Planarity test on `q_new`'s `z`, with the no-solution reason surfaced
- [x] `vertex_fan_at`: single-vertex extraction agreeing with `point_line_map`
- [x] Regime dispatch; classic vertices keep the port's answer byte-identically
- [x] Equivalence test against Oriedita's candidates on classic odd fans
- [x] Commit carries colour + magnitude from the chosen candidate
- [x] Preview + commit routed through the dispatcher for both tools
- [x] Oracle suite green with no fixture edits
- [x] Candidate strokes in their committed colour, through the ramp
- [x] Candidate angle badges, ungated by the labels toggle
- [x] "No single crease closes this vertex" diagnostic
- [x] `i18n:check` green
- [x] wasm rebuilt and committed
- [x] The tool is renamed **Foldable Line**: it no longer only does flat

## Verified in the browser

Both branches, end to end through wasm:

- **Solved.** A lone 90° valley (a degree-1 vertex, so rigid and reported as
  such) offers exactly one candidate — the crease continued straight through at
  the same angle, which is the one non-classic case with a hand-checkable answer.
  It is stroked in the ramped valley colour and badged `90°` in the accent.
  Committing writes `Blue2` with `fold_magnitude: 900000000`, and the closure
  diagnostic clears.
- **No completion.** Adding creases at 70°/−40° and 200°/110° makes the vertex
  overdetermined; the tool draws nothing and the context panel says *"No single
  crease closes this vertex — at least two would be needed."*

## When does a completion actually exist? (measured)

Worth writing down, because the obvious measurement is misleading.

**Sampling random real-valued fold angles finds a completion 0 times in 20,000**,
at every degree from 2 to 11. Taken alone that reads as "this tool never fires on
non-flat vertices", and it is the wrong conclusion — nobody draws arbitrary
angles. Designed origami is snapped: directions on a 45/30/22.5 grid, fold angles
from a small vocabulary. Snapped geometry lands on the solvable set
*systematically*, because the quaternion components then live in an algebraic ring
where the out-of-plane term cancels exactly.

Exhaustive enumeration over the 45 degree grid with angles `{+/-90, +/-180}`:

| degree | fans enumerated | admit a completion | of those, involving a non-180 crease |
| --- | --- | --- | --- |
| 3 | 3,584 | 784 | 336 |
| 4 | 17,920 | 1,184 | 1,184 |
| 5 | 57,344 | 6,992 | 5,200 |
| 6 | 114,688 | 8,992 | 8,992 |

And the workflow measurement that matters — take vertices that genuinely *close*,
remove one crease, ask the tool to put it back:

| angles | degree | closed vertices | removals | recovered | uniquely |
| --- | --- | --- | --- | --- | --- |
| `{+/-90, +/-180}` | 4 | 224 | 320 | **320 (100%)** | 288 |
| | 5 | 256 | 1,280 | **1,280 (100%)** | 832 |
| | 6 | 1,216 | 4,992 | **4,992 (100%)** | 4,224 |
| `{+/-45..+/-180}` | 4 | 384 | 960 | **960 (100%)** | 928 |
| | 5 | 1,008 | 5,040 | **5,040 (100%)** | 3,568 |

Never once did the tool fail to answer. Degree 3 contributes nothing because no
degree-3 vertex closes at these angles at all — degree 3 is rigid.

The all-classic case follows a clean parity rule, confirmed to degree 11: odd
degree always completes (1000/1000 sampled), even degree never does.

`removing_a_crease_from_a_designed_vertex_recovers_it` pins the workflow row down
as a regression test, and carries the reasoning so the 0-in-20,000 statistic
cannot be rediscovered and misread.

## Two deliberate divergences from Oriedita

Both live in the dispatcher, not in the ported function, so the operation the
oracle tests keeps its own behaviour exactly.

**A vertex on the paper's edge is declined.** Closure is a statement about
walking all the way round a point, and at the border there is no way round. The
port offers a candidate there anyway: at a border vertex with one incident
crease its alternating sum degenerates to a full turn, so it proposes the
straight continuation *off the sheet*. Measured on a 90 degree valley meeting the
bottom edge of a 400-unit square, both paths proposed a crease 50 units below the
paper. Neither answer is useful, so both regimes now refuse and say why.

**The mountain/valley comes from the solve, in both regimes.** The port commits
in the active line colour, which Maekawa may forbid — so the tool could hand you
a crease that fails the foldability check a moment later. Now the assignment is
the one the closure solve forces, and the context panel says so when it differs
from the selected line type: *"This crease has to be a mountain — drawn as one,
not in the selected line type."*

Ray *geometry* is still the port's, to the last bit
(`taking_the_assignment_leaves_the_ports_geometry_untouched`); only the colour
changes. A ray the solve does not speak for keeps `Purple8` and falls back to the
port's colour, so an unexpected disagreement degrades to Oriedita's behaviour
rather than to a wrong assignment.

Candidate badges follow the document's rule rather than inventing one: a full
fold is the default and says nothing, so it gets no number. On a flat pattern the
colour carries the only fact that varies.

## Follow-ups this left open

- **Two-crease completion.** §4 is over-constrained, but *four* unknowns against
  three constraints is under-constrained — so with the user dragging the
  direction of one new crease, the rest is a one-dimensional search that reuses
  everything here. Measured on vertices one crease cannot finish: 276 of 300 can
  be finished with two, and 1,623 of 2,355 arbitrary chosen directions admit a
  solution. Fixing *both* directions and solving only the angles does not work
  (0 of 300) — the interaction has to ask for one direction, not two.
- **Reaching the tool from a diagnostic marker.** A vertex reporting `Creases do
  not close` should offer the fix directly; today you have to know to pick the
  tool.
- **The refusal is only in the side panel**, which is the wrong place to look
  when you have just clicked something on the canvas.
- **`FoldableLineDraw`'s preview still shows a plain line**, not the candidate
  rays, because that is what the port does for its hybrid gesture. Its *commit*
  is generalised. Pre-existing, and it now matters slightly more.
- **Solving an existing unassigned crease's angle.** Same equation with the axis
  known and checked rather than solved. A different verb, and the natural next
  one — see Non-goals.

## Non-goals

- §5's three-unknown-angle solver, and the degree-4 "set one, solve three".
  Separate tools with their own interaction; Phase 7 keeps them as its own items.
- Two-crease completion when §4 reports the problem is overdetermined. The paper
  notes it is possible; the search space and the interaction are a different
  feature.
- Solving the angle of an existing *unassigned* crease (known axis, unknown ρ).
  The same equation with the axis check inverted — a natural follow-up, but a
  different verb from "insert a crease".
