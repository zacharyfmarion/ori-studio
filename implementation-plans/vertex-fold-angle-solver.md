# Solving three fold angles at a vertex

Phase 7's first item from [`non-180-fold-angles.md`](non-180-fold-angles.md):
*"§5 three-unknown solver, both roots surfaced as a branch choice"*. It is the
verb [`spatial-vertex-completion.md`](spatial-vertex-completion.md) named as its
own non-goal and left for here.

## Goal

Take a vertex whose creases do not close, let the user nominate **three creases
they are willing to change**, and solve those three fold angles so the vertex
closes — **without moving any crease**. Wong, *3d Kawasaki's theorem with
quaternions*, §5.

The counterpart to §4, and the more generally useful of the two:

| | §4 — `Foldable Line` (shipped) | §5 — this |
| --- | --- | --- |
| changes | adds a crease | changes 3 fold angles |
| unknowns vs. constraints | 2 vs. 3 — **over**determined | 3 vs. 3 — **exactly** determined |
| geometry | moves | untouched |
| when it answers | codimension 1; needs snapped geometry | an open region; answers on freely-drawn vertices too |

That difference in codimension is the whole point. §4 finds nothing on a
freely-angled vertex (0 completions in 20,000 random fans); §5 answers on **25–38%
of randomly chosen triples**, and on **49% (degree 4) to 88% (degree 8)** of
freely-angled vertices *some* triple works. It is the first solver in this family
that helps someone who drew by hand rather than on a grid.

## Approach

### The solve (§5)

Creases sorted by θ. Pick three, at fan indices `i < j < k`, labelled `a`, `b`,
`c`. The closure product is invariant under cyclic rotation (`XY = 1 ⟹ YX = 1`),
so rotate it to start just after `c`:

```text
q_c Q_3 q_b Q_2 q_a Q_1 = 1
Q_1 = knowns between c and a   Q_2 = between a and b   Q_3 = between b and c
```

Move `Q_1..Q_3` to the right with the axis-transformation identity
`xy = (xyx⁻¹)x`. Conjugation preserves the scalar part, so each unknown keeps its
own unknown angle and merely acquires a **known, out-of-plane axis**:

```text
q_c q̃_b q̃̃_a = Q_target,  Q_target = Q_1⁻¹Q_2⁻¹Q_3⁻¹
u_c = v_c        u_b = R_3 v_b        u_a = R_3 R_2 v_a
```

Strip the outer two (`u_cᵀR_c = u_cᵀ`, `R_a u_a = u_a`) to isolate `ρ_b`:

```text
A cos ρ_b + B sin ρ_b + C = 0
A = u_c·u_a − (u_c·u_b)(u_b·u_a)
B = u_c·(u_b × u_a)
C = (u_c·u_b)(u_b·u_a) − u_c·(R_target u_a)
```

then `ρ_c` as the rotation about `u_c` carrying `R_b u_a` to `R_target u_a`, and
finally `ρ_a` by reading `q̃̃_a = q̃_b⁻¹ q_c⁻¹ Q_target` back as an axis-angle.

**No matrix code is needed.** The paper works in matrices, but every quantity
above is a dot or cross product of vectors that `checks_spatial::quat_rotate`
already produces. The whole closed form is roughly forty lines against the
quaternion helpers that module exports.

### Four corrections to the paper

Each was verified numerically against a closed vertex, and each fails *silently*
if implemented as printed.

**1. Eq. 46 reverses the product order.** Eq. 45 has `R_c R_b R_a = R_target`;
eq. 46 prints `R_a R_b R_c = R_target`. Eq. 47's derivation only works for the
first — stripping `R_c` needs it leftmost and `R_a` rightmost. Implement eq. 45.
(The §4 port already had to correct eq. 35 the same way; the derivations are
sound, the transcriptions are not.)

**2. Eq. 55's Weierstrass substitution has a pole at exactly the most common
origami angle.** `t = tan(ρ_b/2)` diverges at `ρ_b = ±180`, and the quadratic
`(C−A)t² + 2Bt + (A+C) = 0` degenerates to linear there, throwing that root away.
A full fold is not a corner case. Solve the equation directly instead:

```text
√(A²+B²)·cos(ρ_b − φ) = −C,   φ = atan2(B, A)
ρ_b = φ ± arccos(−C / √(A²+B²))
```

Algebraically identical (`A²+B²−C² ≥ 0` is the same existence test as eq. 55's
discriminant) with no pole and no special case.

