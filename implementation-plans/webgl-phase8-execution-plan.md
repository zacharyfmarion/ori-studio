# Phase 8 — Execution plan: get WebGL to parity, then delete SVG

**Guiding principle:** confirm parity, cover it with tests, and decompose the code —
all *before* the irreversible deletion, so the risky step is the best-protected one. The
SVG surface stays intact through steps 1–2; step 3 is a surgical removal.

The **deletion inventory + cleanup catalog** (what exactly gets removed, the WebGL→SVG
umbilical, the architecture-cleanup list) lives in
[webgl-phase8-delete-svg.md](webgl-phase8-delete-svg.md). This doc is the **ordered
execution plan**.

> **Reorder — delete before finishing decompose (Zach, 2026-07-14).** Mid-Step-2 we
> found the panel is threaded with SVG-only dead-for-WebGL code (e.g.
> `computeCpMeasurementValue`, `diagnosticSectorPoint`, the selection-transform cluster),
> so every extraction pays an "is this SVG-only?" tax and sometimes preserves dead code.
> New order: **(2a)** bank the clean *pure* module extractions — `diagnostics/geometry`,
> `tools/predicates`, `measure` — **done**; **(2b) delete the SVG surface next** (was
> Step 3), which drops all the dead code so that **(2c) decomposing the remaining,
> all-keep-code panel** (tool-panel components, command handlers) is pure lift-and-shift.
> Safe because WebGL parity is signed off (Step 1). The SVG-DOM tests break on deletion
> and are retired then (their behavior is covered by the WebGL path + the pure modules).

> **Selection transform NOT ported (Zach, 2026-07-14).** Resize / rotate / flip of a
> selection are **SVG-only** and are **not** being ported to WebGL. Move-drag already
> works on WebGL and that is sufficient. So when the SVG surface is deleted (Step 3),
> resize / rotate / flip go away — an **accepted loss**, not a gap to close. (This
> removes the former "Step 1" entirely.)

Each step is its own set of commits and ends at a **Zach gate** (hands-on verification;
Claude makes it testable + fixes what Zach surfaces — no self-certification).

---

## Step 1 — Close the remaining WebGL-vs-SVG parity gaps

Get WebGL to "complete replacement" so the delete is safe.

- **Systematic audit:** walk every feature the SVG surface still provides and confirm the
  WebGL surface matches (or is a consciously-accepted difference).
- **Accepted losses on deletion** (confirm each is fine, do not port):
  - **Selection resize / rotate / flip** — SVG-only; move-drag stays on WebGL.
  - **Snap-target HUD** — the SVG target/label feedback; a plain snap ring already draws
    on WebGL.
  - **Draggable imported forms** — punted; imported forms render but stay static.
- **Resolve the non-editable / generated-CP path (open question O2):** verify whether
  `editableCp === null` (the SVG `GeneratedCreasePattern` read-only view) is still
  reachable in the CP workspace. If reachable → cover it on WebGL or scope it out of the
  edit surface; if legacy → confirm it can go.
- **Deferred tool queue** (Text, Reflect Over Line, Square Bisector mode C, Circle
  tangent + rest of Circle-apply) — already hidden/deferred; confirm none block deletion.
- **Gate:** Zach signs off "WebGL is a complete replacement (modulo the accepted losses)"
  against a written checklist. This is the hard gate before anything is deleted.

### Step 1 audit findings (2026-07-14)

Mapped every layer the SVG `EditableCreasePattern` renders + every interaction handler
against the WebGL surface.

**At parity (WebGL ✅):** grid, crease lines (+ select), points (+ select), circles (+
select), diagnostic segments + markers + LBL wedges, generated folded figures, imported
folded forms, operation frame, all command/tool previews (candidate segments, candidate
points, preview circles as rings), box-select marquee, and the full interaction set
(draw tools, box/lasso select, erase, move-drag, line-entity, lengthen).

