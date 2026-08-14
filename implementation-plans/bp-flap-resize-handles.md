# BP flap resize handles

## Goal

A selected flap in the BP Editor (packing pane) grows drag handles. Dragging one
resizes the flap's footprint on the paper directly, instead of typing numbers
into the `R / W / H` pill.

The point is not "a second way to set width". A flap's drawn extent is governed
by **three** numbers — radius, width, height — and only one of them (the radius)
is the origami-meaningful one. So a handle drag states *where the edges should
land*, and the feature solves for the three numbers behind it: **a corner resizes
the flap, making it as round as its new bounds allow; an edge extends it, leaving
the radius alone.**

Requested behaviour, in the author's words: *"default to increasing the radius if
it can, and then just adding or subtracting the width or height necessary to make
the flap come out to look the way it should"* — and, on seeing the first build
get this wrong: *"if the width and height of the flap bounds are the same, and
divisible by 2, then just set radius and the width and height properties should
be 0."* And, on the first build of that: *"dragging on the horizontal and
vertical handles doesn't work at all and has really weird behavior."* Both are
answered by splitting the corner verb from the edge verb — see "Why an edge
cannot also maximise the radius".

## Background — the geometry this rests on

**A flap's drawn extent is the clearance rounded-rect, not its `width × height`
rectangle.** Box Pleating Studio draws it in `Flap.$drawCircle`
([flap.ts:251](../third_party/box-pleating-studio/src/client/project/components/layout/flap.ts:251)):

```ts
graphics.drawRoundedRect(x - r, y - r, w + r + r, h + r + r, r);
```

We port that exactly in `bpPackingFlapClearanceRect`
([bpPackingViewport.ts:202](../apps/web/src/lib/bpPackingViewport.ts:202)). So
for anchor `(x, y)`, box `w × h` and radius `r`, the outer box is

```
[x - r, x + w + r] × [y - r, y + h + r]      →   W = w + 2r,   H = h + 2r
```

and it degenerates to a true circle at `w = h = 0`, which is what an ordinary
flap is.

**The radius is a tree edge length, not a flap field.** `Flap.radius` upstream is
a proxy for `$edge.length` ([flap.ts:127](../third_party/box-pleating-studio/src/client/project/components/layout/flap.ts:127));
we do the same through `bpFlapRadius`
([oristudioBpSnapshotMapper.ts:663](../apps/web/src/engine/oristudioBpSnapshotMapper.ts:663)).
So changing a radius is a **tree** edit (`update_edge_length`,
[project_session.rs:194](../crates/oristudio-bp/src/engine/project_session.rs:194)),
changing `w`/`h` is a **layout** edit (`resize_flap`,
[project_session.rs:489](../crates/oristudio-bp/src/engine/project_session.rs:489)),
and moving the anchor is a third (`move_flaps`,
[project_session.rs:400](../crates/oristudio-bp/src/engine/project_session.rs:400)).
**One handle drag touches all three.** That is the central implementation fact of
this feature and the reason it is not a small change.

**Everything must stay integral.** `create_junction`
([layout.rs:108](../crates/oristudio-bp/src/layout.rs:108)) derives the overlap
`o = distance − s` from flap AABBs and tree distances; `single_overlap_devices`
hard-errors on a fractional `ox`, and that error escapes the *whole* graphics
snapshot, not just one gadget. So `x`, `y`, `w`, `h` and every edge length must
be exact integers. See the `bp-flap-coords-must-be-integral` note — this is the
invariant that most constrains the solve below.

**Upstream has no such handles.** `flap.vue` is a name field plus three
`NumberVue`s, and `Flap` sets up its hit test on the shade only
(`$setupHit(this._shade)`), which drags the whole flap. This is an original
feature on top of the port, in the same class as reference images — so there is
no parity obligation for the *gesture*, and a hard obligation for every number it
writes (the resize rule `_testResize`, the constrain rule, integrality, the
symmetric-pair rule).

## The solve

### What a handle drag means

