# Crease Topology Repair

Let the user fix the detected **topology** before the exact solve runs, so a
detection that is nearly right stops being a detection that is useless.

## Goal

Today CP detection is all-or-nothing. The pipeline recovers a candidate
topology, runs `solve_exact` on it, and either lands an exact crease pattern or
does not. There is no step at which a human can say "that junction is missing"
and hand the corrected graph back to the solver.

The measured size of the prize, from the current V5 production run
(`artifacts/cp-detect-correctness/reports/native-cp-v1-v5-step12000-PRODUCT-20260708/per_sample.jsonl`,
563 samples, in the shared main checkout — not in worktrees):

| | exact topology | + assignment |
| --- | --- | --- |
| current | **307 / 563** (easy 139/191, medium 111/232, hard 57/140) | 298 / 563 |

The 173 easy+medium failures are the addressable population. Counting **repair
sites** — connected components of missing edges plus of extra edges, endpoints
clustered at 1px — rather than raw edge defects:

| bucket | failures | median sites | mean |
| --- | --- | --- | --- |
| easy | 52 | **2** | 2.5 |
| medium | 121 | **2** | 3.8 |
| hard | 83 | 11 | 36.1 |

Cumulative over easy+medium (n=173): ≤2 sites **61%**, ≤4 **82%**, ≤8 **94%**.

So a typical repairable failure is **two repair sites — realistically 2–6 user
actions**.

**Measured, not projected (Phase 3, `simulate_topology_repair`).** The harness
derives the minimal edit set from ground truth, applies it, and re-solves — the
ceiling a user who never errs would reach:

| 563 samples | exact topology | recovered end-to-end |
| --- | --- | --- |
| V5 report | 307 | 220 |
| harness baseline (same candidates, no benchmark gate) | 307 | 236 |
| **after the derived repair** | **446** | **347** |
| repaired graph judged *as a graph* | **541** | — |

Easy+medium (n=423): topology 250 → 359, recovered 231 → **338**.

Two corrections to earlier drafts of this plan:

- **The ~480 projection was optimistic about the metric, not about the repair.**
  541 of 563 repaired graphs *are* ground truth as graphs (541 of the 542
  square-paper samples; the other 21 are non-square paper the square-only
  pipeline cannot represent and which recover 0 either way). The 95-sample gap
  to 446 is the strict metric's 2px vertex matching judging *unsolved*
  coordinates.
- **Hard is solver-bound, not repair-bound.** 131/140 hard repairs are
  GT-identical, but **123/140 solves hit the 25 s cap**, so only 9 recover.
  Raising the budget to 120 s on 40 correct-topology hard CPs took recovery
  **3 → 16**. Hard still should not be offered for *hand* repair — its median is
  12 sites — but the reason stated earlier (repair too large) is wrong at the
  margin; the wall is the solve budget.

Sensitivity (easy+medium, default 338): click jitter 1.5px costs 2, so this does
**not** need pixel-perfect clicking; `--no-relabel` costs **45**, so verb 7 is
load-bearing rather than a finisher; `--no-exemptions` *gains* 3, so the
per-vertex movement exemption buys nothing for verbs 1–6 and its case rests on
verb 8 alone.

## Approach

### The seam already exists

`ExactSolveInput` (`crates/oristudio-cp-compiler/src/candidate_graph.rs:1045`)
is a plain `Serialize + Deserialize` struct — vertices, selected spans,
boundary, cost model, provenance — and `solve_exact(&ExactSolveInput,
ExactSolveOptions)` (`exact_solve.rs:197`) is a **pure function of it**.
`decode.rs:557-568` constructs the input and solves it on two adjacent lines.
Nothing else is needed: no source image, no dense heads, no evidence, no
selection object.

Verified by running hand-edited graphs through the real solver on the committed
fixture `crates/oristudio-cp-compiler/tests/fixtures/exact_solve/right_small_fork.json`:

- **A user-added edge with zero evidence is honoured.** `presence_probability:
  0.0`, all `line_support_*: 0.0`, empty `source_carrier_ids` → accepted,
  landing 0.80px from the golden. The solver never reads those fields; a
  hand-drawn edge only needs a carrier, computable from its two endpoints.
- **A user-moved vertex is honoured, not reverted.** The movement prior anchors
  to `CandidateVertex.point` (`exact_solve.rs:645-657`), so it pulls toward the
  user's position.
- **…but `max_vertex_movement = 0.010` (≈9.6px @1024) rejects the whole solve
  past ~10px of edit,** because the budget is measured from the input points. On
  rejection the solver returns the input coordinates with `status: Failed`
  (`exact_solve.rs:396-410`) — the user silently gets their unsolved edit back.

  | edit | default | with `max_vertex_movement: 0.10` |
  | --- | --- | --- |
  | 2.7px | Solved, 0.20px from golden | — |
  | 10.9px | **Failed**, 10.54px | Solved, **0.81px** |
  | 27px | **Failed**, 26.84px | Solved, **2.03px** |
  | 68px | — | Solved, **5.12px** |

  Error leakage is linear and gentle (~7.5% of the injected displacement
  survives). This is the strongest single piece of evidence that the feature
  works.

  **A blanket raise is cheaper than it first looks, and a per-vertex exemption
  is still preferable.** The 46→17 accepted-but-wrong improvement came from
  tightening the *priors* (0.012/0.004 → 0.003/0.001) **and** the budget
  together, and the source comment is explicit that "the budget change only
  rejects two large-drift wrong solutions (movement caps stay far above real
  recoveries)" (`exact_solve.rs:126-137`). So raising `max_vertex_movement`
  alone re-admits roughly **2** of 563, not 29 — the priors do the work and are
  untouched. Prefer the per-vertex exemption anyway, because it costs zero and
  is barely harder, but do not justify it with the 46→17 figure.

