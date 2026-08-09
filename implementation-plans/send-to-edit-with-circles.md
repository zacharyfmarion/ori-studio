# Send to Edit — with-circles variant

## Goal

Give the toolbar's **Send to Edit** button a caret on its right. Clicking the
caret opens a one-item menu: **Send to Edit (include circles)**, which does what
Send to Edit does today *and* carries the design's packed circles into the Edit
crease pattern as real Oriedita circle annotations.

Applies to the TreeMaker (circle-packed) and Box-Pleat design kinds. It does
**not** apply to Search 22.5° — see "Search 22.5°" below for why, and for the
alternative that surface could get instead.

## Approach

### What exists today

`Send to Edit` is two separate buttons in the shared app toolbar
([WorkspaceShell.tsx:162](apps/web/src/components/WorkspaceShell.tsx:162) and
[:190](apps/web/src/components/WorkspaceShell.tsx:190)) — one gated on
`capabilities['cp.build'].visible`, one on `isBpContext`. They call two store
actions that each re-implement the same shape:

| Kind | Toolbar handler | Store action | Format |
| --- | --- | --- | --- |
| TreeMaker | `sendTreeCreasePatternToEdit` | [creasePatternSlice.ts:1173](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:1173) | `.fold` |
| Box-Pleat | `sendOristudioBpToEdit` | [oristudioBpSlice.ts:934](apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:934) | `.cp` |
| ExplOri | `sendExploriToEdit` (panel, not toolbar) | [exploriSlice.ts:472](apps/web/src/store/workspaceStore/slices/exploriSlice.ts:472) | `.fold` |

There is *already* a descriptor-level seam for this:
`DesignKindDescriptor.sendToEdit(handle, request) => SendToEditPayload`
([types.ts:194](apps/web/src/designKinds/types.ts:194)), implemented by all three
kinds. Only ExplOri actually routes through it; the two toolbar actions duplicate
it. Adding a variant without fixing that means writing the circle logic **four**
times instead of two, so the descriptor becomes the single implementation point
(Phase 1). Orchestration — capability checks, status transitions, workspace
switch — stays in the slices; only payload production moves.

### Transport: how circles reach the Edit document

This is the load-bearing part, and the good news is that most of it already
works.

- **`import_add` already carries circles.**
  [`operations::arrangement::import_add`](crates/oristudio-cp/src/operations/arrangement.rs:279)
  clones `imported.circles`, applies the same `(add_x, add_y)` shift it applies
  to the line segments, and extends `model.circles`. Nothing to change.
- **The CP kernel models circles as first-class document objects**
  (`CreasePatternModel.circles`, [lib.rs:267](crates/oristudio-cp/src/lib.rs:267)),
  with a full Oriedita command family behind them.
  **Correction, found by testing:** `cp.organizeCircles` is *not* how a user
  clears them — it prunes only invalid zero-radius circles, and leaves real ones
  alone (verified in the browser: 2 circles in, 2 circles out). Removing them is
  the erase tool's job; a box erase with `CustomLineType::Any` takes circles
  along with lines ([lib.rs:1606](crates/oristudio-cp/src/lib.rs:1606)).
- **`.cp` and `.orh` import raw coordinates** — no normalization
  ([io/cp.rs](crates/oristudio-cp/src/io/cp.rs)). So a BP `.cp` is already in the
  editor's ±200 space.
- **FOLD import is the one hazard.** `import_fold_document` normalizes the
  *line segments* onto the ±200 box
  ([io/fold.rs:342](crates/oristudio-cp/src/io/fold.rs:342)) and then adds
  circles from the `oriedita:circles_*` extras **unnormalized**
  ([io/fold.rs:371](crates/oristudio-cp/src/io/fold.rs:371)). That is faithful to
  upstream — Oriedita's `FoldImporter` calls `save.setCircles(...)` and then
  `FoldLineSet.move(...)`, which transforms `lineSegments` only. Do not "fix" it;
  it is parity, and Oriedita's own FOLD files are already written on the ±200 box
  so the transform is the identity for them.