Handles sit on the **outer (clearance) box**, eight of them, with the same sign
convention as the CP overlay's `HANDLE_SIGNS`
([annotationTransform.ts:101](../apps/web/src/cp-workspace/annotations/annotationTransform.ts:101)),
in *grid* space (y up):

| Handle | `sx` | `sy` | Drives |
| --- | --- | --- | --- |
| `e` / `w` | ±1 | 0 | outer width only |
| `n` / `s` | 0 | ±1 | outer height only |
| `ne` `nw` `se` `sw` | ±1 | ±1 | both |

The opposite edge/corner is pinned, as in every resize gesture anywhere. The
pointer is already rounded to the integer grid by `eventToPackingPoint`
([BpPackingPanel.tsx:947](../apps/web/src/components/panels/BpPackingPanel.tsx:947)),
and the outer edges are integers because `x`, `w`, `r` are — so the requested
deltas `Δx`, `Δy` (signed change in outer **width** and outer **height**) are
integers for free.

### Where the flap ends up

The pinned edge is the one the handle is *not* dragging, so the new outer box
hangs off it and the anchor is that edge plus the new radius:

```
outerX′ = sx === -1 ? outerX + W − W′ : outerX          x′ = outerX′ + r′
outerY′ = sy === -1 ? outerY + H − H′ : outerY          y′ = outerY′ + r′
```

**A resize gesture moves the flap.** The anchor is the box's lower-left corner,
not a centre, so growing the radius walks it outward even on an axis the handle is
not dragging — a north drag that grows the radius moves the anchor east to hold
the left and right edges still. Forgetting this is the most likely way to ship a
flap that drifts, and it is why the result carries an anchor and why the kernel
takes the whole footprint in one call.

### Choosing the radius: a corner resizes, an edge extends

```
W′ = W + Δx        H′ = H + Δy

corner:  r′ = clamp(floor(min(W′, H′) / 2), rMin, rMax)
edge:    r′ = r

w′ = W′ − 2r′      h′ = H′ − 2r′
```

**A corner makes the flap as round as its new bounds allow; an edge leaves the
radius alone and puts the change into the box on the axis it drags.** So
dragging a corner out to a `6 × 6` box gives a plain `r3` circle rather than
`r2` around a `2 × 2` base, and pulling the east edge simply makes the flap
longer that way — pushing it back in eats the box and stops at the circle.

The radius is the only one of the three numbers that means anything in the folded
model, which is why the corner — the gesture that means *resize this flap* — is
the one that moves it.

### Why an edge cannot also maximise the radius

These two are **mutually exclusive**, and it is worth writing down because the
first three attempts all foundered on not seeing it:

> Every state is "biggest circle plus leftovers" **⟹** an edge drag restructures
> the perpendicular axis.

Proof: under `r = floor(min(W,H)/2)` an edge drag changes one extent. When that
extent is the smaller one the radius follows it, and `h = H − 2r`, so a radius
that steps by one steps the *perpendicular* box by two.

Measured before this change, on a real design: a `0 × 0 r2` flap pulled one cell
in from the east came back as `r1` with a `1 × 2` box — the flap's length halved
from a nudge that never touched its height. A sweep of the solver found 69 such
swaps and 173 dead drags (every inward edge drag on a default `0 × 0 r1` flap
returned nothing at all).

A corner has no such problem: both extents move together, the minimum moves with
them, and every number changes by at most one per cell.

**The cost.** Two perpendicular edge drags can leave a flap whose radius is not
maximal, and the next corner drag snaps it. That is a one-off restructure on the
gesture that means "resize", which is a better place for it than on every "make
it a bit longer".

Worked examples, all integral:

| Start `(w,h,r)` | Handle | Δ | Result | Reads as |
| --- | --- | --- | --- | --- |
| `(0,0,1)` | `ne` | `+4,+4` | `(0,0,3)` | a `6 × 6` box is a circle |
| `(0,0,1)` | `ne` | `+5,+5` | `(1,1,3)` | odd side: parity leaves one cell in the box |
| `(0,0,2)` | `ne` | `+3,+1` | `(3,1,2)` | non-square: the short side caps the radius |
| `(0,0,5)` | `e` | `+2,0` | `(2,0,5)` | an edge extends; the radius is untouched |
| `(0,0,5)` | `e` | `−2,0` | refused | there is no box to eat, and an edge never takes the radius |
| `(4,0,5)` | `e` | `−9,0` | `(0,0,5)` | it eats the box and stops at the circle |
| `(4,4,2)` | `e` | `+3,0` | `(7,4,2)` | every cell lands in the box, one for one |
| `(0,0,1)` | `e` | `−1,0` | refused | already at the floor |

