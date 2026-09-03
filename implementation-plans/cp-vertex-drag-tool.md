# Move Vertex: drag a junction and its creases follow

## Goal

A tool that grabs a vertex — one of the dots the canvas already draws where
creases meet — drags it, and carries every crease endpoint sitting on it.

Today the nearest thing is **Move selected creases** (`CreaseMove`): select
creases, then two clicks for a translation vector. That moves whole segments
rigidly, so a vertex shared with an unselected crease tears away from it. There
is no gesture in the app that edits a junction in place, which is the one people
reach for when a pattern is nearly right and one intersection is in the wrong
spot.

After: pick **Move Vertex**, press on a junction, drag, release. Every crease
that ended there ends at the new place instead; creases that merely pass nearby
are untouched. The destination snaps like every other draw point (grid, vertex,
crease), and the whole drag is one undo entry.

## Approach

### It is a tool, not a modeless gesture

The tempting version is "drag any vertex whenever nothing else claims the press".
That path is already in the canvas and it is already dead: the `movingSelection`
branch in `CreasePatternWebglCanvas.tsx:3195` is the final `else` of a chain
whose previous arm is `else if (toolMode)`, and the canvas rests with **Box
Select armed** — a truthy `drag-box` mode. Measured 2026-08-24: a `console.log`
at the top of that branch never fires, through any drag, and neither Escape nor
re-clicking the active tool clears the mode. A modeless vertex drag would land in
exactly the same unreachable position.

So this is an operation with a rail button and an input mode, reachable by
construction. That also matches every registry in the stack, which is built
around one operation per tool.

### It is an Ori Studio original

Oriedita has no vertex-drag handler. The `MouseHandler*` list has
`CreaseMove`, `CreaseMove4p`, `MoveCalculatedShape` and `MoveCreasePattern`, and
all four move whole segments or the whole pattern. There is nothing upstream to
be in parity with, so this takes the native path the square generator
established (`cp-square-generator-tool.md`, Phase 0):

```rust
descriptor!(native VertexMove, "OriStudioVertexMove",
            "operations::native::vertex::move_vertex", Kernel, 8, UnitTested),
```

`operations/native/` is by definition not parity-bound, and the existing drift
guard (`operations::native::` ⇒ `OriStudio` ⇒ `"OriStudio*"` upstream) already
covers a fourth entry with no change. On the frontend, `isNativeCpOperation()` is
derived from the upstream prefix, so it picks this up automatically — but its
pinned-set test must be updated, deliberately.

### Kernel: delete, rewrite the endpoints, re-insert through the splitter

```rust
/// Ori Studio native: move the vertex at `from` to `to`, carrying every crease
/// endpoint that sits on it. Returns the number of creases moved.
pub fn move_vertex(model: &mut CreasePatternModel, from: Point, to: Point) -> usize
```

1. No-op guard on a zero move, matching `move_selected_lines`:
   `if !Epsilon::HIGH.gt0(from.distance(to)) { return 0 }`.
2. Collect the indices whose `a` **or** `b` is within `VERTEX_COINCIDENCE` of
   `from`. Empty → `0`, not an error: a press that reached the kernel with no
   vertex under it is a miss, not a failure.
3. Clone those segments, `delete_line_segments_for_indices` them, and rewrite the
   matched endpoints to `to`.
4. **Drop any segment that is now shorter than `VERTEX_COINCIDENCE`.** This is
   the collapse case — the vertex was dragged onto one of its own neighbours —
   and dropping it *is* the merge: the two creases that met at the collapsed one
   now meet each other. Keeping it would leave a sliver, and one 9.4e-5 crease is
   enough to make the Euler check discard every face, so the fold graph and FOLD
   export would silently go empty.
5. `append_and_split` the survivors — `divide_line_segment_with_new_lines`,
   through the same helper `move_selected_lines` uses.
6. `unselect_all`, return the matched count.

**Step 5 is the decision worth arguing about.** The cheaper alternative is to
mutate the endpoints in place: ids stay stable, the selection survives, the undo
diff is small. It is rejected because a vertex dragged across another crease
creates a crossing, and "inserted geometry is split against what it crosses" is a
kernel-wide invariant that everything downstream assumes — the fold graph, the
CAMV checks, the FOLD exporter. A tool that can quietly break it is worse than
one that renumbers.

The renumbering has a visible consequence, and it should be accepted rather than
worked around: **a vertex drag clears the crease selection.** The delete in step 3
shifts every id above the removed ones and the append puts the moved creases at
the end, so any preserved id set would be a lie. `VertexMove` joins
`CLEAR_CP_SELECTION_AFTER_OPERATIONS` in `projectSlice.ts` alongside `CreaseMove`
and `CreaseCopy`, which are there for exactly this reason.

