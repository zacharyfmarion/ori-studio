# Canvas Object Properties Panel

## Goal

Give the Edit workspace a **Properties** pane, a permanent tab in the View
pane's dock group, that shows the **editable properties** of the selected
canvas object: a folded figure (display style, side, colours, shadows,
anti-alias, camera, placement), a text box (alignment, block preset, colour,
size, opacity), a reference image (opacity, rotation), an inline simulation
window (the simulator settings it shares), and a suppression or detection solve
region (suppressed checks, opacity, its owned reference image's visibility and
opacity). It holds properties, not verbs: delete, duplicate, refold, stacking,
refresh, Solve and the rest stay on the floating toolbars, chips and context
menus that already own them. With nothing selected it shows one sentence.
Selecting an object brings the tab forward; the pane never steals the selection
it is showing; every edit is one undo entry.

The architecture must make a new object kind register its properties in one
place, and it must be honest about what "one place" means: the pane's own
registration is three files and three compile-enforced rows, but a canvas object
kind also has store, history, overlay, `.osf` and export obligations that this
plan consolidates into one per-kind binding table rather than pretending away.
Both are held to account by a stub-kind test, the same way
`designKinds/registry.test.ts` holds the design-kind registry to account.

Paths are relative to `apps/web/src` unless they name a crate, a doc or a plan.

## Research summary

What exists today, per subsystem, with the facts this plan is built on. Line
numbers are as of `95ca7d79` on `main`.