### An earlier rule, and why it went

The first build spent the *delta* on the radius rather than maximising it:
`δ = clamp(floor(Δdrive / 2), 1 − r, min(floor((w + Δx)/2), floor((h + Δy)/2)))`.
It was chosen to avoid rewriting a flap's deliberate `w × h`, and it was wrong on
its own terms:

- The bound is per-axis, so the axis that moved *less* capped the radius and one
  odd cell capped it at zero. A hand-dragged corner almost never lands both axes
  on the same even count, so the radius was effectively unreachable by the
  gesture that most obviously means *make this flap bigger*.
- Relaxing that for growing axes fixed the reachability but bought an overshoot:
  the shorter axis of an off-square corner drag landed up to a cell past the
  pointer.
- And it was not reversible across gestures, because the answer depended on the
  flap as well as the box.

Maximising the radius is better on all three counts at once. The one thing it
gives up is the `w × h` it was protecting — which was never the thing being
asked for.

### Parity

`W = w + 2r`, so a box of odd side cannot be a circle — the `floor` leaves that
one cell in `w` or `h`. It is the only reason a square box ever keeps a box at
all, and it is why `5 × 5` comes out as `r2` with a `1 × 1` base rather than
`r2.5`.

### Feasibility and clamping

A step is admissible when the box it implies is non-negative **and** the
resulting flap passes the sheet rule. Two gates, in this order:

1. `w′ ≥ 0` and `h′ ≥ 0`. Maximising the radius satisfies these on its own
   unless `rMin` forces the radius up — an outer box below `2 × 2` — or the flap
   has no leaf edge, so its radius is pinned and cannot make room.
2. `bpPackingCanResizeFlap(anchor′, w′, h′, sheet)`
   ([bpPackingViewport.ts:459](../apps/web/src/lib/bpPackingViewport.ts:459)) —
   the client mirror of `validate_flap_with_sheet`
   ([project_session.rs:1667](../crates/oristudio-bp/src/engine/project_session.rs:1667)):
   at most one of the four corner dots may fall outside the sheet. **Use the new
   anchor**, not the old one; the anchor moved.

When a step fails, **clamp rather than refuse** — walk `Δ` back toward zero one
cell at a time (deltas per frame are single digits; a linear scan is cheaper than
being clever) and use the largest admissible one, so the handle stops at the
sheet edge instead of freezing the gesture. A drag that is inadmissible at every
non-zero `Δ` is a no-op step, not an error and not a toast: BP Studio's own
resize setters silently early-return
([flap.ts:139](../third_party/box-pleating-studio/src/client/project/components/layout/flap.ts:139)).

### Symmetry

Mirror draw is not optional here — the existing resize already carries the
partner, and a pair whose boxes are not mirror images is rejected outright by the
optimizer (`validate_dimensions`).

- The partner's radius is the **same** number (a reflection preserves length),
  and it arrives through the mirrored *edge*, which
  `setOristudioBpTreeEdgeLength`
  ([oristudioBpSlice.ts:1039](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:1039))
  already resolves and applies.
- The partner's `w`/`h` **swap under a diagonal axis** — exactly what
  `resizeOristudioBpLayoutFlap`
  ([oristudioBpSlice.ts:1123](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:1123))
  already does via `optimizerSymmetryAxisSwapsDimensions`.
