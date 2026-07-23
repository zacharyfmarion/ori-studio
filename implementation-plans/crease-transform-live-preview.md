# Live Preview for Move / Copy Selected Creases

## Goal

Give every Ori Studio crease-transform tool an Oriedita-style live preview: while the
gesture is in progress the selected creases are drawn at their prospective position,
so the result is visible *before* the commit.

Tools in scope (all four, plus the ambient selection drag that already half-does it):

| Op | Command label | Input | Preview shows |
| --- | --- | --- | --- |
| `CreaseMove` | Move selected creases | 2 points | selection translated by `p0→p1` |
| `CreaseCopy` | Copy selected creases | 2 points | originals **plus** a translated ghost |
| `CreaseMove4p` | Move by four points | 4 points | selection under the similarity from `(o1,o2)→(t1,t2)` |
| `CreaseCopy4p` | Copy by four points | 4 points | originals **plus** the transformed ghost |
| (no tool) selection drag | — | press-drag | already previews; gets the shared code path |

Out of scope: changing what the commit does. The kernel remains the single source of
truth for the mutation ([transform.rs:287](crates/oristudio-cp/src/operations/transform.rs:287)),
including `divideLineSegmentWithNewLines` splitting — the preview never shows splits,
exactly as Oriedita's doesn't.

### Upstream reference

`BaseMouseHandlerLineTransform.drawPreview` / `drawDirect`
([third_party/oriedita/…/handler/BaseMouseHandlerLineTransform.java](third_party/oriedita/oriedita/src/main/java/oriedita/editor/handler/BaseMouseHandlerLineTransform.java))
copies the selected `FoldLineSet` on press and redraws it offset by `delta` every
frame, in each segment's **own** line colour, with a cached bitmap above 1000 lines.
Note two upstream facts:

- Oriedita's 2-point move/copy are press-drag-release, not click-click.
- Oriedita's **4p** handlers draw only the four step vertices — no transformed ghost.
  Previewing them is a deliberate superset, not a parity regression; the committed
  geometry is unchanged.

## Approach

The infrastructure already exists and is half-wired: the no-tool selection drag builds
a `CpMovePreview { ids, delta }` and re-runs `buildStrokes(move)` / `buildPoints(move)`
per pointer move ([CreasePatternWebglCanvas.tsx:2007](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:2007)).
The work is to (a) generalise that from a translation to a similarity transform,
(b) add an additive *ghost* channel for the copy variants, and (c) drive it from the
point-sequence tool loop instead of only from the bare drag.

Preview geometry is computed **frontend-side**, not by a kernel round trip. The
existing `preview_command` path is async through the CP worker and returns segment
objects through React state — fine for a handful of candidate rays, wrong for
re-transporting thousands of selected segments on every mouse move. The similarity
math is ~15 lines; parity is pinned by a cross-language golden fixture (Phase 2)
rather than by making the kernel recompute it 60×/second.

### Phase 1 — Generalise the move preview from delta to affine

`CpMovePreview` ([cpSnapshotToScene.ts:18](apps/web/src/cp-workspace/adapters/cpSnapshotToScene.ts:18))
becomes `CpTransformPreview`:

```ts
export interface CpTransformPreview {
  ids: ReadonlySet<number>;
  /** Model→model affine: [m00, m01, m10, m11, tx, ty]. */
  matrix: readonly number[];
}
```

- Add `translationMatrix(delta)` so the existing drag-move keeps its call shape.
- Apply in `cpSnapshotToScene` and `cpGeometryToScene` (the compact hot path) —
  both already loop per segment, so this is a per-endpoint multiply, no new pass.
- `buildPoints` applies the same matrix to the derived vertices of moved lines
  ([CreasePatternWebglCanvas.tsx:867](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:867)).
- Keep the byte-identical parity gate between the two adapters green
  ([cpGeometryToScene.test.ts:88](apps/web/src/cp-workspace/adapters/cpGeometryToScene.test.ts:88)).

Circles and free points are deliberately *not* transformed: `selected_line_segments`
is line-only, so moving them would preview something the commit won't do.

### Phase 2 — Pure transform math, pinned to the kernel

New `apps/web/src/cp-workspace/tools/creaseTransform.ts`:

```ts
export function similarityFromPointPairs(o1, o2, t1, t2): Matrix2x3 | null
export function translationMatrix(delta): Matrix2x3
```

`similarityFromPointPairs` mirrors `transform_segments_by_points`
([transform.rs:406](crates/oristudio-cp/src/operations/transform.rs:406)): rotate about
`o1` by `angle(o1,o2,t1,t2)`, scale by `|t1t2| / |o1o2|`, then translate `o1→t1`.
Returns `null` for a degenerate source pair (`|o1o2| ≈ 0`) so the surface shows dots
and no ghost instead of `NaN` geometry.

Parity guard (this is the part that keeps it from drifting):

1. A Rust test in `crates/oristudio-cp` transforms a fixed segment set through
   `transform_segments_by_points` for a table of point quadruples and asserts against
   a committed `tests/fixtures/cp/crease-transform-golden.json`.
2. A Vitest reads the same JSON and asserts the TS matrix reproduces it to 1e-12.

