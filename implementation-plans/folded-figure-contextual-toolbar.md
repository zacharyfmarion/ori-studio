# Folded-Figure Contextual Toolbar

## Goal

Give a selected **folded figure** the same floating contextual bar the other
crease-pattern canvas objects already have — reference images
(`CpImageInspector`), text annotations (`CpTextAnnotationLayer` →
`AnnotationActions`), and complete crease selections (`CpSelectionToolbar`).

Today a folded figure is fully selectable and transformable on the canvas
(`foldedFigureAsTransformable` → `CanvasObjectOverlay`), but selecting it
surfaces no actions. Its verbs live in two places that are both a detour: the
right-click context menu, and the viewport toolbar's global
`FoldedFigureMenuButton` dropdown, which acts on the *active* figure rather than
the one under the pointer.

Ship `CpFoldedFigureToolbar` plus a matching upgrade to the right-click menu,
both driven by one shared action builder so the two surfaces cannot drift.

Along the way, fix the thing that makes the most valuable action possible:
**staleness is currently an invention, not a port.** See the fidelity audit
below — Oriedita's actual mechanism is both more precise and exactly the
provenance record a refold needs.

## Recommended actions and menu order

Ordered by frequency, grouped by intent, destructive last — the convention the
image bar already sets (opacity → z-order → delete). The same list, same order,
drives the right-click menu.

| # | Action | Icon | Backing action | Gating | Tier |
|---|--------|------|----------------|--------|------|
| 1 | **Flip** | `FlipHorizontal2` | `updateOristudioCpFoldedFigureModel(id, { state: flipFoldedState(cur) })` | `ready` | A |
| 2 | **Display style ▸** | `Layers` | `setOristudioCpFoldedFigureDisplayStyle(id, style)` | `ready` | A |
| — | *separator* | | | | |
| 3 | **Another solution** | `ChevronRight` | `foldAnotherOristudioCpFigure(id)` | `snapshot.find_another_overlap_valid` | A |
| 4 | **Refold** | `RefreshCw` | new `refoldOristudioCpFoldedFigure(id)` | shown only when the figure is stale | B |
| — | *separator* | | | | |
| 5 | **Export ▸** | `FileDown` | new `exportOristudioCpFoldedFigure(format, id)` — SVG / PNG | `renderSnapshot !== null` | C |
| — | *separator* | | | | |
| 6 | **Duplicate** | `Copy` | `duplicateOristudioCpFoldedFigure(id)` | `handle !== null` | A |
| 7 | **Delete** | `Trash2` (danger) | `deleteOristudioCpFoldedFigure(id)` | always | A |

Tier A is five controls with **zero new engine or store work** — the same width
as the image bar. B and C each need one enabling change and are independently
shippable.

### Why this order

- **Flip first.** It is the one verb you reach for every time you look at a
  folded figure, and it is already the first item in the right-click menu.
  Keeping the orders identical is what makes the bar read as the menu's fast
  path rather than a second, differently-shaped surface.
- **Display style as one control, not two buttons.** The context menu currently
  spends two of its five slots on `Wireframe` and `X-ray`, which are two of the
  six values of a single enum (`OristudioCpFoldedFigureDisplayStyle`). A radio
  group showing the current value is narrower and more honest — these are
  *modes*, not toggles — and it exposes `Paper5`, which today has no way back
  from Wireframe except the viewport dropdown. Dropdown on the bar, **submenu**
  in the context menu.
- **Another solution before the export group.** `find_another_overlap_valid`
  means the fold is one of several valid layer orderings — a property of the
  figure you are looking at. The viewport toolbar's copy acts on "the active
  figure", which after a fold is a *fallback* to the most recent one (see the
  gotchas). Per-figure is the correct scope, and this is the action that most
  benefits from it.
- **Refold is conditional, not always-present.** Showing it exactly when the
  figure is genuinely out of date turns the bar into the fix for a real gap:
  today a stale figure can only be deleted and re-folded by hand.
- **Duplicate/Delete last, delete rightmost.** Matches `AnnotationActions`.

### Deliberately excluded

- **Simulate.** Simulation is a crease-pattern operation, not a folded-figure
  one — `CpSelectionToolbar` already offers it from a CP selection, which is the
  honest surface for it. A folded figure is an *output* of folding; offering
  "simulate" on it would imply the simulator consumes the folded state, which it
  does not.
- **Save to image.** `CpSelectionToolbar` carries one because its export
  dropdown has six formats and PNG is buried. A folded figure exports to two, so
  a shortcut to one of two items is noise.