**3. Eq. 77 loses the sign of `ρ_a`.** `2 arctan(√(x²+y²+z²)/s)` is non-negative,
so every solved `ρ_a` would come out a valley. The sign lives in whether the
vector part points along `+u_a` or `−u_a`:

```text
ρ_a = 2·atan2(v · u_a, s)
```

and `s < 0` is not a sign convention to normalise away — it means this branch
needs `|ρ_a| > 180°`, which no crease can do. Reject it, exactly as §4 rejects
`w_tot < 0`.

**4. The solve happens in SO(3), which is blind to mountain/valley at a full
fold.** `ρ = +180` and `ρ = −180` are the same rotation matrix and **opposite
quaternions**. This is the A0 trap (`non-180-fold-angles.md`) in a new place, and
it is not theoretical: wrapping roots into `[−π, π)` silently converted full
valleys to full mountains and held recovery on known-good vertices to **39%**.
Where a solved `|ρ|` lands on 180, both signs are candidates; enumerate both and
let the closure residual decide. That alone took recovery to 58%.

### The finding that shapes the architecture: rank

Getting to 58% and then 67% left a third of known-good vertices unrecovered, and
guessing was not converging. The decisive measurement was the **rank of the 3×3
Jacobian of the closure vector part with respect to the three chosen angles,
evaluated at the known answer**:

| | recovered | missed |
| --- | --- | --- |
| rank 3 (isolated solution) | **1,128 / 1,128** at degree 6, 1,280/1,280 at degree 5, 192/192 at degree 4 | **none, at any degree** |
| rank < 3 (a curve of solutions) | 25–59% | the rest |

**There is not one rank-3 miss.** The closed form is exact and complete wherever
the solution is isolated; every failure is a triple whose three creases do not
independently control closure, where the answer is a one-parameter *family* and
the elimination — which is built to return points — has nothing to return.

And rank deficiency is not exotic. It is a **snapped-geometry** phenomenon, which
is to say it is the target workflow:

| fans | degree 4 | 5 | 6 | 7 |
| --- | --- | --- | --- | --- |
| freely angled (uniform random) | rank 3: **100%** | 100% | 100% | 100% |
| designed (45° grid, `{±90, ±180}`) | rank 3: **21.7%** | 50.0% | 28.7% | 45.6% |

So the closed form alone cannot be the product. Adding a **damped least-squares
(Levenberg) pass on the same three unknowns**, seeded from the creases' current
angles, takes the repair rate from 48–70% to **99–100%**:

| degree | broken vertices | closed form alone | + seeded Levenberg |
| --- | --- | --- | --- |
| 4 | 896 | 67.9% | **100.0%** |
| 5 | 2,560 | 70.0% | **99.2%** |
| 6 | 3,000 | 48.4% | **99.3%** |

### So: closed form for the branches, Levenberg for the rest

Two stages, each doing only what it is good at.

- **Closed form** enumerates the finitely many branches — it is the only thing
  that can, and it is exact when they exist. Worst closure residual over every
  solution it offered: **7.1e-14 degrees**, eight orders inside the 1e-6 bar.
- **Levenberg**, seeded from the current angles, covers the degenerate families
  and polishes. The `w > 0` guard is mandatory in the iteration — least squares
  on the vector part alone converges happily onto the Maekawa-violating lift.

Every solution from either stage is accepted only after **reconstructing the fan
and measuring `checks_spatial::vertex_closure_residual`**. That check is the
authority, it is `O(n)`, and it is what makes the branch bookkeeping above safe
rather than merely careful.

### Consequences worth designing around

- **The answer does not depend on the three creases' current angles.** `Q_1..Q_3`
  and `u_a, u_b, u_c` are built from the *other* creases and from θ alone.
  Confirmed over 20 randomisations of the three: identical solution set every
  time. So "solve these three" is well-defined however wrong they currently are,
  and the tool never needs the user to guess a starting point.
- **A closed vertex is not declined.** §4 returns `AlreadyClosed` because there
  is nothing to add. Here the current state is one root and the other is the
  vertex popped through — a real and useful thing to offer. Measured on closed
  snapped vertices, a second branch exists for 46–66% of triples.