That rules out shipping circles inside the FOLD extras: a TreeMaker FOLD is in
paper units, so its lines get scaled by ~400 and its circles would not.

**Transport.** Circles ride beside the text, in the text's own coordinate space,
and the kernel places them on the imported document:

1. `SendToEditPayload` gains `circles?: readonly SendToEditCircle[]`
   (`{ cx, cy, r }`) and `circleSourceBounds` — both in the coordinates the
   exported file itself uses, which is the one space each kind can state without
   guessing.
2. New wasm entry point `place_circles(handle, source_bounds, coords, radii)`,
   taking the existing `set_texts(handle, coords, texts)`
   ([oristudio-cp-wasm/src/lib.rs:231](crates/oristudio-cp-wasm/src/lib.rs:231))
   as its shape. It maps `source_bounds` onto the document's own line bbox —
   uniform, keyed on height, min corner to min corner — and writes the circles.
   The kernel is the only thing that knows what a loader did to the coordinates,
   which is why the mapping belongs there and not in TypeScript.
3. `importAddOristudioCpDocumentFromText`
   ([oristudioCpRuntime.ts:341](apps/web/src/store/workspaceStore/oristudioCpRuntime.ts:341))
   already holds the *imported* handle between load and `importAdd`. It calls
   `place_circles` between those two, and the existing merge then shifts circles
   and lines together.

Every transform this rests on was measured in Phase 0 before any of it was built.

### Where the circles come from

**TreeMaker.** A leaf node's circle radius in paper units is
`strained_length × scale`, where `strained_length = length × (1 + strain)`
([treemaker-core/src/lib.rs:166](crates/treemaker-core/src/lib.rs:166)), centred
on the leaf's `loc`. `TreeProject` carries everything needed: `nodes[].loc`,
`edges[].length`, `edges[].strain`, `scale`, `paper`.

Note that the existing `leafCircleRadius`
([designViewport.ts:107](apps/web/src/lib/designViewport.ts:107)) is a *display*
approximation — it ignores strain and floors the result at 22 SVG px. Exporting
that would put circles on the paper that do not match the packing. Write a
paper-space radius function that applies strain, and have the viewport derive its
pixel radius from it, so the circle the user sees and the circle they send are
the same circle.

**Box-Pleat.** `packing.flaps[]` carries `anchor`, `width`, `height`, `radius` in
grid units ([oristudioBpTypes.ts:123](apps/web/src/engine/oristudioBpTypes.ts:123)).
A flap with only a radius *is* a circle. A flap that also has width and height is
a **rounded rectangle**: its clearance region is the flap rectangle Minkowski-summed
with a disc of `flap.radius`, which is what
[`bpPackingFlapClearanceRect`](apps/web/src/lib/bpPackingViewport.ts:202) builds.

The Edit workspace cannot draw that shape. Its whole annotation vocabulary is
`line_segments`, `circles`, `points`, `aux_line_segments`, `texts`, `grid`
([model/mod.rs:279](crates/oristudio-cp/src/model/mod.rs:279)), and `Circle` is
`{ x, y, r, color, customized, customized_color }`
([geometry/circle.rs:10](crates/oristudio-cp/src/geometry/circle.rs:10)) — no
start/end angle, so there are no arcs, no rects, and no paths. `import_add`
narrows it further still: it carries **only line segments and circles**, dropping
auxiliary lines, loose points and text
([arrangement.rs:271](crates/oristudio-cp/src/operations/arrangement.rs:271),
matching `FoldLineSet.setSave`). So approximating the corner arcs with aux
polylines is not available either, and doing it with real creases would pollute
the crease pattern with folds that are not folds.

**Emit a circle only for flaps that are actually circles** — `width === 0 &&
height === 0` — centred on the anchor with radius `flap.radius`. Flaps with a
width or a height are skipped.

The rejected alternative is worth recording, because it looks correct on paper: a
rectangle Minkowski-summed with a disc is exactly the convex hull of its four
corner discs, so emitting one circle per corner would carry the clearance region
*losslessly*. It is still wrong to ship. Four overlapping discs is precisely what
an invalid packing looks like in the BP pane, so a faithful rendering of one
rounded flap reads as four flaps in conflict. Exact and legible are not the same
thing here, and legible wins.