- **The partner's anchor must be mirrored with the *post*-resize box.**
  `mirrorBpFlapAnchor`
  ([bpPackingSymmetry.ts:202](../apps/web/src/lib/bpPackingSymmetry.ts:202))
  takes a `FlapBox` because the anchor is a corner and the reflection picks up
  the size term; `buildMirroredBpFlapMoves`
  ([bpPackingSymmetry.ts:504](../apps/web/src/lib/bpPackingSymmetry.ts:504))
  reads that box off the *current* flaps, which is correct for a pure move and
  **wrong for a reshape**. Either thread an override box through, or add a
  reshape-specific builder. A partner off by exactly the flap's width is the
  signature of getting this wrong, and it looks plausible on a small flap.

**A self-mirrored (on-axis) flap is the sharp edge.** `projectBpFlapAnchorOntoAxis`
([bpPackingSymmetry.ts:236](../apps/web/src/lib/bpPackingSymmetry.ts:236)) puts a
vertical-axis flap at `x = centerX − w/2`. With `centerX = sheetWidth / 2` that is
integral only when `w′ ≡ sheetWidth (mod 2)` — so **only an even `Δx` keeps a
self-mirrored flap on the grid**, and an odd one lands it at `x.5`, which is the
exact failure the integrality note records (a fractional anchor kills the whole
snapshot, silently, leaving circles and dots on screen with no toast). Quantise
the driven delta to 2 for a self-mirrored flap on a book fold; for a diagonal
fold only a square flap is self-mirrored at all
([`isBpFlapOnAxis`](../apps/web/src/lib/bpPackingSymmetry.ts:269)), so require
`Δx === Δy` there. This is worth a test per axis.

## Approach

Three phases. Phase 1 is where the risk is; phases 2 and 3 are conventional.

### Phase 1 — one engine call for the whole reshape

The frontend-only route is to compose the three existing runtime calls per drag
step. **Do not do that**, for a correctness reason rather than a performance one:
`resize_flap` does not move the flap, and `move_flaps` constrains its target
against the sheet using the flap's *current* dimensions. Whichever order you pick
there is an intermediate state — new size at the old anchor, or the new anchor at
the old size — that can fail `validate_flap_with_sheet` even when the final state
is perfectly legal. A flap being resized against the sheet edge would reject
steps it should accept, and the failure depends on drag direction.

The performance argument points the same way. The packing pane already round-trips
the whole engine refresh once per frame and measures **~206 ms p50 at 38 flaps**
(`bp-tree-drag-perf-root-cause`); mirroring doubles it. A composed reshape would
be up to *six* round trips per frame.

So add a combined op:

```rust
pub fn reshape_flap(
    &mut self,
    id: NodeId,
    anchor: Point,
    width: f64,
    height: f64,
    radius: Option<ReshapeRadius>,   // edge length + the leaf's new tree position
    dragging: bool,
) -> BpResult<UpdateModel>
```

It has upstream precedent in shape: `Flap.$manipulate(x, y, width, height)`
([flap.ts:203](../third_party/box-pleating-studio/src/client/project/components/layout/flap.ts:203))
exists for exactly this — position and size committed together, with one history
entry per changed field. It composes primitives we already ported rather than
approximating anything, which is what the porting rules ask.

Implementation notes:

- One `DesignUpdateRequest` carrying **both** `flaps` and `edges`
  ([project_session.rs:507](../crates/oristudio-bp/src/engine/project_session.rs:507)) —
  the request already takes both, so the whole reshape is a single solve.
- Reuse `validate_flap_with_sheet` and `edge_max_length` unchanged. Validate
  *before* touching the session so a rejected reshape leaves nothing half-applied.
- Record the same history field-changes the granular ops do (`width`, `height`,
  the edge `length`, the move), under `set_dragging(dragging)` so mid-gesture
  steps coalesce the way a move drag's do.
- Thread `dragging` through. `resize_flap` currently hardcodes `dragging: false`
  in its update request, which forces a full stretch-repository rebuild every
  step ([layout.rs:996](../crates/oristudio-bp/src/layout.rs:996) is the cache
  path `dragging` unlocks). Leave `resize_flap` alone — the pill is a discrete
  commit and wants exactly that.
- `radius: None` covers a flap whose leaf edge is missing (`bpFlapRadius`'s
  `max(w,h)/2` fallback). Then the radius is pinned and the gesture is a plain
  `w`/`h` resize; the outer-box promise does not hold for such a flap because its
  drawn radius is derived from its box. Rare — the engine keeps flap ⟺ leaf — but
  it must not throw.

