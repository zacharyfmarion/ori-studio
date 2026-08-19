# Fold-angle propagation

The whole-pattern counterpart to
[`vertex-fold-angle-solver.md`](vertex-fold-angle-solver.md), which solves
exactly three fold angles at **one** vertex. Same geometry, same paper (Wong,
*3d Kawasaki's theorem with quaternions*), same discipline — generalised to any
number of unknowns at a vertex, then run to a fixpoint across the sheet.

Every number below was measured on **validated** real crease patterns: 31
designs admitted only after passing the repo's own bar — 0 flat-foldability
violations, 0 closure failures over a **non-zero** number of examined spatial
vertices, and 0 self-intersecting vertex links. An earlier revision of this plan
was measured on a ~99.99% synthetic population and got four claims wrong; the
corrections are called out where they land.

## Goal

Given a crease pattern where **some** creases carry fold angles and some do not,
derive every angle that is **forced**, stop where it is not, and let the user pin
an answer and re-propagate.

Exact fold angles, not mountain/valley. No enumeration: the tool commits only
where the answer is unique, and where a vertex genuinely admits several foldings
it asks rather than guesses.

## The population, stated honestly

This is the first section because it bounds everything else.

**Admitted: 31 designs.** `known-good/` (10 of 12 — see below), `spikes_better.fold`,
`non-flat-harder_final.osf`, and 26 files elsewhere in the corpus proven clean
individually. Sizes 16 → 15,950 segments.

**Excluded: the 36-model `origami-simulator-corpus`.** Its own README says the
fold angles there "are relaxation targets rather than solved states", and the
measurement agrees: **30,820 spatial vertices examined, 21,132 closure failures
(68.6%), worst residual 302.34°**. A vertex that does not close has no correct
answer to recover. Its 6 clean files are byte-identical to their `known-good`
counterparts, so it contributes **zero** new clean geometry.

**"Unexamined" is not "clean", and it needs its own UI state.**
`known-good/airplane.fold` and `cubeunwrapping.fold` have **zero interior
vertices** — every vertex touches a `Black0` paper edge, so `is_interior_vertex`
declines all of them and nothing is checked. They fail nothing and prove nothing.
This is the same distinction the disk precondition turns on.

**The arbitrary-angle sample is n≈1 for curated third-party work.**
`known-good/byu solar driven.fold` (90 interior vertices, ±59.994°, 30° lattice)
is the only one. 2,240 of the 2,506 arbitrary-angle interior vertices come from a
single owner-authored perf fixture carrying the same 16-value vocabulary as the
452-segment penguin; excluding it leaves **266 vertices across 6 families**. And
`byu` is simultaneously the best-behaved file on most metrics *and* the
counterexample for two others — it is singular, not typical. Do not generalise
from it in either direction.

Note also that `spikes_better.fold`, described upstream as "the largest clean
3D-angled model that exists", has **all 368 crease angles orthogonal**. It is
genuinely non-flat but exercises no arbitrary-angle arithmetic at all.

## What is solid

**Closed forms for k = 1 and k = 2 exist**, derived and verified — both fall out
of the reduction `branch_angles` already uses. Probe: `vertex-k-solve`, 12/12
tests, quaternion transcription pinned against the repo's own
`vertex_closure_residual` and `vertex_dof`.

| claim | measured on validated designs |
| --- | --- |
| **k=1 is 100% determined** | **115,560 / 115,560**, zero exceptions, confirmed twice more independently (71,914/71,914 and 17,475/17,475) |
| **k ≥ 4 is always underdetermined** | **342,177 rows at k=4…8: 0 determined, 0 branching, max rank 3.** Structural — `closure_jacobian` is k×3 |
| **No wrong commit** | **283,289 determined commits, max error 9.82e-07°, zero above the 1e-6° bar.** Truth present in the solution set 283,289/283,289 |
| **Drift does not compound** | no trend to depth 16; cycle residual inside the document's own envelope on 7 of 8 files |

**The one structural claim that vindicates:** determinacy tracks the *fold-angle
state*, not the direction lattice. Paired experiment, directions held
bit-identical and only the angle state regenerated: a 45° lattice goes
**0.00% → 100.00%** across 35,276 matched subsets. 22.5°, 30° and free-form all
go to 100% too. That is why designed geometry is not the enemy.

Each solve re-derives from the *current stored* neighbours and picks the value
that closes *this* vertex, so incoming error is absorbed rather than passed on.
At k=1 it is a contraction. Leave `SNAP_GRIDS_DEGREES` alone.

## What was wrong, and what it costs

### 1. k=2 is 34%, not 99.96% — and it is honest, not a bug

On real files **as stored**, k=2 is **34.32% determined** (44,949/130,980);
`known-good` alone is 28.52%; `cross.fold` is 7.36%. The previous 99.96% was true
only of the synthetic population.

**Every exception is accounted for and none is a solver miss.** 89.81% are
*both unknowns at ±180*, 5.35% collinear, 1.63% both ±90, 3.14% genuinely rank-1,
0.08% real branches.

**The ±180 case is a real mountain/valley question, not a spelling artefact.**
An earlier revision of this plan proposed identifying `+180` with `−180` before
`solve_fold_angles`' dedupe, on the grounds that they are the same rotation. That
recommendation was **wrong and is withdrawn** — it would have silently chosen
mountain-or-valley on the user's behalf, which is the exact failure this feature
exists to avoid.

The precise situation, verified on `kabuto.fold` vertex 5 (degree 6, unknowns at
lines 18 and 12, both mountains in the document):

```
verdict branching   k 2   isolated_count 2
  [-180, -180]  rank 2  isolated  resid 1.30e-14   <- the document's own state
  [ 180,  180]  rank 2  isolated  resid 1.50e-14
```

Three facts have to be held at once:

- `R(θ, +180)` and `R(θ, −180)` are the **same rotation matrix** and **opposite
  quaternions**. That is why the SO(3) solver returns both and cannot choose;
  `lifts` ([solve_fold_angles.rs:249](../crates/oristudio-cp/src/solve_fold_angles.rs))
  emits both deliberately, and the module header calls it "the single correction
  that mattered most".
- The two answers place the paper in **identical 3D positions**. Only the M/V
  labels — and therefore the layer ordering — differ.
- They are nonetheless **different crease patterns**: two mountains versus two
  valleys. `Branching` is the correct verdict, and the tool is right to ask.

Flipping *one* full-fold crease negates the closure quaternion (`q → −q`, maximal
residual), so valid alternatives always come in pairs that flip **both**. That is
also why the alternative is usually **globally** invalid: those creases run on to
other vertices, where only one of the pair is incident, so the flip breaks closure
there. This is exactly what the one-hop lookahead measured — **99.61% of
alternatives refuted** once a neighbour is consulted.

> So the recovery of determinacy comes from **global context, not from a dedupe**.
> The lookahead is not a menu-tidying nicety; it is what turns a two-answer local
> question into a one-answer global one, and it is why it is required rather than
> optional.

Two more corrections in the same area. Broken out by what the *blanked pair* is
(104,623 non-collinear k=2 subsets): both ±180 → **0.00%** determined, 90.26%
branching; both ±90 → **44.42%**; both arbitrary → **83.50%**. So **±90 is the
worst non-±180 case**, at half the arbitrary rate, and it fails as a *continuous
family* (rank 1 at truth for all 1,399), not as a branch.

And the earlier `degree ≥ 4` census filter deleted a real population: **50 real
fans are degree 2** (mid-crease points, 34 on `spikes_better` alone), 100%
underdetermined at k=2. **23.98% of real interior vertices are not degree 4**, and
no real design in this corpus is a uniform degree-4 mesh. Conditioned on the
blanked pair, degree 4 is actually the *best* common degree (94.79%) — the raw
numbers only made it look worst because degree-4 fans are 64.7% flat-folded.

### 2. Seeding needs 70–90%, not 30–40% — and contiguous seeding barely works

| seed % | previous claim | **measured on real designs** | arity share | **branching share** |
| --- | --- | --- | --- | --- |
| 5 | 6.1% | 5.2% | 84.2% | 3.4% |
| 20 | 27.6% | 25.7% | 48.4% | 17.6% |
| 30 | 51.6% | **42.7%** | 30.6% | 29.0% |
| 40 | 73.6% | **59.9%** | 17.8% | 41.1% |
| 50 | 90.0% | **75.5%** | 8.4% | 54.5% |
| 60 | 96.4% | **87.5%** | 3.5% | 66.5% |

**70–80% for 99% coverage, 80–90% for 100%, and 5 of 11 designs never reach
100%.** The "quad meshes fill 100% from 5%" claim was a Miura artefact:
`cross.fold`, the corpus's real quad mesh (381 of 400 vertices degree-4), fills
**0.2%** of unknowns at a 5% random seed.

Under *contiguous* seeding — a designer working outward from a finished region —
**90% seeded recovers 1.2%–10.2% of the remainder**. The mechanism is measured:
**93–99% of commits are k=1**, and a contiguous frontier presents k=2 (branching)
or k≥4 (refused), so the wave never peels inward. On `cross.fold` at 90%
contiguous seeding the run adds **8 creases**.

**But read every number above as a *cold-run* metric, which is the wrong success
criterion for this tool.** They measure "seed it and walk away". The actual
product is a **dialogue**: propagate, stall, the designer answers, propagate
again — and the seed is where the designer's *intent* enters, not a knob to
maximise fill. Somebody with a fold in mind does not want the seed that fills the
most creases; they want the one that produces their fold.

Measured with a user in the loop (oracle answering, 990 runs, `--budget 500`):

> **every run reaches 100% coverage with a reconstruction error of exactly
> 0.0°**, at **1.25–2.19 creases determined per interaction**, and **60% of
> interactions are the designer typing an angle** rather than choosing between
> foldings.

So the dialogue converges exactly, and coverage is never the ceiling. What the
cold-run numbers actually predict is the **interaction count**: on a 368-crease
design that is order-200 interactions from a bare seed, and scatter is what
reduces it. Scatter is advice for getting there faster, not a precondition for
the feature working.

**Two things follow, and they are Phase 0 items:**

- **The right metric is interactions-to-intended-fold, and it has never been
  measured on real designs.** The 990-run figure above is from the synthetic
  population; the re-census measured cold coverage only. Measure it before
  building the UI, because it sizes the question queue, which is the primary
  surface (§4).
- **A global solve over the frontier is the lever if the count is too high** —
  previously a non-goal. Real CPs are globally *over*determined (`spikes_better`
  has E−3V = −97), so the information is there; vertex-at-a-time propagation
  discards the coupling and spends a user interaction recovering it. This is now
  a scoping decision rather than a deferred idea.

### 3. The branch picker's legibility premise is false

All four load-bearing claims were wrong, and the fourth is what the interaction
rests on:

| | previous claim | measured |
| --- | --- | --- |
| min separation | never under 20°; closest 32.64° | **0.000136°**; 767 of 85,453 pairs ≤ 20° |
| differ in M/V | 99.8% | **96.73%** — and **every one of the 212 pairs closer than 5° is M/V-identical** |
| answer count | "the whole range is 2–5" | **6** answers at 4 triples |

The 32.64° figure came from `self-intersecting-vertex.fold` — a **rejected** debug
fixture.

There are **two distinct situations** the synthetic population could not separate,
and only the second is a defect:

- **±180 M/V pairs — real questions with an identical folded form.** **99.89% of
  k=2 branching verdicts and 68.11% of k=3.** From the picker's side: **95.7% of
  branch points (11,948/12,489) offer alternatives that are the same 3D rotation,
  p50 separation 0.000°.** These are genuine mountain-versus-valley choices (§1),
  so they must still be *offered* — but a two-up **folded** preview would show
  identical pictures ~96% of the time.

  > **Consequence for the UI: the picker must show the crease pattern's M/V
  > colouring, never a folded preview.** On flat-folded geometry the difference
  > between the two answers is not visible in 3D at all. This is also why the
  > `CP_KERNEL_DECIDED_CANDIDATE_OPERATIONS` entry is a blocker rather than
  > polish — without it the preview strokes in the active line colour and the one
  > channel that *can* show the difference is gone.

  The one-hop lookahead is what keeps the queue short: 99.61% of these
  alternatives are refuted by a single neighbour, so most resolve without a
  question ever reaching the user.
- **Genuine near-duplicates near ±180 on arbitrary-angle geometry — a real
  defect.** The closure condition is flat enough near ±180 that a ~1e-3° spread
  all clears the 1e-6° bar while the 1e-4° dedupe is too tight to collapse it.
  **206 pairs (0.24%) are sub-degree and unpickable by any presentation** — they
  must not be offered. This one *is* a dedupe-tolerance fix, and it is unrelated
  to the M/V pairs above.

Related: the slack measurement was optimistic by an order of magnitude. On
`known-good/ALL-combined.fold` the shipped `vertex_angle_solutions` returns three
rank-3 "isolated" answers spanning **1.795e-3°** — 18× the previously measured
maximum. The `SNAP_GRIDS_DEGREES` conclusion still holds (500× short of the 0.5°
danger threshold), but this is exactly the near-±180 geometry synthesis lacked.

Also uncounted: the shipped menu **omits the document's own current state** at 190
of 33,630 multi-answer menus, 76 of them by more than 10° — 10% of menus on
`byu solar driven`.

### 4. The two terminal states swap places

Previously: "every remaining stall is `underdetermined`, never `branching`".

Measured over **608,138 stall verdicts**: `over_max_k` 68.52%, `underdetermined`
18.71%, **`branching` 12.77%** — and branching **dominates the end state**, rising
with seed density: 41.1% at 40% seed, 54.5% at 50%, 66.5% at 60%, **81.8% at 90%**.

So the branch picker is the *primary* interaction, not the rare one. The two-up
presentation, the M/V diff, and the `CP_KERNEL_DECIDED_CANDIDATE_OPERATIONS` entry
are not polish — without them the main flow is unusable.

### 5. Cost is not a per-crease constant

**0.113 → 0.446 ms/crease, rising monotonically with document size.** Absolute:
386 ms (origamisimulator, 4,782 creases), 718 ms (ALL-combined), **1.52 s**
(perf_test, 12,510 creases).

The growth is **`vertex_fan_at_with_sources` being O(segments) per pop**, not the
solver — which makes it a fixable hot spot, not a floor. The k≥4 short-circuit is
confirmed free (byte-identical commit counts on all 7 files) but buys
**1.1×–2.4×**, not the 5× previously claimed.

"Never interactive" survives and was understated. Worker, cancellation, progress.

## Approach

### The commit rule — and the guard that carries the safety

```rust
if isolated_count < solutions.len() { Underdetermined }   // <- the guard
else if solutions.len() == 1        { Determined }        // <- the commit
else                                { Branching }
```

Confirmed sound at scale (283,289 commits, truth present in every one). The
obvious-looking rewrite (`match (isolated_count, solutions.len())` with a `(1, _)`
arm) silently drops the guard, is **invisible on every committed fixture**, and
turns a stall into a menu of eight options 6e-4° apart. Write a test named after
the case, from a near-degenerate synthetic fan.

**Do not** collapse `+180` with `−180` anywhere in this path. They are the same
rotation but opposite mountain/valley, so collapsing them turns a real question
into a silent choice. See §1. The only dedupe change wanted is widening the 1e-4°
tolerance enough to absorb the sub-degree numerical near-duplicates in §3.

### The propagator

```
worklist <- interior vertices touching a free crease
while let Some(v) = pop():
    k = unknowns at v
    if k >= 4:  record Underdetermined(arity); continue     # structural, not an optimization
    solve_k(v)
    if verdict == Determined:
        commit, recording provenance (which vertex, from which knowns)
        push every vertex sharing a changed crease
    else:
        record the stall
```

The k≥4 short-circuit is a **correctness** feature, not just a saving: there are
**83 rows where `solve_k` finds nothing at all** though the truth exists by
construction (66 in one degree-8 vertex set). The blind `Underdetermined` is more
correct than solving in every one of them.

Worklist to fixpoint, never a single BFS pass. **Confluence has not been
re-measured on real designs** — see the caveats.

### Unknown is `LineColor::None` — the existing Unassigned crease

A crease is free when its colour is `LineColor::None`. That is the state the
product already calls **"Unassigned"** (`U`), and it is already wired end to end:
FOLD `U` in both directions, `.ori`/`.osf`/share codec, a palette entry, the
`--fold-unassigned` dashed grey stroke, and `Indeterminate::UnassignedCrease` in
the checker. `crease_fold_angle` returns `None` for it, which is exactly "this
crease carries no fold angle".

Using it means a crease the designer has not decided **stays** undecided across
a save and reload, and the free set needs no separate UI at all — you draw with
the Unassigned type, or select creases and set them Unassigned.

**Idempotence holds, and the mechanism matters.** Known-ness is keyed on
**colour**, not magnitude. A commit writes `LineColor::None` → `Red1`/`Blue2`
plus a magnitude, so the next run reads a real angle and treats it as known. The
canonical ±180 → `fold_magnitude: None` normalisation is irrelevant here, because
the colour already changed.

> **Rejected alternative, and the trap it hides.** Encoding free as
> `fold_magnitude: None` with the colour left alone *is* broken:
> `with_fold_magnitude` filters `is_full()` to `None`, so every commit at exactly
> ±180 would be re-read as unknown. `iguana_24` produced 57,916 commits, every
> one k=1, all lost under that encoding. An earlier revision of this plan
> generalised that objection into "unknown must be transient run state", which
> was too broad — it does not apply to the colour-keyed encoding.

**What it costs**, and two of the three are pre-existing bugs that are currently
unreachable only because the chip is hidden:

1. Unhide the chip — one line, `oristudioCpActions.ts:76`
   (`HIDDEN_LINE_TYPE_IDS`).
2. **`.cp` export silently destroys a free crease.** `line_color_to_cp_assignment`
   (`io/cp.rs:70-77`) collapses everything that is not Black0/Blue2/Red1 to `4` =
   auxiliary, and `point_line_map` (`checks.rs:1174`) skips only `Cyan3` — so a
   `.cp` round trip turns a free crease into a reference line **and deletes the
   vertex from the CAMV map**. Needs a `SUPERSET_FEATURES` entry
   (`droppedByFormats: ['cp','dxf','obj']`), a label in the closed
   `supersetFeatureLabels.ts` union, and 8 locales.
3. **The flat checker reports a false clean on a vertex with a free crease.**
   `checks.rs:298-311` counts only `Red1`/`Blue2`/`Black0` and gates the sorting
   box on `is_folding_line()`, which excludes `None` — so the vertex is scored
   *as if the crease were not there*. Minimum fix: report **no** flat verdict
   rather than a false clean.

Both 2 and 3 are release blockers for unhiding the chip, not follow-ups.

**One new write path.** `operations::color::set_signed_fold_angles` skips any
crease that is not already `Red1`/`Blue2` (`color.rs:419`) — a documented
invariant of the existing per-vertex tool that must not be relaxed. Add a sibling
that accepts a `LineColor::None` source. There is an identical gate at
`color.rs:387` that would otherwise disagree with it.

**And the cost cliffs stay shut.** Measured — of 95,875 determined commits whose
true angle is exactly ±180, **95,607 (99.72%) wrote back exactly ±180 → `None`**,
and **k=1 is 54,465/54,465 perfect with zero flips**. Add a one-line clamp (a
committed magnitude within one storage unit of `FULL` becomes `None`, 10× under
the acceptance bar) and a classic document stays classic.

*(Deferred by decision: a half-known crease — direction fixed, magnitude free.
Its absence means the branch UI must present full angle sets, never a direction
toggle.)*

### Defer the questions, then treat the queue as the main event

Asking eagerly costs up to 71 questions that answer themselves; a vertex that
branches mid-pass is often closed by a neighbour before the pass ends. Derive
questions by re-solving **after the fixpoint fully stalls**, and again after every
pin — without that guard the session loops forever re-asking a vertex that already
has k = 0.

But per §4 the resulting queue is the primary interaction, not an edge case.

### One-hop lookahead is required, not optional

Validated on real data: **115,490 alternatives with an interior neighbour, 99.61%
refuted** with the neighbourhood fixed, **22.54%** under a pessimistic model where
a neighbour may re-solve, and **0 of 93,262 committed answers ever struck**.

`vertex_link_verdict` is **not** a substitute — it strikes **0.622%** of options,
roughly 160× weaker, and returns `StackedLayers` on 98.02% of committed states. It
does, however, need **no full-fold exemption**: over 16,183 interior vertices
including 9,121 flat-folded ±180 ones there are **zero false positives**, and the
positive control passes (`self-intersecting-vertex.fold` → 6 of 12 struck).

### The disk precondition: real, already detected, and the fix is copy

The phenomenon is confirmed on curated third-party data. `known-good/byu solar
driven.fold` reports 0 flat violations, 0 closure failures, worst examined
residual 2.57e-12° — while **6 vertices carrying non-classic creases are silently
excused**, and recolouring its interior hexagon as hinges makes **6 closure
failures appear with a worst dual cycle of 82.8153°**. `honeycombKiri.fold` is
worse: 187 interior borders, **0 spatial vertices examined at all**, 121 of 242
declined vertices failing once examined.

**But the proposed detector was wrong, and the framing was too.**

- "Count `Black0` boundary components, refuse on more than one" refuses **28 of 85
  files** while only **7 have an interior border** — a 75% false-alarm rate,
  including 5 admitted-CLEAN files and the largest file in the corpus (65 separate
  side-by-side sheets). The other 21 are simply multi-piece documents.
- The shipped `interior_border_segments` (a `Black0` segment belonging to two
  traced faces) catches **7 of 7 and over-refuses 0**. It already ships, and
  `CheckCamv` already emits `SpatialInteriorBorder [warning]` — verified by
  execution, `CheckCamv` does **not** say clean on `byu`. `folding3d::admit`
  already returns `Refused(InteriorCut)`.

So this is **not a release blocker and not a new detector**. The gap is that the
warning says "the vertices on it are not checked" while nothing computes what
checking would find. Propagation should say what is hidden.

Also soften the global-consistency caveat further than previously planned: the
N·ε bound is ~9.4e-8° in practice on a 3,838-vertex document, not 3.2e-3°.

### Incrementality

| creases | full re-run (worst round) | from the pin | agreement |
| --- | --- | --- | --- |
| 4,512 | 403 ms | **42 ms** | identical |

**Monotone pins: 120 over 5 designs, 0 disagreements, max diff 0.0.**

**Contradicting pins are worse than previously stated: 144 pins over 6 designs,
95 (66%) disagree, worst 360°, up to 18 lines wrong from one pin.** In every
disagreeing case the naive run commits **zero** extra creases — the stale values
are already in the document, so nothing is left to re-derive them, which is
exactly why it reports nothing. Un-commit the transitive closure via the
provenance record. **This repair has never been measured on real data.**

## Affected Areas

### Blocking: tool registration fires on click

`CreasePatternPanel.tsx:1552-1573` executes a command when
`editableCp && uiStatus === 'ready' && toolSteps.length === 0 &&
!cpCommandRequiresContextApply(command)` — verified still live.
`isWholeDocumentCpCommand` only decides the active-tool slot; a
`selectionRequirement` does not save you.

The exact requirement, traced line by line: **no `toolSteps`, and at least one
settings group that is neither `line-color` nor `line-select-help`** — that is
what makes `cpCommandRequiresContextApply` (`predicates.ts:138-145`) return true
at `:1564`. The same predicate also supplies the Apply button
(`CreasePatternPanel.tsx:3239-3243`).

The settings group doubles as the `max_commit_k` control. It is **three** files,
not six — four of the named symbols live in one file, and one that was listed
(`usePersistedCpToolOptions.ts`, 38 lines of lifecycle) needs no change:

- `lib/oristudioCpToolSettings.ts` — **five** edits: the union `:10-30`,
  `OristudioCpToolOptions` `:145-176`, **`DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS`
  `:178-214` (mandatory — the options type has no optional members, so a key
  without a default is a typecheck error)**, `TOOL_SETTING_GROUPS_BY_OPERATION`
  `:309-356`, `TOOL_OPTION_KEYS_BY_GROUP` `:369-393`.
- `CpContextToolPanel.tsx` — a branch in the `CpContextToolGroup` ladder
  (`:388`–`:884`), which ends in an **unguarded `return null` at `:893`**: an
  unhandled group renders nothing, with no typecheck error.
- `lib/cpToolOptionPersistence.ts` — optional, one line in
  `PERSISTED_CP_TOOL_OPTIONS`.

The useful setting is **k≤2, not k≤3**: k=3 determines at 5.10% as shipped, so
k≤3 buys ~4pp of coverage for a solve pass over a large branching population.

**Also: a menu entry would only *arm* the tool.** `handleCpShortcutAction` and the
menu / command-palette path both funnel into the same `handleCpToolAction`, so a
menu row needs its own arm in `commands/menuActions.ts` to actually run.

### Blocking: five UI mechanisms that do not exist yet

Each was assumed reusable and is not. These are the real frontend work.

1. **There is no channel to deliver a run summary or a stall message.**
   `cpToolUnavailable` is written in exactly three places
   (`CreasePatternPanel.tsx:2204`, `:2248`, `:2289`), **all inside
   `handleWebglToolPreviewInput`**, and `:2198-2205` resets it to `null` whenever
   `points.length === 0`. A `select-apply` tool that never places a canvas point
   never populates it. The same is true of `toolNotice`. So adding codes to
   `CP_TOOL_UNAVAILABLE_CODES` **buys nothing on its own** — decide between a new
   result channel threaded into `CpContextToolPanel`, or shipping the summary and
   the stalls as `diagnostic_entries` (see 2).
2. **The diagnostics route has two catches.** `visibleEntries.ts:29-33` gates the
   command half on `isDiagnosticResultOperation` (`hudStatus.ts:39-48`), so the
   operation must be added there. And `projectSlice.ts:2278-2280` sets the active
   diagnostic to `null` for a **mutating** operation — propagation mutates, so
   entries list but never auto-focus. The unconditional primitive underneath is
   `cpCamera()?.frameModelBounds(bounds)` (`cpCameraRegistry.ts:50-52`).
3. **`CpToolOptionWindow` cannot express the branch picker.** Its whole interface
   is `{bounds, title, index, count, note?, onStep, onApply, onCancel}`
   (`toolOptionWindow.ts:49-68`) — one prose slot, no per-option data, no queue.
   Worse, **`title` is invisible on any branch**: `CpToolOptionLayer.tsx:132-159`
   renders the stepper *instead of* the title whenever `count > 1`. The layer also
   never moves the camera, and **exactly one is mounted**
   (`CreasePatternPanel.tsx:3030`) — a second tool needs a resolver. The
   descriptor has to grow, staying React-free and store-free per
   `toolOptionWindow.ts:31-38`.
4. **"Select creases → make them Unassigned" has no route, and cannot get one via
   Replace-line-type.** The four Make-M/V/E/Aux menu entries
   (`menuDefinition.ts:216-219`) do not include it, and
   `ORISTUDIO_CP_REPLACE_TARGET_LINE_TYPE_OPTIONS` derives from
   `OristudioCpCustomLineType` — a **kernel enum** (`predicates.ts:171-191`) with
   no `Unassigned` member. So Replace, Delete-by-type and the eraser filter cannot
   target it without a kernel change. A `Make Unassigned` menu entry plus its
   `menuActions.ts` arm is the door.
5. **A free crease draws SOLID grey on the WebGL canvas.** The dashed
   `--fold-unassigned` style (`theme.css:7032-7036`) is SVG-only; the panel
   renders `CreasePatternWebglCanvas`, whose dash comes from
   `cpLineStyleDashSlot`, and `cpLineStyleColorKind('None')` → `'other'` →
   `SOLID_DASH_SLOT` under every style. SVG/PNG *export* does dash it. If dashed
   on canvas is wanted, that is a new dash slot.

   Related: a preview segment that is still `LineColor::None` carries **no
   crease** at all — `isFoldingCrease` is `Red1 || Blue2` only
   (`lib/foldAngle.ts:44-46`) — so the dry-run preview cannot show "still
   unassigned" through the preview channel even after the allow-list entry.

### Blocking: the preview allow-list

`toolPreviewSegments.ts:36` gates crease carriage on
`CP_KERNEL_DECIDED_CANDIDATE_OPERATIONS`. Without an entry, every preview segment
strokes in the **active line colour** — and since the branch choice is visible
only in M/V colouring on flat-folded geometry, the picker becomes unreadable.

### Cancellation is a real change

`execute_cp_command` calls `with_session_mut` directly and never `with_fold`, so a
`run_id` in the payload binds nothing; Tauri's `cp_execute_command` uses `run(...)`.
Adding exports breaks two lockstep contracts: `NATIVE_CP_COMMAND_NAMES` parity
(`cp_engine.rs:620-657`) and `OristudioCpWorkerApi` mirrored by
`oristudioCpNativeClient.ts:264-277`. The frontend Stop machinery is **fold-typed**
— `OristudioCpFoldRunKind` is a closed union of seven fold verbs — so budget a new
run kind. The CP worker's `thread_local SESSION` means a 1.5 s propagation blocks
every other CP call.

### Registration gates that fail CI

`ORISTUDIO_CP_SOURCE_MAP_OPERATION_IDS` (the operation-id union is *derived* from
it); `oristudioCpCommands.test.ts:16-22` set-equality; `:294-301` **pinned literal**
native-op list; `inputModelRegistry.test.ts`; `engine/oristudioCpTypes.ts`
(hand-written, not generated); `cpVocab.gen.test.ts` + 8 locales + `i18n:stamp`;
**`CP_TOOL_UNAVAILABLE_CODES`** — a closed union where an unrecognised code
returns `null` and the UI says *nothing at all*; and the `errors:<code>` i18n gate.

### Kernel

- The module must live **inside** `oristudio-cp`: `crease_quat`, `closure_product`,
  the `quat_*` helpers, `jacobian_rank` and `is_interior_vertex` are all
  `pub(crate)`, and `solve_fold_angles`' internals are private `fn`.
- **A new fan constructor.** `vertex_fan_at_with_sources` **drops** a
  `LineColor::None` crease and flags `UnassignedCrease` (`checks_spatial.rs:770-780`)
  — right for a checker, wrong for a solver, since omitting it changes the closure
  product. Unknown ≠ unassigned. It is also the **cost hot spot** (§5), so build
  an index rather than rescanning segments per pop.
- The public path is hardcoded to 3 — `fan_positions` returns `[usize; 3]` and
  `AngleSolution.creases` is `[(usize, f64); 3]`.
- **`operations/native/`** per `PORTING.md:313-338`. **No oracle exists and none is
  needed** — Oriedita has no equivalent and there is no registry-driven CP
  oracle sweep. Validation is a recorded-answer fixture corpus.

### The three cost mechanisms — measured, and mostly retired

All three are **document-wide cliffs tripped by one non-classic crease**, each a
single OR over `line_segments`. So the measurement that matters is *one* crease:

| | one crease flipped | every crease distinct |
| --- | --- | --- |
| share codec | +0.1%–0.7% on designs ≥2,000 seg | **1.45× p50, 3.48× max** |
| compact transport | **+7.8%** | +7.8% |
| `CheckCamv` / `check4` | **4.74× → 33.5×** | 5.96× → 32.3× |

- **The share-codec fear does not survive.** Real distinct-magnitude counts are
  tiny — **p50 of 1 per design, max 12, 26.5 creases per distinct value** — so the
  delta-varint alphabet cannot degenerate. Even the adversarial state is 1.45×,
  never the 10× previously claimed; the realistic ULP-smear state is 1.03×.
- **The transport cost is real but proportionally small**: +7.8% of the compact
  payload, confirmed exactly (`ALL-combined` 467,718 → 504,366 = 9,162 × 4).
- **`CheckCamv` is the one real cost, and it is paid for nothing.** `ALL-combined`
  goes 5.88 → 26.58 ms with **0 spatial vertices examined**. `dispatched_camv_in`
  gates `ThroughLineIndex::build` *and* a full arrangement trace on a
  document-wide boolean, so one crease reinstates the whole bill the early-out
  exists to avoid. Build both lazily on first spatial vertex instead.
- **And the propagator does not trip the cliff on a classic document** (99.72% of
  ±180 commits write back `None`; k=1 is perfect). With the one-unit clamp, this
  is closed.

Separately worth filing: **3 of 14 real designs ≥400 segments already exceed the
committed 8× bound in `spatial_check_cost.rs` as authored** (`spikes_better` 8.49×,
`cant_fold` 8.47×, `hex head 2` 8.30×).

### Two repo bugs found on the way

- `crates/oristudio-cp/examples/fold3d_census.rs` hard-codes
  `/workspace/documents/0/creasePattern/foldProjection`, so it sees **8 of 22**
  corpus `.osf` files and silently misses every schema-8 file — including the
  largest (`perf_test.osf`, 15,950 segments).
- `interior_border_segments` returns `[]` when `faces` is empty, so a zero there
  means "did not look". Vacuous on 21 of 85 files; 7 of those carry a
  bbox-nested `Black0`. All 7 are excluded files, so the exposure is bounded.
- **`PORTING.md:328-331` is factually wrong about this feature's own file.** It
  says three originals "still live in ported modules", naming
  `VertexSolveFoldAngles` — but `solve_fold_angles.rs` is 1,563 lines with **no
  Oriedita counterpart at all** (`rg -i quaternion` over the Java source returns
  zero hits). It is a native module, like `folding3d/`. Two-line documentation
  fix, worth doing before Phase 1 generalises that exact file.
- `CheckCamv`'s descriptor (`lib.rs:1392-1399`) targets `checks::check_camv_task`
  and is marked `OracleTested`, but the operation actually dispatches
  `checks_spatial::dispatched_camv` plus two native diagnostics
  (`lib.rs:2614-2627`). `descriptor!`'s `target` is an unresolved `&'static str`,
  so nothing catches it. Labelling defect, and Phase 3 makes it staler.

### Panel caps — one of them has zero headroom

| file | counted | cap | headroom |
| --- | --- | --- | --- |
| `CpContextToolPanel.tsx` | **1171** | 1171 | **0** |
| `CreasePatternPanel.tsx` | 2710 | 2752 | 42 |

`maxLines` skips blanks and comments, so `wc -l` (1,288 and 3,369) is **not** the
count. The settings-group branch lands in `CpContextToolPanel.tsx`, so **raising
that cap is unavoidable** — `eslint.config.js:269-273` already records it as the
known "next feature trips it" case. Put hooks, catalog and executor under
`cp-workspace/foldPropagation/`; raise both caps with the reason in the PR.
No panel `keydown` listener.

## Checklist

### Phase 0 — the product decision, and bootstrap

- [ ] **Measure interactions-to-intended-fold on real designs.** The only figure
      that exists (1.25–2.19 creases per interaction, 100% coverage, 0.0° error)
      is from the synthetic population; the re-census measured cold coverage
      only. This sizes the question queue, which is the primary UI surface, and
      it is the metric that decides whether the dialogue is pleasant or a slog.
- [ ] **Then decide on the global frontier solve.** If the interaction count is
      high, it is the lever — real CPs are globally overdetermined, so
      vertex-at-a-time propagation is spending user interactions to recover
      coupling it already has.
- [ ] `scripts/setup-worktree.sh`.
- [ ] *(Phase 0 cost measurement is done — see above. No further work.)*

### Phase 1 — the k-unknown solver

- [ ] `operations/native/` module; visibility bumps.
- [ ] Fan constructor with three states (known ρ / unknown ρ / not a crease),
      **indexed** rather than O(segments) per lookup.
- [ ] `solve_k` for any k, with the k=1/k=2 closed forms and the k=2 parallel-axes
      arm (two unknowns collinear through the vertex is a 1-parameter family).
- [ ] **A test asserting `+180` and `−180` both survive as separate answers** at a
      full-fold k=2 vertex, and that the verdict is `Branching` — they are the
      same rotation but opposite M/V, and collapsing them is a silent choice.
      Repro: `kabuto.fold` vertex 5, unknowns 18,12 → `[-180,-180]` and
      `[180,180]`, both rank 2, both isolated.
- [ ] Widen the dedupe tolerance enough to absorb the sub-degree numerical
      near-duplicates (§3), **without** touching the ±180 pair above.
- [ ] The commit rule **with its guard**, plus a near-degenerate-fan test.
- [ ] Pin as **two** tests: **100% at k=1 on real files**, and ≥99.9% at k=2 on a
      *regenerated generic-3D* population. Do not pin k=2 ≥ 99.9% against real
      files — it is 28.52% on `known-good`.

### Phase 2 — the propagator

- [ ] Worklist to fixpoint; k≥4 short-circuit (structural, and a correctness
      feature).
- [ ] Per-crease provenance; transitive-closure invalidation for contradicting
      pins. **Measure it against a from-scratch run** — never done.
- [ ] Deferred question derivation, with the re-solve guard after every pin.
- [ ] **One-hop lookahead** filtering the menu (required, not optional).
- [ ] Report what `interior_border_segments` hides, rather than adding a second
      gate. **Do not** count `Black0` components.
- [ ] The one-storage-unit `FULL → None` clamp on write-back.
- [ ] A sibling of `set_signed_fold_angles` that accepts a `LineColor::None`
      source. Do **not** relax the `Red1|Blue2` gate at `color.rs:419`, and note
      the identical gate at `:387`.
- [ ] A cancelled run leaves the document byte-identical.
- [ ] `cargo fmt --check`, `clippy -D warnings`, `cargo test --workspace`. Update
      `PORTING.md`.

### Phase 3 — the two blockers, before the Unassigned chip is reachable

Both are pre-existing bugs, currently unreachable only because the chip is hidden.
Unhiding it makes them user-authored paths.

- [ ] **Flat checker false clean.** A vertex with an incident `LineColor::None`
      must report *no* flat verdict rather than a clean one (`checks.rs:298-311`).
      Do **not** fix this by widening the `spatial_vertex_reports` early-out
      without a new cost test — the committed one covers no unassigned crease, so
      it stays green while every `U`-carrying document pays on each edit.
- [ ] **`.cp` / `.dxf` / `.obj` superset-loss entry** for unassigned creases:
      `SUPERSET_FEATURES`, a label in the closed `supersetFeatureLabels.ts`
      union (a missing arm fails typecheck), 8 locales.
- [ ] Only then: unhide the chip (`oristudioCpActions.ts:76`); confirm draw,
      select, recolour, save/reload round-trip on a real CP.

### Phase 3b — transport and cancellation

- [ ] Bind a cancel handle in `execute_cp_command` and `cp_execute_command`, or add
      exports and update both lockstep lists.
- [ ] New `OristudioCpFoldRunKind`; progress past a few hundred creases.
- [ ] Make `CheckCamv` build `ThroughLineIndex` and the arrangement lazily.
- [ ] Rebuild the bridge — behaviour changes without the glue changing:

```bash
npm --workspace @treemaker/web run build:oristudio-cp-wasm
```

### Phase 4 — registration and UI

- [ ] **Decide the result-delivery channel first** (blocker 1 above): a new
      channel threaded into `CpContextToolPanel`, or `diagnostic_entries` +
      `isDiagnosticResultOperation`. Nothing in Steps 4–9 of the UX works until
      this exists.
- [ ] Settings group (three files, five edits — including
      `DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS`); **verify it does not fire on rail
      click**. Default `max_commit_k = 2`. Apply label needs a fourth arm — it
      currently falls through to "Apply to selection".
- [ ] Command identity: `ORISTUDIO_CP_SOURCE_MAP_OPERATION_IDS`, a `ready(...)`
      entry, `CP_KERNEL_DECIDED_CANDIDATE_OPERATIONS`, the rail action, and the
      **pinned native-op literal** in `oristudioCpCommands.test.ts:294-301`
      (sorted position). Plus `inputModelRegistry.ts` and the hand-written
      `engine/oristudioCpTypes.ts`.
- [ ] `oristudioCpActions.test.ts:36-47` — **two** assertions break on unhiding
      the chip (`shown` and `hidden`); `:22-35` and `:48-53` self-adjust.
- [ ] **Extend the `CpToolOptionWindow` descriptor** for per-option data, and
      resolve the singular `CpToolOptionLayer` mount. Note `title` is hidden
      whenever `count > 1`.
- [ ] `Make Unassigned` menu entry **plus** its `menuActions.ts` arm.
- [ ] `cp-workspace/foldPropagation/`: dry-run review, **the question queue as the
      primary surface**, two-up picker with M/V diff, pin-and-resume. Copy the
      three non-obvious mechanics from `useVertexSolve.ts` — the `latest` ref, the
      `documentVersion` invalidation (line ids are indices), the request-id guard.
- [ ] Suppress sub-degree menu options entirely; always include the document's own
      current state as an option (the shipped menu omits it at 190 of 33,630).
- [ ] A fourth HUD tone for **"unexamined"** — `hudStatus.ts:35` is
      `'ok' | 'warn' | 'error'` and a question is none of them.
- [ ] Decide whether a free crease should draw dashed on canvas (a new dash slot)
      or solid grey (free).
- [ ] Undo keyed on the decision, localized label — and note `projectMessage` has
      **no renderer at all** (`GlobalToasts.tsx:56-59` clears it without
      rendering), so a surface is missing for every undo in the app.
- [ ] `i18n:extract` → 8 locales → `i18n:stamp` → `i18n:check`.
      **Analytics needs no change** — `projectSlice.ts:2246` already fires
      `cp tool used` for every CP operation; do not double-instrument.
- [ ] Raise **both** panel caps with the reason in the PR
      (`CpContextToolPanel.tsx` is at zero headroom).

### Phase 5 — validation

- [ ] Recorded-answer fixture corpus with a README.
- [ ] Coverage curve asserted against **the measured real-design numbers above**,
      not the previous synthetic ones.
- [ ] **Confluence on real designs** — same fixpoint from 10 seed vertices. Never
      measured; the 583 orderings were synthetic.
- [ ] Degree-2 fans (mid-crease points) through the shipped propagator.
- [ ] `npm run lint:web`, `typecheck:web`, `test:web`; `check:desktop`;
      browser-verify seed → propagate → answer a branch → pin → undo.

## Non-goals

1. **Enumerating whole-CP solutions.**
2. **A half-known crease** — deferred by decision.
3. **Committing at k ≥ 4.**
4. **A `Black0`-component gate** — 75% false alarm; the shipped interior-border
   test is already correct.
5. **`vertex_link_verdict` as a menu filter** — 0.622% strike rate, 160× weaker
   than one-hop lookahead. (It needs no full-fold exemption, contrary to the
   earlier revision, but it is near-inert.)
6. ~~A global solve over the frontier~~ — **promoted to a Phase 0 decision.** The
   seed-density complaint the non-goal said to wait for is measured.

## Still untested — act on these

1. **n = 1 for curated third-party arbitrary-angle work** (`byu solar driven`),
   and it is singular rather than typical. 89% of arbitrary-angle vertices come
   from one owner-authored fixture.
2. **Every timing is native release aarch64. No wasm number exists.**
3. **Nothing measured at 52,000 segments** — the largest real file is 15,950.
   Transport extrapolates exactly; `CheckCamv` does not.
4. **Confluence never re-measured on real designs.**
5. **The contradicting-pin repair was never run** — only the naive path, which is
   unsound 66% of the time.
6. **Enumeration completeness has no bound.** 147 rows returned `branching` with
   the truth **absent** from the reported set. All are currently harmless because
   the rule refuses `branching` — but nobody has measured how often the
   enumeration could return exactly *one* wrong isolated solution, which is the
   only path to a wrong commit that the 283,289-for-283,289 record does not cover.
   Repro: `3d-fold/perf_test.osf`, vertex 2213, degree 7, unknowns [0,5], truth
   `[−33.1654484, 180.0]` — `solve_k` returns four rank-2 solutions, none of them
   the truth.
7. **C5's no-compounding conclusion rests on 578 independent cycle checks** against
   10,051 commits. The depth-bucketed error is the large sample; the cycle
   residuals are not.
8. **The 82.8° `byu` holonomy depends on one completion of the geometry.** What is
   not hypothetical: 6 vertices go unexamined and 6 fail once examined.
