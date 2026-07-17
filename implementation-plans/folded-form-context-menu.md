# Folded-Form Right-Click Context Menu

## Goal

Add a right-click context menu to the crease-pattern canvas, built as a **general,
reusable context-menu system** whose **first consumer is the folded form**. Right-
clicking a folded figure opens a menu with **Flip, Scale, Delete, Duplicate,
Wireframe, X-ray** (per the mock), each wired to actions that already exist in the
store. The framework is designed so other targets (a crease line, the current
selection, empty canvas) can register their own menus later with no rework.

Two items need behavior beyond the existing toolbar dropdown:

- **Flip** — parity with Oriedita's `FlipAction`, which calls
  `FoldedFigureModel.advanceState()`: cycle the figure's side
  `Front0 → Back1 → Both2 → Transparent3 → Front0`
  (`origami/folding/FoldedFigure.State.advance()`,
  `third_party/oriedita/.../action/FlipAction.java`).
- **Scale** — a live **drag-to-scale** gesture on the canvas, committing
  `model.scale` on release.

## Background — current state

Everything the menu needs already exists; only the interaction surface is missing.

- **Folded figures** are Oriedita-style estimated folds drawn over the CP. The data
  model `OristudioCpFoldedFigureEntry`
  (`apps/web/src/engine/oristudioCpTypes.ts:317`) mirrors Oriedita's
  `FoldedFigureModel` (scale, rotation, state, front/back/line color, display style,
  shadows, transparency). Geometry is built in
  `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` (earcut fills + edge
  strokes, mapped model → CP-SVG-user coords + per-figure `displayOffset`) and
  rendered through the WebGL canvas.
- **Store actions already present**
  (`apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts`):
  `moveOristudioCpFoldedFigure` (cheap, offset-only, sync), `setOristudioCp­Folded­Figure­DisplayStyle`,
  `updateOristudioCpFoldedFigureModel` (async — round-trips wasm + re-renders the
  snapshot), `duplicateOristudioCpFoldedFigure`, `deleteOristudioCpFoldedFigure`,
  `setOristudioCpActiveFoldedFigure`.
- **Current UI** exposes these only through a toolbar dropdown
  (`FoldedFigureMenuButton`, `CreasePatternPanel.tsx:583`).
- **Canvas interaction** (`apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx`):
  a figure is picked by AABB via `figureAt` (`:1030`); it is only grabbable via
  **cmd/ctrl-drag** to move (`:1673`, `:1812`). Plain **right button = universal
  erase gesture** (`onPointerDown`, `:1667`), and the browser `contextmenu` event
  is already `preventDefault`'d (`:1913`).

### Item → backing action map

| Menu item | Action | Notes |
|-----------|--------|-------|
| Flip | `updateOristudioCpFoldedFigureModel(id, { state: advanceState(cur) })` | new `advanceState` helper |
| Scale | drag-to-scale → commit `updateOristudioCpFoldedFigureModel(id, { scale })` | new gesture |
| Delete | `deleteOristudioCpFoldedFigure(id)` | exists |
| Duplicate | `duplicateOristudioCpFoldedFigure(id)` | exists |
| Wireframe | `setOristudioCpFoldedFigureDisplayStyle(id, 'Wire2')` | exists |
| X-ray | `setOristudioCpFoldedFigureDisplayStyle(id, 'Transparent3')` | exists (displayStyle, not `state`) |

## Approach

### 1. General context-menu framework (the reusable part)

Built on **Radix** for accessibility, matching how the app already wraps Radix
primitives (`components/ui/Select.tsx`, `Toggle.tsx`, `Tooltip.tsx` — thin
re-exports with app class names + Portal).

**Use `@radix-ui/react-dropdown-menu`, controlled and cursor-anchored — not
`@radix-ui/react-context-menu`.** Both wrap the same WAI-ARIA `menu` primitive
(roving focus, typeahead, `Escape`, arrow-key nav, focus return), so a11y is
equivalent. But Radix ContextMenu's `Trigger` opens on the browser's native
`contextmenu` event, which also fires at the **end of a right-drag** and gives no
click-vs-drag discrimination — that conflicts with keeping **right-drag = erase**.
A controlled DropdownMenu lets our own pointer-up logic decide when the menu opens,
so right-drag stays an erase gesture and only a right-**click** opens the menu.

- **Add dependency** `@radix-ui/react-dropdown-menu` (peer with the existing Radix
  packages).