Then `bp_reshape_layout_flap` in the wasm bridge, the worker method, and
`reshapeOristudioBpLayoutFlap` in `oristudioBpRuntime.ts`.

**Rebuild the bridge before trusting the browser**: `apps/web/src/generated/` is
untracked and a body-only kernel edit leaves lint/tsc/vitest passing over a stale
`.wasm`.

```bash
npm --workspace @treemaker/web run build:oristudio-bp-wasm
```

### Phase 2 — the solver and the store action

`apps/web/src/lib/bpFlapReshape.ts` — pure, no React, no store:

```ts
export interface BpFlapReshape { anchor: Point; width: number; height: number; radius: number }

export function solveBpFlapReshape(input: {
  flap: OristudioBpFlap;
  handle: BpFlapResizeHandle;      // 'n' | 'ne' | … , same eight as the CP overlay
  outerDelta: Point;               // requested (Δx, Δy) in grid units
  radiusRange: { min: number; max: number } | null;   // null ⇒ radius not editable
  sheet: OristudioBpSheet;
  selfMirroredAxis: OptimizerSymmetryAxis | null;     // parity constraint, see above
}): BpFlapReshape | null;
```

Everything above lives here: the radius choice, both feasibility gates, the
clamp, the self-mirror parity quantisation. It returns `null` for a step that reduces to
a no-op. Sibling of `annotationTransform.ts`, which is the shape to copy —
camera-agnostic maths with its own tests, no knowledge of the gesture.

Store: `reshapeOristudioBpFlap(id, reshape, dragging)` in `oristudioBpSlice.ts`,
written at the **runtime** level like its neighbours, not by composing the three
existing store actions — those each open their own `runBpTreeMutation` and would
give three undo entries per step. One `runBpTreeMutation`, partner resolved once
via `bpMirrorPartnerId`, both calls inside, label `Resized BP flap` /
`Resized mirrored BP flaps`.

Drag transport: a third channel in `useBpPackingDragRequests`
([useBpPackingDragRequests.ts](../apps/web/src/hooks/useBpPackingDragRequests.ts))
alongside flap and device — one request per frame, deduped, chained, with an
unconditional `dragging: false` flush on release. It needs its own
`sameBpReshapeUpdate` comparator in `bpPackingDragRequests.ts` (compare anchor,
box and radius; the position comparator alone would drop a pure-radius step).

Leave the tree's length-faithful reposition
(`edgeLengthRepositions`, [dragRule.ts:35](../apps/web/src/tree-editor/dragRule.ts:35))
**off the mid-drag steps and apply it on release only.** It is a tree-*drawing*
correction; the tree pane showing an edge drawn at the old length for the
duration of a packing-pane gesture is a smaller cost than an extra engine call
per frame. Say so in a comment, because it looks like an omission.

### Phase 3 — the chrome

`apps/web/src/components/panels/BpFlapResizeHandles.tsx`, mounted from
`BpPackingPanel` next to the flap-shade group and gated on the same
`singleSelectedFlap` the pill already uses
([BpPackingPanel.tsx:1858](../apps/web/src/components/panels/BpPackingPanel.tsx:1858)).
`apps/web/src/hooks/useBpFlapResize.ts` holds the gesture state and the store
binding — the panel gets a mount and a branch, nothing else. It is at a raised
`max-lines` cap of 2055 already
([eslint.config.js:193](../apps/web/eslint.config.js:193)) and the panel table in
`AGENTS.md` puts both of these outside it.

Rendering rules that are not optional:

- **Above the flap shades.** `.bp-packing-flap-shade` is the flap's own hit
  target and is drawn over the flap graphics
  ([BpPackingPanel.tsx:1749](../apps/web/src/components/panels/BpPackingPanel.tsx:1749));
  handles rendered under it never receive a pointer.
- **Outside `sheetClipPath`.** The geometry layers are masked to the sheet when
  Outside-paper is off, exactly as upstream masks them; a corner flap's handles
  would be clipped away. Dots and labels already escape the mask for the same
  reason — follow them.
