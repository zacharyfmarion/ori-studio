# Mixed grid and image evidence follow-up

## Protocol

Follow-up to S070, retaining its frozen 285/421 complete-graph matches at 1e-9
and 276/421 at 1e-12. Real patterns remain evaluation only. Halberd Knight has
no GT; geometry/image/wireframe checks must not be called reference equality.
Keep all prior constraints, AUX graph semantics, and the shared browser 25s
deadline. No merge or publication. Artifacts start at S074 and remain separate
from the completed September 16 archive.

## S074 — Image-evidence diagnostic

The solver's construction score does not resample the source pixels. Sampled
same-assignment segment distances from S070 to reference, normalized to a
1024-wide sheet, give 22 remaining cases within 0.5 pixels, 27 between 0.5 and
1, 43 between 1 and 2, and 32 over 2 (maximum 9.995). Twelve more have no AUX
edges where reference AUX exists. This is a sparse geometric diagnostic, not
an ink score or proof that the source image resolves the differences. Neither
the earlier nonuniqueness witnesses nor search plateau establishes a ceiling.
Artifacts: `artifacts/cp-solver/S074-image-evidence-diagnostic/`.

## S075 — Knight reproduction and grid failure

Current baseline source: 9ad0d530; frozen S070 binary. The corrected OSF hash
still matches S020. Its saved graph has 1,664 vertices and 3,662 spans. Baseline
adopts the 96-grid with 1,550 locked vertices, but leaves 223 edges between
1e-5 and 5 degrees away from a multiple of 22.5. Some are intentional non-family
creases; the count is diagnostic, not a correctness verdict.

Fresh actual browser recognition from the user-supplied 1332x881 source with
manual corners (11,10), (869,10), (869,868), (11,868) again gives 1,664 vertices.
Recognition takes 12.76s. Auto crop gives (12,10)–(868,866), confirming the small
inset reported by the user. The manual crop is a reproduction choice based on
visible boundary pixels, not GT calibration.

Fresh recognition runs at 2048. The partial-grid test allows 1.5/1984 paper
width noise: only 83.35% of coordinates fit the 96-grid, below its 95% gate.
At 3/1984, 95.79% fit. Enlarging the same source has unintentionally tightened
the image-space allowance. Baseline then accepts the angle-projection fallback
in 13.90s, with only 89.72% of coordinates precisely on the 96-grid.

Metadata ablation (`image_size: null`) detects the correct grid and locks 1,552
vertices; its internal proposal reports solved but original-request rejudgment
rejects it. This is being traced separately. No product change yet. Initial
browser harness accidentally used the old embedded 1240x1240 project image;
it failed before producing a result and was corrected to the supplied source.
Artifacts: `artifacts/cp-solver/S075-knight-grid/`.

## S076 — Consistent proposal rejudgment

The rejected grid proposal passes Kawasaki and CAMV but rejudgment reports a
0.001290 carrier residual. Projection used numerical carrier grouping, whereas
`judge_original` rebuilt coarse 0.01-radian/0.0025-paper-width observation bins.
Those bins merge distinct nearby lines. Use the same numerical grouping for
completed proposals and refit carriers through their coordinates, preserving
explicit source carrier IDs and original pins/movement limits. A native full
431-case replay is in progress; exploratory timings overlap diagnostics/builds
and are not final browser performance evidence.

## S077 — Direct source-image scoring

Read all 421 frozen source images; score fixed S070 predictions and references
against blurred color evidence along non-border segments. No proposals or
training use references. Estimate a common crop adjustment from neutral border
ink alone, never from either answer. With cached crops, reference scores better
on 70/136 misses, worse on 62, and ties within 1e-5 on four. With border-center
alignment, it scores better on 114, worse on 17, ties on five. This demonstrates
remaining image evidence but is not an exact-recovery gain or a deployment-ready
score. Missing AUX and differing segment subdivisions can affect a length-mean
score; it is not a recall metric. Near-perfect graph pairs differ in this score
by up to 1.24e-5 due to sampling/subdivision, so near ties need caution.

All case computations completed; summary serialization initially failed on a
NumPy integer after writing `cases.json`. Counts were recomputed from that saved
file after fixing serialization; no cases were rerun or omitted.

## S078–S079 — Grid endpoints before angle hypotheses