- **Opacity slider.** The image and text bars have one because annotations carry
  a real `opacity`. A folded figure's nearest analogue is
  `transparent_transparency`, which only takes effect in the `Transparent3`
  *state*. A slider that silently does nothing in four of five configurations is
  worse than none. Stays in the viewport dropdown.
- **Front / back / line colour swatches.** Three colour pickers is a panel, not
  a bar. Stays in the viewport dropdown.
- **Bring to front / send to back.** Folded figures have no z-model; they draw
  in list order. Adding one is its own change.
- **Fold-case number entry.** Numeric input in a floating pill; "Another
  solution" covers the common case of stepping through solutions.

## Staleness: Oriedita fidelity audit

**Finding: our staleness is not a port.** `staleGeneratedFoldedFigures`
(`projectSlice.ts:213`) marks *every* generated figure `stale` on *any* crease
edit. Oriedita has no such flag, and no per-figure status at all. Nothing in
`crates/oristudio-cp` implements the upstream mechanism either — the kernel
ports `save_for_select_folding` (`model/mod.rs:403`, a faithful match for
`FoldLineSet.getSaveForSelectFolding`) and stops there, because the logic lives
in Oriedita's app layer, which we did not port.

### What Oriedita actually does

`FoldingServiceImpl.fold` (`third_party/oriedita/oriedita/src/main/java/oriedita/editor/service/impl/FoldingServiceImpl.java:76`),
in the `FOR_EXISTING_FOLDED_FIGURE_3` branch — reached when a figure is selected
and there is no crease selection:

1. **Provenance is the figure's bounding box.** `FoldedFigure_Drawer.folding_estimated`
   (`:135`) sets `boundingBox = GetBoundingBox.getBoundingBox(lineSegmentSet)` —
   the axis-aligned rect of *the very line set that was folded*, in flat CP
   coordinates. That is the only record of "which creases made this figure".
2. **Re-derive the source set.** `foldLineSet.select(figure.getBoundingBox())`
   selects every folding line **fully inside** that rect (`FoldLineSet.select(Polygon)`
   → `totu_boundary_inside`), then `getForSelectFolding()` clones the selected
   folding lines into a `LineSegmentSet`.
3. **The staleness test is content equality.** `reFold.contentEquals(lastFold)`
   (`LineSegmentSet.java:107`): equal segment counts, and every segment of one
   present in a `HashSet` of the other. `LineSegment.equals` (`:223`) compares
   endpoints, `active`, `color`, `customized`, `customizedColor`, and `selected`
   — with `selected` constant at 2 on both sides, since both come from
   `getSaveForSelectFolding`, which only emits selected folding lines.
4. **Unchanged → refold in place.** Same figure object, custom constraints and
   `startingFaceId` preserved, `estimationStep` reset to `STEP_0`, re-run
   `FoldingEstimateTask`. The log line is literally
   `"CP didnt change, refolding using constraints and starting face"`.
5. **Changed → discard and refold fresh.** `lastFold = reFold`, then
   `foldedFiguresList.removeElement(selected)`, falling through to a new figure.

### Consequences for us

- Our flag is a strict **over-approximation**: it never misses a real change, but
  it fires on edits Oriedita would treat as no-ops — anything outside the
  figure's bounding box, or any edit at all while a *different* figure is the one
  being looked at.
- **It is not usable for refold as it stands**, because the entry retains nothing
  to refold *from*: no line ids, no bounding box. The flag says "possibly
  different" with no way to act on it.
- Porting the upstream mechanism fixes both problems at once — the bounding box
  *is* the provenance and *is* the input to the staleness test.

### Two upstream quirks, and what to do with each

- **`lastFold` is a single service-level field, not per-figure.** With several
  figures open, whichever was folded last owns the comparison baseline, so
  "unchanged" can be flatly wrong for any other figure. It is also never assigned
  in the `FOR_SELECTED_LINES_2` path, so folding from an explicit selection
  leaves a baseline from some earlier full-CP fold. **Do not port this.** Our
  figures are independent placed canvas objects; store the baseline per entry.
  This is a deviation that makes the *same test* correct in more cases, not a
  different test.
- **Changed CP ⇒ the figure is destroyed.** Reasonable for Oriedita, where the
  folded figure is a transient view. Hostile here, where a figure is a placed,
  scaled, rotated, styled canvas object. **Deviate:** refold in place with the
  new geometry, preserving `id`, `placement`, `displayStyle` and `model`.

Both deviations are UI-flow, not model semantics — the fold itself, the
selection rule, and the equality test all stay faithful. Record them in a header
comment on the staleness module. (`PORTING.md` is TreeMaker-scoped today; do not
restructure it for this — if it grows an Oriedita section later, these belong
in it.)