- **A rank-deficient triple must say so, not return nothing and not return an
  arbitrary member.** Seeded from the current angles it is at least deterministic;
  `(0°, 45°, 180°)` — a straight crease through a point with a spur — produced
  members at 8.9°, 34.7°, 48.5°, 107.0° and 120.8° from different seeds, all
  valid. The honest report is "one degree of freedom remains", plus the canonical
  member, plus the offer to pick a different third crease.

  This is also what keeps **"1 of N" honest**. A count is only meaningful over a
  finite set, so the solver classifies each solution it returns by the Jacobian
  rank *at that solution*: rank 3 is a genuine discrete branch and is counted;
  rank < 3 lies on a curve, and the member offered is badged as one of a family
  rather than folded into the tally. Same machinery as [`checks_spatial::vertex_dof`],
  evaluated on the three chosen columns.
- **Degree 3 is rigid and the solver says so by itself**: `(0, 120, 240)`,
  `(0, 90, 200)` and `(10, 130, 250)` each return exactly `(0, 0, 0)`. No special
  case needed, but pin it — an "answer" that flattens the vertex must not read as
  a repair.
- **Near a rigid vertex the residual bar is loose.** Closure is second-order in ρ
  there, so answers 0.003° from flat clear the 1e-6° bar. Report `vertex_dof`
  alongside the solution rather than tightening the bar.

### The plumbing gap: the fan has no provenance

`VertexFan` carries `(theta, rho)` and nothing else — it deliberately drops which
segment each crease came from, and it *skips* borders and unassigned lines, so
fan index ≠ incident-line index. §4 never needed the mapping because it wrote a
**new** crease. §5 writes back to **existing** ones, so it does.

Keep `VertexFan` as the pure math seam its doc comment promises and add a sibling
extraction returning the fan plus an index-aligned `Vec<usize>` of document line
indices. One test pins the alignment (`fan.creases[k]` is `line_segments[src[k]]`);
everything else stays as it is.

### Interaction

A step tool, `VertexSolveFoldAngles`, following the shape
`VertexMakeAngularlyFlatFoldable` already established, but with one state no CP
tool has yet — see "Review is a new state" below.

1. **Pick the vertex.** Incident creases light up; the context panel states the
   closure residual and the degree of freedom.
2. **Pick three creases.** After the second, the remaining creases are marked
   with whether they complete a solvable triple — `C(n,3)` solves is 20 at degree
   6 and each is `O(n)`, so this is free and it turns "pick and hope" into "pick
   from what works".
3. **Review.** The tool stays active and holds the whole solution set. The three
   creases redraw in the selected solution's colour and angle through
   `foldAngleRamp`, badged with `CpFoldAngleLayer` — the same channel §4's
   candidates already use, so no new rendering concept.
4. **Step through the solutions** with back/forward buttons reading `2 of 3`,
   plus `←` / `→`. Ordered nearest-to-current first, so a vertex that is nearly
   right is nudged before it is popped, and the ordering is deterministic.
5. **Apply** commits one operation writing colour and magnitude to all three, so
   undo is one step.

**One solution skips the review entirely** and applies on the third pick, which
is how every other CP tool behaves. The exception is a solution that sits on a
continuous family: that is not "the answer", it is one of infinitely many, so it
holds in review with its badge rather than committing something arbitrary.

**Review is a new state, and it belongs in a hook, not the engine.**
`createStepSequenceTool` commits on the final click (`commit: { points }`) — the
`ToolEngine` reducer has nowhere to hold a decision. The temptation is to widen
`ToolInput['kind']` with an `apply` variant, which would touch every engine's
exhaustive switch for one tool's benefit. Don't: the review is driven by keyboard
and buttons, not by pointers, so it is state for one concern and goes in a
`cp-workspace/foldAngleSolve/useVertexSolve.ts` hook per AGENTS.md's table. The
engine stays pure over pointer input; the hook holds `{ solutions, index }` and
feeds `payload.candidate_index` to both the preview and the commit, exactly as
§4 already does for its candidate pick. The kernel stays stateless.

**Keys go in the registry.** `←` / `→` / `Enter` register in
`apps/web/src/keyboard/` at `crease-pattern` scope and **decline** when the tool
is not in review, so the chords fall through to whatever else wants them — the
same decline mechanism `viewport.delete` already uses. Never a panel `keydown`
listener; `eslint`'s `noPanelKeydown` rule enforces it, and a container-scoped
listener would go dead the moment the context panel took focus. Run
`findShortcutConflict` before landing: duplicate chords in this registry fail
*silently*, which has bitten before.

