# Square: one click, one square

## Goal

A generator that puts a square on the paper in a single click.

Today the nearest thing is Regular Polygon with corners set to 4: you draw one
*side* of the square with two clicks, and the polygon walks the remaining three.
That is the right tool for an arbitrary N-gon at an arbitrary angle, and the wrong
one for the thing people actually reach for — a grid-aligned square of a size they
already know.

After: pick **Square** in Generate, set its size once, and every click drops a
square of that size where you clicked. The size, its unit, the square's
orientation, which corner the click lands on, and what line type the edges get are
all persisted tool params, so the tool keeps working the way you left it.

## Approach

### It is a new kernel operation, not a re-dressed polygon

The cheap version of this is a second rail button that resolves the square's four
corners in the frontend and dispatches `PolygonSetNoCorners` with `corners: 4`.
No Rust, no wasm rebuild. It is rejected, for one structural reason:

**tool settings are keyed by operation, not by action.** `TOOL_SETTING_GROUPS_BY_OPERATION`
in `lib/oristudioCpToolSettings.ts` maps an `OperationId` to the groups its params
panel renders, and `PolygonSetNoCorners` already claims `polygon-corners`. A
square button behind that operation would show the polygon's *Corners* stepper and
have nowhere to put its own five params. Making settings action-keyed to work
around it means restructuring a module that is currently one clean table, in
service of pretending two tools are one.

There is also precedent pointing the other way: `VertexSolveFoldAngles` is an Ori
Studio-native operation (`OriStudioSolveVertexFoldAngles`, no Oriedita
counterpart) sitting in the same registry as the ported ones. Native operations
are a thing this kernel already has, and every registry in the stack — commands,
actions, input models, settings, icons — is built around one operation per tool.
Going with the grain costs a wasm rebuild and buys a tool that behaves like every
other tool.

So: `OperationId::SquareGenerate`, target
`operations::native::square::square_at_anchor`.

### Marking the boundary: native operations become a declared thing

This is a superset feature, and the kernel currently has no way to say so. Three
operations are already Ori Studio originals — `CreaseSetLineColor`,
`CreaseSetFoldAngle`, `VertexSolveFoldAngles` — and the only thing marking them is
that someone wrote `"OriStudioSetLineColor"` into a field whose doc comment reads
*"Pinned Oriedita source element."* That is a naming convention doing a type's
job, and it is exactly the thing that rots.

Three changes make the boundary explicit, in descending order of how much they
buy:

**1. A directory that is by definition not parity-bound.**
`operations/mod.rs` opens with *"Oriedita-compatible non-UI crease-pattern
mutations"* — every module under it is a port, so appending a square generator to
`generators.rs` (a port of Oriedita's generator handlers) puts original code
inside a file a future reader will diff against `third_party/oriedita`.

```
crates/oristudio-cp/src/operations/
  generators.rs      // ported: Oriedita's POLYGON_SET_NO_CORNERS_29, molecules, Voronoi
  native/
    mod.rs           // //! Ori Studio original operations. No upstream, no parity obligation.
    square.rs
```

The path itself answers "is this parity-relevant?" before anyone reads a line.

**2. An `origin` on the descriptor, so the tag is data rather than a prefix.**

```rust
pub enum OperationOrigin {
    /// Ported from Oriedita. `upstream` pins the source element and the
    /// behaviour is parity-bound: change it only against `third_party/oriedita`.
    Oriedita,
    /// Ori Studio original. `upstream` names our own action; there is no
    /// upstream to be in parity with, and no oracle covers it.
    OriStudio,
}
```

A second macro arm keeps the ~100 ported entries untouched and makes the tag one
unmissable token at the call site:

```rust
descriptor!(native SquareGenerate, "OriStudioSquareGenerate",
            "operations::native::square::square_at_anchor", Kernel, 8, UnitTested),
```

Retag the three existing natives in the same change — that is the payoff. The
boundary stops being a string convention and becomes something you can filter,
assert on, and show in the UI.

**3. One guard test, so the two markers cannot drift apart.**

```
every descriptor whose target starts with `operations::native::`
    has origin == OriStudio
every descriptor with origin == OriStudio
    has an upstream starting with "OriStudio"
```

Deliberately one-directional on the first: the three existing natives live in
ported modules (`operations::color::set_line_color_for_indices`) and moving them
is a separate change. What the test guarantees today is that **nothing
parity-bound can hide in `native/`**, which is the direction that matters for new
code.

**What does *not* get a native path:** dispatch, payload, preview, the wasm
bridge, and every frontend registry. A native operation is an ordinary operation
that happens to have no upstream. Building it a parallel execution path would be
the real maintenance cost — the isolation is about provenance and parity
obligation, nothing else.

The three payload fields sit on the shared `CreasePatternCommandPayload` like
every other tool param, grouped under an `// --- Ori Studio native ---` comment.
A nested native bag would be the only nesting in a flat 25-field struct and would
have to be mirrored in TypeScript for no gain.

On the frontend the same convention is load-bearing in
`lib/oristudioCpCommands.ts`, so it gets the same treatment: an exported
`isNativeCpOperation()` derived from the `OriStudio` upstream prefix, with a test
pinning the expected set so adding a native op is a deliberate edit rather than a
silent one.

And `PORTING.md` gains a short section stating the rule, since that is the
document a future porting session actually reads.

### The two geometry decisions

**Orientation** is `Normal` (edges along the grid axes) or `Diagonal` (rotated
45°, a diamond). Both are ordinary paper directions and neither is a special case
of the other, so it is a param rather than a default.

**Anchor** is *where on the square's bounding box the click lands*, chosen from a
3×3 picker — the transform-origin widget everyone already knows:

```
┌───┬───┬───┐
│ ┌ │ ┬ │ ┐ │
├───┼───┼───┤
│ ├ │ ┼ │ ┤ │
├───┼───┼───┤
│ └ │ ┴ │ ┘ │
└───┴───┴───┘
```

**The two params are independent, and the picker never changes shape.** The nine
cells name positions on the *bounding box*, not on the square, which is what makes
that true.

The square has four corners in both orientations — Diagonal is the same square,
turned 45° — so all that changes is which cells of the picker those four corners
happen to sit under:

| Orientation | The square's four corners sit under the picker cells… |
| --- | --- |
| Normal | the four corner cells (top-left, top-right, bottom-left, bottom-right) |
| Diagonal | the four side cells (top-center, middle-left, middle-right, bottom-center) |

Picking `top-left` therefore never implies anything about orientation. It means
the square's bounding box has its top-left corner here — well-defined either way,
and in Normal orientation that point is also a corner of the square itself. Nine
stable options, one stable widget, no option list that mutates under you when you
flip the other control.

Default anchor: top-left. Default orientation: Normal.

### What "size" means

`size` is the square's **axis-aligned bounding extent** — its width, which equals
its height. In Normal orientation that is the side length. In Diagonal it is the
full diagonal, i.e. how many grid columns the diamond spans.

The alternative is "size is always the side length", which makes a diagonal square
of size 4 span 4·√2 ≈ 5.66 cells and land none of its vertices on the grid. The
bounding extent is what someone means when they say *an 8-square diamond*, and it
keeps the same number describing the same footprint in both orientations.

One consequence worth stating: in Diagonal orientation the four vertices sit at
±size/2 from the center along the axes, so they land on grid intersections when
`size` is **even** and on half-cells when it is odd. That is the geometry, not a
bug, and the size control steps by 1 so the common case is exact.

### Units are converted in the frontend

`size` is expressed in **grid cells** or **paper edges**, both persisted. The
kernel receives model units and knows nothing about either:

- grid cells → `size * gridWidth`, where `gridWidth = 400 / gridSize` (already on
  hand in `CreasePatternPanel` as `editableCpGridWidth`)
- paper edges → `size * ORIEDITA_PAPER_SIZE`

This is exactly how `ParallelDrawWidth` already handles its `width` param, and it
keeps the grid out of the kernel's square code.

Switching the unit converts the displayed number so the square keeps its size
(4 cells on an 8-grid becomes 0.5 paper edges), rather than reinterpreting 4 as
4 paper edges and silently asking for a square 32× too big.

### Line type: Edge by default, and the preview has to agree

The edges default to **Edge**, because a square is usually a boundary — but the
`Active line type` alternative is a persisted param, so someone drawing squares in
mountain gets that every time.

The trap here is the preview. `toolPreviewColor` in `CreasePatternPanel` is keyed
on `cpCommandUsesActiveLineColor`, so a square that commits as Edge while the
active type is Mountain would preview red and commit black. The fix is not to
touch the candidate-carries-a-crease machinery in `candidatePreviewGroups` — that
exists for the fold-angle solver's kernel-decided creases and this is not that.
It is one exported pure helper:

```ts
resolveSquareToolLineColor(options, effectiveLineColor): OristudioCpLineColor
```

called from exactly two places — the `payload.line_color` assignment and the
`toolPreviewColor` memo — so what you see is what commits, by construction.

### Kernel surface

```rust
pub enum SquareOrientation { Normal, Diagonal }
pub enum SquareAnchor { NorthWest, North, NorthEast, East, SouthEast, South, SouthWest, West, Center }

/// Ori Studio native: place an axis-aligned or 45°-rotated square of a given
/// bounding extent, positioned by one of its vertices (or its center).
pub fn square_at_anchor(
    model: &mut CreasePatternModel,
    anchor_point: Point,
    extent: f64,
    orientation: SquareOrientation,
    anchor: SquareAnchor,
    color: LineColor,
) -> usize
```

Four segments, added through `add_line_segment_like_worker` — the same primitive
`regular_polygon_no_corners` uses, so a square dropped onto existing creases
splits and merges into them the way every other generator's output does. A
non-finite or non-positive extent is `CommandError::InvalidInput`, not a silently
degenerate square.

Payload gains `square_extent`, `square_orientation`, `square_anchor`, all
`Option`, all `skip_serializing_if = "Option::is_none"` like their neighbours.

The preview branch mirrors the polygon's: build into a scratch
`CreasePatternModel`, hand back `line_segments`. It fires at `points.len() >= 1`,
so the square tracks the cursor before the click — which is the whole point of a
one-click tool whose result depends on five params you cannot see from the
cursor position.

### Where the params UI lives

`CpContextToolPanel.tsx` is capped at 1167 lines and a five-control group does not
fit under it. Per AGENTS.md, presentation belongs in a child component: the group
renders from `cp-workspace/toolOptions/SquareToolOptions.tsx`, and the panel gains
an import and a branch. That is composition, which is what the panel is for.

## Affected Areas

**Rust kernel** (`crates/oristudio-cp`)

- `operations/native/mod.rs`, `operations/native/square.rs` (new) —
  `SquareOrientation`, `SquareAnchor`, `square_at_anchor`, and unit tests
- `operations/mod.rs` — `pub mod native;`
- `lib.rs` — `OperationOrigin`, the `origin` descriptor field and the `native`
  macro arm, retagging the three existing natives, the drift guard test;
  `OperationId::SquareGenerate` and its descriptor; the three payload fields plus
  their accessors; the execute branch; the preview branch
- `PORTING.md` — the native-operation rule

**WASM** (`crates/oristudio-cp-wasm`) — no code change; the bridge is generic. The
built bindings under `apps/web/src/generated/` are **tracked** and must be rebuilt
and committed.

**Web registries** (`apps/web/src/lib`)

- `oristudioCpCommands.ts` — `SquareGenerate` in
  `ORISTUDIO_CP_SOURCE_MAP_OPERATION_IDS`, its `ready(...)` definition,
  membership in `LINE_COLOR_OPERATION_IDS`, and `isNativeCpOperation()`
- `oristudioCpActions.ts` — rail override: label `Square`, `railOrder: 10` (ahead
  of Regular Polygon's 60, so it opens the Generate section)
- `oristudioCpToolSettings.ts` — the `square` settings group, its five option
  keys, defaults
- `cpToolOptionPersistence.ts` — validators for all five keys

**Web surfaces**

- `cp-workspace/tools/inputModelRegistry.ts` — `{ model: 'point-sequence', pointCount: 1, snapPerStep: ['point'] }`
- `cp-workspace/tools/squareTool.ts` (new) — unit conversion, anchor resolution
  per orientation, `resolveSquareToolLineColor`; pure, unit-tested
- `cp-workspace/toolOptions/SquareToolOptions.tsx` (new) — the params UI
- `components/panels/CpContextToolPanel.tsx` — mount the group
- `components/panels/CreasePatternPanel.tsx` — payload fields, and route
  `toolPreviewColor` through the resolver
- `components/panels/CpToolRail.tsx` — import lucide `Square` and add it to
  `LUCIDE_ICONS` (only `SquareDashed` is imported today, so `commandIcon('square')`
  currently falls back to `CircleDashed`)

**i18n** — new `tools:` strings for the params UI; `cpVocab` regenerates from the
action's label/tooltip/steps. `i18n:extract`, translate all 8 locales,
`i18n:stamp`, `i18n:check`.

## Checklist

### Phase 0 — the native boundary

Standalone and reviewable on its own; nothing below depends on landing it first,
but it is much cheaper before a fourth native operation than after.

- [ ] `OperationOrigin` enum, the `origin` descriptor field, the `native` macro
      arm
- [ ] Retag `CreaseSetLineColor`, `CreaseSetFoldAngle`, `VertexSolveFoldAngles`
- [ ] Drift guard test (`operations::native::` ⇒ `OriStudio`; `OriStudio` ⇒
      `OriStudio*` upstream)
- [ ] `operations/native/mod.rs` with the doc comment stating the rule
- [ ] `PORTING.md` section on native operations
- [ ] Mirror `origin` in `engine/oristudioCpTypes.ts`; `isNativeCpOperation()`
      plus its pinned-set test

### Phase 1 — kernel

- [ ] `SquareOrientation` / `SquareAnchor` enums and `square_at_anchor` in
      `operations/native/square.rs`
- [ ] Unit tests: both orientations × all nine anchors land the four vertices
      where they should; size in model units; invalid extent rejected; the
      diagonal square's vertices land on grid multiples for even extents
- [ ] `OperationId::SquareGenerate` + `descriptor!(native …)` (`Kernel`, stage 8,
      `UnitTested`)
- [ ] Payload fields + accessors
- [ ] Execute branch (1 required point) and preview branch (`points.len() >= 1`)
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
      `cargo test --workspace`

### Phase 2 — bridge

- [ ] Rebuild the wasm bindings and commit the tracked output under
      `apps/web/src/generated/`
- [ ] `wasm-pack test --node` where the bridge is covered

### Phase 3 — registries and params

- [ ] Command definition, action override at `railOrder: 10`, input-model entry
- [ ] `square` settings group + the five tool options and defaults
      (`squareSize: 4`, `squareSizeUnit: 'grid'`, `squareOrientation: 'normal'`,
      `squareAnchor: 'nw'`, `squareLineType: 'edge'`)
- [ ] Persistence validators for all five, with tests for the round trip and for
      a stored anchor that does not belong to the stored orientation
- [ ] `squareTool.ts` + unit tests: unit conversion both ways, unit-switch
      conversion, anchor resolution per orientation, line-colour resolution
- [ ] `SquareToolOptions.tsx`, mounted from `CpContextToolPanel`
- [ ] Payload wiring and the shared `toolPreviewColor` resolver
- [ ] Lucide `Square` icon registered

### Phase 4 — validation

- [ ] `npx tsc --noEmit` and vitest directly (the npm wrappers regenerate wasm
      nondeterministically)
- [ ] `npm run lint:web`
- [ ] `i18n:extract` → translate 8 locales → `i18n:stamp` → `i18n:check`
- [ ] Registry coverage tests pass: `oristudioCpCommands.test.ts` (one UI command
      per source-mapped operation), `inputModelRegistry.test.ts` (entry present,
      counts match `toolSteps`), `CpContextToolReset.test.ts` (reset reaches every
      square option)

### Phase 5 — browser checklist (author-verified)

- [ ] Square appears first in the Generate rail section with a square icon
- [ ] Hovering previews the square before the click, in the line type it commits
- [ ] All nine anchor cells place the bounding box correctly, in both
      orientations, and flipping orientation leaves the anchor picker untouched
- [ ] Size in cells lands vertices on grid intersections (even sizes in Diagonal)
- [ ] Switching cells ↔ paper keeps the square the same size
- [ ] All five params survive a reload
- [ ] A square dropped across existing creases splits into them, like a polygon
      does

## Open question for review

**Diagonal `size` = bounding extent, not side length.** The rationale is in
Approach, and the alternative (side length) is defensible if the mental model is
"the same square, rotated" rather than "a diamond this many cells wide". Worth one
look before Phase 1 lands, because it is the only decision here that is awkward to
change afterwards — it is baked into a persisted value.
