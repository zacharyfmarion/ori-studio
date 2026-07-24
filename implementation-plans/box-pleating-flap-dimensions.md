# Box Pleating Flap Dimensions (Width / Height)

## Goal

Let a user set a selected flap's **width** and **height** in the BP editor
(packing) pane, matching Box Pleating Studio, where a flap is a rectangle
(`width × height`) plus a `radius` (the flap/leaf length). Today the port only
lets you change a flap's length/radius (via the tree edge), not its rectangular
footprint. We surface all three — **Radius, Width, Height** — in one floating
contextual editor, so the packing pane reaches parity with BP Studio's flap
panel (`third_party/box-pleating-studio/src/app/vue/panel/flap.vue`).

Primary deliverable: **Width + Height editing**. Radius is included in the same
control for parity/co-location (it routes through the existing tree-edge-length
path, not a new engine call).

## Background — what already exists (verified)

The heavy lifting is done below the UI. This is a **frontend-only** feature.

- **Engine (`crates/oristudio-bp`)**: `Flap { id, x, y, width, height }`
  (`model.rs:103`). `ProjectSession::resize_flap(id, width, height)`
  (`project_session.rs:489`) validates (finite, non-negative), no-ops when
  unchanged, re-packs via `update_design`, and records **separate `width` /
  `height` undo field-changes**. Boundary rule `validate_flap_with_sheet`
  (`project_session.rs:1649`) mirrors BP Studio's `_testResize` exactly: reject
  if **more than one** of the four corner "dots" falls outside the sheet.
  Covered by `tests/engine.rs:536`.
- **WASM (`crates/oristudio-bp-wasm`)**: `bp_resize_layout_flap(handle, id,
  width, height)` (`lib.rs:323`) is exported. There is **no** `radius` entry
  point by design — radius is the tree leaf-edge length.
- **Runtime bridge (frontend)**: `resizeOristudioBpLayoutFlap(id, width,
  height)` already exists in `oristudioBpRuntime.ts:389` → worker
  `resizeLayoutFlap` → wasm. **It has no caller today (dead code).**
- **Rendering**: `BpPackingPanel` already draws flaps as rectangles from
  `width`/`height` (`bpPackingRectToSvg`) and the clearance as a rounded rect
  grown by `radius` (`bpPackingViewport.ts:201`). No rendering change needed.
- **UI model**: `OristudioBpFlap { …, width, height, radius, constrained }`
  (`oristudioBpTypes.ts:122`) already carries all three. `radius` is mapped from
  the flap's leaf-edge length (`radiusForFlap`), with a `max(w,h)/2` fallback.
- **Geometry helpers already ported to TS** in `bpPackingViewport.ts`:
  `flapDots` (= BP Studio `getDots`), `constrainFlap`, `diagonalConstrain`,
  `constrainBpPackingPoint`. Only a boolean **`contains`** predicate is missing
  for the client-side pre-check.

So the missing pieces are: a store action, one small validity helper, i18n
strings, and evolving the floating pill from name-only into a compact
`Name · Radius · W · H` bar.

## UI design (floating contextual editor)

The existing floating pill (`BpNameEditor`, CSS `.bp-name-editor`) is a
horizontal bar pinned **top-center of the packing pane** (`position:absolute;
top; left:50%`), shown when exactly one flap is selected. It sits alongside the
same-style stretch nav pill. We evolve this into the flap editor rather than
inventing a canvas-anchored popover.

**Layout** (single row, compact, in the existing pill):

```
[ Flap 3 ]  Name [____]   R [__]   W [__]   H [__]
```

- **Name** — existing behavior, unchanged.
- **Radius (R)** — integer, `min 1`, `max = sheet diameter`. Routes through the
  tree leaf-edge length. Hidden/disabled if the flap has no source edge.
- **Width (W)** — integer, `min 0`, `max = sheet diameter`.
- **Height (H)** — integer, `min 0`, `max = sheet diameter`.

Each numeric field is a compact input reusing the commit/revert pattern already
in the pane (`BpSheetSizeInput`, `BpPackingPanel.tsx:280`; also `NumberRow` in
`InspectorPanel.tsx:220`): local draft, **commit on blur / Enter**, **revert on
Escape**, clamp to `[min, max]`, round to integer.

**Component choice**: introduce a dedicated `BpFlapEditor.tsx` (packing-pane
only) that renders the pill with the name input **and** the three numeric
fields. Keep `BpNameEditor.tsx` as-is for the **tree** pane (vertex rename).
Factor the shared bits:
- a small `BpContextualNumberField` (compact numeric input with the draft/commit/
  clamp/round/Escape behavior) used for R/W/H;