**Escape cancels, as it does everywhere else** — the fold-angle entry chord, the
measure tool, every in-progress tool gesture. It discards the review and leaves
the three creases as they were. Enter and Apply are the only ways to commit.

Reached from the `Creases do not close` diagnostic marker as well as from the
rail — that marker is why anyone wants this tool, and §4's plan already lists
"reaching the tool from a diagnostic marker" as an outstanding gap. Fixing it for
both at once is the same work.

The refusal reasons follow §4's precedent exactly: a stable kernel code, a
sentence per code in `toolUnavailable.ts`, never a Rust string literal — eight
locales are gated in CI.

**What has to cross the wasm boundary that §4 did not need.** §4's preview
returns candidate rays and the UI counts them. Here the three preview segments
carry the solved colour and angle already (`ToolPreviewSegment.crease`), so the
*values* need no new channel — but the **count** and the **family flag** do.
`CreasePatternPreview` gains two additive optional fields (`candidate_count`,
`candidate_is_family`); an older frontend ignoring them degrades to showing the
first solution, which is the nearest-to-current one.

## Affected Areas

**Rust kernel**
- `crates/oristudio-cp/src/checks_spatial.rs` — `quat_from_axis_angle` for a
  general 3D axis; the fan extraction that carries source line indices
- `crates/oristudio-cp/src/solve_fold_angles.rs` — **new**: the §5 closed form,
  the Levenberg fallback, branch enumeration and the residual gate
- `crates/oristudio-cp/src/operations/color.rs` — set colour *and* magnitude for
  a set of indices atomically
- `crates/oristudio-cp/src/lib.rs` — `OperationId::VertexSolveFoldAngles`,
  commit + preview, the unavailable codes, and `CreasePatternPreview`'s two
  additive count/family fields
- `crates/oristudio-cp-wasm/` — bridge, **plus the committed `.wasm` rebuild**
  (tracked, not generated — R4, and it has bitten before)

**Web**
- `apps/web/src/lib/oristudioCpCommands.ts`, `oristudioCpActions.ts` — the tool,
  its steps and its rail placement
- `apps/web/src/cp-workspace/foldAngleSolve/` — **new**: `useVertexSolve.ts` (the
  review state), the solution-list descriptors, and the stepper component
- `apps/web/src/cp-workspace/tools/toolUnavailable.ts` — the new codes
- `apps/web/src/keyboard/shortcuts.ts` — `←` / `→` / `Enter` at `crease-pattern`
  scope, declining outside review
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — mounts the hook and
  passes `candidate_index`; no solve logic
- `apps/web/src/components/panels/CpContextToolPanel.tsx` — residual/dof readout,
  the `2 of 3` stepper, the family badge, Apply
- `apps/web/src/engine/oristudioCpTypes.ts` — the two preview fields
- `apps/web/src/cp-workspace/diagnostics/` — the marker's route into the tool
- `apps/web/public/locales/*` — new strings, `i18n:check` gate

Per AGENTS.md's panel rule: the solve state, the branch selection and the
crease-pick bookkeeping go in the `cp-workspace/foldAngleSolve/` hook, not into
`CreasePatternPanel.tsx` (already 3,320 lines against its cap). The panel mounts
and wires; it does not accumulate this.

## Checklist

### Kernel — the solve
- [ ] Closed form per §5, in quaternions, with **eq. 45's product order** (not 46)
- [ ] `√(A²+B²)·cos(ρ−φ) = −C` form, never the Weierstrass quadratic — a full
      fold is the pole it drops
- [ ] `ρ_a = 2·atan2(v·u_a, s)`, signed; `s < 0` rejected as beyond a full fold
- [ ] Both ±180 lifts enumerated wherever a solved `|ρ|` lands on a full fold
- [ ] Tangency (`|C| = R`) tolerated rather than rejected — designed geometry
      lands on it systematically
- [ ] All three cyclic labelings tried (it is cheap; it is not sufficient alone)
- [ ] Levenberg fallback with the `w > 0` guard, seeded from the current angles
- [ ] Every solution gated on `vertex_closure_residual`, from either stage
- [ ] Rank-deficient triples reported as a one-parameter family, with a member
- [ ] Solutions deduplicated and returned as an ordered list, nearest-to-current
      first, each carrying its three angles and whether it is isolated or a
      family member
- [ ] Boundary vertex, indeterminate fan, and non-incident crease all declined