- **Component** `apps/web/src/components/ui/ContextMenu.tsx` — a controlled
  DropdownMenu wrapper. Props: `{ open, x, y, items, onOpenChange }`. Anchor via an
  invisible zero-size trigger positioned `fixed` at `{x, y}` (the standard
  controlled-dropdown-at-cursor recipe): `DropdownMenu.Root` with `open`/
  `onOpenChange`, a `DropdownMenu.Trigger asChild` wrapping the positioned element,
  and `DropdownMenu.Content` (`side="bottom"`, `align="start"`, `sideOffset`,
  `collisionPadding` for viewport clamping — Radix handles the flipping/clamping).
  Items map to `DropdownMenu.Item` / `DropdownMenu.Separator`. Radix gives us
  dismissal, focus trap/return, and keyboard nav for free — no manual handlers.
  Styling mirrors `select-content` / `select-item` (`styles/theme.css`).
- **Types** `apps/web/src/components/ui/contextMenuTypes.ts`:
  ```ts
  type ContextMenuItem =
    | { kind: 'action'; id: string; label: string; icon?: ReactNode;
        shortcut?: string; disabled?: boolean; danger?: boolean; onSelect: () => void }
    | { kind: 'separator' };
  interface ContextMenuRequest { x: number; y: number; items: ContextMenuItem[]; }
  ```
- **Target model** `apps/web/src/cp-workspace/contextMenuTarget.ts`:
  ```ts
  type CpContextTarget =
    | { kind: 'folded-figure'; figureId: string }
    | { kind: 'empty' };              // crease-line / selection cases added later
  ```
  The canvas resolves the target under the pointer; the *panel* owns building
  items for a target (it has the store bindings). This split keeps the canvas free
  of menu content and lets new targets be added purely in the panel.

### 2. Right-click routing on the canvas (click vs. drag)

**Right-drag stays erase (confirmed requirement).** Only a right-**click** (press +
release with no movement past `CLICK_MOVE_THRESHOLD`) opens a menu; any right-drag
runs the existing erase gesture untouched. This is low-risk: a zero-size erase box
deletes nothing today. Because the menu is a *controlled* Radix DropdownMenu, the
native `contextmenu` event stays suppressed (`:1913`) and never opens anything on
its own — our pointer-up handler is the sole trigger.

In `CreasePatternWebglCanvas.tsx`:

- New prop `onRequestContextMenu(request: { clientX; clientY; target: CpContextTarget }) => void`.
- `onPointerDown` (`:1667`) for `e.button === 2` is unchanged (still arms erase),
  but capture the resolved target at press time: `figureAt(x,y)` → `folded-figure`,
  else `empty`.
- `onPointerUp`: if the gesture was the right button **and** `!moved`, cancel the
  erase commit and call `onRequestContextMenu(...)` instead. If `moved`, the erase
  drag commits as today.
- Selecting a `folded-figure` target also makes it active
  (`setOristudioCpActiveFoldedFigure`) so the menu and toolbar stay in sync.

### 3. Folded-form menu (first consumer)

In `CreasePatternPanel.tsx`:

- Hold `const [contextMenu, setContextMenu] = useState<ContextMenuRequest | null>(null)`.
- `handleRequestContextMenu({ clientX, clientY, target })` builds items by target
  kind and stores a request. For `folded-figure`, resolve the entry and emit the
  six items from the map above; disable items when the figure isn't `ready` (same
  gating the dropdown uses via `activeReady`). `empty` → no menu for now (returns
  null; ready for future crease/selection cases).
- Render `<ContextMenu … />` when non-null.
- **Flip helper** `advanceFoldedState(state)` cycling
  `Front0→Back1→Both2→Transparent3→Front0` (exact port of `State.advance()`),
  placed next to `FOLDED_STATE_OPTIONS`.

### 4. Drag-to-scale gesture

`model.scale` only takes effect by re-rendering the wasm snapshot
(`updateOristudioCpFoldedFigureModel` is async, two wasm calls per invocation), so a
naive per-move commit would lag. Follow the existing **preview-then-commit** pattern
(cf. line-selection move re-uploading shifted strokes, `:1806`):

- Selecting **Scale** arms a transient canvas mode `scalingFigure = { id, ... }`
  (via a new `onBeginScaleFoldedFigure(figureId)` prop, or a ref the panel sets).
