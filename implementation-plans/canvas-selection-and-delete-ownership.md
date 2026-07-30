# Canvas selection and Delete ownership

## Goal

Three reported defects on the Edit canvas, all downstream of the same two gaps:

1. A focused inline simulation window and a crease selection can be live at the
   same time, and `Delete` then deletes **both**.
2. Clicking a crease — or anywhere outside the CP panel — leaves the window
   focused.
3. `Shift+S` leaves the creases selected; the toolbar's *Simulate inline* button
   deselects them, so the keyboard and the button disagree.

After this change: the canvas holds exactly one selection, `Delete` has exactly
one owner, and simulating a region deselects it from either entry point.

Defect 1 is reported against inline simulations but is not specific to them — it
is live today for image and text annotations and for folded figures, by the same
route. Phases 1, 2 and 3a are therefore written per *canvas object*, not per
simulation; only 3b is simulation-specific, for the reason given there.

## Root cause

### Gap 1 — the "one canvas selection" invariant is asserted three times and enforced nowhere

Four store fields describe what is selected on the CP canvas:

| Field | Kind |
| --- | --- |
| `oristudioCpSelection` | creases (lines / points / circles) |
| `oristudioCpSelectedAnnotationId` | image / text annotation |
| `oristudioCpActiveFoldedFigureId` | folded figure |
| `oristudioCpFocusedInlineSimulationId` | inline simulation window |

Three separate comments claim the last three are mutually exclusive
"by construction" — [transformableObject.ts:69](apps/web/src/cp-workspace/canvasObjects/transformableObject.ts:69),
[creasePatternSlice.ts:1981](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:1981)
("enforced here rather than at the call sites so the invariant cannot drift"),
and [creasePatternSlice.ts:1194](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:1194).
It has drifted anyway:

- `setSelectedAnnotation` clears the folded id but **not** the inline-sim id.
- `setOristudioCpActiveFoldedFigure` clears the annotation id but **not** the
  inline-sim id.
- `focusOristudioCpInlineSimulation` clears the annotation id but **not** the
  folded id.
- The panel patches over all of this by calling all three by hand in
  `selectCanvasObject` ([CreasePatternPanel.tsx:1312](apps/web/src/components/panels/CreasePatternPanel.tsx:1312)) —
  i.e. the invariant lives at a call site, which is exactly what the comment says
  it must not do.
- ~13 sites in `creasePatternSlice.ts` write `oristudioCpActiveFoldedFigureId`
  through a raw `set({...})` and bypass the setter entirely (folding, importing,
  restoring — e.g. lines 1296, 1440, 1507, 1550, 1607, 1719, 1776, 1802).

And **`oristudioCpSelection` was never part of the invariant at all.** No path
makes a crease selection and a canvas-object selection exclusive. That is the
precondition for every symptom above.

### Gap 2 — `Delete` has three owners because the dispatcher has no way to decline

| # | Owner | Deletes | Listener |
| --- | --- | --- | --- |
| 1 | `edit.delete` menu action ([menuActions.ts:445](apps/web/src/commands/menuActions.ts:445)) | creases / BP node / project selection | `document`, **capture** ([appKeyboard.ts:47](apps/web/src/lib/appKeyboard.ts:47)) |
| 2 | Panel effect ([CreasePatternPanel.tsx:1491](apps/web/src/components/panels/CreasePatternPanel.tsx:1491)) | the selected canvas object | `window`, **bubble** |
| 3 | Panel effect ([CreasePatternPanel.tsx:2836](apps/web/src/components/panels/CreasePatternPanel.tsx:2836)) | the last measurement | container, bubble |

Capture-on-`document` runs strictly before bubble-on-`window`, so #1 always runs
first and #2 always runs after. The `event.preventDefault()` at
`CreasePatternPanel.tsx:1499` cannot help: the dispatcher's `defaultPrevented`
guard ([shortcutDispatcher.ts:49](apps/web/src/keyboard/shortcutDispatcher.ts:49))
was already passed. **Both deletes land.**