**Dock layout.** One `DockviewReact` in `components/WorkspaceShell.tsx` serves
all three workspaces. The Edit default (`store/layoutStore.ts:277-286`) is a
headerless `crease-pattern` group plus, on fine pointers only, the View pane
`cp-view-controls` docked `direction: 'right'` at 260px. Everything about that
pane is one record in `WORKSPACE_VIEW_PANELS` (`layoutStore.ts:140-155`) —
typed one pane per workspace — and its id union `ViewPanelId` keys the touch
drawer's body map (`components/WorkspaceViewDrawer.tsx:21-24`), which is how a
pane without a drawer body fails to compile. Under a coarse pointer
`reconcileViewPanel` (`:218-235`) removes the pane and `WorkspaceViewDrawer`
shows it in a sheet behind one "View" pill. Dockview's `fromJSON` restores
exactly the captured panel set; `reconcileViewPanel` **already** adds a missing
View pane on a fine pointer (`:234`) — the "repair, don't bump" rung exists for
the one pane the module owns, and this plan generalises it to a list. It runs
before the `onDidLayoutChange` subscription on first mount
(`WorkspaceShell.tsx:381` vs `:392`) and after it on every workspace switch
(`layoutStore.ts:385-391`) and pointer flip (`hooks/useWorkspaceViewDrawer.ts:51-54`),
where the repaired layout is written back by the debounced save — harmless,
since the saved layout equals the repaired one. Programmatic activation is
`activatePanel(id)` → `panel.api.setActive()` (`:417-434`), which the BP slice
defers with `runAfterPointerGesture` (`lib/pointerGesture.ts:82`) because a
reflow mid-gesture drops the click. Every panel id must be listed in
`components/panels/PanelComponents.tsx`, `workspaces/workspaces.ts`
(`WORKSPACE_BY_PANEL_ID`) and `workspaces/editingContext.ts`
(`STATIC_PANEL_CONTEXTS`, which is what keeps menus, undo and the shortcut scope
on the crease pattern when a side pane is the dock's active panel). Dock titles
are English literals. Dockview's `Direction` includes `'within'`
(`dockview-core/.../baseComponentGridview.d.ts:12`).

Verified for this plan: dockview 4.13.1 creates a panel's React portal at
`init` and disposes it only on removal (`node_modules/dockview/dist/cjs/react.js:82-146`),
so an inactive tab's hooks keep running; `panel.api.isVisible` exists;
`setActive()` → `openPanel` + `doSetGroupAndPanelActive` calls no `.focus()`
anywhere on its path (`dockviewComponent.js:954-956`,
`dockviewGroupPanelModel.js:563-575`), so revealing the tab does not move DOM
focus. The mock in `store/layoutStore.test.ts:45-123` models `referenceGroup`
but not `setTitle`, `inactive` or restored group ids/`hideHeader`; Phase B
extends it.

**Selection.** The canvas has one selection, held by one of four store fields
(`oristudioCpSelection`, `oristudioCpSelectedAnnotationId`,
`oristudioCpActiveFoldedFigureId`, `oristudioCpFocusedInlineSimulationId`) plus
the narrower `oristudioCpFocusedFoldedFigureId`. Claims go through the
slice-private `takeCanvasSelection(owner, patch)`
(`store/workspaceStore/slices/creasePatternSlice.ts:780-813`); releases are
deliberately asymmetric. Three raw `set` writes bypass it — the 3D fold
completion (`:2261-2263`), the flat fold completion (`:2419`) and the release at
`:1924` — and `deleteOristudioCpFoldedFigure` (`:3444-3452`) auto-advances to
`remaining[0]`. The **async landing** of a flat-figure model or style write
re-claims the canvas (`takeCanvasSelection('folded-figure', …)` at `:2882-2892`
and `:2769-2782`), which is fine while the figure is the only thing that can be
selected during a round trip and wrong once a pane can issue writes while the
user clicks elsewhere. `selectedCanvasObjectId`
(`cp-workspace/canvasObjects/transformableObject.ts:114-122`) folds the three
object ids into one; there is no "resolve the selected object and its kind"
function. `CreasePatternPanel.tsx` branches by id-membership probes
(`:1095-1150`, `:1258-1270`) and a panel-local `selectedCpRegion` memo
(`:795-798`); `cp-workspace/contextMenu/useCpCanvasContextMenu.ts:218-227` does
the same, and `openAnnotationMenu` (`:112`) maps every non-text annotation to
the image menu. The `:1120-1150` branches are **id-addressed** (the overlay
reports updates by id), not selection-driven. Undo nulls the annotation
selection (`historySlice.ts:305`) and drops window focus (`:103-107`) but
restores the active folded figure. `.osf` load restores `viewState.selection`
and `activeFoldedFigureId` without applying the one-holder rule
(`projectSlice.ts:1179-1183`).

**Folded figures.** Appearance lives on Oriedita's `OristudioCpFoldedFigureModel`
(`engine/oristudioCpTypes.ts:372-384`) — on `entry.snapshot.model` for a flat
figure (a kernel round trip through `updateOristudioCpFoldedFigureModel`,
`creasePatternSlice.ts:2817-2905`) and on `entry.folded3d.model` for a 3D one
(re-projected in TypeScript). Ours sits beside it: `displayStyle`, `placement`,
`camera`. `folded/foldedFigureAppearance.ts` answers `supported | unsupported |
not-applicable` per option; `foldedFigureCapabilities.ts` answers verbs by
kind; `isFoldedFigureReady` answers readiness. The verbs are a React-free catalog
(`folded/foldedFigureActions.ts`) bound in `folded/useFoldedFigures.ts`
(968 lines, single-instance: it needs `{ cpDocument, selectedFoldLineIds }` and
owns the orbit and rehydration effects; its gesture refs are
`preGestureFoldedFiguresRef`/`preGestureActiveFoldedIdRef` at `:252-254` and
`foldedModelGestureScopeRef` at `:727`). The appearance form is
`folded/FoldedFigureControls.tsx` (figure list, display style, side, three
colours — the header's "four" is stale — and a shadow toggle), rendered by the
panel-inline `FoldedFigureMenuButton` (`CreasePatternPanel.tsx:493-568`, with a
`mousedown` listener) and by `FoldedFigureModal` on phones. The slice merges a
partial onto `figure.snapshot.model` as of call time (`:2860-2863`, so two
in-flight writes to different fields lose one), and `pendingLiveModelWrites` is
a `Set` (`:403`), so the first finished tick unmasks a reconcile while others
are in flight. A colour drag issues one `set_model` + one `render_snapshot` per
pointer move (~200 ms native per tick on a 2156-crease figure: `set_model`
rebuilds the wireframe, `render_snapshot` rebuilds it again plus the subface
arrangement; nothing on the session caches them), the worker is FIFO, and the
gesture commits on blur without waiting for the last write. `side` on a 3D
figure writes `folded3d.model.state`, which the re-projection reads only while
the figure has no recorded `camera` (`folded3dReproject.ts:70`,
`foldedFigure3dProjection.ts:338`) — effective before the first orbit, inert
after it.

**Text boxes.** A `TextAnnotation` is box fields plus a Lexical
`SerializedEditorState` `doc`; alignment, block type and colour live *inside*
`doc` and are only edited through the live editor (`cp-workspace/CpTextEditor.tsx:225-260`).
`editingTextId` is React state inside `annotations/useCpAnnotations.ts:381`;
the edit session shares `preGestureAnnotationsRef` with every other annotation
gesture (`:109-119` vs `:395/:436`). The session ends on Escape (Lexical's
`KEY_ESCAPE_COMMAND` at `COMMAND_PRIORITY_HIGH`) or on a `focusout` whose
`relatedTarget` is not inside `[data-cp-text-toolbar]` (`CpTextEditor.tsx:89-97`)
— including `relatedTarget === null`, which a click on a non-focusable surface
produces. Cmd+Z with the caret in the box is Lexical's own `HistoryPlugin`
(`:126`): both app dispatchers bail on a contentEditable target, and the
plugin's `preventDefault` beats the native menu accelerator. A
selected-not-editing box has no inspector at all. Core `lexical`'s
`createEditor` with no root element behaves headlessly (verified in the
research pass: `parseEditorState` + `$selectAll` + `$setBlocksType` /
`setFormat` / `$patchStyleText` + `toJSON()` produce the shape `CpTextView`
renders), so a headless transform needs no new dependency.

**Images and inline simulations.** Images are the `'image'` annotation
variant, written through `updateAnnotation` and bracketed by
`useCpAnnotations.beginGesture/commitGesture`; `AnnotationOpacitySlider` is the
one-entry-per-drag slider (first `input` opens, native `change` commits). Inline
simulations split a plain descriptor (`oristudioCpInlineSimulations`) from a
runtime side table (`inlineSimulation/inlineSimulationRuntime.ts`); windows
render with the app-wide `simulatorSettings`, deliberately not per window
(`InlineSimulationInspector.tsx:116-121`). A focused window is its selection,
and `inlineSimulation/useBlurOnPressOutside.ts` (a capture-phase document
`pointerdown`) blurs it on any press outside the CP panel except
`PORTALED_SURFACES`. `view` is written once and never read back.

**Regions.** One data type, `CpSuppressionRegion`; a solve region is one whose
`solveInput` is non-null (`annotations/suppressionRegion.ts:196`,
`hasAttachedSolveInput`). The chip is always mounted and is the only handle; its
check-class menu ticks *suppressed*. `regions/useCpRegionActions` is re-entrant
(already mounted twice); `useCpRegions().regions` costs a hidden-findings pass
per instance (`:76-83`). `regions/useCpRegionSolve.ts` is mounted once by the
panel, holds terminal records in `useState`, and owns the only
`CP_EXACT_SOLVE_REQUEST_EVENT` listener; live runs come from the module registry
`engine/cpExactSolveRuns.ts`. No solver option is user-tunable per region; all
are `Auto` in Rust with measured rationale.

**Canvas overlay gestures.** `cp-workspace/CanvasObjectOverlay.tsx` calls
`onSelect(id)` and `onGestureStart(id)` on **every** primary pointerdown
(`:417-432`, a plain click included), calls `onGestureCommit` only when the drag
moved (`:603-613`), and never closes the bracket on `handlePointerCancel`
(`:599`) or `abortDrag` (`:642-650`). That is harmless today only because the
next `begin` overwrites the per-hook ref. The overlay also carries a raw
`window` keydown Escape listener with its own editing-target predicate
(`:352-369`) — an existing rule violation this plan does not build on.

**UI kit and conventions.** `components/ui` has `Toggle`, `Select` (whose
`SelectContent` spreads props onto the portalled content), `Slider` (exposes its
ref for the native `change`), `NumberField` (draft, commit on blur/Enter, Escape
revert, skips no-op commits), `ColorField` (`onChange` per move, `onCommit` on
blur, `layout='row'`), `SegmentedControl`. There is no shared field-row kit —
`ToggleRow`/`NumberRow`/`SliderRow`/`Section` are private copies in
`components/panels/CpViewControlsPanel.tsx:422-485`,
`SimulatorViewControlsPanel.tsx:390-506`, `InspectorPanel.tsx:161-276`, and
`components/CreaseExportDialog.tsx:80-110`. Labels must be literal-key `t()`
calls; `foldedFigureControlOptions.ts` and `i18n/enumLabels.ts` are the
render-site helper shape.

**Registry patterns.** `designKinds/registry.ts` is the realised descriptor
registry with a stub-kind test; `folded/foldedFigureActions.ts` +
`useFoldedFigures.ts` + two renderers is the catalog discipline AGENTS.md names.
`CreasePatternPanel.tsx:3495-3551` mounts the per-object floating inspectors as
a hand-written cascade whose comment asks for "a registry keyed by annotation
kind". The decomposition plan's Phase 2a (`activeFloatingSurface`) never
landed — the plan's status table is stale.

**Undo, keyboard, analytics.** One CP undo stack; every overlay edit is a
snapshot-before/record-once bracket owned by a per-hook ref with no nesting
guard, and every overlay entry captures **all three** layers live
(`recordAnnotationHistory` passes `get().oristudioCpFoldedFigures`,
`creasePatternSlice.ts:3636-3642`; undo restores all three,
`historySlice.ts:89-95`). Every undo path — chords through `lib/appKeyboard.ts`
→ the shortcut runtime → `handleMenuAction`, `components/MenuBar.tsx`,
`menus/nativeMenu.ts`, `components/CanvasHistoryPills.tsx` — reaches the
`edit.undo`/`edit.redo` arm of `commands/menuActions.ts:526-531`; nothing else
calls `undo()`. `isShortcutEditingTarget` (`keyboard/shortcutDispatcher.ts:63-70`)
is the one editing-target predicate, and `handleShortcutKeyDown` (`:72-77`) and
`handleAppKeyDown` (`lib/appKeyboard.ts:27`) bail on **every** chord for such a
target — so it must not be widened to Radix buttons. `PANELS_WITH_LEGACY_KEYDOWN`
lists `CreasePatternPanel.tsx` (`eslint.config.js:366-371`), but the panel has
no `keydown` listener — the entry is already stale. `CreasePatternPanel.tsx` is
2864 counted lines against a frozen cap of 2900. Analytics go through
`analytics/` with enum and bucketed values only; menu verbs are captured at the
`handleMenuAction` chokepoint.

**Persistence.** Every per-kind `.osf` validator rebuilds an explicit literal
and drops unnamed fields (`nativeProjectFile.ts:701-710` "This function is the
drop"); additive optional fields need no schema bump. `apps/web/docs/superset-features.md`
is the existing checklist for a new web-side canvas object kind (store split,
writer, reader, export-loss row, label) — this plan extends it rather than
writing a second one.

## Architecture

### 0. The shape in one paragraph

Selection → `resolveSelectedCanvasObject(state)` (pure, one loop over a
compile-enforced table of per-kind resolvers) → the registry entry for that kind
→ `use<Kind>Properties(target)` returns a `PropertySheet` (plain data: sections
of typed field descriptors, each carrying its support, value and commit
protocol) → `PropertySheetView` renders it with one exhaustive switch over
`field.kind` onto a shared field-row kit → each commit calls back into the
catalog's bound deps, which route through a module-level gesture owner per
layer, so a drag is one undo entry whether it started in the pane or on the
canvas. `CpPropertiesPanel` is ~40 lines of composition. Nothing adds a store slice; state two
dock panels must share moves to `useSyncExternalStore` side tables beside the
concern, the shape `cpOverlayViewStore`, `cpToolSurface` and `folded3dRuntime`
already use. Every field is a property with a value; there are no action rows
and no custom sections — verbs keep their existing homes. The same per-kind
table that resolves a selection also carries each kind's **canvas layer
bindings** (select, box update, gesture begin/commit/cancel, delete, context
menu), so the canvas panel concatenates lists instead of naming kinds.

### 1. The descriptor model — `lib/propertyDescriptors.ts`

`lib/` because nothing here knows about the crease pattern; a later Design-side
inspector can reuse the field and protocol types. The section-id parameter is
generic so no CP concept leaks into the lib type.

```ts
/** The answer foldedFigureAppearance.ts gives, generalised: hide 'not-applicable', disable 'unsupported' with a reason. */
export type PropertySupport = 'supported' | 'unsupported' | 'not-applicable';

/** A value that moves outside React (orbit camera, fold percent). The row subscribes; the sheet does not re-render. */
export interface LiveValue<T> {
  read(): T;
  subscribe(listener: () => void): () => void;
}

interface FieldBase {
  /** Stable per kind ('opacity', 'frontColor', …). Doubles as the analytics `property` enum. */
  id: string;
  /** Already translated: the catalog calls t('panels:cpProperties.<kind>.<id>', 'English') literally. */
  label: string;
  support: PropertySupport;
  /** Translated; the row's title while 'unsupported'. */
  reason?: string;
  /** Translated history label. Absent for non-document fields (shared simulator settings). */
  undoLabel?: string;
  /**
   * Put the property back to its default, when a default exists (a camera row
   * back to the fold's view, a crop back to full). The ColorField.onClear
   * affordance generalised — a per-field reset is still a property edit, not a
   * verb, and it records `undoLabel` like any other commit.
   */
  reset?: () => void;
}

/** Three commit protocols. Which one a field uses is data, so the renderer never guesses. */
export interface DiscreteCommit<T> { protocol: 'discrete'; value: T; commit(next: T): void }
export interface DraftCommit<T>    { protocol: 'draft';    value: T; commit(next: T): void }
export interface ContinuousCommit<T> {
  protocol: 'continuous';
  value: T;
  /** Opens the layer's bracket; false when another owner holds it (the row then resyncs and does nothing). */
  begin(): boolean;
  /** Per pointer move; writes the store, records nothing. A no-op once the bracket was aborted underneath it. */
  update(next: T): void;
  /** Closes the bracket once and records `undoLabel` once. */
  end(): void;
  /** True while another surface (a canvas drag, a draining folded commit) holds this layer's bracket — the row renders disabled. */
  held: boolean;
}

export interface PropertyOption { id: string; label: string; icon?: string }

export type ToggleField    = FieldBase & { kind: 'toggle' } & DiscreteCommit<boolean>;
export type SelectField    = FieldBase & { kind: 'select';    options: readonly PropertyOption[] } & DiscreteCommit<string | null>; // null = mixed
export type SegmentedField = FieldBase & { kind: 'segmented'; options: readonly PropertyOption[] } & DiscreteCommit<string | null>;
export type NumberField    = FieldBase & { kind: 'number'; min?: number; max?: number; step?: number; suffix?: string;
                             normalize?: (v: number) => number; live?: LiveValue<number> } & DraftCommit<number>;
export type TextField      = FieldBase & { kind: 'text'; placeholder?: string } & DraftCommit<string>;
export type SliderField    = FieldBase & { kind: 'slider'; min: number; max: number; step?: number; format?: (v: number) => string } & ContinuousCommit<number>;
export type ColorField     = FieldBase & { kind: 'color' } & ContinuousCommit<string /* #rrggbb */>;

export type PropertyField = ToggleField | SelectField | SegmentedField | NumberField | TextField
                          | SliderField | ColorField;

export interface PropertySection {
  id: string;
  title?: string;
  /** e.g. "Shared with the Simulate workspace" */
  description?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  fields: readonly PropertyField[];
}

export interface PropertySheet {
  /** The registry key; the analytics `object_kind` enum. */
  kind: string;
  targetId: string;
  title: string;
  /** Read-only context (an image's natural size, a figure's stale/case note); the one place the sheet shows something it does not edit. */
  subtitle?: string;
  icon?: string;
  sections: readonly PropertySection[];
}
```

Seven field kinds, no action kind, no custom-section escape hatch. The first
draft had both — an `action` row for delete/duplicate/refold/stacking and named
custom sections for a figure list, the region solve and an object list — and
the product decision that removed them is simpler than the machinery was: the
pane edits properties; verbs already have surfaces (`foldedFigureActions.ts`
and its two renderers, `AnnotationActions`, the region chips, the context
menus), and a list of things to select is navigation, not a property of the
thing selected. A kind whose "properties" cannot be expressed as one of the
seven field kinds is a sign the thing is not a property.

Rules the types encode: labels are strings because the catalog is where the
literal `t()` call lives (the `foldedFigureActions.ts` discipline: `t` arrives
in `deps`); `support` is computed per field per object by the kind's own oracle
(`foldedAppearanceSupport`, `annotationCanHide`, `foldedFigureCapabilities`,
`isFoldedFigureReady`), so a control that would render enabled-and-inert is a
catalog bug a pure catalog test catches. `PropertySheet` carries no CP concept,
so a later Design-side pane can reuse it unchanged. There is no `validate`; BP-style
engine-refused commits (`commit → Promise<boolean>` with snap-back) are a
follow-up for a Design-side pane, not a speculative field every kind author
reads.

### 2. Kinds, resolver, layer bindings, registry

**Kinds and targets — `cp-workspace/canvasObjects/canvasObjectKinds.ts`**
(React-free, store-free):

```ts
export type CanvasObjectKind = 'image' | 'text' | 'suppressionRegion' | 'folded-figure' | 'inline-simulation';

export type CanvasObjectTarget =
  | { kind: 'image'; id: string; annotation: CpImage }
  | { kind: 'text'; id: string; annotation: TextAnnotation }
  | { kind: 'suppressionRegion'; id: string; annotation: CpSuppressionRegion; solvable: boolean }
  | { kind: 'folded-figure'; id: string; figure: OristudioCpFoldedFigureEntry }
  | { kind: 'inline-simulation'; id: string; simulation: InlineSimulation };
export type TargetOf<K extends CanvasObjectKind> = Extract<CanvasObjectTarget, { kind: K }>;

/**
 * One row per kind. The row says which store field holds this kind's selection
 * id and which array holds its entries, so the id precedence, the entry lookup
 * and the store hook are all derived from the table instead of restating the
 * three id fields by hand — the omission that would otherwise let a new kind
 * compile and never resolve. The two field unions are typed against
 * `WorkspaceState` so a new layer widens them by naming its fields, and the
 * derived constants below pick the change up without a second edit.
 */
export interface CanvasObjectKindRow<K extends CanvasObjectKind> {
  kind: K;
  /** The store field whose non-null value means "this kind holds the canvas". Annotation kinds share one. */
  selectionIdField: CanvasSelectionIdField;
  entriesField: CanvasEntriesField;
  /** Narrow one entry of `entriesField` to this kind's target, or null. Lives beside the kind. */
  resolve(entry: unknown, id: string): TargetOf<K> | null;
}
export type CanvasSelectionIdField = 'oristudioCpSelectedAnnotationId' | 'oristudioCpActiveFoldedFigureId' | 'oristudioCpFocusedInlineSimulationId';
export type CanvasEntriesField = 'oristudioCpAnnotations' | 'oristudioCpFoldedFigures' | 'oristudioCpInlineSimulations';

export const CANVAS_OBJECT_KINDS = {
  image:               imageCanvasObjectKind,             // images/imageCanvasObject.ts
  text:                textCanvasObjectKind,              // annotations/textCanvasObject.ts
  suppressionRegion:   regionCanvasObjectKind,            // regions/regionCanvasObject.ts (solvable = hasAttachedSolveInput)
  'folded-figure':     foldedFigureCanvasObjectKind,      // folded/foldedFigureCanvasObject.ts (generated figures only)
  'inline-simulation': inlineSimulationCanvasObjectKind,  // inlineSimulation/inlineSimulationCanvasObject.ts
} as const satisfies { [K in CanvasObjectKind]: CanvasObjectKindRow<K> };

/** Deduplicated at module load, in table order — the precedence `selectedCanvasObjectId` has always had. */
export const CANVAS_SELECTION_ID_FIELDS: readonly CanvasSelectionIdField[];
export type CanvasSelectionFields = Pick<WorkspaceState, CanvasSelectionIdField | CanvasEntriesField>;

/** The selected object's id, or null — over `CANVAS_SELECTION_ID_FIELDS`, so a new layer's field is read the moment its row exists. */
export function selectedCanvasObjectIdOf(state: Pick<WorkspaceState, CanvasSelectionIdField>): string | null;
/** The store entry with this id from whichever `entriesField` holds it (a stable reference), or null. */
export function findCanvasObjectEntry(state: Pick<WorkspaceState, CanvasEntriesField>, id: string): unknown | null;
/** Try each row's `resolve` against one entry. */
export function resolveCanvasObjectEntry(entry: unknown, id: string, kinds = CANVAS_OBJECT_KINDS): CanvasObjectTarget | null;
export function resolveCanvasObjectById(state: CanvasSelectionFields, id: string, kinds = CANVAS_OBJECT_KINDS): CanvasObjectTarget | null;
export function resolveSelectedCanvasObject(state: CanvasSelectionFields, kinds = CANVAS_OBJECT_KINDS): CanvasObjectTarget | null;
export function canvasObjectKindOf(state: CanvasSelectionFields, id: string): CanvasObjectKind | null;
```

`transformableObject.ts`'s `selectedCanvasObjectId({ annotationId, foldedFigureId, inlineSimulationId })`
keeps its signature and callers (`CreasePatternPanel.tsx:1079`,
`transformableObject.test.ts`) and becomes a thin adapter over
`selectedCanvasObjectIdOf`, so the precedence has one implementation. A solve
region is **not** a sixth kind: it is `suppressionRegion` with `solvable` from
`hasAttachedSolveInput` (`suppressionRegion.ts:110-113` says Solve is decided
by data, never geometry). A dangling id (the `oristudioCpFocusedFoldedFigureId`
gap, a post-undo id) resolves to null. Imported/preserved-frame folded figures
resolve to null exactly as `useFoldedFigures.selected` excludes them: the
folded row imports `isFoldedFromCurrentCpSourceKind` from
`engine/oristudioCpTypes.ts`, the predicate the hook already uses (`:190`,
`:199`), so there is one predicate and nothing to drift.

**Store hook — `cp-workspace/canvasObjects/useSelectedCanvasObject.ts`**.
zustand 5.0.13's bound hook takes a selector only (no equality parameter;
nothing in `apps/web` uses `zustand/traditional` or `useShallow`), and a
selector returning a fresh object per call trips React's uncached-`getSnapshot`
guard; `react-hooks/rules-of-hooks` (eslint-plugin-react-hooks 7.1.1, enabled
in `eslint.config.js:408-411`) forbids a hook call inside a `ROWS.map`
callback and `react-hooks/use-memo` rejects a spread deps array. So: two
selectors that each return a primitive or an existing store reference, and one
memo:

```ts
export function useSelectedCanvasObject(): CanvasObjectTarget | null {
  // A string or null: the selector iterates the table's id fields, the hook does not.
  const id = useWorkspaceStore((s) => selectedCanvasObjectIdOf(s));
  // The entry object as it sits in its store array — a stable reference, so Object.is holds across foreign drags.
  const entry = useWorkspaceStore((s) => (id ? findCanvasObjectEntry(s, id) : null));
  return useMemo(() => (id && entry ? resolveCanvasObjectEntry(entry, id) : null), [id, entry]);
}
```

A placement drag of *another* object builds a new array whose selected entry is
`Object.is`-equal, so the pane does not re-render; a drag of the selected object
itself does, which it should. Sheet hooks select sub-values further
(`figure.snapshot?.model`, `annotation.opacity`). A test asserts the hook and
`resolveSelectedCanvasObject` agree on every seeded selection and that a stub
row with a new `selectionIdField` is read without editing the hook.

**Canvas layer bindings — `cp-workspace/canvasObjects/canvasLayerBindings.ts`**.
Today `CreasePatternPanel` names every kind by hand in `selectCanvasObject`
(`:1095-1108`), `handleCanvasObjectUpdate` (`:1122-1129`),
`beginCanvasObjectGesture`/`commitCanvasObjectGesture` (`:1132-1150`), the
delete ladder (`:1258-1270`), `canvasObjects` (`:1029-1039`), `overlayBoxes`
(`:1006-1021`) and `inertBodyIds` (`:1060-1068`), and
`useCpCanvasContextMenu.onCanvasObjectContextMenu` does it again. Each of those
is a per-kind arm a new kind must add — the documented "half-registered" bug.
Phase C2 replaces them with one binding record per kind, **produced by the
kind's own `use*` hook** (which already owns the verbs and the transformable
projections) and concatenated by the panel:

```ts
/** One per overlay *layer* (annotations, folded figures, inline simulations), produced by that layer's use* hook. */
export interface CanvasLayerBinding {
  /** The kinds this layer answers for — the annotation layer answers for three. */
  kinds: readonly CanvasObjectKind[];
  transformables: readonly TransformableCanvasObject[];
  /** Boxes fit-to-view must include (regions and windows today; the canvas' prop shape, which carries `hidden`). */
  overlayBoxes: readonly (AnnotationBox & { hidden: boolean })[];
  /** Bodies the overlay must leave alone (focused windows/figures, every region). */
  inertBodyIds: ReadonlySet<string>;
  select(id: string): void;
  /** The layer's own release — the `null` arm of today's selectCanvasObject (:1099-1104) releases every layer. */
  release(): void;
  applyBoxUpdate(id: string, patch: CanvasObjectBoxUpdate): void;   // CanvasObjectOverlay.tsx:66-71 is the patch type
  beginGesture(id: string): boolean;      // → the layer's gesture owner; false = refused
  commitGesture(id: string, kind: 'move' | 'resize' | 'rotate' | 'crop'): void;
  cancelGesture(id: string): void;
  remove(id: string): void;
  /** A complete open request (rows + targetKind + hasSelection, the shape useContextMenuController.request takes), or null for a kind with no menu (windows today). */
  contextMenu(id: string): ContextMenuOpenRequest | null;
  /** Image- and text-only overlay inputs today (crop, request-edit); optional so the other layers omit them. */
  applyCrop?(id: string, patch: CpImageCrop): void;
  canCrop?(id: string): boolean;
  requestEdit?(id: string): void;
}
export function mergeCanvasLayerBindings(bindings: readonly CanvasLayerBinding[]): {
  byId(id: string): CanvasLayerBinding | null; releaseAll(): void; transformables; overlayBoxes; inertBodyIds;
};
```

`useCpAnnotations` returns one binding for its three annotation kinds (they
share a layer, and its `remove`/`contextMenu` dispatch on `AnnotationKind`
internally with an exhaustive switch beside `annotationAspectLockPolicy` — a
region delete is `useCpRegionActions.removeRegion`, which also removes the owned
image and clears pins, not a bare `removeAnnotation`); `useFoldedFigures` and
`useInlineSimulations` one each. The panel does
`mergeCanvasLayerBindings([annotations.binding, folded.binding, inlineSimulations.binding])`
and every id-addressed callback becomes `bindings.byId(id)?.applyBoxUpdate(id, patch)`;
`onSelect(null)` becomes `bindings.releaseAll()`. `onCanvasObjectContextMenu`
resolves the id and hands `binding.contextMenu(id)` to the controller, which
fixes the text-else-image mapping at `useCpCanvasContextMenu.ts:112` (and
widens `cpAnnotationMenuItems`' `'text' | 'image'` parameter per annotation
kind) and gives regions a right-click surface (raised from the chip bar, since
the body is inert). `analytics/events.ts` `ContextMenuTargetKind` gains
`'region'`. A binding is a plain record and is unit-tested per hook;
`mergeCanvasLayerBindings` is pure. What this does **not** remove from the
panel: the per-kind *inputs* the canvas takes as props (`images`, `regions`,
`textAnnotations` memos at `:767-778` and `:3239-3240` — the WebGL canvas
frames images through its own `images` prop), the region layer and its solve
hook mounts, and the focused-window inspector props. The goal is that the panel
dispatches no id-addressed callback by kind, not that it never names one.

**Registry — `cp-workspace/properties/canvasObjectPropertyRegistry.ts`**:

```ts
export interface CanvasObjectPropertyEntry<K extends CanvasObjectKind> {
  kind: K;
  /** Store-bound; returns plain data. Called inside SheetHost, which is keyed on kind+id so hook order is fixed per mount. */
  useSheet: (target: TargetOf<K>) => PropertySheet;
}
export const CANVAS_OBJECT_PROPERTY_KINDS = {
  image:               { kind: 'image',               useSheet: useImageProperties },
  text:                { kind: 'text',                useSheet: useTextProperties },
  suppressionRegion:   { kind: 'suppressionRegion',   useSheet: useRegionProperties },
  'folded-figure':     { kind: 'folded-figure',       useSheet: useFoldedFigureProperties },
  'inline-simulation': { kind: 'inline-simulation',   useSheet: useInlineSimulationProperties },
} as const satisfies { [K in CanvasObjectKind]: CanvasObjectPropertyEntry<K> };

export function canvasObjectPropertyRegistry(entries = CANVAS_OBJECT_PROPERTY_KINDS) {
  return { get: <K extends CanvasObjectKind>(kind: K) => entries[kind], kinds: Object.keys(entries) as CanvasObjectKind[] };
}
```

The factory parameter exists for `canvasObjectPropertyRegistry.test.tsx`, which
drives resolver → registry → renderer with a stub kind the way
`designKinds/registry.test.ts:279-287` does. The registry is React-bearing (it
holds hooks); the kinds module is not, so the store-free consumers import only
`canvasObjectKinds.ts`. Titles and icons for the pane header come from the sheet
(`sheet.title`, `sheet.icon`), built by the catalog, so the registry entry is
only `{ kind, useSheet }`.

### 3. Per-kind catalogs, hooks and sections

Every kind has, beside its concern (the AGENTS.md table):

| Kind | Kind row + resolver | Catalog (React-free, store-free) | Hook (store bindings) |
| --- | --- | --- | --- |
| image | `images/imageCanvasObject.ts` | `images/imageProperties.ts` | `images/useImageProperties.ts` |
| text | `annotations/textCanvasObject.ts` | `annotations/textProperties.ts` | `annotations/useTextProperties.ts` |
| suppressionRegion | `regions/regionCanvasObject.ts` | `regions/regionProperties.ts` | `regions/useRegionProperties.ts` |
| folded-figure | `folded/foldedFigureCanvasObject.ts` | `folded/foldedFigureProperties.ts` | `folded/useFoldedFigureProperties.ts` |
| inline-simulation | `inlineSimulation/inlineSimulationCanvasObject.ts` | `inlineSimulation/inlineSimulationProperties.ts` | `inlineSimulation/useInlineSimulationProperties.ts` |

Every catalog has the `buildFoldedFigureActions` signature —
`build<Kind>Properties(target, deps: <Kind>PropertyDeps): PropertySheet` —
where `deps` carries `t`, the bound verbs, and the values the catalog cannot
read (`held`, live-value sources). Each is tested with identity `t` and `vi.fn`
deps (`folded/foldedFigureActions.test.ts` is the shape): every field's
`support` per object variant, every commit routed to the right dep, and no
field enabled-and-inert.

The hooks bind deps to the store and to the layer's gesture owner (§4). They do
**not** mount `useCpAnnotations`, `useFoldedFigures` or `useInlineSimulations`:
those need panel-only inputs (`{ overlayView, viewportRef }`,
`{ cpDocument, selectedFoldLineIds }`) and own single-instance effects. Instead
the verbs those hooks bind become React-free modules the hooks delegate to
(§4.3), so the pane and the canvas share one implementation without a hook split.

The per-kind property inventories are in §10.

### 4. Commit and undo protocol

#### 4.1 Module-level gesture owners

Today each concern hook holds its own `preGesture*Ref`
(`useCpAnnotations.ts:94`, `useCpRegions.ts:220` — the same array twice —
`useFoldedFigures.ts:252-254` and the model-scope ref at `:727`,
`useInlineSimulations.ts:108`) with no nesting guard: a second `begin`
overwrites the snapshot, and the panel only avoids overlap by unmounting every
other floating surface. A pane in a different dock panel stays mounted through
canvas drags, so the bracket moves out of hook instances into one module-level
owner per layer.

`cp-workspace/canvasObjects/gestureBracket.ts`:

```ts
export interface GestureToken { readonly layer: string; readonly owner: string; readonly seq: number }

export interface GestureBracket {
  /** Open the layer's bracket. Null while a different owner holds it or while ANY layer's commit is draining; the open token again for the same owner. */
  begin(owner: string): GestureToken | null;
  /** Record one entry if anything changed since begin; no-op for a stale token. Resolves after `beforeCommit`; the token is held until then. */
  commit(token: GestureToken, label: string): Promise<void>;
  /** Drop `token`'s open snapshot without recording. A no-op for a stale or foreign token — a click on the canvas cannot kill a pane commit. */
  abort(token: GestureToken): void;
  /** Drop whatever is open, whoever holds it — the session chokepoint's verb (§4.2). */
  abortAll(): void;
  /** begin → act → commit, the `runFoldedFigureAction` shape. Resolves undefined when the bracket is held by another owner. */
  run<T>(owner: string, label: string, act: () => T | Promise<T>): Promise<T | undefined>;
  /** Whether `token` is still the open one — `update` callers check it. */
  isOpen(token: GestureToken): boolean;
  openOwner(): string | null;                       // stable snapshot for useSyncExternalStore
  subscribe(listener: () => void): () => void;
}

export function createGestureBracket<S>(spec: {
  layer: string;
  snapshot(): S;                                    // reads useWorkspaceStore.getState()
  unchanged(before: S, now: S): boolean;            // identity for lists; foldedFigureListsEqual + active id for figures
  record(before: S, label: string): void;           // recordAnnotationHistory / recordFoldedFigureHistory / recordInlineSimulationHistory
  beforeCommit?(): Promise<void>;                   // every layer: drainFoldedModelWrites() (§4.4)
}): GestureBracket;

/** Module-wide: true while any bracket's `beforeCommit` is in flight. Every bracket's `begin` refuses while it is set. */
export function anyGestureDraining(): boolean;
```

Instances: `annotations/annotationGesture.ts` (used by `useCpAnnotations`,
`useCpRegionActions`, `useCpRegionChipDrag`, the text session and the pane),
`folded/foldedFigureGesture.ts` (snapshot `{ figures, activeId }`),
`inlineSimulation/inlineSimulationGesture.ts`. `layer` is a plain string and
`record` is data, so a future layer is a fourth instance without editing this
file. Each registers its `abortAll` with `canvasSessions` (§4.2) at module load.

Rules, each pinned by `gestureBracket.test.ts`:

- **Overlap is refused, not clobbered.** `begin` from a different owner returns
  null while the bracket is open. `held` for a pane row is
  `openOwner() !== null || anyGestureDraining()` — *any* open owner, the row's
  own included — so a second drag on the same colour field during its own drain
  is refused until the drain completes rather than issuing a second `commit` on
  a token whose first commit is pending. Test: "second drag on the same field
  during its own drain → exactly one entry".
- **Refusal is global while anything drains.** Overlay entries capture all three
  layers live (`recordAnnotationHistory` passes `get().oristudioCpFoldedFigures`;
  `recordFoldedFigureHistory` passes `get().oristudioCpAnnotations`), so two
  brackets open across the drain window would each capture the other layer at
  the wrong moment, and undoing either would re-apply half of the other's
  change. There is no single correct cross-layer rule for overlapping brackets,
  so they are not allowed: while any layer's `beforeCommit` is in flight,
  `begin` on every layer returns null. Outside a drain, brackets on different
  layers may still be open at once (a text session while a figure is dragged)
  — a pre-existing hazard, listed under Risks.
- **The canvas honours refusal — at the `moved` transition.** The overlay's
  press path (`handleBodyDown` `:388-434`, `handleResizeDown` `:436-467`,
  `handleRotateDown` `:469-495`) consults nothing and `claimPress` is the touch
  arbiter's verdict, unrelated to gesture owners. The seam is
  `handlePointerMove`'s `moved` transition (`:556` move, `:565` resize, `:584`
  rotate): call `onGestureStart(id)` there; on `false`, set
  `dragRef.current = null` and return before the `onUpdate` on `:557`/`:580`/`:588`;
  and move the `:557` sub-pixel `onUpdate` under the `moved` flag so no store
  write precedes the snapshot. The `Drag` record (`:85-102`) gains
  `bracketOpen` so pointerup knows whether a begin succeeded. Today
  `beginCanvasObjectGesture` returns void and the overlay writes regardless
  (`CreasePatternPanel.tsx:1122-1139`), which under refusal would land a drag
  un-undoable. The refusal window is a pane slider being held (a pointer the
  canvas cannot also own on a mouse) or a drain (≤ two kernel round trips,
  milliseconds on ordinary figures).
