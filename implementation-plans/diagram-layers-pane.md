# Diagram: a Layers pane

## Goal

Zach, 2026-10-05: "There should be a separate Layers panel similar to
properties in the edit workspace that focuses when you select an item. It
should contain the layer list and all the actions shown below the layers."

Today the Step pane's Annotate section holds, in order: the Snap switch, a
notice when the picture changed under the marks, the list of what is drawn,
and the selected mark's controls. The list and everything under it move to a
pane of their own, **Layers**, a tab beside Step and Page, which comes forward
when a mark is selected, as Edit's Properties does for a canvas object.

## Approach

1. **The pane.** `diagram-layers` joins the Diagram's side panes as a tab of
   Step, after Page — where Edit puts Properties, the selection's pane, after
   View; a layout saved before it gains the tab on reconcile, which adds a
   missing pane last. Titled "Layers". The touch drawer offers it as a third
   pane.
2. **What it holds.** In Annotate: a notice when some marks were made by a
   newer Ori Studio (it says why the list leaves them out), the list — a press
   selects, as now — and under it the selected mark's controls, unchanged:
   node verbs, text, rotation, type, ticks, kinks, scale, white arrow, behind,
   turn-over axis, Flip, and the verbs (Flip Arc, Delete, …). Out of Annotate,
   one line: open a step in Annotate to see its layers, as Properties says to
   select an object.
3. **What the Step pane keeps.** In Annotate, its Annotate section keeps the
   Snap switch and the notice that the picture changed (with Keep Them Here):
   both are about the step and drawing on it, and sit above the list. Out of
   Annotate it keeps the count and the way in, as now.
4. **Coming forward.** The rule Edit's Properties follows
   (`usePropertiesPaneActivation`), on a fine pointer, after the gesture that
   selected: a mark selected — a different one — brings Layers forward,
   remembering the tab it covered; the selection released gives that tab back,
   unless the user changed the tab since, when their choice stands. A Layers
   tab the user picked stays. That rule moves from the Properties module into
   one shared helper (`store/sidePaneReveal.ts`), which both use, so the two
   panes cannot drift; Properties' own tests hold it to its behaviour.
5. **Touch.** The drawer opens on the selection's pane — Properties in Edit,
   Layers in the Diagram — when something is selected, as it does for Edit
   now. A label just put down asks for its text field wherever the field is
   mounted (`labelFocus.ts`), so its field is Layers' now, with no change to
   the request.
6. **Analytics.** No new event: the pane moves existing controls, whose verbs
   keep their events (`diagram annotation flipped`, `… behind`, …); `view
   drawer opened` already names the pane it opened on, an enum the new id
   joins.

## Affected Areas

`store/layoutStore.ts` (the table and the tab's title), new
`store/sidePaneReveal.ts`, `cp-workspace/properties/usePropertiesPaneActivation.ts`,
`diagram/useDiagramPaneReveal.ts`, `hooks/useWorkspaceViewDrawer.ts`,
`workspaces/workspaces.ts`, `workspaces/editingContext.ts`,
`components/panels/PanelComponents.tsx`, `components/WorkspaceViewDrawer.tsx`,
new `components/panels/DiagramLayersPanel.tsx`, new
`components/diagram/DiagramLayers.tsx` (the list and the selected mark's
controls, moved from `DiagramStepAnnotations.tsx`, with their styles),
`components/panels/DiagramStepPanel.tsx`; tests; the nine catalogs;
`diagram-workspace.md` (D13).

## Questions for Zach

- **Order.** The list keeps the order marks were drawn in, the last drawn at
  the bottom — and painted on top. Design tools list the top layer first and
  let a row be dragged to restack; that is a change to what the list means,
  so it waits for a yes.

## Checklist

- [x] Shared reveal helper; Properties on it, its tests unchanged and green.
- [x] The `diagram-layers` pane: table, title, workspace and context maps,
  component registry, drawer body, analytics enum note.
- [x] `DiagramLayers` (moved list and controls) and `DiagramLayersPanel`;
  the Step pane keeps Snap and the picture notice.
- [x] Coming forward on select, the tab given back on release; the drawer
  opens on Layers with a mark selected.
- [x] i18n; tests moved and added; gate.
- [x] In the browser on the crane: before/after of both panes; select on the
  canvas and from the list, Escape, a label's text, a restored layout, touch.
  - As built: found in the browser, a label just put down no longer got its
    text field. The dock keeps a tab behind another mounted with its content
    out of the page, so the field took the request and focused a detached
    textarea. It now takes the request only once it is in the page, and asks
    again each time it is laid out (`observeResizeDeferred`), which is when
    its tab comes forward. The selection's pane in the touch drawer is chosen
    among the workspace's own panes (`selectionPaneIn`): a canvas object left
    selected in Edit does not take the Diagram's drawer. Translated as design
    tools name the pane where the paper's layers have another word (Ebenen /
    Lagen, Calques / couches, レイヤー / 層, 레이어 / 층, 图层 / 层); Spanish,
    Portuguese and Russian have one word for both.
