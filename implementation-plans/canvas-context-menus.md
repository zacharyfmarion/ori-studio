# Canvas context menus

## Goal

Every canvas surface in Ori Studio answers a right-click with a context menu
that offers the verbs applicable to what was clicked — so the actions currently
reachable only through the menu bar (Make Mountain, Make Auxiliary, Transform
Selection, …) are available where the work is happening.

Today exactly two context menus exist: folded figures on the CP canvas
(`foldedFigureMenuItems.tsx`) and the Design tab strip (`DesignTabStrip.tsx`).
Both hand-build `ContextMenuItem[]`. Neither shares a layer with the menu bar,
so a verb added to one does not appear in the other.

Out of scope for this plan (decided with the author): list and table surfaces
(Conditions, Inspector), and Dockview panel tabs.

## The two decisions this plan rests on

### 1. Right-click on the CP canvas is selection-aware

Right-click on the crease pattern is currently the **erase** gesture, ported
verbatim from Oriedita — `Canvas.java:329` activates `LINE_SEGMENT_DELETE_3` on
`BUTTON3` unconditionally, right-drag erases a box, right-click erases the
primitive under the cursor. A context menu there is a direct conflict.

Resolution:

| Gesture | Behaviour |
| --- | --- |
| Right-**drag** | Erase box, always — unchanged |
| Right-click on a folded figure | That figure's menu — unchanged |
| Right-click, **something selected** | Context menu for the selection |
| Right-click over an **erasable** primitive | Erase, exactly as today (upstream parity preserved) |
| Right-click on **blank paper** | The insert menu (see below) |

The selection row keeps the parity path intact for the dominant erase workflow
(you erase things that are not selected) and costs nothing to discover: the user
who has just selected creases is the user looking for verbs to apply to them.

The cost, stated plainly: the same gesture has two outcomes depending on
selection state. Mitigations — the menu opens only on a right-*click*, never a
drag, so an erase drag can never be interrupted; and `Escape` / click-away
dismisses without side effects.

### 1b. Blank paper costs no parity at all

Upstream's right-click reaches `deleteSingleLineOrCircle`, so it only ever *does*
something when a line or a circle is under the cursor. On blank paper it already
consumes the press and shows nothing. So the blank-paper menu takes only the
presses erase would have wasted.