- reuse the name-input behavior from `BpNameEditor` (extract a `NameField` inner
  component if cleaner, or embed `BpNameEditor`'s input logic).

**Why not a docked inspector**: the packing pane's per-flap editing already
lives in this floating pill; keeping size editing here avoids splitting flap
controls across two surfaces and matches the existing interaction. (The docked
`InspectorPanel` remains TreeMaker-only.)

### Focus & keyboard safety (mirror `BpNameEditor`'s hard-won rules)

- Fields **must not auto-focus** on selection. While a field is unfocused, the
  pane keeps owning the keyboard (Delete removes the flap, arrows nudge it, undo
  shortcut undoes the edit). The user clicks a field to edit.
- While a numeric field **is focused**, arrow keys change the number (native)
  and must **not** nudge the flap — `stopPropagation` on keydown so the pane's
  arrow-nudge handler doesn't also fire.
- Escape reverts the draft and releases focus (optionally drop selection, like
  the name field's `onEscape`).
- Reset drafts on selection change by keying the editor on the flap id (fresh
  mount), plus an effect syncing external value changes (undo/redo) while the
  same flap stays selected — same approach `BpNameEditor` uses.

## Wiring

### Width / Height

1. **Store action** in `oristudioBpSlice.ts`: add `resizeOristudioBpLayoutFlap`
   mirroring `moveOristudioBpLayoutFlap` (`oristudioBpSlice.ts:693`) — wrap in
   `runBpTreeMutation('Resized BP flap', …)` for a single labeled history entry,
   call the imported runtime `resizeOristudioBpLayoutFlap`, and re-check the flap
   still exists (no-op if the selection is stale / flap deleted). Use
   `dragging: false` (discrete commit → one solve, one history entry).
2. **Panel**: `BpFlapEditor` calls the store action on commit of W or H with the
   clamped/rounded value and the current value of the other dimension.

### Radius (parity, co-located)

- Radius edits route through the **existing** tree-edge-length path
  (`updateOristudioBpTreeEdgeLength`, already wired in slice + runtime), **not**
  a flap resize. Find the flap's incident leaf edge from the document's tree
  edges (same lookup as `radiusForFlap`) and call it with the two vertex ids and
  the new length.
- If no incident edge exists (fallback flap), hide/disable the radius field.
- Note: the tree is length-faithful/continuous, but the packing context uses
  integer grid units — commit integer radius (`min 1`).

## Validation & edge cases (the important part)

Two-layer defense so the UI never desyncs and never spams failed engine calls.

1. **Bounds & type (numeric field)**: `W,H ≥ 0`; `R ≥ 1`; all `≤ diameter`;
   round to integer. Handled by the field's clamp/round on commit. Reject NaN /
   empty by reverting to the last value.
2. **"At most one corner off-sheet" (client pre-check, primary UX)**: before
   calling the engine, mirror `validate_flap_with_sheet`:
   `flapDots(anchor, w, h).filter(p => !sheetContains(p, sheet)).length <= 1`.
   If it fails, **silently revert** the field (BP Studio's setter early-returns
   and the input snaps back) — instant feedback, no round-trip, no failed solve.
   - New helper `bpPackingSheetContains(point, sheet)` in `bpPackingViewport.ts`
     mirroring Rust `BpGrid::contains` (rect: `0≤x≤w && 0≤y≤h`; diagonal: port
     `DiagonalGrid::contains` — the diamond test; `diagonalConstrain` already
     lives here as a reference). Add `bpPackingCanResizeFlap(anchor, w, h,
     sheet)` on top.
3. **Engine backstop**: if the pre-check passes but the engine still rejects
   (shouldn't, if mirrored correctly), the runtime throws (`to_js_bp_error`).
   The store action catches, does **not** commit history, and the field reverts
   to the last valid value (a quiet toast is optional).
4. **No-op commit**: unchanged value → don't call the engine (avoid round-trip +
   spurious history). The field only commits on actual change; the engine also
   no-ops as a backstop.
5. **Stale selection / deleted flap**: store action re-checks the flap id; UI is
   keyed on flap id so it unmounts/remounts on selection change.
6. **Multi-select**: size fields shown **only** for a single flap selection
   (matches BP Studio: the multi-flap panel has no size). No fields when
   `selection.kind !== 'bp-flap'`.
7. **Re-pack side effects**: a resize re-solves the whole layout — other flaps
   may shift, stretches/devices/conflicts may change or an invalid junction may
   appear. That's expected; the UI just renders the returned snapshot. Invalid
   overlaps are allowed (conflicts already render).
8. **`diameter` source**: BP Studio caps all three at `grid.diameter`. Expose
   `diameter` on the sheet snapshot (compute from the grid in
   `oristudioBpSnapshotMapper` / raw sheet), or compute client-side (rect =
   `max(w,h)`; diagonal per grid formula). Prefer exposing it to avoid
   duplicating grid math and stay correct for diagonal grids. `diameter` is a
   soft input cap; the real guard is the corner-dots rule in (2)/(3).
9. **Diagonal grids**: rely on the ported `contains` for the corner check.
   Confirm behavior on a diagonal sheet during QA (any parity/even constraints
   surface as the engine rejecting, caught by the backstop).

## Undo / redo

- Width and height are separate engine field-changes; committing W then H yields
  two undo steps (matches BP Studio's per-field commits). Radius is its own
  entry via the edge-length path. Each store action wraps `runBpTreeMutation`
  for a single, labeled, coalesced entry per commit.

## i18n

- Add inline-English `t()` strings: `panels:bpPacking.radius` / `.width` /
  `.height` (labels + aria labels), following the repo's inline-source pattern.
- Run `npm run i18n:extract` / `i18n:check`.

## Testing

- **Unit** (`bpPackingViewport.test`): `bpPackingSheetContains` and
  `bpPackingCanResizeFlap` — valid/invalid cases, the at-most-one-tip rule,
  rectangular + diagonal sheets, point flap (`0×0`), and the exact boundary that
  the engine's `validate_flap_with_sheet` accepts/rejects (keep them in lockstep).
- **Component** (`BpFlapEditor.test` / extend `BpPackingPanel.test`): fields
  render for a single selected flap; commit calls the store action with
  clamped/rounded values; Escape reverts; radius hidden when no edge; no size
  fields on multi-select; a value that violates the corner rule reverts without
  calling the engine.
- **Slice** (mock runtime): resize action wraps mutation + history; no-op on
  unchanged / missing flap; engine-error path reverts and doesn't corrupt
  history.
- **Focus/keyboard**: selecting a flap does not focus a field; arrows inside a
  focused field don't nudge the flap.
- **Regression**: existing `BpPackingPanel` / `BpNameEditor` / `BpTreePanel`
  tests stay green.
- Gates: `npm run lint:web`, `cd apps/web && npx tsc --noEmit`,
  `npm run test:web`. Engine is unchanged, but a quick `cargo test -p
  oristudio-bp` confirms the existing resize path.

## Affected areas

- `apps/web/src/components/panels/BpFlapEditor.tsx` — **new** floating flap
  editor (name + R/W/H). Optionally a shared `BpContextualNumberField`.
- `apps/web/src/components/panels/BpPackingPanel.tsx` — swap the
  `singleSelectedFlap` render (line ~1827) from `BpNameEditor` to `BpFlapEditor`;
  pass the resize + radius handlers and sheet/diameter.
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` — new
  `resizeOristudioBpLayoutFlap` action (import the runtime fn); reuse the
  existing edge-length action for radius.
- `apps/web/src/lib/bpPackingViewport.ts` — add `bpPackingSheetContains` +
  `bpPackingCanResizeFlap` (and export `flapDots` if needed).
- `apps/web/src/engine/oristudioBpSnapshotMapper.ts` + `oristudioBpTypes.ts` —
  (if chosen) expose `sheet.diameter`.
- `apps/web/src/styles/theme.css` — extend `.bp-name-editor` / add
  `.bp-flap-editor` styles for the compact numeric fields.
- i18n locale source + generated check.
- **No Rust/WASM changes** for core behavior (already complete).

## Non-goals

- Optimizer / auto-packing (out of scope per the BP parity plan).
- Docked-inspector BP branch (deliberately kept in the floating pill).
- BP Studio's width/height increment/decrement hotkeys (`d.wd`/`d.wi`/`d.hd`/
  `d.hi`) — optional stretch, not required.

## Checklist

- [x] `bpPackingSheetContains` + `bpPackingCanResizeFlap` helpers + unit tests
- [x] `resizeOristudioBpLayoutFlap` store action (history-wrapped, stale-safe)
- [x] (optional) expose `sheet.diameter` in the snapshot — not needed; computed
      client-side as `max(sheet.width, sheet.height)` for the input `max`, with
      the corner-dots rule as the real guard
- [x] `BpFlapEditor` component (name + R/W/H, focus-safe, revert-on-invalid)
- [x] Swap render site in `BpPackingPanel`; wire resize + radius(edge-length)
- [x] Radius routing via tree edge length; hide when no source edge
- [x] CSS for the compact fields
- [x] i18n strings + `i18n:check` (R/W/H kept as universal symbols; aria labels
      translated across all 8 locales)
- [x] Component tests; regression suite green. (No standalone slice test: no
      sibling BP flap action has one — they run through the real wasm worker;
      the resize logic is covered by the viewport unit tests, the BpFlapEditor
      component tests, and the engine's own `resize_flap` tests.)
- [x] lint / tsc / test:web green (840 tests). Engine unchanged.
- [x] Manual QA in browser (rectangular sheet): width applied + re-packed +
      rendered as a rectangle; out-of-range value snaps back; title removed.
      Diagonal-sheet + undo/redo spot-checks left for the author's browser pass.

## Post-verification refinements (found in the browser pass)

- Removed the redundant "Flap N" title from the pill (Name field already names
  it); `BpNameEditor.title` is now optional.
- Hardened the number field: the commit is awaited and the field snaps back to
  the real value if the engine rejects it, so it can never show a value the
  model didn't accept even if the client pre-check and engine ever disagree.
