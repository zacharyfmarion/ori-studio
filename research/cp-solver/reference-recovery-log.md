# Reference recovery follow-up — September 16, 2026

## Contract

The user merged #387 and requested substantial improvement of the complete-graph
1e-9 and 1e-12 metrics, continuing until further recoveries appear limited by
underdefinition. The 25-second browser budget and all prior privacy/training,
AUX, compatibility, and no-merge constraints remain in force.

Start: branch `codex/cp-exact-recovery` from `origin/main` at `9fe341cd9`.
The solver baseline is merged #387, implementation commit `9949a81b`.
Saved browser S025 outputs establish 178/421 at 1e-9, 38/421 at 1e-12, and
0/421 literal equality. S028 only changed fully fixed document proposal timing;
its branch-coverage audit confirms it does not change this recognition gate.

## S029 — Freeze and diagnose

Baseline binary/WASM and hashed manifest saved under ignored S029 artifacts.
Reused immutable recognition requests and reference hashes. Initial nearest-point
diagnostics require care: redundant collinear splits in GT are intentionally
dissolved by the official graph metric. Raw reverse nearest-vertex distances
therefore overstate some geometry errors. Official graph scores remain primary.

## S030 — Exact linear direction projection

Independent Python/SciPy prototype projects the existing solution onto its
already-near-exact 22.5-degree direction equations and square boundary. No new
reference geometry or arbitrary rational rounding. Development gate (330):
1e-9 rises 142 to 144; 1e-12 rises 32 to 82, no losses. Product acceptance and
browser integration remain outstanding. This establishes a real numerical floor
in the soft carrier-incidence formulation, not just an underdefinition limit.

## S031 — Bounded construction dictionary

Generate `(p + q sqrt(2))/r` with integer coefficient height
`abs(p)+abs(q)+r <= 16`; 408 values in [0,1]. Snap coordinates within 0.0005
paper width, retaining the proposal only when the existing exact direction
equations remain satisfied. This initial linear-only test gains four and loses
two primary matches relative to S030. Both losses violate nonlinear origami
constraints and are rejected by the unchanged product checker with candidate
coordinates fixed. Full post-check scoring is in progress. This negative result
is retained: a direction-only acceptance test is insufficient.

Next test: propagate simple coordinate anchors through unconstrained linear
degrees of freedom, rather than requiring each coordinate to be independently
close to an entry in the same small dictionary.

S031 after product checking: **148/330 at 1e-9, 91/330 at 1e-12**, no losses
against S030 at either threshold. This is an offline fixed-coordinate check, not
yet the final combined browser budget or original-request movement check.

## S032 — Propagate free-coordinate constructions

Sparse Gaussian elimination of direction equations, snapping free coordinates
and back-substituting the dependent ones. Gains 23 primary matches but loses 17
relative to checked S031. All 17 losses came from overwriting existing exact
rational coordinates with nearby surds absent from the small dictionary (15
were complete grids). Local origami checks correctly accept these alternate
geometries: a locally valid proposal is still insufficient evidence to replace
a simpler existing construction. Rejected as a production policy.

## S033–S034 — Preserve existing constructions; compose proposals

Preserve already-rational free coordinates (denominator <=256, discrepancy
<1e-9); close the dictionary under reflection in the paper edge. S033 raises
the development primary score to 171 with no primary losses. Its one secondary
loss came from replacing an earlier successful S031 coordinate refinement with
an S030-derived proposal. S034 composes from the currently accepted S031 output:
**171/330 primary and 123/330 secondary**. Record individual losses, not just net
counts; validation and per-case JSONs are retained in ignored artifacts.

## S035 — Rust precision integration

In progress. Adds an explicitly selectable construction-recovery option (off by
default during research), following full-graph reconstruction so AUX junctions
participate. Uses sparse LSQR with tighter relative stopping for the precise
linear correction, then rejudges against the original request. Original solver
projection retains its existing tolerances. Shares the full solve deadline,
pins, assignments and movement limit. Four generated tests pass: anchored
intersection recovery, a protected pin, non-family geometry, and an expired
deadline. Native development replay running; browser validation remains pending.

## S036 — Choose independent construction anchors