- **Independent of the Clearance layer toggle.** Handles are selection chrome,
  not a drawing layer. When `layers.clearance` is off, draw a faint outline of
  the outer box *while dragging only*, so the handle is not floating in space.
- **Screen-constant size.** Handle squares sized from `zoomPercent` (the pane
  already derives `unit` and `zoomPercent`), not from grid units.
- **Hidden when they cannot be used**: multi-selection, `oristudioBpBusy`, a
  flap-body drag in progress, or an outer box smaller on screen than roughly
  `4 × HANDLE_SIZE` — below that the eight handles overlap each other and the
  body, and a click meant to move the flap resizes it instead.
- Cursors `ew-`/`ns-`/`nesw-`/`nwse-resize`. Grid y is up and screen y is down,
  so a grid-north handle is screen-up; get the mapping from
  `bpPackingRectToSvg`'s output rather than reasoning about it.
- `pointerdown` must **not** write store state — a reflow between `pointerdown`
  and `mousedown` is what silently killed the BP toolbar buttons
  (`bp-pointerdown-reflow-drops-clicks`). Capture the pointer, set local gesture
  state, and let the first engine call come from the first `pointermove`.

Escape cancels: restore the gesture's start `(anchor, w, h, r)` through one
`dragging: false` reshape and drop the pending history entry. Install the
listener **for the duration of the gesture** on `window`, not as a container
`keydown` — the panel is on the legacy-keydown exemption list and should not grow
another one.

## Interaction details worth deciding once

- **Deltas are measured from the gesture start**, never accumulated per step.
  This is what makes a drag out-and-back within one gesture land exactly where it
  started, and it costs nothing.
- **Across separate gestures the map is not invertible**, and cannot be made so
  by any memoryless rule: `(w, h, r) → outer box` is many-to-one. Dragging a
  `4×4 r2` flap out one gesture and back in another leaves `(2,2,3)`, not
  `(4,4,2)`. This is accepted, not a bug; the pill's `R / W / H` fields, which
  stay live throughout, are the exact-values escape hatch. Do not add drag
  history to paper over it.
- **The pill is the readout.** It re-renders from the returned snapshot, so the
  three numbers move under the cursor during the drag. That is most of the
  feature's discoverability — it teaches the rule by showing it.
- One `track()` on gesture **commit**, never per sample: `{ handle: 'e' | 'ne' |
  …, radius_changed: bool, mirrored: bool }` — enums and booleans only, per
  `docs/analytics.md`.

## Non-goals

- **River width handles.** A river's width is its internal edge's length and
  `BpRiverEditor` already edits it; the same gesture would be a reasonable
  follow-up but shares none of the three-way solve.
- **BP Studio's `d.wi` / `d.wd` / `d.hi` / `d.hd` / `d.ri` / `d.rd` hotkeys**
  ([flap.vue:17](../third_party/box-pleating-studio/src/app/vue/panel/flap.vue:17)).
  Still worth having; they belong in `keyboard/`, not here.
- **Alt-to-resize-about-centre and a modifier that suppresses the radius
  preference.** Both are cheap once the solver exists (pinning `r′` to the flap's
  current radius is the whole second one). Hold them until the browser pass says the default rule needs an
  escape hatch.
- Optimizer behaviour, which stays out of scope for BP Editor work.

## Affected Areas

**New**

- `crates/oristudio-bp/src/engine/project_session.rs` — `reshape_flap`.
- `crates/oristudio-bp-wasm/src/lib.rs` — `bp_reshape_layout_flap`.
- `apps/web/src/lib/bpFlapReshape.ts` + `.test.ts` — the solver.
- `apps/web/src/hooks/useBpFlapResize.ts` — gesture state, store binding.
- `apps/web/src/components/panels/BpFlapResizeHandles.tsx` + `.test.tsx`.

**Edited**

