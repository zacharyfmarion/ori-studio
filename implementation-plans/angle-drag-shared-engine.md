# Drive Angle Restricted Line from the shared drag-line engine

## Goal

Retire the bespoke `feedAngleDrag` state machine in `CreasePatternWebglCanvas.tsx`
and drive Angle Restricted Line (`DrawCreaseAngleRestricted5`) from the shared
`dragLineTool` engine through the same snapping path `feedTool` already uses for
every other crease-draw tool — so the click-vs-drag / arming rule is stated once
and tested once.

### The defect that motivates it

Pressing 4–10 px from a vertex with Angle Restricted Line commits a crease from
that vertex to the cursor, on a click that never moved. `feedAngleDrag` anchors
the **snapped** point (`resolveDrawPoint`, `SNAP_TOLERANCE_CSS = 10`) but tests
the release against the **raw** cursor
(`CreasePatternWebglCanvas.tsx:2226`, `CLICK_MOVE_THRESHOLD = 4`), so the snap
displacement itself reads as a 4–10 px drag.

`crease-draw-click-to-place.md` records Phase 5 as landing angle-drag "on its
bespoke handler, using the same predicate". That is exactly the failure: the
predicate was copied, the input contract it depends on was not. `feedTool` feeds
`resolveDrawPoint(...)` on `down`, `move` *and* `up`
(`CreasePatternWebglCanvas.tsx:1800-1822`), so `dragLineTool`'s identical test
compares snapped-to-snapped and a stationary click yields distance 0.

A copied rule with an uncopied contract is what this plan removes. The two state
machines are the same decision table already:

| `up` branch | `dragLineTool` | `feedAngleDrag` |
| --- | --- | --- |
| no start | idle | `reset()` |
| beyond tolerance | commit `[start, end]`, idle | commit `[anchor, raw]`, `reset()` |
| within tolerance, armed | idle | `reset()` |
| within tolerance, idle | arm | arm + `onToolPickProgress(1)` |

## Approach

### 1. Land the fix on its own first

The user-visible bug should not wait on a refactor. Phase 1 is a standalone
change to the release branch — snap the release point for the threshold test,
keep committing the raw endpoint:

```ts
// The press anchors up to SNAP_TOLERANCE_CSS away from the cursor, so testing the
// raw release against it reads that displacement as a drag. Compare snapped to
// snapped, as `feedTool` does; the commit still carries the raw endpoint.
const end = liveRef.current.resolveDrawPoint(raw, tol).point;
if (!anchor) {
  reset();
} else if (Math.hypot(end.x - anchor.x, end.y - anchor.y) > modelToleranceOf(CLICK_MOVE_THRESHOLD)) {
  liveRef.current.onToolCommit({ points: [anchor, raw] });
```

The test must stay *anchor*-relative rather than reverting to the pre-fd5757f0
press-relative `moved` flag, because it does double duty: it also separates
"second click elsewhere → commit" from "click the parked anchor again → disarm".
Only the point fed into it needs snapping.

### 2. The raw/snapped split is real — preserve it

The engine needs the snapped point; the kernel needs the raw one. Both, on the
same release.

Upstream `MouseHandlerDrawCreaseAngleRestricted5.java` snaps the anchor to the
closest point (`move_click_drag_point`), then builds the endpoint as
`kouho_point_A_37(syuusei_point_A_37(p))` — `syuusei` snaps the **cursor** onto
the active angle system *relative to the anchor*, and `kouho` point-snaps only if
the closest point happens to lie on that ray. Our kernel does the same at execute
time: `draw_crease_angle_restricted_5` takes `(anchor, pointer)` and calls
`snap_to_close_point_in_active_angle_system`
(`crates/oristudio-cp/src/operations/construction.rs:86`).

So handing the kernel a vertex-snapped cursor would let a nearby vertex, rather
than the cursor direction, choose the angle-system ray. The cursor must reach the
kernel raw — on the preview and on the commit.

**Rejected:** adding `rawPoint` to `ToolInput`. That puts a field on the shared
tool contract that exactly one tool reads, which is the kind of extraction
`AGENTS.md` calls worse than the inlining. The adapter substitutes the raw
endpoint into the commit payload instead — one line, visibly local to the angle
tool, engine untouched.

### 3. Fold angle-drag into `feedTool`

One snapping path, chosen by mode rather than re-implemented per tool:

```ts
const snaps = mode === 'drag-line' || mode === 'angle-drag';
...
// Angle Restricted Line: the engine sees the snapped point (so its arming rule
// matches drag-line's), but the kernel sees the raw cursor — the cursor
// direction, not a nearby vertex, picks the angle-system ray (upstream
// `syuusei_point_A_37`).
if (mode === 'angle-drag') {
  const seg = out.preview?.segments[0];
  liveRef.current.onToolPreviewInput(seg ? [seg.a, raw] : [], []);
} else {
  setToolPreview(out.preview?.segments);
}
if (snaps) syncDragLineArmed(out.livePoints, snapRingFor(resolved.point, raw));
if (out.commit) {
  liveRef.current.onToolCommit(
    mode === 'angle-drag'
      ? { points: [out.commit.points[0], raw] }
      : { ...out.commit, additive: dragShift }
  );
}
```

Supporting changes in `feedTool`'s neighbourhood:

- `drawRuntime()` (`:1740`) must return the persistent ref for `angle-drag` too,
  not just `drag-line` — an armed anchor has to survive between gestures.
- `activeToolRequireSnap` needs no new case: `isRestrictedDrawOperation`
  (`tools/predicates.ts:56`) is `DrawCreaseRestricted` only, so the gate at
  `:1807` is inert for angle-drag.