`erasableUnderCursor` is phrased as the *erase* question ("would erasing do
anything") rather than the hit question ("is anything under the cursor"), and
that distinction is load-bearing: a **point** is pickable but not erasable, so a
right-click on a vertex is free for the menu too. Naming it after erase is what
keeps the two in step — if erasing ever learns a new target, the flag has to
learn it as well, and `cpRightClick.test.ts` asserts the property directly:
whenever erasing would act, the outcome is never `blank-menu`.

### 2. Menu content is derived, never re-declared

Every item that corresponds to a `MenuActionId` takes its **label** from
`getMenuBarDef()`, its **shortcut hint** from the shortcut registry, its
**enabled state and its reason** from `WorkspaceCapabilities`, and dispatches
through `handleMenuAction` — which is also the analytics chokepoint.

This is `useBpSheetTransforms.ts` generalized. It is what makes "the context
menu and the menu bar cannot drift" a structural property rather than a
convention, and it means these menus need **no new i18n strings** for any verb
the menu bar already has.

## Approach

### Layer 1 — shared action layer (`apps/web/src/menus/context/`)

`contextMenuActions.ts`, React-free and store-free:

- `menuActionLabelIndex()` — flattens `getMenuBarDef()` to `id -> label`.
- `contextMenuActionItem(id, ctx)` — one `MenuActionId` to a `ContextMenuItem`,
  or `null` when the capability is not `visible`.
- `contextMenuActionGroup(ids, ctx)` / `contextMenuSection(...)` — groups with
  separator pruning, reusing the collapse rule `pruneMenuItems` already states
  (no leading, trailing, or doubled dividers).
- Disabled items keep their capability `reason` as a `hint`, surfaced as the
  row's `title` attribute — so a greyed row says *why* on hover instead of
  being a dead end.

`ContextMenuItem` gains an optional `hint?: string` for that, rendered by
`ContextMenu.tsx` as `title`.

### Layer 2 — controller (`useContextMenuController.ts`)

Owns open state, viewport coordinates, and the built item list.

**Items are built once, when the menu is requested — never per render.** The
builder is a callback the surface supplies; the controller invokes it at open
time and stores the result. Capabilities are read imperatively via
`selectWorkspaceCapabilities(useWorkspaceStore.getState())` rather than through
`useWorkspaceCapabilities()`, so a canvas does not re-render on capability churn
just because it can raise a menu. This matters: the CP canvas re-renders on every
edit, and there are ~40 capability entries behind these menus.

Also owns:

- **Analytics.** One `context menu opened` event per open, carrying `surface`,
  `target_kind`, `has_selection`, and a bucketed `item_count`. Item invocation
  is *not* separately tracked when it dispatches through `handleMenuAction` —
  the chokepoint already covers it (AGENTS.md).
- **Error handling.** Every `onSelect` runs through `runContextMenuAction`,
  which catches synchronous throws and rejected promises, reports them through
  `monitoring/reportError({ surface: 'context-menu' })`, and surfaces a toast.
  Today a rejected store action raised from a menu row would be an unhandled
  rejection with no user-visible trace.
- The `onCloseAutoFocus` escape hatch for items that move focus themselves
  (dialogs, inline edits) — the trap `DesignTabStrip` already had to work around.

### Layer 3 — per-surface catalogs

Each surface contributes a React-free catalog module next to its own code, in
the shape `foldedFigureActions.ts` established (AGENTS.md names it the reference
implementation): a target descriptor in, plain item descriptors out.

## Surface-by-surface review

### Crease-pattern canvas — `cp-workspace/`

Target resolved from the pointer, most specific first.

**Selection (creases selected).** The verb set the author asked for:

- Cut / Copy / Paste, Delete Selected Lines
- Crease type — submenu: Change Crease Type, Advance Crease Type, Toggle
  Mountain/Valley, then Make Mountain / Valley / Edge / Auxiliary /
  Unassigned (Keep Direction) / Unassigned
- Transform — submenu: Flip Horizontal / Vertical, Rotate Left 90 / Right 90
- Selection — Select All, Deselect All, Select By Index…, plus Replace Selected
  Line Type… and Delete Selected Line Type…
- Fold / Simulate / Export selection — only when the selection resolves to one
  complete border-enclosed sub-pattern, mirroring `CpSelectionToolbar`'s own gate
- Diagnostics — Check foldability, Fix Inaccurate Creases…

**Circle selected.** Change Circle Color…, Organize Circles, Delete.

**Text annotation.** Edit, opacity/stacking verbs from `AnnotationActions`,
Bring to Front / Send to Back, Delete.

**Image annotation.** Same stacking/opacity verbs, plus Crop and Delete.

**Folded figure.** Unchanged content — `buildFoldedFigureActions` already owns
it; it moves onto the shared controller so it inherits analytics and error
handling.

**Blank paper (nothing selected, nothing erasable under the cursor).** Insert
image… / Insert text, then Paste and Select All.

Both insert rows are *placement-aware*, which is the whole difference between
them and the Insert menu they borrow their gating from. The menu bar has no
click point: its Text arms the tool so the next canvas click places a box, and
its Image lands in the middle of the viewport. Here both go exactly where the
cursor was.

**All three rows anchor by the top-left corner**, not the centre. A drop and the
Insert menu mean "here-ish" and centre on the cursor; a right-click menu means
"start it here", so the pasted bounding box's top-left and the image's top-left
corner land on the point. `placeCpLineSegmentsAt` reads top-left as
`(minX, minY)` because model y increases *downward* — `ORIEDITA_PAPER_CORNERS`
labels `(minX, minY)` "paper top left", and reading it the other way would drop a
paste a full bounding-box height above the cursor. The image offset is rotated
through the box's own angle, since the image is squared to the *screen* and under
a turned view its visual top-left is not its model-space minimum corner.

Text is the exception: it still centres on the point, because `createTextAt` is
also the Text tool's click-to-place and changing it would move that gesture too.

Two consequences worth stating:

- **Image still dispatches `insert.image` through `handleMenuAction`**, so it
  stays on the analytics chokepoint and inside the capability gate. The picker
  breaks the call in half — the caller that knows the point only opens a dialog,
  and the file arrives later on `change` — so the point is *parked*
  (`setPendingImagePoint`) and consumed by the picker's handler. Cleared on
  read, so a cancelled dialog cannot drop the next image at a stale point.
- **Text does not**, because `insert.text` means "arm the tool" and this means
  "put one here" — dispatching it would both place a box and arm the tool. So
  this row is invisible to `command invoked`; `context menu opened` is what
  measures it.

The rows are relabelled ("Insert image…", not the bar's "Image..."), because the
bar's wording reads correctly under a menu *titled* Insert and reads as nothing
in particular on its own. Gating and the disabled reason are still derived —
that is the part that must not drift.

### Box-pleat packing canvas — `BpPackingPanel.tsx`

- **Flap**: nudge (up/down/left/right), Unpair from mirror when paired, Delete.
- **River**: Delete, and the selection verbs.
- **Sheet / empty**: Increase / Decrease Grid Size, Subdivide / Un-subdivide
  Grid, Rotate Left / Right, Flip Horizontal / Vertical, Optimize Layout… —
  every one of these is already a `MenuActionId` behind
  `useBpSheetTransforms`, so they cost nothing but a list.

### Tree canvases — `tree-editor/` (BP tree + Explori)

Driven off `TreeEditorHost`, so one implementation covers both surfaces:

- **Vertex**: Rename (when `isNameable`), Add leaf here, Unpair from mirror
  (when `symmetry.partnerOf` resolves), Delete.
- **Edge**: Set length…, Delete.
- **Empty**: Deselect All, mirror-draw toggle, Labels layer toggle.

### TreeMaker Design tree — `DesignPanel.tsx`

The Edit menu's tree verbs, which today live only in the menu bar and the
Inspector:

- **Node**: Make Root, Absorb Nodes, Perturb Nodes, Add Largest Stub From Nodes,
  Delete
- **Edge**: Split Edge…, Set Edge Length…, Scale Edge Lengths…, Renormalize To
  Edge, Absorb Edges, Remove/Relieve Strain
- **Empty**: Select All / Deselect All, Select Movable Parts, Select Corridor
  Facets, Optimize Scale / Edges / Strain, Build Crease Pattern

### Simulator viewport — `SimulatorPanel.tsx`

Every entry is an existing `SimulatorShortcutId`, so the menu is a discoverable
face on shortcuts that are otherwise invisible: Play/Pause, Step forward/back,
Replay from flat, Reset view, Set upright, and the four view toggles (Faces,
Creases, Hidden lines, Lighting) as checked items.

## Accessibility and touch

- A `viewport.contextMenu` shortcut (`Shift+F10` and the `ContextMenu` key) is
  registered in the shortcut registry and implemented in each surface's viewport
  executor — **not** as a panel `keydown` listener, per AGENTS.md. It anchors at
  the selection's bounds, or the viewport centre when nothing is selected.
- Touch raises the menu on long-press on the three SVG canvases (BP packing,
  the tree editor, the TreeMaker design tree) and the simulator, because both
  iOS Safari and Android Chrome dispatch a real `contextmenu` event for a long
  press and those surfaces bind it directly.

  **The CP WebGL canvas is the exception**, and deliberately: it suppresses
  `contextmenu` outright and routes right-clicks through `pointerdown` with
  `button === 2`, which a touch never produces. Adding a long-press path there
  means reaching into `cpTouchArbiter`, which already arbitrates pan, pinch,
  draw and palm rejection — real regression risk for a surface whose coarse-
  pointer users already have the floating toolbar and the tool rail. Left as
  pointer + keyboard; worth revisiting on its own.
- Radix supplies focus trap and return, roving focus, typeahead, arrow-key
  navigation, Escape, and collision handling — `ContextMenu.tsx` already
  delegates all of it.

## Affected Areas

- `apps/web/src/menus/context/` (new): action layer, controller, tests
- `apps/web/src/components/ui/ContextMenu.tsx`, `contextMenuTypes.ts`: `hint`
- `apps/web/src/cp-workspace/`: `contextMenuTarget.ts` widened, new CP catalog,
  canvas right-click routing, folded-figure migration
- `apps/web/src/components/panels/`: `CreasePatternPanel`, `BpPackingPanel`,
  `DesignPanel`, `SimulatorPanel`
- `apps/web/src/tree-editor/`: `TreeScene` / `TreeEditor` right-click routing
- `apps/web/src/keyboard/shortcuts.ts`, `shortcutRuntime.ts`: the new shortcut
- `apps/web/src/analytics/events.ts`: `context menu opened`
- `apps/web/public/locales/*`: only the strings no menu-bar verb already has

## Checklist

- [x] Shared action layer + tests
- [x] `hint` on `ContextMenuItem`, rendered as `title`
- [x] Controller hook (lazy build, analytics, error handling) + tests
- [x] CP canvas: selection-aware right-click routing
- [x] CP canvas: target catalogs (selection, circle, text, image, empty)
- [x] Folded-figure menu migrated onto the shared controller
- [x] BP packing canvas
- [x] Tree canvases (BP + Explori) via `TreeEditorHost`
- [x] TreeMaker Design tree
- [x] Simulator viewport
- [x] `viewport.contextMenu` shortcut (CP, BP packing, tree, design tree)
- [x] Long-press on the SVG canvases + simulator; WebGL canvas deferred (above)
- [x] `context menu opened` analytics event
- [x] i18n: extract, translate 8 locales, stamp, check
- [ ] lint / typecheck / unit tests / build
- [ ] Browser verification of each surface