**What does not move:** standalone `points`, circles, and text anchored at the
same coordinates. That is the documented rule for every kernel transform op
("real points and circles do not move… which transform line segments only",
`buildPoints`), and breaking it for one tool would make "what does a move carry"
a per-tool question.

### The preview rides the existing transform channel, extended to endpoints

The move-drag preview machinery is already frame-rate safe: `buildStrokes(move)`
takes a `CpTransformPreview { ids, matrix }` **as an argument from inside the
imperative pointer handler**, so a gesture never re-renders React. A vertex drag
is not an affine on whole segments, but it is an affine on *some endpoints*, so
the channel generalises rather than needing a second one:

```ts
export interface CpTransformPreview {
  /** 1-based line ids whose whole segment moves. */
  ids: ReadonlySet<number>;
  matrix: CpAffineMatrix;
  /**
   * Endpoint-level moves (the vertex drag): `segmentIndex * 2 + (0 for a, 1 for b)`.
   * Undefined for every other gesture, which pays two absent-set checks per frame.
   */
  endpoints?: ReadonlySet<number>;
}
```

Both stroke builders gain one clause each — `moved || endpoints?.has(i * 2)` and
the `+ 1` twin — and they must stay byte-identical, which
`cpGeometryToScene.test.ts`'s parity gate already enforces. `buildPoints` moves
the one dragged vertex dot. `CpFoldAngleLayer`'s `drawnAt(move, lineId, point)`
takes an endpoint slot so badges on the attached creases follow their midpoints
instead of hanging at the old ones.

**The endpoint set is computed once, at press time** — one walk over the segments
to find what sits on the grabbed vertex. Per pointer sample only the matrix
changes, so the cost profile is identical to today's selection move-drag.

The originals leave with the preview (they *are* the preview — real strokes,
shifted), so no `replacedLineIds` and no ghost.

### The one real correctness seam: two definitions of "on this vertex"

The preview decides which endpoints move in TypeScript; the commit decides again
in Rust. If those two rules disagree by one crease, a drag shows four creases
following the cursor and commits three, and the fourth is left stretched to
nowhere.

They are mirrored, so pin them the way this repo already pins a mirrored kernel
rule: `creaseTransform.ts` mirrors `transform_segments_by_points` and
`creaseTransform.golden.test.ts` checks it against
`tests/fixtures/cp/crease-transform-golden.json`, regenerated by
`crates/oristudio-cp/tests/transform_preview_golden.rs`. Do the same here — a
fixture of (small CP, `from` point) → the sorted `(segmentIndex, endpointSlot)`
list the kernel matches, with the TS mirror asserted against it. Include the
awkward cases in the fixture: coordinates straddling the tolerance, a segment
with *both* endpoints on the vertex, and two endpoints that differ below
tolerance but round to different `cpVertexId` keys.

Note the third of those is why the rule must be an ε-ball on both sides and not
`cpVertexId`'s `Math.round(v * 1e9)` quantization: two coordinates 1e-12 apart
can straddle a rounding boundary and land in different buckets, which would make
the match rule depend on where the pattern happens to sit.

### The press gate: you can grab what you can see

The vertex dots on screen are `getCpVertexPoints` — the dedup of every segment
endpoint — and they are drawn unconditionally (subject only to `pointSize` and
the crowding shrink). So the press hit-tests against *that* array, through a new
`vertexIndex` memo, at the same screen-fixed tolerance the crease hit test uses:

```ts
const vertexIndex = useMemo(
  () => new LineHitIndex(vertices.map((v, i) => ({ id: i + 1, a: v, b: v }))),
  [vertices]
);
```

`LineHitIndex` already handles a zero-length point cloud — its cell-size fallback
exists for exactly the sibling `pointIndex`. Two comments become false with this
change and must be corrected rather than left to mislead: "Vertices are derived
and not selectable, so they get no index" (`CreasePatternWebglCanvas.tsx:1187`)
and "Vertices have no entry — they are derived line endpoints, not selectable"
(`cpPointsToScene.ts:28`). Draggable is not selectable, and both comments should
say so.

Deliberately **not** `resolveDrawPoint(...).kind === 'vertex'`, which is close but
wrong twice: it is gated on the `snapToVertices` viewport setting (so the tool
would stop working when snapping is off), and it also matches the four paper
corners, which have no attached creases in an empty document.

A press with no vertex in range starts nothing — the same shape as the
grid-restricted draw gate at `CreasePatternWebglCanvas.tsx:3178`. It must not
fall through to the marquee, or a near-miss would wipe the selection.

### Routing, and why the panel needs no new branch

`webglActiveTool.mode` is read straight off the command definition:

```ts
const im = activeCpCommand.inputMode;
if (im === 'drag-line' || im === 'drag-box' || im === 'drag-path') return { ...idle, mode: im };
```

Add `'drag-vertex'` to that union and to the command/action `inputMode` types, and
routing follows with no per-operation special case — the opposite of the bespoke
handlers (`angle-drag`, `squareBisector`, `converging`) that each cost a branch.

The engine is a new `dragVertexTool` in `cp-workspace/tools/`, registered in
`ENGINES`. It is close to `dragLineTool` but not a variant of it: the anchor is
*a vertex the surface resolved*, not the raw press point, and there is no
click-to-place arming — a parked half-finished vertex move with no visible anchor
would be a trap. Press, drag, release; a release inside `input.tolerance` is a
click on the vertex and does nothing.

Following `angle-drag-shared-engine.md`'s lesson, the click-vs-drag test compares
**snapped to snapped**: the anchor is the vertex position and the release point
comes back through `resolveDrawPoint`, so a stationary click yields distance 0
rather than reading the snap displacement as a drag.

The commit is `{ points: [vertexPosition, destination] }` — no new payload
fields, `required_points(&command, 2)`, and the generic bridge carries it
unchanged.

### Hover affordance

While the tool is active and no drag is in flight, the vertex under the cursor
draws in the selection colour so it reads as a grab target. `CpPointSelection`
gains `vertexIdx` beside `pointIdx` / `circleIdx`; the canvas sets it from the
same `vertexIndex.query` the press uses, so what highlights is what grabs.

The cursor comes from `cpCanvasCursor.ts` — `grab` over a vertex, the tool's
default elsewhere.

### Instrumentation

Nothing to add. Every CP tool commit goes through `executeOristudioCpCommand`,
which fires `cp tool used` with `operation` and `group` at
`projectSlice.ts:2246`. A second hand-placed event for the same thing is
explicitly what AGENTS.md says not to do.

## Affected Areas

**Rust kernel** (`crates/oristudio-cp`)

- `operations/native/vertex.rs` (new) — `VERTEX_COINCIDENCE`, `move_vertex`,
  `vertex_endpoints_at` (the match rule, exported so the golden test can dump
  it), unit tests
- `operations/native/mod.rs` — `pub mod vertex;`
- `lib.rs` — `OperationId::VertexMove`, its `descriptor!(native …)`, the execute
  branch (2 required points). **No preview branch**: the surface owns this
  preview, as it does for the crease transform tools.
- `tests/vertex_move_match_golden.rs` (new) — regenerates the match fixture

**WASM** (`crates/oristudio-cp-wasm`) — no code change; the bridge is generic.
Nothing under `apps/web/src/generated/` is tracked, so there is nothing to
commit — but rebuild `build:oristudio-cp-wasm` locally before trusting anything
in the browser, since a body-only kernel edit leaves the `.js`/`.d.ts` glue
identical and lint/typecheck/vitest will all pass over a stale `.wasm`.

**Web registries** (`apps/web/src/lib`)

- `oristudioCpCommands.ts` — `'drag-vertex'` in the `inputMode` union;
  `VertexMove` in `ORISTUDIO_CP_SOURCE_MAP_OPERATION_IDS` (appended with the
  natives); its `ready(...)` definition in the `transform` group; **not** in
  `LINE_COLOR_OPERATION_IDS` (it draws no new crease)
- `oristudioCpActions.ts` — `'drag-vertex'` in `OristudioCpActionInputMode`; rail
  override with `railOrder` just after `CreaseMove`
- `oristudioCpCommands.test.ts` — the pinned native-operation set

**Web surfaces**

- `cp-workspace/tools/registry.ts` — `'drag-vertex'` in `ToolInputMode` + `ENGINES`
- `cp-workspace/tools/dragVertexTool.ts` (new) + tests — pure engine
- `cp-workspace/tools/vertexEndpoints.ts` (new) + tests — the TS mirror of the
  kernel match rule, plus its golden test against the Rust fixture
- `cp-workspace/tools/inputModelRegistry.ts` — `'drag-vertex'` in `CpInputModel`
  and a `VertexMove: { model: 'drag-vertex' }` entry (the coverage test fails
  without it)
- `cp-workspace/adapters/cpSnapshotToScene.ts` — `endpoints` on
  `CpTransformPreview`, and the endpoint clause
- `cp-workspace/adapters/cpGeometryToScene.ts` — the same clause; parity gate
  extended to cover a vertex-move preview
- `cp-workspace/adapters/cpPointsToScene.ts` — `vertexIdx` on `CpPointSelection`
- `cp-workspace/foldAngle/CpFoldAngleLayer.tsx` — `drawnAt` takes an endpoint slot
- `cp-workspace/cpCanvasCursor.ts` — `grab` over a vertex
- `cp-workspace/CreasePatternWebglCanvas.tsx` — `vertexIndex` memo, the
  `drag-vertex` pointer branch (press gate, endpoint-set capture, per-sample
  matrix, commit), hover highlight, and the two now-false comments