- `syncDragLineArmed` (`:1751`) already drives the armed dot, the snap ring and
  `onToolPickProgress` off the engine's `livePoints`. Angle-drag's hand-rolled
  equivalents (`:2189`, `:2204`, `:2234`) go away.

### 4. Retire the bespoke state

- Delete `feedAngleDrag` (`:2176-2237`, ~60 lines).
- Collapse `angleDragAnchorRef` + `angleDragArmedRef` (`:923-927`) into the
  existing `dragLineArmedRef`, which already holds "the parked point, or null".
  Rename that pair to `armedDrawPointRef` / `armedDrawRuntimeRef` now that they
  serve two modes, and drop the two retired refs from the tool-change reset
  effect (`:975-976`).
- Update the call sites that branch on the retired refs:
  - right-button erase cancel (`:2548-2549`) — one branch, both modes;
  - the `angle-drag` hover branch (`:2665-2673`) merges into the `drag-line`
    hover branch (`:2690-2701`) by widening its mode condition;
  - `onPointerLeave` (`:2895-2898`) — `parked` becomes one ref read, keeping the
    mode guard so a stale point cannot outlive its tool, and keeping the
    `onToolPreviewInput([], [])` clear for the kernel-previewed mode;
  - Escape (`:2925-2926`) — folds into the `drag-line` branch.
- `pointerRelease.ts` keeps `'angle-drag'` as a distinct `ActiveToolMode` and
  keeps its route; only what the route *calls* changes (`feedTool` instead of
  `feedAngleDrag`). This preserves the exhaustive precedence tests untouched.
- Do **not** add `'angle-drag'` to `ToolInputMode` / the `ENGINES` registry. That
  union is documented as the modes handled by a *local-preview* engine, and
  angle-drag is kernel-previewed. The mode stays panel-selected
  (`CreasePatternPanel.tsx:2011`); only its engine is now shared.
- Update the nominal registry comment at `inputModelRegistry.ts:103-106`, which
  currently says the op runs on a bespoke handler.

### 5. Tests

- `dragLineTool.test.ts` gains the regression case by name — a press whose
  snapped point sits away from the cursor, released in place, arms rather than
  committing. It passes against today's engine; its value is that it *states* the
  contract the surface has to meet, next to the rule it constrains.
- Add `toolModeSnapsDrawPoint(mode)` to `tools/predicates.ts` for `feedTool`'s
  `snaps` condition, with a case in `predicates.test.ts` asserting `angle-drag`
  is in the set. That is the one part of the fix expressible as a pure test, and
  it pins the mode list against a future tool being added without snapping.
- The residual risk — "the adapter forgot to snap a phase" — is not expressible
  in a pure engine test, and it is not worth a jsdom+WebGL canvas harness to
  chase. It is addressed structurally instead: after this change there is one
  place that snaps, and it branches on mode, not on phase.

### 6. Expected behaviour deltas

- **Fixed:** a click near a vertex arms the anchor instead of committing a
  vertex→cursor crease.
- Armed dot, hover snap ring and step prompt now come from `syncDragLineArmed` —
  same visuals, one code path (the current handler already draws the same
  `sequenceOverlayPoints` overlay).
- Kernel preview and commit payloads are unchanged: anchor snapped, endpoint raw.
- Upstream parity is unchanged. Upstream commits nothing on a press-release with
  no drag (`dragSegment` stays null), so click-to-place remains an additive Ori
  Studio superset, exactly as `crease-draw-click-to-place.md` framed it.

## Affected Areas

- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — the fix, then
  `feedTool` absorbing angle-drag, `feedAngleDrag` deleted, refs collapsed, five
  call sites updated
- `apps/web/src/cp-workspace/tools/predicates.ts` + `.test.ts` —
  `toolModeSnapsDrawPoint`
- `apps/web/src/cp-workspace/tools/dragLineTool.test.ts` — snap-displacement case
- `apps/web/src/cp-workspace/tools/inputModelRegistry.ts` — stale comment
- `implementation-plans/crease-draw-click-to-place.md` — note that Phase 5's
  bespoke handler was retired here
- No Rust, kernel, or WASM change. No new user-facing strings, so no i18n run —
  the two-step prompts already exist from the earlier plan.

## Checklist

- [ ] Phase 1: snap the release point for the threshold test in `feedAngleDrag`;
      commit the raw endpoint unchanged
- [ ] Phase 1 browser check: press 5–8 px from a vertex and release without
      moving — the anchor parks, no crease appears; a second click elsewhere
      commits; clicking the parked anchor again drops it
- [ ] `toolModeSnapsDrawPoint` in `tools/predicates.ts` + test covering
      `angle-drag`
- [ ] `feedTool` handles `angle-drag`: snapped point to the engine, raw cursor to
      the kernel preview and the commit endpoint
- [ ] `drawRuntime()` returns the persistent runtime for `angle-drag`
- [ ] Delete `feedAngleDrag`; collapse the two angle refs into
      `armedDrawPointRef` / `armedDrawRuntimeRef`; update the tool-change reset
- [ ] Update the five call sites (erase cancel, hover, release route, pointer
      leave, Escape); `pointerRelease.ts` route unchanged
- [ ] `dragLineTool.test.ts`: press snapped away from the cursor, release in
      place → arms
- [ ] Refresh the `inputModelRegistry.ts` comment and cross-reference
      `crease-draw-click-to-place.md`
- [ ] `cd apps/web && npx tsc --noEmit`, `npx vitest run`, `npm run lint:web`
      (prefer these over `npm run typecheck:web` / `test:web`, which regenerate
      the tracked wasm bindings as a side effect)
- [ ] Browser check after the refactor: drag-draw, click-click, Escape,
      right-button erase mid-arm, pointer-leave-and-return, and pan/zoom while
      armed all behave identically for Angle Restricted Line and Draw Crease
