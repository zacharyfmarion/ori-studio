# Crease Assignment Palette

## Goal

Let the editable crease-pattern workspace use more than the current four visible
line choices. Users should be able to choose from the standard semantic line
types, such as mountain, valley, edge, and unassigned/auxiliary, plus a compact
palette of additional colors for authoring and organization.

The key product rule is that extra colors are authoring metadata, not new
origami fold semantics by default. Standard FOLD assignments remain the
portable semantic layer (`M`, `V`, `B`, `F`, `U`, `C`, `J`), while Ori Studio's
editable CP document keeps the richer Oriedita-style line color.

## Approach

### 1. Separate semantic assignment from authoring color

- Keep `treemaker_fold::Assignment` restricted to standard FOLD assignment
  values. Do not add arbitrary colors to this enum unless the app is explicitly
  changing the FOLD format contract.
- Treat `crates/oristudio-cp::geometry::LineColor` as the editable CP authoring
  classification. It already supports the useful Oriedita color slots:
  `Black0`, `Red1`, `Blue2`, `Cyan3`, `Orange4`, `Magenta5`, `Green6`,
  `Yellow7`, `Purple8`, and `Other9`, plus non-drawing sentinels.
- Introduce a shared palette definition that gives each user-facing slot a
  stable id, label, short label, `LineColor`, CSS token, and export fallback:
  mountain/red -> `M`, valley/blue -> `V`, edge/black -> `B`, auxiliary/cyan ->
  `F` or `U` depending on final product wording, and extra colors -> `F` or `U`
  unless a future setting maps them differently.
- Rename UI copy away from "assignment" when it means visual color. Use
  "Line type" or "Line color" for the palette, and reserve "M/V assignment" for
  semantic FOLD viewing.

### 2. Extend CP operations to accept any palette color

- Add a generic selected-line recolor operation in `crates/oristudio-cp`, or
  reuse `operations::color::set_line_color_for_indices` through a new command
  such as `CreaseSetLineColor`.
- Keep existing convenience commands (`CreaseMakeMountain`,
  `CreaseMakeValley`, `CreaseMakeEdge`, `CreaseMakeAux`) as menu/shortcut
  aliases for common colors.
- Make drawing and construction commands continue to use the payload
  `line_color`; most of this is already in place through `active_line_color`.
- Update replace/delete line type filters if the product needs filtering by
  specific palette color instead of only Oriedita's coarse custom types
  (`Any`, `Edge`, `MountainAndValley`, `Mountain`, `Valley`, `Aux`).

### 3. Add palette UI without crowding the CP workspace

- Replace the fixed M/V/E/A bottom-toolbar selector with a compact color
  swatch control:
  - show the four semantic choices first: mountain, valley, edge, auxiliary or
    unassigned;
  - expose additional swatches in the same segmented control if space allows,
    or behind a popover on narrow panes;
  - use tooltips and accessible labels for each swatch.
- Keep the active line color state driving draw previews, click-drag creation,
  symmetry mirroring, paste/transform flows, and selected-line recolor actions.
- Add a selection-scoped "set selected line color" action that applies the
  active palette color to selected lines, rather than creating one menu item per
  extra color.
- Preserve existing M/V shortcuts and menu actions. Add only a small number of
  new shortcuts if they are obvious; avoid assigning keys for every palette
  slot.

### 4. Preserve colors through save/import/export

- Native `.osf` and Oriedita `.ori`/`.orh` paths already carry line colors in
  the editable CP document shape; add regression coverage to lock that in.
- Standard `.fold` export should continue writing valid `edges_assignment` and
  `edges_foldAngle`. Add an Ori Studio/Oriedita extension array for the richer
  edge line color numbers, for example `oristudio:edges_line_colors`, after
  checking whether Oriedita already has a compatible key.
- On `.fold` import, prefer the extension line color when present; otherwise
  fall back to `edges_assignment` via `line_color_for_fold_assignment`.
- Keep `oriedita:edges_colors` as custom RGB override data. Do not overload it
  with line type numbers.
- Document that legacy `.cp` only has four line codes. Exporting richer colors
  to `.cp` should either collapse extra colors to auxiliary or show a warning in
  the export flow.

### 5. Update rendering and diagnostics

- Expand `cpLineColorClass` and related CSS so every palette slot renders with
  a stable visual color in editable CP mode.
- Keep generated TreeMaker CP rendering unchanged unless it is converted into
  the editable CP companion document.
- Make flat-folding, simulation, and sequence code consume semantic
  `edges_assignment`, not arbitrary palette colors. Extra colors should not
  become mountain/valley folds accidentally.
- Update stats, import summaries, and labels so additional authoring colors are
  counted separately from semantic M/V/B/F/U assignments where useful.

### 6. Validation and tests

- Add Rust tests in `crates/oristudio-cp` for:
  - generic recolor to every supported palette color;
  - FOLD export preserving standard assignments plus extension line colors;
  - FOLD import restoring extension line colors;
  - `.cp` export fallback behavior for extra colors.
- Add wasm tests if a new command or payload contract is exposed through
  `crates/oristudio-cp-wasm`.
- Add web unit tests for:
  - palette rendering and active-color selection;
  - draw command payloads using extra colors;
  - selected-line recolor command dispatch;
  - SVG/viewport classes for all palette colors;
  - native project save/load preserving extra colors.
- Run `cargo test -p oristudio-cp`, relevant
  `cargo test -p oristudio-cp-wasm` or wasm-pack coverage if bridge contracts
  change, plus `npm run lint:web`, `npm run typecheck:web`, and targeted web
  tests. Run `npm run build:web` if the wasm bindings or production bundle are
  touched.

## Affected Areas

- `crates/oristudio-cp/src/geometry/line_color.rs`
- `crates/oristudio-cp/src/model/mod.rs`
- `crates/oristudio-cp/src/operations/color.rs`
- `crates/oristudio-cp/src/io/fold.rs`
- `crates/oristudio-cp/src/io/cp.rs`
- `crates/oristudio-cp/src/lib.rs`
- `crates/oristudio-cp-wasm`
- `apps/web/src/engine/oristudioCpTypes.ts`
- `apps/web/src/lib/oristudioCpActions.ts`
- `apps/web/src/lib/oristudioCpCommands.ts`
- `apps/web/src/lib/creasePatternViewport.ts`
- `apps/web/src/components/panels/CreasePatternPanel.tsx`
- `apps/web/src/components/panels/CpToolRail.tsx`
- `apps/web/src/store/workspaceStore`
- `apps/web/src/styles/theme.css`

## Checklist

- [x] Confirm product wording for the fourth semantic control: auxiliary,
      unassigned, or both as separate palette entries.
- [x] Add a shared palette definition for semantic and extra line colors.
- [x] Add a generic selected-line recolor command that accepts any
      `LineColor`.
- [x] Expand CP drawing/action UI from fixed M/V/E/A buttons to a palette
      swatch control.
- [x] Update editable CP rendering classes and theme tokens for all supported
      palette colors.
- [x] Add FOLD extension import/export for richer line color round-tripping
      while preserving standard `edges_assignment`.
- [x] Decide and test `.cp` export fallback or warning behavior.
- [x] Update native project, import/export, viewport, command, and store tests.
- [x] Run focused Rust, wasm, and web validation for the changed surfaces.
