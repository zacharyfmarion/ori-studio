# Oriedita symmetric-draw parity gap

## Goal

Restore parity with Oriedita for symmetric draw, double symmetric draw, and
fishbone draw. Three oracle tests currently fail and are marked `#[ignore]`;
this plan is what un-ignores them.

## How this surfaced

Not by a bug report — by wiring the parity oracles into CI. See
`implementation-plans/upstream-drift-watcher.md`.

Seven of the workspace's eight oracle suites skipped silently on an unset
environment variable, and no CI job set them. The first run of
`oriedita_operations_oracle` with the oracle actually attached produced **59
passed, 3 failed**. The failures are pre-existing; nothing in that change
touched kernel code.

That is worth recording on its own: these are not new regressions, they are
divergences that existed with no mechanism to notice them.

## Observed divergence

`assert_eq!(rust_summary, run_oracle(...))`, so **left is ours, right is
Oriedita**.

`symmetric_draw_matches_oriedita_oracle`:

```
ours     line|-0.0|-0.0|0.0|2.0|1
oriedita line| 0.0| 1.0|0.0|2.0|1
```

`double_symmetric_draw_matches_oriedita_oracle`:

```
ours     line|-0.0|1.0|-3.0|1.0|1
oriedita line|-2.0|1.0|-3.0|1.0|1
```

`fishbone_draw_matches_oriedita_oracle`: ours emits 13 summary lines, Oriedita
emits 16.

In both segment cases the far endpoint agrees and the **near endpoint differs**:
ours lands on the intersection of source and mirror, Oriedita's lands somewhere
short of it. The `-0.0` in our output is a tell that the coordinate is being
produced by a subtraction that cancels to zero rather than being carried
through.

## Hypothesis — verify before acting

`crates/oristudio-cp/src/operations/construction.rs:839` builds the new segment
as `cross → reflected`:

```rust
let cross = find_intersection_segments(source, mirror);
let reflected = find_line_symmetry_point(
    cross,
    mirror.determine_furthest_endpoint(cross),
    source.determine_furthest_endpoint(cross),
);
let add_segment = extend_to_intersection_point(model, &LineSegment::new(cross, reflected))
```

So our segment is anchored at the intersection point by construction, and only
the far endpoint is reflected. The oracle output is consistent with Oriedita
reflecting **both** endpoints of the source segment and anchoring at neither.

This is a hypothesis from our own code plus the failing values. It has **not**
been checked against upstream. Read
`third_party/oriedita/oriedita/src/main/java/oriedita/editor/handler/MouseHandlerSymmetricDraw.java`
first — per `PORTING.md`, upstream is the reference, not our prior behavior.

Fishbone is likely downstream of the same defect rather than independent:
`MouseHandlerFishBoneDraw` builds repeated symmetric draws, and a wrong near
endpoint each iteration would change how many segments survive
`extend_to_intersection_point`, which matches a 13-vs-16 count difference. Also
a hypothesis.

## Product impact

Unassessed, and worth assessing early rather than late. Symmetric draw is a
shipped, reachable CP tool, so if the kernel divergence is user-visible it
affects real crease patterns today. Determine that before deciding urgency —
the three tests are quarantined, not the behavior.

## Affected Areas

- `crates/oristudio-cp/src/operations/construction.rs` — `symmetric_draw`, `double_symmetric_draw`
- fishbone construction, wherever it composes symmetric draw
- `crates/oristudio-cp/tests/oriedita_operations_oracle.rs` — remove the three `#[ignore]`s
- `third_party/oriedita/.../handler/MouseHandlerSymmetricDraw.java`, `MouseHandlerDoubleSymmetricDraw.java`, `MouseHandlerFishBoneDraw.java` — read-only reference

## Checklist

- [ ] Read `MouseHandlerSymmetricDraw.java` and record what Oriedita actually
      constructs, before touching Rust
- [ ] Confirm or replace the both-endpoints-reflected hypothesis
- [ ] Determine whether the divergence is user-visible in the CP editor, and
      say so explicitly
- [ ] Fix `symmetric_draw`; confirm `symmetric_draw_matches_oriedita_oracle` passes
- [ ] Re-check `double_symmetric_draw` — same root cause or its own
- [ ] Re-check fishbone; confirm the 13-vs-16 count resolves rather than shifts
- [ ] Remove all three `#[ignore]` attributes
- [ ] Run the full operations suite: expect 62 passed, 0 failed, 0 ignored
- [ ] Check whether `MouseHandlerContinuousSymmetricDraw` and
      `MouseHandlerDrawCreaseSymmetric` share the defect but lack oracle coverage