In progress. Instead of accepting whichever variables elimination happened to
leave free, test simple coordinates anywhere in the graph and add only those
that independently constrain it. Rank candidates by their distance to the
observed solution; preserve already-exact rationals. No truth is consulted.
Linear nullity is diagnostic only: other nonlinear constraints can determine
those variables, so it is not a theoretical recovery ceiling.

S036 reached 186/330 primary and 136/330 secondary, but lost two primary matches:
the original coordinates were already accurate higher-complexity surds. The
small hypothesis dictionary did not contain them, just as S032's small dictionary
missed existing rational values. Again, foldability alone did not protect them.

## S037 — Preserve known exact surds

Protect coordinates already within 1e-9 of a construction of height <=64
(42,230 generated values), in addition to rationals. The wider dictionary is
only a near-exact preservation guard; new hypotheses still use height 16.
**188/330 primary and 136/330 secondary**, no losses against S034 at either
threshold. Relative to merged baseline this is +46 primary and +104 secondary.

## S038 — Rust construction integration

Native development replay running. Sparse elimination, protected existing
constructions, and independent anchors now live in shared Rust, followed by
the original-request acceptance checks. Product default remains off while
research continues. Seven focused generated tests pass. Proposal clocks reserve
time for validation rather than consuming the final available millisecond.

## S039 — Algebraic precision

After checked S037, only round to an already-identified height-64 construction
when the discrepancy is <=1e-9, retaining the direction constraints and checking
the product verdict. **188/330 primary, 159/330 secondary**, no losses against
S037. These are offline development results, not the final browser counts.

## S040 — Richer construction hypotheses

In progress. Height-24 independent anchors from the S030 linear output, with
the same known-construction preservation guard. This is an alternate global
policy, not per-case selection using truth. Evaluate whether the richer prior
adds reliable information or simply chooses different underdetermined solutions.

No cloud resources created. No real CP training. No private Alligator data used.

## Completed integration replays: S035 and S038

S035 native: **144/330 primary, 81/330 secondary**, preserving every baseline
match. All 330 valid cases accepted, all nine assignment controls remain
failures, maximum native time 20.32s. The Python prototype's additional secondary
match (Girl 4) did not transfer; keep implementation-specific counts.

S038 native: **190/330 primary, 111/330 secondary**, no losses against merged
baseline. All 330 valid cases accepted, nine invalid controls remain failures,
max native 20.32s. Elimination order/roundoff changes which constructions are
inferred relative to Python. Offline proposal counts are not shipping counts.

S040 completed: **177/330 primary, 102/330 secondary**. Compared with S037 it
gains 11 primary cases but loses 22; it also loses one merged baseline match
(Horse 2011). That design has exact 11.25-degree directions omitted from the
initial 22.5-only linear model, creating spurious freedom. Reject this global
replacement policy; preserve finer known directions and compose proposals.

## S041–S043, S045 — Preserve finer directions and held symmetry

Union of recognized 22.5, 11.25, and 15-degree directions: S041 linear precision
scores **144/89** (primary/secondary). Height-24 independent anchors from there
(S042) score **183/113**. Adding already-held reflection equations gives S043
linear precision **144/91**, followed by S045 anchors **183/117**. These facts
come from the current solution, not truth. Their importance is avoiding false
degrees of freedom; a richer dictionary alone cannot supply that guarantee.
These direction/symmetry equations are now in the selectable Rust recovery path.

## S044 — Can the solver accept the references themselves?

Separate diagnostic only: lock every reference vertex and pin it against
degree-two normalization; disable recovery/fallback/polish and run existing
checks. **327/330 accepted**, three import errors caused by reference self-edges
(Lucanus Bright, Frigate Bird, Halibut). Those errors are not evidence that the
three cases are unrecoverable: the official scorer canonicalizes segmentation.
Canonical paper-corner normalization moves at most 1.654e-11 of paper width;
only three inputs move more than 1e-12. Consequently checker/reference conflict
does not explain the primary-metric failures. No reference coordinates enter
any inference experiment. Raw diagnostic inputs/results remain ignored.

## S046 — Strongly supported rational grids

After S039, propose the coarsest grid (2..512 cells) for which >=95% of
coordinates are already within 1e-9, at least eight distinct coordinates support
it, and remaining displacements are <=5e-4. Keep direction equations and apply
product checks. **188/161**, no losses: two secondary gains, no primary gain.
Not yet integrated into Rust.

## S047 — Updated Rust replay