- `apps/web/src/store/workspaceStore/oristudioBpRuntime.ts` — the runtime wrapper
  and the worker method beside `resizeOristudioBpLayoutFlap`
  ([:481](../apps/web/src/store/workspaceStore/oristudioBpRuntime.ts:481)).
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` +
  `types.ts` — `reshapeOristudioBpFlap`, mirrored, one history entry.
- `apps/web/src/lib/bpPackingSymmetry.ts` — mirror a reshape with the post-resize
  box (an override on `buildMirroredBpFlapMoves`, or a sibling builder).
- `apps/web/src/hooks/useBpPackingDragRequests.ts` +
  `apps/web/src/lib/bpPackingDragRequests.ts` — the reshape channel and its
  comparator.
- `apps/web/src/components/panels/BpPackingPanel.tsx` — mount and gate. A branch
  and a mount, nothing more.
- `apps/web/src/styles/theme.css` — `.bp-packing-flap-handle` and the dragging
  outline, beside the existing flap classes at ~7275.
- i18n: handle `aria-label`s → `i18n:extract` → 8 locales → `i18n:stamp` →
  `i18n:check`.

**Not touched**: the `.osf` / `.bps` schema (nothing new is persisted — this
writes fields that already exist), the optimizer, the tree pane.

## Risks

- **A fractional anchor from the self-mirror projection.** Highest-consequence
  failure and it fails *silently* — creases and conflicts vanish, circles and
  dots remain, no toast. Mitigated by the parity quantisation above and a test
  per axis. If BP geometry disappears during QA, suspect this first.
- **The mirrored anchor's size term.** Highest-*probability* defect. Test with a
  deliberately non-square flap on all four axes, where an anchor-only reflection
  is visibly wrong.
- **Cost per drag step.** Even with the combined op this is one full engine
  refresh per frame on a pane that already measures ~206 ms p50 at 38 flaps.
  Measure before adding anything; if it is unusable, the lever is the assembler
  in `oristudioBpRuntime.ts` (the crease-pattern snapshot alone is ~43 ms and
  nothing displays it mid-drag), not this feature.
- **`activeSurface` churn.** `setOristudioBpTreeEdgeLength` passes
  `activeSurface: 'tree'` ([oristudioBpSlice.ts:1057](../apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:1057)),
  so today editing `R` in the packing pill flips the document's active surface to
  the tree. Harmless once; per-frame during a drag it is not. The reshape action
  must pass `activeSurface: 'packing'`.
- **Verification ceiling.** The automated Browser pane runs with zero `rAF`
  (`browser-pane-suspends-raf`) and both the drag throttle and this gesture
  depend on it, so **the drag itself cannot be driven there**. Solver, store and
  engine behaviour are fully testable; the gesture needs a human.

## Checklist

### Phase 1 — engine

- [x] `reshape_flap` on `ProjectSession`: one `DesignUpdateRequest` with both
      `flaps` and `edges`, `dragging` threaded, validation before mutation,
      history field-changes matching the granular ops.
- [x] `radius: None` path for a flap with no leaf edge — no panic, no throw.
- [x] Rust tests beside `resize_flap`'s (`tests/engine.rs:536`): accepts what
      `resize_flap` + `move_flap` + `update_edge_length` jointly accept, rejects
      the one-tip-off-sheet case, no-ops on an unchanged reshape, respects
      `edge_max_length` and `length ≥ 1`.
- [x] `bp_reshape_layout_flap` wasm export; worker method; runtime wrapper.
- [x] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
      `cargo test -p oristudio-bp` (all green). Oracle parity is untouched — no
      ported behaviour changed, only a new composite op over existing
      primitives.

### Phase 2 — solver + store

- [x] `lib/bpFlapReshape.ts`: the radius rule, both feasibility gates, the clamp,
      self-mirror parity.
- [x] Solver tests: the six worked examples in the table above; every one of the
      eight handles; the anchor shift when `Δ = 0` on the un-driven axis;
      `w′,h′,r′` all integral for every case; within-gesture inverse
      (`solve(Δ)` then `solve(0)` returns the start); the `r = 1` floor; `rMax`;
      `radiusRange = null`; diagonal sheet; the at-most-one-tip boundary in
      lockstep with `validate_flap_with_sheet`.
- [x] `reshapeOristudioBpFlap` in the slice + `types.ts`: one
      `runBpTreeMutation`, `activeSurface: 'packing'`, partner resolved once,
      dimension swap on a diagonal axis, partner anchor mirrored with the
      **post**-resize box, partial mirror when no partner resolves.
- [x] Store test on the `oristudioBpSymmetricFlapMove.test.ts` harness: two
      runtime calls with the right values, one history entry, no-op with mirror
      off, tree sheet ≠ layout sheet, self-mirrored flap stays on the grid.
- [x] Reshape channel in `useBpPackingDragRequests` + `sameBpReshapeUpdate`,
      with the existing channel tests extended.

### Phase 3 — chrome

- [x] `BpFlapResizeHandles` + `useBpFlapResize`; panel gets a mount, a hook call,
      a store binding and one more drag verb. `max-lines` raised 2055 → 2080 with
      the reason in `eslint.config.js`.
- [x] Layering: above the shades, outside the sheet clip, independent of the
      Clearance toggle, screen-constant size, hidden below the size floor and on
      multi-select / busy.
- [x] No store write on `pointerdown`.
- [x] Escape cancels through a gesture-scoped `window` listener; no new container
      `keydown`.
- [x] Component tests (`BpFlapResizeHandles.test.tsx`, hook and layer together):
      all eight handles for a selected flap and none without one; a drag sends a
      *footprint* and settles once on release; a grab that never moved settles
      nothing; Escape restores the start footprint and the listener goes away
      with the gesture; no handles when the box is too small or the flap is its
      own mirror.
- [x] CSS beside the existing `.bp-packing-flap*` rules; both themes.
- [x] Analytics event on commit, enums only.
- [x] i18n round trip; `npm run i18n:check` green.
- [x] `npm run lint:web`, `npx tsc --noEmit` and `vitest` **in `apps/web`** (the
      repo root has no vitest config), `npm run build:web` if bindings changed.
- [x] Rebuild `build:oristudio-bp-wasm` before any browser check.

### Shipped smaller than planned, on purpose

- **A self-mirrored flap declines the handles.** The plan's parity quantisation
  (only an even `Δ` keeps such a flap on the grid) turned out to be the *smaller*
  half of the problem: pinning the opposite outer edge is incompatible with
  staying centred on the axis, so a correct gesture there is a second solve —
  symmetric growth about the line, with its own parity rule and its own tests —
  for a case that is real but secondary. The handles are simply not drawn for
  one, `useBpPackingSymmetry.selfMirrored` is the gate, and its `R / W / H`
  fields still work. A scoped follow-up, not a silent wrong answer.
- **Handles are sized in SVG units, not screen pixels**, so they scale with the
  camera exactly as the flap dots and labels already do. The too-small gate is a
  test of *relative* size — handles and flap scale together — so zoom cancels out
  of it and no `zoomPercent` is needed.

### Browser pass (Zach — a full pointer drag cannot be driven in the automated pane)

Verified here, through the real hook and the real engine, by dispatching the
handle's own pointer handlers: eight handles land exactly on the clearance box;
an east drag of three cells widened the box by three and left the radius alone
(no height to trade); a north drag of two then moved the radius `1 → 2` with the
width paying `4 → 2`, holding the outer box exactly as wide while it grew two
taller; the tree's leaf edge relabelled `1 → 2` with it. No console or server
errors. What is left below needs a human at a real pointer.


- [ ] Drag each of the eight handles on a plain circular flap and on a
      deliberately non-square one; the outer box tracks the cursor exactly.
- [ ] The `R / W / H` pill updates live and agrees with the drawing at every step.
- [ ] Out-and-back within one gesture returns to the start exactly.
- [ ] A flap against the sheet edge stops at the edge instead of freezing.
- [ ] Mirror draw on: the partner reshapes correctly on a book fold and on a
      diagonal fold; an on-axis flap stays centred and creases keep rendering.
- [ ] Undo is one step per gesture; redo restores it.
- [ ] The Clearance layer off, and Outside-paper both ways.
- [ ] Judge the odd-cell width wobble. If it reads badly, the fix is the
      second-cell snap described under Parity — and only then.