### Kernel — plumbing
- [ ] Fan extraction carrying source line indices, with an alignment test
- [ ] `OperationId::VertexSolveFoldAngles`; colour + magnitude in one undo step,
      including a mountain/valley flip when the solve calls for one
- [ ] `payload.candidate_index` selects the solution, for preview and commit
      alike — one solve behind both, so the reviewed answer is the applied one
- [ ] `CreasePatternPreview` gains `candidate_count` and `candidate_is_family`,
      both additive and optional
- [ ] Preview path shares the solve with the commit — §4's rule, for §4's reason
- [ ] Oracle suite green with no fixture edits

### Kernel — tests that pin the measurements
- [ ] Rank-3 recovery is **100%** at degrees 4, 5 and 6 over the 45° grid with
      `{±90, ±180}` — the prototype's 192/192, 1,280/1,280, 1,128/1,128
- [ ] Closed form + fallback repairs ≥99% of corrupted designed vertices
- [ ] Freely-angled vertices: rank 3 at 100%, so the degeneracy path is
      exercised only by snapped fixtures — assert both populations
- [ ] Worst residual over every offered solution stays below 1e-9° (measured
      7.1e-14; the floor is there to catch a regression, not to be tight)
- [ ] The Maekawa branch is rejected: a case where SO(3) closes and the
      quaternion does not
- [ ] The solution set is independent of the three creases' current angles
- [ ] Degree 3 returns only the flat solution
- [ ] A closed vertex offers its current state *and* the popped-through branch

### Web
- [ ] Tool, steps, rail placement, and the diagnostic marker's route into it
- [ ] Solvable-third-crease marking after the second pick
- [ ] Preview strokes in solved colour through the ramp, badged with the angle
- [ ] Review state in `cp-workspace/foldAngleSolve/useVertexSolve.ts`; the
      `ToolEngine` union is **not** widened for it
- [ ] Back/forward stepper reading `2 of 3`, with `←` / `→` and `Enter`
      registered in `apps/web/src/keyboard/` and declining outside review
- [ ] Verified against `findShortcutConflict` — duplicate chords fail silently
- [ ] Escape cancels the review and leaves the three creases untouched
- [ ] Exactly one isolated solution applies immediately, with no review step
- [ ] A lone family member still holds in review, badged, rather than committing
      an arbitrary point on the curve
- [ ] The solution matching the current state is marked as such when there is one
- [ ] Unavailable codes and sentences; `i18n:check` green
- [ ] wasm rebuilt and committed

### Verification
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets -D warnings`,
      `cargo test --workspace`
- [ ] `npx tsc --noEmit` + vitest directly (the npm scripts regenerate tracked
      wasm bindings nondeterministically)
- [ ] Browser checklist for the author: pick a vertex the closure diagnostic has
      marked; step through every solution and confirm the preview changes with
      the stepper; Escape leaves the creases untouched; Apply clears the marker;
      and a vertex with a single solution never shows the stepper at all

## Decisions

- **The solve may flip a crease's mountain/valley**, whenever closing the vertex
  requires it. The sign of `ρ` is part of the answer, and these are creases the
  user nominated as changeable. Shown loudly, the same call §4 made when the
  forced assignment overrides the active line colour. A "keep M/V, solve
  magnitude only" mode is a constrained solve and a different feature.
- **The solution set is enumerated, not reduced to a default.** Ordered
  nearest-to-current first — so a nearly-right vertex is nudged before it is
  popped — and stepped through in the tool. The ordering is the only place
  "nearest" is used; it picks a starting point, not the answer.
- **Escape cancels.** Enter and Apply commit.

## Non-goals

- **Selecting the three creases from the existing selection** instead of picking
  them in the tool. Attractive, and the shared vertex is inferrable, but it is a
  second entry point to the same solve — add it once the tool exists.
- **Solving an unassigned crease's angle.** `LineColor::None` has no direction,
  so it is not in the fan at all and the extraction's determinacy contract would
  have to change. Nearly free once that is decided; still a different verb.
- **More than three unknowns.** Four against three constraints is
  under-determined — a family, not an answer, and it needs an interaction that
  asks the user to steer. Same shape as §4's two-crease completion follow-up.
- **Choosing the triple automatically.** The tool marks which triples work; the
  choice is a design decision about which creases are yours to change, and the
  software does not know that.
- **Anything global.** This is a local vertex repair and can break a neighbouring
  vertex that shares one of the three creases. The checker reports it; the
  division of labour is unchanged.
