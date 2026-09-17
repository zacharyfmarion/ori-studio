# Mixed-grid recognition and source-image evidence

## What was wrong

Halberd Knight exposed algorithmic gaps, not just ambiguous design information.
The reproduction uses the supplied source image, outside the benchmark and
without ground truth. Its manually centered crop recognizes 1,664 vertices and
3,662 edges, matching the fresh automatic crop after the border correction.

1. **Image enlargement tightened the grid test.** A 2048 inference tensor was
   treated as having proportionally more precise junctions, even when enlarged
   from a smaller source. Knight's 96-grid was therefore rejected. The added
   construction proposal keeps a bounded paper-relative noise floor.
2. **Proposal validation could merge distinct nearby lines.** The projection
   judged numerical collinearity, then rejudgment used coarse observation bins.
   Use numerical collinearity consistently for finished proposals, while keeping
   explicit source-line constraints and pins hard.
3. **Short crossing spans have greater angle uncertainty.** A pixel of endpoint
   error has much greater angular effect on a short span. A bounded positional
   allowance, capped at five degrees, recovers grid continuations there. Long
   spans retain the narrow ordinary angle window. Fixed endpoints take priority
   over a nearby direction hypothesis, including legitimate non-family slopes.
4. **A grid can determine only one coordinate.** A vertical grid crease ending
   at two non-grid constructions still has a known x-coordinate. Locking only
   whole vertices left that line free to drift sideways. The added proposal
   holds individually supported coordinates on long horizontal/vertical creases
   while solving the other coordinates.
5. **The crop followed the inside of the border stroke.** Centering a strongly
   supported neutral outline corrects the small inset, without selecting a
   different panel or changing a manual crop.

Successful repairs from the tighter grid proposal retain priority. Replacing
that path broadly gained two reference matches but lost two; that experiment
was rejected. The wider proposal is tried only after the tighter one fails.
All proposals retain the original topology, assignment, movement, pin, and
shared-deadline checks. No model retraining or model publication is involved.

## Benchmark protocol

Compare against S070 on the unchanged 421-case recognition-correct gate and ten
assignment-defect controls. Evaluate the complete exported graph, including AUX,
with the same numerical matching rules. No fitted alignment or rounding to GT is
allowed. References are read only by the scorer. Both development and holdout
sets were previously observed; neither is presented as blind evaluation.

S087's complete native replay reaches 287/421 at 1e-9 and 278/421 at 1e-12,
versus S070's 285 and 276, with no lost matches. The gains are Ant (development)
and Honeybee (holdout). All 421 valid inputs finish within 25 seconds and none
of the ten defective controls is declared solved. The later span/coordinate
changes affect five benchmark paths; replaying all five preserves those outcomes.
The final selected-code browser replay (S093) confirms the same exact counts and
per-case gains, with zero losses. Worker-inclusive maximum is **24.547s**, median
**0.372s**, and p95 **9.022s** on an Apple M1 Max. All 421 clean cases finish within
25 seconds; no defective control is reported solved. Literal equality is 0/421.

| Complete graph including AUX | Before (S070) | Selected browser (S093) |
| --- | ---: | ---: |
| Literal equality | 0/421 | 0/421 |
| 1e-12 paper width | 276/421 | 278/421 |
| 1e-9 paper width | 285/421 | 287/421 |

The 1.5/2-pixel input-noise allowances are proposal-generation settings. They
are not reference-scoring tolerances. Literal coordinate equality remains a
separate reported measurement.

## Knight checks and limits

For the fresh source recognition, the selected native proposal finds the
96-grid and solves in 6.175 seconds. Independent image-line fits identify 2,147
reliably horizontal, vertical, or 45-degree segments; none remains skewed.
All 1,409 long source-supported horizontal/vertical grid spans lie at their
inferred grid coordinate with zero measured coordinate error. The folded
wireframe preserves 1,664 points, 3,662 lines, and 1,999 faces, with aligned long
outlines. These are geometry and wireframe checks, not a layer-order proof or
comparison to unavailable GT.

An inspected short construction was still about three source pixels displaced
after the initial grid-only fix. Accounting for short-span angle noise reduces
the worst fitted-line endpoint discrepancy in that region from 3.36 to 0.95
pixels. Source-ink scoring also improves after the individual-coordinate fix.
Raster-fit distances are diagnostics and must not be confused with exact GT
recovery.

The older saved OSF's recognition coordinates are different. Its existing solve
still has two supported long grid spans off-grid by up to 0.000528 paper widths;
an experimental document-path change does not improve it and is not selected.
Fresh recognition is necessary to pick up the corrected crop. This report does
not claim that every previously saved recognition graph is repaired.

The crop replay covers 209 external source images, with no errors. Rounded
reported corners change on 123; the largest rounded corner shift is sqrt(5)
pixels. This is an unlabeled bounded-change check, not a claim of perfect crops.

## Answer scoring against the ink

S077 samples color evidence from the original source along fixed candidate and
reference segments. Both use the same image-derived border registration; no GT
enters the crop or candidate generation. With the original crops, scoring favors
GT in only 70 of the 136 remaining misses. Centering the border raises that to
114, but missing AUX and sampling differences make that count too optimistic
as a selection claim.

After excluding 12 cases whose predicted graphs omit reference AUX, and treating
score differences up to 1e-4 as ties (larger than the observed subdivision noise),
the 124 comparable misses break down as follows:

| Which answer has stronger ink evidence? | Cases |
| --- | ---: |
| Reference | 99 |
| Existing solution | 5 |
| Near tie | 20 |

This is useful additional evidence, not 99 recovered cases: the solver has not
necessarily generated those reference answers. The color heuristic is also less
informative on monochrome drawings and does not measure missing-edge recall.
Keep it as a diagnostic for now, rather than making it the sole product answer
selector. The image-fitting prototype and rejected attempts remain reproducible
in the experiment artifacts.

## Validation and evidence

- Seven generated regression tests cover scale consistency, pins, close parallel
  lines, explicit source-line constraints, fixed non-family endpoints, short
  crossings, individual grid coordinates, and border centering.
- Workspace tests: 2,215 passed, seven existing ignored tests. Workspace clippy
  and formatting pass. The normal web production build (including WASM and
  landing prerender) and 32 focused exact-solve frontend tests pass on Node 22.
- Full 431-case selected-code browser replay and exact audit pass as above.
  The actual `runCpExactSolve` product entry point solves fresh, automatically
  cropped Knight recognition in **8.894s** (recognition/rectification **11.961s**).
  It reports zero angle, odd-degree, or big-little-big violations. All vertices,
  edges, and assignments are retained. The 1,409 supported grid spans have
  maximum coordinate discrepancy **2.78e-17** paper width; the 2,147 measured
  grid directions have maximum angular discrepancy **5.33e-15** radians.
- No public schema, model asset, registry, or desktop download contract changes.
  Existing desktop bundles retain their current behavior until updated.
- No RunPod resources, real-pattern training, private Alligator validation
  case, model publication, merge, or production deployment.

See [the experiment notebook](grid-image-recovery-log.md) for S074–S094,
including rejected regressions and the explicitly invalid S089 build. The
selected implementation is S092 plus a behavior-preserving lint correction;
S093 freezes the source and WASM for browser validation.