In progress, frozen binary/source in `S047-rust-extended`: algebraic precision,
finer directions, and held symmetry. Same 339 development inputs and original
25-second full-call limit; native replay precedes actual browser measurement.

## S048 — Seed arbitrary carrier lines from exact endpoints

Join collinear opposite rays into carriers; two independently recognized exact
points determine the line even when its direction is outside the angle families.
Propagate its equations through all graph vertices, including AUX junctions.
After S046 plus product checking: **188/169**, no primary gain. This supports
precision recovery but is insufficient to resolve missing construction choices.

## S049 — Sequential richer constructions

Start from S048, preserve fine directions and held symmetry, then infer
height-24 independent anchors while protecting known coordinates. Checked
result: **194/330 primary, 184/330 secondary**, six primary and 15 secondary
gains with zero losses against S048. These are offline proposal results, not
combined browser timing. This avoids broad replacement losses seen in S040.

## S050 — Nonlinear geometric precision

In progress: sparse Newton correction of Kawasaki equations with exact direction,
boundary, and already-identified coordinate constraints. Analytic angle Jacobian
checked against central differences on generated geometry; exact square fan has
zero residual. Test whether non-family directions are numerically unresolved
rather than underdetermined. Candidates still require product checks.

## S051 — Wider anchor search band

In progress: after S049, allow height-16 anchor hypotheses within .002 paper
width rather than .0005, keeping the same known-coordinate preservation guard.
This is a falsifiable global policy; record individual losses as well as gains.
No changes to the reference metric or product acceptance tolerances.

S050 completed: **187/173** versus S048's 188/169. Four secondary gains but
one primary loss (Stork and Stand), no primary gains. Reject the nonlinear
polish policy for now; tighter local equations do not establish correct recovery.
S051 completed: **195/185**, one gain at both thresholds (Baby Penguin), zero
losses against S049. Wider proposal band alone has small marginal benefit.

S047 completed: **200/330 primary, 176/330 secondary**. Against the merged
baseline: +58 primary/+144 secondary, no losses. Against S038: +10/+65, no
losses. 330 valid cases accepted, nine invalid controls rejected, max native
20.42s (includes concurrent local work; not a browser timing claim).

## S052, S054 — Broader dictionaries

S052 height-32 anchors after S051: **195/185**, unchanged. S054 adds sqrt(3)
and sqrt(5) expressions after S051: **195/185**, unchanged. A limitation of this
sequential protection policy is that an earlier incorrect but exact construction
is then preserved. Absence of gains is not evidence that the reference constants
are outside the dictionary, or that the cases are mathematically impossible.

## S053 — Explicit ambiguity witnesses

Diagnostic only, never a recovery step. Hold every existing edge direction
constant, fix boundary-normal coordinates and every already-recognized exact
coordinate. Project a deterministic random vector onto the linear null space;
scale the remaining displacement to 1e-5 paper width, with equation residual
<=1e-13. Out of 35 proposed alternatives, 27 pass unchanged local product checks;
all 27 are valid-gate cases still failing primary reference recovery. This
proves nonuniqueness of these constraints in those cases, but is **not** a
universal recovery ceiling: additional construction priors or image information
can still distinguish alternatives. Rejected witness candidates are retained.

## S055 — Full-set Rust sequential replay

In progress, all 431 frozen recognition cases (421 valid plus ten controls).
Adds supported-grid precision, seeded carrier equations, richer and wider
anchors after the S047 stages, and final algebraic precision. Ten generated
Rust tests pass, including end-to-end AUX-junction propagation, exact rational
preservation, and arbitrary-angle carrier precision. Current source rebuilt to
WASM. Product recovery default is still off until full browser validation.

## S056 — Joint construction simplicity

In progress. The nearest free-coordinate hypothesis can make the overall graph
more complicated (e.g. a simple value on one free coordinate leads to many
higher-complexity derived coordinates). Starting from S043's precision output,
score candidate anchors by expression complexity across the whole graph plus
a soft observation-distance term. Preserve existing exact coordinates and
original direction/symmetry equations. Dictionary and costs are generated from
bounded integer expressions, never learned from real patterns. Product checking
is still required. This is an alternative global policy, not truth-based
per-case selection among experiments.