This is a known, documented gap, not a new discovery. Both
[shortcuts.ts:260-263](apps/web/src/keyboard/shortcuts.ts:260) and
[CreasePatternPanel.tsx:2829-2835](apps/web/src/components/panels/CreasePatternPanel.tsx:2829)
explain why the raw listeners exist and name the missing piece:

> Giving the dispatcher a way for an executor to decline is what would let this
> move; until then it carries the same focus caveat as the canvas-object delete
> beside it.

Note this is **not** inline-simulation-specific. Owner #2 branches over all three
canvas-object kinds, so each of these deletes twice today:

- **Annotations** (image and text alike — `deleteSelectedImage` acts on
  `oristudioCpSelectedAnnotationId`): select creases, click an image, `Delete`.
  Worse here than for a window, because the annotation delete takes its own undo
  checkpoint ([useCpAnnotations.ts:237](apps/web/src/cp-workspace/annotations/useCpAnnotations.ts:237))
  while the crease delete runs an `executeOristudioCpCommand('LineSegmentDelete')` —
  two history mechanisms on one keypress. A session-only simulation window takes
  no checkpoint and cannot hit this.

  **Resolved in Phase 1**: the two could not have been reversed by one undo. The
  crease delete is `await`ed, the annotation delete is synchronous, so the
  annotation's entry lands first — carrying `overlayOnly: true` and a snapshot of
  the document *before* the creases went
  ([pushOverlayHistoryEntry](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:394)).
  One undo restored the annotation and left the creases deleted. Phase 1 removes
  the interleaving by construction: exactly one of the two verbs now runs per
  press, so no keypress produces both entries.
- **Folded figures** (`folded.remove`): same shape.

Inline simulations only made it easy to *reach*, because their focus is sticky —
nothing but an empty-canvas click gives it up.

### Why `Shift+S` and the button disagree

[`useSimulateSelection`](apps/web/src/cp-workspace/inlineSimulation/useSimulateSelection.ts)
exists precisely so "the keyboard and the button cannot disagree about what
counts as a simulatable region" ([CreasePatternPanel.tsx:1280](apps/web/src/components/panels/CreasePatternPanel.tsx:1280)).
The deselect is not in it. The button gets deselection incidentally, from
`CpSelectionToolbar`'s `runAndDismiss` ([CpSelectionToolbar.tsx:147](apps/web/src/cp-workspace/CpSelectionToolbar.tsx:147)),
whose documented purpose is dismissing the *floating toolbar*, not deselecting on
simulate. `Shift+S` goes straight to the hook and skips it, and
`addOristudioCpInlineSimulation` ([creasePatternSlice.ts:1039](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:1039))
clears `oristudioCpSelectedAnnotationId` but not the crease selection.

### Verdict

**Architectural, but narrow and already scoped by the codebase's own comments.**
Two invariants that should be enforced in one place each are instead enforced at
call sites (selection) or not at all (Delete ownership). Neither needs new
abstractions — one store helper and one dispatcher return value. Roughly 200
lines across 7 files. Phases 1 and 2 each independently kill the data-loss bug;
3 and 4 are the interaction polish the user asked for.

## Approach

### Phase 1 — one owner for `Delete`

Give viewport executors a way to decline a chord synchronously, then move the
canvas-object delete onto the registry.

- `ViewportExecutor` returns `boolean | void`; `executeShortcut`
  ([shortcutDispatcher.ts:92](apps/web/src/keyboard/shortcutDispatcher.ts:92))
  treats an explicit `false` as *not claimed* and `continue`s to the next scope.
  Only the `viewport` target changes — `menu` stays fire-and-forget because
  `handleMenuAction` is async and cannot answer inside a keydown.
- Add `viewport.deleteCanvasObject` on `Delete` / `Backspace`, and replace the
  `shortcuts.ts:260-263` comment with what actually happens now.