Either language changing the math fails on the other side.

### Phase 3 — Ghost stroke buffers

New `apps/web/src/cp-workspace/tools/transformGhost.ts` — a small stateful builder
created at gesture start and disposed at commit/cancel:

- `createTransformGhost(geometry | lineSegments, selectedIds, style)` snapshots the
  selected endpoints into two preallocated `Float32Array`s plus a per-segment colour
  array built **once**.
- `ghost.update(matrix)` writes transformed endpoints into the preallocated arrays and
  returns the `StrokeGeometry` — no allocation, no colour re-resolution per move.

Rendering, per variant:

- **Move / Move4p**: reuse the existing in-place path — `renderer.setStrokes(buildStrokes(move))`
  shifts the real strokes and hides nothing extra. No ghost buffer needed.
- **Copy / Copy4p**: originals stay untouched; the ghost goes on the preview channel
  (`renderer.setPreview(ghost.update(matrix))`), which already draws an independent
  instanced stroke set ([reglRenderer.ts:218](apps/web/src/cp-workspace/renderer/reglRenderer.ts:218)).

Styling decision to confirm in review: Oriedita draws the ghost in each segment's real
M/V colour. Our existing drag-move draws moved creases in the selection accent. Proposal:
**move** keeps the selection accent (consistency with the shipped drag-move), **copy**
draws the ghost in real line colours at reduced alpha so it reads as "new geometry that
will land here" and is distinguishable from the still-selected originals.

### Phase 4 — Drive it from the tool loop

The four ops are `point-sequence` in
[inputModelRegistry.ts:68](apps/web/src/cp-workspace/tools/inputModelRegistry.ts:68); the
registry entries do not change. In the canvas:

- New prop `activeToolTransform: { kind: 'move' | 'copy'; pointCount: 2 | 4 } | null`,
  derived in the panel from the active operation id.
- In `feedSequenceTool`, when it is set: build the ghost on the first `down`, and on
  every `move`/`down` compute the matrix from the live points, then update strokes
  (move) or preview (copy) and `renderNow()`.

Per-step preview state, which is the whole interaction:

| Placed points | 2-point tools | 4-point tools |
| --- | --- | --- |
| 0 | snap ring only | snap ring only |
| 1 | ghost translated `p0 → cursor` | source point 1 placed; **no ghost yet** |
| 2 | — (commits) | source pair fixed; **no ghost yet** |
| 3 | — | **ghost live, following the cursor**: `(p0,p1) → (p2,cursor)` |
| 4 | — | — (commits) |

The 4-point ghost is the interesting one: once the source pair and the first target
point are down, the transform is fully determined by the cursor, so the selection
rotates and scales about `p2` as the pointer moves — you see the rotation and scale
land before committing, which is exactly the step where a four-point transform is
otherwise impossible to predict. Before the third point the transform is
underdetermined (any of scale/rotation/translation is still free), so the surface
shows only the placed step dots — no half-guessed ghost that jumps when the third
point lands.

Degenerate guard: if the source pair is (near-)coincident, `similarityFromPointPairs`
returns `null` (scale divides by `|o1o2|`) and the surface falls back to dots-only for
that gesture rather than rendering `NaN` geometry. Oriedita rejects that pick outright
in `release_select_2_original_points` (its `< selectionDistance` check), so a rejected
pair never reaches a preview there.
- Suppress the kernel preview round trip for these ops. Today they fall through
  `preview_command`'s default arm ([lib.rs:3218](crates/oristudio-cp/src/lib.rs:3218)) and
  get a meaningless rubber-band segment between the last two points; that must not
  fight the ghost for the preview channel.
- Clear on commit, `cancel`, Escape, tool change, and selection change — restore
  `buildStrokes()` / `buildPoints()` and `setPreview(null)`.

Panel side ([CreasePatternPanel.tsx:2703](apps/web/src/components/panels/CreasePatternPanel.tsx:2703)):
`handleWebglToolPreviewInput` returns early (empty segments) for the four ops, and the
new prop is passed through. The commit path (`handleWebglToolCommit`) is untouched.

### Phase 5 — Gesture parity (recommended, separable)

Oriedita's 2-point move/copy is press-drag-release; ours is click-click. With the ghost
in place, supporting **both** is a few lines in the sequence feed: if `up` arrives with
the pointer having moved past the drag threshold while exactly one point is placed,
treat the release point as the second point and commit. Click-click still works for
users who prefer it, and a drag now behaves like Oriedita.

Ship this as its own commit so it can be dropped independently if the click-click flow
is preferred.

### Phase 6 — Readout and affordances (optional polish)

- Surface live `Δx, Δy` / distance (2-point) and scale + rotation (4-point) in the
  existing measurement/status slot, so the transform is legible, not just visible.
- Reuse `resolveMoveSnap` for the 2-point tools so the tool snaps like the drag-move.
- Escape cancels mid-gesture (wire into the existing `onKeyDown`).

### Phase 7 — Performance

The per-move cost is one pass over the selected segments' endpoints plus a GPU
re-upload — no React state, no worker call, no allocation after gesture start. Verify,
in a **production** build (dev inflates ~10×, per prior CP profiling):