S055 full native replay: **247/421 primary, 235/421 secondary**, 421 accepted
within 25s, ten invalid controls remain failures, max 20.74s. Against baseline:
70 primary gains / one loss (Chicken, on the previously observed holdout); 197
secondary gains / zero losses. Development: 203/193; previously observed holdout:
44/42. Do not present this candidate as regression-free.

## S061 — Broader exact-construction preservation

Chicken's original accepted coordinates were already accurate, but include
higher-complexity Q(sqrt(2)) values beyond the height-64 preservation dictionary.
Free-coordinate snapping replaced them with simpler nearby values. Broaden the
preservation dictionary to height 128, retaining the original small proposal
prior. Optimize dictionary generation by restricting integer loops to valid
coefficient ranges. A generated high-complexity free-cross test passes; Chicken
now matches at **both 1e-9 and 1e-12**. Full replay of the changed guard is still
required. This is a general protection rule, not a case dispatch or copied CP.

S056 completed: **201/127**, no merged baseline losses. Compared with S047 it
gains 11 primary cases but loses ten. A weak observation prior lets simplicity
pull some points several pixels from the image-derived geometry.

## S057–S060 — Observation likelihood and rational constructions

S057 adds rational denominators <=64 independently of the small surd-expression
height bound; sqrt(3) hypotheses require at least two exclusively 15-degree
family edges. Result **204/128**. The old height prior excluded common fractions
such as 1/32 despite their ordinary geometric construction.

S058 increases the squared-displacement weight from .05 to 2 for a .002-wide
search band (equivalent Gaussian scale .001 paper widths). **223/145**, no
merged-baseline losses; versus S055 development, 24 primary gains/four losses.
S059 composes algebraic precision, supported grids and seeded carriers after
S058: **224/213**. These remain offline proposal counts; fixed-coordinate
validation time is not the integrated product budget.

S060 increases the observation weight to 8 (equivalent scale .0005): **226/148**,
no merged-baseline losses; versus S058, five primary gains/two losses. Choosing
one globally applicable objective is required; no reference-based per-case
selection is allowed. Source snapshots record each objective exactly.

## S062 — Include nonlinear conditions while selecting anchors

In progress: add the linearized Kawasaki equations to the anchor basis, then
apply nonlinear refinement after proposing coordinates. This tests whether
non-family geometry can be determined once a few construction anchors are
chosen, rather than rejecting the entire proposal because it needs nonlinear
propagation. Every candidate still passes the independent product checker.

S062 completed: **224/206**. Against S060 it gains seven primary cases and loses
nine. Five gains are cases where S060's linear proposal failed product checking
(Chinchilla, Dragon Bowl, Elephant PD, Longhorn Cowfish, Rabbit). Therefore test
nonlinear propagation only as a fallback after a rejected linear proposal,
rather than replacing accepted results globally.

## S063 — Rust joint objective and browser replay

In progress. Generated rational/surd catalog, observation weight 8, known-value
preservation widened to height 128 for sqrt(2) plus height 64 for sqrt(3), and
joint anchors before the sequential recovery stages. Fourteen generated tests
pass, including full user-pin preservation, 11.25-degree equations, and held
symmetry. Affected clippy checks pass; local toolchain emits the pre-existing
unknown-lint warning for `clippy::chunks_exact_to_as_chunks`. Full native then
browser replay is queued sequentially, with frozen binary/source/WASM evidence.
The product still does not enable recovery by default while this is evaluated.

## S064 — Reference angle precision bound

For each reference edge within 1e-6 radians of the assumed angle families,
compute its signed normal residual R. Exact enforcement of that direction
requires moving at least one endpoint by R/2. Only **one of 421** references
exceeds the primary 1e-9 allowance under these assumptions; 18 exceed 1e-12.
This is a bound conditional on those angle assumptions, not a universal ceiling
and not permission to drop cases. Reference rounding does not explain most of
the remaining primary failures.

S063 full native replay completed: **280/421 primary, 268/421 secondary**,
**102 primary gains and 230 secondary gains with zero merged-baseline losses**.
All 421 valid cases accepted, all ten assignment controls remain failures,
maximum native 22.72s. Against S055 there are 34 gains/one loss at both
thresholds (Slug Girl). This is still a candidate comparison; the browser replay
is running. Timing-sensitive policies must be measured in the actual worker.

## S065 — Rust nonlinear fallback