- `handleViewportShortcut` returns `false` when no canvas object is selected or
  objects are not interactive, so the chord falls through to `edit.delete` at
  global scope. Viewport scope resolves before global, so a canvas object — the
  thing showing handles — wins, which is the priority the current accidental
  double-delete was groping at.
- Delete the `window` keydown effect at `CreasePatternPanel.tsx:1491-1514`.
- Move the measurement `Backspace` (`CreasePatternPanel.tsx:2821-2855`) onto the
  same mechanism as a second declining branch, and drop its caveat comment. Three
  owners → one.

Decision to make: a user-visible `viewport.deleteCanvasObject` row appears in the
Help modal and shortcut settings next to "Delete Selected", which reads oddly.
Either give it a clearer label ("Delete Selected Object") or add a flag to keep
registry-only entries out of the listing.

### Phase 2 — one canvas selection invariant, enforced in the slice

One internal helper in `creasePatternSlice.ts`:

```ts
/** The canvas holds one selection: naming any owner clears the other three. */
function canvasSelectionPatch(owner: 'annotation' | 'folded' | 'inline-simulation' | 'creases' | 'none')
```

Funnel every write through it — including the ~13 raw `set({ oristudioCpActiveFoldedFigureId })`
sites, which is where the current drift lives. `setOristudioCpSelection` and the
`toggleOristudioCp*Selection` actions clear the three object ids when the result
is non-empty. `selectCanvasObject` in the panel then stops hand-clearing three
fields and just names the new owner.

Behavior changes to confirm during implementation, both believed correct:

- `foldOristudioCpDocument` activates the new figure
  ([creasePatternSlice.ts:1296](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:1296)),
  which will now clear the crease selection it folded from. `selectedFoldLineIds`
  is only read to *start* a fold ([useFoldedFigures.ts:225](apps/web/src/cp-workspace/folded/useFoldedFigures.ts:225)),
  so nothing downstream breaks — but "Fold model" becomes disabled right after a
  fold instead of re-runnable on the same selection.
- Selecting a diagnostic or running Select All will now drop an active figure.

Implemented with one refinement the plan did not anticipate: only *taking* the
selection is invariant-bearing. Releasing your own claim (`setSelectedAnnotation(null)`,
`clearOristudioCpSelection`, an empty `setOristudioCpSelection`) leaves the other
three alone. Without that asymmetry, picking any crease tool would have deselected
the creases it was about to act on — the tool rail calls
`setSelectedAnnotation(null)` on every tool change
([CreasePatternPanel.tsx:1711](apps/web/src/components/panels/CreasePatternPanel.tsx:1711)).

### Phase 3 — the window gives up focus on any press outside it

Two halves; both are needed, and they are not redundant.

- **Crease clicks**: the `!hit` branch of `onSelect` already calls
  `selectCanvasObject(null)` ([CreasePatternPanel.tsx:2984](apps/web/src/components/panels/CreasePatternPanel.tsx:2984));
  the `line` / `point` / `circle` branches do not. Blur there too — on the
  gesture, not on the resulting selection, so a click that *deselects* the last
  crease still blurs.
- **Outside the panel** (3b, simulations only): a `document` `pointerdown` that blurs unless the press
  landed on the window or its portalled inspector. Tag both surfaces with a
  `data-inline-simulation-surface` attribute and test `closest()`; the inspector
  is portalled into `toolbarContainer`, so a DOM-containment check against the
  panel alone would blur on every scrub.

  Lives in a hook beside the concern (`cp-workspace/inlineSimulation/`), not in
  the panel — per AGENTS.md > "Panel components". Guard on
  `focusedId !== null` and the outside test so it is at most one state update per
  focus session: an unconditional `setState` on every `pointerdown` is what broke
  BP toolbar clicks by reflowing the pane mid-gesture.

  Deliberately **not** generalized to annotations and folded figures. A window's
  focus claims the app-wide `simulator` shortcut scope, so leaving it focused from
  another panel keeps Space / F / C / R shadowed everywhere — a cost no other kind
  carries. An image that stays selected while you click a sidebar is ordinary
  design-tool behavior, and Phase 1 already contains the `Delete` risk: the
  canvas-object delete is a *viewport* shortcut, so it is not consulted once
  another viewport surface is active.