**Three traps the UI must handle.**

- **A zero-length edge kills the entire solve** — `preflight_degenerate_edges`
  (`exact_solve.rs:1713-1722`), no solve attempted. Reject coincident endpoints
  client-side.
- **Labelling a span `boundary` is a topology delete.** Relabelling span 0 to
  `boundary` produced coordinates *bit-identical* to deleting it, because
  `boundary_role()` excludes it from Kawasaki fans and degree counts
  (`candidate_graph.rs:261-272`). Mislabelling an interior crease "B" silently
  removes it from every local theorem.
- **Assignments are not solved.** `decode.rs:651-659` disables the assignment
  solver on the product path, so an M↔V change alters the exported FOLD label
  and nothing geometric. Relabel is a correctness finisher, not a solve lever.

### What the user actually has to fix

The dominant defect is **not** a missing line — it is a **missing vertex whose
absence deletes its whole incident star**. 190 of 282 missing-edge components
are a star around one hub (degree histogram `{2:17, 3:59, 4:111, 5:2, 6:1}`);
only 5 components are a lone edge. One missed 4-valent crossing costs 4 missing
edges plus 2 extra edges — **6 defects, one repair**.

Verbs, ranked by measured volume over the 173 easy+medium failures:

1. **Insert vertex on edge / split-at-point**, atomic across every edge through
   that point — 117/173 samples; clears 35% of missing and 33% of extra defects.
2. **Add edge**, vertex-to-vertex, snapping to existing vertices and
   intersections. Must be **free drawing**: 93.8% of lost creases are
   `detector_miss` with no candidate in the pool at all, so promoting a rejected
   candidate is not sufficient.
3. **Add vertex**, free placement snapped to intersections.
4. **Delete edge** — 252/851 extras (30%) have no structural explanation.
5. **Dissolve degree-2 vertex** (rejoin its two edges — *not* plain delete,
   which destroys a correct crease) — 28 samples, 80 vertices.
6. **Delete vertex with its incident edges** — 106 spurious star components.
7. **Relabel M/V/B/U**, with an explicit "mark as paper boundary" — 247 wrong
   labels in failed easy/medium samples, 58% of them `boundary → unknown`.
8. **Move vertex**, sub-pixel, with snap — only 15 band samples at 2–4px, below
   visual threshold. Must be **machine-flagged**, never user-hunted.

**Do not surface border-role extras** (24% of extras): they are collateral of a
dropped interior edge and vanish when it is fixed, so flagging them sends the
user to delete a correct-looking border segment
(`research/2026-07-05-edge-census-selection-is-the-wall.md:130-142`). **Do not
surface `CoverageRootCause`** (`candidate_coverage.rs:112-128`) — it describes
the pipeline, not the drawing.

**A missed junction is invisible in ink space.** The stroke *is* drawn, along
its full length, correctly; only the graph is wrong. A pixel diff against the
source shows nothing, and this is the single largest defect class (117/173).
Consequence: the surface must render **vertices as first-class marks** — which
it already does, `vertices={editableCpVertexPoints}` at
`CreasePatternPanel.tsx:3077`, with a Point size control in the View panel.
Overlaying strokes on the source image, the obvious design, would never expose
the dominant defect.

An automatic shortcut was tested and mostly **fails**: of 239 missed GT vertices
sitting on a predicted pass-through, only **38 (16%)** lie where two predicted
edges actually cross, so a crossing-split pass could manufacture at most 16% of
them (18 of 117 samples). Worth taking as a free win; not a substitute for human
repair.

### The diagnostics problem, and why the angle-free set is enough

**What the editor's always-on CAMV shows on a pre-solve candidate:** `Angles`
(Kawasaki) fires **at essentially every interior vertex**, because
`checks.rs:901-907,966-979` compares against `Epsilon::FLAT = 1e-6°` while a
detected candidate carries residuals around **4°** (a real solve took one from
4.25° to 0.0029°). `BigLittleBig` fires too. Unusable as a worklist.

**What remains once the angle classes are hidden is sufficient — measured.**
Over the 169 easy+medium failures that have missing edges, flagging an endpoint
when losing its missing creases flips degree parity (odd-degree fires) or moves
`|M − V|` away from 2 (Maekawa fires):

| | |
| --- | --- |
| endpoints flagged by **odd degree** | 1,172 / 1,576 (**74%**) |
| endpoints flagged only by **Maekawa** | 266 / 1,576 (**17%**) |
| endpoints **silent** to both | 138 / 1,576 (**9%**) |
| markers per failed sample | **median 5**, mean 8.5; ≤8 on 71%, ≤16 on 88% |
| **repair sites with no marker anywhere on them** | **0 of 282 (0.0%)** |
| samples where every site is invisible | **0 of 169** |

The last two rows are the ones that matter. Individual endpoints go silent 9% of
the time, but **every missing-edge repair site carries at least one marker**, so
"work the markers until they are gone" is a complete procedure — the user is
never left hunting the sheet blind.

