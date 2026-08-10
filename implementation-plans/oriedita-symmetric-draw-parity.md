# Oriedita symmetric-draw parity gap — resolved

## Outcome

**The Rust port was correct. The oracle harness was wrong.**

`symmetric_draw`, `double_symmetric_draw`, and fishbone draw were never
diverging from Oriedita. The oracle was comparing them against a different
Oriedita function than the one the real tools call.

Fixed in `tools/oriedita-oracle/src/OrieditaGeometryOracle.java`. No kernel code
changed. `oriedita_operations_oracle` is 62 passed, 0 failed, 0 ignored.

## How this surfaced

Not by a bug report — by wiring the parity oracles into CI. See
`implementation-plans/upstream-drift-watcher.md`.

Seven of the workspace's eight oracle suites skipped silently on an unset
environment variable, and no CI job set them. The first run with the oracle
actually attached produced 59 passed, 3 failed.

## The two functions

Oriedita has two similarly-named extend routines that are **not**
interchangeable:

| | `CreasePattern_Worker_Impl.extendToIntersectionPoint` | `OritaCalc.extendToIntersectionPoint_2` |
| --- | --- | --- |
| Walks the fold line set | yes | yes |
| Moves `B` to nearest forward intersection | yes | yes |
| Final step | none — `A` is preserved | `add_sen.withA(s0.getB())` |
| Result | `A`→intersection | `B`→intersection |

That last line is the whole difference. `_2` discards the original `A`→`B` span,
so the returned segment starts one construction step further along.

All three handlers — `MouseHandlerSymmetricDraw`, `MouseHandlerDoubleSymmetricDraw`,
`MouseHandlerFishBoneDraw` — call `d.extendToIntersectionPoint(...)`, the worker
method. The oracle called `_2`.

## Worked example

From `symmetric_draw_matches_oriedita_oracle`: source `(0,0)→(1,0)`, mirror
`(0,0)→(1,1)`, one existing segment `(0,2)→(2,2)`.

`cross = (0,0)`, `reflected = (0,1)`, so the pre-extend segment is
`(0,0)→(0,1)`. Extending along `+y` meets the existing segment at `(0,2)`.

- Worker: `(0,0)→(0,2)` — what the tool draws, and what our Rust produced
- `_2`: `withA((0,1))` → `(0,1)→(0,2)` — what the oracle expected

Our Rust already had this right, and said so.
`crates/oristudio-cp/src/operations/transform.rs:424` carries both functions with
a doc comment naming the distinction and noting that "fishbone ribs,
symmetric/double-symmetric construction lines" need `A` preserved.

## The fix

Added `extendToIntersectionPointLikeWorker(FoldLineSet, LineSegment)` to the
oracle, transcribing the worker method from the same real Oriedita primitives,
in the spirit of the existing `addLineSegmentLikeWorker`. The worker itself
cannot be instantiated in the harness — it carries Swing and CDI dependencies.

Switched the three affected commands to it: `foldline-symmetric-draw`,
`foldline-double-symmetric-draw`, and the two fishbone rib calls.

## Audit of the remaining `_2` uses

Both are correct and were left alone:

- `foldLineExtendToIntersection` — models `_2` itself, by definition
- `foldLineLengthen` — `MouseHandlerLengthenCrease:186` genuinely calls
  `OritaCalc.extendToIntersectionPoint_2`

## The lesson worth keeping

**A failing oracle test does not mean the port is wrong.** The oracle is a
transcription too, and it can transcribe the wrong function. Both artifacts are
ours; only the vendored upstream is authoritative.

The tell here was that our Rust already had a deliberate doc comment explaining
which function these tools need and why. When a port is more specific about
upstream than the oracle is, suspect the oracle.

Note also the inverse risk, which is worse because nothing fails: if the port
and the oracle had *both* used `_2`, the test would pass while both diverged
from Oriedita. Agreement between two of our own artifacts is not parity. That is
what `third_party/` is for.

## Checklist

- [x] Read `MouseHandlerSymmetricDraw.java` before touching Rust
- [x] Replace the original both-endpoints-reflected hypothesis — it was wrong;
      upstream's `reflectLine` is structurally identical to ours
- [x] Identify the real cause: oracle calling `_2` instead of the worker method
- [x] Confirm `MouseHandlerDoubleSymmetricDraw` and `MouseHandlerFishBoneDraw`
      call the worker method too
- [x] Add `extendToIntersectionPointLikeWorker` and switch the three commands
- [x] Audit every remaining `_2` call site in the oracle
- [x] Remove all three `#[ignore]` attributes
- [x] `oriedita_operations_oracle`: 62 passed, 0 failed, 0 ignored
- [x] Full Oriedita oracle set: 112 passed, 0 failed, 0 ignored
- [ ] `MouseHandlerContinuousSymmetricDraw` and `MouseHandlerDrawCreaseSymmetric`
      also call the worker method but have no oracle coverage. Not a known bug —
      an untested surface worth commands of its own.
