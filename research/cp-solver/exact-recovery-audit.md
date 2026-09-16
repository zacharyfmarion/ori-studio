# Exact coordinate recovery audit — S018

The user's goal is exact reference recovery. S000–S016 instead selected for
local constraint satisfaction and reported reference agreement within 2px.
That was the wrong primary outcome. The goal has not been reached.

The S015 saved browser predictions on **421 recognition outputs with clean
physical topology and assignments** score as follows. Every counted recovery
also passed the existing solve acceptance checks within 25 seconds.

| Coordinate allowance, fraction of paper width | Physical graph | Complete graph including AUX |
| --- | ---: | ---: |
| Literal floating-point equality, 0 | 0/421 | 0/421 |
| 1e-12 | 38/421 | 38/421 |
| 1e-9 (numerical precision audit) | 179/421 | **178/421 (42.3%)** |
| 1e-6 | 184/421 | 182/421 |
| 2/1024 (old 2px allowance) | 387/421 | 378/421 |

Thus even with a tiny numerical allowance, exact recovery is far below the goal.
The frozen S000 baseline recovered **177/421** complete graphs at 1e-9; S015
recovers **178/421**, one gain and no losses. The much larger gain in locally
valid solves therefore translated to only one additional numerical reference
recovery on this gate, not the fifteen suggested by the old near-match metric.
Literal equality is reported rather than silently equated with numerical
agreement. Decimal serialization and coordinate transforms can change final
floating-point bits. A 1e-9-paper-width comparison is an explicitly stated
numerical criterion, not proof of symbolic equality. It is about 1.95 million
times tighter than the old 2px allowance on a 1024-wide paper.

The S025 browser replay preserves every result at literal equality, 1e-12,
1e-9, and 2px. Its 1e-6 counts are one lower (183 physical / 181 with AUX)
because Maid's primary solver skips late polishing under its time budget.
See `knight-followup.md`; do not hide this sensitivity or describe the old
1e-6 count as the latest result.

The broader recognition set has 431 cases: the ten with incompatible
assignments/degree constraints remain visible and do not count as successes.
The 421-case gate was selected by the existing topology/assignment benchmark,
not by the new coordinate results.

## Why the repaired-topology results were misleading

Of 526 reference-scored repaired-topology inputs, **505 have the exact same
SHA256 as truth.fold**. This is a useful preservation check but not evidence of
recovering coordinates from image recognition. Complete-graph numerical recovery
there is 470/526 at 1e-9 paper width, including 467/505 already-exact inputs.
This also exposes unwanted movement or rejection of some exact inputs. The
earlier 494/526 figure was a 2px near-match result and must not be called exact
recovery. The recognition-output gate is the appropriate recovery measure.

## Audit method and validation

`scripts/cp-detect/research/audit_exact_recovery.py` reopens the frozen exported
browser predictions and the hashed reference FOLDs, after all solving is done.
It never feeds truth to solving. It removes translation and uses one paper-width
scale for both axes; it does not round, snap, fit a rotation, or independently
stretch axes to improve agreement. The old boundary-role metadata is omitted
consistently on both sides because the audit compares the CP assignments.

The existing strict graph evaluator requires all vertices and edges to match
and all assignments to agree. It canonicalizes redundant straight-line splits
using the same numerical tolerance as vertex matching. Physical-only and
AUX-inclusive results are separate. Unused isolated vertices are excluded.
Missing predictions and unsuccessful/over-budget solves remain failures.

Six synthetic audit tests pass: coordinate-unit changes preserve identity;
literal equality accepts identical coordinates and rejects a 1e-15 displacement;
subpixel displacement fails the exact criterion while passing 2px; AUX errors
fail the complete-graph score; assignment errors fail; and aspect-ratio errors
are not normalized away. Generated files and full per-case diagnostics are in
ignored `artifacts/cp-solver/S018-exact-audit/`. Input, script and evaluator
hashes are recorded in each audit's protocol.

No real CP was added to training. The user's corrected Knight file has no GT and
is a separate structural reproduction, not a new reference benchmark case. The
private Alligator CP remains excluded. No merge or production publication has
been performed.