**One checker, not two.** The worklist is CAMV with the angle classes
suppressed, *not* a second marker layer from the compiler's `analyze_graph`. The
two conditions measured above are exactly CAMV's `NumberOfFolds` (odd fan,
`checks.rs:853-859`) and `Maekawa` (`|M − V| ≠ 2`, `checks.rs:335`), so the
compiler analysis would duplicate them. `analyze_graph` remains the better
long-term authority — its findings are close to the set of gates
`exact_solution_rejection_reasons` (`exact_solve.rs:1676-1711`) refuses on
(`odd_degree_vertices`, `degenerate_edges`, `unmodeled_crossings`,
`boundary_failures`; note **Maekawa is *not* a solver gate**, though 17% of the
measured worklist rides on it) — and an analysis-only call is cheap (**<250 µs
native**: 55 µs at 36 spans, 511 µs at 230 spans, for a double pass plus report
assembly).

But it is **not callable as-is**: `analyze_graph(input, points, model:
&SolveModel, params, options)` (`exact_solve.rs:1397`) needs a built
`SolveModel` and a parameter vector, and both it and `GraphAnalysis` (`:1367`)
are private with `Serialize` only — no `Deserialize`. A public wrapper is real
work, which is why it is a Phase 0 item and not on the v1 UI path.

**The suppression predicate must not be `rule`-based.**
`find_flat_foldability_violation` emits **one violation per vertex** with the
rule overwritten by priority (`checks.rs:334-346`): a vertex failing both
Kawasaki and Maekawa reports as `Angles`, so `rule !== 'Angles'` would hide a
real parity fault. The sound predicate reads the colour, which is written only
inside the `|M − V| ≠ 2` arm:

> suppress iff rule ∈ {`Angles`, `BigLittleBig`} **and** `violation_color` ∉
> {`NotEnoughMountain`, `NotEnoughValley`, `Equal`}

**Three gates, or the noise leaks back in:**

- `visibleEntries.ts:73-93` — `visibleCpDiagnosticEntries`, the single
  chokepoint every marker, HUD row and framing call routes through.
- `useCpDiagnosticList.ts:68-75` — the headline *naming* calls
  `diagnosticHudStatus` on the **raw, unfiltered** result, so it would claim
  findings over an empty list. (Its counts at `:80-91` already derive from
  `entries`, so the chokepoint covers those; only the naming needs separate
  handling.)
- `creasePatternSlice.ts:2094-2113` — the pre-fold warning calls the kernel
  directly (`:2097`), bypassing both the store field and the View toggle.

Also note `visibleEntries.ts:80-85`: an on-demand `Check1`/`Check2`/`Check3`
result sits in `lastCommandResult` and keeps rendering **regardless** of the
toggle.

### Where it lives: in the user's own document

Detection is **non-destructive**. It adds beside the user's work; it never
replaces the document. `importDetection` (`CpDetectImportModal.tsx:205-231`)
currently calls `loadCreasePatternText`, which replaces — that changes, and
"Add as-is" changes with it.

**`import_add` already does the placement, and does not disturb the candidate.**
`operations/arrangement.rs:290` shifts by `add_x = max_x(existing) + 100 −
min_x(added)` and `add_y = max_y(existing) − max_y(added)` (`:296-298`) — so it
clears the import entirely in x *and* top-aligns it — and
`divide_line_segment_with_new_lines` only tests *added-vs-existing* pairs
(`arrangement.rs:209-226`), never added-vs-added. So into free space it is a
**pure shift + append** and the candidate's topology is untouched. Covered by
`import_add_shifts_import_right_of_existing_pattern` and
`import_add_into_empty_pattern_gaps_by_one_hundred`.

**One caveat to verify before wiring it up:** `import_add`'s doc comment
(`arrangement.rs:286-289`) records that it drops auxiliary lines, loose points
and text. Confirm the detected candidate carries none of those, or the add is
lossy in a way the detect path does not expect.

Open polish item: into an *empty* document it gaps by 100 from the origin rather
than centring, which is the common "opened the app to detect a CP" case.

**Two alternatives were considered and rejected**, recorded so they are not
re-proposed:

- **A modal hosting a live mini-editor is the expensive option, not the cheap
  one.** It needs two simultaneously mounted CP surfaces: a **~4,000–6,000 line
  refactor across ~25 files**, concentrated in three files over 3,400 lines each
  (`creasePatternSlice.ts`, `projectSlice.ts`, `CreasePatternPanel.tsx`), and
  blocked on five module singletons that each document the one-surface
  assumption — the kernel handle (`oristudioCpRuntime.ts:39`), the camera
  registry (`cpCameraRegistry.ts:24`), the overlay view store
  (`cpOverlayViewStore.ts:36`), the transform preview store
  (`cpTransformPreviewStore.ts:39`) and the touch arbiter
  (`cpSurfaceGestures.ts:45`) — plus one selection, one undo stack, and
  `resolveCpViewportCanvas`'s `document.querySelector` (`cpViewportCanvas.ts:18`),
  which would silently return the background canvas. It would also be the app's
  first live-canvas modal; there is no modal framework and every WebGL surface
  today is a panel or a canvas layer.
- **A separate repair document in a slot is unnecessary.** It looked forced once
  detection became non-destructive, but it is not: `ExactSolveInput` stays
  attached to the document, so the document is only a *view* of the candidate
  graph. Solve reads the attachment plus the user's edits, never the merged
  document's geometry, so a second paper square in the document is irrelevant to
  its unit-square requirement.

`CreasePatternWebglCanvas` itself was never the obstacle — all 3,802 lines are
props-driven with a per-instance renderer, camera and hit index, and it reads
exactly one store (theme).

### The suppression region