S078 tries family directions before the unconstrained projection on a partial
grid. It fails on the fresh Knight. Diagnosis: two edges have both endpoints
locked on the 96-grid and slope 2/5 (21.8014 degrees). They are legitimate
non-22.5 geometry but fall inside the 1.5-degree family hypothesis window.
The attempted exact 22.5 constraint cannot hold without moving a fixed endpoint.
S079 skips a proposed family constraint when both endpoints are already fixed;
their stated coordinates determine the line. Tests in progress. This is a
general consistency rule, not a Knight-specific coordinate or grid constant.

## S080–S082 — Main grid directions and border centers

Inferring every nearby 22.5-degree edge remained inconsistent even after
respecting fixed endpoints. On partial-grid proposals, try horizontal, vertical,
and 45-degree directions first; allow nonlinear folding relations to determine
the other creases. S080 straightens the main grid. Source-only neutral-ink
measurement puts the border near (11,10)–(869,867), one pixel above the first
manual reproduction's bottom. S082 recognizes the same 1,664 vertices and
3,662 edges with those centered corners.

S081 fits local colored stroke cross-sections independently of the solver.
Its first weakly regularized vertex fit moves some vertices 0.0288 paper widths
and is rejected. Stronger observation regularization and exact elimination of
fixed axes bound that to 0.00233. This experimental fitter is not integrated;
its retained per-line measurements provide independent image diagnostics.

## S083 — Broader proposal replay (not selected)

Normalize the construction proposal's noise floor to at most 1024 samples per
paper width, preserve explicit pins, and use the partial-grid direction-first
projection for recognition as well as document inputs. The centered fresh
Knight solves in 5.074s native. The full 431-case replay finds 421 local
successes under 25s, but complete-graph recovery stays 285/421 at 1e-9 and
276/421 at 1e-12: Ant and Honeybee improve, while Alice Margatroid and Platynus
Livens regress. Do not select this broad replacement. Wider inlier bands and
projection-first solving can displace a valid tight-grid repair.

S076's narrower rejudgment correction completed with 286/421 at 1e-9 and
277/421 at 1e-12, one gain (Ant), no losses, and no falsely solved defective
controls. These native runs overlap exploratory diagnostics; final browser
performance must be measured separately.

## S084–S085 — Actual browser and crop follow-up

Build the actual detector WASM and recognize/solve the supplied source. Automatic
border centering gives (10.996,9.990)–(869.007,867.012); recognition takes 14.16s,
solve 9.10s. Manual centered corners take 12.25s recognition and 6.49s solve.
Both retain all 1,664 vertices / 3,662 edges and select the 96-grid, locking
1,554 non-corner vertices. Independent image fits identify 2,147 reliably
horizontal/vertical/45-degree edges; none remains skewed (maximum 1.83e-14 rad).
Native folded wireframes retain all points/lines and show aligned large outlines.
These are local geometry and wireframe checks, not GT or layer-order proofs.

Critically, a close source overlay still exposes a small construction displaced
by about three source pixels. Main-grid success alone is insufficient to call
Knight correct. Short spans at an off-grid crossing have several degrees of
angle noise; the 1.5-degree direction window misses their straight continuations.
Continue investigating this before handoff.

The crop refinement only centers an already selected, strongly supported dark
neutral outline, within two pixels per side. It does not search for another
panel or change a manual crop. All 209 external source images run without errors;
123 change at rounded-pixel reporting precision, maximum rounded corner change
sqrt(5) pixels. No crop GT exists; this is a bounded-change diagnostic. All 162
detector unit tests pass, including generated neutral/colored outline tests.

## S086–S088 — Preserve tight-grid successes; short-span angle noise

S086 widens the global angle-family tolerance on Knight and separately validates
an explicitly grid-locked proposal. Neither is yet a product change. S087 restores
the tight-grid proposal's original solver order and only tries the broader
resolution-independent proposal after failure. Full exact replay is running.
S088 tests a wider direction window only within that additional partial-grid
proposal, addressing the short crossing spans without changing the ordinary
solver. All binaries and source patches are frozen before each experiment.

Synthetic regression tests now cover enlarged-image grid invariance and pins,
rejudging distinct nearby parallel lines, retaining explicit source-carrier
constraints, and honoring fixed non-family endpoints. All 243 compiler tests
pass (one existing ignored test).

S087 completes with **287/421 at 1e-9 and 278/421 at 1e-12**, two gains and no
losses versus S070. All 421 clean cases solve within 25s; the ten defective
controls remain rejected. Only five benchmark inputs enter the added broader
proposal path (selected from execution reports, not from GT).

