# Click-to-place endpoints for crease drawing tools

## Goal

The crease drawing tools are press-drag-release only today: press at A, drag,
release at B. Make them *also* accept two separate clicks — click A, move the
cursor (rubber-band preview follows), click B — without changing the drag
gesture at all.

This mirrors what the click-based `sequence` tools already do in the other
direction: they are click-click tools that also accept a press-drag-release
(`CreasePatternWebglCanvas.tsx:2356`, "so both gestures work: drag it there, or
click twice"). This plan makes the `drag-line` family symmetric with that.

Tools in scope (every op with `model: 'drag-line'` in
`apps/web/src/cp-workspace/tools/inputModelRegistry.ts`):

| Operation | Label |
| --- | --- |
| `DrawCreaseFree` | Draw crease |
| `DrawCreaseRestricted` | Draw restricted crease (the grid-restricted tool) |
| `CreaseMakeMv` | Make alternating M/V |
| `CreasesAlternateMv` | Alternate crossing M/V |
| `LineSegmentDivision` | Divide line by count |
| `LineSegmentRatioSet` | Divide line by ratio |

Phase 5 optionally extends the same gesture to `DrawCreaseAngleRestricted5`
(Angle restricted line), the other press-drag crease-draw tool, which runs
through a bespoke `angle-drag` canvas handler rather than the shared engine.

Out of scope: `drag-box` / `drag-path` tools (a click there already has a
defined meaning — `toolClickAction` in `tools/predicates.ts`), and Lengthen's
guide-line drag (its click is already the degenerate nearest-crease fallback).

### Porting discipline

Upstream Oriedita is press-drag-release only for these:
`MouseHandlerDrawCreaseFree.java` and `MouseHandlerDrawCreaseRestricted.java`
each register a single `ObjCoordStepNode` whose `release_*` commits the
`anchorPoint → releasePoint` segment and resets. Click-to-place is therefore an
**additive Ori Studio UX superset**, not a parity change: the drag path keeps
its exact current behaviour, and both gestures commit the identical two-point
payload through the same kernel command. No kernel or WASM change.

## Approach

### 1. One predicate does all the work

Every decision reduces to a single test on `up`: *is the release point farther
from the start than the click threshold?*

- **farther** → this was a drag (or a deliberate second click somewhere else) →
  commit `[start, release]`.
- **not farther** → this was a click in place → toggle the armed state: arm if
  idle, disarm if already armed.

That single rule gives click-A/click-B, keeps press-drag-release byte-identical,
and makes "click the same spot twice" a natural cancel.

The threshold is screen-space (`CLICK_MOVE_THRESHOLD = 4` CSS px), so the
surface converts it with the existing `modelToleranceOf(...)` helper — the same
thing `feedLengthen` already does at `CreasePatternWebglCanvas.tsx:2063` — and
passes it down on each input.

### 2. Engine: `dragLineTool` grows an armed state

`tools/types.ts` — add one optional field to `ToolInput`:

```ts
/**
 * Click-vs-drag threshold in model units (the surface converts its screen-space
 * threshold through the live camera). Absent → 0, i.e. any non-zero movement
 * reads as a drag, which is the pre-arming behaviour.
 */
tolerance?: number;
```

`drag-box` / `drag-path` ignore it.

`tools/dragLineTool.ts` — state becomes `{ start: ModelPoint | null; armed: boolean }`:

| Input | Condition | Next state | Preview | Commit |
| --- | --- | --- | --- | --- |
| `down` | `armed` | unchanged | `[start, p]` | — |
| `down` | not armed | `{ start: p, armed: false }` | — | — |
| `move` | `start === null` | unchanged | — | — |
| `move` | otherwise | unchanged | `[start, p]` | — |
| `up` | `start === null` | idle | — | — |
| `up` | `dist(start, p) > tolerance` | idle | — | `[start, p]` |
| `up` | within tolerance, not armed | `{ start, armed: true }` | `[start, p]` | — |
| `up` | within tolerance, armed | idle | — | — |
| `cancel` | | idle | — | — |

Note `move` needs no notion of "is a button down" — the surface simply keeps
feeding moves while armed, and the engine previews from `start` either way.
`armed` only changes what `down` does.

Two behaviour deltas fall out, both improvements:

- A sub-4px press-release on `DrawCreaseFree` currently commits a
  sub-pixel-length crease (the engine's zero-length guard is exact `===`
  equality). It now arms instead.
- The existing test "does not commit a zero-length drag" asserts
  `state === { start: null }`; under arming that becomes
  `{ start: {3,3}, armed: true }`. Update it — it is precisely the delta.

### 3. Surface: persist the runtime across gestures

`CreasePatternWebglCanvas.tsx` today creates `toolRuntime` on pointerdown and
nulls it on pointerup (`:2222`, `:2448`), so no state can survive a gesture.

- Hold the `drag-line` runtime in a ref (alongside `persistentToolRuntimeRef`),
  created lazily, cleared by the tool-change reset effect at `:840`. Leave
  `drag-box` / `drag-path` on the existing per-gesture lifetime.
- Split the current `drawing` boolean into "a button is down" vs "a runtime is
  live", since the two no longer coincide.
- Add the new ref to the reset effect's cleanup, and add the active operation id
  to that effect's dep list. Today it relies on `activeToolStepKinds` getting a
  fresh array identity to notice a switch between two `drag-line` ops — that
  works by accident and should not be load-bearing for armed state.
- `feedTool` passes `tolerance: modelToleranceOf(CLICK_MOVE_THRESHOLD)` on every
  input (recomputed per input, so a mid-gesture zoom stays correct).

### 4. Surface: the four wiring points

**Hover (`onPointerMove`, `:2295`).** The `drag-line` hover branch currently only
draws the snap indicator. Also feed `'move'` to the persistent runtime — a no-op
when not armed (`start === null`), and the live rubber band when armed.

**Snap gating for `DrawCreaseRestricted`** (`activeToolRequireSnap`). Two
existing gates, both needing an armed case:

- Start gate (`onPointerDown:2214`): when armed, a press on a non-snapped point
  must be *ignored* — not swallow the armed start, not move it.
- End gate (`feedTool:1517`): a non-snapped release currently feeds `'cancel'`.
  Keep that when dragging (it matches upstream's `release_click_drag_point`
  reset), but when armed, ignore the release and stay armed — the same
  "stay on the step" semantics the registry's `crease-required` steps use.

**Escape (`onKeyDown:2494`).** Add a `drag-line` branch that feeds `'cancel'`,
clears the preview, and resets the step prompt. Also cancel the armed state when
a right-button erase press starts (`onPointerDown:2163`). A middle-button pan or
a wheel zoom must *not* disarm.

**Pointer leave (`:2489`).** Clear the rubber band, keep the armed start.

### 5. Affordance: show the armed point

An invisible armed state is the main UX risk. Render a placed dot at the armed
start using the existing `sequenceOverlayPoints` / `PLACED_POINT_RADIUS` overlay
the click-based sequence tools already use, so an armed crease-draw reads
exactly like a half-finished sequence tool.

### 6. Step prompts

The prompts currently say drag-only ("Drag between existing points"), which
becomes wrong. Give each in-scope op two `toolSteps` and drive the prompt with
the existing `onToolPickProgress(0 | 1)` channel (`CreasePatternPanel.tsx:2486`)
on arm / disarm / commit. Proposed wording:

| Operation | Steps |
| --- | --- |
| `DrawCreaseFree` | `Click or drag to set the crease start` / `Click to set the crease end` |
| `DrawCreaseRestricted` | `Click or drag from an existing point` / `Click another existing point` |
| `CreaseMakeMv`, `CreasesAlternateMv` | `Click or drag to start the guide line` / `Click to end the guide line` |
| `LineSegmentDivision`, `LineSegmentRatioSet` | `Click or drag to start the line to divide` / `Click to end the line` |

Going from 1 to 2 steps is safe for the three `toolSteps.length > 0` gates
(`CreasePatternPanel.tsx:438`, `:2087`, `:2168`, `CpContextToolPanel.tsx:63`) —
all are `> 0` checks.

`toolSteps` feed the generated `cpVocab` namespace (`i18n/cpVocab.ts:69`), so
new wording means `npm run i18n:extract`, translating the new keys for all 8
locales, `npm run i18n:stamp`, and `npm run i18n:check`.

### Known trade-off

While armed, a press-drag-release commits `[armedStart, releasePoint]` rather
than starting a fresh drag from the press point. Any other reading needs a
modal distinction the gesture does not carry; Escape or a click back on the
armed point is the way out, and the live preview shows the outcome the whole
time. Worth confirming in browser testing that it does not feel wrong.

## Affected Areas

- `apps/web/src/cp-workspace/tools/types.ts` — `ToolInput.tolerance`
- `apps/web/src/cp-workspace/tools/dragLineTool.ts` — armed state machine
- `apps/web/src/cp-workspace/tools/dragLineTool.test.ts` — arming cases
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — runtime lifetime,
  hover feed, snap gating, Escape/erase cancel, armed-point overlay
- `apps/web/src/lib/oristudioCpCommands.ts` — two-step prompts for 6 ops
- `apps/web/src/lib/oristudioCpCommands.test.ts` — prompt expectations
- `apps/web/public/locales/*/cpVocab.json` (generated) + 8 locale translations
- No Rust, kernel, or WASM change.

## Checklist

- [x] Add `tolerance?: number` to `ToolInput` with the doc comment above
- [x] Rewrite `dragLineTool` around the armed state machine
- [x] Unit tests: arm on click; hover previews from the armed start; second
      click commits; second click in place disarms; drag from armed commits
      `[start, release]`; `cancel` disarms; absent `tolerance` reproduces
      today's behaviour; update the zero-length-drag state assertion
- [x] Hoist the `drag-line` runtime to a ref; clear it in the tool-change reset
      effect and add the operation id to its deps
- [x] Feed `tolerance` on every `feedTool` input
- [x] Feed `'move'` from the `drag-line` hover branch
- [x] Armed cases for both `activeToolRequireSnap` gates (ignore, stay armed)
- [x] Escape and right-button erase cancel the armed state; pan/zoom do not
- [x] Pointer-leave clears the rubber band but keeps the armed start
- [x] Draw the armed start point via the sequence overlay
- [x] Two-step prompts for the 6 ops + `onToolPickProgress` on arm/disarm/commit
- [x] `npm run i18n:extract`, translate 8 locales, `i18n:stamp`, `i18n:check`
- [x] `cd apps/web && npx tsc --noEmit`, `npm run lint:web`, `npm run test:web`
- [x] Phase 5 (`DrawCreaseAngleRestricted5` / `angle-drag`) landed here, on its
      bespoke handler, using the same predicate
- [ ] Browser check: each of the 7 tools draws by drag *and* by click-click;
      grid-restricted rejects unsnapped clicks without losing the armed point;
      Escape bails; pan/zoom mid-arm keeps the armed point anchored to the model

### Implementation notes

The engine reports its armed start through `ToolOutput.livePoints`, so the
surface marks the dot, gates presses, and drives the step prompt without a
second copy of the arming rule. `drawing` did not need splitting after all — it
still means "a button is down", and the persistent runtime lives in a ref
beside the other per-tool state.

Two small cleanups fell out: `snapIndicatorPoints` became dead once the hover
branch routed through `sequenceOverlayPoints` (removed), and a tool change now
clears the preview channel so an armed rubber band cannot outlive its tool.