- `components/panels/CreasePatternPanel.tsx` — `'drag-vertex'` in the
  `webglActiveTool.mode` union (routing itself needs no new branch)

**Store** — `SLICE: projectSlice.ts` adds `VertexMove` to
`CLEAR_CP_SELECTION_AFTER_OPERATIONS`

**i18n** — the tool label, tooltip and step prompts; `cpVocab` regenerates from
the action definition. `i18n:extract` → translate 8 locales → `i18n:stamp` →
`i18n:check`.

## Checklist

### Phase 1 — kernel

- [ ] `VERTEX_COINCIDENCE`, `vertex_endpoints_at`, `move_vertex` in
      `operations/native/vertex.rs`
- [ ] Unit tests: a degree-4 junction moves all four; a crease *passing through*
      the point without ending there does not move; dragging onto an adjacent
      vertex collapses that crease and leaves no sliver; dragging across another
      crease splits at the new crossing; a `from` with no vertex returns 0; a
      zero-length move returns 0
- [ ] `OperationId::VertexMove` + `descriptor!(native …)`, execute branch
- [ ] Golden fixture generator + the match fixture under `tests/fixtures/cp/`
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
      `cargo test --workspace`

### Phase 2 — preview channel

Reviewable on its own, with the existing move-drag as the regression surface.

- [ ] `endpoints` on `CpTransformPreview`; the clause in both stroke builders
- [ ] Parity gate covers a vertex-move preview
- [ ] `vertexIdx` on `CpPointSelection`
- [ ] `drawnAt` endpoint slot + `CpFoldAngleLayer` test that a badge on an
      attached crease follows a vertex drag

### Phase 3 — tool

- [ ] `dragVertexTool` + tests: press with no vertex starts nothing; a
      stationary click commits nothing; a drag commits `[vertex, destination]`;
      cancel returns to idle
- [ ] `vertexEndpoints.ts` + its golden test against the Rust fixture
- [ ] `'drag-vertex'` through the four unions; input-model entry
- [ ] `vertexIndex` memo + the canvas pointer branch + hover highlight + cursor
- [ ] Command definition, action override, `CLEAR_CP_SELECTION_AFTER_OPERATIONS`
- [ ] Corrected the two "vertices are not selectable, so they get no index"
      comments

### Phase 4 — validation

- [ ] `npx tsc --noEmit` and vitest run **from `apps/web`** (from the repo root
      vitest loads no config and fails every test)
- [ ] `npm run lint:web`
- [ ] `i18n:extract` → 8 locales → `i18n:stamp` → `i18n:check`
- [ ] Registry coverage tests: `oristudioCpCommands.test.ts` (a UI command per
      source-mapped operation, and the pinned native set),
      `inputModelRegistry.test.ts`

### Phase 5 — browser checklist

- [ ] Move Vertex appears in the Transform rail section
- [ ] The vertex under the cursor highlights; a press 20 px from any vertex does
      nothing and does not clear the selection
- [ ] A degree-4 junction drags with all four creases attached, live
- [ ] The destination snaps to grid and to other vertices
- [ ] Dragging a vertex across a crease leaves a split crossing (check the new
      vertex dot appears at the intersection)
- [ ] Dragging a vertex onto its neighbour merges rather than leaving a stub
- [ ] Fold-angle badges on the attached creases follow during the drag
- [ ] One undo returns the whole drag
- [ ] The same, in the Tauri desktop shell

## Open questions for review

**1. Should a modifier constrain the drag?** Shift is already plumbed to the
drag engines (`dragShift`), and axis-constrain or "keep on the snap lattice" are
both plausible. Left out of V1 deliberately — the destination already snaps, and
a second constraint on top of snapping is easy to get wrong. Cheap to add later.

**2. Should the tool move a *selection* of vertices?** Out of scope: vertices are
not selectable anywhere in the app, and making them so is a much larger change
(selection model, marquee, delete ownership). The single-vertex drag is the
90% case and does not paint that door shut.

**3. `VERTEX_COINCIDENCE`'s value.** The plan says ε-ball, not quantization, but
does not pick the number. `Epsilon::UNKNOWN_1EN5` (1e-7 in a 400-unit paper
space) is the value `del_v_pair` uses to decide two creases meet, which is the
closest existing answer to the same question — but it is tight enough that a
file written by another tool could hold two endpoints the user sees as one dot
and this tool would only carry some of them. Worth one look before Phase 1
lands, because it is the rule the golden fixture pins.