## Approach

### Phase A — Toolbar + shared action builder + submenu support

1. **Extract the action set.** New
   `apps/web/src/cp-workspace/foldedFigureActions.ts`:
   `buildFoldedFigureActions(figure, deps): FoldedFigureAction[]`, where each
   action is `{ id, label, icon, disabled, danger, run }` or a radio group
   (`{ kind: 'choice', options, current, onSelect }`) for display style. `deps`
   is the bound store callbacks plus the `runFoldedFigureAction` undo wrapper the
   panel already owns. Single source for both surfaces: the context menu maps it
   to `ContextMenuItem[]`, the toolbar to `IconButton`s.
2. **Submenu support in the shared context menu.** `contextMenuTypes.ts` grows a
   third variant alongside `action` / `separator`:
   ```ts
   | { kind: 'submenu'; id: string; label: string; icon?: ReactNode;
       disabled?: boolean; items: ContextMenuItem[] }
   | { kind: 'radio'; id: string; label: string; checked: boolean; onSelect: () => void }
   ```
   `ContextMenu.tsx` renders them with Radix `DropdownMenu.Sub` /
   `SubTrigger` / `SubContent` and `RadioGroup` / `RadioItem`; item rendering
   becomes a small recursive function. Radix supplies the nested keyboard nav and
   collision handling, same as at top level. Styles extend `.context-menu__item`
   with a `__subtrigger` chevron and `__indicator` check.
3. **`apps/web/src/cp-workspace/CpFoldedFigureToolbar.tsx`**, modelled on
   `CpImageInspector` (the template `CpSelectionToolbar` also follows):
   `foldedFigureBox(figure)` → `useCanvasObjectAnchor(box, 'user', container)` →
   `FloatingToolbar`. Note **`'user'`, not `'model'`** — folded figures are
   placed in SVG user space (`transformableObject.ts:31`); the image and
   selection toolbars both pass `'model'`, so this is the one place the two
   diverge and the one most likely to be copied wrong. The hook is subscribed
   inside this small component so the bar tracks the camera per frame while the
   (huge) panel does not.
4. **Display-style dropdown on the bar** follows `CpSelectionToolbar`'s
   `ExportMenu` shape: Radix `DropdownMenu`, `context-menu` /
   `context-menu__item` classes, `IconButton` trigger with `aria-label` and **no
   `title`** — an `IconButton` with a title wraps itself in a Tooltip trigger,
   which cannot also be a Radix `asChild` trigger (`CpSelectionToolbar.tsx:50`).
5. **Rewrite `buildFoldedFigureMenuItems`** (`CreasePatternPanel.tsx:1774`) on
   the builder, with display style as a submenu. The menu is the superset: it
   carries every action, including tiers the bar defers.
6. **Mount + gating** beside the other floating toolbars (`:3591`–`:3611`).

**Gating — three traps, all worth locking with tests:**

- **Do not use the `activeFoldedFigure` memo** (`:1475`). It falls back to "the
  most recent generated figure" when nothing is selected, so a toolbar built on
  it would hover over the last-folded figure forever. Resolve from
  `oristudioCpActiveFoldedFigureId` directly; render nothing when it is null.
- **Mutual exclusion.** `selectCanvasObject` (`:1565`) and the store already keep
  annotation-selected and figure-active mutually exclusive, so
  `!editingTextId && !selectedCpImage` is belt-and-braces; the
  `CpSelectionToolbar` mount also needs `&& !activeFoldedFigureId` so a crease
  selection and a figure selection cannot both raise a pill.
- **Generated figures only.** `canvasObjects` is built from
  `generatedFoldedFigures` (`sourceKind === 'generated-from-current-cp'`);
  imported folded forms render through `importedForms` and are not selectable.
  The bar inherits that scope.
- Do **not** gate on `annotationsInteractive`, for the reason at `:3603`.

### Phase B — Port Oriedita's staleness, then refold

1. **Record provenance at fold time.** Add to `OristudioCpFoldedFigureEntry`:
   - `sourceBounds: { minX, minY, maxX, maxY } | null` — `GetBoundingBox` over
     the folded line set, in flat CP coords.
   - `sourceFingerprint: string | null` — the content hash standing in for
     `contentEquals`.
   - `sourceLineIds: number[]` — our own selection model's record, kept as a
     debugging/fallback aid; the **bbox is authoritative** for reselection, so a
     refold picks up creases added inside the region since the fold, exactly as
     upstream does.
   Populate in `foldOristudioCpDocument` (`creasePatternSlice.ts:784`, which
   already has `selectedLineIds` in hand) and carry through
   `duplicateOristudioCpFoldedFigure`.