**Accepted losses (deleted with SVG, confirmed not ported):**
- Selection resize / rotate / flip (move-drag stays).
- Snap-target HUD (a plain snap ring already draws on WebGL).
- Draggable imported forms (render but static).
- Vertex *selection* — vertices are derived; selection is being removed anyway (they
  still render as points).

**The one real gap — TEXT annotations. ✅ CLOSED (built + Zach validated).** WebGL now
renders + selects `crease_pattern.texts` via a DOM overlay: the canvas reports its
model→CSS affine (`onViewChange`) and `CpTextOverlay` projects each label to it, scaling
font with zoom (12px at 100%, matching the SVG); click toggles selection, gated to
selection mode so labels are click-through while drawing. Render + select only (creating
text is the still-deferred Text tool). The `onViewChange` report is a reusable
"position DOM over the GL canvas" primitive.

**O2 — non-editable / generated-CP path. RESOLVED (from code): live fallback, not dead
code.** `GeneratedCreasePattern` (read-only, `editableCp === null` + `project.creases`)
is reachable only as the **kernel-load-failure fallback**: on import, if a CP *parses*
into `project.creases` but *fails to load into the oristudio kernel*
(`loadOristudioCpDocumentFromText` throws → `oristudioCpRuntimeError` set,
`oristudioCpDocument` null; `projectSlice` import path ~613), the panel enters CP mode
and shows the parsed creases read-only with no editing tools. (Create-a-CP and the other
CP entries always set an editable doc.) Rare but real. **Step-3 decision (not a Step-1
blocker):** when the SVG is deleted, either (a) have the WebGL surface render the
read-only `project.creases` when `editableCp === null`, or (b) replace the fallback with
an explicit "couldn't load this CP" error state. Leaning (b) — a silent read-only view of
a CP the editor can't actually open is arguably worse than a clear error.

## Step 2 — Decompose the panel into focused modules + test each one