Run the nonlinear construction basis only after the initial joint proposal
fails original-request checking. Keep direction/symmetry/boundary equations and
known coordinate anchors, then sparse Newton-correct Kawasaki. Fifteen focused
tests passed after checking the analytic angle Jacobian away from its absolute-
residual cusp; an additional generated nonlinear-intersection test is pending.
All five targeted development cases recover at both thresholds in Rust (0.07–
0.57s total native solve). These targeted results do not substitute for a full
regression replay. Shared fan construction is reused from the existing sparse
projection implementation; the original projection behavior is unchanged.

## S066 — Relative construction hypotheses

In progress: infer simple coordinate differences along existing edges as well
as coordinates measured from the paper edge. This tests constructions whose
individual coordinates look complicated but whose separations are simple.
Score the resulting graph and edge components together with the observation
penalty, protecting already-known exact coordinates. Same frozen development
inputs, no truth read during proposal selection, separate fixed-coordinate
checks and scoring. The source snapshot freezes all imported proposal modules.

S063 complete browser replay confirms **280/421 at 1e-9 and 268/421 at 1e-12**,
zero merged-baseline losses at either threshold, 421 valid cases accepted and
ten assignment controls remain unsolved. Maximum worker-inclusive time **23.935580s**
(Aknosom); next slowest 23.20s, 21.41s, 20.71s. Literal equality remains zero.
Native and browser counts agree.

S065 now has sixteen passing focused tests, including a generated nonlinear
intersection and an analytic-Jacobian finite-difference check.

S066 completed **230/147** on development. Relative to S060, ten primary gains
and six losses; relative to S063 development, ten gains and nine losses. Only
one gain follows a rejected joint proposal; others replace valid alternatives.
Do not integrate this mixed-result heuristic.

## S068 — Bounded beam search

Keep four construction alternatives instead of committing immediately to one
anchor. Four seconds per proposal; validate alternatives in objective order
without reading truth. This tests search truncation versus an ambiguous prior.
Proposal generation complete; independent validation/scoring running.

## S069 — Final integrated candidate replay

Freeze the S063 implementation plus S065 nonlinear fallback. Rebuild detection
WASM and replay all 431 frozen cases natively, then in actual browser workers.
No new training or model assets. Product activation remains pending the checks.

S068 completed **228/150** development: two primary gains/no losses versus S060,
but one gain is already covered by nonlinear fallback. Against composed S063,
three gains/four losses. Do not replace the selected search with the beam.
The remaining gain from alternative search is Skeleton Head; its greedy choice
is locally valid, so checker-only fallback cannot identify it.

## S070 — Protect dependent exact coordinates

S068 comparison exposed a general consistency defect: free-coordinate snapping
protected only the free coordinates themselves. Back-substitution could move an
already-exact dependent coordinate. Add all recognized coordinates as equations
before choosing free coordinates. A generated two-variable regression protects
a rational dependent coordinate from an arbitrary-coefficient free direction.
S069 remains an immutable before-fix replay; validate this change separately.

Control terminology clarification: “rejected” in the running ledger means not
automatically accepted as a completed solve. S063 has seven `ambiguous` controls
whose movement-report `accepted` flag is true and three `failed` controls.
The UI requires both that flag and `status == solved`; none of the ten qualify.
The final comparison reports statuses explicitly rather than using that flag
alone. This does not change any of the 421-case counts.

S069 native replay completed **285/421 at 1e-9, 276/421 at 1e-12**, literal
equality zero. Against merged baseline: +107/+238 with zero losses. All 421
valid cases accepted within 25s; maximum 24.477s. No controls become solved.
Development counts 233/226, observed holdout 52/50. S070's seventeen focused
Rust tests pass, including dependent-coordinate preservation.

S069 versus S063: six primary gains/one loss (Wizard), nine secondary gains/one
loss (also Wizard). Record this research-to-research regression even though no
merged-baseline match is lost. The nonlinear proposal can select an admissible
alternative rather than the author's geometry.

## S067 — Independent generated construction checks

Generate 24 rational/surd crosses with AUX subdivisions, small coherent noise,
all four square rotations and randomly permuted vertex IDs (seed 763019). Eight
additional continuous-coordinate controls start without noise and expose how
the construction prior changes underdefined geometry. Their positions are not
uniquely determined by folding constraints, so do not mislabel this as a
uniqueness test or as an unbiased estimate of real-world recognition accuracy.
The generator reads no real data. Native/browser replay is queued after S070.