2. **New `apps/web/src/lib/foldedFigureStaleness.ts`** — the ported mechanism,
   pure and unit-testable:
   - `foldedSourceBounds(lines)` — port of `GetBoundingBox`.
   - `reselectFoldableLines(document, bounds)` — port of
     `FoldLineSet.select(Polygon)` restricted to a rect: folding lines with
     **both endpoints inside** the rect (`totu_boundary_inside` on an
     axis-aligned box reduces to containment of both endpoints), filtered by
     `isOrieditaFoldableLineColor` to match `getSaveForSelectFolding`.
   - `foldedSourceFingerprint(lines)` — port of `contentEquals`: order-independent
     over `(a, b, active, color, customized, customized_color)`. **Excludes
     `selected`** — upstream compares it only because both sides are normalized
     to `2`; including ours would make the fingerprint change every time the user
     selects a crease. Our `OristudioCpLineSegment` (`oristudioCpTypes.ts:35`)
     mirrors Oriedita's field for field, so the rest is a direct port.
   - `isFoldedFigureStale(document, figure)` — reselect by bounds, fingerprint,
     compare to `figure.sourceFingerprint`.
3. **Make `status: 'stale'` derived, not stamped.** Delete
   `staleGeneratedFoldedFigures` from the edit path; compute staleness where it
   is displayed (the toolbar's status label, the bar's Refold gate), memoized on
   `(oristudioCpRevision, figure.id)`. This is what removes the false positives:
   an edit outside a figure's bounding box no longer touches it. Keep
   `status: 'stale'` in the entry type and the `.osf` validator — a loaded figure
   with no fingerprint reports "unknown", which presents as not-stale and simply
   offers no Refold.
4. **`refoldOristudioCpFoldedFigure(id)`** in `creasePatternSlice.ts`: reselect
   by `sourceBounds` against the current document, fold, and write back onto the
   **same entry** — preserving `id`, `placement`, `displayStyle`, `model` and
   `startingFaceId` (upstream preserves the starting face and constraints on the
   unchanged path; we preserve them on both, per the documented deviation).
   Retain the new handle and release the old through `foldedFigureHandles.ts`.
   Refresh `sourceBounds`/`sourceFingerprint` from the set actually folded. Fewer
   than two surviving lines → `invalid_operation`, figure untouched.
5. **Persist** the three new fields in `nativeProjectFile.ts`.
   `validateFoldedFigure` (`:475`) is field-by-field and tolerant, so this is
   additive: optional, defaulting to `null` / `[]`. An older `.osf` loads with no
   provenance and shows no Refold — no migration, no version bump.

### Phase C — Export

`foldedFigureSvgBody` + `projectedFoldedFigureBounds` (`lib/foldedFigureSvg.ts`)
already serialize a `renderSnapshot` to SVG — that is how the export dialog draws
its folded figure. New `lib/foldedFigureExport.ts` wraps them into a standalone
document sized to `projectedFoldedFigureBounds`, and
`exportOristudioCpFoldedFigure(format, id)` in `projectSlice.ts` saves SVG
directly or rasterizes to PNG through the same canvas path
`renderCreasePatternPng` uses. Deliberately **not** routed through
`requestCreasePatternExportOptions` — that dialog is scoped to a crease pattern
and re-folds a segment; a figure already has its pixels.

### Phase D — i18n, tests, validation

Per `apps/web/CLAUDE.md`: inline English defaults, `npm run i18n:extract`,
translate all 8 locales, `npm run i18n:stamp`, `npm run i18n:check`.

## Affected Areas

**New**
- `apps/web/src/cp-workspace/foldedFigureActions.ts` (+ test)
- `apps/web/src/cp-workspace/CpFoldedFigureToolbar.tsx` (+ test)
- `apps/web/src/lib/foldedFigureStaleness.ts` (+ test) — Phase B
- `apps/web/src/lib/foldedFigureExport.ts` (+ test) — Phase C