Grid units map to paper fractions through the sheet, and must use the *same*
`cpScale` the `.cp` export uses
([oristudioBpSlice.ts:950](apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:950)),
or the circles will not sit on the creases.

Rivers are out of scope. They are bands, not circles, and Oriedita has no
primitive for them.

### Search 22.5°

**We do not have the option.** An ExplOri result is an archive lookup, not a
packing: `ExploriResult` holds `cp` and `packing`, and both are `ExploriCp` —
vertex/edge lists in exact ℚ(√2) coordinates
([explori/types.ts:69](apps/web/src/explori/types.ts:69)). Its "packing" view is
drawn as line segments at different stroke weights
([renderers.tsx:74](apps/web/src/explori/renderers.tsx:74)), not discs. There is
no radius anywhere in the ExplOri surface, and nothing to derive one from —
the returned tiling is not a packing *of the user's tree*, so it has no scale.

So ExplOri's Send to Edit keeps its plain button and gets no caret. The adjacent
feature that surface *could* have is **Send to Edit (include packing)** — merging
`result.packing` as auxiliary lines alongside the CP. That is a different feature
with a different payload, and it is left as an open question rather than folded in
here.

### UI

New primitive `apps/web/src/components/ui/SplitButton.tsx`: a main `Button` plus a
caret `Button`, visually joined, with the caret opening a
`@radix-ui/react-dropdown-menu` (already a direct dependency, and already the
pattern behind `MenuIconButton`). Two things to get right:

- **Nested triggers.** `MenuIconButton`
  ([MenuIconButton.tsx:6](apps/web/src/components/ui/MenuIconButton.tsx:6))
  documents the trap: a tooltip trigger and a dropdown trigger cannot each
  `asChild`-clone the same element. Nest them the way it already does rather than
  rediscovering it.
- **Radius.** The halves need left-only / right-only rounding, so
  [controlStyles.ts](apps/web/src/components/ui/controlStyles.ts) gains side
  variants instead of the split button hardcoding radii.

The toolbar must not grow a menu-descriptor bag inline. Per AGENTS.md's panel
rules, the verbs go in a React-free action catalog next to the design-kind
modules (`designKinds/sendToEditActions.ts`, returning plain descriptors, modelled
on `cp-workspace/folded/foldedFigureActions.ts`) with a `useSendToEditActions`
hook doing the store binding. `WorkspaceShell.tsx` keeps only the composition.

### Analytics

Neither toolbar Send to Edit is instrumented today — they call store actions
directly rather than dispatching a `MENU_ACTION_ID`, so the `handleMenuAction`
chokepoint never sees them. Only ExplOri has an event
(`explori sent to edit`, [events.ts:123](apps/web/src/analytics/events.ts:123)).

Adding the variant is the moment to fix that: one `design sent to edit` event with
`design_kind` (enum), `include_circles` (bool), and `circle_count_bucket`
(bucketed). No coordinates, no radii, no titles — per the privacy contract in
`docs/analytics.md`.

## Affected Areas

- `crates/oristudio-cp/src/session.rs` — `place_circles` and the
  `SourceToDocument` transform it recovers; `crates/oristudio-cp-wasm/src/lib.rs`
  and `apps/tauri/src-tauri/src/{cp_engine,lib}.rs` for the two bridges.
- `crates/oristudio-cp/src/operations/arrangement.rs`, `tests/io.rs` — Phase 0's
  pinning tests.
- `apps/web/src/generated/oristudio-cp-wasm/**` — rebuilt + committed bridge.
- `apps/web/src/lib/packingCircles.ts` (new) — both kinds' circle geometry, with
  its own tests.
- `apps/web/src/designKinds/` — `types.ts` (payload + request), `treemaker.ts`,
  `boxPleat.ts`, new `sendToEditActions.ts` / `useSendToEditActions.ts`.
- `apps/web/src/store/workspaceStore/` — `oristudioCpRuntime.ts` (circle
  placement between load and `importAdd`), `types.ts`, `slices/projectSlice.ts`,
  `slices/creasePatternSlice.ts`, `slices/oristudioBpSlice.ts`,
  `oristudioBpRuntime.ts` (exports `requireActiveBpHandle`).
