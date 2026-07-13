# WebGL CP Tools — Per-Operation Input Spec

Status: **draft for review** — no code changes until approved.
Reference implementation: `apps/web/src/components/panels/CreasePatternPanel.tsx` (the live SVG surface).
Target: `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` + `tools/`.

---

## 1. Why this document exists

Phase 5 modelled every construction tool as one uniform "step sequence" and tried to
tell the steps apart from their **prompt text** (`cpToolStepKind`: does the step say
"crease"/"line" vs "point"/"vertex"?). That is wrong, and it produced two concrete bugs:

- `PerpendicularDraw` ("Pick target point | Pick base crease") threw *"expected at least
  2 resolved point(s)"* — we modelled the crease step as a line-id pick that emitted no
  point, but the kernel wants **two points** (the second snapped onto a crease).
- `LengthenCreaseSameColor` ("Select line to extend | Select target line") started
  dropping **a point onto a line** — but this tool genuinely wants **two line ids** and
  **no points**.

Both tools have step text mentioning a "line"/"crease". **Text cannot distinguish them.**
The SVG never uses text to pick the input model. It uses:

1. **Explicit per-operation predicates** (`isLengthenCreaseOperation`,
   `isReflectSelectionOperation`, …) to choose the *input model*, and
2. **`shouldPreferPointSnapForStep`** (keyword-based, plus two hard-coded operation
   overrides) *only* to choose the per-step **snap mode** *within* a point sequence.

So the fix is not "classify better from text" — it's "replicate the SVG's per-operation
dispatch." This doc enumerates that dispatch, validates every one of the 87 tools against
the SVG branch that handles it, and defines the routing the WebGL surface must adopt.

---

## 2. The SVG dispatch order (source of truth)

`handleEditableToolPointerDown` (CreasePatternPanel.tsx ~2810–3351) checks, in this exact
order. First match wins:

| # | Guard | Operations | Action |
|---|-------|-----------|--------|
| 0 | folded figure hit | any | figure drag (not a tool) |
| 1 | `event.button === 2` | any | **right-erase** drag box |
| 2 | space / pan guards | any | bail (pan) |
| 3 | `isSelectionCircleApplyOperation` + 1 circle selected | tangent family | execute `{circle_ids, points:[pt]}` |
| 4 | `stepCount === 0` | select-apply tools | **return** (no canvas interaction) |
| 5 | `isLineClickSelectionOperation \|\| isCreaseToggleMvClickTool` + line hit | CreaseSelect/Unselect/ToggleMv | **return** → line handled by `handleEditableLineClick` |
| 6 | `isReflectSelectionOperation` + 0 points + line hit | DrawCreaseSymmetric | **return** → line's endpoints become the axis |
| 7 | `isLengthenCreaseOperation` | LengthenCrease(SameColor) | line hit → return (line click); empty → swallow (no point) |
| 8 | `isSquareBisectorOperation` (two branches) | SquareBisector | state machine w/ `pendingSquareBisectorLineIds` |
| 9 | `allowsDirectEntitySelection` + entity hit | CreaseSelect | **return** → selection |
| 10 | `isTextAnnotationOperation` | Text | create/edit DOM text at point |
| 11 | `isVariablePointSequenceOperation` | VoronoiCreate | append point, advance (variable count) |
| 12 | `activeCpInputMode === 'drag-line'` | 4 draw tools | start line drag |
| 13 | `activeCpInputMode === 'drag-box'` | erase + select/unselect/toggle | start box drag |
| 14 | `activeCpInputMode === 'drag-path'` | 6 path tools | start path drag |
| 15 | *fallthrough* | **all remaining point-sequence tools** | `resolveEditableToolPoint(evt, shouldPreferPointSnapForStep(...))`, append, at `stepCount` commit `{points, line_ids: selection.lines, circle_ids: selection.circles}` |

Line clicks that "return" at #5/#6/#7/#9 are then handled by **`handleEditableLineClick`**,
which has its own per-operation branches (reflect → axis endpoints; lengthen →
`pendingLengthenLineId` then `{line_ids:[a,b]}`; select/unselect/toggle → mutate selection).