**Edited**
- `apps/web/src/components/ui/contextMenuTypes.ts`,
  `apps/web/src/components/ui/ContextMenu.tsx` — `submenu` + `radio` item kinds
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — mount, gating, menu
  rebuilt on the shared builder, `CpSelectionToolbar` gate tightened, status
  label reads derived staleness
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` — provenance
  capture, `refoldOristudioCpFoldedFigure`
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — drop
  `staleGeneratedFoldedFigures`; folded-figure export
- `apps/web/src/store/workspaceStore/types.ts` — new action signatures
- `apps/web/src/engine/oristudioCpTypes.ts` — provenance fields on the entry
- `apps/web/src/lib/nativeProjectFile.ts` — tolerant round-trip of the new fields
- `apps/web/src/styles/theme.css` — `.cp-folded-figure-toolbar`, submenu styles
- `apps/web/public/locales/*/panels.json`

**Reused unchanged**
- `FloatingToolbar`, `useCanvasObjectAnchor`, `foldedFigureBox`,
  `flipFoldedState`, `foldedFigureHandles`, `isOrieditaFoldableLineColor`

**Not touched** — frontend only. No Rust, no wasm, no vendored upstream: every
Tier-A verb already has a store action, and the staleness port targets Oriedita
app-layer logic (`FoldingServiceImpl`) that has no kernel counterpart.

## Checklist

### Phase A — Toolbar, shared builder, submenus
- [ ] `foldedFigureActions.ts` builder + unit test (ordering, gating per status,
      `find_another_overlap_valid`, `handle === null`)
- [ ] `ContextMenu` `submenu` + `radio` item kinds; recursive item render; styles;
      test that a submenu renders and selects
- [ ] `CpFoldedFigureToolbar.tsx` — anchored in `'user'` space, style dropdown,
      five Tier-A controls
- [ ] Context menu rebuilt on the builder, display style as a submenu with the
      current value checked
- [ ] Mounted in `CreasePatternPanel`; resolves from `oristudioCpActiveFoldedFigureId`,
      never the fallback memo
- [ ] `CpSelectionToolbar` mount gated on no active folded figure
- [ ] Toolbar test: appears on selection, hidden with nothing selected, hidden
      while editing text / with an image selected, absent for an imported form
- [ ] `.cp-folded-figure-toolbar` styles

### Phase B — Staleness port + refold
- [ ] `foldedFigureStaleness.ts` — `foldedSourceBounds`, `reselectFoldableLines`,
      `foldedSourceFingerprint`, `isFoldedFigureStale`, with the deviation note
      in the module header
- [ ] Port tests: edit inside the bbox → stale; edit outside → **not** stale
      (the case today's flag gets wrong); crease added inside the bbox → stale and
      picked up by refold; colour change → stale; selecting lines → not stale;
      moving an endpoint out of the bbox → stale
- [ ] `sourceBounds` / `sourceFingerprint` / `sourceLineIds` on the entry;
      captured at fold, carried through duplicate
- [ ] `staleGeneratedFoldedFigures` removed; staleness derived at display sites,
      memoized on `oristudioCpRevision`
- [ ] `nativeProjectFile` round-trip, tolerant of older `.osf` (no provenance →
      no Refold)
- [ ] `refoldOristudioCpFoldedFigure` — preserves id/placement/model/startingFace,
      swaps handle under the refcount, refreshes provenance, one undo entry
- [ ] Refold surfaces only when derived-stale with usable provenance

### Phase C — Export
- [ ] `foldedFigureExport.ts` (SVG + PNG from `renderSnapshot`) + test
- [ ] `exportOristudioCpFoldedFigure` store action

### Phase D — i18n + validation
- [ ] Inline English defaults; `i18n:extract`; 8 locales; `i18n:stamp`; `i18n:check`
- [ ] `cd apps/web && npx tsc --noEmit`, `vitest run`, `eslint .`
- [ ] Confirm no spurious `apps/web/src/generated/**` churn before committing
- [ ] Browser pass (author): select a figure → bar appears anchored and tracks
      pan/zoom; each action fires; flip/style/another-solution/duplicate/delete
      each land as one undo entry; right-click menu matches the bar item for item
      with style as a submenu; bar and crease-selection bar never both appear;
      edit a crease far from a figure → it does **not** go stale; edit one of its
      creases → Refold appears and restores it in place

## Open risks

- **Anchor space.** `'user'` vs `'model'` is the one difference from the two
  existing bars and gives no visible error when wrong — the pill just drifts off
  the figure once a native Oriedita camera is active. Worth an explicit test.
- **Derived staleness cost.** Reselect + fingerprint is O(lines) per figure. Run
  it memoized per `oristudioCpRevision` at display sites only, never per frame
  and never in the edit path — the whole point of moving off the stamped flag is
  to take work *out* of editing.
- **Async churn.** `updateOristudioCpFoldedFigureModel` round-trips wasm and
  re-renders the snapshot, so a fast flip-flip can interleave. The panel's
  `runFoldedFigureAction` already serializes snapshot→act→record; keep every
  toolbar action inside it rather than calling the store directly.
- **Two surfaces, one truth.** The point of the shared builder is that a future
  verb cannot land in one surface only. If it starts growing surface-specific
  branches, that is the signal it has stopped paying for itself.
</content>