**A check-suppression region ships as a third `CanvasAnnotation` kind.**
`AnnotationBase` (`annotations/annotationBase.ts:23-41`) already carries `id`,
`center`, `width`, `height`, `rotation`, `z`, `opacity`, `locked`, `hidden` —
everything a box needs. Joining that union buys select / move / resize / rotate
(`transformableObject.ts:40-56` → `CanvasObjectOverlay`), model-space hit
testing (`annotation.ts:57-75`), and **undo for free**, because `annotations:
CanvasAnnotation[]` is a field of the CP history snapshot (`types.ts:86-87`,
restored at `historySlice.ts:304`). Only 9 files mention `CanvasAnnotation`.

Forbid `hidden` on this kind: a region that suppresses invisibly is the one
state the design must not allow.

**Suppression is positional** — a crease inside the box is suppressed, drag it
out and it is checked again. No identity tracking, nothing to invalidate. The
objection that this is wrong for repair (*"repair is moving geometry, so
dragging a vertex past the edge lights it up"*) **does not hold**: the region
sits on the paper boundary and every crease lives on the paper by definition, so
there is no valid repair edit outside it; `import_add` clears the two patterns
by 100 units so the user's own creases cannot drift in; and boundary vertices
slide *along* the paper edge rather than off it (`exact_solve.rs:506-509`).
Moving the whole region is free and idiomatic — a `TransformableCanvasObject`
"defers to the selection overlay, so a drag there moves it like any other canvas
object" (`InlineSimulationLayer.tsx:178-182`, describing simulation windows).

**Two chip components, not one conditional component.** Suppression and solve
share no invariant, so they compose rather than merge:

- `SuppressionRegionChip` — the base. Name, suppressed classes, hidden count,
  the class dropdown, the shared `AnnotationActions` (opacity / front / back /
  delete). **This is what the rail tool creates, and it never has a Solve
  button.**
- `SolveRegionChip` — renders the base and appends the solve affordance. Used
  only where a region carries an attached `ExactSolveInput`, which only
  detection produces.

The discriminator is **the attachment's presence**, not a geometric "does this
box contain a solvable pattern" test — a geometric test runs continuously and
can flicker mid-edit as the boundary is broken and repaired, which is exactly
when it must not.

**The chip is always visible.** Every existing inspector shows only while its
object is selected, and a region deliberately breaks that rule: it *hides
information*, and a suppressor you cannot see until you click it is a footgun.
The chip carries the name, the suppressed classes, and **how many findings are
hidden** — that count is the safety affordance and the reason `hidden` is
forbidden. `CpTextAnnotationLayer` is the precedent for always-mounted
per-object DOM. On selection it expands into a `FloatingToolbar`
(`CpImageInspector.tsx` is the template), anchored by
`useCanvasObjectAnchor(box, 'model', container)`, which subscribes to the camera
itself so it stays glued during a pan
(`canvasObjects/useCanvasObjectAnchor.ts:25-33`).

**The dropdown is a checkbox list naming the theorems**, as the app does
elsewhere:

```
☑ Kawasaki (angles)          ← angle-dependent
☑ Big-little-big             ← angle-dependent
☐ Maekawa (parity)           ← combinatorial
☐ Vertex closure / spatial   ← angle-dependent
```

Detection's preset is the top two.

**The fill must be a GPU program; the chip must be DOM.** Every DOM layer sits
at `zIndex: 7`, above the whole WebGL canvas, so nothing drawn in DOM can be
behind the creases. Images are the only kind that render behind, via an explicit
hardcoded z-slot in `reglRenderer.ts:299-303`. So the region's translucent fill
and border follow the image template — a program under `renderer/programs/`, a
`set*` seam on `CpRenderer`/`reglRenderer`, and a chosen z-slot: **grid → region
→ images → creases**, so a region reads as backdrop to both.

**Creation** is a rail tool reusing `dragBoxTool.ts` + `viewAlignedBox.ts` with
`inputMode: 'drag-box'` — zero new canvas machinery, since the canvas already
routes press/move/release for that mode. Registration is data-driven: an id in
`ORISTUDIO_CP_SOURCE_MAP_OPERATION_IDS` (`lib/oristudioCpCommands.ts`), a
`ready(...)` definition, and an entry in
`cp-workspace/tools/inputModelRegistry.ts` (test-enforced in both directions).
Because it commits **web-side**, add a third early return in
`handleWebglToolCommit` beside `PropagateFoldAngles`
(`CreasePatternPanel.tsx:1780-1792`) and `VertexSolveFoldAngles` (`:1794-1802`),
taking `commit.points` into `addAnnotation`. Opt into model-aligned corners via
`isModelAlignedBoxOperation` (`tools/predicates.ts:108`) as the operation frame
does. **Do not copy the text tool** — it added a whole `ActiveToolMode` member
and bespoke canvas branches, a cost only justified by its DOM hit-testing.

Also offer creation **from the selection**, which has precedent: inline
simulations and folded figures are both made that way
(`creasePatternSlice.ts:1700-1766`).

Beyond repair, a plain suppression region serves a library of reusable CP
fragments beside a working pattern (inherently incomplete, so inherently
error-laden), a work-in-progress area, and an imported reference CP that will
never be folded.

**Model the filter as a list of scoped rules** so a document-wide rule and
per-region rules compose the ordinary way — document default, regional
override. `camvIssuesVisible` (`lib/creasePatternViewport.ts:114,203`, toggled
at `CpViewControlsPanel.tsx:71-75`) becomes the document-wide rule rather than a
special case.

### The source image is the existing image layer, at 50% behind the creases

No new mechanism. `CpImage` already carries `opacity`, `locked`, `hidden` and
`z` (`CpImage extends AnnotationBase`, `cpImage.ts:50` → `annotationBase.ts:33-40`), and `CpImageInspector` already
exposes opacity and z-order. Entering repair attaches the **rectified** image as
a `CpImage` with `opacity: 0.5`, `locked: true`, and `z` behind the creases.

Registration is exact and needs no user alignment: the rectified image and the
candidate graph come out of the *same* rectification, so image pixels map to
paper coordinates by the known `inset + u·(image_size − 2·inset)` with
`SYNTHETIC_RENDER_INSET_PX = 32`. It persists to `.osf` for free, because images
already round-trip and are already in the lossy-export registry.

**The image does not replace the markers**, and the two are not substitutes:

| | answers | drives |
| --- | --- | --- |
| **image underlay** | "what creases should exist" | add edge, add vertex (verbs 2–3) |
| **angle-free markers** | "where the graph disagrees with itself" | insert vertex on edge (verb 1) |

The largest defect class is invisible in ink space, so tracing cannot reveal it.
Ship both.

### Solve

**`Crease Pattern ▸ Repair ▸ Exact Solve…`**, beside `cp.fixInaccurate` ("Fix
Inaccurate Creases…") — its better-solver sibling, so the menu position is the
argument for the feature (`menus/menuDefinition.ts:253-257`). Routing through
`MENU_ACTION_ID` buys the keyboard shortcut, the command palette and analytics
at the `handleMenuAction` chokepoint. The `SolveRegionChip` surfaces the same
command as a button; it does not own it.

**Scope is a *pattern* — the closed-boundary component — not a selection and not
a region.** Every other selection-scoped CP command is a decomposable per-line
edit; exact solve is a global constrained optimisation in which Kawasaki couples
every vertex through its fan and the boundary is pinned to the unit square. On a
fragment it must either refuse or silently move vertices shared with unselected
geometry, so "select this messy corner and solve" — the most natural gesture —
would fail every time. Selection is **disambiguation**, not extent: after
`import_add` the document holds two paper squares, so the command resolves to
the pattern the selection or last click identifies, and is disabled with the
solver's own reason otherwise. The house pattern supports this:
`cp.fixInaccurate` is gated on `canEditCp && hasSelectedCpLines`
(`lib/workspaceCapabilities.ts:915-920`) with no whole-document fallback.

Where selection *is* meaningful for solve is as **movement policy** — "hold
these vertices, let those move" — which maps onto the per-vertex movement
exemption Phase 0 needs. Spend selection there, not on scope.

**Two stages, because they behave completely differently.** Polish is **79–96%
of the wall** and runs *only if stage 1 would be accepted*
(`exact_solve.rs:298-309`), so stage 1 "Solving geometry" fails fast and stage 2
"Refining to fold precision" is up to 6 individually-accepted rounds with a
monotone `current_kawasaki` marching toward 1e-6 — a real denominator for a real
progress bar.

Expected waits, native, uncontended, successful solves only, on the population
repair targets:

| bucket | p50 | p90 | max |
| --- | --- | --- | --- |
| easy (n=133) | **0.36 s** | 1.03 s | 2.07 s |
| medium (n=97) | **3.50 s** | 12.50 s | 23.37 s |

Hard essentially always hits the 25 s cap — another reason to say plainly that
hard is out of scope.

**Failure reporting.** Distinguish timeout from rejection on
`movement_report.timed_out` (bool), never by parsing the reason string, which
embeds a formatted number (`exact_solve.rs:1826-1831`). The complete
`rejection_reasons` vocabulary is nine tokens plus the timeout string: two
preflight (`preflight_degenerate_edges`, `preflight_boundary_failures`,
`:1713-1722`) and seven acceptance-gate (`candidate_status_failed`,
`movement_budget_exceeded`, `odd_degree_vertices_worsened`,
`degenerate_edges_worsened`, `unmodeled_crossings_worsened`,
`boundary_failures_worsened`, `objective_not_improved`, `:1676-1711`). Note a
malformed input has **no** `rejection_reasons` key at all — it returns
`{"status":"not_run","blockers":[…]}` (`:199-213`), so a UI reading only that
array shows "no reason". On timeout, `attempted_moved_vertices` carries the
partial solution (median 448 entries), so "the solver got this far — accept or
keep editing" is honest and available.

`movement_report.elapsed_seconds` uses the deadline clock, which **does** work
under wasm, so a real browser number is available today even though `StageTimer`
returns 0.0 on wasm32 (`decode.rs:147-159`) — which is why
`compiler_seconds`/`exact_solve_seconds` are identically zero in every browser
run and must be fixed before shipping a wait UI.

**Two tiers, and only one is ready.**

*Tier 1 — warm solve (an `ExactSolveInput` is attached).* Persist the
solve-minimal projection as a **superset feature**
(`apps/web/docs/superset-features.md`): web-side, `.osf` only, omitted from every
Oriedita export automatically with the shared warning
(`lib/supersetFeatures.ts`). Cheap, because the solver reads only ~15% of the
struct — a solve-minimal projection is **13% of the full JSON**, ≈40 bytes/span
gzipped:

| fixture | spans | full | solve-min | gzipped |
| --- | --- | --- | --- | --- |
| `right_small_fork` | 36 | 39 K | 5 K | **2 K** |
| `right_medium_bowl` | 99 | 108 K | 14 K | **4 K** |
| `wrong_medium` | 230 | 252 K | 32 K | **10 K** |

Extrapolating to the hard bucket's 2,321 edges gives ~100 KB gzipped; watch that
against `desktop-large-cp-osf-oom`.

*Tier 2 — cold solve (no attachment).* Rebuilding `ExactSolveInput` from
document geometry alone is the general "exactize any CP" feature, and it is
**further along than "prototyped"**: on branch `codex/edit-canvas-omit-refactor`
`fold_exactize.rs` (769 lines) plus a wasm binding are wired into Send-to-Edit
with `EXACTIZE_ON_SEND_TO_EDIT = **true**` (`creasePatternSlice.ts:70`). It is
not gated off; it is *adopted at runtime* only when the result is Kawasaki-clean
and strictly reduces CAMV, and otherwise falls back to the original CP
unchanged. The branch tip commit is literally `a7cc87cb docs: exactize now
shipping with Kawasaki-clean gate`. The two blockers recorded earlier in its
history were diagnosed **against TreeMaker** and neither survives contact with
detection:

- **The boundary restriction is moot here.** Every candidate generator in the
  detect pipeline hardcodes
  `BoundaryReconstructionPolicy::LockedUnitSquareSortedContacts`
  (`junction_first_v1.rs:915`, `junction_carrier_v1.rs:1055,1504`,
  `legacy_topology_v2.rs:700`) and `corner_points` pins the literal unit square
  (`exact_solve.rs:2015-2028`). **CP detection is already square-only end to
  end**, so it takes the path that works. The gated convex-`Polygon` path is a
  TreeMaker concern and is not on this route.
- **The big-little-big gap is real but bounded** — see the next section.

v1 offers Solve only where an attachment exists, because Tier 2 additionally
needs the cold adapter landed and tested. Treat Tier 2 as scheduled, not blocked.

### After the solve

**The solve cuts CAMV by 68–86%, and what remains is hand-fixable.** Measured by
running CAMV over the same fixture at candidate coordinates and at solved
coordinates:

| fixture | spans | pre-solve camv / BLB / Angles | post-solve camv / BLB / Angles |
| --- | --- | --- | --- |
| `right_small_fork` | 36 | 6 / 1 / 5 | **1** / 1 / 0 |
| `right_small_cleaver` | 70 | 17 / 0 / 17 | **3** / 3 / 0 |
| `right_medium_butterfly` | 88 | 22 / 1 / 21 | **6** / 6 / 0 |
| `right_medium_bowl` | 99 | 35 / 3 / 32 | **5** / 5 / 0 |
| `right_large_angel` | 199 | 72 / 0 / 72 | **23** / 23 / 0 |
| `wrong_medium` (rejected) | 230 | 74 / 2 / 68 | 74 / 2 / 68 |

Three things follow, all correcting earlier drafts of this plan:

1. **The solve does not leave a mess**, it removes most of one. 72 → 23.
2. **It does not *introduce* big-little-big.** Those vertices already violated
   it; the `Angles` rule was **masking** them, because
   `find_flat_foldability_violation` emits one violation per vertex with Angles
   taking precedence (`checks.rs:329-346` — the same masking trap that makes a
   rule-based filter unsound). Clearing Kawasaki unmasks what was underneath.
3. **Big-little-big is an assignment condition** — the two creases flanking a
   locally-minimal angle sector must differ in M/V. A residual BLB violation is
   therefore "this crease's mountain/valley is wrong": verb 7, a one-click flip,
   not a solver gap the user must be shielded from. The checker is not noisy:
   canonical hand-authored patterns (`birdbase`, `solution_sample_1`, `glitch`,
   `colorconstrainttest`) report **0 violations of any rule**.

So there is **no per-class restore**. Adding a big-little-big residual family to
`exact_solve.rs` stays worthwhile — its acceptance criterion is those five
counts going to zero — but it is an optimisation, not a prerequisite.

**The post-solve gate.** The solve does not silently finish; the chip becomes:

```
◱ Solved · 45 vertices moved < 1px          [Try again]   [Accept]
```

- **Accept** — delete the region, restore full checking. **Keep the source
  image**, which is still useful for comparison and which the user can delete
  themselves. Any residual violation is real, small, and fixable with tools that
  already exist.
- **Try again** — revert to pre-solve coordinates with the region back in its
  repair state, so the topology can be changed and re-solved. Mechanically this
  is the undo-across-solve path, given a name and a button.

On failure the region stays and the document is unchanged, because the solver
returns the input coordinates on every non-acceptance (`:396-410`).

### Nothing is tracked by identity, and nothing stores a transform

An earlier draft proposed an attachment holding the region's **owned line ids
and an offset**. Both halves are wrong:

- **Kernel line ids are indices.** `useVertexSolve.ts:158-172` states it
  outright — *"Line ids are indices, so an undo or a parallel edit leaves both
  the solve and the replaced set pointing at whatever now occupies those
  slots."* An id-keyed attachment breaks on exactly the edits repair consists
  of: adding, deleting, splitting creases, and undo.
- **A stored offset breaks under any transform**, and the editor offers move,
  rotate, scale and mirror.

So **derive everything from the region's current contents at Solve time.** The
adapter exists: `fold_exactize.rs` detects the paper-boundary polygon by turn
angle, derives the rotate/scale/translate mapping onto the axis-aligned unit
square (`:193`), solves there, and maps back "into the *input's* coordinate
frame" (`:131-138`). Because the frame is re-derived every time, move / rotate /
scale / mirror are non-events.

**What a cold rebuild cannot recover is per-vertex `support` — and it is
measured to cost nothing.** `support` scales the movement prior
(`movement_sigma` by `1 − support·0.35`, `movement_weight` by
`0.75 + support·0.5`, `exact_solve.rs:2030-2041`). On all six
production-dumped fixtures it is **uniformly 1.0**, and forcing it uniform
changed nothing: identical statuses, **0.0000 px max drift**. The field is
consumed but carries no signal in the shipping junction-first path.

Undo across the Solve must move coordinates **and** region state in one history
entry, or the user lands on unsolved coordinates with checks restored —
silently. Test both directions.

### On PR #164 (the Learn surface)

**The slot mechanism is sound and reusable, but it is not a prerequisite.**

- Its **entire Rust change is a 58-line test.** `CpSession` is already a handle
  arena (`session.rs:457-460`); multi-document support exists on `main` today.
- Its reusable core is **~330 lines** (`cpDocumentSlots.ts` + the `types.ts`
  additions) — **10% of the 8,820-line diff**. The rest is tutorial content
  (+6,363) and Learn routing/chrome (+1,543).
- It is **park-and-swap, not concurrent**: exactly one document's state lives in
  the store at a time. PR #164 wanted a second CP on screen and deliberately
  built `TargetCpPreview.tsx` as a **static SVG** rather than a second WebGL
  surface.
- Rebase cost is real: a trial `git merge-tree` gives **37 conflicted files**,
  990 commits of drift. The type-level guardrails survive perfectly (5 field
  additions, 1 removal, all compile errors). The uncatchable cost is ~46 new
  `await` sites in the two guarded slices, each needing a
  `cpSlotGenerationIsCurrent` audit that nothing enforces.
- Three things a second consumer must **fix, not inherit**: Save is not masked
  (the plan required it; `EditingContext` has no `learn` member, and
  `currentFilePath` is not slot-scoped while `oristudioCpDocument` is — read
  statically, this path serializes the practice document to the user's file);
  `activeSlotTracksProjectDirty()` hardcodes `=== 'edit'`; and slot-generation
  guarding is a convention, not a mechanism.

**Recommendation: do not block topology repair on PR #164, and do not rebase
it.** Repair keeps the candidate in the user's own document, so it needs no
second live document. Land the tutorial on its own merits by re-applying bucket
(a) onto current main (~2–3 days) rather than rebasing 108 files (~1–2 weeks).

### Known friction, to be named in the PR rather than hidden

- There is **no per-kind inspector registry** —
  `CreasePatternPanel.tsx:3197-3231` is a hand-written mutual-exclusion cascade,
  and a fourth inspector means amending the existing `!selectedCpImage &&
  !editingTextId` guards. Against `AGENTS.md`'s panel rules this should be
  called out, not quietly extended.
- `annotationAspectLockPolicy` (`annotation.ts:48-50`) is a **ternary, not an
  exhaustive switch**, so a new kind silently inherits `'default-off'` with no
  type error. That is the value a region wants, so it will look correct by
  accident.
- `.osf` persistence is **split per kind** (`nativeProjectFile.ts:105,111`;
  split at `projectSlice.ts:1653-1655`, merged at `:1152-1155`), so a region
  needs a fourth array on both sides. Additive — do not bump the schema version.
- `cpContentBounds.ts` takes `overlayBoxes` separately and its own comment warns
  the list is "easy to forget to extend"; miss it and fit-to-view will not frame
  a region.

## Affected Areas

- `crates/oristudio-cp-compiler/` — public pre-solve analysis; per-vertex
  movement exemption in `ExactSolveOptions`; the `ExactSolveInput` rebuild.
- `crates/oristudio-cp-detect/` — return the pre-solve `ExactSolveInput`
  alongside the FOLD; wasm-side `StageTimer`.
- `crates/oristudio-cp-detect-wasm/` — one new export taking `ExactSolveInput`.
- `apps/web/src/components/CpDetectImportModal.tsx` — non-destructive add;
  "Review & Fix" / "Solve & Add" / "Add as-is".
- `apps/web/src/cp-workspace/annotations/`, `images/`, `renderer/` — the region
  annotation kind, its GPU program, its chips.
- `apps/web/src/cp-workspace/diagnostics/` — the scoped check filter.
- `apps/web/src/lib/creasePatternViewport.ts` and
  `apps/web/src/components/panels/CpViewControlsPanel.tsx` — the document-wide
  rule.
- `apps/web/src/menus/` and `apps/web/src/lib/workspaceCapabilities.ts` — the
  Exact Solve command and its gating.
- `apps/web/src/cp-workspace/tools/` — the region creation tool and the repair
  verbs.

## Checklist

### Phase 0 — seam and instrumentation (Rust only, no UI)

- [x] Make the pre-solve analysis public: `pub fn
      analyze_candidate_topology(&ExactSolveInput) -> TopologyDiagnostics`,
      splitting combinatorial findings (odd degree, dangling, non-collinear
      degree-2, Maekawa, degenerate edges, unmodeled crossings, boundary) from
      angle-dependent ones. Unit tests per finding. *Not on the v1 UI path — v1
      uses CAMV — but it is the right long-term authority and Phase 3 needs it.*
- [x] Add a per-vertex movement exemption to `ExactSolveOptions` so user-touched
      vertices escape `max_vertex_movement` without a blanket raise. Re-run the
      563-sample native pack to prove automatic behaviour is unchanged.
- [x] `ExactSolveInput` rebuild from current document geometry, via the
      `fold_exactize` frame derivation. Guard the `id == index` invariant
      (established by `assign_span_ids`, `junction_carrier_v1.rs:1191-1195`;
      relied on at `candidate_graph.rs:1013` and `selection.rs:1708`; currently
      unasserted).
- [x] Export the pre-solve candidate as a FOLD document (a synthetic
      `ExactSolvedGraph` over candidate points reuses
      `export_exact_solved_to_fold_document` unchanged).
- [x] wasm: `cp_detect_solve_exact(input_json, options_json)` — a two-line
      wrapper; every type already round-trips through JSON, as
      `replay_exact_solve_experiments.rs:421-427` proves.
- [x] Fix `StageTimer` on `wasm32` (`decode.rs:147-159`) — it returns 0.0 today,
      so `compiler_seconds` and `exact_solve_seconds` are identically zero in
      every browser run.
- [ ] **Deferred.** Take the free 16%: split candidate spans at unmodeled
      crossings before the solve, gated and measured on the native pack. Not a
      dependency — the manual verb covers the same defect — so it was not worth
      blocking Phase 0 on a full-pack run.

### Phase 1 — the repair flow

- [x] **Scoped check filter.** Model as a list of rules `{scope, suppress[]}`;
      `camvIssuesVisible` (`lib/creasePatternViewport.ts:114,203`) becomes the
      document-wide rule. Apply at all three gates: `visibleEntries.ts:73-93`,
      `useCpDiagnosticList.ts:68-75` (the headline reads the **raw** result),
      `creasePatternSlice.ts:2094-2113` (the pre-fold warning bypasses the
      toggle). Predicate is rule-class **plus** the `violation_color` Maekawa
      test, never rule alone.
- [x] **`CpSuppressionRegion` as a third `CanvasAnnotation` kind.** Free from
      `AnnotationBase`: select / move / resize / rotate, model-space hit test,
      and **undo** (`types.ts:86-87`, `historySlice.ts:304`). Forbid `hidden`.
      Watch `annotationAspectLockPolicy` (`annotation.ts:48-50`).
- [x] **Two chip components**: `SuppressionRegionChip` (base; what the rail tool
      creates; never shows Solve) and `SolveRegionChip` (renders the base,
      appends Solve). Discriminated by whether an `ExactSolveInput` attachment
      is present — data, not a geometric test that could flicker mid-edit. The
      chip is **always visible** and carries the hidden count.
- [x] **GPU fill.** Follow the image template (`reglRenderer.ts:299-303` +
      `programs/imageProgram.ts`) with an explicit z-slot: grid → region →
      images → creases. Nothing in DOM can sit behind the creases.
- [x] **Creation tool** reusing `dragBoxTool.ts` with `inputMode: 'drag-box'`;
      register id + `ready(...)` + `inputModelRegistry.ts` entry; commit
      web-side via a third early return in `handleWebglToolCommit`. Also offer
      creation from the selection. Do not copy the text tool.
- [x] `.osf` persistence: a fourth per-kind array (`nativeProjectFile.ts:105,111`;
      split `projectSlice.ts:1653-1655`, merged `:1152-1155`) plus a
      `lib/supersetFeatures.ts` entry. Additive — do not bump the schema
      version. Add to `cpContentBounds`'s `overlayBoxes`.
- [x] **Inspector cascade**: a fourth clause in
      `CreasePatternPanel.tsx:3197-3231` and an amendment to the existing
      guards. Call this out in the PR.
- [x] `Crease Pattern ▸ Repair ▸ Exact Solve…`, beside `cp.fixInaccurate`,
      scoped to a **pattern**; selection disambiguates. Gate modelled on
      `workspaceCapabilities.ts:915-920`. Two named stages; report the specific
      `rejection_reasons`; distinguish timeout on `movement_report.timed_out`;
      handle the no-`rejection_reasons` malformed-input shape; offer the partial
      from `attempted_moved_vertices`.
- [x] Detect adds the candidate beside the user's work via `import_add`, never
      replacing — "Add as-is" likewise. Centre the addition when the target
      document is empty. Create the region and attach the rectified image
      (`opacity: 0.5`, `locked`, behind the creases, registered by
      `inset + u·(image_size − 2·inset)`).
- [x] Persist the solve-minimal `ExactSolveInput` projection as a superset
      feature; rebuild from current geometry at Solve time.
- [x] **Accept / Try again gate.** Accept deletes the region, restores full
      checking, and **keeps the source image**. Try again reverts to pre-solve
      coordinates with the region back in repair state. No per-class restore.
- [x] Undo across the Solve moves coordinates **and** region state in one
      history entry. Test both directions.
- [x] Say plainly when a sample is out of hand-repair range (hard bucket, median
      11 sites, and the 25 s cap on essentially every hard solve).

### Phase 2 — the verbs

- [x] Verbs 1–8 above, in that order; stop and re-measure after 1–3, which cover
      the large majority of sites.

### Phase 3 — measurement

- [x] A repair-simulation harness — `crates/oristudio-cp-detect/src/bin/simulate_topology_repair.rs`.
      Run on all 563 samples; results in the Goal section above.
- [ ] **Follow-up the harness surfaced:** hard-bucket recovery is capped by the
      25 s solve budget, not by repair size (123/140 hard solves time out;
      3 → 16 of 40 at 120 s). Decide whether the product budget should scale
      with pattern size.
- [ ] A big-little-big residual family in `exact_solve.rs`, gated on the five
      fixture counts above going to zero and on a full-pack run showing no
      recovery regressions.
