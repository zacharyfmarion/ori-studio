# Oriedita

The crease-pattern editing kernel, and the bulk of Ori Studio's functionality.
The highest-stakes of the four upstreams: a silent divergence here affects every
CP the app touches.

| | |
| --- | --- |
| Repo | `https://github.com/oriedita/oriedita` |
| Branch | `master` |
| Our code | `crates/oristudio-cp` |
| Vendored at | `third_party/oriedita/` |
| Manifest key | `oriedita` |
| Oracle | `tools/oriedita-oracle/build_geometry_oracle.sh` |

## Watch paths

```
origami/src/main/
oriedita-data/src/main/java/oriedita/editor/save/
oriedita-data/src/main/java/oriedita/editor/export/
```

Nothing outside these matters. In particular `oriedita-ui/` is out of scope
entirely — we have our own frontend, and it is where the overwhelming majority
of upstream churn lands.

## Port map

| Upstream | Ours |
| --- | --- |
| `origami/src/main/java/origami/Epsilon.java` | `crates/oristudio-cp/src/geometry/epsilon.rs` |
| `origami/src/main/java/origami/crease_pattern/` | `crates/oristudio-cp/src/geometry/` |
| `origami/src/main/java/origami/crease_pattern/worker/foldlineset/` | `crates/oristudio-cp/src/checks_spatial.rs`, `src/folding/` |
| `oriedita-data/.../editor/save/` | `crates/oristudio-cp/src/io/` |
| `oriedita-data/.../editor/export/` | `crates/oristudio-cp/src/io/` |

## Highest risk for this upstream: tolerance constants

`origami/src/main/java/origami/Epsilon.java` is a table of constants that every
geometric predicate in the kernel reads. A change of a single character there
shifts behavior across the whole editor, compiles cleanly, and produces no test
failure that names the cause.

This has happened. `0d86df23` ("Further increase point precision", 2025-02-05)
did three things in 33 lines:

- halved `Epsilon.POINT` from `factor * 0.05` to `factor * 0.025`
- renamed `calculateArea(Face)` to `isNonDegenerated(Face)` with identical
  semantics — a pure refactor sitting in the same commit as a behavioral change
- loosened the Euler characteristic check from a hard `return false` to
  `Math.abs(euler - 1) > 0.005 * numFaces`, with the comment *"For now we allow
  a small error here, just so that we can fold Ryujin."*

Both behavioral changes are ported —
`crates/oristudio-cp/src/geometry/epsilon.rs:24` and
`crates/oristudio-cp/src/fold_graph.rs:201` — and `epsilon.rs` carries a test
asserting the whole constant table matches Oriedita. **That test is the tripwire;
if a future epsilon change lands, it should be what fails.**

## When the oracle disagrees with the port

Do not assume the port is the wrong one. `tools/oriedita-oracle` is a
transcription of Oriedita too, and it can transcribe the wrong function.

The first three failures this suite ever produced were all the harness: it
compared symmetric draw, double symmetric draw, and fishbone against
`OritaCalc.extendToIntersectionPoint_2`, while all three handlers call
`CreasePattern_Worker_Impl.extendToIntersectionPoint`. The two differ only in a
closing `withA(s0.getB())`, which shifts the result by one construction step.
See `implementation-plans/oriedita-symmetric-draw-parity.md`.

Read the upstream **caller** — the `MouseHandler*` for the tool — before
concluding anything about kernel code. Watch for near-identical names with a
`_2` suffix, which Oriedita uses for genuinely different variants.

## Calibration

- `92a30434`, subject *"fix(angularly-flat-foldable): fix invalid vertex
  detection"* — a one-line `private` → `public` change in `Check4.java`.
  `SKIP-REFACTOR` on its own; the real fix is elsewhere in PR #498. This is the
  canonical example of a commit whose subject oversells its diff.
- `de681be3` ("feat: step_label property") — 644 lines, the largest core commit
  of 2025, spread across ~20 mouse handlers. `SKIP-UI`: step counters shown
  next to the cursor. Confirmed not to touch the format — `step_label` appears
  nowhere under `save/` or in `origami/src/main/`.
- `8874838e` — added a quad tree to `FoldLineSet` for performance. We have
  `crates/oristudio-cp/src/folding/quad_tree.rs`; performance work upstream is
  usually `SKIP` for parity but worth noting if our own profile differs.

## Expected volume

~30–40 commits a year touch `origami/src/main/`; roughly **six** genuinely need
porting. The save/export layer sees ~17–20 commits a year, all additive so far.
Both were untouched through all of 2026 as of August. Overall project activity
has declined sharply: 362 commits in 2024, 254 in 2025, 39 in 2026 through
August. The last release was v1.1.3 in February 2025.

A run that finds nothing is the normal case, not a failed check.

## Format stability

The `.ori` format has had exactly two versions ever — `SaveV1_0` and `SaveV1_1`,
with a `SaveConverter` and `FileVersionTester` handling the difference. No new
version has appeared. Treat any *third* save version class as a top-priority
`PORT`.