- `apps/web/src/workers/oristudioCpWorker.ts`,
  `apps/web/src/engine/oristudioCpNativeClient.ts` — `placeCircles` on both clients.
- `apps/web/src/engine/oristudioBpSnapshotMapper.ts` — exports `radiusForFlap`
  and `sheet` so the descriptor reuses them rather than restating them.
- `apps/web/src/lib/designViewport.ts` — leaf radius now derives from the shared,
  strain-aware one.
- `apps/web/src/components/ui/SplitButton.tsx` (new), `styles/theme.css`,
  `components/WorkspaceShell.tsx`.
- `apps/web/src/analytics/` — `events.ts`, new `trackSendToEdit.ts`, `index.ts`.
- `apps/web/public/locales/**` — three new strings across 8 locales.
- `.claude/launch.json` — dev server pinned to 5251 (5223 was taken by another
  worktree).

## Checklist

### Phase 0 — verify the transport assumption ✅

- [x] Pin the FOLD importer's transform. It maps the source line bbox's **min
      corner onto `(-200, -200)`**, with a **uniform scale of `400 / sourceHeight`**,
      no rotation and no Y flip. A 2:1 paper therefore comes out 800 wide, not
      clamped to 400 — `fold_import_normalizes_uniformly_on_height_for_a_non_square_paper`
      in `tests/io.rs` pins exactly that.
- [x] Confirm circles are *not* normalized on FOLD import. Already pinned:
      `fold_import_reads_edges_and_oriedita_extensions` imports lines at
      `(0,0)–(10,10)` (normalized to ±200) alongside a circle at `(5, 5)` that
      stays at `(5, 5)`. This is the Oriedita quirk, and it is why circles cannot
      travel in the FOLD extras.
- [x] Confirm `import_add` carries circles with the lines' shift, preserving
      radius and colour — `import_add_shifts_circles_with_their_lines` and
      `import_add_preserves_circle_offset_from_imported_lines`.
- [x] Establish each kind's source space, so a circle can be expressed in the
      same numbers its file uses:
      - **TreeMaker `.fold`**: `vertices_coords = [x, paper_height - y]`
        ([lib.rs:1182](crates/treemaker-core/src/lib.rs:1182)) — **Y is flipped**
        against tree/paper coordinates. `FOLD_BORDER` creases are exported, so the
        bbox is the paper rect `[0, paper_width] × [0, paper_height]`.
      - **BP `.cp`**: `CP_FULL_WIDTH = 400.0` scaled by `cp_scale`
        ([io/cp.rs:25](crates/oristudio-bp/src/io/cp.rs:25)), through
        `RectangularGrid::transform_matrix`
        ([grid.rs:401](crates/oristudio-bp/src/grid.rs:401)): grid `(x, y)` maps to
        `(s·(x − w/2), s·(h/2 − y))` with `s = 400·cpScale / max(w, h)` — **Y is
        flipped** here too. The sheet border is part of the export
        ([io/cp.rs:145](crates/oristudio-bp/src/io/cp.rs:145)), so the bbox is the
        transformed sheet, and `cpScale != 1` scales it without changing that.

**Resulting design.** The payload carries circles **in the same coordinate space
as its own text** — literally the numbers that would appear in the file — plus the
`sourceBounds` the kind already knows. A new kernel entry point maps
`sourceBounds` onto the loaded document's own line bbox and sets the circles
there. Nothing in TypeScript re-derives the importer's transform, and no format
needs a circle channel.

### Phase 1 — one implementation of Send to Edit ✅

- [x] Route `sendTreeCreasePatternToEdit` and `sendOristudioBpToEdit` through
      their descriptors' `sendToEdit` for payload production; keep capability
      checks, status transitions, and workspace switching in the slices.
- [x] Existing store tests still pass unchanged. The BP descriptor reads the
      sheet from `project.design.layout.sheet` where the slice read
      `snapshot.packing.sheet` — the snapshot mapper builds one from the other,
      so `cpScale` is identical and nothing moved.