- **A click never holds the layer.** The bracket opens on the first *moved*
  pointermove (the orbit gesture's rule, `useFoldedFigures.ts:473-476`), not on
  pointerdown, and the overlay calls `onGestureCancel(id)` → `cancelGesture` →
  `abort(token)` on `handlePointerCancel` (`:599`), `abortDrag` (`:642-650`)
  and an unmoved pointerup **only when its own begin succeeded**
  (`drag.bracketOpen`). `abort` is token-scoped for the same reason: a plain
  click, a secondary-button release (`:413-417`) or the first finger of a pinch
  must not stale a pane commit that is draining. Test: "click to select during
  a pane drain, then the drain completes → exactly one entry".
- **Same-owner re-entry** returns the open token and is used only by the folded
  `scope` protocol within one control's gesture (`updateModel(update, scope)`
  repeatedly, then `endModelGesture(scope, label)`); the canvas never re-enters
  because it closes on every pointerup. A foreign, store-owned entry landing
  while a bracket is open (a window refresh completing, a solve accepted) is a
  pre-existing hazard shared with today's refs — the entry's `previous` predates
  it — narrowed here by never holding a bracket across a click and by the folded
  write queue recording nothing on landing; it is listed under Risks, not solved.
- **A stale token is inert.** `commit` with a stale token records nothing;
  `update` callers check `isOpen(token)` and no-op; the kit's begin-latch resets
  whenever `openOwner()` changes, so the next input after an abort opens a
  fresh, recordable gesture instead of moving un-undoably.
- **A commit that changed nothing records nothing**, so
  `pushOverlayHistoryEntry` stays unconditional (`creasePatternSlice.ts:640-650`).
- **Every layer's commit awaits the folded drain.** All three brackets pass
  `beforeCommit: drainFoldedModelWrites`; it resolves immediately when nothing is
  in flight. With global refusal this is what makes "one entry, correct layers"
  hold: the draining bracket is the only open one, and its entry is recorded
  after the kernel has answered.

The existing hooks keep their public `beginGesture/commitGesture/runFoldedFigureAction/
updateModel(update, scope)/endModelGesture` signatures and delegate — a
behaviour-preserving change for every caller except that `beginGesture` now
returns the boolean and the overlay must consume it. The owner name is
`'canvas'` for the overlay, `'text-session'` for the edit session, `'chip'` for
the chip drag, and `'pane:<fieldId>'` for the pane.

Rejected: writing the folded model to the store optimistically on issue so the
commit could be synchronous. It leaves history entries holding a new `model`
beside a stale `renderSnapshot` until the render lands, and redo would restore
that pair; the drain keeps the slice's "the store is written when the kernel
answers" contract that its tests pin.

#### 4.2 Ending open sessions at the undo chokepoint — `cp-workspace/canvasObjects/canvasSessions.ts`

```ts
export type CanvasSessionEndReason = 'history' | 'document-replaced';
/** Owners and sessions register how they end; returns the unregister. Store-free by design. */
export function registerCanvasSessionEnder(end: (reason: CanvasSessionEndReason) => void): () => void;
export function endOpenCanvasSessions(reason: CanvasSessionEndReason): void;
```

Two callers, both above or beside the store:

- The `edit.undo` / `edit.redo` arm of `createMenuActionHandler`
  (`commands/menuActions.ts:526-531`) calls `endOpenCanvasSessions('history')`
  before `deps.workspace.undo()`. Every app-level undo path reaches that arm
  (chords outside an editing target, the menu bar, the native menu, the phone
  history pills). With the caret inside a text box, Cmd+Z is Lexical's own
  `HistoryPlugin` and never reaches the app — by design; app-level undo from
  inside the editor is part of the explicit-session-owner follow-up. So the
  chokepoint covers a menu-bar/native/pill undo while a text session or a pane
  bracket is open: the text session **commits** its entry and the undo then
  undoes it, and any open pointer bracket is aborted so a later `commit` with a
  stale token records nothing.
- `discardCpDocumentState()` (`store/workspaceStore/cpDocumentState.ts:73`)
  calls `endOpenCanvasSessions('document-replaced')` beside
  `clearAllInlineSimulationSources()`, which is already a store → cp-workspace
  call into a store-free module. `canvasSessions.ts` imports nothing from the
  store, so there is no cycle.

On `'history'` the folded owner also **supersedes in-flight writes** for every
figure with a write in flight (`foldedModelWriteInFlight`), through the new
store action `supersedeFoldedFigureModelWrites(ids)`. Bumping
`modelRequestSequence` alone is not enough: the post-undo
`reconcileFoldedFigureModel` runs immediately and returns without writing,
because `lastWrittenKernelModel` still holds the pre-drag model (it is set only
when the kernel answers, `:429-436`, so `:567`'s equality shortcut passes) and
`pendingLiveModelWrites` still has the id (`:570`); the superseded tick then
lands, sets `lastWrittenKernelModel` to the dragged model, fails `:2881` and
writes nothing — leaving the kernel on the dragged colour and the store on the
restored one. So the superseded branch of `updateOristudioCpFoldedFigureModel`
(after `:2881` fails, or in its `finally` when the request was superseded)
enqueues `reconcileFoldedFigureModel(id)`, which now sees the mismatch and
writes the restored model back. Store test, with a kernel stub that resolves
the write *after* the undo: the kernel's last-written model and the store agree
on the restored model.

The text session answers `'history'` by committing its entry and
`'document-replaced'` by dropping it; brackets abort on both; crop mode exits on
both. This replaces two rejected designs: `historySlice` calling every owner's
`abort()` (a store → cp-workspace → store import cycle) and a history-stamp
compare at commit (self-contained, but it abandons a drag whenever *any* entry
lands mid-gesture and leaves the change un-undoable). With the chokepoint, an
abandoned change is reachable only by holding a pane slider while triggering
undo from the menu bar, a native accelerator (a focused `<input type=range>`
does not `preventDefault` Cmd+Z) or a touch pill; that is recorded as a risk,
not designed around.

#### 4.3 Setters as React-free modules

So the pane and the canvas hooks share one implementation without mounting the
single-instance hooks. These are the *discrete property setters* — one store
write wrapped in the layer owner's `run(...)` so it lands as one entry — plus
the stacking/delete verbs the context menu already needs per kind. The pane
uses only the setters; the verbs are here because the same modules are where
`CanvasLayerBinding.remove` and `contextMenu` bind (§2), not because the pane
shows them:

- `annotations/annotationVerbs.ts`: `updateAnnotationAsEntry(id, patch, label)`
  (the pane's discrete text/region setter), and `bringAnnotationToFront(id, t)`,
  `sendAnnotationToBack(id, t)`, `deleteAnnotation(id, t)` for the bindings —
  each `annotationGesture.run('verb', label, () => useWorkspaceStore.getState().updateAnnotation(...))`.
  History labels come from a per-kind `annotationVerbLabels(kind, t)` table
  beside it (`{ bringToFront, sendToBack, delete }` per `AnnotationKind`,
  exhaustive), so a text box stops recording "Bring image to front" and a new
  annotation kind adds one row rather than editing three verbs.
  `useCpAnnotations.bringSelectedImageToFront/…` become delegates.
- `folded/foldedFigureVerbs.ts`: the pane's setters
  `setFoldedFigureDisplayStyle(id, style, t)`,
  `updateFoldedFigureModelAsEntry(id, patch, t)`, `setFolded3dCamera(id, camera, t)`
  (spreads `orient`; also the camera rows' `reset`, one axis at a time, keeping
  `orient`), `setFoldedFigurePlacementAsEntry(id, patch, label)`; and the
  binding's `deleteFoldedFigure(id, t)` — each `foldedFigureGesture.run(...)`
  over the store action. `useFoldedFigures.foldedFigureActionDeps` delegates to
  them for the verbs it shares; everything else on the floating toolbar
  (`flip`, `resetView`, `setUpright`, `foldAnother`, `refold`, `exportAs`,
  `duplicate`, `runNoticeAction`) stays in the hook and the toolbar as today.
  No split of `useFoldedFigures` into halves.
- `inlineSimulation/inlineSimulationVerbs.ts`: `deleteInlineSimulation(id)`
  for the binding, over `removeOristudioCpInlineSimulation`, which pushes its
  own entry. The pane has no per-window setter.

#### 4.4 The flat folded figure's async write — four layered fixes

(a) **Slice merge base and pending count** (`creasePatternSlice.ts:2860-2863`,
`:403`): merge the partial onto the *last issued* model for the figure
(`issuedModels: Map<figureId, model>`, cleared with the handle in
`releaseFoldedFigureHandle`), so concurrent writes to different fields cannot
lose each other regardless of caller; `pendingLiveModelWrites` becomes
`Map<string, number>` (a count), so the first-finished tick no longer unmasks a
reconcile while others are in flight. Store tests for both.

(b) **Landing does not re-claim the canvas** (`:2882-2892`, `:2769-2782`): the
completion of a model or style write updates the figure entry with a plain
`set` of the figures list and calls `takeCanvasSelection('folded-figure', …)`
only when `oristudioCpActiveFoldedFigureId === figure.id` at landing time.
Otherwise a pane colour write landing 200 ms after the user box-selected creases
would yank the selection back to the figure, clear the crease selection in the
kernel and flip the pane. Store test: "selection changed during a round trip
stays changed".

(c) **Single-flight, latest-wins queue** — `folded/foldedModelWriteQueue.ts`
(React-free, store-aware):

```ts
/** At most one kernel write in flight per figure; later patches coalesce and issue when it lands. */
export function queueFoldedModelWrite(id: string, patch: Partial<OristudioCpFoldedFigureModel>): void;
/** Resolves when nothing is in flight and nothing is queued (for `id`, or for every figure). */
export function drainFoldedModelWrites(id?: string): Promise<void>;
/** Drop the queued patches and mark every in-flight result stale (undo mid-drag); the slice reconciles each figure when its stale tick lands. */
export function supersedeFoldedModelWrites(): void;
export function foldedModelWriteInFlight(id: string): boolean;
```

Forty slider ticks on a 2156-crease figure become at most two kernel round
trips instead of eighty queued, uncancellable calls. A 3D figure re-projects
synchronously and the queue is a pass-through. `useFoldedFigures.handleFoldedModelUpdate`
and the pane both route through it.

(d) **Awaited commit**: `foldedFigureGesture` (and, per §4.1, the other two
brackets) pass `beforeCommit = drainFoldedModelWrites`, so the bracket's
unchanged-guard sees the landed entry and the token is held until then. Undo is
not gated — the history branch stays synchronous. `foldedFigureGestureHistory.test.tsx`
gains "one change with a 250 ms round trip, blur at 50 ms → exactly one entry,
recorded after the write" and "a canvas drag begun during the drain is refused".

(e) The kernel render-input cache (`crates/oristudio-cp/src/session.rs:340-343`,
`folding.rs:2412`) is optional Phase G: parity-faithful (Oriedita repaints from
cached `wireFrameWorker_*` objects, `FoldedFigure_Drawer.java:238-246`),
oracle-gated, and changes the queue's cost, not its correctness.

#### 4.5 How each field kind maps onto a protocol (in the renderer)

- `toggle` / `select` / `segmented` → `commit(next)` at once; the catalog's
  `commit` wraps the layer owner's `run(...)` (or a preference setter with no
  history).
- `number` / `text` → `NumberField.onCommit` / `TextRow` on blur or Enter;
  `NumberField` already skips no-op commits and reverts on Escape; a draft
  resyncs from the store value when the sheet's value changes underneath it.
- `slider` → `SliderRow` generalises `AnnotationOpacitySlider`'s protocol (first
  `input` → `begin`, native `change` → `end`); `ColorRow` maps `onChange` →
  `begin` (once) + `update`, `onCommit` → `end`. The kit owns the "call begin
  once" latch and resets it when `held`/`openOwner` changes; the catalog owns
  what begin/end mean. A row whose `begin()` returned false resyncs its draft
  and does nothing.

### 5. Session state lifted out of hook-local React state

All follow the `cpToolSurface` / `cpOverlayViewStore` shape: module state,
`subscribe`, a stable `get`, a `use*` wrapper over `useSyncExternalStore`, a
`reset*` test seam. None enters the workspace store (no new slice, nothing
history captures, no `CP_DOCUMENT_SCOPED_KEYS` churn) and none is persisted.

| State | Today | After |
| --- | --- | --- |
| `editingTextId` + `editStartRef` + `suppressNextTextCreateRef` | `useState`/refs in `useCpAnnotations` | `annotations/textEditSession.ts` — holds the annotation bracket token for the session's lifetime (owner `'text-session'`), which structurally refuses any other `begin` while editing |
| The live `LexicalEditor` per box | reachable only inside `CpTextEditor`'s composer | `annotations/textEditorRegistry.ts` (`registerTextEditor(id, editor)`, `textEditorFor(id)`), registered by a one-line plugin beside `EscapeExitPlugin` |
| Solve records, solve verbs, the `CP_EXACT_SOLVE_REQUEST_EVENT` listener | `useCpRegionSolve`, mounted once by the panel | unchanged — Solve is a verb and stays on the chip; the pane never reads solve state |
| Region views (`hiddenCount`, `solvable`) | `useCpRegions().regions` per instance | unchanged — the pane needs neither; the owned image is a direct `imageId` lookup in `oristudioCpAnnotations`, no findings pass |
| `playing` / `replayRequest` | `useState` in `useInlineSimulations` | unchanged — transport stays on the floating inspector and the pane never reads it |
| overlay `cropMode` | `useState` in `CanvasObjectOverlay` | unchanged — crop editing stays the overlay's mode; the pane has no crop field |
| orbit camera | side table | unchanged; read through `LiveValue` inside the camera rows |

`textEditSession.ts`:

