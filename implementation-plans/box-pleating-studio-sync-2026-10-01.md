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
- The vendored tree stays at `507981157194` (v0.7.15); the port must be validated by re-vendoring in a separate deliberate step with oracles, not here.

## Checklist

- [x] Cloned upstream, triaged 5 commits
- [x] Confirmed no format migration (`0.7` unchanged)
- [x] Advanced `last_checked_commit`/`last_checked_date` in `upstream-sync.json`
- [ ] Re-vendor upstream to `5029782a` and run the BP oracle
- [ ] Port `a6c559b5` (contour start-point shift + filled region)
- [ ] Add Rust test mirroring `test/specs/contour.spec.ts`
- [ ] Update `status.rs` / `PORTING.md` if the parity surface changes