**Key invariant #15 encodes:** every generic point-sequence step emits a *point*, even when
the prompt says "crease" — the snap merely lands that point *on* the crease
(`shouldPreferPointSnapForStep === false` ⇒ `nearestCpSnapTarget` with line snapping). The
kernel resolves which crease from the point. Line **ids** only ever appear for the
predicate-selected line-entity tools (#5–#8), never for #15.

---

## 3. Input-model taxonomy (10 models)

| Model | Payload to kernel | Interaction | Preview |
|-------|-------------------|-------------|---------|
| **A. DRAG-LINE** | `points:[a,b]` | press→drag→release, one segment | local segment |
| **B. DRAG-BOX** | box → selection/erase | press→drag rectangle→release | local rect |
| **C. DRAG-PATH** | `points:[…path]` | press→drag freehand→release | local polyline |
| **D. POINT-SEQUENCE** | `points:[…N]` (+ `line_ids`/`circle_ids` from current selection) | N discrete clicks, per-step snap | kernel preview from live points |
| **E. LINE-ENTITY-PICK** | `line_ids:[a,b]`, **no points** | click N creases, highlight each | highlight picked creases |
| **F. LINE-CLICK-MUTATE** | mutates selection set | click crease toggles/(de)selects; **also** box-drag (hybrid B) | selection styling |
| **G. AXIS-FROM-LINE** | `points:[axis.a, axis.b, …]` | click a crease (endpoints→axis) *or* place 2 points | kernel preview |
| **H. SELECTION-CIRCLE-APPLY** | `circle_ids` (+ `points:[pt]` for tangent) | select circle(s), then click a point / apply | kernel preview |
| **I. SELECT-APPLY** | operates on current selection | no canvas interaction — panel Apply button | none |
| **J. BESPOKE** | per-tool | SquareBisector state machine · Voronoi variable points · Text DOM | per-tool |

---

## 4. Per-operation table (all 87, validated)

Each row cites the SVG guard (§2 #) that proves the model. `snap` column = per-step snap
mode for POINT-SEQUENCE (P = point snap, C = crease/line snap), from
`shouldPreferPointSnapForStep`.

### A. DRAG-LINE (4) — SVG #12
| Operation | Steps |
|---|---|
| DrawCreaseFree | Drag crease endpoint |
| DrawCreaseRestricted | Drag between existing points (restricted snap) |
| CreaseMakeMv | Drag a guide line along the creases |
| CreasesAlternateMv | Drag a guide line across the crossings |

### B. DRAG-BOX (erase) (1) — SVG #13
| Operation | Steps |
|---|---|
| LineSegmentDelete | Click a crease **or** drag a box to erase |

### C. DRAG-PATH (6) — SVG #14
| Operation |
|---|
| OperationFrameCreate · FlatFoldableCheck · SelectPolygon · UnselectPolygon · SelectLasso · UnselectLasso |

### D. POINT-SEQUENCE (fallthrough #15) — the large bucket
Payload `{points, line_ids: selection.lines, circle_ids: selection.circles}`. Snap per step:

| Operation | #pts | snap-per-step |
|---|---|---|
| DrawPoint | 1 | P |
| DeletePoint | 1 | P |
| VertexDeleteOnCrease | 1 | P |
| LineSegmentDivision | 1 | C |
| LineSegmentRatioSet | 1 | C |
| CircleDraw / CircleDrawFree | 2 | P,P |
| CircleDrawConcentric | 2 | P,P |
| ContinuousSymmetricDraw | 2 | P,P |
| CreaseCopy / CreaseMove | 2 | P,P |
| DisplayLengthBetweenPoints1/2 | 2 | P,P |
| DoubleSymmetricDraw | 2 | P,P *(operation override → P)* |
| DrawBirdBase / DrawBlintz / DrawDoveBase / DrawFishBase / DrawFrogBase | 2 | P,P |
| DrawCreaseAngleRestricted5 | 2 | P,P |
| FishBoneDraw | 2 | P,P |
| FoldableLineDraw / FoldableLineInput | 2 | P,P |
| ParallelDrawWidth | 2 | C,P (source crease, width point) |
| **PerpendicularDraw** | 2 | P,C (target point, base **crease** → point-on-crease) |
| PolygonSetNoCorners | 2 | P,P |
| SelectLineIntersecting / UnselectLineIntersecting | 2 | P,P |
| SymmetricDraw | 2 | C,C (source crease, mirror crease) |
| VertexMakeAngularlyFlatFoldable | 2 | P,C |
| AngleSystem | 3 | P,P,C |
| CircleDrawSeparate | 3 | P,P,P |
| CircleDrawThreePoint | 3 | P,P,P |
| DisplayAngleBetweenThreePoints1/2/3 | 3 | P,P,P |
| DrawCreaseAngleRestricted / …3 | 3 | P,P,P |
| Inward | 3 | P,P,P |
| ParallelDraw | 3 | P,C,C |
| Axiom5 / Axiom7 | 4 | mixed P/C |
| CreaseCopy4p / CreaseMove4p | 4 | P,P,P,P |

*(snap column above is derived from the keyword rule; **each row must be spot-checked
against the live step text during implementation** — that is the "validate every tool"
pass §6.)*

### E. LINE-ENTITY-PICK (2) — SVG #7 + `handleEditableLineClick`
| Operation | Steps | Payload |
|---|---|---|
| LengthenCrease | Select line to extend / Select target line | `{line_ids:[a,b]}` |
| LengthenCreaseSameColor | Select line to extend / Select target line | `{line_ids:[a,b]}` |

### F. LINE-CLICK-MUTATE (3, hybrid with DRAG-BOX) — SVG #5 + #13
| Operation | Line click | Box drag |
|---|---|---|
| CreaseSelect | select crease (also #9 entity) | box select |
| CreaseUnselect | unselect crease | box unselect |
| CreaseToggleMv | flip M/V of crease | box flip |

### G. AXIS-FROM-LINE (1) — SVG #6
| Operation | Steps |
|---|---|
| DrawCreaseSymmetric | Select 2 points **or** a line / Pick reflection line end |

### H. SELECTION-CIRCLE-APPLY (4) — SVG #3
| Operation | Extra point? |
|---|---|
| CircleDrawTangentLine | yes — click a point after selecting circle |
| CircleDrawInverted | no |
| CircleDrawConcentricSelect | no |
| CircleDrawConcentricTwoCircleSelect | no |

### I. SELECT-APPLY, no toolSteps (18) — SVG #4
| Operation |
|---|
| Check1 · Check2 · Check3 · Check4 · CheckCamv · Fix1 · Fix2 · FixInaccurate · CreaseMakeMountain · CreaseMakeValley · CreaseMakeAux · CreaseMakeEdge · CreaseAdvanceType · CreaseSetLineColor · DeleteLineTypeSelect · ReplaceLineTypeSelect · CircleChangeColor · OrganizeCircles |

### J. BESPOKE (3)
| Operation | Model |
|---|---|
| SquareBisector | #8 state machine: `pendingSquareBisectorLineIds` + points; "2 segments or 3 points" |
| VoronoiCreate | #11 variable-length point sequence (click seeds, explicit finish) |
| Text | #10 DOM text create/edit/drag |

**Total: 4+1+6 + ~43 + 2 + 3 + 1 + 4 + 18 + 3 = 87 ✓**

---

## 5. WebGL surface — current state vs. spec (gap analysis)

Two independent axes per tool: **Built** (routed to a WebGL engine + unit-tested)
and **Validated** (Zach personally exercised *that specific tool* in-app vs. SVG).
Validation is per-tool — never inferred from a sibling in the same model. The §8
checklist is the per-tool validation tracker; a row is ticked only when Zach
confirms that exact tool.

| Model | Count | Built | Validated (Zach) |
|---|---|---|---|
| D POINT-SEQUENCE | 45 | yes | only a handful (PerpendicularDraw, DrawCreaseAngleRestricted, + snap/highlight behavior) |
| E LINE-ENTITY-PICK | 2 | yes | LengthenCreaseSameColor ("E") |
| A/B/C DRAG-* | 11 | yes | none yet |
| I SELECT-APPLY | 18 | n/a (Apply button, renderer-agnostic) | none yet |
| F LINE-CLICK-MUTATE | 3 | partial (box works; click via panel) | none yet |
| G AXIS-FROM-LINE | 1 | no | — |
| H SELECTION-CIRCLE-APPLY | 4 | no | — |
| J BESPOKE | 3 | no | — |

**Built/functional: ~76** of 89. **Per-tool validated: ~5.** The outstanding work is
therefore two-fold: (1) build the remaining 11 (F/G/H/J), and (2) a **per-tool
validation sweep of all 89** — every single tool, tracked in §8.

---

## 6. Implementation plan

### 6.1 Introduce an explicit per-operation input-model registry
Replace **all** text classification with a table keyed by `operationId`. Single source,
mirrors §4. Each entry: `{ model: 'drag-line'|'drag-box'|'drag-path'|'point-sequence'|
'line-entity'|'line-click-mutate'|'axis-from-line'|'circle-apply'|'select-apply'|
'bespoke', pointCount?, snapPerStep?, lineCount? }`.

**`snapPerStep` is an explicit hand-authored array — never derived from prompt text.**
The SVG's `shouldPreferPointSnapForStep` is keyword-based (it substring-matches the
human-readable step prompt: `'crease'|'line'` → line snap, `'point'|'vertex'|…` → point
snap, plus two hard-coded operation overrides for the tools where that heuristic guessed
wrong). That is the *same fragile text-matching that caused the Phase-5 bugs*, and we do
not reuse or copy it:
- **Do not import** from `CreasePatternPanel.tsx` — the migration deletes that file, so
  any import blocks deletion.
- **Do not copy** the heuristic — it propagates the latent bug into fresh code.

Instead, author `snapPerStep` explicitly per tool during the §6.3 validation pass, and
validate each step against **what the kernel operation actually expects for that
argument** (free point / point-on-crease / vertex) — the prompt string is only a lossy
proxy for that. Example:

```ts
PerpendicularDraw: { model: 'point-sequence', snapPerStep: ['point', 'crease'] },
AngleSystem:       { model: 'point-sequence', snapPerStep: ['point', 'point', 'crease'] },
LengthenCrease:    { model: 'line-entity',    lineCount: 2 },
DrawCreaseSymmetric: { model: 'axis-from-line', snapPerStep: ['point', 'point'] }, // no override needed — honest array
```

No runtime string inspection anywhere. The registry is the single validated source.

### 6.2 Route by model — dedicated pure engine per model (no panel coupling)
**Decision:** every model gets its own pure `ToolEngine` in `cp-workspace/tools/`. The
WebGL surface must **not** call into `CreasePatternPanel.tsx`, so the panel can be deleted
at the end of the migration with zero WebGL dependencies on it. This is more code than
forwarding, but it fully decouples and is unit-testable (§6.5).

Engines (all pure reducers over `ToolInput` → `ToolOutput`, like the existing
`stepSequenceTool`):

| Engine | Models served | Commit payload | State |
|---|---|---|---|
| `stepSequenceTool` *(exists)* | **point-sequence** | `{points}` (surface adds selection `line_ids`/`circle_ids`) | collected points |
| `linePickTool` *(new)* | **line-entity** | `{lineIds:[…N]}`, no points | picked line ids + hover highlight; ignores empty-canvas clicks (SVG #7 swallow) |
| `lineClickMutateTool` *(new)* | **line-click-mutate** | selection delta (select/unselect/toggle) + box-drag hybrid | pending box |
| `axisFromLineTool` *(new)* | **axis-from-line** | `{points:[axis.a, axis.b, …]}` | either a line pick (→ its 2 endpoints) or 2 placed points, then remaining point steps |
| `circleApplyTool` *(new)* | **circle-apply** | `{circle_ids}` (+ `{points:[pt]}` for tangent) | selected circle(s), optional point |
| `dragTool` *(exists: feedTool)* | **drag-line / drag-box / drag-path** | `{points}` | live drag path |
| `squareBisectorTool` *(new, bespoke)* | SquareBisector | mixed `{lineIds}`/`{points}` per the state machine | `pendingSquareBisectorLineIds` + points |
| `voronoiTool` *(new, bespoke)* | VoronoiCreate | `{points:[…variable]}` | growing seed list + explicit finish |
| Text *(bespoke, not a pure engine)* | Text | DOM text create/edit/drag | handled as a surface overlay, not a `ToolEngine` |
| *(none)* | **select-apply** | operates on current selection via Apply button | no canvas interaction |

The surface's pointer handlers pick the engine from the §6.1 registry `model` field. The
registry is the only place operation identity meets interaction model.

### 6.3 The validation pass (the "look at every tool in sequence" work)
For **each** of the 87 rows in the §8 checklist, in table order:
1. Open the SVG branch that handles it (cite the line number in the `SVG ref` column).
2. Confirm the exact payload it sends (`points` vs `line_ids` vs selection).
3. For point tools, confirm the per-step snap by reading **what the kernel op wants for
   that argument** (free point / point-on-crease / vertex) — *not* the prompt string —
   and record it as the explicit `snapPerStep` array (§6.1).
4. Tick the `✔` box and fill `SVG ref` + `notes`.
5. Only after the row is ticked do we wire it.

No tool ships on assumption; every tool is checked against its hard-coded SVG branch,
even where it "seems obvious."

### 6.5 Testing strategy (derisking the reimplementation)
Because we're reimplementing rather than forwarding, the risk is **behavioural drift** from
the validated SVG. Four layers guard against it, cheapest first:

1. **Per-engine unit tests** (pure reducer, à la `stepSequenceTool.test.ts`). Feed a
   `ToolInput` sequence, assert the emitted `ToolCommit` (points vs `lineIds`, count,
   `awaitingPoint`, highlight ids) and intermediate state. Fast, deterministic, no DOM.
   Every new engine (`linePickTool`, `lineClickMutateTool`, `axisFromLineTool`,
   `circleApplyTool`, `squareBisectorTool`, `voronoiTool`) ships with one.
2. **Registry invariant test.** A single table-driven test over all 87 operationIds
   asserting: every op has exactly one registry entry; `model` is valid; `snapPerStep`
   length equals the op's `toolSteps` length for point/axis models; `lineCount`/`pointCount`
   present where the model requires. This catches the *entire class* of "step count drifted
   from the prompt" bug automatically, forever.
3. **Kernel round-trip tests** (the direct antidote to the Phase-5 bug — *"expected at
   least 2 resolved point(s)"* was a payload the kernel rejected). For a representative
   fixture CP, drive each engine to its commit and push the payload through
   `previewOristudioCpCommand` + `executeOristudioCpCommand`; assert **no error** and the
   expected geometry delta. Run for: every point-sequence *snap pattern* at least once
   (P-only, C-only, mixed like PerpendicularDraw `['point','crease']`), both line-entity
   tools, each bespoke tool, and a sample of drag tools. If a `snapPerStep` entry is wrong,
   the point misses its crease and the kernel rejects — the test goes red.
4. **Author manual gate** (per [[author-owns-phase-verification]]). Each numbered §6.4
   step is tested in-browser by Zach against `main`/SVG parity before the next begins;
   Claude does not self-certify a gate.

Layer 3 is the important one: it validates our hand-authored registry data against the
*real* arbiter (the kernel), so a wrong snap mode or payload shape cannot pass silently.

### 6.4 Order of work
1. Registry + line-pick engine (unblocks E — the visible regression).
2. Validate + wire all POINT-SEQUENCE tools (D) — the bulk; confirm snap modes.
3. Verify DRAG tools (A/B/C).
4. LINE-CLICK-MUTATE hybrid (F).
5. AXIS-FROM-LINE (G), CIRCLE-APPLY (H).
6. BESPOKE (J): SquareBisector, Voronoi, Text.
7. SELECT-APPLY (I): confirm nothing on canvas.

Each numbered step is a gate you test before the next begins.

---

## 7. Decisions (resolved)
1. **Dedicated pure engine for every model** (F/G/H/J included), no calls into
   `CreasePatternPanel.tsx`, so the panel deletes cleanly at migration end. Derisked by
   the four-layer testing strategy in §6.5 (unit + registry invariant + kernel round-trip
   + author manual gate).
2. **The per-row validation checklist lives in this doc** — §8 below.

---

## 8. Per-operation validation checklist

Ground rules: work top-to-bottom within each model group. Tick `✔` (⬜→✅) only after the
row's SVG branch is read, its payload confirmed, and (point/axis models) its `snapPerStep`
authored from the kernel argument types. Put the SVG line number in `SVG ref`.

### Sweep log (per-tool validation, palette order)

Live results as Zach validates each tool in-app. Fixes made during the sweep are noted.

The **"Zach said"** column is Zach's *verbatim* report for that tool (typos preserved) — the ground-truth issue statement, kept separate from my interpretation in "Result / finding" so the two never get conflated again.

| Palette name | Op | Zach said (verbatim) | Result / finding |
|---|---|---|---|
| Line | DrawCreaseFree | "Yep, confirmed works" | ✅ |
| Grid Restricted Line | DrawCreaseRestricted | "This one doesn't work as expected - in oriedita it rejects drawing the line if it doesn't snap to grid points. But in Ori Studio it ddraws the line regardless...making its behavior basically identical to the first tool. Can you root cause and fix this. It was likely an existing bug - i never went tool by tool and verified functionality wit hthe SVG mode" | ✅ — **fixed**: restricted draw now rejects unsnapped start/release (`resolveDrawPoint` reports `snapped`; was drawing like plain Line) |
| Rabbit Ear | Inward | "rabbit ear works great!" | ✅ |
| Flat Foldable Line | VertexMakeAngularlyFlatFoldable | "for flat foldable line 1. There are little dots on the end of each option in oriedita which look nicer, can you add those 2. In oriedita, if you click on one of the lines, it hides the other options. In ori studio if you click on one of the lines, you get this error:" | ❌ **candidate-preview gap** — WebGL preview drops kernel `points` (no candidate dots) and can't snap-pick a candidate crease → clicking a candidate errors (`DrawPoint: nearest line outside selection distance`). Shared cause; batch-fix after sweep. |
| Extend Line | LengthenCrease | "For lengthen crease, clicking a line to select works, but in oriedita you can also draw a line that intersects with the line you are selecting to select it, which ori studio does not allow for" (then: "mark it as X and we can come back to it at the end") | ❌ **Oriedita-parity** — click-to-select + extend works, but Oriedita also lets you *drag a line across* a crease to select it; Ori Studio never ported this (missing in SVG too). Net-new feature; deferred to end. |
| Perpendicular Line | PerpendicularDraw | "Yep, perpendicular line works perfectly" | ✅ |
| Angle Restricted Line | DrawCreaseAngleRestricted5 | "yep, good" | ✅ |
| Offset Restricted Line | AngleSystem | "honestly i dont even see that one in the oriedita UI - can we just hide that one for now in the UI (so no button in the left toolbar) and mark as skipped" | ⏭️ **hidden** — not in Oriedita's UI; rail button removed (`placement: 'hidden-ui-only'`). Revisit at end. |
| Converging Lines | DrawCreaseAngleRestricted | "Okay yeah this one isn't quite right - when i try to select a line, it gets interpreted as the first point of two points. In oriedita you just select a line, no option to select two points" | ❌ **candidate-preview + wrong model** — Oriedita: *select a crease line → extension lines appear → select intersection*. Port modeled it as a 3-point sequence (`toolSteps` don't even match its own instructions text). Needs re-model to line-select + candidate-intersection pick. Part of the candidate batch. (Earlier "highlight works" was incomplete — model is wrong.) |
| Flat Foldable Line (free) | FoldableLineDraw | "This one should also be skipped and hidden in the UI" | ⏭️ **hidden** — not in Oriedita's UI (`placement: 'hidden-ui-only'`). Revisit at end. |
| Flat Foldable Line (extend) | FoldableLineInput | "hide" | ⏭️ **hidden** — not in Oriedita's UI (`placement: 'hidden-ui-only'`). Revisit at end. |
| Parallel Line | ParallelDraw | "yep works well" | ✅ |
| Mirror Line | SymmetricDraw | "Mirror line doesn't properly snap to points if im trying to click on a vertex, im only able to select lines" | ✅ **dual-mode (Zach validated).** Oriedita has two modes: *(1) 3 points ABC → mirror seg AB over line BC*, *(2) 2 lines AB → mirror A over B*. Only mode 2 was ported; point mode was unreachable (registry hardcoded `pointCount:2, ['crease','crease']`, and crease-snap stole every click onto a line). **Fix ("first click decides"):** Kernel — `symmetric_draw_lines` helper branches on point count (≥3 → `source=AB, mirror=BC` point mode; 2 → nearest-crease line mode), wired into execute + preview; both covered by new command-level tests (`construction_operations.rs`). Frontend — `webglActiveTool` flags SymmetricDraw `dualMirror`; the canvas sequence engine defers step kinds to `resolveMirrorFirstPick` on first press (vertex/point → 3 point-snap steps; bare crease → 2 crease-snap steps). Vertex-priority scoped to *this tool's* first pick — the shared `nearestCpSnapTarget` is untouched (line-preferred by design, locked by 2 viewport tests). |
| Parallel Alternating Lines | FishBoneDraw | "yep works great" | ✅ |
| Reflect Through Lines | ContinuousSymmetricDraw | "yep works great" | ✅ |
| Reflect Over Line | DoubleSymmetricDraw | "Seeing some differences - it looks like if lines incident to the endpoints are not reflected in Oriedita but they are in ori studio...or maybe its something else but it definitely behaves differently - can you check to see if its a kernel bug?" | ⚠️ **misdiagnosed — re-diagnose needed.** Prior claim ("Rust accepts L-shapes Oriedita rejects") is **wrong**: reading the vendored source `MouseHandlerDoubleSymmetricDraw.java`, Oriedita's `validIntersections` accepts the exact same six the Rust `is_double_symmetric_intersection` does (L-shapes 21–24 + T-shapes 25–26), and the mutation logic matches too. So the observed "differences" are NOT this filter. Real candidates: the shared intersection-classification primitive (`determine_line_segment_intersection_sweet_with_tolerances`) or `extend_to_intersection_point` diverging from Oriedita. Needs re-observation of the actual difference before any fix. |
| Equally Divided Line | LineSegmentDivision | "This one is broken - it should work like the line too - clicking and dragging to draw a line that is broken up into n segments. But right now it works by selecting an existing line and dividing it" | ❌ **wrong model + kernel** — Oriedita: *drag to draw a new line* split into N segments (like Line). Port + kernel only *divide an existing* segment (`required_or_nearest_line_segment` → `divide_segment_by_count`). Needs drag-line model + kernel op accepting 2 drawn points → create+divide. Same for LineSegmentRatioSet. |
| Divided Line (ratio) | LineSegmentRatioSet | "yep same issue" | ❌ same as Equally Divided Line (drag-draw + kernel). |
| Regular Polygon | PolygonSetNoCorners | "okay yeah regular polygon also isn't snapping rpoperly to vertices" (then: "yep works great") | ✅ |
| Axiom 5 | Axiom5 | "can you hide that and axiom 7" | ⏭️ **hidden** — not in Oriedita UI. |
| Axiom 7 | Axiom7 | "can you hide that and axiom 7" | ⏭️ **hidden** — not in Oriedita UI. |
| Draw point | DrawPoint | "yep it works" | ✅ |
| Draw auxiliary line | (aux action) | "can you hide aux line, not just disable it." | ⏭️ **hidden** — kernel not implemented; rail button removed. |
| Eraser | LineSegmentDelete | "For line segment delete, it works great" | ✅ (click + box + right-drag) |
| Delete Point | DeletePoint | "delete point works, delete any vertex works too" | ✅ |
| Delete any Vertex | VertexDeleteOnCrease | "delete point works, delete any vertex works too" | ✅ |
| Delete Coincident Lines | CreaseDeleteOverlapping | "nope, doesn't appear to work - im drawing a line through another line but that line is not deleted" (then: "actually nvm i misunderstood, if i draw directly on top of the line it works") | ✅ |
| Delete Overlapping Lines | CreaseDeleteIntersecting | "yep works" | ✅ |
| Angle restricted 3 crease | DrawCreaseAngleRestricted3 | "can you hide both tools in the contstruct section and the section itself in th etoolbar" | ⏭️ **hidden** — not in Oriedita UI; empties the Construct section (header auto-drops). |
| Parallel draw by width | ParallelDrawWidth | "can you hide both tools in the contstruct section and the section itself in th etoolbar" | ⏭️ **hidden** — not in Oriedita UI. |
| Reflect selection over line | DrawCreaseSymmetric | "Reflect isn't right - it should work by selecting two points and it reflects the selection over that line, but instead of only reflects over a selected line" (then: "NIce works great!") | ✅ — plain 2-point axis; line-click shortcut removed. |
| Move selected creases | CreaseMove | "confirmed that all 4 copy and move tools wrok properly." | ✅ |
| Copy selected creases | CreaseCopy | "confirmed that all 4 copy and move tools wrok properly." | ✅ |
| Move by four points | CreaseMove4p | "confirmed that all 4 copy and move tools wrok properly." | ✅ |
| Operation frame | OperationFrameCreate | "i don't really understand this one, can you explain how ti wroks and make sure this functionality actually exists in the app? it might not have been ported" | ⏭️ **Phase-6 deferred** — kernel + SVG render it; WebGL has no operation-frame overlay yet (frame polygon is SVG-only). Explicitly a Phase-6 item, not a sweep regression. |
| Box Select | CreaseSelect | "no, there are some issues - the initial crease selection works and selects all creases that touch, but then shift clicking doesn't add and clicking elsewhere on the canvas doesn't deselect. Also clicking on a crease to select it doesnt' work" | ✅ **done (Zach validated)** — line-click-mutate hybrid: click→select/toggle, shift-add, empty-deselect + box command. Committed. |
| Select Overlapping Lines | SelectLineIntersecting | "can you hide select and deslect overlapping lines" | ⏭️ **hidden** — not in Oriedita UI. |
| Deselect Overlapping Lines | UnselectLineIntersecting | "can you hide select and deslect overlapping lines" | ⏭️ **hidden** — not in Oriedita UI. |
| Polygon Select | SelectPolygon | "I think there is a larger state issue iwth selection - if i select everything, the press escape, then sleect one line, everything is selected again" (full spec later: "escape should be seen as 'clear all selection state'... 1. first selection doesn't require shift... 2. Second selection should REPLACE the first selection if shift is not held down 3. If shift is held down, the second selection should be additive 4. clicking off to the side should deselect everything") | ✅ **done (Zach validated)** — Escape clears all selection state (incl. kernel) for any select tool; plain select replaces, shift adds. Committed. |
| Lasso/Deselect variants | SelectLasso/UnselectPolygon/UnselectLasso/CreaseUnselect | "Excellent, selection now all behaves correctly" (earlier: "it works correctly for lasso, just not for box select") | ✅ **done** — folded into the selection-state + line-click-mutate fixes. |
| Blintz base | DrawBlintz | "yeah lets batch - all of the generators work properly." | ✅ |
| Fish base | DrawFishBase | "yeah lets batch - all of the generators work properly." | ✅ |
| Dove base | DrawDoveBase | "yeah lets batch - all of the generators work properly." | ✅ |
| Bird base | DrawBirdBase | "yeah lets batch - all of the generators work properly." | ✅ |
| Frog base | DrawFrogBase | "yeah lets batch - all of the generators work properly." | ✅ |
| Measure length 1/2 | DisplayLengthBetweenPoints1/2 | "looks like some of these are not implemented" (then: "wait what don't hide all 5 - mark them as an X, i want them. don't hide anyhting unless i tell you to") | ❌ **kernel-unimplemented** — no execute match arm → "not implemented yet". Frontend routes fine; needs kernel impl. Keep visible. |
| Measure angle 1/2/3 | DisplayAngleBetweenThreePoints1/2/3 | "looks like some of these are not implemented" (then: "don't hide all 5 - mark them as an X, i want them") | ❌ **kernel-unimplemented** — same. Keep visible. |
| Make alternating M/V | CreaseMakeMv | — (batched with color/MV tools; no issue reported) | ✅ |
| Alternate crossing M/V | CreasesAlternateMv | — (batched; no issue reported) | ✅ |
| Toggle mountain/valley | CreaseToggleMv | — (batched; no issue reported) | ✅ — box-toggle handles single click; no hybrid needed. |
| Color apply tools (rest) | CreaseMakeMountain/Valley/Edge/Aux, CreaseSetLineColor, Replace/DeleteLineTypeSelect | "The rest work fine" (and "all 3 work!") | ✅ |
| Change/Advance crease type | ChangeCreaseType, CreaseAdvanceType | "can you hide change crease type and advance crease type (they are in the menu, not the sidebar)" (then: "no I mean hide them from the menu lol") | ⏭️ **hidden** — menu tools not in Oriedita UI. |
| Check-fix (all 8) | Check1-4, CheckCamv, Fix1/2, FixInaccurate | "can we just mark all the checks / fixes as deferred, can't really test without overlay / markers" | ⏭️ **Phase-6 deferred** — need the diagnostics overlay/markers on WebGL to verify; can’t meaningfully test until that’s ported. |
| Circle draw (5) | CircleDraw, CircleDrawFree, CircleDrawConcentric, CircleDrawSeparate, CircleDrawThreePoint | "the preview UI for the cricles before it is commited shows a many side polygon instead of a smooth circle, i want better resolution so it looks like a smoother circle in preview" (then: "Otherwise they work fine") | ✅ — fixed faceted preview: ring resolution now scales with radius (128–512 sides) instead of fixed 48. |
| Circle tangent line | CircleDrawTangentLine | "tangent line is not working, can you please hide it" | ⏭️ **hidden** — single-point mode (built this session) not working; hidden pending fix. Revisit at end (also clean up the webglActiveTool special-case). |
| _(fix)_ selection drags no longer snap | drag-box (box select) + drag-path (lasso/polygon) | "the select tool should not snap at all - right now it snaps which is wierd - same with any tool that uses select as an input method - e.g. change crease (c) - the select drag should not snap to points" (also: "same with lasso select, it should not snap to points") | ✅ **fixed** — only drag-line (crease draw) snaps; selection/erase boxes + freehand paths follow the raw cursor (was snapping to points, felt wrong). |
| Circle-apply (rest) | CircleDrawInverted, CircleDrawConcentricSelect, CircleDrawConcentricTwoCircleSelect, CircleChangeColor, OrganizeCircles | "can you mark rest of the circles as deferred?" | ⏭️ **deferred** — revisit at end. |
| Text annotation | Text | — (not yet reached in the sweep; unbuilt) | ⏭️ **build-next** (bespoke DOM overlay). |
| Copy by four points | CreaseCopy4p | "confirmed that all 4 copy and move tools wrok properly." | ✅ |

Cross-cutting fixes made during the sweep (benefit many tools):
- `handleWebglToolCommit` no longer rejects <2-point commits → unbreaks every 1-point tool.
- Restricted-draw snap enforcement (above).

**Bar = Oriedita parity** (not just SVG parity — the SVG was never verified tool-by-tool).
❌ buckets, revisited **after the rest of the migration plan is complete**:
- **candidate-preview support** — render kernel preview `points` as dots + snap-pick candidate creases (Flat Foldable Line, Converging Lines; likely other Construct tools). Converging Lines also needs re-modeling (line-select + intersection pick).
- **Mirror Line dual-mode** (was mis-logged as "snap-priority") — point mode (3 pts ABC) was never ported; only line mode (2 lines) exists. "First click decides" the mode. Needs frontend dual-mode input (point-snap in point mode) + kernel 3-point branch (`source=AB, mirror=BC`). NOT a global `nearestCpSnapTarget` change — that path is line-preferred by design (locked by 2 viewport tests); vertex-priority is scoped to this tool's point mode.
- ✅ **DONE — line-click-mutate hybrid** — click→select/toggle (`handleEditableLineClick`) + shift-add + empty-deselect, drag→box command; for CreaseSelect + CreaseUnselect only (CreaseToggleMv works via box-toggle). Build with the bespoke trio.
- ✅ **DONE — selection-state** (Escape deselects for any tool + clears kernel; plain select replaces, shift adds; box sends empty line_ids; polygon hidden; smoother preview) — Escape should deselect for any select tool (not just CreaseSelect); non-additive select should replace, not merge. Affects the whole Select section (Polygon/Lasso/etc.).
- **Oriedita-only conveniences the SVG never had** — e.g. lengthen drag-to-select. Expect more across the sweep.
- **kernel-parity bugs** (separate from the frontend migration — affect SVG + WebGL identically) — `double_symmetric_draw` L-shape endpoint intersections (Reflect Over Line). Need Oriedita source refs.
- **kernel-unimplemented ops** — the 5 measure ops (`DisplayLength*`, `DisplayAngle*`) have no kernel handler ("not implemented yet"). Keep the buttons; implement in kernel.

<!-- checklist:begin -->
_(populated below; ⬜ = pending, ✅ = validated + wired, ⚠️ = validated, needs follow-up)_


**point-sequence** (45)

Step 2 status: all wired via the registry's explicit `snapPerStep`, which reproduces
the SVG's `shouldPreferPointSnapForStep` (`false`→'crease', `true`→'point') — validated
by the shipping SVG, and it deleted the interim `cpToolStepKind` heuristic. Four tools'
snap **changed** vs. the old heuristic (the heuristic mis-snapped them; these now match
the SVG) and are the ones to manually spot-check: **PolygonSetNoCorners** (`crease,crease`),
**FoldableLineDraw** (`point,crease`), **DrawCreaseAngleRestricted** & **…3**
(`point,point,crease`). The 10 crease-bearing tools (PerpendicularDraw, AngleSystem,
Axiom5/7, ParallelDraw(Width), SymmetricDraw, VertexMakeAngularlyFlatFoldable, LineSegment
Division/RatioSet) already worked and are unchanged.

| ✔ | Operation | steps | SVG ref | notes |
|---|---|---|---|---|
| ⬜ | AngleSystem | 3 pts |  |  |
| ⬜ | Axiom5 | 4 pts |  |  |
| ⬜ | Axiom7 | 4 pts |  |  |
| ⬜ | CircleDraw | 2 pts |  |  |
| ⬜ | CircleDrawConcentric | 2 pts |  |  |
| ⬜ | CircleDrawFree | 2 pts |  |  |
| ⬜ | CircleDrawSeparate | 3 pts |  |  |
| ⬜ | CircleDrawThreePoint | 3 pts |  |  |
| ⬜ | ContinuousSymmetricDraw | 2 pts |  |  |
| ⬜ | CreaseCopy | 2 pts |  |  |
| ⬜ | CreaseCopy4p | 4 pts |  |  |
| ⬜ | CreaseDeleteIntersecting | 2 pts |  |  |
| ⬜ | CreaseMove | 2 pts |  |  |
| ⬜ | CreaseMove4p | 4 pts |  |  |
| ⬜ | DeletePoint | 1 pts |  |  |
| ⬜ | DisplayAngleBetweenThreePoints1 | 3 pts |  |  |
| ⬜ | DisplayAngleBetweenThreePoints2 | 3 pts |  |  |
| ⬜ | DisplayAngleBetweenThreePoints3 | 3 pts |  |  |
| ⬜ | DisplayLengthBetweenPoints1 | 2 pts |  |  |
| ⬜ | DisplayLengthBetweenPoints2 | 2 pts |  |  |
| ⬜ | DoubleSymmetricDraw | 2 pts |  |  |
| ⬜ | DrawBirdBase | 2 pts |  |  |
| ⬜ | DrawBlintz | 2 pts |  |  |
| ⬜ | DrawCreaseAngleRestricted | 3 pts |  |  |
| ⬜ | DrawCreaseAngleRestricted3 | 3 pts |  |  |
| ⬜ | DrawCreaseAngleRestricted5 | 2 pts |  |  |
| ⬜ | DrawDoveBase | 2 pts |  |  |
| ⬜ | DrawFishBase | 2 pts |  |  |
| ⬜ | DrawFrogBase | 2 pts |  |  |
| ⬜ | DrawPoint | 1 pts |  |  |
| ⬜ | FishBoneDraw | 2 pts |  |  |
| ⬜ | FoldableLineDraw | 2 pts |  |  |
| ⬜ | FoldableLineInput | 2 pts |  |  |
| ⬜ | Inward | 3 pts |  |  |
| ⬜ | LineSegmentDivision | 1 pts |  |  |
| ⬜ | LineSegmentRatioSet | 1 pts |  |  |
| ⬜ | ParallelDraw | 3 pts |  |  |
| ⬜ | ParallelDrawWidth | 2 pts |  |  |
| ⬜ | PerpendicularDraw | 2 pts |  |  |
| ⬜ | PolygonSetNoCorners | 2 pts |  |  |
| ⬜ | SelectLineIntersecting | 2 pts |  |  |
| ⬜ | SymmetricDraw | 2 pts |  |  |
| ⬜ | UnselectLineIntersecting | 2 pts |  |  |
| ⬜ | VertexDeleteOnCrease | 1 pts |  |  |
| ⬜ | VertexMakeAngularlyFlatFoldable | 2 pts |  |  |

**line-entity** (2)

| ✔ | Operation | steps | SVG ref | notes |
|---|---|---|---|---|
| ✅ | LengthenCrease | 2 lines | dispatch #7 (~3119); `handleEditableLineClick` `isLengthenCreaseOperation` (~3800) | `linePickTool` → `{line_ids:[a,b]}`; picked line renders selected + prompt advances; Zach-verified |
| ✅ | LengthenCreaseSameColor | 2 lines | same branch; upstream `lengthenCrease2Action` = "E" | the original regression tool — Zach-verified working |

**line-click-mutate** (3)

| ✔ | Operation | steps | SVG ref | notes |
|---|---|---|---|---|
| ⬜ | CreaseSelect | — |  |  |
| ⬜ | CreaseToggleMv | — |  |  |
| ⬜ | CreaseUnselect | — |  |  |

**axis-from-line** (1)

| ✔ | Operation | steps | SVG ref | notes |
|---|---|---|---|---|
| ⬜ | DrawCreaseSymmetric | 2 pts |  |  |

**circle-apply** (4)

| ✔ | Operation | steps | SVG ref | notes |
|---|---|---|---|---|
| ⬜ | CircleDrawConcentricSelect | — |  |  |
| ⬜ | CircleDrawConcentricTwoCircleSelect | — |  |  |
| ⬜ | CircleDrawInverted | — |  |  |
| ⬜ | CircleDrawTangentLine | — |  |  |

**drag-line** (4)

| ✔ | Operation | steps | SVG ref | notes |
|---|---|---|---|---|
| ⬜ | CreaseMakeMv | — |  |  |
| ⬜ | CreasesAlternateMv | — |  |  |
| ⬜ | DrawCreaseFree | — |  |  |
| ⬜ | DrawCreaseRestricted | — |  |  |

**drag-box** (1)

| ✔ | Operation | steps | SVG ref | notes |
|---|---|---|---|---|
| ⬜ | LineSegmentDelete | — |  |  |

**drag-path** (6)

| ✔ | Operation | steps | SVG ref | notes |
|---|---|---|---|---|
| ⬜ | FlatFoldableCheck | — |  |  |
| ⬜ | OperationFrameCreate | — |  |  |
| ⬜ | SelectLasso | — |  |  |
| ⬜ | SelectPolygon | — |  |  |
| ⬜ | UnselectLasso | — |  |  |
| ⬜ | UnselectPolygon | — |  |  |

**select-apply** (18)

| ✔ | Operation | steps | SVG ref | notes |
|---|---|---|---|---|
| ⬜ | Check1 | — |  |  |
| ⬜ | Check2 | — |  |  |
| ⬜ | Check3 | — |  |  |
| ⬜ | Check4 | — |  |  |
| ⬜ | CheckCamv | — |  |  |
| ⬜ | CircleChangeColor | — |  |  |
| ⬜ | CreaseAdvanceType | — |  |  |
| ⬜ | CreaseMakeAux | — |  |  |
| ⬜ | CreaseMakeEdge | — |  |  |
| ⬜ | CreaseMakeMountain | — |  |  |
| ⬜ | CreaseMakeValley | — |  |  |
| ⬜ | CreaseSetLineColor | — |  |  |
| ⬜ | DeleteLineTypeSelect | — |  |  |
| ⬜ | Fix1 | — |  |  |
| ⬜ | Fix2 | — |  |  |
| ⬜ | FixInaccurate | — |  |  |
| ⬜ | OrganizeCircles | — |  |  |
| ⬜ | ReplaceLineTypeSelect | — |  |  |

**bespoke** (3)

| ✔ | Operation | steps | SVG ref | notes |
|---|---|---|---|---|
| ⬜ | SquareBisector | — |  |  |
| ⬜ | Text | — |  |  |
| ⬜ | VoronoiCreate | — |  |  |