S088's 5-degree partial-grid window corrects the short crossing construction.
S090 bounds that allowance by span length: at most atan(3/1024 / length), capped
at five degrees, with the ordinary narrow window retained for long segments.
The Knight coordinates agree between these variants. S089 is invalid: an
untyped numeric literal failed compilation and a non-fail-fast shell sequence
copied the preceding executable. Its artifacts are explicitly marked invalid;
S090 rebuilds with fail-fast and is the valid experiment.

## S091–S092 — Grid evidence for one coordinate

The corrected directions expose a further issue: a long vertical crease may
have two off-grid junctions, each with a grid x-coordinate but a non-grid
y-coordinate. Whole-vertex locking does not anchor that crease's x-coordinate.
For example a Knight line at x=21/96 remained at x=0.21869739 after S090.

S091 fixes every near-grid coordinate independently, but the hypothesis is too
broad: some unrelated construction coordinates merely happen to lie nearby.
Knight's proposal is rejected and falls back to the earlier ungridded solution.
Retain this failed experiment; do not select it.

S092 requires additional evidence for each independent coordinate: a long
horizontal/vertical crease, near the narrow observed angle window, with both
endpoints supporting the same grid coordinate. Hold those coordinates during
projection while leaving their other coordinates free. Explicit pins remain
unchanged. Knight adopts the 96-grid in 6.175s native, and the example line now
lies at exactly x=21/96. A generated crossing test verifies that x is recovered
without inventing a grid value for an underdetermined y, and that a user pin
still wins. Full browser validation follows after targeted replay of all five
benchmark paths affected by this additional proposal.

S092's five affected benchmark paths keep S087's exact-match outcomes. On the
fresh Knight graph, all 1,409 long source-supported axis-aligned grid spans have
zero coordinate error against their inferred grid positions. All 2,147 reliably
measurable grid directions remain exact to floating-point precision, with all
1,664 points / 3,662 edges / 1,999 folded-wireframe faces retained. Image scoring
rises from 0.547802 (S084) to 0.548073 (S092); the inspected short-construction
region's worst fitted-line endpoint discrepancy falls from 3.36 to 0.95 pixels.
That image discrepancy is a diagnostic of raster alignment, never the GT metric.

S094 checks the earlier saved OSF graph as well. Its older recognition/crop
coordinates differ from the fresh source reproduction. Giving its existing
partial-grid proposal the new structured projection does not improve the result:
that projection falls back and the final coordinates are identical. Revert the
experimental document-path change. The old graph still has two source-supported
long grid spans off-grid by up to 0.000528 paper widths. Do not claim that existing
saved recognition graphs are all fixed; the fresh recognition uses the corrected
crop and is the verified Knight result in this follow-up. Keep the before/after
outputs to make this limitation explicit.

## S093 — Selected browser validation

The complete actual-browser replay confirms **287/421 at 1e-9**, **278/421 at
1e-12**, literal 0/421, two gains (Ant and Honeybee), no lost matches. All 421
clean cases complete within 25s: maximum 24.547s, median 0.372s, p95 9.022s on
an Apple M1 Max. All ten assignment-defect controls remain unsolved. This replay
runs without concurrent builds or diagnostic solves and includes worker startup.

The real product `runCpExactSolve` entry point, after fresh automatic crop and
recognition, solves Knight in 8.894s; rectification/recognition takes 11.961s.
The input is byte-identical to S084's auto-crop input. The output preserves every
vertex, edge and assignment, reports zero local angle/degree/BLB violations, and
passes the independent 2,147-direction and 1,409-grid-coordinate checks. Maximum
coordinate error is 2.78e-17 paper width; maximum angular error 5.33e-15 radians.
The folded wireframe has the expected 1,664 points / 3,662 lines / 1,999 faces.
This verifies the fresh-recognition path, without claiming unavailable GT or
repair of the older saved graph described in S094.

Workspace validation: 2,215 tests pass, seven existing ignored; clippy and fmt
pass. The first S092 clippy run requested an iterator instead of an index loop;
the behavior-preserving correction is frozen in S093. The normal production
web build (with WASM and prerender hooks) and 32 exact-solve frontend tests pass
on Node 22. Local model assets verify against the existing pointer. No model,
registry, external GPU resource, or production deployment changes.

The final visual comparison uses S070 and S093 on the byte-identical fresh
recognition input. `S093-browser-validation/knight/knight-before-after.png` shows
the two folded wireframes at the same scale and a paper-space construction
close-up without exaggerating offsets. The largest vertex correction is
0.0043147 paper width (about 3.7 source pixels). The rendering script and both
wireframes are retained beside it. This is an observed correction, not GT error.
