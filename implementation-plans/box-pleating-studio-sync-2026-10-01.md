# Box Pleating Studio sync — 2026-10-01

## Goal

Port the one observable-behavior change found by the drift check of
`bp-studio/box-pleating-studio` (`main` at `5029782af057`, `v1904: v0.7.17`)
into `crates/oristudio-bp`.

## Approach

Cloned upstream and diffed `507981157194..5029782a` (5 commits; `v0.7.15` →
`v0.7.17`) restricted to `src/core/`, `src/shared/json/`,
`src/client/patches/migrations/`.

| SHA | Bucket | Reasoning |
| --- | --- | --- |
| `a6c559b5` Fix edge-case contour bug | **PORT** | Changes contour tracing: new `Quadrant.$startPointFor` / `startPointFor` (`pattern/quadrant.ts`), node-specific start point threaded through `RepoTrace.$resolveStartEnd` (`trace/repoTrace.ts`), `Trace._applyFilledRegion` and a new `$generate` parameter (`trace/trace.ts`), ray handling in `isShiftTouchable` (`trace/traceContext.ts`), `createStartEndMap`/`processTrace` plumbing (`tasks/patternContour.ts`). Test: `test/specs/contour.spec.ts`. |
| `76fc3bd5` Fix pattern saving regression | `SKIP-REFACTOR` | Adds `toJSON()` to `AddOn`/`Gadget`/`Piece` and routes `Device.toJSON`/`$getSignature` through it (`pattern/{addOn,device,gadget,piece}.ts`) so JS `Cache` fields are not serialized. Our `DeviceModel` is plain serde data with no cache fields; `PatternDevice::signature` (`crates/oristudio-bp/src/layout/pattern.rs:698`) is unaffected. |
| `6e0eb932`, `5029782a` version bumps | `SKIP-REFACTOR` | Outside watch paths (release metadata). |
| `55440046` Fix tinyurl API | `SKIP-UI` | Outside watch paths (app layer). |

Format risk: no changes under `src/shared/json/` or
`src/client/patches/migrations/`; no new `Migration.$add`. `.bps` version is
still `0.7`, so newly saved upstream files remain openable.

## Affected Areas

- `crates/oristudio-bp/src/layout.rs` — `Quadrant` (`start_end_points` at ~1527/1914); add `start_point_for`, `collect_regions`, `Rect`, `NodeStart`.
- `crates/oristudio-bp/src/layout/trace/core.rs` — `resolve_start_end` (~308), `generate`, new filled-region handling, `is_shift_touchable` ray case.
- `crates/oristudio-bp/src/layout/contours.rs` — start/end map plumbing.
- Oracle: `tools/bp-studio-oracle` parity fixture covering the new `contour.spec.ts` case; update `status.rs` parity table.
- The vendored tree stays at `507981157194` (v0.7.15) in the drift check; the port re-vendors to `5029782a` first, as its own step, and validates against the oracles.

## Results

**Re-vendor.** The vendored tree matched `507981157194` file-for-file (apart
from gitignored `dist/` outputs) before the bump; `507981157194..5029782a` is
16 files. The layout-graphics oracle prints byte-identical output on v0.7.15
and v0.7.17 for every fixture under `tests/fixtures/bp-studio/`, so no ground
truth an existing test captured moved.

**`76fc3bd5` closes a documented divergence rather than opening one.** Loading
the saved-pattern fixtures and completing the stretch, the oracle reports 3
patterns on v0.7.15 and 2 on v0.7.17 — the port's count, which
`tests/stretch_file_prototype.rs` had recorded as an upstream duplicate.
Nothing to port; the note there is updated.

**The port exposed two older divergences in raw trace contours**
(`traceContour.ts`), both invisible until `a6c559b5` began landing pattern
contours on raw hinges:

- `create_trace_contour` built the raw grouping from the node sets of *every*
  critical corner. Upstream's `checkCriticalCorners` deletes the corners it
  finds from the same map, so only the *missing* corners count. Counting a node
  set twice marks its leaves shared and splits them into separate components.
- `recursive_expand` expanded a lone leaf with no covered junctions, where
  upstream's `createRawContourForLeaf` always consults `coveredJunctionMap`.

**Differential check.** 455 designs — the 34 flap-bearing `parseTree` designs
in upstream's specs, 150 perturbations of the spiny-lobster case, and 271
seeded random packings — each run through the v0.7.15 and v0.7.17 oracles and
the port before and after (4,305 graphics tags, compared exactly):

| | tags |
| --- | --- |
| Upstream changed, port now matches v0.7.17 | 83 |
| Upstream unchanged, port matched before, differs after (regressions) | 0 |
| Pre-existing mismatches the raw-contour fixes resolve | 22 |
| Upstream changed, port still differs | 4 |

The four remaining are in two lobster variants whose stretch device already
differs from upstream's (configuration count and gadget geometry), so the
rivers traced from it differ too. Of the 22 designs with any pre-existing
river or flap mismatch, 13 likewise have a differing device; the other nine are
random packings showing a separate river bug, where a river's second,
disconnected component loses its outer ring. Both predate this sync and are out
of its scope.

## Checklist

- [x] Cloned upstream, triaged 5 commits
- [x] Confirmed no format migration (`0.7` unchanged)
- [x] Advanced `last_checked_commit`/`last_checked_date` in `upstream-sync.json`
- [x] Re-vendor upstream to `5029782a` and run the BP oracle
- [x] Port `a6c559b5` (contour start-point shift + filled region)
- [x] Add Rust test mirroring `test/specs/contour.spec.ts` (`tests/node_start_point.rs`)
- [x] Fix the two raw trace contour divergences the port exposed (`tests/raw_trace_contour.rs`)
- [x] Update `status.rs`; `PORTING.md` lists only deliberate divergences, and this adds none