### Phase 2 — kernel circle placement ✅

- [x] `CpSession::place_circles` + the `place_circles` wasm export, plus the
      matching native `cp_place_circles` so the two bridges stay in parity
      (`CP_ENGINE_COMMANDS` has a test that enforces this).
- [x] Named `place_circles`, not `set_circles`: it **appends**, where `set_texts`
      replaces. A document loaded from a file that carried its own circles must
      not lose them to a design's packing.
- [x] Rust tests: the FOLD case (a 1×1 paper scaled by 400 and recentred), the
      `.cp` case (identity), appending, the empty list, malformed input, a
      document with no lines, and a freed handle.
- [x] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
      `cargo test --workspace` (132 test targets green).
- [x] Rebuilt and committed the wasm bridge.

### Phase 3 — circle sources ✅

- [x] `SendToEditRequest.includeCircles`; `SendToEditPayload.circles` and
      `.circleSourceBounds`, both in the exported file's own space.
- [x] TreeMaker: strain-aware paper-space leaf radius, tested for zero strain,
      non-zero strain, negative strain, and a non-square paper. `leafCircleRadius`
      now derives from it, keeping only the view's own pixel floor — it had been
      ignoring strain, so a strained design drew one circle and would have sent
      a different one.
- [x] Box-Pleat: one circle per radius-only flap, tested for point / width-only /
      height-only / rectangular flaps, and on rectangular *and diagonal* sheets
      (odd and even). Working in `bpPackingSheetFrame`'s space is what keeps this
      free of `CP_FULL_WIDTH`, `cpScale` and either grid's offsets.
- [x] ExplOri: `includeCircles` asserted inert in `codec.test.ts`.
- [x] `importAddOristudioCpDocumentFromText` places circles between load and
      `importAdd`, so the merge's shift carries them with their creases.

### Phase 4 — UI ✅

- [x] `SplitButton` primitive + the split radii; tested that the label runs the
      default action without opening the menu, the caret opens it and runs its
      item, both halves disable together, and no caret renders with no actions.
- [x] `sendToEditActions` catalog + `useSendToEditActions` hook.
- [x] Both toolbar buttons wired.
- [x] ExplOri's button untouched — its catalog entry returns no variants, which
      is what makes `SplitButton` fall back to a plain button.

### Phase 5 — instrumentation and strings ✅

- [x] `design sent to edit` with `design_kind`, `include_circles` and a bucketed
      `circle_count_bucket`. Neither toolbar action was instrumented before.
- [x] English extracted, all 8 locales translated, `i18n:check` passes.

### Phase 6 — validation ✅

- [x] `npx tsc --noEmit` and vitest directly — 3001 tests across 290 files.
- [x] `eslint apps/web/src` clean.
- [x] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
      `cargo test --workspace`.
- [x] Verified in the browser against the real wasm, not just in tests:
      - TreeMaker (`asymmetric-antler`, optimized): 6 circles merged, and **every
        one centred exactly on a CP vertex** — a leaf node's image.
      - Box-Pleat (`valid-packing`): 2 flaps 4 grid units apart → circles 200
        apart with radius 50, both on CP vertices, so the grid-to-`.cp` scale is
        right.
      - Plain Send to Edit adds creases and **no** circles.
      - The circles render on the CP canvas at the flap positions.
      - The caret menu opens and reads "Send to Edit (include circles)".

## Open questions

- Label: the plan uses the requested **"Send to Edit (include circles)"**. If it
  should read "with circles" instead, it is one string in one catalog.
- Should skipped BP flaps be signalled? A design whose flaps all have width and
  height sends *no* circles, and the menu item gives no hint why. Options: leave
  it silent (current plan), or say "n of m flaps have no circle" once the merge
  lands. Only worth solving if it actually confuses in use.
- Should the with-circles variant also appear in the Design menu, or stay
  toolbar-only? The plain action is not in the menu today either.
- Search 22.5°: is **Send to Edit (include packing)** — merging `result.packing`
  as auxiliary lines — wanted? It is a genuinely different feature and is not
  scoped here.
