# Knight document repair and crop follow-up

This is a reproduction without ground truth, not a new reference benchmark or
training example. Use the corrected `boice_knight_correct.osf` and the supplied
Halberd Knight reference image. S017 and S019 used files the user subsequently
identified as wrong; their conclusions do not apply to this reproduction.
The original files remain unchanged and outside Git. All generated geometry,
images, hashes, and diagnostic programs are in ignored artifacts.

## S020: reproduce both failures

Load the corrected project through the CP WASM importer/exporter and rebuild
the whole-region solve input as the editor does. It contains 1,664 vertices and
3,662 spans. Rebuilding produces `image_size: null`, even though the original
recognition attachment had raster metadata. The partial-lattice proposal used
`input.image_size?`, silently disabling this proposal for document repair.
The unconstrained fallback passes the local checks while retaining small
coordinate errors that accumulate into visibly skewed folded geometry.

The 96-cell lattice has 91.23% coordinate support at 1.5/1024 and 95.85% at
2/1024. A finer lattice cannot safely explain the remaining construction
points. Retain those as unknowns rather than forcing the whole design onto one
grid. This is inferred from the noisy input, not from reference coordinates.

The supplied 1332×881 reference image also reproduces the crop failure: the
baseline selects approximately `(173,188)–(868,866)` rather than the paper at
`(12,10)–(868,866)`. The top and left border peaks rank below the 12 strongest
axis candidates. The actual boundary therefore never reaches square scoring.

## S021: rejected broad solver proposal

Give metadata-free inputs the same 1024-unit scale used elsewhere in the
solver, allow a second 2px proposal band, and try sparse coordinate projection
before ordinary polishing on a mostly locked grid. Knight improves, but the
complete 431-case native recognition replay loses **four** previous numerical
reference recoveries: Alice Margatroid, Arowana, Black Rock, and Origami.
Local success remains 421/421 on the assignment-correct gate, illustrating why
that metric cannot select a recovery algorithm. Full-graph reference agreement
at 1e-9 falls from 178 to 174. Lucanus Bright also loses its old 2px near-match.
Reject the broad projection-first change. No result is removed from the ledger.

## S025: document-specific repair

Keep the existing recognition path, proposal band, and polishing order.
For document inputs without raster metadata only, enable partial-lattice repair
using the existing 1024-unit movement scale. Try the original 1.5px proposal
band first, then 2px if no supported lattice exists. These are proposal windows,
not reference-scoring tolerances. Retain the 95% support requirement, coarsest
grid selection, fixed pins and corners, movement checks against the original
input, and the shared 25-second deadline.

A mostly locked document proposal first gets at most half its remaining
proposal budget (capped at 2.5s) for sparse projection; ordinary polishing can
use the rest. Knight locks 1,550 vertices to the inferred 96-cell lattice,
leaves the other construction geometry free, and passes the unchanged acceptance
checks. Three actual browser worker runs, including startup and export, take
2.110s, 2.046s, and 2.051s. No topology or assignment is changed.

The CP kernel's native `estimate_wireframe_from_segments`, fed the actual browser
worker export, confirms that the long arm and halberd outlines become aligned.
Both before/after outputs have 1,664 points,
3,662 lines, and 1,999 faces. This checks the folded wireframe, not a valid
layer ordering or equality to unavailable GT. An earlier WASM Order2 attempt
was stopped after exceeding a minute; it was not counted as validation.
The native and browser solver exports have identical topology but differ by up
to 6.54e-8 paper widths at free construction points; do not present native output
as byte-identical to browser output. The comparison figure uses the original
WASM export and the final actual browser-worker export.

Synthetic regressions cover a small document with no raster metadata and an
independently generated 32-cell grid with 1,089 vertices / 2,112 edges. The
latter asserts literal equality to every generated reference coordinate after
solving, not merely alignment to some grid or a small theorem residual.

## S022–S024: rejected crop proposals

Replay all 209 images in the external `real` source tree. These are observed,
unlabeled crop diagnostics, not a blind or GT recovery benchmark.

- S022 adds the outermost two projection peaks. Knight improves, but background
  grids and neighboring illustrations can enlarge the crop incorrectly.
- S023 restricts extras to outermost dark neutral lines. The outline of the
  folded figure beside Rooted still wins. Reject.