## S071 — Product entry-point regression checks

The shared frontend enables `construction_recovery: constructions` whenever it
enables recognition fallback (recognition and whole-region solve). Keep the
Rust API default off for callers that do not request this policy. Both native
desktop and browser transports use the same parser/compiler; existing desktop
bundles and model registries are unaffected. Exercise `runCpExactSolve` itself
on three procedural grids (1,089 / 4,225 / 9,409 vertices), the corrected Knight
(no GT), and six generated AUX crosses. Full browser timing includes startup.
No new analytics event: the existing solve flow already captures its outcome.

S070 full native replay: **285/421 primary, 276/421 secondary**, no merged
baseline losses, all 421 valid cases accepted within 25s (maximum 24.477s).
Compared with S069, gains Sweetfish and loses Squid (Xiao Dai) at both thresholds;
net zero. Retain the protection because it enforces the stated invariant rather
than silently overwriting an exact dependent coordinate. Development 234/227;
observed holdout 51/49. Actual browser replay is in progress.

S070 **full browser replay confirms 285/421 at 1e-9 and 276/421 at 1e-12**,
zero merged-baseline losses, literal equality zero. All 421 valid cases accepted
within 25s; no controls become solved. Worker-inclusive maximum **24.550985s**,
median .371970s, p95 9.372895s. Native and browser per-threshold counts agree.
The queued procedural wrapper reached its waiting limit before this replay
finished; restart it against the same frozen candidate. This is orchestration,
not a timed solver failure; no case run or result was discarded.

S067 completed in native and browser: 32/32 locally solved; **20/24** perturbed
construction cases recover at both 1e-9 and 1e-12. All four 11/32 crosses select
the nearby simpler value 6 - 4sqrt(2), exposing the prior's bias. All eight
continuous controls move (maximum displacement about .000231 paper width),
as expected for an explicitly underdefined construction prior; they do not
recover their unchanged input. Rotations and shuffled IDs produce consistent
success/failure groups. Do not report this as 32/32 reference recovery.

S071 product route: all ten cases solve within 25s. Procedural grids take .461s,
3.944s, 18.262s for 1,089 / 4,225 / 9,409 vertices; all three complete graphs
match truth at 1e-12 and 1e-9. Corrected Knight takes 9.200s, no GT and therefore
no exact-reference claim. Six generated AUX cases take .061–.067s.

## S073 — Stronger observation prior

Fresh synthetic failures motivate one final global observation-weight check:
32 instead of 8, same generated catalog, held geometry, frozen development
inputs, product checker and independent scoring. No per-case selection or
reference-informed proposal. This offline proposal run overlaps repository
validation, so its timings are not product timing evidence. S070 remains the
frozen, fully browser-measured candidate until this comparison completes.

S073 completed **225/148** development, versus S060's 226/148: five primary
gains/six losses, three secondary gains/three losses. Reject the stronger global
observation weight. It addresses one type of synthetic ambiguity but trades
away other reference recoveries. This supports an empirical plateau for these
priors, not a universal theoretical ceiling. Product remains S070.

## S072 — Delivery validation

Rust workspace: 2,208 tests pass, seven pre-existing ignored tests. Workspace
clippy passes; the local toolchain reports the existing unknown
`clippy::chunks_exact_to_as_chunks` lint warning. Web lint and typecheck pass.
The initial full web run used the shell's Node 26.8.1: 591 tests fail with
`localStorage` unavailable during setup. CI specifies Node 22; rerun with the
installed Node 22.14.0 before diagnosing any product regression. Preserve the
failed log and do not change unrelated tests to accommodate this runtime.

Node 22.14.0 rerun passes **all 6,993 web tests in 559 files**. No product/test
code changes were needed for the Node 26 environment failure. Full production
build, including normal WASM and prerender hooks, is running.

All selected validation now passes: full production build with WASM/prerender
hooks, Rust format, diff check and exact-audit unit tests. Browser benchmark
source is unchanged; subsequent builds stamp the newer Git revision through
`oristudio-cp-detect/build.rs`, so build-stamp hash changes alone are not a new
algorithm. The frozen S070 binary/WASM/source remain intact for reproduction.