```ts
export interface TextEditSession { id: string; created: boolean; token: GestureToken }
export function beginTextEditSession(id: string, created: boolean): boolean; // false if annotationGesture refused
export function endTextEditSession(reason: 'blur' | 'escape' | 'delete' | 'history' | 'document-replaced'): void;
export function textEditSession(): TextEditSession | null;
export function useTextEditSession(): TextEditSession | null;
export function armSuppressNextTextCreate(): void;
export function takeSuppressNextTextCreate(): boolean;
```

`endTextEditSession` owns what `exitEditText` does today (empty-box GC, the
'Add text' / 'Edit text' / 'Delete text' labels, the create-suppression arm);
`useCpAnnotations.requestEditText/createTextAt/exitEditText` become thin
delegates, and an effect in `useCpAnnotations` ends the session when the
selection leaves the box or the box vanishes (delete, undo, document replace).
`CreasePatternPanel` keeps receiving `editingTextId` from the hook's return
shape, so no prop changes.

### 6. Focus survival: one companion-surface predicate

`cp-workspace/canvasObjects/canvasCompanionSurface.ts`:

```ts
export const CANVAS_COMPANION_ATTR = 'data-cp-companion';
/** Does this pointer/focus target belong to a surface that edits the current canvas selection? */
export function isCanvasCompanionSurface(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${CANVAS_COMPANION_ATTR}]`) !== null;
}
```

Placed on: the Properties pane root, `CpImageInspector`,
`InlineSimulationInspector` and its export menu (replacing
`[data-inline-simulation-menu]`), the text toolbar group (replacing
`data-cp-text-toolbar`), the region chips, and every portalled Radix content the
pane opens (the renderer passes `surfaceProps` to `SelectRow`, which spreads
them onto `SelectContent` — `components/ui/Select.tsx:31-41` spreads props onto
the portalled content, verified). It replaces `PORTALED_SURFACES` in
`useBlurOnPressOutside.ts:11` and `closest('[data-cp-text-toolbar]')` in
`CpTextEditor.tsx:93`. Two consumers, one question, one predicate.

The pane root carries `tabIndex={-1}` so a click on its non-focusable
background yields a `relatedTarget` instead of `null` — without it
`CpTextEditor.handleBlur` (`:92-95`) ends the session on the first empty click
in the pane.

Why this squares with "no panel behaviour may depend on DOM focus": the
press-outside rule is a pointer-target rule (a deliberate deselect gesture), and
the text editor's `focusout` exit is the editor's own pre-existing rule, left as
is. Replacing that exit with an explicit session owner (ended only by Escape,
a press outside, selection change, and the §4.2 chokepoint) is recorded as a
follow-up: it changes keyboard semantics (Tab out of a box would no longer end
the session) and belongs in its own PR with the rich-text plan updated.

Keyboard: nothing is added. `<input>`/`<textarea>`/Radix Select content already
satisfy `isShortcutEditingTarget`; the pane has no keydown listener
(lint-enforced); Escape and Delete keep routing through `viewport.cancel` /
`viewport.delete` (and the overlay's own Escape listener, which is a follow-up).
The Radix button exposure (a focused Select trigger also fires a CP single-key
tool) is pre-existing in the View pane and is **not** fixed by widening
`isShortcutEditingTarget`: `handleShortcutKeyDown` and `handleAppKeyDown` bail
on every chord for an editing target, so `[role=combobox]` there would make
Cmd+Z, Cmd+S and every accelerator dead while a Select trigger is focused.
`STATIC_PANEL_CONTEXTS['cp-properties'] = 'crease-pattern'` is what keeps
menus, undo and the shortcut scope on the CP when the tab is active; the pane
never calls `setActiveShortcutViewportSurface`.

### 7. Dock geometry, persistence, reveal, menu, touch

**Geometry: a second tab in the View pane's group.** "In the same space and
next to the View panel", "focused on the right" on click — a tab is that. A
260px column halved vertically fits neither pane, and the codebase has grouped-
tab prior art (`components/panels/DesignPaneLayout.tsx:227-266`,
`addSecondaryPane`) and none for a vertical stack.

`store/layoutStore.ts`: `WORKSPACE_VIEW_PANELS` becomes a per-workspace **list**:

```ts
interface SidePaneDefinition {
  id: string;
  component: string;
  /** Literal key + English default, resolved by one `sidePaneTitle(spec)` call site so the extractor sees them. */
  titleKey: string;
  titleDefault: string;
  initialWidth?: number;
  /** The primary pane the lead docks beside. */
  referencePanelId: string;
  placement: { kind: 'beside-primary' } | { kind: 'tab-of'; leadId: string };
}
const WORKSPACE_SIDE_PANES = {
  edit: [
    { id: 'cp-view-controls', component: 'cp-view-controls', titleKey: 'panels:sidePane.view', titleDefault: 'View',
      initialWidth: 260, referencePanelId: 'crease-pattern', placement: { kind: 'beside-primary' } },
    { id: 'cp-properties', component: 'cp-properties', titleKey: 'panels:sidePane.properties', titleDefault: 'Properties',
      referencePanelId: 'crease-pattern', placement: { kind: 'tab-of', leadId: 'cp-view-controls' } },
  ],
  simulate: [ { id: 'simulator-view-controls', /* … as today */ placement: { kind: 'beside-primary' } } ],
} as const satisfies Partial<Record<WorkspaceId, readonly SidePaneDefinition[]>>;
export type SidePaneSpec = (typeof WORKSPACE_SIDE_PANES)[keyof typeof WORKSPACE_SIDE_PANES][number];
export type SidePaneId = SidePaneSpec['id'];
export function sidePanesFor(workspace: WorkspaceId): readonly SidePaneSpec[];
```

- **Titles come from `i18n.t` inside the store.** Two reconcile call sites
  have no `t` in scope (`activateWorkspace` after `fromJSON`, `:385-391`;
  `resetLayout` → `applyDefaultLayout`, `:461`), and five store modules already
  import `i18n` directly (`store/localeStore.ts:3`,
  `store/workspaceStore/capabilities.ts:14`, `slices/creasePatternSlice.ts:78`
  — used at `:234-236` — `slices/oristudioBpSlice.ts:35`,
  `slices/projectSlice.ts:173`), so `addSidePane`/`reconcileSidePanes` call
  `i18n.t(spec.titleKey, spec.titleDefault)` the same way. `SidePaneDefinition`
  therefore carries `titleKey` + `titleDefault` literals (the extractor still
  sees a literal `t()` call at the one render site, `sidePaneTitle(spec)`), not
  a `(t) => string` function. Language change: `layoutStore` subscribes once
  with `i18n.on('languageChanged', …)` (the `localeStore.ts:49` precedent) and
  runs `retitleSidePanes(api)`. That fixes today's untranslated 'View' with no
  ordering problem on first mount — `onReady` builds with the right titles
  because nothing has to be registered first. `setTitle` fires
  `onDidLayoutChange` (dockview `onDidPanelTitleChange` feeds it), so a retitle
  after the subscription is saved; harmless (saved equals live) and `setTitle`
  no-ops when unchanged. The store test file initialises i18n the way the other
  store tests do.
- `addSidePane(api, spec)`: `beside-primary` → today's
  `{ referencePanel, direction: 'right' }, initialWidth`; `tab-of` →
  `{ position: { referenceGroup: api.getPanel(leadId).group.id }, inactive: true }`,
  guarded on the lead existing (dockview throws on a missing reference).
- `reconcileViewPanel` → `reconcileSidePanes(api, workspace, coarse)`: coarse
  removes every listed pane (and its emptied group); fine adds each **missing**
  pane in list order (lead first, so the group exists) and calls
  `panel.api.setTitle(title)` on present ones. This is the existing "add a
  missing View pane" rung (`:234`) generalised to a list — still total,
  idempotent, and never touching Design (`:223-228`). A persisted v18 Edit
  layout gains the Properties tab on next load with sash widths intact;
  `LAYOUT_VERSION` stays 18. On first mount the repair precedes the
  layout-change subscription; on later reconciles the repaired layout is saved
  by the debounced save, which is fine because it equals the repaired one. One
  extra rung: a listed side pane found inside a headerless group (the v16 class,
  reachable by DnD; detect via `panel.group.model.header.hidden`, move with
  `panel.api.moveTo`) is moved back beside/into its lead.
- `applyEditLayout` builds both on a fine pointer; the touch build mounts neither.
- `activatePanel(id)`: `setActive()` moves no DOM focus (verified), so the only
  guard needed is the gesture deferral. When `id` is a listed side pane of the
  target workspace and the dock does not hold it (coarse pointer), publish
  `requestSidePane(id)` (below) instead of silently doing nothing.
- `layoutStore.test.ts`'s mock gains `setTitle`, honours `inactive`, and restores
  group ids / `hideHeader` from the serialized grid, in the same commit.

**Registrations** (each pinned by a test, updated in the same commit):
`panels` in `PanelComponents.tsx`, `WORKSPACE_BY_PANEL_ID['cp-properties'] = 'edit'`,
`STATIC_PANEL_CONTEXTS['cp-properties'] = 'crease-pattern'`,
`VIEW_DRAWER_BODIES` (now `Record<SidePaneId, ComponentType>`), and the
pane-table ↔ lookup agreement test in `layoutStore.test.ts:460-473`.

**A permanent tab, revealed on selection.** The Properties tab is always in
the View group (dock tabs cannot be user-closed — `FixedDockTab` — and a tab
that comes and goes with the selection would mean a dock add/remove, a reflow
and a layout save per click; that was the first draft and it was dropped as
the riskiest new lifecycle in the plan). With nothing selected it shows one
sentence. Reveal is `cp-workspace/properties/usePropertiesPaneActivation.ts`,
mounted by the pane itself (dockview keeps an inactive tab's React tree
mounted, verified, so the pane can host it; a frozen panel with 36 lines of
headroom should not). It subscribes with plain `useWorkspaceStore.subscribe`
to the id fields, computes `selectedCanvasObjectIdOf`, and on a transition to a
**different non-null id** (never on release) runs:

```ts
if (isCoarsePointerSurface()) return;
const panel = useLayoutStore.getState().dockviewApi?.getPanel('cp-properties');
if (!panel || panel.api.isVisible) return;   // flipping a tab the user is looking at is a no-op
runAfterPointerGesture(() => useLayoutStore.getState().activatePanel('cp-properties'));
```

`runAfterPointerGesture` because activating a dockview panel reflows the group
and drops the in-flight click or drag that made the selection
(`oristudioBpSlice.ts:809-821`); `setActive()` itself moves no DOM focus
(verified). Once the user picks the View tab, the next selection of a
different object brings Properties back — intended: Properties is
selection-driven, View is a settings page. Deselection never flips anything,
so a user working in View keeps View until they click a new object.

**Menu**: `'view.properties'` in `MENU_ACTION_IDS` (`menuActions.ts:83-89`),
`VIEW_PANEL_ACTIONS['view.properties'] = 'cp-properties'` (the dispatch at
`:504-508` then activates and calls `showWorkspace()`), a View-menu row after
`view.simulate` (`menus/menuDefinition.ts:182-190`), a capability entry beside
`view.conditions` (`lib/workspaceCapabilities.ts:667-671`) as
`capability(canEditCp, t('common:capability.properties', 'Properties'), …)` —
visible in every context like the other `view.*` entries (it navigates to
Edit), enabled with an editable CP — and a null chord in `MENU_SHORTCUTS`
(rebindable, claims no key). The native menu follows the definition; `command
invoked` covers it.

**Touch**: one View pill, one sheet, a `SegmentedControl` header (View |
Properties) inside `WorkspaceViewDrawer` driven by `sidePanesFor(workspace)`
(rendered only when the list has more than one pane, so Simulate's sheet is
unchanged); bodies from `VIEW_DRAWER_BODIES`. `useWorkspaceViewDrawer` returns
`panes`, `activePane`, `openDrawer(paneId?)`; the initial tab is Properties
when a canvas object is selected, else View. A tiny emitter
`store/sidePaneRequests.ts` (`requestSidePane(id)` / `subscribeSidePaneRequests`)
lets `activatePanel` under a coarse pointer open the sheet at the right tab.
The drawer **latches** a request into `pendingPane` state and consumes it in an
effect declared after its force-close effect, keyed on
`[pendingPane, activeWorkspace]`, opening only once `sidePanesFor(activeWorkspace)`
contains the pane and clearing the latch — because `View ▸ Properties` from
Design or Simulate sets `activeWorkspace` and publishes the request in one
synchronous call stack, and an un-latched open would be closed by the
workspace-switch effect in the same commit. Tests pin both the same-workspace
race and the cross-workspace case. The `data-view-panel` CSS hook becomes
`data-view-workspace`; `view drawer opened` gains
`pane: 'cp-view-controls' | 'cp-properties' | 'simulator-view-controls'`. The
drawer never auto-opens on tap-select (it is `aria-modal`); the floating
inspectors remain the immediate touch surface. The phone overflow's
'folded-models' row becomes a 'Properties…' row (`opensDialog: true`, disabled
with nothing selected) that calls `requestSidePane('cp-properties')`;
`FoldedFigureModal` shrinks to the figure picker it also was (§9).

Rejected: a second pill (lane width on a 375px phone beside Undo/Redo/Tools/View,
pinned pill-order tests) and desktop-only (leaving phones with no route to the
folded appearance controls once `FoldedFigureControls` moves into the pane).

### 8. The shared field-row kit and the generic renderer

`components/ui/fieldRows/` — `FieldRow` (the `.control-row` label/value shell;
never wraps a Toggle in a `<label>`; the label column gives way under coarse
pointers per `theme.css:9675-9692`), `ToggleRow` (`aria-labelledby`, keeps the
simulator copy's `data-disabled`), `NumberRow` (delegates to `NumberField`;
subscribes to `live` when present), `SliderRow` (wraps
`components/ui/GestureSlider.tsx` — `AnnotationOpacitySlider` moved and
de-annotation-ised, keeping its first-`input`/native-`change` protocol;
`AnnotationActions` and `RegionImageMenu` import the new path), `ColorRow`
(`ColorField layout='row'`), `SelectRow` (sets the 26px trigger once on
`.control-row__value--select .select-trigger`; accepts `value: null` as a
placeholder; takes `contentProps` for the portalled content), `SegmentedRow`
(hugging; `value: null` renders no active option — the mixed contract), `TextRow`
(`InspectorPanel.EditableRow` semantics: commit on blur/Enter, Escape reverts,
empty rejected), `ReadoutRow` (`useSyncExternalStore` when `live` present),
`ActionRow` (a button row; never the literal word 'Action'), plus
`components/ui/CollapsibleSection.tsx` (`title`, `description?`, `action?`
hidden while closed, `defaultOpen`; one `.collapsible-section__*` CSS family
replacing the three private disclosures). `CpViewControlsPanel`,
`SimulatorViewControlsPanel` and `CreaseExportDialog` delete their private copies
in Phase A2; `InspectorPanel`/`ConditionsPanel` are left for a Design-side sweep
(their untranslated literals make it a separate PR).

`components/properties/PropertySheetView.tsx` (CP-free): `sheet.sections.map` →
`CollapsibleSection` → `fields.map(renderField)` where `renderField` is
`switch (field.kind)` with no default; hides `not-applicable`, disables
`unsupported` with `reason` as the title; renders a field's `reset` as the
row's trailing affordance (`ColorField.onClear`'s shape); props `surfaceProps`
and `onCommit(fieldId)`, fired once inside the discrete commit, the draft
commit, the continuous `end` and the `reset` wrappers — never per input event.
`PropertySheetView.test.tsx` renders one field of every kind and asserts the
protocol calls (begin once, end once; commit skipped on no-op; latch reset when
`held` flips).

`cp-workspace/properties/SheetHost.tsx`: `const entry = registry.get(target.kind);
const sheet = entry.useSheet(target); return <PropertySheetView sheet={sheet}
surfaceProps={{ [CANVAS_COMPANION_ATTR]: '' }}
onCommit={(property) => trackCanvasObjectPropertyChanged({ objectKind: target.kind, property })} />`
— mounted by the panel with `key={`${target.kind}:${target.id}`}` so hook order
is fixed per mount and drafts reset per object.

`components/panels/CpPropertiesPanel.tsx` (composition, ~50 lines):
`useSelectedCanvasObject()`, `usePropertiesPaneActivation()`, root
`<section className="panel-shell cp-properties-panel" data-cp-companion tabIndex={-1}>`,
then `<SheetHost target={target}/>` or the empty state — one line,
`t('panels:cpProperties.empty', 'Select an object on the canvas to edit its properties.')`,
in the `.empty-note` idiom `CpViewControlsPanel` uses for its own. Nothing
else: no object list, no figure list, no crease count.

### 9. What happens to the existing surfaces

- **Inspector cascade** (`CreasePatternPanel.tsx:3495-3551`) →
  `cp-workspace/canvasObjects/CpFloatingInspectors.tsx`: one exhaustive
  `switch (target.kind)` over the resolver union, taking the panel-owned deps as
  props (`container`, `annotations`, `folded`, `inlineSimulations`,
  `editingTextId`, `annotationsInteractive`). The registry is deliberately
  **not** the mounting authority: floating chrome needs `toolbarContainer`,
  `foldedFigureActionDeps` and the canvas hooks' verbs, and threading those
  through a data-module registry would put React and panel deps in it. A stub
  kind still fails typecheck in the switch, which is the guarantee that
  matters. The `CpSelectionToolbar` clause stays in the panel as
  `!target && !openToolOptionWindow`. `suppressionRegion` returns null (the chip
  is the region's floating surface, mounted elsewhere).
- **Floating toolbars keep every verb, lose the adjectives**: `CpImageInspector`
  drops the opacity slider (front/back/delete stay); `InlineSimulationInspector`
  keeps transport/export/upright/replay/refresh/delete and loses the colour-mode
  menu (`colorModeLabel` moves to `i18n/enumLabels.ts`); `TextToolbar` keeps
  every per-selection control — block preset, marks, alignment, colour, Delete
  (Phase H restored the three Phase E had moved; the pane's copies are
  whole-box, the toolbar's follow the caret); `CpFoldedFigureToolbar` is unchanged — flip,
  reset view, set upright, another solution, refold, export, duplicate, delete
  all stay there and in the context menu (its style choice and the pane's
  Display style render one `FOLDED_DISPLAY_STYLE_OPTIONS` table); region chips
  are unchanged, Solve included; `RegionImageMenu` keeps its delete row.
- **`FoldedFigureControls`** (the appearance form) is deleted in Phase D — it
  has one body, the folded sheet, everywhere. **`FoldedFigureMenuButton` and
  `FoldedFigureModal` stay as figure *pickers*** (the list with stale/case
  subtitles, selecting through `setOristudioCpActiveFoldedFigure`) and lose
  their embedded form; the phone 'folded-models' overflow row keeps opening the
  picker. Whether a picker is still wanted once the pane exists is a separate
  product call — the list is navigation, not a property, so it does not belong
  in the pane either way. The two display-style label sets collapse onto
  `foldedDisplayStyleLabel`.
- **`PANELS_WITH_LEGACY_KEYDOWN`**: `CreasePatternPanel.tsx` leaves it in Phase
  A1 as housekeeping — the panel has no `keydown` listener today and the rule
  matches `addEventListener('keydown')` only.
- **Line ledger**: Phase D lowers `OVERSIZED_PANELS['CreasePatternPanel.tsx']`
  to the measured count with a ledger note; the decomposition plan's Phase 2a row
  is corrected to "landed as the canvas-object kind table / `CpFloatingInspectors` /
  canvas layer bindings".

### 10. Per-kind property inventories

Storage column: where the value lives and how it persists (every field below
already exists in its `.osf` validator; no schema change in Phases A–F).
Protocol: discrete / draft / continuous (§4.5). Undo labels reuse existing keys
where one exists.

#### Folded figure — `folded/foldedFigureProperties.ts`

Sections: **Appearance**, **Camera** (3D only), **Placement**. The sheet's
title is the figure's title and its subtitle `foldedFigureSubtitle` (stale /
case note — read-only context, not a field). Reopened figures
(`handle === null`, `folded3dRenderModel(handle) === undefined`) get every
appearance field `unsupported` with reason "Refold to change how this figure
looks"; Refold itself stays on the floating toolbar and context menu. Readiness
from `isFoldedFigureReady`.

| Field | Control | Range / options | Storage | Setter | Protocol | Undo label | Support gating |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `displayStyle` | select | `FOLDED_DISPLAY_STYLE_OPTIONS` (Paper5 / Transparent3 / Wire2) via `foldedDisplayStyleLabel` | `entry.displayStyle` (`.osf viewState.foldedFigures`) | `setFoldedFigureDisplayStyle` (verbs module → `setOristudioCpFoldedFigureDisplayStyle`) | discrete | existing 'Change folded model style' key | `foldedAppearanceSupport('displayStyle')`; unsupported when not ready |
| `side` | segmented Front0 / Back1 via `foldedStateLabel` | `FOLDED_FIGURE_SIDES` | `snapshot.model.state` | `updateFoldedFigureModelAsEntry(id, { state })` | discrete | `panels:creasePattern.changeFoldedModel` 'Change folded model' | flat: supported; **3D: `not-applicable`** (new answer in `foldedAppearanceSupport`; on 3D `state` only seeds the default camera before the first orbit and is inert after it — the enabled-and-inert class the oracle exists to prevent. The pre-orbit default-camera flip is dropped; 'Other side' on the floating toolbar is the 3D verb) |
| `frontColor` / `backColor` / `lineColor` | color | hex ↔ `OristudioCpRgbColor` via `rgbColorToHex` / `hexToRgbColor`; fallbacks from `FOLDED_COLOR_FIELDS` | `model.front_color` / `back_color` / `line_color` | `queueFoldedModelWrite` inside `foldedFigureGesture` (`begin('pane:frontColor')` … `end` = `commit` after drain) | continuous | `panels:cpProperties.folded.changeColor` 'Change folded model color' | supported both kinds; unsupported when reopened |
| `shadows` | toggle | — | `model.display_shadows` | `updateFoldedFigureModelAsEntry` | discrete | 'Change folded model' | flat supported; 3D `unsupported` (reason from the appearance module) |
| `antiAlias` | — | — | `model.anti_alias` | — | — | — | **`not-applicable` on both** (Phase H): the kernel carries the flag through the snapshot, but the web renderer antialiases everything and never reads it; the only visible effect is a 0.2 px stroke difference. No control; the field stays on the model for `.ori` parity |
| `yaw` / `pitch` | number, degrees, step 1 | wraps to (−180, 180] | `camera.yaw` / `camera.pitch` (radians) | `setFolded3dCamera(id, { ...camera, yaw }, t)` spreading `orient`; `reset` = the fold's camera for that axis, keeping `orient` (the toolbar's Reset view semantics, per field) | draft; `live` = `getFolded3dOrbit(id)?.camera` via `subscribeFolded3dOrbitCamera` | `panels:cpProperties.folded.changeView` 'Change folded model view' | 3D only (hidden otherwise) |
| `zoom` | number | `clampSimulatorZoom` [0.45, 4], step 0.05 | `camera.zoom` | same | draft | same | 3D only |
| `scale` | number, > 0, step 0.05 | — | `placement.scale` | `setFoldedFigurePlacementAsEntry` | draft | existing 'Resize folded form' gesture label | both |
| `rotation` | number, degrees | — | `placement.rotation` (radians) | same | draft | existing 'Rotate folded form' | both |

Never wired: `model.scale` / `model.rotation` (`not-applicable`, double
transform), `transparent_transparency`, title, starting face. Not here because
they are verbs: flip / other side, reset view (as a whole), set upright, another
solution, refold, export, duplicate, delete — all on `CpFoldedFigureToolbar`
and the context menu already.

#### Text box — `annotations/textProperties.ts`

Two write paths chosen by `textEditSession()?.id === target.id`. **Idle**: pure
JSON transform in `annotations/textDocTransforms.ts` inside
`annotationGesture.run('pane:<field>', label, () => updateAnnotation(id, { doc, plainText }))`.
**Editing**: `textEditorFor(id).update(() => { const saved = $getSelection()?.clone(); $selectAll(); …apply…; if (saved) $setSelection(saved); }, { tag: SKIP_SELECTION_FOCUS_TAG })`
with **no** bracket — the session's single 'Edit text' entry covers it
(`OnChangePlugin → changeTextContent` writes the store) and the session holds
the annotation bracket, so a careless caller cannot double-record. Whole-box
semantics in both states; the floating toolbar keeps per-selection marks.

| Field | Control | Range / options | Storage | Setter | Protocol | Undo label | Support |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `align` | segmented left / center / right (`null` when blocks disagree) | `TextAlign` | per-block `format` in `doc` | idle `setDocAlign(doc, align)`; editing `element.setFormat` on every top-level block | discrete | `panels:cpProperties.text.changeAlignment` 'Change text alignment' | supported |
| `block` | select paragraph / h1 / h2 (`null` mixed) | `TEXT_BLOCK_PRESETS` via a `textBlockLabel` helper in `i18n/enumLabels.ts` | `type`/`tag` on blocks | idle `setDocBlock` (preserves `children/direction/format/indent/version`, `$copyBlockFormatIndent` semantics); editing `$setBlocksType` | discrete | 'Change text style' | supported |
| `color` | segmented swatches (the six `TEXT_COLORS`, plus clear → default) | `TEXT_COLORS` lifted to `annotations/textFormatting.ts` | text-node `style` `color:` declaration | idle `setDocColor`; editing `$patchStyleText` | discrete | 'Change text color' | supported (never a free picker: no hex reaches analytics, no validator change) |
| `fontSize` | number, "% of sheet" (model units × 100), step 0.5, min 0.5 | — | `annotation.fontSize` | `updateAnnotation` in the bracket | draft | 'Change text size' | supported (`syncAnnotationHeight` re-measures auto-height boxes via the ResizeObserver) |
| `opacity` | slider 0..1 | — | `annotation.opacity` | `updateAnnotation` (continuous bracket) | continuous | `panels:imageInspector.adjustOpacity` 'Adjust opacity' | supported |

A parity test runs each JSON transform and its headless twin (core `lexical`
`createEditor({ nodes: [HeadingNode] })` with no root element, `parseEditorState`,
`$selectAll` + `$setBlocksType` / `setFormat` / `$patchStyleText`, `toJSON()`)
and asserts deep-equal output, so a Lexical upgrade cannot silently fork the
shapes. `textAnnotation.ts` stays a leaf module; the transform is a sibling.
Stacking and delete for a selected box stay in the context menu
(`cpAnnotationMenuItems`); marks stay on the editing toolbar.

#### Reference image — `images/imageProperties.ts`

| Field | Control | Range | Storage | Setter | Protocol | Undo label | Support |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `opacity` | slider 0..1 | validator clamps | `annotation.opacity` | `updateAnnotation` (continuous bracket) | continuous | 'Adjust opacity' | supported |
| `rotation` | number, degrees, step 1 | — | `annotation.rotation` (radians CCW) | `updateAnnotation` in the bracket | draft | `panels:creasePattern.rotateAnnotation` 'Rotate annotation' (the existing gesture label) | supported |

The sheet subtitle is `naturalWidth × naturalHeight`. `src` is never a field
(immutable, `cpImage.ts:53-57`). Width/height/center numerics are a follow-up
(units and clamps unsettled); crop stays the overlay's mode (a "Reset crop"
would be the crop field's `reset` once a crop field exists); stacking and
delete stay on `CpImageInspector`.

#### Inline simulation window — `inlineSimulation/inlineSimulationProperties.ts`

One section, **Simulator settings**, with description
`t('panels:cpProperties.inlineSimulation.sharedNote', 'Shared with the Simulate workspace and every window')`,
which is what makes the sharing visible — the thing
`InlineSimulationInspector.tsx:116-121` demands of any surface that shows it.
A window has no per-object property of its own today (the descriptor is box, z,
view and provenance; `view` is never read back), so this is the whole sheet.

| Field | Control | Range / options | Storage | Setter | Protocol | Undo label | Support |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `colorMode` | select | `ColorMode` via `colorModeLabel` (moved to `enumLabels.ts`) | `simulatorSettings` (app-wide preference) | `setSimulatorSetting('colorMode', v)` | discrete, **no `undoLabel`** | — | supported |
| `frontColor` / `backColor` | color | — | `simulatorSettings` | `setSimulatorSetting` (begin → true, end → nothing) | continuous, no history | — | supported |
| `showEdges` | toggle | — | `simulatorSettings` | same | discrete, no history | — | supported |
| `creaseStyle` | select | `creaseStyleLabel` (moved to `enumLabels.ts`) | same | same | discrete, no history | — | supported |

Only keys `resolveRenderSettings` consumes appear; ranges from
`SIMULATOR_SETTING_RANGES`. Camera `view` is a non-goal until write-back exists.
Transport, refresh, export and delete stay on the floating inspector.

#### Region — `regions/regionProperties.ts`

Sections: **Region**, **Suppressed checks**, **Reference image** (when
`region.imageId` resolves to an annotation — a direct lookup, no findings pass).
`hidden` is `not-applicable` (`annotationCanHide`). Solve, Stop, Accept, Try
again and the hidden-findings count stay on the chip: the solve is a verb with
a state machine behind it, and the count is the chip's safety affordance.

| Field | Control | Range / options | Storage | Setter | Protocol | Undo label | Support |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `check:<class>` (one per `CP_CHECK_CLASSES`) | toggle, **tick = suppressed** | `cpCheckClassLabel` | `region.suppress` | `useCpRegionActions().toggleRegionCheckClass` (re-entrant; delegates to `annotationGesture`) | discrete | `panels:cpRegion.changeChecks` | supported |
| `opacity` | slider 0..1 | — | `region.opacity` (renderer honours it; the chip omits it by design) | `updateAnnotation` in the bracket | continuous | 'Adjust opacity' | supported |
| `imageShown` | toggle | — | owned image `hidden` | `toggleRegionImageHidden` | discrete | `panels:cpRegion.imageVisibility` | when `image` |
| `imageOpacity` | slider | — | owned image `opacity` | `setRegionImageOpacity` | continuous | existing | when `image` |

Not offered: `label` (persisted but rendered nowhere except the chip's
accessible name — a rename field for something only screen readers hear is a
product decision for when the chip shows it), `z`, per-region solver knobs,
remove-image (a verb; `RegionImageMenu` keeps it).

### 11. Analytics and i18n

- `analytics/events.ts`: `canvasObjectPropertyChanged: 'canvas object property changed'`
  with `{ object_kind: CanvasObjectKind, property: <field id> }`, fired once per
  commit from `SheetHost`'s `onCommit` through
  `analytics/trackCanvasObjectPropertyChanged.ts`; `view drawer opened` gains
  `pane`; `ContextMenuTargetKind` gains `'region'`. `view.properties` is
  chokepoint-covered. No per-selection "shown" event — it would count selection,
  not pane use. Never a value, colour, angle or text; `property` is the field
  id, an enum by construction. Rows added to `docs/analytics.md`.
- i18n: every label is a literal `t('panels:cpProperties.<kind>.<field>', 'English')`
  inside the catalog or a render-site helper (`foldedColorLabel`,
  `foldedDisplayStyleLabel`, `foldedStateLabel`, `cpCheckClassLabel`, and
  `colorModeLabel` / `creaseStyleLabel` / `textBlockLabel` / `sourceKindLabel`
  lifted into `i18n/enumLabels.ts`); `i18n:extract` → translate the 8 non-English
  locales (`de es fr ja ko pt-BR ru zh-CN`) → `i18n:stamp` → `i18n:check` in
  every phase.

### 12. Selection lifecycle rules the pane depends on (Phase A1)

1. Every claim goes through `takeCanvasSelection`: the 3D fold completion
   (`creasePatternSlice.ts:2261-2263`) becomes
   `takeCanvasSelection('folded-figure', { …, oristudioCpActiveFoldedFigureId: figureId, oristudioCpFocusedFoldedFigureId: figureId })`;
   the flat fold completion (`:2419`) becomes `takeCanvasSelection('none', {…})`;
   `deleteOristudioCpFoldedFigure` (`:3444-3452`) releases with no auto-advance.
2. A named `releaseCanvasSelection(owner)` beside `takeCanvasSelection` is used
   by `setSelectedAnnotation(null)`, `setOristudioCpActiveFoldedFigure(null)`
   (`:1924`, which also drops folded focus) and
   `focusOristudioCpInlineSimulation(null)`; the asymmetry is preserved and now
   has one name and one comment.
3. The async landing of a model or style write does not re-claim the canvas
   (§4.4 b).
4. `.osf` load (`projectSlice.ts:1179-1183`): if the restored crease selection
   is non-empty, `oristudioCpActiveFoldedFigureId` is nulled — one holder at
   the boundary.
5. Undo/redo of an overlay entry (`historySlice.ts:305`) preserves
   `oristudioCpSelectedAnnotationId` when the restored list still contains it;
   window focus stays dropped (focus is a running solver and the app-wide
   `simulator` scope, which history must not resurrect); the active folded
   figure is already restored. The pane therefore keeps its subject across undo
   for four of five kinds; for a window the pane leaves the dock with the
   focus, as on any other release.
6. No lint rule for selection writes: an AST selector on `set({...})` misses
   `set((state) => …)` and needs disable comments inside the two helpers; the
   store invariant test (`canvasSelectionInvariant.test.ts`, driving every
   selection-bearing action and asserting at most one holder) is the guard.

## Decisions

Each open question, settled, with the rejected alternative and why.

1. **Descriptor registry with one renderer, not kind-owned JSX sections.** The
   "what properties does a kind offer" question is a React-free, store-free
   catalog returning plain descriptors with a per-field support answer and an
   explicit commit protocol — the `foldedFigureActions.ts` discipline AGENTS.md
   names as the reference, testable with identity `t` and `vi.fn` deps, and
   rendered by one exhaustive switch. Rejected: per-kind hand-written row
   components (no catalog test is possible, the analytics `property` enum is
   hand-maintained per hook, label drift between surfaces is prevented only by
   convention). The "fifth protocol" objection is answered by the three named
   protocols covering every field, and by the scope rule in Decision 3: what
   the protocols cannot express is not a property and is not in the pane.
2. **Labels are strings computed inside the catalog with `t` from deps**, not
   `(t) => string` functions. It matches the named reference
   (`buildFoldedFigureActions(figure, deps)` with `deps.t`); the dock-title
   table carries literal key/default pairs instead, because its readers live
   inside the store and resolve through `i18n.t` (Decision 10).
3. **Properties, not verbs; no custom sections.** The pane holds fields with a
   value — seven field kinds and an optional per-field `reset`. Delete,
   duplicate, refold, stacking, refresh, Solve/Stop/Accept, remove-image and the
   figure picker stay on the floating toolbars, chips, context menus and the
   folded picker that already own them. The first draft had an `action` field
   kind and three named custom sections (figure list, region solve, object
   list); the product decision removed them, and with them the solve-state and
   region-view lifts and the object-list phase. `lib/propertyDescriptors.ts`
   carries no CP concept at all. Rejected: an action row for the verbs a kind's
   toolbar already has (two surfaces for one verb, with the pane's copy unable
   to reach panel-held state like `exportAs` or the 3D `flip`), and a
   custom-section escape hatch (a second UI framework for three consumers).
4. **One per-kind table carries selection id field, entries field and
   resolver; `selectedCanvasObjectId`, `CanvasSelectionFields` and the store
   hook derive from it.** Rejected: a central `switch` with one arm per kind
   (silent fall-through for a new kind), a hand-written `classifyCanvasObject`
   beside the table (two resolution paths that drift — the "half-registered"
   bug the memory note records), and a React-bearing registry as the resolver's
   home (store-free consumers would import every section's JSX).
5. **Canvas layer bindings replace the panel's per-kind arms (Phase C2).** The
   verified count for a new non-annotation kind today is six panel edits plus
   the context-menu router; the binding record produced by each layer's hook
   makes it one row. Rejected: leaving the arms and switching their discriminator
   to `canvasObjectKindOf` (a one-source change that still leaves an arm per
   kind).
6. **Registry key is the flat five-member kind union; a solve region is a
   `suppressionRegion` with a `solvable` flag.** The pane, the floating switch
   and the drawer all key on what the object *is*; a sixth kind would double
   every consumer for identical geometry and invite a discriminator that could
   disagree with the chip. Rejected: owner-keyed registry with annotation
   sub-dispatch in a consumer.
7. **The registry does not mount the floating inspectors.** The cascade becomes
   `CpFloatingInspectors.tsx`, an exhaustive switch over the resolver union
   taking the canvas panel's hooks as props. Rejected: a `Floating` slot on the
   registry entry (`CpFoldedFigureToolbar` needs `foldedFigureActionDeps` from
   the single-instance `useFoldedFigures`) and splitting `useFoldedFigures` into
   halves to make that possible (the riskiest refactor in any proposal, for a
   slot).
8. **A permanent second tab in the View group with a one-line empty state,
   revealed on a transition to a different non-null selection, deferred with
   `runAfterPointerGesture`, guarded by `isVisible`, a no-op under a coarse
   pointer; the hook lives in the pane.** Verified: dockview keeps an inactive
   tab's React tree mounted and `setActive()` moves no focus. Rejected: a tab
   that exists only while something is selected (a dock add/remove, a group
   reflow and a layout save per selection change, plus `layoutStore` presence
   flags it cannot derive itself because the workspace store registers seams
   *into* it — the riskiest new lifecycle in the plan, dropped for an empty
   state that costs one sentence), stacked below (halves a 260px column that
   already scrolls, no prior art), replacing View's content (wrong title),
   mounting the reveal hook in the frozen panel, calling `activatePanel` from
   `takeCanvasSelection` (store → layout coupling; would fire for kernel crease
   selections too).
9. **Reconcile, not a `LAYOUT_VERSION` bump.** `reconcileSidePanes` generalises
   the existing add-missing-View-pane rung to a list, preserving sash widths.
   Rejected: v19 (discards every user's Edit arrangement to add one tab).
10. **Dock titles come from `i18n.t` in the store, keyed by literal
    `titleKey`/`titleDefault` pairs, with an `i18n.on('languageChanged')`
    retitle.** Five store modules already import `i18n`, and a resolver seam
    registered by the shell would not be in place when `onReady` builds the
    first layout (DockviewReact's effect runs before the parent's). Rejected: a
    registered title-resolver seam (an ordering problem for no purity gain).
11. **Touch: one View pill, one sheet with a View | Properties segmented header,
    and a latched side-pane request so `View ▸ Properties` from any workspace
    and the phone overflow row open the sheet at Properties.** Rejected: a
    second pill (lane width on a 375px phone, pinned pill-order tests),
    desktop-only (retiring the phone modal would strand phone users), and an
    un-latched request (closed by the workspace-switch effect in the same
    commit — verified).
12. **Menu gate: an activate verb, visible everywhere like every other `view.*`
    entry, enabled with an editable CP, no default chord.** Rejected: a
    Show/Hide toggle (menus have no checked state; dock panes cannot close) and
    hiding it outside the CP context (inconsistent with the bare-noun View
    entries).
13. **Module-level gesture owners per layer with refusal on overlap, a `held`
    signal the canvas also honours, brackets that open on the first moved
    pointermove and close on every pointerup/cancel, and a drain every layer's
    commit awaits.** The pane stays mounted through drags and the per-hook refs
    are not re-entrant; a single owner is the only place "one entry per gesture"
    is checkable. Each of the four clauses answers a verified failure (a click
    holding the layer; a refused canvas drag writing anyway; a stale re-entrant
    baseline; an annotation entry embedding a pre-landing figure list).
    Rejected: gating the pane on an in-flight signal the overlay does not
    publish; a second hook instance in the pane; queuing a foreign `begin`
    behind a draining commit (its baseline would include the drag's early moves
    or need a per-figure shadow model).
14. **Undo mid-gesture: end open sessions at the `edit.undo`/`edit.redo` arm of
    `handleMenuAction` and at `discardCpDocumentState`, and supersede in-flight
    folded writes on `'history'`.** Every app-level undo path reaches that arm;
    keyboard undo inside a text box is Lexical's own by design. Rejected:
    `historySlice` calling every owner's `abortAll()` (import cycle) and a
    history-stamp compare at commit (abandons a drag on *any* mid-gesture entry).
15. **Folded writes: fix the slice's merge base, pending count and landing
    re-claim; add a web-side single-flight queue; drain before commit; kernel
    caching is optional and last.** The three slice bugs are the slice's and
    must not depend on caller discipline. Rejected: making the slice action
    itself single-flight (changes the "newest result wins" contract the store
    tests pin), optimistic store writes (stale `renderSnapshot` in history
    entries), kernel cache first (oracle-gated; changes cost, not correctness).
16. **Folded verbs as a React-free module over the owner; the pane never mounts
    `useFoldedFigures`.** Rejected: splitting the 968-line hook.
17. **Text alignment: whole box; idle → pure JSON transforms pinned by a
    headless-Lexical parity test; editing → the registered editor with
    `$selectAll` + `SKIP_SELECTION_FOCUS_TAG`, recording nothing.** A box-level
    `align`/`color` field would be an `.osf` addition whose CSS-cascade
    semantics would not visibly change runs carrying explicit values;
    dispatching `FORMAT_ELEMENT_COMMAND` headlessly has no handler. Colour is
    the six `TEXT_COLORS` swatches, not a free picker.
18. **`editingTextId` lives in a session-only module store that also holds the
    bracket token.** A store field would force `CP_DOCUMENT_SCOPED_KEYS`
    producers and a history-capture decision for a value history must never
    restore.
19. **One companion-surface attribute and one predicate for both press-outside
    rules, plus `tabIndex={-1}` on the pane root; the `focusout` exit stays.**
    Rejected: two attribute lists answering one question, and replacing the exit
    with an explicit session owner now (a keyboard-semantics change that belongs
    in its own PR — recorded as a follow-up).
20. **`isShortcutEditingTarget` is untouched.** Widening it to
    `[role=combobox]` would swallow every app chord while a Select trigger is
    focused (verified in the dispatcher and `appKeyboard`). The View pane's
    existing single-key exposure is a non-goal here.
21. **Selection after undo is preserved for annotations when the id survives;
    every delete selects nothing (folded auto-advance removed); raw-set bypasses
    are funnelled; landings do not re-claim; `.osf` load applies one holder.**
    Two user-visible changes, stated in Phase A1's goal rather than hidden.
22. **`anti_alias` is exposed; `side` is `not-applicable` on 3D.** The oracle
    says `anti_alias` is supported and the kernel honours it. `side` on 3D is
    effective only until the first orbit records a camera, then inert; a control
    that works until you touch the model is the class the oracle exists to
    prevent, so the pre-orbit default-camera flip is dropped and the module's
    comment and test say so.
23. **Inline simulations: the shared simulator settings under a labelled
    section and nothing else; transport, refresh, export and delete stay
    floating; no camera rows; the inspector's colour-mode menu goes.**
    Per-window settings were rejected in code; a docked, labelled pane is the
    sanctioned place; `view` is never read back.
24. **Regions: tick = suppressed, no label editor, opacity yes, z no, no solver
    knobs, no solve section, no findings count; the owned image is a direct
    `imageId` lookup; a right-click surface from the chip.** The chip is the
    sibling surface for the same object and keeps every verb; the View pane's
    tick = shown is a document-wide question.
25. **Hide and Lock are out of scope.** Both make an object un-hit-testable
    (`annotation.ts:134`); a toggle without a way back is the locked-underlay
    footgun `RegionImageMenu.tsx` documents, and the way back (an object list)
    is navigation the pane does not host.
26. **Analytics: one `canvas object property changed { object_kind, property }`
    per commit from `SheetHost`; `view drawer opened` gains `pane`; no "shown"
    event.** Rejected: bucketed values (would leak opacity/angles), per-input
    events, a per-selection "shown" event (measures selection).
27. **What kinds render before their phase.** The mapped-type registry needs
    all five entries from Phase C, so Phase C ships a *real, minimal* sheet for
    folded (display style), text (opacity) and regions (suppressed checks)
    built only on setters that exist and are re-entrant; later phases extend
    those sheets. Rejected: placeholder sheets (a visible tab that says "coming
    later" is a product smell).

## Adding a new kind

Two honest counts, because "register a new kind" has two halves.

**What the Properties pane adds to a kind that already exists on the canvas**
(a kind with a store array, a selection owner, an overlay adapter, an `.osf`
validator and an export-loss row — everything `apps/web/docs/superset-features.md`
already lists):

1. `cp-workspace/stickers/stickerCanvasObject.ts` — the kind row: `selectionIdField`,
   `entriesField`, `resolve(entry, id)`. A new file, ~15 lines.
2. `cp-workspace/canvasObjects/canvasObjectKinds.ts` — add `'sticker'` to
   `CanvasObjectKind`, a `{ kind: 'sticker'; id; sticker }` member to
   `CanvasObjectTarget`, and the row in `CANVAS_OBJECT_KINDS`. Typecheck now
   fails in the registry, `CpFloatingInspectors`, and the layer's binding
   producer until steps 3–6 are done — every consumer is exhaustive over the
   union, and `useSelectedCanvasObject` iterates the table.
3. `cp-workspace/stickers/stickerProperties.ts` — `buildStickerProperties(target, deps): CpPropertySheet`
   with literal `t()` labels, support per field, and each commit expressed
   against `deps`; plus `stickerProperties.test.ts` with identity `t` and
   `vi.fn` deps.
4. `cp-workspace/stickers/useStickerProperties.ts` — bind `deps` to store verbs
   and to the layer's gesture owner (an annotation kind reuses
   `annotationGesture` and adds one row to `annotationVerbLabels`).
5. `cp-workspace/properties/canvasObjectPropertyRegistry.ts` — one row.
6. `cp-workspace/canvasObjects/CpFloatingInspectors.tsx` — one arm (`return null`
   if the kind has no floating verbs); the kind's binding producer (its `use*`
   hook) returns a `CanvasLayerBinding` with a `contextMenu` builder.
7. `analytics/events.ts` — `ContextMenuTargetKind` gains the kind if it has a
   right-click surface (`object_kind` needs nothing: it is `CanvasObjectKind`).
8. `npm run i18n:extract`, translate `panels:cpProperties.sticker.*` and the
   kind's verb labels in 8 locales, `i18n:stamp`, `i18n:check`.

For an **annotation** kind (it joins the annotation layer): three new files,
four compile-enforced edits, one events edit, the annotation binding's internal
`AnnotationKind` switch and `cpAnnotationMenuItems`' kind parameter, the
invariant test's action list, and locale files. Nothing changes in
`components/panels/`, the dock tables, the drawer, the menus or the empty
state. For a **new-layer** kind, add: its hook mounted in `CreasePatternPanel`
and appended to the `mergeCanvasLayerBindings([...])` list (two panel lines —
the honest residue of a layer the panel composes), its fields named in
`CanvasSelectionIdField`/`CanvasEntriesField`, and a `ContextMenuTargetKind`
member. The stub-kind test proves the annotation case: it registers a stub kind
and drives resolver → registry → `PropertySheetView` → binding merge with no
edit outside those files; a second stub with its own layer proves the panel's
share is the two lines.

**What a brand-new canvas object kind costs before the pane sees it** — stated
so nobody reads the count above as the whole bill. A new *annotation* variant
is: the `AnnotationKind` union and the exhaustive switches keyed on it
(`annotationAspectLockPolicy`, `annotationCanHide`, `annotationAsTransformable`'s
yield rule), a factory + validator, the `.osf` per-kind array (writer literal,
reader literal, `NativeCreasePatternDocumentV1`, `NativeCreasePatternProjectInput`,
the store split/merge in `projectSlice`), a `SUPERSET_FEATURES` row +
`SupersetFeatureId` member + `supersetFeatureLabels` case + `SupersetPresence`
sampler, a render seam (GPU channel or DOM layer), a creation tool or menu verb
(`MENU_ACTION_IDS` + capability + menu row), and its label families
(`dialogs:exportLoss.feature.<kind>`, verb labels, tool/menu strings). A new
*non-annotation* kind is additionally a new overlay layer: a store array and
selection id, a `takeCanvasSelection` owner arm, an `OristudioCpHistoryEntry`
field, the `pushOverlayHistoryEntry` input, a `record<Kind>History` action, the
`historySlice` restore, `CP_DOCUMENT_SCOPED_KEYS`, and a fourth
`createGestureBracket` instance. That is the 20–40 file reality today; Phase C2
removes the panel's share of it, and this PR extends
`apps/web/docs/superset-features.md` with the pane steps so there is one
checklist, not two.

## Affected Areas

**Create** (under `apps/web/src` unless noted)

- `lib/propertyDescriptors.ts`
- `components/ui/fieldRows/{FieldRow,ToggleRow,NumberRow,SelectRow,SegmentedRow,SliderRow,ColorRow,TextRow,ReadoutRow,ActionRow,index}.tsx`, `components/ui/CollapsibleSection.tsx`, `components/ui/GestureSlider.tsx` (moved from `cp-workspace/AnnotationOpacitySlider.tsx`)
- `components/properties/PropertySheetView.tsx` (+ test)
- `components/panels/CpPropertiesPanel.tsx` (+ test)
- `cp-workspace/canvasObjects/{canvasObjectKinds.ts,useSelectedCanvasObject.ts,canvasLayerBindings.ts,gestureBracket.ts,canvasSessions.ts,canvasCompanionSurface.ts,CpFloatingInspectors.tsx}` (+ tests)
- `cp-workspace/properties/{canvasObjectPropertyRegistry.ts,SheetHost.tsx,usePropertiesPaneActivation.ts}` (+ registry stub-kind test, activation test)
- `cp-workspace/annotations/{annotationGesture.ts,annotationVerbs.ts,textCanvasObject.ts,textEditSession.ts,textEditorRegistry.ts,textDocTransforms.ts,textProperties.ts,useTextProperties.ts}` (+ tests)
- `cp-workspace/images/{imageCanvasObject.ts,imageProperties.ts,useImageProperties.ts}` (+ tests)
- `cp-workspace/folded/{foldedFigureGesture.ts,foldedFigureVerbs.ts,foldedModelWriteQueue.ts,foldedFigureCanvasObject.ts,foldedFigureProperties.ts,useFoldedFigureProperties.ts}` (+ tests)
- `cp-workspace/inlineSimulation/{inlineSimulationGesture.ts,inlineSimulationVerbs.ts,inlineSimulationCanvasObject.ts,inlineSimulationProperties.ts,useInlineSimulationProperties.ts}` (+ tests)
- `cp-workspace/regions/{regionCanvasObject.ts,regionProperties.ts,useRegionProperties.ts,regionMenuItems.ts}` (+ tests)
- `store/sidePaneRequests.ts`
- `store/workspaceStore/canvasSelectionInvariant.test.ts`
- `analytics/trackCanvasObjectPropertyChanged.ts`
- `implementation-plans/canvas-object-properties-panel.md` (this plan)

**Modify**

- `store/workspaceStore/slices/creasePatternSlice.ts` (fold completions and folded delete through `takeCanvasSelection`; `releaseCanvasSelection`; landing without re-claim; `issuedModels` merge base; `pendingLiveModelWrites` count; `supersedeFoldedFigureModelWrites`), `slices/historySlice.ts` (preserve annotation selection), `slices/projectSlice.ts` (one-holder rule on load), `cpDocumentState.ts` (`endOpenCanvasSessions('document-replaced')`)
- `store/layoutStore.ts` (+ test, mock extended), `components/WorkspaceViewDrawer.tsx` (+ test), `hooks/useWorkspaceViewDrawer.ts`, `components/WorkspaceShell.tsx` (+ test), `components/CanvasPillLane.tsx`
- `components/panels/PanelComponents.tsx` (+ test), `workspaces/workspaces.ts` (+ test), `workspaces/editingContext.ts` (+ test)
- `commands/menuActions.ts` (`view.properties`; `endOpenCanvasSessions('history')` at the undo/redo arm) (+ test), `menus/menuDefinition.ts` (+ test), `lib/workspaceCapabilities.ts` (+ test), `keyboard/shortcuts.ts`
- `analytics/events.ts`, `docs/analytics.md`
- `components/panels/CreasePatternPanel.tsx` (cascade → `CpFloatingInspectors`; per-kind arms → `mergeCanvasLayerBindings`; dropdown/modal/overflow row removed), `components/panels/CpViewControlsPanel.tsx`, `SimulatorViewControlsPanel.tsx`, `components/CreaseExportDialog.tsx` (private rows → kit)
- `cp-workspace/canvasObjects/transformableObject.ts` (`selectedCanvasObjectId` re-exported from the kinds table), `cp-workspace/CanvasObjectOverlay.tsx` (begin on first move; `onGestureCancel`; honour a refused begin)
- `cp-workspace/annotations/useCpAnnotations.ts`, `cp-workspace/folded/useFoldedFigures.ts`, `cp-workspace/folded/foldedFigureAppearance.ts` (`side` on 3D) + test, `cp-workspace/folded/foldedFigureControlOptions.ts` (one display-style label set), `cp-workspace/inlineSimulation/useInlineSimulations.ts`, `cp-workspace/inlineSimulation/useBlurOnPressOutside.ts` (+ test), `cp-workspace/regions/{useCpRegions.ts,useCpRegionSolve.ts,useCpRegionChipDrag.ts,CpRegionLayer.tsx,SolveRegionChip.tsx,SuppressionRegionChip.tsx,RegionImageMenu.tsx}`, `cp-workspace/contextMenu/{useCpCanvasContextMenu.ts,cpContextMenuItems.ts}`
- `cp-workspace/{CpTextEditor.tsx,CpImageInspector.tsx,AnnotationActions.tsx,InlineSimulationInspector.tsx}`, `components/ui/FloatingToolbar.tsx` (companion attribute)
- `i18n/enumLabels.ts`, `cp-workspace/annotations/textFormatting.ts` (`TEXT_COLORS`)
- `eslint.config.js` (remove the stale `PANELS_WITH_LEGACY_KEYDOWN` entry; lower the CP ledger in Phase D)
- `public/locales/*/{panels,menu,common}.json` (9 locales)
- `apps/web/docs/superset-features.md` (pane steps added to the new-kind checklist), `implementation-plans/crease-pattern-panel-decomposition.md` (Phase 2a status), `implementation-plans/inline-simulations-in-undo.md` (selection-after-undo note)
- Optional Phase G: `crates/oristudio-cp/src/{session.rs,folding.rs}`, `crates/oracle-tests`

**Delete**

- `cp-workspace/folded/FoldedFigureControls.tsx` (the form; `FoldedFigureMenuButton` and `FoldedFigureModal` stay as pickers and shrink), `cp-workspace/AnnotationOpacitySlider.tsx` (moved)

## Phases and Checklist

Run web validation from the repo root (`npm run lint:web`, `npm run typecheck:web`,
`npm run test:web`, `npm run i18n:check`) on Node 22; the generated wasm bridges
must exist in the worktree (`scripts/setup-worktree.sh`). Each phase is one
reviewable PR against `main`. Phases A1–A3 are behaviour-preserving substrate
(A1 states its two visible changes); B–F ship the pane kind by kind; G is
optional.

### Phase A1 — Selection seam and slice fixes

**Goal.** One kind table and resolver, no raw-set bypasses, defined selection
after undo, delete, load and async landings, and the slice-side folded-write
bugs fixed. Store-only apart from the kind table. Two user-visible behaviour
changes, stated: deleting a folded figure no longer selects another one, and
undo keeps an annotation selected when it survives. Ships alone: yes.

- [x] `cp-workspace/canvasObjects/canvasObjectKinds.ts`: kind union, target union, `CanvasObjectKindRow`, `CANVAS_OBJECT_KINDS`, derived `CanvasSelectionFields`, `CanvasSelectionIdField`/`CanvasEntriesField`, `CANVAS_SELECTION_ID_FIELDS`, `selectedCanvasObjectIdOf` (`transformableObject.selectedCanvasObjectId` becomes an adapter over it, signature unchanged), `findCanvasObjectEntry`, `resolveCanvasObjectEntry`, `resolveCanvasObjectById`, `resolveSelectedCanvasObject`, `canvasObjectKindOf`; per-kind rows in `images/imageCanvasObject.ts`, `annotations/textCanvasObject.ts`, `regions/regionCanvasObject.ts`, `folded/foldedFigureCanvasObject.ts` (importing `isFoldedFromCurrentCpSourceKind` from `engine/oristudioCpTypes.ts`, the predicate the hook already uses), `inlineSimulation/inlineSimulationCanvasObject.ts`; unit tests (dangling ids → null; region vs image narrowing; imported figures → null; precedence matches the old `selectedCanvasObjectId`)
- [x] `cp-workspace/canvasObjects/useSelectedCanvasObject.ts` (ids, then one entry per table row; a test asserts zero re-renders during a foreign drag and agreement with `resolveSelectedCanvasObject`)
- [x] `store/workspaceStore/slices/creasePatternSlice.ts`: route `:2261-2263`, `:2419` and `deleteOristudioCpFoldedFigure` through `takeCanvasSelection`; add `releaseCanvasSelection(owner)` and use it at the three release sites; drop the folded-delete auto-advance; model/style landings (`:2882-2892`, `:2769-2782`) write the entry without re-claiming unless the figure is still active
- [x] `creasePatternSlice.ts` `updateOristudioCpFoldedFigureModel`: merge onto the last-issued model (`issuedModels`, cleared with the handle); `pendingLiveModelWrites` as a count; `supersedeFoldedFigureModelWrites(id)` action
- [x] `store/workspaceStore/slices/projectSlice.ts` `.osf` load: null the active folded figure when the restored crease selection is non-empty
- [x] `store/workspaceStore/slices/historySlice.ts:303-305`: keep `oristudioCpSelectedAnnotationId` when `previous.annotations` still contains it; update the pinned history tests and the note in `implementation-plans/inline-simulations-in-undo.md`
- [x] `store/workspaceStore/store.test.ts` `describe('one canvas selection')` (a separate file would have to duplicate the runtime mock block): every selection-bearing action (select each kind, fold flat/3D, delete each kind, undo/redo, open an `.osf` with two holders, a model write landing after the selection moved) leaves at most one holder
- [x] Store tests: merge base (two fields issued back-to-back both land), pending count (first-finished tick does not unmask a reconcile), supersede (a landing after undo does not overwrite the restored list)
- [x] `eslint.config.js`: remove `CreasePatternPanel.tsx` from `PANELS_WITH_LEGACY_KEYDOWN` (no keydown listener exists)

Validation: `npm run lint:web && npm run typecheck:web && npm run test:web`
(store tests, `cp-workspace/canvasObjects`, `regionWiring.test.tsx`).

### Phase A2 — Field-row kit, CollapsibleSection, descriptor types

**Goal.** Land the shared presentation pieces as a behaviour-preserving dedupe
of three panels. Ships alone: yes.

- [x] `lib/propertyDescriptors.ts`
- [x] `components/ui/fieldRows/*` + `index.ts`; `components/ui/CollapsibleSection.tsx` with one `.collapsible-section__*` CSS family in `theme.css`; the 26px select-trigger rule set once
- [x] Move `cp-workspace/AnnotationOpacitySlider.tsx` → `components/ui/GestureSlider.tsx` (generic `onGestureStart`/`onGestureCommit(label)`); `SliderRow` wraps it; `AnnotationActions.tsx` and `RegionImageMenu.tsx` import the new path
- [x] Migrate `CpViewControlsPanel.tsx` and `SimulatorViewControlsPanel.tsx` onto the kit; delete their private `ToggleRow`/`NumberRow`/`SliderRow`/`Section`. `CreaseExportDialog`'s `ExportSection` is left as is: it is a *controlled* accordion (one section open at a time, state lifted to the dialog) with the modal's own styling, not the pane disclosure, so forcing it onto `CollapsibleSection` would change the dialog for no shared code
- [x] Kit render tests (Toggle never inside a `<label>`; Segmented/Select accept `null`; NumberRow resyncs on value change; the continuous latch resets when `held` flips)

Validation: `npm run lint:web && npm run typecheck:web && npm run test:web`
(`components/ui`, `CpViewControlsPanel.test.tsx`, `SimulatorViewControlsPanel.test.tsx`);
a browser check that both View panes behave identically.

### Phase A3 — Gesture owners, session chokepoint, verbs modules, companion predicate

**Goal.** One bracket per layer with refusal on overlap that the canvas honours;
brackets open on the first moved pointermove and close on every pointerup or
cancel; open sessions end at the undo chokepoint and on document replacement;
the canvas verbs become React-free modules the hooks delegate to; one predicate
for press-outside. Ships alone: yes.

- [x] `cp-workspace/canvasObjects/gestureBracket.ts` (`createGestureBracket`) + tests: refusal (including while `beforeCommit` drains), same-owner re-entry, unchanged → no entry, stale token no-op for both `commit` and `update`, `abort` invalidates, `run` shape, `openOwner`/`subscribe`
- [x] `cp-workspace/canvasObjects/canvasSessions.ts` (store-free registry); `commands/menuActions.ts` `edit.undo`/`edit.redo` arm calls `endOpenCanvasSessions('history')` before dispatch; `store/workspaceStore/cpDocumentState.ts` `discardCpDocumentState` calls `endOpenCanvasSessions('document-replaced')`; `menuActions.test.ts` case
- [x] `annotations/annotationGesture.ts`, `folded/foldedFigureGesture.ts` (its `'history'` ender calls `supersedeFoldedFigureModelWrites`), `inlineSimulation/inlineSimulationGesture.ts`, all with `beforeCommit: drainFoldedModelWrites` (a no-op until Phase D's queue exists; wired now so the contract is in place); `useCpAnnotations`, `useCpRegionActions`, `useCpRegionChipDrag`, `useFoldedFigures` (begin/commit/`runFoldedFigureAction`/`scope` protocol) and `useInlineSimulations` delegate with unchanged public signatures except that `beginGesture` returns the boolean
- [x] `CanvasObjectOverlay.tsx`: `onGestureStart` moves from pointerdown to the first moved pointermove; a `false` return aborts the drag before any box update; the begin call moves to the `moved` transition (`:556`/`:565`/`:584`) and the sub-pixel `onUpdate` at `:557` moves under the `moved` flag; the `Drag` record gains `bracketOpen`; `onGestureCancel(id)` on `handlePointerCancel`, `abortDrag` and an unmoved pointerup only when `bracketOpen`; `CreasePatternPanel` wires `cancelGesture` per kind (Phase C2 folds it into the bindings)
- [x] `annotations/annotationVerbs.ts` + `annotationVerbLabels`, `folded/foldedFigureVerbs.ts`, `inlineSimulation/inlineSimulationVerbs.ts`; `useCpAnnotations` and `useFoldedFigures.foldedFigureActionDeps` delegate to them
- [x] `cp-workspace/canvasObjects/canvasCompanionSurface.ts`; attribute on `CpImageInspector`, `InlineSimulationInspector` (+ export menu), the text toolbar group, the region chips (`FloatingToolbar` gains a `companion` prop); `useBlurOnPressOutside` and `CpTextEditor.handleBlur` consume the predicate; `PORTALED_SURFACES` and `data-cp-text-toolbar` removed
- [x] Tests: `foldedFigureGestureHistory.test.tsx` and `useCpRegionChipDrag.test.tsx` green; new: "click to select, then a pane-style `begin('pane:x')` succeeds and records one entry"; "an overlay drag begun while another owner is open is refused and writes nothing"; "a foreign begin during a draining commit is refused"; `CpTextEditor.test.tsx` and `useBlurOnPressOutside.test.tsx` updated for the predicate

Validation: `npm run lint:web && npm run typecheck:web && npm run test:web`
(`cp-workspace/**`, `commands`, store history tests); browser: click an image
(no bracket left open — a subsequent opacity drag from the floating toolbar is
one entry), drag an image, drag a window, edit text, undo from the menu bar
mid-edit — one entry each, commit-then-undo for text.

### Phase B — Side-pane list, dock tab, drawer tabs, menu, empty pane

**Goal.** The `cp-properties` tab exists in the View group for every Edit layout
(persisted ones included), is reachable from `View ▸ Properties` and the touch
drawer, and shows the empty state. Ships alone: mergeable alone, but release
together with Phase C — an always-empty tab is honest but pointless.

- [x] `store/layoutStore.ts`: `WORKSPACE_SIDE_PANES` list with placement, `SidePaneId`, `sidePanesFor`, `sidePaneTitle` (the one literal `i18n.t` site), `addSidePane`, `reconcileSidePanes` (coarse removes all; fine adds missing panes in order; retitles present ones; repairs a side pane found in a headerless group by re-adding it through the placement path); retitling rides the reconcile, which `useViewPanelReconcile` re-runs on `i18n.language` rather than through a second `i18n.on('languageChanged')` subscription in the store; `applyEditLayout` builds both on a fine pointer; `activatePanel` publishes `requestSidePane` when the pane is absent under a coarse pointer; `LAYOUT_VERSION` stays 18. Added: `refuseDropsIntoHeaderlessGroups(api)`, wired in `WorkspaceShell.onReady` — the centre drop onto the canvas was reachable by dragging a tab (verified in the browser: Properties covered the canvas with no tab back), so the repair rung now has a prevention in front of it; edge drops still split
- [x] `layoutStore.test.ts`: mock gains `setTitle`, honours `inactive`, restores group ids/`hideHeader` from serialized leaves, fires `onWillShowOverlay`/`onWillDrop`; tab placement via `referenceGroup` + `inactive`; "repairs a persisted layout by tabbing Properties into the View group"; "moves a side pane out of the headerless primary group"; "refuses a drop that would tab a panel into a headerless group"; "asks the drawer for a listed pane the dock does not hold"; coarse removes both; Design untouched; pane-table ↔ lookup agreement gains the pair
- [x] Register `'cp-properties'` in `PanelComponents.tsx`, `workspaces.ts`, `editingContext.ts` (→ `'crease-pattern'`) and their pinned tests; `components/panels/CpPropertiesPanel.tsx` with the one-line empty state, `data-cp-companion`, `tabIndex={-1}`
- [x] `store/sidePaneRequests.ts`; `hooks/useWorkspaceViewDrawer.ts` (`panes`, `activePane`, `openDrawer(paneId?)`, latched `pendingPane` consumed after the force-close effect); `WorkspaceViewDrawer.tsx` segmented header; `data-view-panel` → `data-view-workspace`; `view drawer opened` gains `pane`; `WorkspaceShell.test.tsx` and `WorkspaceViewDrawer.test.tsx` updated (tabs of one sheet, cross-workspace request). *Moved to Phase C:* the drawer's initial tab following the canvas selection — it is the same "selection → which pane" rule as `usePropertiesPaneActivation`, and belongs beside it rather than as a CP-workspace import in a generic hook
- [x] `commands/menuActions.ts` (`view.properties`, `VIEW_PANEL_ACTIONS`), `menus/menuDefinition.ts` (View row after Simulate), `lib/workspaceCapabilities.ts` (`capability(canEditCp, …)`); their tests. `keyboard/shortcuts.ts` needs no entry: no `view.*` action has one and the registry is not exhaustive over action ids
- [x] i18n: `panels:sidePane.view`, `panels:sidePane.properties`, `panels:cpProperties.empty`, `menu:view.properties`, `common:capability.properties`, `common:capability.showPropertiesPane`, plus Phase A3's verb labels (`panels:creasePattern.bringTextToFront`/`sendTextToBack`, `panels:cpRegion.bringToFront`/`sendToBack`, `panels:cpProperties.folded.changeView`); 8 locales

Validation: `npm run lint:web && npm run typecheck:web && npm run i18n:check && npm run test:web`
(`layoutStore`, `WorkspaceShell`, `WorkspaceViewDrawer`, `PanelComponents`,
`workspaces`, `editingContext`, `menuActions`, `menuDefinition`,
`workspaceCapabilities`); `npm run build:web`; `npm run check:desktop` for the
native menu; browser: a persisted Edit layout gains the tab with sash widths
intact; iOS Simulator: `View ▸ Properties` from Design and from Edit opens the
sheet on Properties.

### Phase C — Registry, renderer, floating-inspector switch, first sheets

**Goal.** The pane edits reference images and inline simulation windows end to
end, shows a real minimal sheet for the other three kinds, and the inspector
cascade is gone. Ships alone: yes.

- [x] `cp-workspace/properties/canvasObjectPropertyRegistry.ts` (+ stub-kind test), `SheetHost.tsx`, `usePropertiesPaneActivation.ts` (transition rule, `isVisible` guard, coarse no-op, `runAfterPointerGesture`) + test; the touch drawer opens on Properties when a canvas object is selected (`useWorkspaceViewDrawer`). **Corrected claim:** dockview 4.13 renders panels `onlyWhenVisible` by default (verified in the browser: the View pane leaves the DOM while Properties is on top), so an inactive tab's React tree is *not* mounted and the activation hook cannot live in the pane — it is mounted by `CreasePatternPanel`, which lives for the whole workspace under every pointer
- [x] `components/properties/PropertySheetView.tsx` (exhaustive switch over the seven field kinds, per-field `reset` — `FieldRow` gained the trailing `onReset` affordance, `ColorRow` maps it to `onClear` — `surfaceProps`, `onCommit`) + test rendering one field of every kind; `cp-workspace/canvasObjects/usePaneGesture.ts` is the pane's side of a layer bracket (one token, same-field re-entry, `held`), and `annotations/useAnnotationPaneDeps.ts` binds it for the three annotation kinds
- [x] `images/imageProperties.ts` + `useImageProperties.ts` (opacity, rotation°; natural size as the subtitle); `CpImageInspector` drops the opacity slider and keeps front/back/delete (`AnnotationActions` is now stacking + delete)
- [x] `inlineSimulation/inlineSimulationProperties.ts` + `useInlineSimulationProperties.ts` (the shared settings section with the sharing note); `InlineSimulationInspector` drops its colour-mode menu; `simulatorColorModeLabel` / `simulatorCreaseStyleLabel` in `i18n/enumLabels.ts`, shared with `SimulatorViewControlsPanel`
- [x] Minimal sheets built only on existing re-entrant setters: folded (display style via `foldedFigureVerbs.setFoldedFigureDisplayStyle`; not-ready figures get the row disabled with a reason), text (opacity via the annotation bracket), region (suppressed checks via `updateAnnotationAsEntry` + `toggledCheckClasses`, which moved beside the region type so the catalog stays React-free)
- [x] `cp-workspace/canvasObjects/CpFloatingInspectors.tsx` replaces the cascade; the panel resolves the selection once (`useSelectedCanvasObject`), the delete ladder switches on its kind, the `selectedCpRegion` memo is gone (the selection toolbar's guard is `!selectedCanvasObject`), and `useCpCanvasContextMenu.onCanvasObjectContextMenu` dispatches through `resolveCanvasObjectById`
- [x] `analytics/events.ts` `canvasObjectPropertyChanged` + `analytics/trackCanvasObjectPropertyChanged.ts` + `docs/analytics.md` row
- [x] `implementation-plans/crease-pattern-panel-decomposition.md`: correct the Phase 2a row
- [x] `canvasObjectWiring.test.tsx` (copied from `regionWiring.test.tsx`): seeding each selection mounts exactly one floating surface and one sheet, and stands the selection toolbar down (the folded clause is covered by the switch's exhaustiveness — its toolbar needs a kernel render snapshot); `CpPropertiesPanel.test.tsx` per kind against the seeded store; `useBlurOnPressOutside.test.tsx`: a press inside the pane keeps the window focused
- [x] i18n for the image and inline-simulation sections; 8 locales

Validation: `npm run lint:web && npm run typecheck:web && npm run i18n:check && npm run test:web`;
`npm run build:web`; browser: selecting an image brings the tab forward after
the click completes (no dropped click, no lost canvas focus) and Escape leaves
the tab where it is, showing the empty state; an opacity drag from the pane is one undo entry and the canvas drag started during
it is refused; changing colour mode from the pane updates the window and the
Simulate workspace.

### Phase C2 — Canvas layer bindings: kind dispatch out of the panel

**Goal.** The canvas panel dispatches no id-addressed callback by kind. Each layer's hook returns one
`CanvasLayerBinding`; the panel merges them; the context menu, delete, select,
box update and gesture callbacks dispatch through `bindings.byId(id)`. A new
kind is one binding row. Behaviour-preserving. Ships alone: yes.

- [x] `cp-workspace/canvasObjects/canvasLayerBindings.ts` (`CanvasLayerBinding`, `mergeCanvasLayerBindings(bindings, kindOf)` — the kind resolver is passed in so the merge stays pure) + pure tests, including a stub-kind binding dispatched with no merge edit
- [x] `useCpAnnotations`, `useFoldedFigures`, `useInlineSimulations` return `binding` (transformables, overlayBoxes, inertBodyIds, select, release, applyBoxUpdate, begin/commit/cancelGesture, remove, contextMenu, and the image/text overlay inputs); `regions/regionMenuItems.ts` gives regions their rows, raised from a right-click on the chip bar (`CpRegionChipBar.onContextMenu` → `CpRegionLayer.onContextMenu` → the panel's object-menu entry); a region's `remove` is `useCpRegionActions.removeRegion`, so Delete on a selected region now deletes it (with its owned image and pins) rather than being refused
- [x] `CreasePatternPanel.tsx`: `selectCanvasObject`, `handleCanvasObjectUpdate`, `beginCanvasObjectGesture`, `commitCanvasObjectGesture`, `cancelCanvasObjectGesture`, `canvasObjects`, `overlayBoxes` and `inertBodyIds` are one merge and `byId` lookups (the delete ladder switches on the resolved target's kind — the one remaining per-kind switch in the panel, kept because a region's Delete is the chip's verb and the ladder says so); `useCpCanvasContextMenu.onCanvasObjectContextMenu` hands `binding.contextMenu(id, deps)` to the controller and the annotation/folded arms left the hook; `analytics/events.ts` `ContextMenuTargetKind` gains `'region'`
- [x] Stub-kind test (`canvasLayerBindings.test.ts`): a stub binding merges and dispatches with no panel edit; `regionWiring.test.tsx` gains a region right-click case; `regionMenuItems.test.ts`
- [x] `apps/web/docs/superset-features.md`: pane and binding steps added to the new-kind checklist; the two honest counts from this plan recorded there

Validation: `npm run lint:web && npm run typecheck:web && npm run test:web`
(`cp-workspace/**`, `CreasePatternPanel` wiring tests, context-menu tests);
browser: every object kind still selects, moves, resizes, deletes and
right-clicks as before.

### Phase D — Folded figures: write queue, full sheet, the form leaves the picker

**Goal.** The folded appearance form has one body, in the pane; continuous
colour edits are coalesced and commit after the write lands; the dropdown and
phone modal shrink to figure pickers. Ships alone: yes.

- [x] `folded/foldedModelWriteQueue.ts` + tests (burst of N patches → ≤ 2 round trips; two fields issued back-to-back both land; `drain` resolves after the last write; `supersede` drops the queued patch and stales the in-flight result; a failed write does not stall the queue); the three brackets' `beforeCommit` is `pendingFoldedModelWrites()` — a promise while anything is in flight, null otherwise, so a commit with nothing to wait for stays synchronous and opens no drain window. `useFoldedFigures.handleFoldedModelUpdate` / `endModelGesture` / the scope ref are **deleted** rather than rerouted: with the form gone the pane (`useFoldedFigureProperties`, through `usePaneGesture` + the queue) is the only continuous writer
- [x] `foldedFigureGestureHistory.test.tsx`: one change whose round trip outlives the gesture → exactly one entry, recorded after the write; a canvas drag and an annotation drag begun during the drain are refused; a click on another object during the drain does not stale the draining commit; a burst coalesces and commits after the last write lands. The undo-mid-write case is `store.test.ts` "reconciles the kernel after an undo supersedes a write still in flight" (Phase A1)
- [x] `folded/foldedFigureAppearance.ts`: `side` → `not-applicable` on 3D (comment reworded to say the pre-orbit seed is dropped); `foldedFigureAppearance.test.ts` updated
- [x] `folded/foldedFigureProperties.ts` + `useFoldedFigureProperties.ts`: the full inventory in §10 (Appearance, Camera with `live` orbit values and per-field `reset`, Placement; title + `foldedFigureSubtitle`); catalog tests: 3D side hidden, 3D shadows unsupported with reason, reopened → every appearance field unsupported with the Refold reason (placement stays editable), colours continuous begin/end once, camera spreads `orient`, zoom clamped, `reset` on yaw keeps the rest. Degree/radian helpers moved to `lib/angleUnits.ts`, shared with the image sheet
- [x] `FoldedFigureMenuButton` and `FoldedFigureModal` render `folded/FoldedFigurePicker.tsx` (the list, with an empty line for a document with no figure); `FoldedFigureControls.tsx` deleted; the 'Properties…' overflow row (`opensDialog: true`, disabled with nothing selected, `requestSidePane('cp-properties')`) beside the 'folded-models' row; the two display-style label sets collapsed onto `foldedDisplayStyleLabel`, keeping the toolbar's Paper / X-ray / Wireframe wording (already translated) and dropping `creasePattern.foldedStyle.*`
- [x] `eslint.config.js`: `OVERSIZED_PANELS['CreasePatternPanel.tsx']` 2900 → 2756, measured, with a ledger note
- [x] i18n for the folded section; 8 locales

Validation: `npm run lint:web && npm run typecheck:web && npm run i18n:check && npm run test:web`
(`cp-workspace/folded`, `orbitIsNotDocumentState.test.tsx`,
`useFolded3dRehydration.test.tsx`, folded toolbar snapshots); browser on a
~2000-crease flat figure: a colour drag stays interactive and undo restores the
pre-drag colour once; a 3D figure shows no Side row; the dropdown still picks
figures and no longer shows controls; iOS Simulator: the overflow row reaches
the folded sheet.

### Phase E — Text boxes: session lift, editor registry, doc transforms, full text sheet

**Goal.** A selected text box exposes alignment, block preset, colour, size and
opacity whether or not it is being edited, with one undo entry per change and
no double-recording inside a session. Ships alone: yes.

- [x] `annotations/textEditSession.ts` (holds the bracket token; owns the exit logic; registers its own undo-chokepoint ender at module load, so reaching it never depends on which surface is mounted) and `annotations/textEditorRegistry.ts` (`RegisterEditorPlugin` beside `EscapeExitPlugin`); `useCpAnnotations` drops `editingTextId`/the two refs and delegates; an effect ends the session when the selection leaves the box or the box vanishes
- [x] `annotations/textDocTransforms.ts` (`textDocSummary`, `setDocAlign`, `setDocBlock`, `setDocColor`, pure JSON, new object identities; every block written in Lexical's full serialized shape — a paragraph's `textFormat`/`textStyle` from its first text node) + the headless-Lexical parity test (`direction` normalised: the reconciler that settles it never runs headless); `TEXT_COLORS` lifted to `textFormatting.ts`; `textBlockLabel`, `textAlignLabel`, `textColorLabel` in `enumLabels.ts`
- [x] `annotations/textProperties.ts` + `useTextProperties.ts`: the two write paths (the editing path drives the editor block by block and node by node with no select-all, so the caret's node moves with its block and the selection needs no restoring; `SKIP_DOM_SELECTION_TAG` leaves the DOM selection alone); the colour is a select with swatches rather than segmented swatches — six named colours with labels fit the pane and mirror the toolbar's old control (`PropertyOption.swatch`, `SelectRowOption.swatch`); alignment is an icon-only segmented row (`PropertyOption.icon` names, `SegmentedControl.iconOnly`); the size is a percentage of the sheet edge (`ORIEDITA_PAPER_MAX − MIN`), not model units × 100 — the `0.04` default the plan read the unit from is a stale validator fallback, real boxes are ~17 units; catalog tests for mixed alignment (`null`), the host's write paths, the fixed colour set
- [x] `TextToolbar` trimmed to marks + delete (its dead CSS and the folded menu's form CSS removed); `CpTextEditor` takes `id`; `CpTextEditor.test.tsx` updated — **reverted in Phase H**: the per-selection controls are back on the toolbar
- [x] `annotations/textSheetWiring.test.tsx` (the text layer and the pane on one store; the panel cannot mount the editor in jsdom, which has no canvas view): aligning an idle box is one entry on the stored doc; aligning while editing drives the editor, keeps the session open with nothing recorded, and records one 'Edit text' entry on exit; the undo chokepoint commits the session first. `CpPropertiesPanel.test.tsx` aligns an idle box through the panel
- [x] i18n for the text section; 8 locales

Validation: `npm run lint:web && npm run typecheck:web && npm run i18n:check && npm run test:web`
(`cp-workspace/annotations`, `CpTextEditor`, `CpTextAnnotationLayer`, wiring);
`npm run build:web`; browser: align an idle box → `CpTextView` updates and one
entry; align while editing → caret stays.

### Phase F — Regions: full region sheet

**Goal.** A selected region exposes its suppressed checks, opacity and its
owned image's visibility and opacity; the chip keeps the findings count and
every verb. Ships alone: yes.

- [x] `regions/regionProperties.ts` + `useRegionProperties.ts`: the inventory in §10 (checks and the image's visibility through the annotation verb, region and image opacity through the annotation bracket — `AnnotationPaneDeps` gained `updateById`/`commitById` for a write addressed to the owned image on the same layer; owned image resolved by `imageId` from `oristudioCpAnnotations`); catalog tests (hidden not-applicable; image rows only when the owned image resolves; tick = suppressed; image writes addressed to the image)
- [x] `regionWiring.test.tsx` extended (the pane mounted beside the panel): selecting a region mounts the chip and the sheet, the sheet has no Solve control, toggling a check from the sheet and from the chip records one entry each and the sheet follows the store back
- [x] i18n for the region section; 8 locales

Validation: `npm run lint:web && npm run typecheck:web && npm run i18n:check && npm run test:web`
(`cp-workspace/regions`, wiring); browser: a check toggled from the pane
updates the chip's count; region opacity slides as one entry.

### Phase H — Follow-ups from the first review

Six fixes from Zach's pass over Phases A–F, each browser-verified.

- [x] A press that closes a Radix select's list lands on `<html>` (the list puts `pointer-events: none` on the body) and read as a press outside the simulation window, dropping the selection and emptying the pane mid-edit: `useBlurOnPressOutside` ignores a press whose target is outside `document.body`
- [x] Text opacity did nothing while the box was being edited: the row sat disabled because the session holds the layer's bracket. `useTextProperties` forks the box-level fields like the document ones — idle through the bracket, editing written straight into the store inside the session's entry (`textSheetWiring.test.tsx`: one 'Adjust opacity' entry idle; none until exit while editing, then one 'Edit text' that undoes the opacity with the text)
- [x] Anti-alias hidden: `foldedAppearanceSupport('antiAlias')` is `not-applicable` on every figure (see §10), the catalog row and its i18n key removed
- [x] The Camera rows' reset buttons overlapped the steppers: `.control-row__value--input` is a fixed 112 px box, so `FieldRow` marks a value with a reset (`control-row__value--reset`) and the input kind widens by the reset's 22 px — the stepper keeps its width and the reset trails it, as a colour field's clear does
- [x] The pane gives back the tab it displaced: `usePropertiesPaneActivation` remembers the group's active tab when *it* reveals Properties, subscribes to that group's `onDidActivePanelChange` (fired synchronously by `setActive`, and only for that group's tab — verified against dockview) so a manual tab change ends the reveal, and on a release transition activates the displaced tab, deferred past the pointer gesture like the reveal. A Properties tab the user had on top, or chose after the reveal, stays through a release; a release followed by another object before the pointer comes up flips nothing (`usePropertiesPaneActivation.test.tsx`, a two-tab fake group)
- [x] The text toolbar's per-selection block preset, alignment and colour are back, beside the marks: `annotations/textSelectionFormatting.ts` (`$readSelectionFormat`, `setSelectionBlock`/`Align`/`Color` — the editor's own idioms, no bracket; `$getSelectionStyleValueForProperty` for the colour rather than a regex on `selection.style`); Radix selects with the companion attribute on their portalled lists, refocusing the editor on close so the next keystroke lands in the text; `'default'` stands in for `''` as in the pane's colour select

Open from the same pass: the pane's alignment/style/colour act on the whole
box while the toolbar's act on the selection — a design question (whole-box vs
follow-the-caret while editing), not a bug; decided with Zach before any code.

### Phase G (optional, Rust) — Kernel render-input cache for flat figures

**Goal.** Per-tick appearance cost on large figures drops from ~200 ms native to
primitive emission so the queue rarely needs its second round trip. Parity
surface unchanged. Ships alone: yes.

- [ ] `crates/oristudio-cp/src/session.rs` / `folding.rs`: cache `FoldGraph`, `FoldedWireframe` and the subface configuration on `FlatFoldedFigure` after `fold_segments`; `render_snapshot_impl` takes borrowed cached inputs; the from-segments path stays for the oracle
- [ ] Optionally `folded_figure_set_model_and_render` added in lockstep to `CP_ENGINE_COMMANDS`, `oristudioCpWorker.ts`, `oristudioCpNativeClient.ts` and `cp_engine.rs` (parity test)
- [ ] `PORTING.md` note if the supported surface description changes

Validation: `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`;
`cargo test -p oracle-tests` (render oracle byte-identical);
`npm --workspace @treemaker/web run build:oristudio-cp-wasm` before any browser
timing on a large `.cp`.

## Risks

- **Reveal on selection hides the View tab whenever a different object is
  selected.** Users who live in View while placing objects may find it
  intrusive. Mitigated by the transition rule (never on the same object, never
  on release) and the `isVisible` guard; measure with the analytics event and
  add a setting only if it bites.
- **Refusal windows are user-visible in principle.** A canvas drag attempted
  while a pane slider is held (touch, two fingers) or while a large flat
  figure's colour write drains (up to two round trips) does not start. On
  ordinary figures the drain is milliseconds; the alternative — a drag that
  writes but cannot be undone — is worse. The refusal is pinned by tests so it
  cannot silently become the write-anyway behaviour.
- **Foreign store-owned entries landing mid-gesture** (a window refresh
  completing, a solve accepted while a slider is held) leave the gesture's
  `previous` predating that entry. Pre-existing with the per-hook refs; narrowed
  here; not solved. Solving it means routing every async completion through the
  layer's bracket or making overlay entries per-layer — a history-model change
  for its own PR.
- **Reconcile-add against layouts the module did not build.** A View pane the
  user dragged into an unusual group gets Properties tabbed into that group; the
  headerless-group repair rung must be tested against the extended mock before
  shipping.
- **Kernel cost per colour tick on large flat figures** (~200 ms native, wasm
  unmeasured) remains after single-flight coalescing: the drag lags by one
  round trip but is correct. Phase G is the real fix and is oracle-gated.
- **Gesture-owner migration touches four hooks' undo protocols and the overlay's
  begin timing at once** (Phase A3). A missed delegate would record a
  mid-gesture baseline; every existing gesture-history test stays green and the
  owner tests are added first.
- **Undo from the menu bar or a native accelerator while a pane slider is
  held**: the chokepoint aborts the bracket; the change made after the abort is
  recordable again (the latch resets), but the change before it lands
  un-undoable. Documented, not designed around.
- **Lexical parity.** The JSON transforms and the headless editor could diverge
  on a Lexical upgrade; the parity test is the guard, and `$setBlocksType`'s
  element-format copying is version-sensitive.
- **Session survival is still an attribute allowlist on a `focusout` rule.** A
  new portalled control without `data-cp-companion` ends a text session on
  click. The kit spreads the attribute onto every portal it opens; the explicit
  session-owner exit is the follow-up that removes the dependency.
- **The folded appearance controls move off the dropdown and phone modal**
  (which keep only the figure list); the phone path becomes overflow row →
  View sheet → Properties. Pinned overflow tests change and discoverability
  should be checked in the iOS Simulator. Whether the pickers survive at all is
  a later product call.
- **Preserving annotation selection across undo changes a pinned assertion**
  and the inline-simulations plan's stated decision; the PR must update the plan
  text so it is not re-litigated.
- **Phase C's minimal folded/text/region sheets** must not grow past what the
  existing setters support, or Phase D–F work leaks into C; the sheet contents
  are listed explicitly for that reason.
- **CreasePatternPanel headroom is 36 lines.** Phase C's `CpFloatingInspectors`
  extraction must take the inspector prop mapping with it (it passes the hook
  return objects, not twenty props) or the extraction does not count; Phase C2
  and D lower the ledger.

## Non-goals and follow-ups

- Design-workspace properties (TreeMaker Inspector/Conditions dedupe, a docked
  Box-Pleat inspector): only `lib/propertyDescriptors.ts`, the field-row kit and
  `PropertySheetView` are placed so a later BP pane can reuse them; an awaited
  `commit → Promise<boolean>` for engine-refused values is added then, not now.
- Multi-object selection and mixed-value editing beyond text alignment's
  per-block disagreement.
- Per-region solver options (angle family, lattice snap, symmetry, pleat
  spacing, carrier join, timeouts) and region label editing.
- Per-window inline-simulation colour/material settings; an editable or
  persisted window camera (`view` write-back does not exist); window z-order
  verbs.
- Folded-figure title rename, starting-face choice, a transparency amount
  slider, numeric placement offset, any new `FoldedFigureModel` field.
- Numeric width/height/center transform fields for annotations and a generic
  Transform section (units and clamps unsettled).
- New `.osf` fields, a per-object extensions bag, moving `foldedFigures` out of
  `viewState`, or any schema bump.
- Crease selections in the Properties pane (`CpSelectionToolbar` owns them; a
  crease selection alone shows the empty state).
- A tab that exists only while something is selected (see Decision 8) — if the
  empty state ever bites, that is the alternative, with its costs recorded.
- Verbs of any kind in the pane — delete, duplicate, refold, stacking, refresh,
  Solve, remove-image, reset view as a whole — and the figure picker or an
  object list; hide/lock toggles and a crop toggle (each needs a way back or a
  mode the pane does not host). If a verb ever belongs in the pane, it is a
  new field kind decided on purpose, not an `action` row.
- A Show/Hide toggle for the pane, closable dock tabs, a default chord for
  `view.properties`, a long-press gesture on the CP canvas.
- Fixing the Radix-button single-key exposure in the View pane; if fixed, it is
  fixed once in the dispatcher with a predicate narrower than
  `isShortcutEditingTarget`, never by widening that one.
- Replacing the text editor's `focusout` exit with an explicit session owner
  (and with it, app-level undo from inside the editor).
- Retiring `CanvasObjectOverlay`'s raw `window` keydown Escape listener in favour
  of the `viewport.cancel` route — an existing rule violation this plan works
  beside, not on.
- Per-layer overlay history entries, or routing async store-owned completions
  through the layer brackets (the foreign-entry hazard above).
- A kernel cache for flat-figure render inputs beyond Phase G's scope, or the
  desktop bridge's unfair-mutex write ordering (a single-flight policy sidesteps
  it).