Extract the **renderer-agnostic keep code** out of the 7,960-line `CreasePatternPanel`
and **write focused unit tests for each module as it's extracted** — decompose and test
together (Zach's call, 2026-07-14). Extracting a module and then testing it directly is
more natural than porting tests to modules that don't exist yet. The refactor is guarded
throughout by the **existing suite** (the 74 SVG-DOM panel tests + the current pure tests)
since the SVG surface isn't deleted until Step 3; the redundant SVG-DOM tests are retired
there.

Extract (each with its own tests):
- `diagnostics/geometry.ts` — `buildCpDiagnostic{Markers,Strokes,Wedges,MarkerHits}` +
  tone/shape/LBL helpers. (Currently only exercised indirectly via the panel DOM.)
- `tools/predicates.ts` — the `is*Operation` family + `shouldPreferPointSnapForStep`.
- `toolPanel/` — `CpContextToolPanel` + all `*ToolOption` components + `CpLineTypeToolbar`
  + `FoldedFigureMenuButton`.
- `commands.ts` — `buildCpCommandPayload`, `handleWebglToolCommit/PreviewInput`, measure
  slots.
- Text overlay + its projection already live in `cp-workspace/` (`CpTextOverlay`).
- Remaining `CreasePatternPanel` = state/orchestration + WebGL wiring + the (now isolated)
  SVG block.

Also decompose *isolates* the SVG surface as a discrete remaining block, so Step 3 is a
clean removal rather than a decompose-then-delete of the same lines.

- **Gate:** existing suite still green; each extracted module has focused tests; module
  boundaries reviewed.

### Step 2 progress

- ✅ **`cp-workspace/diagnostics/geometry.ts`** extracted (commit `d5bb7395`): the
  `buildCpDiagnostic{Markers,Strokes,Wedges,MarkerHits}` builders + style/tone/LBL/bounds
  helpers, with **14 new focused unit tests** (coverage this logic never had —
  previously only exercised via the SVG DOM). Behavior-preserving. The SVG-only
  `diagnosticSectorPoint` + focus constants stay in the panel (deleted with SVG in Step 3),
  importing the shared helpers back.
- ⬜ Remaining: `tools/predicates.ts` (the `is*Operation` family — scattered, interleaved
  with non-predicate geometry helpers that stay), `toolPanel/` (the context-tool-panel +
  `*ToolOption` components + `FoldedFigureMenuButton`), `commands.ts`.

**⚠️ Finding — the existing suite is not green at baseline.** `CreasePatternPanel.test.tsx`
is **9 failed / 64 passed**, *identical before and after* the extraction (verified by
stashing). The 9 are **stale SVG-DOM tests for tools hidden during this session's tool
sweep** (e.g. asserting a `SelectLineIntersecting` toolbar button that no longer renders
after "Select/Deselect Overlapping Lines" was hidden), not a regression. They're exactly
the SVG-DOM tests Step 3 retires. The 64 passing tests + the new module tests are the real
safety net. **These 9 should be updated/retired** (in Step 3's SVG-test cleanup, or a quick
pass sooner) so the gate's "green suite" is meaningful.

## Step 3 — Delete the SVG surface + finalize (the surgical removal)

Now that WebGL is proven, tested, and the keep-code is modular, remove SVG.

1. **Sever the umbilical** — seed the WebGL camera from `contentBounds` only, delete
   `cp-workspace/svgViewBridge.ts` + `sampleView`, drop the `svgRef` / `svgToModel` props.
2. **Make WebGL unconditional** — delete `store/cpRendererStore.ts` + every
   `cpRendererMode` branch (`data-webgl-hidden`, toolbar/shortcut forks, conditional
   mount).
3. **Delete the SVG render components** (§A1 of the scope doc — including the SVG
   `SelectionTransformBox` / `SelectionBoxPreview` and its resize/rotate/flip handlers),
   **RZPP from the edit path** (§A2 — dependency stays for `DesignPanel`), and the **SVG
   interaction path** (§A3).
4. **Remove vertex selection end-to-end** — store (`types.ts`, `creasePatternSlice.ts`,
   `projectSlice.ts`), the selection type, and its tests.
5. **Collapse duplicate snap/first-pick** (SVG copies die; WebGL is the single source) and
   **coordinate cleanup** (keep `modelToSvg` as a pure helper; delete `svgToModel` +
   viewBox/decoration-scale machinery).
6. **Gate:** full manual pass; parity holds; review the net LOC reduction + final module
   structure — confirm the "maintainability win," not just a passing app.

### Step 3 progress (2026-07-14)

- ✅ **3.1 umbilical severed** + **3.2 WebGL unconditional** — landed in prior commits
  (`svgViewBridge.ts`/`sampleView` deleted, camera seeds from `contentBounds`,
  `cpRendererMode` gone, WebGL mounts unconditionally, SVG-DOM panel test retired).
- ✅ **3.3 SVG render surface + interaction path deleted** — in
  `CreasePatternPanel.tsx`: the `<TransformWrapper>` SVG surface, all SVG render
  components (`CreaseLines/Points/Circles/Texts/Vertices`, `OrieditaInfiniteGrid`,
  `Generated*`/`Imported*FoldedForm*` layers, `DiagnosticPointMarker`,
  `DiagnosticLittleBigLittleMarker`, `SelectionTransformBox`, `SelectionBoxPreview`,
  the folded-SVG render helpers), the SVG interaction handlers (`resolveEditable*`,
  `updateSelection{Move,Resize,Rotation}Preview`, `handleFoldedFigurePointerDown`,
  `updateEditablePointerStatus`, `eraseCreaseAtModelPoint`, `eventToEditable{Svg,Model}Point`,
  the pointer event-target helpers), and RZPP from the edit path. The `foldFrame*` /
  `foldedFormPointToSvg` / `isRenderable*` helpers are **kept** — shared by the (live)
  `cpImportedFoldedFormsGeometry` WebGL memo.
- ✅ **Vestigial SVG state removed** — the write-only `cpCommandPreview` state + its
  now-dead preview-fetch `useEffect` (WebGL previews come through `handleWebglToolPreviewInput`;
  the kernel `previewCommand` is a side-effect-free fetch, so discarding it changes nothing),
  the always-null `cursorModelPoint` (setter never fired; simplified `liveCommandPreviewPoints`
  to `snapTarget?.point` and dropped the dead cursor-coord HUD readout), and the whole
  SVG-only live-preview chain (`liveCommandPreviewPoints`, `activeCpInputMode`,
  `canPreviewFromSelection`, `activeActionInputMode`).
- **Result:** `CreasePatternPanel.tsx` **7,530 → 3,845 lines** (−3,685); tsc + eslint clean,
  112 `cp-workspace` module tests green. **⚠️ Human test still owed (Zach):** command
  previews / snap HUD on the WebGL surface, since vestigial preview plumbing was removed.
- ✅ **3.4 vertex selection removed end-to-end** (commit `7fc8b622`). The SVG surface was
  the only thing that could create a vertex selection; with it gone,
  `oristudioCpSelection.vertices` was permanently empty. Dropped the `vertices` field
  (`OristudioCpSelection` + EMPTY + size), `toggleOristudioCpVertexSelection` (action +
  type), the vertices filter/count in `projectSlice`/`capabilities`,
  `oristudioCpSelectedVertexCount` (the delete gate `hasSelectedCpPoints` collapses to the
  point count — behavior identical since vertex count was always 0), and the vertex branch
  in `menuActions`. Vertex *geometry* (`getCpVertices`/`CpVertex`/`cpVertexId`) stays —
  still used by snapping + derived-point delete. Tests updated; suites green.
- ✅ **Stale folded-figure `display_mark` tests fixed** (commit `66334582`) — branch commit
  `72ac6654` intentionally set the render-snapshot `display_mark` to false (the rotation
  marker inflated the move hit-box); three store tests still asserted `true`.

**⚠️ Two PRE-EXISTING test failures flagged for Zach (NOT from this work).**
`oristudioCpActions.test.ts` ("orders rail actions like Oriedita") and
`oristudioCpToolInstructions.test.ts` ("resolves rail aliases") fail on the pre-Step-3.4
baseline — untouched by any deletion commit. Cause: the rail no longer exposes **Select
Overlapping Lines / Polygon Select / Deselect Overlapping Lines / Polygon Deselect**
(`cpRailActions()` filters to `placement: 'left-rail'`, and these four no longer have it).
**Left unfixed deliberately:** unlike the aux-line hide (explicit `placement:
'hidden-ui-only'` + a "Revisit at end" comment), these four carry no hidden marker, so
their rail-absence is ambiguous — could be an intentional hide or an accidental regression
from the registry refactor. Editing the tests to match current output would mask a real
bug if it's the latter. Needs Zach's intent (hide → update tests; regression → restore
`placement`).

- ⬜ **Remaining:** 3.5 coordinate cleanup (`svgToModel` still used by `clientToModel`, so
  it stays; viewBox/decoration-scale machinery already gone — largely a no-op now). Then
  **Step 2c** decompose the remaining all-keep panel into `toolPanel/` + `commands.ts`
  (the last structural piece — pure lift-and-shift now that the SVG code is gone).

---

## Cross-cutting notes

- **Reference stays live through steps 1–2.** Nothing in the SVG surface is deleted until
  Step 3, so the decompose always has a working oracle + fallback (the flag still lets you
  A/B until Step 3.2).
- **Open decisions (from the scope doc)** are resolved inside the steps: O1 (selection
  transform) → not ported, accepted loss; O2 (generated-CP path) → Step 1; O3 (test
  appetite) → Step 2.
- **Sequencing rationale:** parity + tests + modular keep-code all land *before* the
  irreversible deletion, so the risky step is the best-protected one.