- The next pointer drag maps vertical travel to a scale multiplier about the
  figure's centroid. During the drag, apply a **local, wasm-free preview**: scale
  the already-triangulated `FoldedGeometry` for that figure around its centroid and
  re-upload buffers (`renderer.setFolded…` / `renderNow`) — no store write.
- On release, commit once: `updateOristudioCpFoldedFigureModel(id, { scale: base * factor })`
  (Oriedita clamps `scale > 0`; keep a sane min). The committed re-render replaces
  the preview.
- Escape / right-click cancels the gesture and restores the pre-drag geometry.

The scale preview needs the active figure's geometry isolated from the merged
`FoldedGeometry`. Cheapest route: recompute just the active figure's scene from its
`renderSnapshot` with a scale-about-centroid transform in `cpFoldedToScene`
(add an optional `{ scale, pivot }` transform arg), leaving other figures untouched.

## Affected Areas

- `apps/web/package.json` — add `@radix-ui/react-dropdown-menu`.
- `apps/web/src/components/ui/ContextMenu.tsx` — controlled Radix DropdownMenu
  wrapper, cursor-anchored.
- `apps/web/src/components/ui/contextMenuTypes.ts` — item/request types.
- `apps/web/src/cp-workspace/contextMenuTarget.ts` — `CpContextTarget`.
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — right-click routing
  (click vs drag), `onRequestContextMenu` prop, scale-gesture arming + preview.
- `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` — optional
  scale-about-pivot transform for the scale preview.
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — menu state, per-target
  item builder, `advanceFoldedState`, render `<ContextMenu>`, wire scale commit.
- `apps/web/src/styles/theme.css` (or a scoped css) — context-menu styling.
- Tests: `ContextMenu.test.tsx`, a `cpFoldedToScene` transform test, and a canvas
  routing test (right-click-no-move → request; right-drag → erase).

## Phases / Checklist

- [x] **P1 – Framework:** added `@radix-ui/react-dropdown-menu`; controlled
      cursor-anchored `ContextMenu` wrapper + types + styles + tests. Radix supplies
      clamping/dismissal/keyboard nav. (commit: Radix context-menu framework)
- [x] **P2–P4 – Routing + folded menu + Flip** (committed together — routing is
      untestable without items and vice-versa): canvas right-click vs right-drag
      split; `onRequestContextMenu` + `CpContextTarget`; erase-drag unchanged;
      panel item builder with Delete, Duplicate, Wireframe (`Wire2`), X-ray
      (`Transparent3`), ready-state gating, select-on-open; Flip via extracted +
      unit-tested `advanceFoldedState` (Oriedita `advanceState` parity).
- [x] **P5 – Drag-to-scale:** scale-about-pivot preview in `cpFoldedToScene` +
      renderer `setFolded`; canvas arm/preview/commit/cancel gesture wired to
      `scaleFoldedFigureId`; commit `model.scale` on release; Escape / no-move click
      cancels; preview-transform tests.
- [x] **P6 – Verify (tool-checkable):** `npx tsc --noEmit`, `vitest run` (540
      pass), `eslint .` all clean. No `generated/**` changes (frontend-only; the
      gitignored wasm artifacts were copied into the worktree only so tsc could
      resolve them). Browser pass below is the author's.

## Testing

- **Unit:** `ContextMenu` renders items and fires `onSelect` (don't re-test Radix's
  clamping/dismissal/keyboard — that's the library's contract); `advanceFoldedState`
  cycle; scale-about-pivot transform; canvas right-click-no-move raises a request
  while right-drag still erases.
- **Browser checklist (author-verified):** right-click a folded form opens the menu
  at the cursor; each item performs its action; Flip cycles Front→Back→Both→
  Transparent; drag-to-scale resizes live and commits on release; Escape cancels;
  right-click on empty canvas does nothing new; right-**drag** still erases creases;
  cmd-drag move still works.

## Notes / Risks

- **Frontend-only** — no Rust/wasm changes; all backing actions already exist.
- **Scale perf** hinges on the wasm-free preview; committing per-move is the trap to
  avoid. If per-figure geometry isolation proves awkward, fall back to a numeric
  scale entry for P5 and keep the drag as a follow-up (does not block P1–P4).
- **Right-click semantics** — this repo keeps Oriedita's right-drag erase. The
  click/drag split preserves it; if a future target wants a menu on empty canvas,
  the same threshold applies.
- The general framework is deliberately content-agnostic so a crease-line or
  selection menu is a new `CpContextTarget` variant + a panel branch, nothing more.