- select-all on a dense CP (`perf_harder.osf`, ~52k edges) and drag a move and a copy;
- confirm frames stay at rAF cadence and no per-move GC sawtooth.

If the full-scene `setStrokes` rebuild on the move variants dominates at that size, the
fallback is to render the move ghost on the preview channel too and mask the originals,
rather than rebuilding the whole stroke buffer per frame. Do not add Oriedita's bitmap
cache — that exists because it draws on the CPU.

## Affected Areas

- `apps/web/src/cp-workspace/adapters/cpSnapshotToScene.ts` — `CpTransformPreview`, affine apply
- `apps/web/src/cp-workspace/adapters/cpGeometryToScene.ts` — same on the compact path
- `apps/web/src/cp-workspace/tools/creaseTransform.ts` — **new**, similarity math
- `apps/web/src/cp-workspace/tools/transformGhost.ts` — **new**, preallocated ghost buffers
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — `activeToolTransform` prop, sequence-feed ghost driving, cancel/clear paths, `buildStrokes`/`buildPoints` signatures
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — derive the prop, suppress the kernel preview for the four ops
- `tests/fixtures/cp/crease-transform-golden.json` — **new**, cross-language golden
- `crates/oristudio-cp/src/operations/transform.rs` (tests only) — golden emitter/assert
- No kernel behaviour changes; no wasm bridge changes; no Tauri changes.

## Checklist

- [x] Phase 1: `CpTransformPreview` + affine apply in both scene adapters, `translationMatrix` shim, adapter parity gate green
- [x] Phase 1: `buildStrokes` / `buildPoints` take a matrix; existing drag-move unchanged in behaviour
- [x] Phase 2: `creaseTransform.ts` with `similarityFromPointPairs` + degenerate-pair guard
- [x] Phase 2: Rust golden test + committed fixture; Vitest asserts TS parity to 1e-12
- [x] Phase 3: `transformGhost.ts` builder with preallocated buffers + colour snapshot
- [x] Phase 3: copy ghost renders on the preview channel in real line colours at reduced alpha
- [x] Phase 4: `activeToolTransform` prop threaded panel → canvas
- [x] Phase 4: sequence feed drives the ghost for `CreaseMove` / `CreaseCopy` (2 points)
- [x] Phase 4: sequence feed drives the ghost for `CreaseMove4p` / `CreaseCopy4p` — live from the 3rd point on, cursor supplying the 4th; dots-only before that
- [x] Phase 4: degenerate source pair (`|o1o2| ≈ 0`) falls back to dots-only, never `NaN` geometry
- [x] Phase 4: kernel preview suppressed for the four ops; ghost cleared on commit/cancel/Escape/tool change/selection change
- [x] Phase 5: press-drag-release commits the 2-point variants (separate commit)
- [x] Phase 6: ~~`resolveMoveSnap` applied to the 2-point tools~~ — not needed, and would
      double-snap: both point steps already snap through `resolveDrawPoint`
      (`snapPerStep: ['point', 'point']`), which is the snapping Oriedita's own handler
      does via `getClosestPoint`. Snapping the *delta* on top would diverge from the
      points the kernel is given.
- [ ] Phase 6: live delta / scale+rotation readout — **deliberately not done**. The
      existing measurement slots are Oriedita's measure-tool registers, so a transform
      readout needs its own surface plus new user-facing strings in 9 locales; that is
      a product decision (placement + wording) worth its own change. The core ask —
      see the result before committing — is delivered without it.
- [x] Phase 7: perf measured on a 52k-segment full selection (see below)
- [x] Validation: `npx tsc --noEmit`, eslint, full `vitest` (811 tests), `cargo fmt --check`,
      `cargo clippy --workspace --all-targets -D warnings`, `cargo test -p oristudio-cp`
- [ ] Browser check (author): move/copy 2-point and 4-point, ghost tracks the cursor, commit matches the ghost, Escape cancels cleanly, no stale ghost after switching tools

### Measured cost

On a 52,000-segment selection (everything selected — the worst case):

| | cost |
| --- | --- |
| Ghost snapshot (copy) | 5.5 ms, once per gesture |
| Ghost update (copy) | **0.17 ms per pointer move** |
| Full stroke rebuild (move) | 2.75 ms per pointer move |

The copy path is effectively free because only the selected endpoints are touched,
into preallocated arrays. The move path costs a full stroke rebuild — but that is
exactly what the shipped selection drag-move already did, unchanged by this work,
and it still fits a 16 ms frame. Not measured headlessly: the GPU re-upload
(`setData` recreates the instance buffers per call), which the browser check covers.

## Open decisions

1. **Copy ghost styling** — real M/V colours at reduced alpha (proposed) vs. the
   selection accent used by the existing drag-move.
2. **Gesture model** — keep click-click only, or also accept press-drag-release for
   the 2-point variants (Phase 5, proposed).
3. ~~**4p preview**~~ — decided: yes, ghost the 4-point tools too, live from the third
   point with the cursor as the fourth. Oriedita shows no ghost there, so this is a
   deliberate superset; committed geometry is identical either way.