- S024 ranks dark extras by line coverage. Fifteen crops change; Rooted and
  Armadillo Girdled Lizard still choose part of the neighboring illustration.
  Reject this version too.

## S026: bounded candidates with outline evidence

Retain the original 12 strong candidates and add at most two dark neutral
line candidates per upright axis. A quad using an additional candidate must
have edge evidence along at least 90% of **each** side; a neighboring figure's
isolated vertical outline cannot justify a square across blank background.
Rotated search and original candidates retain their previous behavior.

On the same 209 sources, 14 crops change and 195 are unchanged. Visual inspection
finds larger coverage of the paper in the changed cases; Knight now selects its
full square. Some existing failures remain: Rooted is unchanged and still
inset; Armadillo and Sword Dragon Plate Armor Assassin improve but remain
inset. Do not describe this as perfect cropping. A generated dense-pleat fixture
with weaker black borders and an exterior pale grid covers the reported defect.

## Validation and limits

The narrow solver restores the four numerical-reference regressions and the
Lucanus near-match. S025 replays all 431 recognized inputs in the browser:
421/421 assignment-correct inputs pass locally, with a maximum of 20.612s.
Reference recovery remains 0/421 at literal equality, 38/421 at 1e-12, and
178/421 including AUX at 1e-9 paper width, with no per-case changes at those
thresholds. At 1e-6 the count changes from 182 to 181: Maid no longer fits
that allowance. Its unchanged primary solver takes 19.7s instead of 17.2s and
skips late polishing under its stage budget. This is a timing-sensitive
near-match change, not an additional exact-recovery regression or a success.

The new document path can be reached on 36 old repaired-topology cases. Replay
all 36: 35 pass locally as before (maximum 13.892s); the same invalid graph
remains rejected. Of these, 27 have reference files and 26 match at 1e-9, with
no reference gains or losses. The other document cases return from the unchanged
primary solver before the new path. None of these 36 proposals is fully fixed.

## S027–S028: independently generated large document grids

Use fresh fixed seeds to generate noisy 32-, 64-, and 96-cell grids, with known
coordinates and valid assignments. The solver reads only the noisy inputs.
S027 recovers all coordinates literally for the first two (0.487s and 4.631s
in the browser), but the 9,409-vertex / 18,624-edge grid fails at 28.969s.
Its inferred 96-cell grid was correct; the 2.5s projection slice expired during
validation of the fully fixed proposal, sending it into an unnecessary search.
Retain that failure in the evidence.

S028 gives a fully fixed **document** proposal up to 10s, still capped at half
the remaining global budget. It spends this on checking the one placement;
ordinary polishing cannot help if every coordinate is fixed. Proposals with
free construction points retain the S025 policy. Recognition and the 36
repaired-topology cases above do not take this new branch.

Final browser results, including worker startup and export:

| Generated input | Vertices / edges | Seconds | Maximum coordinate difference from reference |
| --- | ---: | ---: | ---: |
| 32-cell grid | 1,089 / 2,112 | 0.474 | 0 (literal equality) |
| 64-cell grid | 4,225 / 8,320 | 4.492 | 0 (literal equality) |
| 96-cell grid | 9,409 / 18,624 | 21.297 | 3.93e-17 paper widths |

All edges and assignments agree exactly. Do not call the final row literal
floating-point equality; the native export does match literally, while the
browser's exported frame differs at roundoff scale. The final build also repeats
Knight three times (2.140s, 2.077s, 2.008s) and restores all four numerical
reference regressions in the five-case browser check. Knight still has no GT.
The crop fixes its square in the browser in 1.402s.

Workspace tests pass (2,190 tests, seven existing ignored); the final budget
delta passes all affected compiler/detect/WASM tests (409 tests, three ignored),
workspace clippy, formatting, and the rebuilt detection WASM. The audit has six
independent synthetic tests. No TS/UI API changed; the actual worker replays
cover the browser integration. Desktop packaging and additional port oracles
are not needed for these original solver/crop changes; the separate CI repair
already passed configured Oriedita parity and replacement remote CI.

The exact-GT objective remains open;
see `exact-recovery-audit.md`. No real-pattern training, cloud resources, model
publication, or merge is involved. Existing desktop builds continue using
their bundled solver; no shared model registry or model schema changes here.
