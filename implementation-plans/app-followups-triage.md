# App follow-up fixes — triage & implementation plan

Five follow-up issues across the CP editor and the Box-Pleating design workspace.
Each section states the **diagnosis** (what's actually wrong, verified against source)
and a **fix plan**. Ordered roughly by effort — the first three are small/contained,
the last two (diagonal grid, BP-tree symmetry) are real features.

Effort key: 🟢 small · 🟡 moderate · 🔴 feature-sized

**Status:** items 1, 2, 4b (🟢) and **4a (diagonal grid, 🔴)** are **implemented**
(tsc clean, unit tests green). Items 3 and 5 remain.

---

## 1. 🟢 Eraser: clicking a crease doesn't delete it (only drag works)

**Diagnosis.** The eraser tool (`LineSegmentDelete`) is registered with the
`drag-box` input model in
[inputModelRegistry.ts:140](apps/web/src/cp-workspace/tools/inputModelRegistry.ts:140).
On left-button press the WebGL canvas routes it through the generic drag-tool
branch (`onPointerDown`, `else if (toolMode)` at
[CreasePatternWebglCanvas.tsx:1697](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1697))
and drives the `dragBoxTool`. That tool **commits nothing for a zero-area box** —
see the degenerate-box guard in
[dragBoxTool.ts:45-49](apps/web/src/cp-workspace/tools/dragBoxTool.ts:45). So a
click (no drag) produces no commit and nothing is erased. A drag produces a real
box → `onToolCommit` → `executeOristudioCpCommand('LineSegmentDelete', {points})`,
which is why dragging works.

Note the **right-button** erase gesture already handles the click case correctly:
its degenerate-box branch falls back to a hit-test + `onEraseLine(hit.id)`
([CreasePatternWebglCanvas.tsx:1853-1856](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1853)).
The left-button eraser tool simply lacks the equivalent fallback — mirroring
Oriedita's `LINE_SEGMENT_DELETE_3`, where a click deletes the crease under the
cursor and a drag box-erases.

**Fix plan.**
1. Add a canvas prop `activeToolClickErases: boolean` (parallel to the existing
   `activeToolClickSelects`), wired in `CreasePatternPanel` from
   `isLineEraseClickTool(activeCpCommand?.operationId)` (predicate already exists at
   [predicates.ts:32](apps/web/src/cp-workspace/tools/predicates.ts:32)).
2. In `onPointerUp`, in the `drawing` branch
   ([CreasePatternWebglCanvas.tsx:1863](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:1863)),
   add a click-fallback before the plain `feedTool('up')`: when
   `activeToolClickErases && !moved && type !== 'pointercancel'`, cancel the tool
   and call `onEraseLine(hitTest(e.clientX, e.clientY))` if it hits a line —
   exactly the right-button branch's logic.
3. `onEraseLine` already exists and calls
   `executeOristudioCpCommand('LineSegmentDelete', { line_ids: [id] })`
   ([CreasePatternPanel.tsx:2590](apps/web/src/components/panels/CreasePatternPanel.tsx:2590)),
   so no new command path is needed.

**Tests.** Extend `dragBoxTool` / canvas interaction coverage isn't necessary, but
add a predicate-level assertion and, if there's an existing canvas pointer test
harness, a click-erase case. Verify in-browser: pick Eraser, single-click a
crease → gone; drag a box → region cleared.

---

## 2. 🟢 Pressing **F** does not fold the model

**Diagnosis.** `F` is bound to `foldAction` in the Oriedita defaults
([shortcuts.ts:76](apps/web/src/keyboard/shortcuts.ts:76)). Two CP actions carry
`upstreamAction: 'foldAction'` — `FoldingEstimate` and `Fold`
([oristudioCpActions.ts:467,479](apps/web/src/lib/oristudioCpActions.ts:467)) — and
the shortcut builder de-dups the chord so it lands on whichever comes first. Either
way, pressing `F` calls `handleCpShortcutAction` → `handleCpToolAction(action)`
([CreasePatternPanel.tsx:1406](apps/web/src/components/panels/CreasePatternPanel.tsx:1406)).

The problem: **both fold commands are unimplemented stubs.** `FoldingEstimate` is a
`porting(...)` command and `Fold` is `notImplemented(...)`
([oristudioCpCommands.ts:631,635](apps/web/src/lib/oristudioCpCommands.ts:631)), so
their `uiStatus !== 'ready'`. `handleCpToolAction` returns early for any
non-ready command
([CreasePatternPanel.tsx:1372](apps/web/src/components/panels/CreasePatternPanel.tsx:1372)) —
it just selects the tool and does nothing else.

The **real** fold path is the toolbar "Fold" button → `handleFoldModel`
([CreasePatternPanel.tsx:1082](apps/web/src/components/panels/CreasePatternPanel.tsx:1082)),
which calls `foldOristudioCpDocument({ startingFaceId, lineIds })` and is gated by
`canFoldSelectedModel`. The keyboard shortcut is simply not wired to it.

**Fix plan.** Route the fold shortcut to the working fold, not the stub command.
Cleanest option:
1. In `handleCpShortcutAction`, special-case the fold action id(s): if the resolved
   action is `Fold`/`FoldingEstimate`, call `handleFoldModel()` (respecting
   `canFoldSelectedModel`) instead of `handleCpToolAction`.
2. Confirm which action id actually receives the `F` chord after de-dup (add a unit
   assertion in `shortcuts.test.ts`), and handle that id — or handle both to be safe.
3. Leave the toolbar button unchanged; both now share `handleFoldModel`.

Decision to confirm with Zach: `F` currently *would* select a (dead) fold tool.
Rerouting it to trigger a fold immediately matches Oriedita. No downside since the
tool is non-functional.

**Tests.** `shortcuts.test.ts`: assert the `F` chord resolves to the fold action.
Panel test (if feasible): dispatching the fold shortcut with a foldable selection
calls `foldOristudioCpDocument`. Browser: load a foldable CP, press `F` → folded
figure appears.

---

## 3. 🟡 Angle-Restricted Line should be press-drag-release (currently two clicks)

**Diagnosis.** "Angle Restricted Line" in the UI is `DrawCreaseAngleRestricted5`
([oristudioCpActions.ts:193](apps/web/src/lib/oristudioCpActions.ts:193),
`DRAW_CREASE_ANGLE_RESTRICTED_5_37`). The web port models it as a two-click
`point-sequence` (pointCount 2) at
[inputModelRegistry.ts:88](apps/web/src/cp-workspace/tools/inputModelRegistry.ts:88).

But Oriedita's handler is a **single-step press-drag-release** tool: mouse-move sets
the anchor (snapping to the nearest point), drag updates the angle-snapped release
point, release commits — see
`MouseHandlerDrawCreaseAngleRestricted5.java` (`DrawDeg5ActionStep.CLICK_DRAG_POINT`,
`move`/`drag`/`release`) at
[third_party/oriedita/.../MouseHandlerDrawCreaseAngleRestricted5.java:40-86](third_party/oriedita/oriedita/src/main/java/oriedita/editor/handler/MouseHandlerDrawCreaseAngleRestricted5.java:40).
So the two-click behavior is a port fidelity bug; the user's request matches
Oriedita.

**Fix plan.** Convert it to the `drag-line` model, like the plain Line tool
(`DrawCreaseFree`) and Grid-Restricted Line (`DrawCreaseRestricted`).
1. Change the registry entry to `{ model: 'drag-line' }`
   ([inputModelRegistry.ts:88](apps/web/src/cp-workspace/tools/inputModelRegistry.ts:88)).
   The coverage test (`inputModelRegistry.test.ts`) asserts point counts match
   `toolSteps`, so update the expectation / the command's `toolSteps` accordingly.
2. The command already receives its angle-system params via `buildCpCommandPayload`
   (`angle_system_divider`, `angles` for `DrawCreaseAngleRestricted5` at
   [CreasePatternPanel.tsx:345-353](apps/web/src/components/panels/CreasePatternPanel.tsx:345)),
   and the `drag-line` commit sends `points: [start, end]` through
   `handleWebglToolCommit`. The kernel snaps the endpoint to the angle system, so the
   **committed** crease is correct with no kernel change.
3. **Preview fidelity (polish, recommended).** The generic `drag-line` preview shows
   the raw cursor line, not the angle-snapped one. Oriedita snaps the drag preview
   (`syuusei_point_A_37` → `snapToActiveAngleSystem`). To match, add an
   angle-system resolve hook: either extend the existing `resolveDrawPoint` path with
   an operation-aware snap, or add an `activeToolAngleSnap` resolver the canvas
   applies to the endpoint during `feedTool('move')` when this op is active. Scope
   this as a second commit; the behavioral fix (single gesture) lands in step 1–2.

Also review sibling `DrawCreaseAngleRestricted3` (`point-sequence`, 3 pts) — its
Oriedita handler may or may not be a drag; **out of scope** unless Zach wants it,
but flag for consistency.

**Tests.** Update `inputModelRegistry.test.ts`. Browser: pick Angle Restricted
Line, press-drag-release draws one crease snapped to the angle system.

---

## 4. 🔴 Box-Pleating diagonal grid doesn't match BP Studio; segment buttons unstyled

Two separable sub-issues in `BpPackingPanel`.

### 4a. Diagonal grid geometry (feature-sized)

**Diagnosis.** In BP Studio a diagonal grid is **a square sheet placed diagonally**
— i.e. the sheet is rendered as a rotated diamond with a single `size`
(`width === height` enforced), and the grid lines run parallel to the diamond's
edges. See the vendored source
[box-pleating-studio/.../diagonalGrid.ts](third_party/box-pleating-studio/src/client/project/components/grid/diagonalGrid.ts):
`DiagonalGrid` — "places a square sheet diagonally"; `$getBorderPath` returns a
4-point diamond; `$drawGrid` emits the diagonal lattice; `$getTransformMatrix`
applies the 45° rotation.

The web port does **not** do this. `bpPackingPointToSvg` maps grid coords straight
onto an axis-aligned rectangle with no rotation
([bpPackingViewport.ts:80-89](apps/web/src/lib/bpPackingViewport.ts:80)), the sheet
is always drawn as an upright `<rect>`
([BpPackingPanel.tsx:1532](apps/web/src/components/panels/BpPackingPanel.tsx:1532)),
and "diagonal" merely **overlays two families of diagonal lines on top of the
orthogonal grid** (`bpPackingGridLines`,
[bpPackingViewport.ts:268-293](apps/web/src/lib/bpPackingViewport.ts:268)). So the
sheet outline, grid, and flap rectangles are all still axis-aligned — nothing like
BP Studio's rotated diamond.

The engine core already distinguishes the sheet type (`type === 'diag'` →
`kind: 'diagonal'` in
[oristudioBpSnapshotMapper.ts:582,620](apps/web/src/engine/oristudioBpSnapshotMapper.ts:582)),
so the model layer is fine; this is a **frontend rendering-model** gap.

**Fix plan (staged).**
1. **Port the diagonal transform.** Introduce a sheet-kind-aware coordinate mapping
   in `bpPackingViewport.ts`. For `kind === 'diagonal'`, replicate BP Studio's
   `DiagonalGrid.$getTransformMatrix` / `$offset` so grid coords land in the rotated
   diamond frame. All existing callers (`bpPackingPointToSvg`, `bpPackingRectToSvg`,
   `bpPackingUnitToSvg`) must go through it, so flaps, labels, and hit-areas rotate
   with the sheet.
2. **Sheet outline → diamond.** Replace the `<rect className="paper">` /
   shadow with a `<polygon>` following `$getBorderPath` (diamond) when diagonal;
   keep the rect for rectangular. Same for `paper-hit-area`.
3. **Grid lines.** Replace the overlay-diagonals branch in `bpPackingGridLines` with
   BP Studio's `$drawGrid` line set (lines parallel to the diamond edges), expressed
   through the new transform. Drop the "orthogonal + diagonal overlay" output.
4. **Constraints / world bounds.** `constrainBpPackingFlapTarget` and
   `getBpPackingWorldRect` must respect the diamond region (BP Studio's
   `diagonalConstrain` / `$contains`). Verify drag snapping stays on-grid.
5. Enforce `width === height` for diagonal sheets in the sheet menu (BP Studio
   requires it; `$setDimension` throws on mismatch). The Width/Height inputs at
   [BpPackingPanel.tsx:404-413](apps/web/src/components/panels/BpPackingPanel.tsx:404)
   should collapse to a single "Size" field when diagonal.

This is the largest item. Recommend landing it on its own branch with a fixture
comparison against the `tools/bp-studio-oracle` (the vendored core runs headlessly
under Bun) so the rendered diamond/grid can be checked against BP Studio's own
output, matching how the engine parity was validated previously.

**Decided:** target is **full BP Studio parity** — a real rotated-diamond sheet with
the diagonal lattice, not a prettier overlay. The staged plan above is the scope.

### 4b. Segment buttons not styled

**Diagnosis.** The Grid `Rect` / `Diagonal` segmented control uses bare `<button>`
elements ([BpPackingPanel.tsx:388-401](apps/web/src/components/panels/BpPackingPanel.tsx:388)).
The CSS at
[theme.css:4615](apps/web/src/styles/theme.css:4615) styles padding/color/radius and
an `.is-active` fill, but **never resets the native button chrome** — no
`appearance: none`, `border`, or `background` on the base
`.bp-sheet-menu__segment button`. The inactive button therefore shows the UA default
border + grey fill, which reads as "unstyled" next to the filled active one.

**Fix plan.** Add to `.bp-sheet-menu__segment button`
([theme.css:4615](apps/web/src/styles/theme.css:4615)):
`appearance: none; border: none; background: transparent;` (and confirm the active
rule still wins). Small, self-contained. Verify both light/dark themes. If other
segmented controls in the panel share the symptom, factor a shared class.

---

## 5. 🔴 BP tree view is missing TreeMaker's symmetry draw options

**Diagnosis.** The TreeMaker tree editor (`DesignPanel`) has a complete symmetry
authoring system: book/diagonal/custom axis presets, a symmetry menu button, a
"mirror" tool mode (`toolMode === 'symmetry'`,
[DesignPanel.tsx:505](apps/web/src/components/panels/DesignPanel.tsx:505)), live
mirror-node hover preview, and paired add/move
(`addNodeWithSymmetry`/`moveNodeWithSymmetry`,
[DesignPanel.tsx:863,911](apps/web/src/components/panels/DesignPanel.tsx:863)). It
draws on `lib/symmetryPresets.ts` and `lib/symmetryAuthoring.ts`.

`BpTreePanel` has **none** of this — a grep for `symmetry|mirror|reflect` in
[BpTreePanel.tsx](apps/web/src/components/panels/BpTreePanel.tsx) returns nothing. It
is a separate tree editor with its own authoring helpers
(`lib/bpTreeAuthoring.ts`, `rotatePointsAround`/`translatePoints`/`unitLeafLocation`)
over `OristudioBpTree`, not `TreeProject`.

**Coupling note.** `symmetryAuthoring.ts` splits cleanly:
- **Pure geometry** (reusable as-is): `SymmetryAxis`, `projectOntoSymmetryAxis`,
  `reflectPointAcrossSymmetryAxis`, `distanceToSymmetryAxis`, `symmetrySide`,
  `snapPointToSymmetryAxis`.
- **Project-coupled** (bound to `TreeProject`): `symmetryAxisForProject`,
  `findMirrorNodeId`, `addSymmetryAuthoringPair`, `filterSymmetryAuthoringPairs`,
  etc. ([symmetryAuthoring.ts:21-150](apps/web/src/lib/symmetryAuthoring.ts:21)).

**Fix plan.**
1. **Extract the pure geometry** into a model-agnostic module (or export the
   existing pure fns for reuse) so both `TreeProject` and `OristudioBpTree` can
   share them.
2. **BP-tree equivalents of the coupled helpers.** Implement axis-from-tree
   (from the BP tree's paper bounds), mirror-node lookup, and paired add/move over
   `OristudioBpTree`. **Decided:** pairing stays **ephemeral in the editor** — a
   panel-local map keyed by node id in `BpTreePanel`, *not* persisted into
   `OristudioBpDocumentState`. So the pairing does not survive reload/serialization;
   it exists only while authoring, and mirror mode re-derives pairs from the axis +
   node positions as needed (like TreeMaker's live authoring, minus persistence).
3. **UI port.** Adapt `DesignSymmetryMenuButton` + the "symmetry" tool mode into
   `BpTreePanel` (toolbar entry, preset menu, mirror-mode toggle, axis overlay,
   mirror hover preview). Much of the JSX/state can be lifted from `DesignPanel`.
4. **Wire mirror mode** into BpTreePanel's existing node drag/add so a
   draw/move on one side reflects to the paired node, matching
   `addNodeWithSymmetry`/`moveNodeWithSymmetry`.

Sizeable feature port. Sequence it after the diagonal-grid work or on its own
branch; the two BP items are independent.

**Tests.** Reuse/extend symmetry-geometry unit tests for the shared helpers; add BP
authoring tests for paired add/move. Browser: enable symmetry in the BP tree, draw a
node on one side → mirrored node appears; move it → pair follows.

---

## Suggested sequencing

| # | Item | Effort | Status | Notes |
|---|------|--------|--------|-------|
| 1 | Eraser click-to-delete | 🟢 | ✅ done | `activeToolClickErases` prop + click fallback |
| 2 | `F` folds the model | 🟢 | ✅ done | Fold/FoldingEstimate shortcut → `handleFoldModel` |
| 4b | Segment button styling | 🟢 | ✅ done | `appearance/border/background` reset |
| 4a | Diagonal grid parity | 🔴 | ✅ done | Rotated-diamond render model (needs visual check) |
| 3 | Angle-restricted line drag | 🟡 | todo | Registry + optional preview snap |
| 5 | BP-tree symmetry | 🔴 | todo | Feature port from DesignPanel |

Land the three 🟢 items together as a quick pass, then tackle 3, then the two
feature-sized BP items on their own branches. Both prior open questions are now
decided: 4a = full rotated-diamond parity; 5 = ephemeral (editor-local) pairing.