This also releases the `simulator` shortcut scope
([InlineSimulationLayer.tsx:423](apps/web/src/cp-workspace/InlineSimulationLayer.tsx:423)),
which today keeps Space / F / C / R shadowed app-wide while a window is focused,
even from another panel.

### Phase 4 — simulating a region deselects it

Extend the `set` in `addOristudioCpInlineSimulation`
([creasePatternSlice.ts:1039](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:1039))
to clear `oristudioCpSelection` — it already clears the annotation id, and this is
the same rule. Both entry points get it from the store, so they cannot disagree
again. Safe with `useSimulateSelection`, which resolves the segment from a state
snapshot captured before the call. `runAndDismiss` stays for the toolbar's other
buttons.

Falls out of Phase 2 if `canvasSelectionPatch('inline-simulation')` is applied
here.

## Affected Areas

- `apps/web/src/keyboard/shortcutDispatcher.ts` — executor decline
- `apps/web/src/keyboard/shortcuts.ts` — `viewport.deleteCanvasObject`
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — remove two raw
  keydown effects, blur on crease click, simplify `selectCanvasObject`
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` — the
  selection invariant
- `apps/web/src/cp-workspace/canvasObjects/transformableObject.ts` — the doc
  comment now covers four fields
- `apps/web/src/cp-workspace/inlineSimulation/` — outside-pointerdown blur hook
- `apps/web/src/cp-workspace/InlineSimulationLayer.tsx` — surface tagging

Tests: `shortcutDispatcher.test.ts`, `shortcutRuntime.test.ts`,
`appKeyboard.test.ts`, `store.test.ts`, `inlineSimulation.test.ts`,
`CpSelectionToolbar` coverage.

## Checklist

- [x] Phase 1: executor decline in the dispatcher, with a test that a declining
      viewport executor falls through to the global scope
- [x] Phase 1: `viewport.delete` registered — one binding with the ladder in the
      executor, since the dispatcher takes the first match in a scope. Labelled
      "Delete Selected Object" in the Viewport category, so it reads distinctly
      from Edit > "Delete Selected"
- [x] Phase 1: both raw `keydown` effects deleted from `CreasePatternPanel`
- [x] Phase 1: regression test — crease selection + selected canvas object, one
      `Delete`, only the object dies. One case per kind: annotation, folded
      figure, simulation window
- [x] Phase 1: confirm one undo reverses an annotation delete that today also
      ran a `LineSegmentDelete`
- [x] Phase 2: `takeCanvasSelection` helper (a function, not a patch — giving up
      a selection also means deselecting in the kernel and redrawing a figure's
      marker); all four fields and every raw `set` site routed through it
- [x] Phase 2: store tests pinning that naming any owner clears the other three,
      verified to fail with the invariant reverted
- [x] Phase 3: any canvas press blurs the focused window — not only a crease
      click, so a press that deselects the last crease still gives the window up
- [x] Phase 3: outside-`pointerdown` blur hook, guarded against per-press state
      churn; scoped to presses outside the *panel*, not outside the window, so it
      cannot fight the canvas's own gestures (the resize handles live on the
      selection overlay, and blurring mid-drag would reload the solver)
- [x] Phase 4: `addOristudioCpInlineSimulation` clears the crease selection —
      fell out of Phase 2, as the plan predicted, since it routes through
      `takeCanvasSelection('inline-simulation', …)`
- [x] Phase 4: tests that `Shift+S` and the toolbar button leave the same state,
      plus one on the real store action (verified to fail with the fix reverted)
- [x] `npx tsc --noEmit`, `npm run lint:web`, web unit tests (1445 passing)
- [ ] Browser check: the three reported behaviors, plus fold-from-selection and
      Select All under the new invariant
