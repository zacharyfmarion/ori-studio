# Diagram workspace: steps in order, on the page

## Goal

The Diagram workspace is where a folder puts together an origami diagram: one
picture per step, the symbols drawn on it, the instruction under it, all in
order and laid out on printable pages.

Today Ori Studio can make every ingredient of a diagram, one at a time:
- a folded figure on the Edit canvas, flat with its layer order or in 3D;
- a simulation at any fold percentage and angle;
- a precreasing step in References, with its arrows and lettered references;
- a paper-styled SVG or PNG of any of those.

Nothing holds them in order and nothing lays them out on a page.
`implementation-plans/paper-export-dialog.md` deferred exactly this ("a
multi-step diagram document (one file laying the steps out together)", ~l.30).

The design source is the Claude Design project *Ori Studio – Diagram*
(`Ori Studio - Diagram.dc.html`, project `acda3ed2-f312-41f2-824f-5e06bd0e7470`).
It is a static prototype, so use it for **layout and flow**. Its colours,
radii, type sizes and inline styles are not the design system and are not
carried over.

At the end of this plan a user can:

1. **Add steps, in order.** Each step's picture comes from one of five sources:
   - a pattern on the Edit canvas shown **as a crease pattern**;
   - the same pattern **folded** (flat with its layer order, or 3D when it has
     non-180° creases);
   - the same pattern **simulated** at a fold percentage and camera angle;
   - a **step sent from References**;
   - a **picture they drew or edited by hand**: SVG (kept as vector), PNG or
     JPEG, one or many at a time.
2. **Pose** the picture:
   - turn over and rotate a flat fold;
   - orbit a 3D fold or a simulation;
   - set a simulation's fold percentage.
3. **Annotate** it with the standard symbols:
   - valley- and mountain-fold arrows, fold-and-unfold, push/sink, turn over and
     rotate;
   - valley, mountain and hidden lines;
   - text labels.
4. **Organise** the steps:
   - write each step's instruction;
   - insert, duplicate, reorder, renumber and delete steps;
   - replace a step's picture, or export it, edit it elsewhere and bring it back.
5. **Lay out** the steps on A4, A5, B5 or US Letter pages:
   - a grid or a winding "flow" layout, with a title and page numbers;
   - one paper scale across steps, so the model visibly shrinks as it is folded.
6. **Export** a PDF of the pages, or a ZIP of per-step SVG or PNG files.
7. **Save** the diagram in the project's `.osf`, with undo throughout.

### Model and non-goals (read this before anything else)

- **A diagram is a document of the project, not a view of the crease pattern.**
  It sits beside the crease pattern and the design tabs in the `.osf`. It has
  its own undo stack and marks the project dirty, and New / Open replace it.
  It is **not** inside the CP document: Edit's self-provisioning,
  `clearOristudioCpDocument` and every BP open or create would wipe it
  (`freshCreasePattern.ts:31-62`, `projectSlice.ts:2535`,
  `oristudioBpSlice.ts:702,766`).
- **A step owns its picture.** A picture is *captured* when the user makes or
  poses it, and recaptured only when they ask. The step remembers where the
  picture came from, so it can say "out of date" and offer **Refresh**. Four
  facts force this:
  1. A fold takes from milliseconds to minutes and blocks the single CP worker
     (`implementation-plans/fold-cancellation.md`; on desktop it holds the
     engine mutex). A diagram that refolded its steps on open would freeze Edit.
  2. References plans are neither persisted nor reproducible. Wall-clock
     budgets shape them (`planner.rs:44-50,94-97`), and step numbering changes
     with five settings (`referencesResults.ts`, `useReferencesView.ts:83-86`).
  3. Annotations are drawn *on* the picture. If the picture changed silently,
     every arrow would point at the wrong flap.
  4. A simulation's fold percentage is a target, and the mesh it settles into
     depends on the path taken (`persist-inline-simulations.md:100-135`).
- **Links are geometric, never ids.** No id of a pattern, segment or crease is
  stable. `CpSegment.id` is a reading-order index reassigned on every recompute,
  and crease ids shift when a crease is deleted. The codebase already has two
  durable provenance shapes, and the plan reuses both (D3):
  - the folded-figure refold check (`sourceBounds` plus `sourceFingerprint`, a
    port of Oriedita's `FOR_EXISTING_FOLDED_FIGURE_3`);
  - the inline-simulation region reference (outer ring, bounds and
    fingerprint).
- **One painter, and the screen shows the file.** Every picture is, or becomes,
  a `PaperScene` painted by `lib/paper/paperSvg.ts`. Step cards, the Pages view
  and every exported file show the same painted SVG strings (house rule X2 in
  `paper-export-dialog.md`). For that to hold for **text** too, the diagram's
  text font is bundled and embedded (Decision 2).
- **Non-goals:**
  - **Generating a fold sequence from a crease pattern.** There is no engine for
    it. `treemaker-sequence` was deleted for good reason (PR #326), and
    `tests/fixtures/folding-sequence/` is orphaned data, not a feature.
  - **Folding any crease pattern except the Edit document.** A project holds
    exactly one (`nativeProjectDesigns.ts:42-53`), and the runtime holds one
    document handle (`oristudioCpRuntime.ts:46`). The "patterns" are regions of
    it. A Design tab's pattern reaches a diagram by Send to Edit.
  - **Orbiting a flat-folded form in 3D as vector art.** The kernel refuses to
    fold all-±180° creases in 3D (`session.rs:1145-1151`, `fold_is_flat`). A
    flat fold offers turn-over and rotate. For a tilted view, use Simulated.
  - **Carrying a diagram in a share link.** Share links carry one segment's
    sub-FOLD and are off on desktop.
  - **Editing what is inside an uploaded SVG.** The plan places it, poses it
    and draws over it, and nothing more. Editing happens in the user's own tool,
    through **Export picture… → Replace picture…** (D7).
  - Rich text, CMYK and PDF/X.
  - More than one diagram per project in v1.
  - Multi-select of steps and 2-D drag reorder in v1 (see "Later").

### Where the mockup and the engine disagree

| The mockup shows | What the engine can do today | What this plan does |
| --- | --- | --- |
| Drag to orbit "Folded form" for every step (az/el) | A flat fold has in-plane `rotation` and Front0/Back1 only. Only a 3D fold has a camera (`FoldedFigureCamera`). | **Flat:** Turn over and Rotate. **3D:** orbit plus Top / Front / Iso. **Tilted view of a flat model:** Simulated. |
| "Folded · 3D" at a fold % | A 3D fold is its final state only | Fold % exists only in Simulated |
| "Simulated 40%" chosen in the inspector | A simulation can be captured only from a live, mounted session | Crease pattern \| Folded form \| Simulated is a choice **inside Pose**. The inspector's Render rows are read-only. |
| CP picker "from the Edit workspace" | Patterns are regions of the one Edit document | The picker lists the Edit document's patterns, segmented in kernel space (D3) |
| Click a card's picture to open Pose | Touch and keyboard need click to select | Click selects; double-click or Enter opens Pose |
| Picture fitted to each cell | Real diagrams keep one paper scale | One shared paper scale by default (D10), with "Fit each step" as an option |
| PDF export | No PDF writer anywhere | Phase 0 spike, then D11 |
| Text in pages and PDF | No text font is bundled; SVG-as-`<img>` cannot load web fonts | One bundled TTF, embedded in every page and in the PDF (Decision 2) |
| Rail: Design / Crease Pattern / Simulator / Diagram | The real order is Edit, Design, Simulate, References | Diagram is the **fifth** entry, after References |
| az/el in degrees | Cameras are yaw/pitch radians, and the view cube calls face-on "Top" | Store `FoldedFigureCamera` / `SimulatorOrbitView`; show yaw/pitch in degrees |
| Hover buttons on a card | Touch has no hover | The same verbs live in the inspector, the context menu and on double-click |
| No way to reorder, insert or duplicate | A diagram needs them | Move earlier / later, an editable position, insert before / after, Duplicate |
| Mockup radii, uppercase section caps, raw controls | One `--radius`, `CollapsibleSection`, `components/ui` primitives | Built from the design system (see "The workspace, screen by screen") |

## Approach

### Evidence this plan rests on

Two rounds on 2026-10-02. First, eight read-only surveys of the code: the shell,
the document model, References, folding, export, UI, uploads and conventions.
Then six adversarial reviews of the first draft: two on accuracy, plus
feasibility, mockup coverage, security with external facts, and phasing. They
produced 106 findings, each folded into the decisions below. What they
established:

- **Registering a workspace means hand-editing about 25 sites, and many fail
  silently.** References was added in `da6d19a04` (78 files) and `dbdffcc8c`
  (31 files), and its D4 list (`reference-finder-integration.md:273-292`) names
  the traps. These sites are not compile-checked:
  - `applyDefaultLayout` (a void switch);
  - `parseWorkspacePath`, `workspaceForCommandId` and `WORKSPACE_BY_PANEL_ID`;
  - `VIEW_PANEL_ACTIONS` and `ALL_LAYOUT_SCOPES`;
  - `shortcutScopeLabel` / `shortcutCategoryLabel`: each has a `default` that
    returns raw English;
  - `viewportSurfaceForContext`: any unknown context resolves to the tree
    surface;
  - `STATIC_PANEL_CONTEXTS`: a missing panel resolves to a Design context, so
    TreeMaker's menus and undo come alive over the Diagram;
  - the `historySlice` undo/redo bail-out (`:474`, `:638`): a new context falls
    through to `undoTree` / `undoCreasePattern`, and Cmd+Z silently undoes the
    off-screen crease pattern;
  - `maskCapabilitiesForContext`.
- **Diagram is the first authoring workspace since Edit.** Simulate and
  References share `READ_ONLY_CONTEXTS`. Diagram needs:
  - its own mask arm;
  - its own undo arms and `historyCountForContext` arm;
  - its own **`edit.delete` enable input and dispatch arm**. A mask can only
    hide. Today `edit.delete` in an unknown context is disabled, and if it were
    enabled it would fall through to the TreeMaker tree's `deleteSelection()`
    (`menuActions.ts:554-606`).

  Capabilities are built in two places, `workspaceCapabilityInput` and the
  field-by-field `useWorkspaceCapabilities` hook. Both need the diagram inputs.
- **The keyboard runtime has one rule that shapes everything:** only viewport
  executors can decline a chord (`shortcutDispatcher.ts:176-200`). It runs in
  the capture phase and `preventDefault`s every chord it claims, and conditional
  scopes (`simulator`, `references`) sit *above* `viewport` and always claim. So
  any chord that a button, a tab strip or a radio group also uses (Enter, the
  arrows, Escape) must be a **declining viewport verb**, never a
  conditional-scope verb (D12).
- **The `.osf` format.** It is one pretty-printed JSON file (schema v8):
  - `workspace.designs[]`;
  - at most one `workspace.creasePattern`;
  - extension bags.

  Readers rebuild explicit literals, so an unnamed field is dropped. Images are
  base64 data URLs; there is no asset table. The house rules
  (`apps/web/docs/superset-features.md`) are: a typed field; no schema bump for
  an additive field; name every field in the reader. Two of its rules do not
  apply here:
  - **§3, the lossy-export registry.** A diagram is a *project* document like a
    design tab, and no CP or BP export ever carried one.
  - **§6, the shared snapshot history.** Like each design, the diagram owns its
    stack, gated by editing context.

  The one save path that could silently drop a diagram is `.ori` Cmd+S (D16).
- **Save routing keys off design tabs only.** `saveActiveProject`
  (`projectSlice.ts:1971-1982`) calls `saveNativeWorkspaceProject` when a design
  tab has a kind, and otherwise `saveEditableCreasePattern`, which fails without
  a CP. Every replacing effect of a CP-only open lives inside
  `loadNativeCreasePattern`. A diagram-only project therefore needs its own save
  branch and its own open branch (D16).
- **The headless fold helper is the right idea but the wrong shape.**
  `lib/creaseExportFold.ts` `foldSegmentForExport` folds one pattern for the CP
  export without adding anything to the document, its undo or its dirty flag.
  It cannot back a pose session as is:
  - it frees the kernel handle in its own `finally`;
  - its runtime has no `setModel` (so no turn-over without refolding) and no
    `runId`;
  - its store bindings are a private literal in `projectSlice.ts`
    (`foldExportSegment`) that deliberately passes `FOLD_RUN_NONE`;
  - it drops the kernel `outcome`.

  The plan splits it into primitives that both the export and the Diagram use
  (D4). For 3D, `fold3dOristudioCpDocument` returns its render model directly,
  with no canvas entry, and `folded3dFigureScene` builds a vector scene at any
  camera, synchronously.
- **Two segmentations, two coordinate spaces.** Simulate's segments come from
  `foldArtifacts`, which after a file open is the import pipeline's fold scaled
  to the unit square. `ensureCpSegmentationArtifacts` segments the kernel's own
  FOLD in document coordinates, and `CpSelectionToolbar` uses it. Mixing them
  without `cpModelToFoldTransform` attributes no crease to any pattern
  (`creaseExportFold.ts:155-168`).
- **A simulation can be exported as a vector scene only from a mounted
  session.** `useSimulatorRuntime.beginExport()` → `snapshot.scene(options)` (the
  worker's `exportScene` underneath) works, and
  `useSimulatorRuntime` keeps its session token private. A new session seeds its
  camera from the last one (`simulatorSession.ts:391-396`).
- **Captured 3D and simulated scenes bake their light.** `project3dScene` takes
  its light from the app's display style, not from an argument
  (`folded3dReproject.ts:53-55`). The diagram must build 3D scenes through
  `folded3dFigureScene` with its own style, and record a style key.
- **References steps are plain JSON.** Every card is a `StepDiagramModel`
  (`{sheet, primitives}`) made by pure functions in the **unit frame**. Each
  `ReferencesFilmstripStep` row already carries it, with `mirrored`, the
  sentence and the reader's chosen ways. `referencesExportSteps` yields the
  **model frame** instead. `referencesStepScene` builds at page scale on
  purpose: built at a card's size, "a 41 mm step shrank a 160 mm view's arrows
  to a quarter of their weight".
- **The painter scales markup whole, strokes included,** while every scene
  line keeps its pen's pt width (`paperSvg.ts:243-292`). It places markup only
  by a uniform scale plus a shift. Symbols must therefore be compiled at the
  target scale on each paint. M/V lines must be scene lines with pen roles, not
  markup.
- **The symbol vocabulary is half built.** `stepDiagramGeometry.ts` /
  `DiagramPrimitives.tsx` / `diagramInk.ts` cover:
  - fold-and-unfold arrows (60° arc, notched head; a port of
    RefDgmr::CalcArrow);
  - the turn-over glyph;
  - rings, letters, and dashed valley, mountain and dotted pens;
  - file output with ink written inline.

  Missing: the one-way fold arrow, the mountain arrow (a single-sided hollow
  head, per Lang's Yoshizawa–Randlett notes), push/sink (straight, hollow,
  cleft-tailed), rotate (a circle with arrows and a fraction), a turn-over
  oriented to its axis, and a hidden-line role.
- **Pages, print and fonts are new.** There is no print-paper model, page
  layout, bleed or crop mark, and **no text font is bundled**: exports use a
  system font stack, and an SVG shown as `<img>` cannot load web fonts. The
  repo has **no PDF writer**. What exists:
  - `paperSceneSvgBody` places one scene in a page another writer owns;
  - `savePaperExportZip` + `zipPages` (fflate, lazily loaded) write ZIPs;
  - `ExportModalFrame` is the shared dialog chrome and is already a shortcut
    barrier.

  External facts, checked:
  - jsPDF 4.2.1 is current and MIT. Six CVEs were fixed in 4.1.0–4.2.1.
  - svg2pdf.js 2.8.1 is current and MIT. It has no `mask` or `filter`, parses
    `stroke-dashoffset` with `parseInt`, and does not run under jsdom.
  - jsPDF writes TrimBox/BleedBox through `getPageInfo(n).pageContext`, and its
    font loader subsets TrueType (`glyf`) only.
  - krilla (Typst's PDF backend, Rust) has trim and bleed boxes and CFF
    subsetting.
- **SVG upload is unsafe and partly broken today.** There is no SVG sanitizer,
  and **the web build ships no Content-Security-Policy**. An SVG inlined into
  the DOM would run its script on the web, and a `blob:` URL opened in a new tab
  runs same-origin. Measured in Chromium 152:
  - `createImageBitmap(svgFile)` throws. (Since fixed on `main` by PR #427:
    `lib/svgImage.ts` reads an SVG's size and draws it through `<img>`; the
    diagram's upload path reuses its decoding and size helpers.)
  - a viewBox-only SVG in `<img>` reports 300×150.

  The painter concatenates `PaperMarkupItem.svg` raw. **The `.osf` scene
  validator passes `markup` items through verbatim** (`nativeProjectFile.ts:865-868`),
  so a crafted file can inject markup into every composed page. Only References
  generates markup today, and stored scenes never legitimately carry any.
- **No CP annotation component can be reused.** `CanvasObjectOverlay`,
  `CpTextAnnotationLayer` and `textEditSession` are bound to the one WebGL CP
  canvas. These parts carry over:
  - `useViewportSurface` (SVG/DOM pan and zoom, with a declining executor);
  - `createGestureBracket<S>`;
  - `snapshotHistory`;
  - `distanceToSegment`;
  - the `CpDetectCropEditor` picture-plus-handles pattern.
- **Most of the design-system UI exists.**
  - `fieldRows`, `CollapsibleSection`, `SegmentedControl`, `WorkspaceTabStrip`
    (embedded, tone `peers`), `SplitButton`;
  - `ViewportToolbar` (its presets are fixed at 25–400%), `ViewportStatusReadout`,
    `CanvasContextBar`, `Toolbar`, `GestureSlider`, `ExportModalFrame`, sonner.

  Missing:
  - a textarea row;
  - a picture-option card;
  - a notice row;
  - a generic grouped tool rail (`CpToolRail` is tied to the CP catalog);
  - a step card;
  - a page view.

  `SheetGrid` is single-column outside workspaces with prefixed overrides, and
  `sheet-grid` is a shared global block.

### Decisions

**D1. The diagram is a project-level document.**
- **File.** A typed field `workspace.diagram: DiagramDocument | null`, typed
  from `diagram/document/diagramDocument.ts` (see Contracts).
  - Both writers emit it (`createNativeProjectFile`,
    `createNativeCreasePatternProjectFile`).
  - `validateV8` names it, and `migrateLegacyToV8` defaults it to `null`.
  - Decision 3 sets the reader version.
- **Store.** A new `slices/diagramSlice.ts` holds:
  - `diagram: DiagramDocument | null`;
  - `diagramHistory: SnapshotHistory<DiagramDocument>`;
  - `diagramLoadId`, bumped on every replace, so late async work can tell;
  - `diagramReadOnly` and `diagramRaw`, for a document from a newer build
    (Contracts › The validator);
  - UI-only state (D14), outside history.
- **Reset.** A compile-enforced `DIAGRAM_SCOPED_KEYS` tuple plus
  `discardDiagramState()` in `store/workspaceStore/diagramState.ts`, modelled on
  `CP_DOCUMENT_SCOPED_KEYS`. It also cancels any open capture session and ends
  the diagram's edit sessions. It is spread at every project-replacing site:
  - `createNewProject` (unless `preserveEditCanvas`);
  - `loadStarterProject` and `createNewCreasePattern`;
  - `loadText` (keyed on `replacesProject !== false`, like
    `discardAllDesigns`);
  - the replacing branch of `loadCreasePattern`;
  - BP create, open and `loadOristudioBpExample` (unless `preserveEditCanvas`);
  - the **first** `set` of `loadNativeProject`, beside `nativeProjectExtensions`.

  `loadNativeProject` then installs `workspace.diagram` (null included) **in
  every branch**: design, the CP-only early return, and the new diagram-only
  branch (D16). It is **not** spread at `clearOristudioCpDocument` or at
  self-provisioning. `initEngine`'s early-return guard gains
  `|| get().diagram !== null`, so a diagram started on a cold `/diagram` keeps
  its dirty flag. A store test asserts each entry point.
- **One diagram per project in v1.** Widening to `diagrams[]` later is a
  two-line migration.

**D2. A step owns its picture and remembers where it came from.**
- **The step.** A step is `{ id, source, picture, annotations, text,
  breakBefore }`. Its number is its position; numbers are never stored.
- **The picture.** `picture` is the captured result:
  - a stored `PaperScene` for crease-pattern, folded, 3D and simulated pictures;
  - a `StepDiagramModel` for References steps, re-painted at each target scale;
  - an asset reference for uploads;
  - a `fixed` SVG for a fold with no layer order, drawn from the kernel's
    transparent development, for which no `PaperScene` exists.
- **Stored scenes are small and inert:**
  - hidden items are dropped at capture (pages never show buried faces);
  - coordinates are quantized to 0.01 scene px;
  - the scene is persisted as **one compact string field** (`sceneJson`), so
    the `.osf` pretty-printer cannot put every coordinate on its own line;
  - the shared validator **drops `markup` items** (D7);
  - each scene carries its **paper scale** (scene px per document unit) when its
    source has one, for D10's shared scale;
  - a per-step budget (2 MB serialized, to be confirmed by Phase 0's
    measurements). Over budget, the capture simplifies (drop hidden items, merge
    coplanar faces). If it is still over, the picture becomes a **raster**: a
    `raster` asset with `picture: {kind: 'asset', assetId, paperScale, key}`,
    PNG at 300 dpi of a fixed 80 mm box (`CAPTURE_RASTER_BOX_MM` in
    `captureFolded.ts`), with a "Too detailed to keep as vector" notice.
  - `diagramHistory` evicts its oldest entries past a byte cap as well as past
    100 entries. A diagram-side `trimDiagramHistory(history, maxBytes)` in
    `diagramState.ts` runs after `recordSnapshot`, so the shared
    `snapshotHistory.ts` and BP are unchanged.
- **Link status** is derived, never stored. The precedence is D3's:
  - `current`;
  - `stale` (the creases changed: offer **Refresh**);
  - `missing` (no pattern matches: offer **Relink**);
  - `unknown` (no CP is loaded, or the kernel-space segmentation is not ready).
- **Provenance is never refreshed on load**, or a diagram whose CP changed
  would reopen looking fresh (the trap in `persist-inline-simulations.md`).
- **Insertion rule.**
  - Every add goes **after the selected step**, or at the end when nothing is
    selected. This covers Add step, Upload, drop on the grid, Add to diagram,
    Send to diagram and Send all.
  - The new step or steps become selected.
  - A single add onto a selected *empty* step fills that step.
  - A cross-workspace add shows a toast, "Added as step N", with **Open
    diagram**, and never switches workspace by itself.

**D3. A pattern source is linked geometrically, in kernel space.**
- **One segmentation.** The picker, capture and link status all use
  `ensureCpSegmentationArtifacts(document)`: kernel space, the one
  `CpSelectionToolbar` uses. The Diagram's `SheetGrid` items are built from it,
  never from `foldArtifacts`. Where the simulator's `foldArtifacts` must be
  used (D5, Simulated), the region is matched through
  `cpModelToFoldTransform(fold, document)`.
- **How a step's creases are chosen** is recorded with the step:
  - **Segment-sourced steps** (picked in the Diagram) store a `RegionReference`
    `{boundary, bounds, segmentIdHint}`, with no fingerprint of its own. To
    refresh, they resolve the region to a segment, then
    `foldableLineIdsForSegment`.
  - **Figure-sourced steps** (Add to diagram on an Edit folded figure, possibly
    a partial selection) store the figure's refold bounds and refresh by
    `reselectFoldableLineIds(document, bounds)`, exactly as Edit refolds
    (`creasePatternSlice.ts:3095`).
  - In both, the fingerprint is `foldedSourceFingerprint` over **exactly the
    line ids that were folded**, taken from the same document snapshot at fold
    start, never at Done. A new step can never read stale.
- **Status precedence:**
  1. A segment-sourced step whose region finds no boundary match is
     `missing`. Refresh is disabled in favour of Relink.
  2. Otherwise a step is `stale` exactly when the fingerprint of the re-chosen
     lines differs.
  3. A figure-sourced step whose reselected set is empty is `missing`. Its
     Refresh asks first, naming the box, and Simulated is unavailable for it,
     with a tooltip, because it has no region.

  Figure-sourced status needs only the store's document snapshot
  (synchronous). Segment-sourced and References status wait for segmentation.
- **Shared code.** `RegionReference` is a new type carved out of
  `InlineSimulation`'s `sourceBoundary`, `sourceBounds` and `segmentIdHint`
  fields. It moves to `cp-workspace/regions/regionReference.ts` with its
  helpers and validators:
  - `ringsMatch` and `boundariesMatch`;
  - `resolveInlineSimulationSegment`, which becomes `resolveRegion(ref,
    segments)`, with a thin adapter so inline simulations keep working.

  **Never fall back to the nearest region** (`:420-430`).
- **Known limit:** moving or rotating a whole sheet in Edit makes the step read
  as `missing`, and Relink is the answer.

**D4. Capture is headless, cancellable, owned and never on open.**
- **One capture runtime, shared with the CP export.**
  - `lib/creaseExportFold.ts` is split into `openFold(runtime, lineIds, {model,
    runId})` → `{handle, outcome, discoveredCases, displayStyle}`,
    `readFoldedPicture(runtime, handle, displayStyle)` and the caller-owned
    `free`.
  - `foldSegmentForExport` becomes open → read → free over them, so the CP
    export output and its goldens do not change.
  - The runtime gains `setModel(handle, model)`, `foldAnother(handle, runId)`,
    `outcome` and a `runId` on every fold.
  - The store bindings move out of `projectSlice`'s private `foldExportSegment`
    into an exported `store/workspaceStore/cpFoldRuntimeBindings.ts`
    (`createCpFoldRuntime(runId)`). The export keeps `FOLD_RUN_NONE`, and so
    keeps skipping the kernel's rollback snapshot.
- **The capture model** sets `rotation: 0, scale: 1` (colours may still come
  from Oriedita metadata), so a step's `rotationDeg` is its only rotation.
- **The route** (flat or 3D) is `resolveFoldRoute(document, lineIds)`, as in
  Edit.
  - **Flat:** `openFold` → `foldedFlatPaperScene(kernelScene)`.
  - **3D:** `fold3dOristudioCpDocument(lineIds, …, runId)` returns `render`
    directly. It is kept in the session and **never** registered through
    `setFolded3dRenderModel`.
  - **No layer order:** `outcome` `NoSolutions` / `Contradiction` becomes a
    `fixed` picture from `foldedFigureExportDocument(snapshot)`, passed through
    `svgSanitize` at capture, which keeps only `documentElement` and so strips
    the `<?xml?>` declaration. The notice is worded from the flat-verdict
    strings.
  - **3D refusals** use `fold3dRefusalMessage`. `foldedFigureNotice()` itself
    needs a canvas entry and is not called.
- **A capture session** (`diagram/useDiagramCaptureSession.ts`) owns the
  handle while Pose is open:
  - it calls `retainFoldedFigureHandle` on open and `release…` on every exit;
  - it records `foldedFigureHandleEpoch()` and aborts if that changes;
  - it subscribes to `onEngineLost('oristudio-cp')`. It rejects its in-flight
    capture, because a call on a dead client never settles, and stops the
    Refresh-all queue. It forgets the handle without freeing it, because kernel
    slots are reused after a restart.

  Turn-over is `setModel({state: 'Back1'})` and a re-read, with no refold. Next
  solution is `foldAnother` on the held handle.
- **Fold runs are visible and stoppable from anywhere.** `withFoldInFlight`
  moves out of `creasePatternSlice` into a shared module. Diagram captures
  register in `oristudioCpFoldRuns` under new kinds `'diagram-capture'` and
  `'diagram-refresh'`, so the global "Folding…" toast and Stop work in every
  workspace. Binding a `runId` costs a kernel rollback snapshot per step; this
  is accepted for user-visible folds and documented.
- **Async results and history.** A capture commits through `commitDiagram`
  **by step id** and is discarded when:
  - the step is gone;
  - its `source` revision changed since the run started;
  - `diagramLoadId` changed.

  The capture session and every text-edit session register with
  `registerCanvasSessionEnder`.
  - **The capture session.** On `'history'` it cancels its in-flight capture
    (`cancelFoldRun`). On a CP `'document-replaced'` it cancels and frees,
    because its handle came from that CP.
  - **Text sessions.** On both `'history'` and `'document-replaced'` they commit
    the pending edit: a CP replacement is not a diagram replacement.
- **Never on open, never silently in bulk.** Opening a diagram never folds.
  **Refresh all out-of-date steps** covers folded and crease-pattern steps only:
  - it runs one at a time, yielding between steps;
  - it pauses while Edit is the active workspace;
  - it records **one** history entry when the queue ends;
  - it asks first if a redo branch would be lost.
- **Pose exits.** Done, Escape, ← Steps, prev / next, `[` / `]` and the switch
  to Annotate each **capture if the pose changed** (one history entry, "Adjust
  pose") and then free. **Revert** in the Pose bar discards. Unmounting is
  Cancel: a workspace switch, a dock clear, `discardDiagramState` or New / Open
  all cancel the run and free the handle. **Undo or redo while Pose is open**
  (`'history'`) cancels any in-flight fold and discards an uncaptured pose
  before the history step is applied. It then frees the handle and returns to
  the step summary.

**D5. What "pose" means depends on the picture.**

| Step picture | Pose controls | Captured as |
| --- | --- | --- |
| Crease pattern | Rotate (15° steps plus a field) | `buildCreaseExportArtwork` for the segment, diagram pens → `PaperScene` |
| Folded, flat | Turn over, Rotate, Next solution | `foldedFlatPaperScene`, rotated through its `toScenePx` affine (no markup involved) |
| Folded, 3D | Orbit (drag), Top / Front / Iso, view cube, turn over (`antipodalCamera`) | `folded3dFigureScene(…, render, {style: diagramStyle})` |
| Simulated (segment-sourced only) | Fold %, restart / play / step, orbit, presets | the mounted session's `beginExport()` → `snapshot.scene({style: diagramStyle, markHidden: true})` |
| References step | Turn over (the `mirrored` flag) | the snapshot model, re-painted |
| Uploaded picture | Rotate 90°, mirror | the source's fields, applied at paint time as an inner `<g transform>` around the asset's markup, with bounds rotated. The shared asset is never rewritten. |

- **Interactive views reuse existing pieces:**
  - `SimulatorViewport` (view cube, `initialView`, `setView`, double-click
    reset);
  - `useFolded3dMeshRuntime`, with a CPU fallback that rebuilds the scene per
    move where the worker has no WebGL2;
  - `useSimulatorRuntime` + `FoldPlayhead` for the transport.
- **Choosing a mode in Pose.** Pose's switch is Crease pattern | Folded form |
  Simulated (Simulated from Phase 8), for any pattern source. *(D19, added
  2026-10-03, makes this choice first-class: it is also in the Step pane, the
  pattern picker and the card, and each way of showing remembers its pose.)*
  - **Folded form** opens the capture session: a visible `'diagram-capture'`
    run, routed by `resolveFoldRoute`.
  - **Crease pattern** recaptures through `buildCreaseExportArtwork`, with no
    fold.
- **Simulated** drives `buildSegmentSimulationFold(foldArtifacts, segment)`
  (`foldArtifacts ?? await ensureFoldArtifacts()`), with the stored view pushed
  through `setCamera` before `beginExport()` → `snapshot.scene({style:
  diagramStyle, markHidden: true})`. An empty `faces_vertices` disables it with
  the "unavailable" copy `addOristudioCpInlineSimulation` uses. It is captured and refreshed **only
  inside a mounted Pose**, so Refresh on a simulated step opens Pose. When the
  inline simulations are already at `MAX_CONCURRENT_SIMULATIONS`, the Simulated
  segment is disabled with the existing "too many simulations" copy.
- **Light.** 3D and simulated pictures record `styleKey =
  folded3dSceneStyleKey(diagramStyle)`. When the diagram's light or pens
  change:
  - **3D pictures** show "Lighting changed — Refresh" and join the Refresh
    queue;
  - **simulated pictures** show "Lighting changed — Pose again" and are skipped
    by Refresh all, because they are captured only inside a mounted Pose (D4).
- **Pose readouts.** The Pose bar shows yaw/pitch in degrees, which is what the
  mockup calls "az/el".

**D6. A References step is a snapshot.**
- **The verbs.** **Send to diagram** and **Send all to diagram** become
  registry shortcut ids (`ReferencesShortcutId` / `REFERENCES_SHORTCUT_IDS`),
  commands in `buildReferencesActions`, and a binding in a new
  `useReferencesSendToDiagram.ts` beside `useReferencesStepExport`. The binding
  is a hook because AGENTS.md's panel table puts store bindings for verbs there,
  not in a panel.
- **What is captured, from the filmstrip rows only** (`planFilmstrip` /
  `candidateFilmstrip` output, which already reflects ways and twins; never
  `referencesExportSteps`, which is model frame):
  - the unit-frame `StepDiagramModel`;
  - `mirrored`;
  - the sentence, as the step's default instruction (frozen in the current
    locale and editable);
  - provenance: the sheet's `RegionReference` and a **per-sheet** fingerprint
    (`sourceFingerprintFor(document, sheetBounds)`), the four planner settings
    (a `ReferencesPlanSettings` type defined in `diagramDocument.ts`), the mode,
    the card number and step `line {n,d}`. `loadSerial` is never part of a
    persisted key.
- **Which cards.** Send all skips the `done` card. Find-mode RF cards convert
  through `referenceFinderDiagramToPrimitives`. A `StepDiagramAdapterError`
  shows an error toast, never a blank step.
- **Painting.** Each paint builds at the target's own scale through
  `createOverlayProjector` with `ey: [0, −scale]` (the unit-frame y-flip,
  mirrored about the sheet's middle when `mirrored`) and
  `canvasDiagramInk` / `canvasDiagramPens`. In effect this is
  `referencesStepScene` with the y axis flipped, so marks keep their pt weight
  at card, cell and file sizes.
- **Staleness.** A changed sheet shows "Pattern changed since this step was
  sent" with **Open in References**. That is
  `openReferencesWorkspace({sheetBoundary})`, which resolves the sheet through
  `resolveRegion`. There is no automatic re-plan: it costs seconds to minutes
  and cannot promise the same step.
- **From the Diagram side.** **From References…** (on the empty card and in the
  Step pane) sets a latched `diagramReferencesTargetRequest {stepId}`, then
  activates References. The next Send to diagram fills that step.

**D7. Uploads are sanitized, stored once, and displayed only as images.**
- **Picking files.** A new `FileService.openBinaryFiles` (browser `multiple:
  true`, Tauri `open({multiple: true})`) runs inside the click handler, and a
  multi-file drop works the same way.
  - Files become consecutive steps under the insertion rule, in natural
    filename order (step-2 before step-10), as one history entry.
  - Per-file failures are summarised in one toast.
  - Never `openTextFile`: on the web it registers a save target.
  - `mimeTypeFromFilename` gains `svg`; files are also classified by extension.
- **Size caps run before anything is read whole.**
  - On the web: `File.size`.
  - On desktop: `read_binary_file` gains an optional `max_bytes`, so the shell
    stays thin. The default is 2 MB per SVG and 20 MB per raster.
- **Drop.** The Diagram surface claims image drops itself (dragover →
  `preventDefault`; drop → consume + `stopPropagation`), the way
  `useCpAnnotations` does. The shell target's copy ("onto the crease pattern")
  would be wrong here.
- **Sanitizer** (`diagram/upload/svgSanitize.ts`). It **builds a fresh tree and
  never mutates one in place**:
  1. Parse with `DOMParser('image/svg+xml')`. Reject a `parsererror` or a root
     that is not SVG.
  2. Copy only Element nodes whose `namespaceURI` is SVG and whose `localName`
     is in the allowlist. Create them with `createElementNS(SVG_NS,
     localName)`, with no prefixes. The allowlist is: `svg, g, path, rect,
     circle, ellipse, line, polyline, polygon, text, tspan, defs, clipPath,
     linearGradient, radialGradient, stop, pattern, marker, symbol, use, title,
     desc, image`. Copy Text and CDATA as text. Drop comments, PIs and the
     doctype.
  3. Handle structural wrappers:
     - `switch` keeps its first child that is not a `foreignObject` and has no
       `requiredExtensions` / `systemLanguage` (Illustrator's "Preserve
       Editing" output);
     - `a` unwraps to its children;
     - `foreignObject`, `script`, `style`, `metadata`, SMIL, `filter` and its
       primitives, `iframe`, `object` and `embed` drop with their subtree;
     - `mask` drops with its subtree under PDF route (A), whose svg2pdf.js
       cannot draw it. If Decision 1 picks (C), `mask` joins the allowlist,
       limited to `url(#id)` references.
  4. **Attributes** come from a per-element allowlist of null-namespace names:
     geometry, presentation properties, `transform`, `viewBox`,
     `preserveAspectRatio`, `id`, `xml:space`.
     - `href` is read by namespaceURI + localName, from the null or the XLink
       namespace, and written back as a plain `href`. It is kept only as
       `^#[A-Za-z_][\w.:-]*$`, or on `image` as
       `^data:image/(png|jpeg|webp);base64,…`.
     - Every `url(…)` must be `url(#id)`, or the declaration is dropped.
     - The `style` attribute is parsed into declarations against a property
       allowlist (Inkscape keeps all its styling there). `<style>` rules are
       inlined into those declarations when they are simple selectors, and
       dropped otherwise.
  5. **Embedded rasters** are size-checked from their IHDR/SOF headers and
     re-encoded through the `importImageFile` canvas path (≤ 2048 px, WebP →
     PNG), or the image is dropped.
  6. **`<use>` expansion is capped** at 50k instantiated nodes, and cycles are
     rejected.
  7. **Ids are prefixed** per asset, and `url(#…)` / `href="#…"` are rewritten,
     so twelve uploads on one page never share a `#clip1`.
  8. A `viewBox` and explicit width/height are ensured.
  9. Only `documentElement` is serialized.

  It returns a **report** of anything dropped that changes the look (mask,
  filter, unknown elements). The upload shows it as a Notice ("Masks and
  filters aren't supported; this picture was flattened").
- **Storage.**
  - **Format.** The diagram's `assets` table holds sanitized SVG as UTF-8 text,
    and PNG / JPEG from `importImageFile` (2048 px cap, re-encoded) as data
    URLs. Steps refer to an asset by id, so undo snapshots and duplicates share
    the bytes.
  - **Load.** On load every SVG asset is **re-sanitized**. A raster `src` must
    match `^data:image/(png|jpeg);base64,…`, and its header dimensions must
    equal the stored size and stay ≤ 2048 px, or the asset is dropped.
  - **Save notice.** The 25 MB notice moves into a shared `savedMessageFor()`
    that counts CP images, diagram assets and scenes on **both** save paths.
- **Display and composition.**
  - Painted pictures and pages are shown through **`data:image/svg+xml` URLs in
    `<img>`**, the `CreaseExportDialog` precedent, whose documents get an opaque
    origin. They are never shown through `blob:` URLs, which open same-origin in
    a new tab. No uploaded or file-supplied markup ever reaches the live DOM.
  - Stored scenes never carry markup. `lib/paper/paperSceneValidate.ts` drops
    `markup` items by default, for Edit's folded figures too, which closes the
    same hole there. Dropping them is lossless: only References emits markup,
    and never into a stored scene. **`fixed` pictures are re-sanitized** on load
    like SVG assets. Symbols (annotations and References marks) are generated
    from data at paint time.
  - An upload is composed as a nested `<svg viewBox>` inside a markup item, so
    it stays vector in SVG and PDF output.
- **Round trip for hand edits.** **Export picture…** (per step) writes the
  picture alone, with no annotations, number or text. **Replace picture…** is
  available on any step: the step becomes an upload and keeps its text and
  annotations, which get the "picture changed" notice. Together they make "edit
  it in Inkscape" one action each way.

**D8. Annotations are their own model, compiled into the shared step-diagram
vocabulary at paint time.**
- **Model.** `DiagramAnnotation` is `{ id, kind, from, to, bend?, text?,
  rotate?, axis? }`.
- **Picture units.** Coordinates are in picture units: origin at the picture's
  frame's top-left, one unit equal to the frame's longer side. The frame is the
  post-pose picture bounds for scenes and uploads, and the **sheet frame** for
  References pictures, whose painted bounds move with label layout.
- **Kinds:**
  - `valley-arrow`, `mountain-arrow` and `fold-unfold-arrow`: a 60° arc and a
    notched head. The mountain arrow takes a single-sided hollow head.
    `fold-unfold-arrow` is the arrow References already draws and the commonest
    in real diagrams.
  - `push-arrow`: straight, hollow, cleft-tailed.
  - `rotate`: a circle with arrows and a fraction, with `rotate: {amount:
    'eighth' | 'quarter' | 'half', direction: 'cw' | 'ccw'}`.
  - `turn-over`: with `axis: 'vertical' | 'horizontal'`.
  - `valley-line`, `mountain-line` and `hidden-line`.
  - `label`: placed with one click, so `to = from`, at a fixed size in picture
    units.
- **Shared primitives.** The missing glyphs become new `StepDiagramPrimitive`
  kinds, with geometry in `stepDiagramGeometry.ts`, so References can draw them
  too. They land as their own commit series, with References goldens.
- **Painting.** Annotations compile per paint, at the target's scale, inside
  `paintStepSvg` and the page composer:
  - valley, mountain and hidden lines become `PaperLineItem`s with roles
    `diagram-valley`, `diagram-mountain` and a new **`diagram-hidden`** role
    (added in `packages/origami-simulator` `paperScene.ts`, the painter's
    `LINE_ROLES` and `penForRole`, and the `.osf` validator's `sceneLineRole`),
    so they take the same pens as step lines;
  - arrows, glyphs and labels become one markup item, built by `diagramShapes`
    with `inline` ink and no paper outline, which skips the dual-ink clip.
- **When the picture changes:**
  - **A pose delta the app applied** is carried onto every annotation, and
    `annotatedPictureKey` is updated. Such a delta is a rotation about the
    centre, a quarter turn or a mirror, including a References step's Turn
    over, which only toggles `mirrored` about the sheet's middle.
  - **Anything else** leaves annotations in place: a refold, Refresh, a camera
    or fold-% change, a fold's turn-over (a different side), or a replace. Annotate then shows "The picture
    changed since these annotations were drawn" until they are touched.

**D9. One paper style for the whole diagram.**
- **The surface.** A new `PaperSurface 'diagram-workspace'` with its own policy
  in `PAPER_STYLE_POLICIES`. It lands in Phase 2, before anything is painted.
- **The stored style.** The diagram stores `style: { preset: BuiltInPaperPresetId }
  | { style: PaperStyle }`. It defaults to the built-in **Diagram** preset:
  Origami House ink and diagram-crease pens. A user preset or the export slot
  is resolved to a full `PaperStyle` when chosen, so the printed diagram never
  depends on the viewer's machine. The Page tab uses a small style control
  whose value is a resolved style. It does not reuse `PaperStylePicker`, whose
  value is a device-local key and which wears the export modal's classes.
- **Scope.** Ink and pens apply to every step at paint time. Light applies at
  capture (D5).

**D10. Pages come from one pure layout, at one paper scale, and the screen
shows the composed page.**
- **Print paper** (`diagram/pages/printPaper.ts`):
  - sizes `a4` 210×297, `a5` 148×210, `b5-jis` 182×257 (labelled "B5 (JIS)"; a
    CSS `B5` keyword would be ISO 176×250) and `letter` 215.9×279.4 mm;
  - orientation, and margin 0–30 mm.

  It is deliberately not called `PaperPage`, which is the artwork's page.
- **Layout** (`diagram/pages/diagramPageLayout.ts`, pure). It returns pages,
  then cells, each with `{step, cellMm, pictureMm, numberAt, textLines,
  textOverflow}`, plus the flow band, header and footer. The mockup's `layout()`
  is the reference:
  - grid vs. flow (boustrophedon);
  - header 11 mm and footer 8 mm;
  - picture `min(cellW−6, cellH·0.64)`;
  - text 3.2 mm at 4.1 mm leading;
  - odd page numbers on the right;
  - a step's `breakBefore` starts a new page.
- **Scale policy.** `page.scale` is `'paper'` (default) or `'fit'`.
  - Under `'paper'`, every picture with a paper scale is drawn at one shared mm
    per document unit: the largest at which the biggest such picture fits its
    cell. Pictures with a paper scale are crease-pattern, folded and References
    steps (a References sheet's size comes from its provenance region).
    Uploads, and simulations whose camera has no orthographic scale, are fitted
    to their box.
  - Under `'fit'`, every picture is fitted, as in the mockup.

  Phase 3 confirms which captures keep paper units.
- **Text.**
  - **Measurement** is injected. The app measures with the bundled font's
    metrics, after `document.fonts.load` (Decision 2); tests use a CJK-aware
    estimate.
  - **`lib/paper/textWrap.ts`.** `wrapExportText` moves out of `creaseExport.ts`
    to here and iterates by code point (`Intl.Segmenter`), breaking between CJK
    characters. The CP export keeps using it, and its goldens stay green.
  - **Overflow.** Text that does not fit is truncated with an ellipsis. The cell
    reports `textOverflow`: the card shows "Text doesn't fit on the page", the
    Pages overlay marks the cell, and the export Notice lists those steps.
  - **XML escaping.** A new `xmlText()` beside `escapeXml` strips XML-illegal
    code points and lone surrogates. The validator normalizes text, title and
    label strings the same way on load.
- **Composer** (`diagram/pages/composeDiagramPage.ts`). It turns a layout page,
  the step pictures and the style into one page SVG in pt:
  - `paperSceneSvgBody` per cell, with a uniform projection, plus annotation
    lines and markup compiled at the cell's scale (D8);
  - the step number and text as `<text>` in the bundled font, embedded once per
    page as `@font-face{src:url(data:font/ttf;base64,…)}`;
  - header, footer and flow band;
  - an **empty step** keeps its number and text and leaves its picture box
    blank. The placeholder, the margin guide and the selection ring are
    **overlay only**, never in the file;
  - bleed and crop marks when asked (D11).
- **Pages view.** Each composed page is shown as a data-URL `<img>`, built
  lazily for visible pages, so the screen *is* the file. Transparent hit
  rectangles from the layout sit over it: click selects, double-click opens
  Pose, and a click outside any cell reveals the Page tab. A "Page N" caption
  sits under each page.

**D11. Export: step files, and a PDF through krilla (route C, decided after Phase 0).**
- **The dialog.** `DiagramExportModal` in `ExportModalFrame`, with a preview and
  pager (page *N* or step *N*) beside the options. It keeps the house preview
  pane, which the mockup drops, because the preview is the contract. A new
  `DiagramExportOptions` module holds the option rows; never add rules to
  `.export-modal`.
- **Step files (ZIP)** go through `savePaperExportZip`:
  - one SVG or PNG per step, named `<slug>-step-NN.<ext>` and zero-padded to
    the width of the step count;
  - PNG at 300 or 600 dpi, with its "W × H px at N dpi" note checked against
    `pngCanvasLimits`. The background follows the paper style;
  - optional step number and instruction text;
  - "Same size for every step" keeps D10's shared paper scale inside a fixed
    W×H mm canvas; off crops each file to its drawing;
  - steps with no picture are skipped and listed in the Notice ("…will be
    skipped").
- **PDF.** Every composed page, in order. Steps with no picture print as blank
  space ("…will print as blank space").
  - **At home:** MediaBox = trim. No bleed, marks or boxes; otherwise
    identical.
  - **Print shop:**
    - MediaBox = trim + 2 × (3 mm bleed + 5 mm slug);
    - BleedBox = trim + 3 mm, and TrimBox = trim;
    - artwork that touches the trim (the page background, the flow band)
      extends into the bleed;
    - crop marks are 0.25 pt black lines from 3 to 8 mm outside each trim
      corner.
- **The writer is route (C), krilla** (decided 2026-10-02). Routes (A) and (B) are kept below for the record:
  - **(A) jsPDF + svg2pdf.js**, lazily loaded behind a guarded import (the
    `zipPages` / `loadFflate` pattern). It saves a real `.pdf` through
    `saveBinaryFile` on both surfaces. If chosen:
    - **Versions.** `jspdf@^4.2.1` and `svg2pdf.js@^2.8.1`.
    - **Allowed calls.** `diagramPdf.ts` may use only `new jsPDF`, `addPage`,
      `svg`, `addFileToVFS` / `addFont`, `setDocumentProperties` (escaped) and
      `output('arraybuffer')`. It never uses `addJS`, AcroForm,
      `addMetadata`, `html()`, or `output()` options carrying user data. A test
      asserts the import surface.
    - **The svg2pdf call.** `doc.svg(new DOMParser().parseFromString(page,
      'image/svg+xml').documentElement, {loadImages:
      /^data:image\/(png|jpeg|webp);base64,/i, loadExternalStyleSheets:
      false})`. The element is never attached to the document.
    - **Dash offsets.** The PDF composer bakes dash centring into geometry with
      `stroke-dashoffset="0"`, because svg2pdf truncates fractional offsets.
    - **Testing.** svg2pdf does not run under jsdom, so it is tested by
      `scripts/diagram-pdf-check.mjs` on the `playwright` library (page count,
      text, boxes, no `/URI` annotations and no fetches), run as a CI step, not
      in vitest.
    - **Bundle.** jsPDF's optional dependencies (canvg, core-js, dompurify,
      html2canvas) are stubbed by a resolve alias (the ORT stub precedent), and
      the PDF chunk is excluded from the service worker's warm list.
  - **(B) The system print dialog**, with `@page { size: <w>mm <h>mm }`. It
    never uses named keywords. No dependencies, but it is not a file save, has
    no TrimBox, and on macOS Tauri needs `core:webview:allow-print` and an
    `@media print` layout in the main document.
  - **(C) krilla + krilla-svg** compiled through the existing wasm-pack
    pipeline as a new `crates/oristudio-diagram-pdf-wasm`. It has TrimBox and
    BleedBox, subsets CFF (so Noto CJK OTF works) and covers nearly all of
    resvg's tests, masks included. The cost is a lazily loaded wasm of a few
    MB, plus a crate and CI step.
- **Remembered options** use the X6 pattern: they are kept on save in a
  normalized `diagramExport` settings slice. They are not shared with
  `PaperExportSettings`, whose format enum rejects `'pdf'`, pinned by a test.
- **Entry points.** The header's **Export…** and **File › Export › Diagram…**
  (visible only in the diagram context) both dispatch `file.exportDiagram`
  through `handleMenuAction`, so `command invoked` fires once. **Edit page
  setup** closes the dialog, switches to Pages and reveals the Page tab.

**D12. The shell: a fifth, authoring workspace.**
- **Registration.** Copy References' registration file by file; the list is in
  Phase 1d. Diagram differs as follows.
- **Editing context.** An own `EditingContext 'diagram'`, with every Diagram
  panel id mapped in `STATIC_PANEL_CONTEXTS`.
- **Capabilities.**
  - A **`diagram` mask arm** hides `cp.*`, `optimize.*`, `insert.*`, cut, copy
    and paste. Diagram does **not** join `READ_ONLY_CONTEXTS`.
  - A `hasDeletableDiagramSelection` input is set in **both**
    `workspaceCapabilityInput` and `useWorkspaceCapabilities` (selectors and
    memo deps), and ORed into `edit.delete`'s predicate.
  - `menuActions`' `edit.delete` gains a **diagram arm before the tree
    fallthrough**. In Annotate it deletes the selected annotation. In Steps and
    Pages it deletes the selected step, asking first if the step has content.
    Otherwise it returns false. It never reaches `deleteSelection()` or a CP
    command.
  - The diagram has its own reason strings for undo, redo and delete.
- **Undo.** A `diagram` branch in `historySlice.undo` / `redo` sits before the
  fallthrough. `historyCountForContext` takes the diagram's past and future
  counts, wired into both capability builders. Undo runs through `edit.undo`,
  which ends open sessions first (D4).
- **Keyboard.** Built on one rule: what a focused control also uses must be
  able to decline.
  - **One `ViewportSurface 'diagram'`, with exactly one owner at a time.** The
    runtime keeps one executor per surface, and an unmount clears it
    (`shortcutRuntime.ts:82-92`).
    - In Steps and Pose, `DiagramPanel` registers the ladder executor.
    - `DiagramPagesView` and `DiagramAnnotateCanvas` call
      `useViewportSurface({surface: 'diagram', onViewportShortcut:
      diagramLadder})`, which asks the ladder before its camera verbs.
    - `DiagramPanel` does not register while either of them is mounted.
    - A test: Steps → Pages → Steps, then ← still selects the previous step
      and Escape still deselects.
    - `viewportSurfaceForContext('diagram')` returns it.
    - The panel calls `setActiveShortcutViewportSurface('diagram')` on mount, on
      every view or detail change, and in `onPointerDownCapture`.
    - Its executor routes on slice UI state, with decline ladders.
    - It declines whenever `isViewportInteractiveTarget(document.activeElement)`
      holds, so Enter on a button and the arrows in a tab strip keep working.
  - **New declining viewport verbs**, added to `DECLINING_VIEWPORT_SHORTCUTS`:
    `viewport.diagramOpen` (Enter), `viewport.diagramPrev` / `Next` (← / →),
    `viewport.diagramMoveEarlier` / `Later` (Alt+← / →).
  - **Escape is `viewport.cancel` only,** and runs one ladder:
    1. cancel the drag in progress;
    2. deselect the annotation;
    3. clear the tool;
    4. leave the detail (D4's exit rule);
    5. deselect the step;
    6. decline.
  - **Delete goes through `edit.delete`** (above), which does not depend on
    focus or surface.
  - **A conditional `'diagram'` scope** holds only chords no control uses: `[` /
    `]` (prev / next step in detail) and the annotate tool letters. It binds no
    Escape, Enter or arrows, and a registry test asserts that.
    - `'diagram'` is added to `CONDITIONAL_SCOPES`, `SHORTCUT_SCOPE_PRECEDENCE`
      (after `references`, before `viewport`) and
      `shortcutScopeStackForContext`.
    - `shortcutRegistry.test.ts:174`, which today names `simulator` and
      `references`, changes to skip `isConditionalShortcutScope(definition.scope)`.
    - A test asserts the diagram scope never stacks with the crease-pattern
      scope.
  - **No `keydown` listener on any panel** (`noPanelKeydown`).
- **Paths and layout.**
  - The `/diagram` route; `DIAGRAM_PATH`; cases in both `workspacePath` and
    `parseWorkspacePath`.
  - `applyDiagramLayout`; `'diagram'` in `ALL_LAYOUT_SCOPES`. No
    `LAYOUT_VERSION` bump.
  - App.css's header-height rule becomes one
    `:is([data-workspace='simulate'], [data-workspace='references'],
    [data-workspace='diagram'])` selector, with no ratchet change.
- **Rail.** The icon is lucide `BookOpen` (in the installed 0.563.0). Five tabs
  fit the phone bar at `flex: 1 1 0`.
- **Empty state.** A brand-new diagram is useful with no crease pattern, so it
  offers **Add step** and **Upload pictures…**. "Link a pattern" falls back to
  **Go to Edit** when there is no CP. `/diagram` must stand alone on a cold deep
  link. The surface creates the empty diagram on the first edit, never in a
  loader.
- **Touch undo.** On a coarse pointer, Undo / Redo IconButtons sit in the
  Diagram header and in the step-detail top bar, and dispatch
  `handleMenuAction('edit.undo' / 'edit.redo')`. They do not go in the floating
  pill lane, which would cover the header (the `viewDrawerSlot` rationale).

**D13. The inspector is two side panes, Step and Page.**
- **The panes.** `diagram-step` is the lead: `beside-primary`, trigger `slot`,
  role `'settings'`, so the drawer's pill and sheet labels work unchanged.
  `diagram-page` is `tab-of`. Their tab titles come from `sidePaneTitle` cases
  for new title keys. The page pane arrives in Phase 5, and `reconcileSidePanes`
  adds it to existing layouts.
- **Reveal rules.** A `revealDiagramPane(id)` is modelled on
  `usePropertiesPaneActivation`:
  - on a fine pointer only, deferred with `runAfterPointerGesture`, and never
    over a tab the user put on top;
  - selecting a step reveals Step;
  - switching to Pages reveals Page, and back to Steps reveals Step;
  - on touch, a selection never opens the drawer, which is modal; the drawer
    opens on the Step pane when a step is selected.
- **In step detail** the Step pane shows that detail's controls, replacing the
  step summary:
  - in Pose: source, readouts, presets, Revert;
  - in Annotate: the tool's name and help, the annotation list, the selected
    label's text and **Flip arc**.

**D14. View state lives in the slice, outside history.**
- **What lives there.** `diagramSlice` keeps, as UI fields:
  - the Steps | Pages choice;
  - the selected step and annotation;
  - the active tool;
  - which step is open in detail, and in which mode;
  - the latched `diagramReferencesTargetRequest` (D6).

  They are never recorded in history and never set `dirty`. All of them,
  together with `diagramReadOnly` and `diagramRaw` (D1), are in
  `DIAGRAM_SCOPED_KEYS`.
- **Why not panel-local.** The dock is cleared on every workspace switch.
- **On return.**
  - **Pose is not restored**, because unmounting cancelled it (D4). The slice
    reopens the step detail with a **Pose again** button and never starts a fold
    itself.
  - **Annotate is restored**, since it needs no kernel.
  - **Zoom is not stored**: viewports refit on mount, like every other
    viewport.

**D15. No build flag: the branch is the gate.** *(Decided by Zach,
2026-10-02.)*
- **Where it is built.** The whole feature is built on
  `claude/diagram-workspace-plan-ceb4f2` and merges to `main` once, complete.
  Nothing ships half-built, so there is no `isDiagramBuildEnabled`, no
  flag-off behaviour and no phone gate.
- **Keeping the branch current.** It is synced with `main` regularly (the
  app's `sync_with_base_branch`, or a merge in a plain checkout). The repo-wide
  ratchet numbers and the enumerating test lists are re-taken from `main` at
  each sync.
- **Commits stay separable.** Extractions that touch shipping surfaces are
  separate, behaviour-preserving commits, so any of them can be cherry-picked
  to `main` early if another change needs it.
- **Each phase leaves the workspace usable on its own terms.** Nothing is
  registered-but-unreachable: the Pages tab, Page pane and Export button arrive
  with their features, not as disabled stubs. This avoids the trap of the
  deleted `sequence` panel (`9505e1600`).

**D16. Saving and opening, with or without a crease pattern.**
- **Capability.** `file.save` / `saveAs` are enabled in the diagram context
  when the project has a CP, a design or a diagram (`hasDiagram`, in both
  capability builders).
- **Save routing.** `saveActiveProject` gains a third branch: no design tab
  with a kind, and no `oristudioCpDocument`, but a diagram. It writes
  `createNativeProjectFile({designs: [], creasePattern: null, diagram})`.
  A CP plus a diagram saves through the CP writer, with the diagram field.
- **Diagram-only open.** A `loadDiagramOnlyProject` branch replaces
  `loadNativeProject`'s "neither a design nor a crease pattern" throw. It:
  1. runs `clearOristudioCpDocument()` and `discardAllDesigns()`;
  2. sets `workspaceTitle`, `currentFileName` / `Path`, `dirty: false` and
     `status`;
  3. installs the diagram.

  Without these steps, the previous project's CP and file path would survive
  and the next Cmd+S would overwrite the old file.
- **Landing.** `landingWorkspace` lands a diagram-only project on Diagram.
  Other projects land where they do today.
- **Oriedita files.** When the current file came from `.ori` / `.orh` and a
  diagram exists, Cmd+S becomes Save As `.osf`, with a one-line prompt.

**D17. Phone and touch.**
- **What phones get.** On a phone the Steps grid is a single-column list, and a
  step opens as a detail screen with Back (`usePhoneListDetail`).
- **What works.** Phones can link, upload, write text, reorder, pose (Simulated
  and 3D orbit work by touch) and export. Pages is a read-only pager of
  composed pages.
- **Not on phones in v1.** Annotate shows "Annotate on a larger screen". iPad
  gets everything.
- **No hover-only verbs.** Every card verb has a path that does not need hover
  (inspector, context menu, long-press), and each lands in the phase that adds
  the verb.

**D18. Analytics.** All of it goes through `apps/web/src/analytics`. Values are
enums and buckets only: never text, filenames, SVG content, geometry, camera
values or fold percentages.
- **Free:** `workspace viewed` (add `'diagram'` to `WorkspaceScreen`); `command
  invoked` (`view.diagram`, `file.exportDiagram`); `file exported` (add `'pdf'`
  to `ExportFormat`).
- **Hand-placed**, in small tested hooks or `track*` helpers. Each lands in its
  phase, with its `docs/analytics.md` row.
  - `diagram step added` with `{source: empty|crease_pattern|cp_folded|cp_3d|references|svg|raster, via: grid|edit_toolbar|folded_figure|references|drop|batch}`. Simulated is a pose of an existing step, not a way to add one, so it is counted by `diagram picture captured`;
  - `diagram picture captured` with `{kind: crease_pattern|flat|3d|simulated, outcome: ok|no_layer_order|refused|stopped|failed|rasterized}`;
  - `diagram picture uploaded` with `{format: svg|png|jpeg|webp, outcome: ok|too_large|not_svg|flattened|rejected, size_bucket, count_bucket}`;
  - `diagram annotation added` with `{tool}`;
  - `diagram exported` with `{format: pdf|zip, preset: home|print_shop}` or, for a ZIP, `{file_type, resolution, number, text, size: same|cropped, background}`, and `file_count_bucket`, `step_count_bucket`, `empty_step_bucket` (as built in Phase 6: print shop has no bleed or crop toggles);
  - `references step sent to diagram` with `{scope: one|all, mode: sequence|find}`.

**D19. A linked step's pattern is its source; how it is shown is a choice.**
*(Added 2026-10-03 from Zach's review. It sharpens D5, which put the choice
only inside Pose, where it was easy to miss.)*

A linked step has one source, a region of the open crease pattern (D3). It is
shown in one of three ways, and the reader picks which wherever the step is
shown or edited. The three are peers: switching between them is a choice of
view, never a new link.

| Show as | What the picture is | Pose | Captured |
| --- | --- | --- | --- |
| **Crease pattern** | the region's creases as an instruction: M/V in the diagram-crease pens, aux lines as existing creases (see "After Phase 7") | rotate | headless, at once |
| **Folded** | the folded result, flat or 3D as `resolveFoldRoute` decides — one choice for the reader, two routes inside | turn over, rotate, next solution; or orbit and Top / Front / Iso | headless, a visible fold run with Stop |
| **Simulated** | the simulator's model at a fold %, from a camera | fold %, play / step / restart, orbit, Top / Front / Iso | only inside a mounted Pose (D4) |

- **The model.** `DiagramCpRender` gains `{ mode: 'simulated'; foldPercent:
  number; view: { yaw: number; pitch: number; zoom: number } }`. The existing
  `crease-pattern`, `folded-flat` and `folded-3d` stay; "Folded" in the UI
  is the latter two. `DiagramCpSource` gains `remembered?: Partial<Record<
  'crease-pattern' | 'folded' | 'simulated', DiagramCpRender>>`: each way of
  showing keeps the pose it last had, so Crease pattern → Folded → Crease
  pattern brings the folded side, turn and solution back, and a simulated
  step's fold % and camera are not lost to a look at its pattern. Switching
  is one undo step ("Show as Folded"). The reader drops a `remembered` entry
  it cannot read rather than the step.
- **Where the choice is.**
  1. **The Step pane**, first: a `SegmentedRow` **Show as** — Crease pattern |
     Folded | Simulated — in the Picture section under the Pattern row, for a
     linked step. It replaces the read-only Source sentence's job of saying
     what the picture is ("Folded, from the back" moves into the row's
     description). Crease pattern and Folded capture at once, with the card's
     progress row and Stop; Simulated opens Pose (below).
  2. **The pattern picker.** Its header carries the same **Show as** choice,
     defaulting to the last one used in the session. Picking a sheet links and
     shows it that way in one move: "link, then fold it" is one gesture, not
     two. Simulated opens Pose after the link.
  3. **The card.** Its badge already says how (Crease pattern, Folded,
     Folded · 3D, Simulated 40%). The context menu gains **Show as ▸** with the
     three, and the hover verbs the mockup has — **Adjust pose** and
     **Annotate** — land here too (D17: each also has a non-hover path).
  4. **Pose.** The context bar's switch becomes Crease pattern | Folded |
     Simulated (it is Crease pattern | Folded today).
  5. **Edit and References** are unchanged: Add to diagram from a folded figure
     still makes a Folded step, Send to diagram a References step.
- **Duplicate as.** The context menu's Duplicate gains **Duplicate as ▸**
  Crease pattern / Folded / Simulated: a copy after this step, linked to the
  same region and shown the other way. A diagram's common pair — the pattern,
  then what it folds into — is two presses.
- **Simulated, specifically** (what the code constrains; see Phase 8):
  - **Segment-sourced steps only.** A step made from a figure box has no region
    to simulate; Simulated is disabled there with a tooltip that says so.
  - **Captured only inside a mounted Pose.** The simulator lives in a worker
    session that a viewport owns. Choosing Simulated anywhere opens Pose on
    it, settles from flat to the remembered fold % (100% the first time) at
    the remembered camera (`DEFAULT_SIMULATOR_VIEW` the first time), and Done
    captures. Escape or Revert returns the step to how it was shown before.
  - **Refresh** on a simulated step opens Pose, settles again, and captures
    once the solver is still; Refresh all skips it and says how many it
    skipped. A Lighting-changed simulated step says "Pose again".
  - **One more simulation window.** Pose's session is a window like an inline
    simulation's, so Simulated is refused at the inline-simulation cap with the
    existing copy, and the worker's residency is sized so Pose never evicts a
    window that is open in Edit or Simulate.
  - **Keys.** While the simulator is shown, its scope owns Space, ← / →, Home,
    R, F, C and L, as it does in Simulate. Pose's own keys — `[` / `]`,
    Escape, Enter, Undo — are not among them.
  - **Light.** A simulated picture records the simulator's style key
    (`simulatorSceneStyleKey`), and `lighting.ts` compares each picture
    against the key of its own kind.
  - **Scale.** The simulator's scene is in viewport px under perspective, with
    no paper scale, so on a "One scale" page a simulated step is fitted, as a
    3D one is.
- **Annotations** follow D8: a new way of showing is a new picture, so the
  step's annotations stay where they were and Annotate says the picture
  changed. Switching back to the way they were drawn on brings them back in
  step only if the picture comes back identical.
- **Analytics.** `diagram step shown as` with `{show_as: crease_pattern|folded|simulated, via: pane|picker|card|pose|duplicate}`; `diagram picture captured` gains `kind: simulated` (already in D18's enum).

### Contracts

A React-free leaf module, `apps/web/src/diagram/document/diagramDocument.ts`,
importable by `nativeProjectFile.ts` the way `cpImage.ts` is:

```ts
interface DiagramDocument {
  formatVersion: 1;
  id: string;                         // 'diagram-<uuid>'
  title: string;                      // header, page title tab, export filename slug
  steps: DiagramStep[];               // order IS the step number
  page: DiagramPageSetup;
  style: { preset: BuiltInPaperPresetId } | { style: PaperStyle };   // D9
  assets: Record<string, DiagramAsset>;
}

interface DiagramStep {
  id: string;                         // 'step-<uuid>'
  revision: number;                   // bumped on source change; async captures check it (D4)
  source: DiagramStepSource | null;   // null = empty step
  picture: DiagramPicture | null;     // captured result; null until captured
  annotations: DiagramAnnotation[];   // picture units (D8)
  annotatedPictureKey: string | null; // picture key the annotations were drawn on
  text: string;                       // instruction
  breakBefore: boolean;               // start a new page here (D10)
  unknown?: Record<string, unknown>;  // a newer build's step, kept verbatim (validator)
}

interface RegionReference {           // carved out of InlineSimulation's source* fields (D3); no fingerprint
  boundary: Point[][];
  bounds: FoldedSourceBounds;
  segmentIdHint: number | null;
}

type DiagramStepSource =
  | { kind: 'cp';
      scope:                          // D3: how the creases are chosen
        | { kind: 'segment'; region: RegionReference }
        | { kind: 'figure-bounds'; bounds: FoldedSourceBounds };
      fingerprint: string;            // foldedSourceFingerprint over exactly the folded line ids
      thumbnail: SheetThumbnail;      // corner thumbnail, frozen at capture
      render:
        | { mode: 'crease-pattern'; rotationDeg: number }
        | { mode: 'folded-flat'; side: 'front' | 'back'; rotationDeg: number; foldCase: number }
        | { mode: 'folded-3d'; camera: FoldedFigureCamera; side: 'front' | 'back' }
        | { mode: 'simulated'; percent: number; view: SimulatorOrbitView } }
  | { kind: 'references-step';
      region: RegionReference;
      fingerprint: string;            // sourceFingerprintFor(document, region.bounds): per sheet (D6)
      settings: ReferencesPlanSettings; mode: 'sequence' | 'find';
      card: number | null; line: { n: [number, number]; d: number } | null }
  | { kind: 'upload'; assetId: string; rotationQuarterTurns: 0 | 1 | 2 | 3; mirrored: boolean };

type DiagramPicture =
  | { kind: 'scene'; sceneJson: string; paperScale: number | null; styleKey: string | null; key: string }
  | { kind: 'step-diagram'; model: StepDiagramModel; mirrored: boolean; key: string }
  | { kind: 'fixed'; svg: string; widthPx: number; heightPx: number; key: string }   // our own output; sanitized at capture and re-sanitized on load (D7)
  | { kind: 'asset'; assetId: string; paperScale: number | null; key: string };     // uploads, and over-budget raster captures (D2)

type DiagramAsset =
  | { id: string; kind: 'svg'; svg: string /* sanitized */; widthPx: number; heightPx: number; bytes: number }
  | { id: string; kind: 'raster'; src: string /* data:image/(png|jpeg) */; widthPx: number; heightPx: number; bytes: number };
// plus `unknown?: Record<string, unknown>` on both, as on DiagramStep

interface DiagramAnnotation {
  id: string;
  kind: 'valley-arrow' | 'mountain-arrow' | 'fold-unfold-arrow' | 'push-arrow' | 'turn-over'
      | 'rotate' | 'valley-line' | 'mountain-line' | 'hidden-line' | 'label';
  from: [number, number];             // picture units
  to: [number, number];               // = from for label
  bend?: number;                      // signed; Flip arc negates it
  text?: string;                      // label only
  rotate?: { amount: 'eighth' | 'quarter' | 'half'; direction: 'cw' | 'ccw' };
  axis?: 'vertical' | 'horizontal';   // turn-over only
  unknown?: Record<string, unknown>;  // a newer build's annotation kind, kept verbatim
}

interface DiagramPageSetup {
  size: 'a4' | 'a5' | 'b5-jis' | 'letter';
  orientation: 'portrait' | 'landscape';
  marginMm: number;                   // 0–30
  layout: 'grid' | 'flow';
  columns: number;                    // 2–5
  rows: number;                       // 1–6
  showPath: boolean;                  // flow only
  scale: 'paper' | 'fit';             // D10
  showTitle: boolean;                 // draws DiagramDocument.title
  pageNumbers: { enabled: boolean; first: number };
}
```

**Ids** use `crypto.randomUUID` (the `cpImage.ts:73-81` precedent).

**The validator.** `diagramFile.ts` is lenient, in the style of
`inlineSimulationFile.ts`:
- It tells **malformed** (drop) from **unknown kind**. An unknown kind is kept
  verbatim in the `unknown` field of the step, annotation or asset, and
  re-emitted on save, as `unknownDesigns` does. A step that is unknown renders
  as a locked "Made with a newer Ori Studio" card.
- **A newer document.** When `formatVersion` is above the reader's, it opens
  read-only: the raw JSON is kept in `diagramRaw` and re-emitted unchanged on
  save, and `commitDiagram` refuses while `diagramReadOnly` holds.
- Diagram-aware desktop builds that lag the web build therefore never delete
  newer content.
- It reuses the exported `PaperScene` validator (`lib/paper/paperSceneValidate.ts`,
  which drops markup), the region validators from `regionReference.ts`, and
  `nativeProjectFile`'s now-exported camera validator.
- It adds a new `validateStepDiagramModel`: every primitive's `kind` and
  `style` checked against the unions, finite numbers, a primitive cap and label
  lengths.
- It re-sanitizes SVG assets **and every `fixed` picture's `svg`** through
  `svgSanitize`, and checks raster sources (D7). A `fixed` picture that fails
  becomes `null`, and the step shows "Pose to capture".
- **Unknown at any depth means unknown, not malformed.** An unrecognised
  discriminant anywhere makes the enclosing step, annotation or asset
  *unknown*: source kind, `scope.kind`, `render.mode`, picture kind, annotation
  kind, asset kind, or a `StepDiagramPrimitive` kind inside a step-diagram
  model. It is kept verbatim in its `unknown` field and re-emitted on save. Only
  structurally invalid data of a *known* kind is dropped. A test checks that a
  Phase 8 simulated step and a model with an unknown primitive kind survive load
  and save under a validator that predates them.

Each phase adds its variants' validators and round-trip tests in the same PR.
The on-disk contract is provisional until the branch merges.

**Paint contract** (`diagram/pictures/paintDiagramStep.ts`, pure):
`stepScene(step, assets, style, scenePxPerPt) → PaperScene | null`, which
compiles symbols at the target scale, and `paintStepSvg(step, assets, style,
box) → PaperSvgResult`. Cards, cells and step files all call these.
- **Cards** are painted with hidden items dropped, at a thumbnail size bucket.
  They are gated by IntersectionObserver and scheduled in idle chunks.
- **Cache.** A module-level LRU, bounded by bytes, keyed by `picture.key` + a
  hash of `annotations` (computed in `pictureKey.ts`) + style key + size
  bucket. It survives the dock clear.

### Module map

React-free, under `apps/web/src/diagram/`:
- `document/`: `diagramDocument.ts` (types and pure edits: add, insert
  before/after, duplicate, delete, move, move to index, set text, set title,
  set page, set picture, remove picture) and `diagramFile.ts` (the validator).
- `pictures/`: `paintDiagramStep.ts`, `pictureKey.ts`, `stepPictureCache.ts`.
- `capture/`:
  - `captureFolded.ts` (flat, 3D and crease-pattern captures over the injected
    runtime);
  - `linkStatus.ts`;
  - `captureQueue.ts` (Refresh all).
- `upload/`: `svgSanitize.ts`, `importStepPicture.ts`.
- `annotate/`: `annotationModel.ts`, `annotationPrimitives.ts`,
  `annotationHit.ts`.
- `pages/`: `printPaper.ts`, `diagramPageLayout.ts`, `composeDiagramPage.ts`,
  `cropMarks.ts`.
- `export/`: `stepFiles.ts`, `diagramPdf.ts` (lazy writer),
  `diagramExportSettings.ts`, `diagramFont.ts` (Decision 2).
- `actions/`: `diagramActions.ts` (the catalog: header, context menu and keys)
  and `diagramShortcuts.ts`.

Hooks:
- in `diagram/`: `useDiagramShortcuts.ts`, `useDiagramViewportExecutor.ts`,
  `useDiagramCaptureSession.ts`, `useDiagramSimulatedCapture.ts`,
  `useDiagramAnnotate.ts`, `useDiagramUpload.ts`, `useDiagramPages.ts`,
  `useDiagramExportDialog.ts`;
- in `cp-workspace/references/`: `useReferencesSendToDiagram.ts`;
- in `cp-workspace/folded/`: `useAddToDiagram.ts`.

Components, each with its own `.module.css`:
- in `components/diagram/`: `DiagramStepCard`, `DiagramStepsGrid`,
  `DiagramPagesView`, `DiagramStepDetail`, `DiagramPoseView`,
  `DiagramAnnotateCanvas`, `DiagramAnnotationList`, `DiagramStyleControl`,
  `DiagramExportModal`, `DiagramExportOptions`;
- in `components/panels/`, as composition sites: `DiagramPanel`,
  `DiagramStepPanel`, `DiagramPagePanel`.

Shared extractions and new primitives, each its own commit series,
with no behaviour change:
- `lib/creaseExportFold.ts`, split, plus
  `store/workspaceStore/cpFoldRuntimeBindings.ts`;
- `cp-workspace/regions/regionReference.ts`, from `inlineSimulation.ts`, with
  validators;
- the shared `withFoldInFlight`, from `creasePatternSlice.ts`;
- `lib/paper/paperSceneValidate.ts`, from `nativeProjectFile.ts` (dropping markup is
  the one behaviour change, in its own series, 1a-0);
- `lib/paper/textWrap.ts`, from `creaseExport.ts`;
- `lib/xmlEscape.ts` `xmlText()`;
- the `diagram-hidden` line role (package, painter, validator);
- `components/ui/ToolRail`, from `CpToolRail`;
- the `createGestureBracket` option to ignore CP `'document-replaced'`;
- `components/ui/fieldRows/TextAreaRow`, `components/ui/OptionCard`,
  `components/ui/Notice`;
- `FileService.openBinaryFiles` and the `read_binary_file` `max_bytes`.

### The workspace, screen by screen

**Header** (`panel-toolbar` frame; wear its classes and add no rules):
- the title, editable with commit-on-blur (the `BpNameEditor` pattern);
- the count ("12 steps · 3 pages") as secondary text;
- Steps | Pages as an embedded `WorkspaceTabStrip` in tone `peers` (from
  Phase 5);
- **Add step** as a `SplitButton`. The primary action adds an empty step; the
  menu holds Upload pictures…, Link pattern…, From References… and Refresh all
  out-of-date steps;
- **Export…** (from Phase 6);
- touch Undo / Redo;
- the drawer pill slot.

On a phone the tabs take a row of their own, styled in the panel's module.

**Steps view:**
- **Layout.** `DiagramStepsGrid`: `repeat(auto-fill, minmax(min(220px, 100%),
  1fr))`.
- **`DiagramStepCard`**, with `--radius` on the card and `--radius-sm` on
  thumbnails:
  - header: "Step N" and a `Badge` (Crease pattern, Folded, Folded · 3D,
    Simulated 40%, Reference, Upload or Empty);
  - a **square picture well**, the picture contained, as a painted `<img>`;
  - for `cp` sources, a corner thumbnail drawn from the stored `thumbnail` in
    the card's own module with `--sheet-thumb-*` tokens. It does not use
    `.sheet-card` rules;
  - status chips: Out of date, Pattern missing, Lighting changed, Text doesn't
    fit;
  - a progress row with Stop while capturing;
  - footer: the instruction, or a muted "No instruction".
- **Card verbs.** IconButtons for Adjust pose and Annotate show on hover and
  focus. A context menu built from `diagramActions` carries:
  - Insert before / after, Duplicate, Move earlier / later;
  - Start a new page here;
  - Replace picture…, Export picture…, Remove picture, Refresh;
  - Delete.
- **Empty card.** It offers **Link pattern…**, which selects the step and
  reveals the picker, plus **Upload…** and **From References…**, and accepts a
  dropped picture.
- **Selection.** Click selects. Double-click or Enter opens Pose.

**Pages view** (Phase 5):
- `DiagramPagesView`: data-URL `<img>` pages with layout hit rects, a
  selection overlay, a placeholder overlay and "Page N" captions.
- `useViewportSurface` for pan and zoom.
- `ViewportToolbar`: its own 25–400% presets and Fit, plus a "Page n of m" node
  passed through `groups`.

**Step tab** (`DiagramStepPanel`: `panel-shell`, then `CollapsibleSection`s of
`fieldRows`):
- **Header row:** "Step [N] of M", where N is an editable position that commits
  `moveStepTo`; Move earlier / later; Duplicate; Delete.
- **Picture section:**
  - the source;
  - for a pattern: the pattern picker (`SheetGrid` over the kernel-space
    segments, single column in v1), **Open in Edit**, and **Refresh** /
    **Relink** by status;
  - for a reference: **Open in References**;
  - always: **Replace picture…**, **Export picture…** and **Remove picture**.
- **Render section:** read-only Source and View rows, plus **Adjust pose**.
- **Annotations section:** a count row and **Annotate**.
- **Instruction section:** `TextAreaRow`. It commits on blur or after 600 ms
  idle, as one history entry per edit session, and uses a 16 px font under a
  coarse pointer.

**Page tab** (`DiagramPagePanel`, Phase 5):
- **Paper:** `SelectRow` size, `SegmentedRow` orientation (with icons) and
  `NumberRow` margin in mm.
- **Layout:** Grid / Flow as `OptionCard`s; columns or steps per row, and rows
  per page; Show path (flow only); Scale (paper | fit); a readout of steps per
  page and pages.
- **Header & footer:** a `ToggleRow` Title, which draws the diagram title, and
  a `ToggleRow` Page numbers with a nested first-number field.
- **Style:** `DiagramStyleControl`.

**Step detail** (`DiagramStepDetail`, Phase 2):
- **Top bar:**
  - `Button` ← Steps;
  - `IconButton` prev and next, disabled at the ends;
  - "Step N of M";
  - `SegmentedControl` Pose | Annotate, where Annotate is shown from Phase 7;
  - touch Undo / Redo IconButtons (coarse pointer);
  - `Button` **Done** (primary).

  Labels come from `diagramActions`. The empty-step body reads "This step has no
  picture yet", with the three source buttons.
- **Pose:**
  - `SimulatorViewport` (3D or simulated), or the painted `<img>` with rotate
    and turn-over controls;
  - `CanvasContextBar` with Crease pattern | Folded form | Simulated
    (Simulated from Phase 8) and **Revert** (D5);
  - `ViewportStatusReadout` for yaw/pitch, with `Chip`s Top / Front / Iso
    beside it;
  - a bottom `Toolbar` (tone `overlay`) with Restart, Play/Pause, Step and a
    `GestureSlider` for fold %. It does not wear `.simulator-controls`;
  - annotations ghosted at 30%.
- **Annotate:**
  - a left `ToolRail` (Select; Arrows; Lines; Text);
  - the centre `DiagramAnnotateCanvas`: `useViewportSurface`, the picture
    `<img>` plus a sibling `<svg>` of `diagramShapes` and endpoint handles;
  - the zoom pill.

**Export dialog**:
- the preview with a pager;
- `OptionCard`s PDF | Step files (ZIP);
- for PDF: At home | Print shop, and **Edit page setup** (the print shop
  always carries bleed and crop marks; see Phase 6);
- for ZIP: SVG | PNG, 300 / 600 dpi with its px note, number, text and same
  size, and W / H in mm;
- a `Notice` naming the steps with no picture or overflowing text;
- the footer: filename, Cancel and Export;
- a sonner toast.

### Keyboard

These are defaults; every one can be rebound in Settings. "Viewport" means a
declining verb on the `'diagram'` viewport surface; "scope" means the
conditional `'diagram'` scope.

| Where | Key | Action | Bound in |
| --- | --- | --- | --- |
| Steps / Pages | ← / → | Select previous / next step | Viewport (declines on an interactive target) |
| Steps / Pages | Alt+← / Alt+→ | Move step earlier / later | Viewport |
| Steps / Pages | Enter | Open Pose | Viewport |
| Anywhere | Delete, Backspace | Delete selected annotation (Annotate) or step (Steps / Pages, asks first if it has content) | `edit.delete` diagram arm |
| Anywhere | Escape | The cancel ladder (D12) | `viewport.cancel` |
| Step detail | [ / ] | Previous / next step | Scope |
| Annotate | V, M, U, P, T, R | Valley arrow, mountain arrow, fold-and-unfold, push, turn over, rotate | Scope |
| Annotate | Shift+V, Shift+M, H, L | Valley line, mountain line, hidden line, label | Scope |
| Annotate | F | Flip the selected arrow's arc | Scope |
| Pose (simulated) | Space, ←, →, R | Play, scrub, restart | The `simulator` scope, which sits ahead; that is why detail navigation uses [ / ] |

The required tests:
- registry: the scope binds no Escape, Enter or arrows, and has no duplicate
  chords;
- dispatcher: Enter on a focused button inside the Diagram is not
  `preventDefault`ed;
- the Escape ladder, one test per rung;
- `edit.delete` never calls `deleteSelection` or a CP command in the diagram
  context.

### Testing strategy

- **Pure modules.** Run vitest from the web workspace under **Node 22**.
  - Document edits, including duplicate and move-to-index.
  - The validator, with a save → parse → deep-equal **round trip for every
    variant** each phase adds; unknown-kind preservation at every depth; and a
    hostile corpus: markup in stored scenes and in `fixed` pictures, raster
    `src` URLs, malformed primitives.
  - Link-status precedence (D3), never refreshed on load.
  - The sanitizer, against the hostile corpus: script, `svg:script`, prefixed
    XLink `x:href`, `java\tscript:`, `url()` in `style` and presentation
    attributes, `xml:base`, doctype, `<use>` fan-out and cycles, `foreignObject`,
    `animate` on href, id collisions, embedded oversized rasters. Also against
    real Inkscape, Illustrator (Preserve Editing), Affinity and Figma exports.
    The corpus runs in **Chromium and WebKit as well as jsdom**, because jsdom's
    parser is not Blink's or WebKit's. The repo has no Playwright test runner,
    so this is `scripts/diagram-svg-sanitize-check.mjs` on the `playwright`
    library (the `static-paint-check.mjs` pattern), run as a CI step after the
    build.
  - Layout: grid and flow, page breaks, `breakBefore`, paper scale, overflow,
    CJK and astral characters.
  - Composer goldens: an empty step has no placeholder; marks keep their pt size
    at two cell sizes.
  - Crop marks, bleed and boxes.
  - Annotation compilation, for every kind and both bend signs, plus hit tests.
- **Store.**
  - Every project-replacing entry point resets the diagram; self-provision and
    `clearOristudioCpDocument` do not.
  - Undo / redo arms; `historyCountForContext` through both builders.
  - Every mutation sets `dirty`, and view changes do not.
  - Save from the diagram context, a diagram-only project, and a diagram-only
    file opened over a CP project.
  - The `.ori` Save-As rule.
  - Async: undo during an in-flight capture, a capture landing after a project
    open, and Refresh all with a pending redo.
- **Capture.** Fake runtimes:
  - the handle is freed on Done, Revert, unmount, Stop, failure and a project
    replace;
  - the folded ids equal the fingerprinted ids;
  - the `foldCase`, the side and `outcome` all round-trip.

  The simulated capture comes from a recorded session snapshot.
- **Browser** (author-verified, each phase, through the agent Browser pane on
  the `web-attached` config):
  - the real test diagram: the crane `.osf`'s eleven states, at
    `"/Users/zacharymarion/Documents/open source/origami-designer/test_files/diagrams/crane.osf"`
    (never commit it);
  - light and dark themes;
  - **rebuild the CP wasm bridge first** (`npm --workspace @treemaker/web run
    build:oristudio-cp-wasm`) for every fold check;
  - WebGL interactions the pane cannot drive go to Zach as a short list.
- **Files and desktop.**
  - PDFs are checked with `pdfinfo -box`, `pdffonts` and `pdftoppm -r 150`,
    then opened in Preview and Acrobat.
  - ZIPs are checked in Inkscape.
  - Native save and open dialogs are exercised in `npm run dev:desktop`, or
    listed for Zach's desktop pass.

### Decisions confirmed with Zach

All five were settled on 2026-10-02, after Phase 0 ("go with your
recommendations"; instruction overflow shrinks the picture). The original
framing is kept below for the record; the outcomes are in "Phase 0 results".

1. **PDF route. Decided: C (krilla wasm).** Phase 0 rendered the same two crane pages through (A) jsPDF +
   svg2pdf.js, (B) print-to-PDF in Chrome and in macOS Tauri, and (C) krilla
   wasm. Each version includes an upload with a mask, a pattern and a marker,
   and a long English and a Japanese instruction. You get the three PDFs with a
   one-paragraph comparison: fidelity, file size, time for 10 pages, chunk and
   wasm size, and TrimBox in Acrobat Preflight. Under (A) the sanitizer drops
   masks before the PDF, so the mask comparison is (C) with the mask kept
   against (A) flattened. I lean to (A) for the smallest change, or (C) if
   masks and CJK subsetting matter more than a few MB of lazy wasm.
2. **The diagram's text font. Decided: the Phase 0 font strategy.** One bundled OFL TrueType family is used three
   ways: measured on screen, embedded in every page and step SVG, and embedded
   in the PDF. Latin ships in the app (~100–300 KB, lazy). For ja, ko, zh-CN and
   ru text, the options are:
   - (a) fetch a per-script TTF subset from R2 on first use, with a sha256
     check (the CP-detect model delivery precedent). This adds an R2 publish
     step, Phase 6c;
   - (b) in v1, refuse PDF when such text is present and point to the step
     files, whose SVGs keep live text.

   Phase 0 shows how the same Japanese line wraps on screen, in the `<img>` and
   in the PDF under each option.
3. **Forward compatibility.** Under the house rule (no schema bump), opening
   and re-saving a project in an *older* build silently deletes its diagram,
   uploaded artwork included. The alternative is a **reader-version split**:
   - a new `NATIVE_PROJECT_READER_VERSION = 9` used only in the minimum-reader
     check;
   - writers keep stamping `schemaVersion: 8` with `validateV8` unchanged;
   - `minimumReaderSchemaVersion: 9` is set only when `workspace.diagram` is
     non-null;
   - the `1 | 8` unions widen;
   - `validateV8`'s recomputed minimum includes the diagram;
   - `superset-features.md` changes in the same PR.

   Older builds then refuse such files with "update Ori Studio", and diagram-free
   files are untouched. **Decided 2026-10-02:** Zach is fine with a schema
   bump; the reader-version split is the bump that touches only files with a
   diagram.
4. ~~When the flag comes off.~~ **Decided 2026-10-02:** there is no flag. The
   branch is built complete and merged once (D15).
5. **Persisting References plans. Decided: yes, as a separate change that
   lands on `main` first** (offered as its own task). The diagram does not
   depend on it: D6 snapshots each step. Once it lands, References-step
   provenance gains the plan cache key and the chosen way's signature.
6. **Instruction overflow. Decided: shrink the picture.** See D10.

### Phase 0 results (2026-10-02)

The evidence is in `artifacts/diagram-phase0/` (local, gitignored), with a
summary in `RECOMMENDATIONS.md` and the cross-route table in `pdf/COMPARISON.md`.
Inputs were the real crane `.osf` (eleven states), two A4 pages composed with
the app's own painter, 55 real third-party and Inkscape SVGs, and synthetic
and hostile files. Not verified: Acrobat Preflight, the real Tauri WKWebView
(Playwright WebKit 26.4 stood in), Firefox, and font fetching from mainland
China.

**Decided 2026-10-02** (Zach: "go with your recommendations"):
- **Decision 1, PDF route: C (krilla + krilla-svg 0.8, compiled to wasm).**
  - **Why C.** It is the only route that passes every check: exact
    TrimBox/BleedBox and crop marks; every line within 0.013 pt of the composer
    in six languages; dashes within 0.025 pt; masks and patterns kept vector;
    CJK subset once per document; a byte-identical file from web and desktop;
    10 pages in 40–90 ms.
  - **Its cost.** About 0.9–1.1 MB brotli of lazy wasm, plus a new crate and a
    CI build.
  - **Route A works only with additions:**
    - a jsPDF patch (its TrueType subsetter is quadratic: 3,000 distinct Han
      take 5 s in WebKit);
    - a `blob:` workaround (WebKit silently drops rasters above about 330 KB);
    - dash-offset rewriting and split halo labels;
    - a stricter sanitizer (a dangling `#id` aborts the export);
    - accepting that masks and shadows are lost.
  - **Route B is out:** it writes no TrimBox, rasterises masks and patterns,
    and WebKit draws a hairline through every dash gap.
- **Decision 2, font.**
  - Noto Sans (Latin, Cyrillic, Greek) is bundled.
  - Noto Sans SC/TC/JP/KR are static TrueType, one font per run, chosen by
    Script (not Script_Extensions). Each diagram stores its Han style.
  - They are fetched per script in two tiers: a "common" file first (SC 752 KB
    brotli, 99.86% of Han use), then the full file (SC 5.45 MB) only for rarer
    characters.
  - hb-subset wasm (212 KB brotli) cuts per-page and per-document subsets with
    every layout feature dropped. These are embedded as data-URI `@font-face`
    in page SVGs, which renders inside `<img>`.
  - The composer measures from the font file (HarfBuzz advances), sets every
    break, and positions every run `tspan`. Browser measuring APIs are up to
    2 pt off in WebKit.
  - To be safe in China, fonts are served from the app's own origin, and the
    desktop installer bundles the common tiers (about 2.8 MB brotli).
- **References plans: persist them.**
  - **What is lost today.** The diagram loses nothing on a round trip, because
    D6 snapshots each step. References loses its plan, settings, chosen ways and
    view.
  - **Plans are not reproducible.** The planner's wall-clock budgets change the
    cards: iguana_24 sheet 15 changes from run to run on one Mac, and 3–6 of 31
    sheets change on slower machines.
  - **What to persist.**
    - **Reader state**, under 1 KB, in CP `viewState.references`.
    - **A plan cache** in `.osf` `artifacts.references`, stored as gzip+base64
      of compact JSON: 134 KB for the crane, 1.8 MB for iguana_24's 31 sheets,
      against 3.3 MB for the crane as nested pretty JSON. It is keyed on the
      planner build and wire version, the settings, and the sheet bounds plus an
      index-sensitive fingerprint. It is discarded on any mismatch, never
      migrated, and capped.
  - **What diagram steps gain.** Their provenance adds the plan cache key and
    the chosen way's signature.
  - **Where it lands.** Not diagram-specific, so it can land on `main` first.
- **Instruction overflow: the picture shrinks.** A 5-line slot holds about
  145 Latin or 75 CJK characters, and the English and Russian samples
  overflowed. The layout gives the text the lines it needs by shrinking that
  cell's picture box, down to a floor of 50% of its full size. Only text that
  still does not fit is truncated with an ellipsis and listed in the export
  Notice.

**Adopted now (route-independent, evidence in the spike READMEs):**
- **D2.**
  - **Stored form.** Hidden items dropped, coordinates quantized to 0.01, and
    a `sceneJson` string. Flat crane steps are 0.3–1.1 KB, and the largest of
    31 captures is 40.7 KB, against 2.9 MB raw. Keep the 2 MB guard, checked on
    the stored string. Drop "merge coplanar faces" and gzip.
  - **Simulated captures.** Pose warns when a simulated capture collapses
    edge-on: crane states 3 and 7 at 100% from the default iso view.
- **D10.**
  - **Paper scale.** It is exact for flat and crease-pattern steps (a scene's
    `sheet` carries it) and approximate for 3D and simulated steps, so
    simulations fit by default.
  - **Layout.** The mockup formula overprints the step number on the picture,
    so the picture box starts below the number.
  - **Text setting.**
    - Korean is set keep-all, breaking at spaces.
    - The middle dot follows its run.
    - References labels take the composer's font family instead of the Inter
      stack.
- **D7** takes the sanitizer spike's revised policy
  (`artifacts/diagram-phase0/sanitize/reference/plan-edits.md`):
  - **Parsing.** A DOCTYPE screen before parsing: without it, WebKit expands a
    56 KB entity file to 100 MB.
  - **Allowlist.** `textPath` is added, `a` and `switch` become `<g>` keeping
    their transform, and `xml:lang`/`lang` are kept.
  - **References.** Ids resolve by lookup, since Inkscape's own pattern ids
    contain spaces. Context-stroke and context-fill markers are baked per
    colour, because WebKit draws Inkscape 1.2+ arrowheads missing.
  - **Rasters and caps.** Rasters are re-encoded at import only, never on load.
    The read cap is 16 MB, with 2 MB after sanitizing.
  - **Idempotence.** Re-sanitizing is idempotent: ids that already carry the
    prefix are kept.
  - **Report.** It also flags `flowRoot`, linked images and dropped CSS.
  - **Under route C,** masks and filters (minus `feImage`) are kept.
  - **Upload `<text>`** is mapped to the diagram fonts, with a notice.
- **Composer rules for route C:**
  - give krilla document-scoped font files under their real family names, and
    static instances: the CJK variable TTFs print Thin;
  - ship a real Bold, since krilla has no faux bold;
  - put the script's family first for CJK runs;
  - emit trim + 3 mm bleed art;
  - turn usvg's missing-glyph and fallback warnings into errors.
- **Tooling found on the way.** `scripts/dev-server.sh` runs a bare `npx vite`,
  skipping `predev`, so a fresh worktree whose simulator `dist` is stale crashes
  at boot (`shadeColor` missing). Run `npm run build:simulator` first.

## Affected Areas

- **New, React-free, under `apps/web/src/diagram/`:** `document/`, `pictures/`,
  `capture/`, `upload/`, `annotate/`, `pages/`, `export/`, `actions/`, with tests.
- **New components:**
  - `apps/web/src/components/diagram/*`, each with a module;
  - `components/panels/DiagramPanel.tsx`, `DiagramStepPanel.tsx`,
    `DiagramPagePanel.tsx`;
  - `components/ui/ToolRail`, `components/ui/OptionCard`, `components/ui/Notice`,
    `components/ui/fieldRows/TextAreaRow`.
- **Store:**
  - `store/workspaceStore/slices/diagramSlice.ts` (new) and `diagramState.ts`
    (new);
  - `cpFoldRuntimeBindings.ts` (new), plus a shared `withFoldInFlight` module;
  - `types.ts` and `store.ts`;
  - `slices/projectSlice.ts` (reset sites, the diagram-only open and save
    branches, `savedMessageFor`, the `.ori` rule, `initEngine` guard, export
    bindings moved);
  - `slices/oristudioBpSlice.ts` (reset sites);
  - `slices/creasePatternSlice.ts` (`withFoldInFlight` moved out, fold run
    kinds);
  - `slices/historySlice.ts`;
  - `capabilities.ts`, `useWorkspaceCapabilities.ts`;
  - `landingWorkspace.ts`.
- **File format:**
  - `lib/nativeProjectFile.ts` (field, both writers, validator, migration,
    reader version, exported camera validator);
  - `lib/paper/paperSceneValidate.ts` (new; drops markup);
  - `apps/web/docs/superset-features.md`.
- **Shell:**
  - `workspaces/workspaces.ts` and `workspaces/editingContext.ts`;
  - `components/WorkspaceShell.tsx`;
  - `components/WorkspaceViewDrawer.tsx`;
  - `components/panels/PanelComponents.tsx`;
  - `store/layoutStore.ts` (side panes, title keys, `applyDiagramLayout`,
    `ALL_LAYOUT_SCOPES`);
  - `routing/paths.ts` and `routing/appRouter.tsx`;
  - `App.css` (one `:is()` selector, no ratchet change).
- **Commands and menus:**
  - `commands/menuActions.ts` (`view.diagram`, `file.exportDiagram`, the
    `edit.delete` diagram arm);
  - `menus/menuDefinition.ts`;
  - `lib/workspaceCapabilities.ts` (capability ids, mask arm, delete and save
    inputs, reason strings);
  - `platform/fileService.ts` (`openBinaryFiles`, svg MIME, `FileCommand`).
- **Tauri:** `apps/tauri/src-tauri/src/lib.rs` (`read_binary_file`
  `max_bytes`; the shell stays thin). Print permission only if route (B).
- **Keyboard:**
  - `keyboard/shortcuts.ts`, `shortcutRuntime.ts`, `shortcutDispatcher.ts`
    (scope, target, viewport surface and verbs, `DECLINING_VIEWPORT_SHORTCUTS`);
  - `shortcutRegistry.test.ts`;
  - `i18n/shortcutLabels.ts`;
- **Shared extractions:** `lib/creaseExportFold.ts`;
  `cp-workspace/inlineSimulation/*` → `cp-workspace/regions/`;
  `lib/creaseExport.ts` → `lib/paper/textWrap.ts`; `lib/xmlEscape.ts`;
  `components/panels/CpToolRail.tsx` → `components/ui/ToolRail`;
  `cp-workspace/canvasObjects/gestureBracket.ts`;
  `packages/origami-simulator/src/paperScene.ts` + `lib/paper/paperSvg.ts`
  (`diagram-hidden` role).
- **References:**
  - `referenceFinderDiagramToPrimitives.ts`, `stepDiagramGeometry.ts`,
    `diagram/DiagramPrimitives.tsx`, `diagram/diagramInk.ts` (new primitive
    kinds);
  - `referencesActions.ts`, `referencesShortcuts.ts`,
    `useReferencesSendToDiagram.ts` (new);
  - `openReferencesWorkspace` (a sheet target).
- **Edit:**
  - `cp-workspace/CpSelectionToolbar.tsx`, `cp-workspace/folded/foldedFigureActions.ts`
    and `useAddToDiagram.ts` (Add to diagram);
  - the CP panel, which consumes a new `oristudioCpRegionFocusRequest` (Open in
    Edit).
- **Paper:** `lib/paper/paperStyleResolve.ts` (the `'diagram-workspace'`
  surface).
- **Analytics:** `analytics/events.ts`, `analytics/track*.ts`,
  `docs/analytics.md`.
- **i18n:** `apps/web/public/locales/*/{panels,tools,dialogs,toasts,errors,common,menu}.json`
  and `.hashes.json`.
- **CI:** `.github/workflows/ci.yml` gains the `scripts/diagram-svg-sanitize-check.mjs`
  and `scripts/diagram-pdf-check.mjs` steps (both new, on the `playwright`
  library).
- **Dependencies:** as Decision 1 picks:
  - (A): `jspdf@^4.2.1` and `svg2pdf.js@^2.8.1` in `apps/web/package.json`,
    resolve-alias stubs in `vite.config.ts`, and `LICENSING.md`;
  - (C): a new crate and wasm bridge, `Cargo.lock`, CI build step and
    `LICENSING.md`.

## Checklist

Everything lands on `claude/diagram-workspace-plan-ceb4f2`; the branch merges
to `main` once, complete (D15). Each lettered item is one reviewable commit
series on the branch ("each its own" means separate series). Extractions that
touch a shipping surface (the CP export, inline simulations, Edit's folded
figures, References, the Edit rail) are always separate, behaviour-preserving
commits, so they can be cherry-picked to `main` early if needed. **Every item
ends with:**
- **Tests and lint.** Under Node 22: `npm run lint:web`, `typecheck:web` and
  `test:web`; iterate with `npm --workspace @treemaker/web exec -- vitest run
  <files>`.
- **i18n**, when copy changed: extract, translate the 8 locales, stamp, check.
- **Analytics.** `docs/analytics.md` rows for every event or enum value added.
- **Landing budget.** After `npm run build:web`, run `node
  scripts/landing-budget.mjs apps/web/dist` and the static-paint check whenever
  `appRouter`, `paths`, `layoutStore`, `workspaces`, `features` or
  `analytics/events` change. Those modules import nothing from `diagram/` or
  `components/diagram/`.
- **Browser.** Verification with screenshots, light and dark.
- **Desktop.** `npm run check:desktop` when dialogs or Tauri change.

### Phase 0: spikes and decisions. Nothing merges.

Done 2026-10-02. The results are in "Phase 0 results" below and in
`artifacts/diagram-phase0/` (gitignored, local).

- [x] Build the test diagram: the crane `.osf`'s eleven states, plus 55 real Inkscape and third-party SVGs, synthetic imitations and a hostile corpus.
- [x] **Measure stored scenes.** Flat, 3D, and simulated at 40% and 100%; four encodings; save and open cost.
- [x] **PDF one-offs** (Decision 1): the same two composed crane pages through route A (Chromium and WebKit), route B (Chrome, plus a WKWebView `printOperation` harness) and route C (native and wasm). Checked with pdfinfo, pdffonts, pdftotext, poppler and Ghostscript, at 150 and 1200 dpi. Bundle and wasm sizes measured.
- [x] **Font** (Decision 2): an embedded data-URI `@font-face` renders inside `<img>` in Chromium and WebKit. Line breaks are identical on screen, in route A and in route C, in six languages.
- [x] **Sanitizer probe:** D7 as written, plus two revised policies, over 85 files in Chromium, WebKit and jsdom, with live-fire, static audit and pixel diffs.
- [x] **References plan persistence** (asked by Zach): size, determinism and invalidation measured.
- [x] Zach decided (2026-10-02): route C, the font strategy, References persistence as a separate change, and the picture shrinks when an instruction overflows.

### Phase 1: the document, the workspace and the step list

- [x] **1a-0.** `lib/paper/paperSceneValidate.ts`, its own series, in two commits (also offered to `main` separately as a background task):
  - extract it and export the camera validator, with no behaviour change;
  - drop `markup` items, the one behaviour change, with a test that Edit's folded-figure scenes still round-trip.
- [x] **1a.** The format and the document. Pure, with no UI.
  - `diagram/document/diagramDocument.ts`: types and pure edits, with tests.
  - `diagramFile.ts`: the validator for Phase 1's variants (empty step, text, page, style), `formatVersion`, unknown-kind preservation at every depth, and read-only opening.
  - `lib/xmlEscape.ts` `xmlText()`, which the validator uses to normalize text and title.
  - The `.osf` `workspace.diagram` field in both writers, `validateV8` and `migrateLegacyToV8`, plus Decision 3's reader version, confirmed **before this PR opens**.
  - Round-trip tests; `superset-features.md` updated.
- [x] **1b.** The slice. Store only, no UI.
  - `diagramSlice` + `diagramState.ts`:
    - `DIAGRAM_SCOPED_KEYS` and `discardDiagramState`;
    - `diagramLoadId`, `diagramReadOnly` and `diagramRaw`;
    - `commitDiagram` (skip a no-op, otherwise `recordSnapshot` and set `dirty`);
    - `trimDiagramHistory`, the byte cap.
  - Every reset site in D1, `initEngine`'s guard, and the install in every branch of `loadNativeProject`.
  - The diagram-only open and save branches (D16), `savedMessageFor`, and the `.ori` Save-As rule.
  - Store tests for each.
  - Pulled forward from 1d: the `hasDiagram` capability input, because `saveProject` opens by rejecting a disabled `file.save`, and a diagram-only project could not be saved without it.
  - Found by the keep-tests: the design-method chooser (`createNewProject` and `createOristudioBpProject` with `preserveEditCanvas`) set `dirty: false`, which marked unsaved work clean. This was true of an unsaved crease pattern before the diagram existed. Both now keep the project's `dirty`.
- [x] **1c.** `ui/fieldRows/TextAreaRow` with its module and tests. It registers its pending edit with `registerCanvasSessionEnder` (the `'session'` phase), and commits it on both `'history'` and `'document-replaced'`.
  - A pending edit commits through the `onCommit` that was current when its run of typing began, so a draft lands where it was typed even if the row is re-pointed.
  - Each commit carries a session (one per focus, numbered across rows). `setDiagramStepText` folds a session's commits into one undo entry until anything else is recorded, undone or installed.
- [x] **1d.** Registration and panels. Everything keyed to the `'diagram'` context lands here.
  - Undo arms and `historyCountForContext` through both capability builders.
  - The `hasDeletableDiagramSelection` input (`hasDiagram` landed in 1b), the `edit.delete` diagram arm and the reason strings.
  - `landingWorkspace`, with the diagram as an input.
  - Every site in D12: `workspaces.ts`, `editingContext.ts`, `WorkspaceShell.tsx` (`BookOpen`, tooltip, tab label), `paths.ts`, `appRouter.tsx`, `layoutStore.ts` (`applyDiagramLayout`, `ALL_LAYOUT_SCOPES`, the `diagram-step` pane only), `PanelComponents.tsx`, `VIEW_DRAWER_BODIES`, `menuActions.ts` (`view.diagram`), `menuDefinition.ts`, `workspaceCapabilities.ts` (capability, `diagram` mask arm), `analytics/events.ts` (`WorkspaceScreen`), and App.css's `:is()`.
  - The silent sites are listed in the PR body.
  - Analytics: `diagram step added` (`empty`; `via: grid`).
  - `DiagramPanel`: header (title, count, Add step, touch undo), the Steps grid, and the empty state with Go to Edit.
  - `DiagramStepsGrid` and `DiagramStepCard`.
  - `DiagramStepPanel`: header with position and move, Duplicate, Delete, and Instruction.
  - The enumerating tests:
    - `workspaces`, `editingContext`, `layoutStore`;
    - `paths`, `appRouter`;
    - `menuActions`, `menuDefinition`;
    - `workspaceCapabilities`, `capabilityMask`, `registry`;
    - `CanvasHistoryPills`, `PanelComponents`;
    - `WorkspaceViewDrawer` and `WorkspaceShell` (mock the new pane bodies).
  - i18n for every key.
  - As built:
    - The grid is one `listbox` and each card an `option` with a roving tab stop, not a button: a focused button turns the viewport's arrow keys off. Focus follows the selection while it is in the grid or nowhere (a deleted card hands it on), never out of another control.
    - The mockup's trailing "Add step" tile was left out: a button cannot sit inside a listbox. The header and the empty state carry Add step. *(Reversed 2026-10-03, see "After Phase 7": the tile is back, for a pointer alone.)*
    - The empty state offers Add step only. "Go to Edit" and Upload arrive with the features they lead to (Phases 2 and 3), not before them (D15).
    - `revealDiagramPane` waits for Phase 5: with one pane in its group there is nothing to reveal yet.
    - Delete asks first through one slice action, `confirmDeleteDiagramSteps`, which the key, the pane and the menu all use, and which refuses to delete into a diagram that replaced the one asked about.
    - New shared primitive: `components/ui/Notice`.
    - Found on the way and filed separately: `BpNameEditor`'s Escape commits the typed name instead of reverting it (a stale blur closure).
- [x] **1e.** Keys and the context menu.
  - `diagramActions.ts`, `diagramShortcuts.ts` and `useDiagramShortcuts.ts`.
  - The `'diagram'` viewport surface and executor: ← / →, Alt+← / →, and the Escape ladder (Enter arrives with step detail in 2c).
  - The conditional scope, with no bindings in Phase 1, added to `CONDITIONAL_SCOPES`, `SHORTCUT_SCOPE_PRECEDENCE` and `shortcutScopeStackForContext`.
  - `viewportSurfaceForContext`, and the single-owner executor rule (D12).
  - The registry test changes; `shortcutLabels` cases.
  - The card context menu with `ContextMenuSurface 'diagram'`.
  - As built — a change to D12's keyboard design, for a reason found in the dispatcher:
    - The dispatcher runs only the *first* definition in a scope that matches a chord, and a decline moves on to the next scope, not the next definition. So `viewport.diagramPrev` on ← could never be reached behind `viewport.solveAnglesPrevious` on the same chord. The Settings capture rules and the Oriedita import both encode that first-match rule, so changing the dispatcher would have reached into both.
    - Instead the conditional `'diagram'` scope's executor may decline, as a viewport's may (`ShortcutExecutors.diagram` returns a boolean). With that, the reason D12 kept arrows out of the scope is gone: ← / → and Alt+← / → live there as `diagram.previousStep` / `nextStep` / `moveStepEarlier` / `moveStepLater`. Conditional scopes are already deferrals to every conflict rule, so nothing else had to learn about them.
    - The arrows decline only while a control that uses arrows has focus (tab strip, radio group, menu bar, slider; fields and open menus never reach the executor; a toolbar of buttons is not one, since none of the app's roams with arrows). Declining for every interactive target, as D12 proposed, would make ← dead after a press on Add step, where a button's arrows do nothing. Enter (2c) will decline for any interactive target, as D12 says.
    - Escape stays `viewport.cancel` on the `'diagram'` surface, with Phase 1's one rung (deselect). Shift+F10 (`viewport.contextMenu`) opens the selected step's menu at its card.
    - The panel claims the `'diagram'` viewport surface on mount and on press, and releases it on unmount (`releaseShortcutViewportSurface`), so the next workspace's viewport keys reach their own surface rather than one that is gone.
    - The registry test asserts the scope takes no always-present chord, Escape or Enter; arrows are allowed.
- [x] **Browser:**
  - a cold deep link to `/diagram`;
  - add, insert, duplicate, move (keys and position field) and delete steps, then undo each;
  - Enter on a focused button still clicks it (nothing binds Enter in Phase 1; the rule is tested for 2c);
  - save, reopen and land, including a diagram-only project and a diagram-only file opened over a CP project (opened by a real drop through the file-drop controller; saved through the real save path with an in-page file service, since the pane cannot drive a native save dialog);
  - switch workspaces and back; the view state survives.
  - Found and fixed on the way: the title field was sized to its placeholder, and focus fell to the page when the focused card was deleted.
- [x] **Review.** Three adversarial reviewers (state and persistence, UI and accessibility, repo rules). Fixed:
  - Saves and discard prompts first commit what is still being typed (`lib/pendingEdits.ts`; the title, step header and instruction fields register). A save whose dialog stayed open while the diagram changed stays dirty.
  - A failed open no longer leaves the old project half-replaced: `loadNativeProject` puts the diagram and the extensions back unless the new project had already replaced the old one, and the BP opens load their document before clearing the crease pattern.
  - Duplicating a step gives its carried annotations new ids. A document-level field this build does not know makes the diagram read-only, as a newer `formatVersion` does.
  - A `.osf` with no diagram has no `diagram` key at all, so it is byte-identical to one written before diagrams.
  - Confirmations take focus on their safe button and give it back when they close, the workspace's keys stand down behind them (`data-shortcut-barrier`, and the app keyboard while one is open), and fields ignore keys mid-composition (IME).
  - A context menu now says where focus goes when it closes (`returnFocusTo`), and hands focus to a confirmation one of its rows opened (`focusCommandDialog`). Before, the menu's trap took focus back from the dialog. This is shared, so every surface's menu gets it.
  - The steps grid: ↑ / ↓ walk the steps as ← / → do, Home and End go to the ends, the arrows go on from a focused card when nothing is selected, and a press on the space between cards keeps focus in the grid.
  - The header wraps its verbs under the title on a phone, rather than off the edge.
  - In the Diagram, Undo, Redo and Delete are not held back while TreeMaker is busy, but Save still is.
  - Left as is, with the reason in the code: a diagram-only save leaves out a read-only imported pattern (the `.osf` has no place for one, and its own file is never overwritten).

### Phase 2: uploaded pictures, painting and the step detail

- [x] **2a.** The `'diagram-workspace'` paper surface and policy, and `DiagramDocument.style`, set to the default Diagram preset.
  - As built: the policy applies every field, since a diagram puts every kind of picture on one page. `diagram/pictures/diagramPaperStyle.ts` resolves the stored style and keys it for the picture cache. `PaperExportTarget.surface` excludes the new surface: the Diagram exports through its own dialog (Phase 6), so the shared export dialog's analytics enum is unchanged.
- [x] **2b.** The upload pipeline.
  - `diagram/upload/svgSanitize.ts` per D7, with its report. The hostile and real-export corpus runs in jsdom and in `scripts/diagram-svg-sanitize-check.mjs` (Chromium and WebKit), as a new web-client CI step.
  - `importStepPicture.ts`: caps, sanitizer and `importImageFile`.
  - `FileService.openBinaryFiles`; `read_binary_file` `max_bytes`; svg MIME.
  - The assets table, re-sanitized and raster-checked on load and pruned at save.
  - `savedMessageFor` counts assets.
  - `pictures/paintDiagramStep.ts` + `stepPictureCache.ts`: data-URL `<img>`, IntersectionObserver, idle painting, byte-bounded LRU.
  - Entry points:
    - Upload pictures… (header menu, empty card, Replace picture…);
    - batch and multi-drop under the insertion rule;
    - a single drop onto an empty card fills it, and any other drop follows the insertion rule;
    - Export picture… and Remove picture.
  - `ui/Notice`, used for the sanitize report.
  - As built:
    - **Model.** `upload` sources and `asset` pictures. A step's picture key is `asset:<id>`. The reader re-sanitizes SVG assets with the asset id as prefix, and drops a bitmap whose header disagrees with its stored size. A step whose asset was dropped keeps its text and loses its picture. An unknown asset kind is carried. A source and picture that name different assets read as no picture. `withReferencedAssets` prunes at write time, and the save notice counts what is written. It keeps assets a newer build's step names anywhere in its raw form, and unknown kinds, since only that build knows what refers to them.
    - **Drops.** A drop on a card selects it first, so the insertion rule reads "here". A drop with no picture in it bubbles to the workspace, so a project dropped on the Diagram still opens. A drop on the empty state starts the diagram.
    - **Empty card.** Its Upload… is out of the tab order: an option's contents are presentational, and the card menu and the Step pane carry the same verb.
    - **Painting.** Cards paint lazily: an IntersectionObserver rooted at the pane's scroller (a viewport root would let the scroller clip the paint-ahead margin), and an LRU of `data:` URLs bounded by bytes and keyed by the asset *object*, so a file edited between two opens never shows the first one's picture. An upright bitmap shows its own data URL rather than being wrapped and encoded twice. Idle-chunk scheduling is left to Phase 3: an upload paints in microseconds, and a scene capture is what will need it.
    - **CI.** `scripts/diagram-svg-sanitize-check.mjs` runs the committed corpus (hostile, synthetic, own-output) in Chromium, WebKit and jsdom. It checks four things: nothing accepted fires when shown live; two raw controls do fire; every engine's stored output reloads byte-identically in the other engine; and the engines' pre-raster output equals jsdom's. About 20 s. The real Phase 0 corpus passes it too, run locally, with 85 files, 44 of them real.
    - **Desktop.** `read_binary_file` returns raw bytes (`ipc::Response`) under an optional `max_bytes`, and `openBinaryFiles` takes `multiple`.
- [x] **2c.** `DiagramStepDetail`.
  - The top bar, with touch Undo / Redo, and Annotate hidden until Phase 7.
  - Enter (viewport verb) and `[` / `]` (scope).
  - The Escape ladder's "leave detail" rung, and the empty-step body.
  - The upload pose (rotate 90°, mirror; the source's fields, applied at paint time), with annotation carry-over.
  - The Step pane switches to detail controls (D13).
  - As built:
    - **Selection.** The detail is open on the *selected* step (`diagramDetail: 'pose' | null`), so it follows the selection. Prev / next, ← / → and `[` / `]` all walk the steps inside it. Whatever clears the selection closes it: Escape's second rung, a delete of the last step, an undo past its step.
    - **Enter.** Enter is `diagram.openStep` in the conditional scope, not a viewport verb: `viewport.solveAnglesApply` holds Enter on the viewport surface, and the dispatcher runs only a scope's first match. Its executor declines for any interactive target, so a focused button keeps Enter, and it declines inside an open detail. `[` / `]` are extra chords of previous / next.
    - **Toolbars.** A toolbar of buttons no longer declines the arrows: none of the app's roams with them, and pressing Rotate must not leave `]` dead.
    - **Pose.** The pose verbs are their own catalog (`diagramPoseActions.ts`): Rotate Left / Right, Flip Horizontally, Reset Pose. They serve the detail's floating toolbar and the Step pane's Pose section, which shows only in the detail (D13). A flip is "as shown": the stored pose mirrors first, so flipping a turned picture also reverses its turn.
    - **Carry-over.** No annotation kind is readable until Phase 7, so there is nothing to carry yet. A step that carries a newer build's annotations is refused a pose (`poseBlocker`), with the reason, rather than left with annotations pointing at the old pose. Phase 7 adds the carry for its own kinds.
    - **Phone.** On a phone the detail's top bar seats the Step pane's drawer pill, since it replaces the header that seats it in the list.
    - **Opening.** A double-click on a card opens it, as Enter does.
- [x] **2d.** Analytics: `diagram step added` (`svg`, `raster`; `via`) and `diagram picture uploaded`.
  - As built, with 2b: `via` is `grid` for one picked file, `batch` for several, `drop` for a drop. A picture that fills an empty step adds no step and is counted only as uploaded. `diagram picture uploaded` has `outcome` `ok | flattened | too_large | rejected | unsupported | unreadable` (the plan's `not_svg` became `unsupported`, a file that is no picture at all). `format` is `svg | png | jpeg | webp | other`. `size_bucket` is in KB, `unknown` for a desktop pick that failed before it was read.
- [x] **Browser:**
  - upload each Phase 0 SVG singly and as a batch;
  - check the flatten Notice;
  - light and dark themes;
  - reload, then Export picture → edit in Inkscape → Replace picture;
  - repeat on the desktop build. **Not done:** this session cannot drive the desktop app's native window. The one desktop-only change, `read_binary_file` with `max_bytes` returning raw bytes, is covered by its cargo test, and the renderer reads both the new and the old reply shape. It stays on the list for the final verification before merge.
  - As run:
    - **Real corpus.** All 44 real Phase 0 files (Inkscape 0.92–1.4.4, Illustrator 10/16/25, Affinity, Figma) were dropped as one batch: 44 steps in 208 ms, one undo step, no failures. Six carry notices (four flowed text, one linked image, one unsupported part). Cards paint as they near the view.
    - **Fixtures and toast.** The committed fixtures were dropped in natural order, with a `.txt` among them, which got the one-line failure toast.
    - **Round trip.** Save and reopen through the real writer and reader: the replaced asset is pruned, and every kept asset comes back byte-identical.
    - **Inkscape.** Export picture, then an Inkscape 1.4.4 CLI edit (recolour every stroke, rotate 15°, saved as Inkscape SVG), then Replace picture: the edit is kept and the editor namespaces are gone.
    - **Detail.** Enter, `]`, Escape and the pose toolbar with real keys, including from a focused toolbar button. Phone layout at 375 px.
    - **Found and fixed.** A picture with no background of its own vanished into the dark theme's well (now paper white). The pose toolbar wrapped on a phone. A toolbar button took ← / → and `[` / `]` from the Diagram.

- [x] **Review.** A workflow of four reviewers (security, state, UI and keyboard, repo rules), each finding put to a skeptic. 17 were confirmed and fixed; 3 refuted.
  - **Sanitizer.** It ran synchronously on every open with no bound on CSS fan-out, marker copies, or several quadratic scans. All are now bounded, or refused past a cap. The DOCTYPE screen missed non-ASCII entity names (WebKit expanded one to 300 MB) and a DOCTYPE hidden in a comment. The JPEG walker misread fill bytes. A raster upload had no header check.
  - **State.** An upload step naming an unknown asset kind lost its picture on save. Replaced pictures stayed in the live document, so the history byte cap never trimmed. An upload landed where the selection had moved to mid-import.
  - **Drops.** A mixed drop left the workspace overlay stuck. Drops on the header, the detail or a read-only diagram got the CP canvas's refusal.
  - **UI.** Enter took a focused link. Reset Pose dropped focus. The empty card's Upload… was part of the option's name. Export was disabled on a read-only diagram. The picker title was wrong for an empty step.
  - **Analytics.** The detail, the pose verbs, Remove and Export picture had no events.

### Phase 3: crease-pattern and folded steps from the Edit canvas

- [x] **3a.** Extractions, each its own series with no behaviour change:
  - the `creaseExportFold` split (CP export goldens green) plus `cpFoldRuntimeBindings.ts`;
  - `regionReference.ts` with validators (inline-simulation tests green);
  - the shared `withFoldInFlight`.
  - As built:
    - `openFold` / `readFoldedPicture`, and `CpFoldRuntime` (adds `setModel` and `foldAnother`); `createCpFoldRuntime(runId)` lives in `cpFoldRuntimeBindings.ts`.
    - `cp-workspace/regions/regionReference.ts` has `RegionReference`, `regionReferenceFor`, `resolveRegion` and `readRegionReference`. The ring matching and its tests move there with it.
    - `store/workspaceStore/foldRuns.ts` takes the store's `get` and `set`, and the CP slice wraps it. The Diagram's run kinds arrive with 3b.
  - **Correction from the code map:** D5's "Crease pattern" row names `buildCreaseExportArtwork`, which yields SVG fragments, not a `PaperScene`. A crease-pattern step is instead built straight from the kernel's lines into a scene: the segment's paper as one face, and its lines with fold, edge and aux roles. The diagram style's fold pens are the crease-pattern pens. *(Superseded 2026-10-03, see "After Phase 7": a crease-pattern step is an instruction, its M/V in the diagram-crease pens and its aux lines the paper's existing creases.)*
  - **Correction from the code map:** the session ender's *phases* are `'session'` and `'bracket'`. `'history'` and `'document-replaced'` are the *reasons* a session is ended. The capture session registers as `'session'` and acts on the reason.
- [x] **3b.** Capture and status.
  - `captureFolded.ts`: crease-pattern, flat and 3D captures through the session runtime, with:
    - the capture model at `rotation 0, scale 1`;
    - `outcome`;
    - `fixed` pictures, sanitized at capture and on load;
    - paper scale;
    - the scene budget and raster fallback.
  - `linkStatus.ts` with D3's precedence.
  - The step's `revision` check on commit.
  - Test: open a `.cp` file, link a step without editing anything, and it reads `current`.
  - As built:
    - **The model and file.** `cp` sources and `scene` / `fixed` pictures, with their validators and round trips. A stored scene is written through the validator (`storedSceneJson`), so a load is byte-stable. The camera validator moved beside the camera, and stored thumbnails got one (`readSheetThumbnail`).
    - **Choosing creases** (`captureCreases.ts`), shared by capture and status:
      - a region is found by its rim and made of every line inside it (the selection toolbar's containment);
      - a figure box re-chooses by overlap, as Edit refolds;
      - the fingerprint covers the scope's foldable lines in kernel order.
    - **One scale.** Every capture is at `CAPTURE_PX_PER_UNIT`: Edit's user units per pattern unit at 100%, the space a 3D figure's stored scene is built in. Crease-pattern and flat captures carry it as their paper scale. A 3D capture carries none: its camera has perspective, so it is fitted (D10).
    - **Crease pattern** (`creasePatternScene.ts`): the scope's paper as one face, lines layered aux, folds, edge. An aux end that meets the edge or a fold retreats under erode; shared ends are joined. A figure box cuts its lines to the box.
    - **The route follows the creases.** A flat request whose creases now have a partial fold is captured in 3D at Edit's default camera, and the reverse. A solution past the last found keeps the last.
    - **Stored form** (`storableScene`): nothing hidden, no markup, coordinates to 0.01 px (finer on a sheet under 400 px). Past 2 MB, the store rasterizes at 300 dpi in an 80 mm box, with the bitmap's own paper scale.
    - **The store** (`diagramCapture.ts`, `captureDiagramStep` / `stopDiagramCapture`):
      - a fold is a `'diagram-capture'` or `'diagram-refresh'` run, and the card can stop its own (`stopFoldRun`);
      - the result is dropped when the diagram was replaced, or the step is gone or its `revision` moved. An instruction typed meanwhile does not move it.
      - A capture that changes nothing records no undo step.
    - **Moved to 3d:** `useDiagramCaptureSession.ts`, with the Pose it serves.
- [x] **3c.** The Picture section and linking.
  - The pattern picker over the kernel-space `SheetGrid`.
  - **Link pattern…** from the empty card and header: pick → capture as a crease pattern, then Pose to fold.
  - Refresh, Relink, Remove picture.
  - Card badges, status chips, progress with Stop.
  - Optionally, **its own series first**: move `sheet-grid` / `sheet-card` into `SheetGrid.module.css` with a `columns` prop. It is a shared block, so the References and Simulate overrides become the prop.
  - As built:
    - **The picker is the Diagram's own** (`DiagramPatternPicker`, several small sheets to a row), not `SheetGrid`. The rails' one-card-per-row layout does not fit a pane section, and `sheet-grid` / `sheet-card` are a shared block other screens' tests look up by class, so a `columns` prop is a move of its own. The picker and the card draw thumbnails with `DiagramSheetThumbnail` and the shared `--sheet-thumb-*` tokens, as D's card note says.
    - **The picker is view state** (`diagramPatternPicker`), shown in the Step pane while its step is selected. Selecting another step closes it. **Link pattern…** from the header, the empty state or the empty card adds or selects the step, opens the picker and brings the Step pane forward (`activatePanel`). A pick captures a crease pattern; a relink keeps the step's render.
    - **The catalog** gains `link-pattern` (Link / Relink) and `refresh-picture` (linked steps only), gated on link status, a capture in flight and whether a pattern is open. Remove picture now takes a link with no picture yet.
    - **Status** comes from `useDiagramLinkStatuses`, which asks for the segmentation only when a region-linked step needs it. The card shows Out of date or Pattern missing over the picture, Capturing… with Stop while a capture runs, and the pattern's thumbnail beside its kind. The Step pane says how the link stands, and offers Stop.
    - **Analytics:** `diagram picture captured` (`kind`, `outcome`, `via`: link, relink, refresh), and `diagram picture removed` takes the captured kinds.
    - Verified in the browser on the crane (link from the empty state, out of date after an edit, Refresh, Relink), in both themes.
- [x] **3d.** Pose for folded steps inside the step detail.
  - `useDiagramCaptureSession.ts`:
    - retain and release;
    - epoch and engine-lost handling;
    - `withFoldInFlight` kinds;
    - the exit table from D4, with Revert and undo during Pose.
  - The Crease pattern | Folded form switch (D5).
  - Flat: turn over through `setModel`, rotate, Next solution through `foldAnother`.
  - 3D: `useFolded3dMeshRuntime` + `SimulatorViewport` with presets and the CPU fallback, captured through `folded3dFigureScene` with the diagram style and its `styleKey`.
  - As built:
    - **Each verb commits** ("Adjust pose", one undo step), as the upload pose's verbs do. This departs from D4's capture-on-exit. With nothing waiting to be captured, every way out of the detail is the same (let the fold go), Revert is Undo and Reset Pose, and undo during Pose undoes one verb. The exit table and its races with step navigation go away.
    - **The session** (`captureSession.ts`) holds one fold between verbs: flat (turn over by `setModel`, next solution by `foldAnother`, rotation re-read from the held kernel scene) or 3D (its render model, never registered with `setFolded3dRenderModel`). It owns its handle through `retain` / `release` and the epoch. It folds again when the document snapshot or the chosen lines change, or after an engine reset.
    - **The controller** (`poseController.ts`, one per open step, through `useDiagramLinkedPose`) runs each verb under `beginStepCapture`. Folds are `'diagram-capture'` runs the card can stop; kernel work is abandoned if the engine is lost (`abandonOnEngineLoss`, also used by Refresh). Every commit goes through the step's revision guard. On `'history'` it stops the step's fold; on `'document-replaced'` it lets the fold go; on engine loss it forgets it.
    - **The verbs** (`diagramLinkedPoseActions.ts`, `linkedPose.ts`):
      - a crease pattern turns in 15° steps;
      - a flat fold turns over, turns, and steps to the next layer order;
      - a 3D fold looks from the other side, above, the front or the corner;
      - every mode has Reset Pose.
      - When the creases now fold the other way (a partial fold added or removed), a folded verb re-folds by the route.
    - **3D** is live in the stage (`DiagramPose3dView`): Edit's mesh runtime with an interactive viewport and the view cube. An orbit is captured once the view rests (450 ms), as one undo step. Where the worker cannot draw, the captured picture stands in and the named views still work. No per-move CPU rebuild.
    - Verified in headless Chromium on the crane (crease pattern → folded → turn over → rotate) and the 90° box (live 3D, an orbit).
- [x] **3e.** Entry points and queues.
  - **Add to diagram** on `CpSelectionToolbar` (one pattern) and in `foldedFigureActions.ts`.
    - It records the figure's provenance and pose: side, foldCase, `rotationDeg` (the figure model's rotation) and the 3D camera.
    - It builds the picture through the capture primitives, never by copying Edit's pictures or mutating Edit's figure.
    - A live 3D figure goes through `folded3dFigureScene(figure, render, {style: diagramStyle})`, recording the `styleKey`.
    - For a live flat figure, its handle's paper scene is read, and the model's rotation and scale are removed through `foldedFlatPaperScene`'s `toScenePx` affine.
    - A figure with no live handle or render model, flat **or 3D**, is added with provenance and opens nothing. Diagram shows "Pose to capture".
  - The `oristudioCpRegionFocusRequest` for **Open in Edit** (latched, consumed on CP panel mount, framed through `cpCamera()`).
  - **Refresh all** (`captureQueue.ts`).
  - As built:
    - **Add to diagram** is on the selection toolbar (a crease-pattern step of that pattern) and in the folded figure's verbs (`add-to-diagram`, held for a figure with no recorded box). Either adds one step, in one undo step, after the diagram's selected step (`addLinkedDiagramStep`, `captureNewLinkedStep`). It toasts "Added as step N" with Open diagram, and never switches workspace.
    - **A figure's picture:**
      - a live 3D figure is drawn from its render model at its camera, in the diagram's light, with no kernel work, keeping the figure's fingerprint;
      - every other figure is folded again from its box as a visible, stoppable run, posed as Edit shows it (side, canvas rotation, layer order).

      This departs from the plan's "added with provenance and opens nothing". Every figure in a reopened file has no live handle until Edit refolds it, so that path would have been the common one and left steps blank. A flat figure's live paper scene is not read either. The model rotation and scale an Oriedita file can carry would have to be undone, and a fold is cheap.
    - **Open in Edit** (Step pane, linked steps; also on a read-only diagram) latches the region (`regionFocusRequest.ts`). The Edit canvas takes it on its next frame and frames every fresh camera for that document with it, so a camera reset while the document settles does not lose it. A canvas that is already mounted is asked to draw.
    - **Refresh all out-of-date steps** is in the Add step menu, with its progress and a Stop while it runs. It goes one step at a time, yields between steps, and waits while Edit is active. It asks before losing a redo branch, and is one undo step: later captures join the first one's entry while it is still the newest (`joinEntry`). It ends on a Stop, a replaced diagram or a lost engine.
    - Verified in headless Chromium on the crane: a pattern and two reopened figures added, Open in Edit framing the step's sheet, an edited crease making its step out of date, and Refresh all bringing it back as one undo step.
- [x] **3f.** Analytics: `diagram picture captured` and `diagram step added` (`crease_pattern`, `cp_folded`, `cp_3d`).
  - `diagram picture captured` landed with 3c. Pose verbs are counted by `diagram picture posed`, whose `action` and `kind` now cover linked steps. Add to diagram counts `diagram step added` (`crease_pattern` via `edit_toolbar`; `cp_folded` / `cp_3d` via `folded_figure`).
- [x] **Browser** (CP wasm rebuilt first):
  - link all eleven crane states;
  - turn over, rotate, Next solution, Revert;
  - a fold with no layer order;
  - a 3D step;
  - edit a crease → Out of date → Refresh;
  - move a sheet → Pattern missing → Relink;
  - a partial-selection figure step;
  - Stop a slow fold from Diagram and from the global toast;
  - leave Pose by every exit;
  - the fold never adds a figure to the Edit canvas, and undo stays in the diagram;
  - a 50-step diagram opens without a long task over 200 ms.
  - Results (Chromium, dev server; scripts in the ignored `artifacts/diagram-phase3/`):
    - **Crane, all eleven states** link as crease patterns and fold flat: 0.3–1.2 KB each, a byte-identical save and load, one paper scale between a pattern and its folds. Turn over and rotate work; each crane state has one layer order. Revert is Undo or Reset Pose, since verbs commit.
    - **No layer order.** Three crane bases with one crease flipped fold to sanitized see-through developments, saved byte-identically. The Picture section now says why.
    - **The 3D box** is live in Pose; one orbit is one undo step.
    - **Status.** A flipped crease makes its step Out of date, and Refresh brings it back. A sheet moved 600 units makes its step Pattern missing, and Relink brings it back.
    - **Partial selection: not browser-checked.** The crane has no foldable partial region; a half-square selection does not trace as a sheet. It takes the same figure-box path as a whole figure, which unit tests cover with clipping.
    - **Stop.** On the iguana's 850-face sheet, the card's Stop and the global Stop (`stopOristudioCpFolds`, what the toast's Cancel calls) each end the fold as stopped, leaving the step as it was. The toast only shows after its delay, which this fold barely outlasts.
    - **Edit untouched.** Its eleven figures are unchanged by Diagram folds, and the diagram's history holds only diagram entries.
    - **50 steps.** Opening the crane with a 50-step diagram (1.5 MB) costs what opening it bare does: long tasks of 128 + 195 ms against 110 + 217 ms, which is the crease pattern loading. Switching to the Diagram costs 145 + 60 ms. Scrolling paints the remaining 34 cards with no long task.
- [x] **Review.** A workflow of four reviewers (state, file, UI and keyboard, repo rules), each finding put to a skeptic. 15 were confirmed and fixed, each with a test; 1 refuted (a duplicated scene-bounds helper: real, but no defect).
  - **Pictures and the file.**
    - The scene reader dropped every line's `joined` flags, so a stored crease pattern's corners and a 3D crease's bends painted with butt-cap gaps. `readPaperScene` now keeps them. This also fixes Edit's stored 3D figures.
    - A pattern whose scope has more than 20,000 lines could not be linked: its thumbnail was past what the file reads back. The capture now trims it to what the file takes back (dots and repeats first, then the shortest creases, never the edge).
    - The load-time caps measured the input, not what is kept, so a fixed picture or scene that sanitizing lengthened loaded once and was dropped on the next load.
    - A capture kept as a bitmap had a random id, so the same capture again was another undo step and another bitmap. It is now named by what it draws.
    - A crease-pattern step drew its aux lines but fingerprinted only the foldable ones, so moving an aux line left it current. It is now fingerprinted on every line it draws (`creasesFingerprint`); a fold keeps its foldable-only fingerprint.
  - **Pose.**
    - A fold that landed after the detail closed was retained and never freed. The session now frees a fold that is no longer wanted (`CaptureSessionClosedError`, silent), and closing the detail stops its own fold.
    - The live 3D view and "has another layer order" were kept by step only, so after a Relink or undo they described the old creases. They are now keyed by scope and fingerprint (`linkedFoldKey`).
    - Rolling the 3D view (Shift-drag, the cube's ring) was never captured and snapped back. The roll is now folded into the stored orientation (`withRollAbsorbed`).
  - **Keyboard and focus.**
    - Every linked Pose verb disabled itself under the focus for the length of its capture. Verbs now wait (`aria-disabled`) instead.
    - The picker's arrows, Home and End went to the Diagram's step keys. The picker now owns them (`data-own-arrows`): one tab stop, roving focus.
    - A pick or Cancel dropped the focus. It now returns to Link Pattern… (`useReturnFocusOnClose`).
  - **Edit and Refresh all.**
    - Add to diagram on a read-only diagram did nothing and said nothing. The selection toolbar's button is now disabled with the reason, and the figure verb says why.
    - Stop refreshing stopped every capture in flight. It now stops only Refresh all's own.
    - Refresh all's captures went uncounted. They now count `diagram picture captured` with `via: refresh_all`. Open in Edit counts `diagram source opened`.

### Phase 4: References steps

- [x] **4a.** The verbs: `references.sendToDiagram` and `sendAllToDiagram` in the registry, catalog, executor and context menu, through `useReferencesSendToDiagram.ts`.
  - Capture from filmstrip rows only; skip `done`; handle `StepDiagramAdapterError`.
  - Per-sheet provenance.
  - As built:
    - `referencesDiagramCards.ts` turns strip rows into cards: the unit-frame model (a ReferenceFinder diagram through the card's own adapter; a refusal is an error toast and nothing is sent), `mirrored`, the sentence, the strip's number, and the plan step's `line` from the view step under the row. Send all skips the ending by kind; Send can still send it on its own.
    - Unbound verbs (null chord), in the context menu after Export, and Send to diagram on the viewport bar beside Export (pinned, so a touch bar has no `⋯` for one row; not on the phone, whose bar ends with the stepping). While From References… waits, Send's label is "Send to Diagram Step N".
    - The pipeline (`diagram/capture/sendReferencesSteps.ts`) is loaded on the first send, so References carries none of the Diagram's capture code until then.
    - **Correction from the code map: provenance.** `openReferencesWorkspace({sheetBoundary})` and `sourceFingerprintFor(document, sheetBounds)` did not fit. References sheets are precrease components, not segments, and a box fingerprint counts an adjacent sheet's creases that touch the shared edge (a false "Pattern changed"). Instead, the component's outline is matched by its rim (`resolveRegion`) to a region of the segmentation every link uses, and the step keeps that region and `drawnFingerprint` over every line in it. On the crane (11 of 11), the box (1 of 1) and iguana_24 (31 of 31) every sheet matched exactly one region. A sheet that matches none is still sent, with `fingerprint: null`, and reads "Pattern missing".
    - The source also keeps `thumbnail` (for the card and the Step pane, as a linked pattern does) and `side`, the side the card showed, which Reset Pose returns to.
- [x] **4b.** Painting at the target scale (D6) plus `validateStepDiagramModel`. Golden: marks keep their pt size at two cell sizes.
  - `paintStepDiagram.ts` builds the scene at the sheet size it is painted at (`createOverlayProjector`, `ey: [0, −scale]`, mirrored about the sheet's middle), inked against Edit's default crease width rather than the sender's, and paints it with the aux switch on, as References' own export does. The golden checks the marks' group scale, ring radius and letter size are equal at 50 and 100 mm while the paper doubles.
  - `stepDiagramModelFile.ts` checks every kind and style against the unions (an unknown one makes the step unknown and verbatim), every number finite, at most 50,000 primitives and labels of 1–64 characters, and rebuilds the model in one key order; a send runs each model through it (`storedStepDiagramModel`), so nothing is stored that a load would refuse.
- [x] **4c.** The References pose (turn over toggles `mirrored`), the staleness copy, and **Open in References** (`openReferencesWorkspace({sheetBoundary})`).
  - Turn Over and Reset Pose (`buildDiagramReferencesPoseActions`) re-key the picture for the side; one undo step each ("Adjust pose").
  - Staleness: the card says "Pattern changed" (never "Out of date"); the Step pane "Pattern changed since this step was sent" or "Unchanged since this step was sent". A References step is never refreshed and never counted by Refresh all.
  - Open in References latches `referencesSheetRequest {boundary, mode}`; the panel takes it once its sheets are known (`useReferencesSheetRequest`), selects the sheet whose outline matches, and switches to the step's mode (`references mode changed`, `source: diagram`). A sheet no longer there is said so.
- [x] **4d.** **From References…** in Diagram (the latched `diagramReferencesTargetRequest`). The sentence becomes the default instruction.
  - As built: `diagramReferencesTarget`, set from an empty step's card (References…) or the Step pane (only on an empty step: a send to one with a picture would add after it, which the header's From References… already does). The card shows "Waiting for References" with Cancel; the next send fills it (its own words kept, if it has any) and puts the rest after it, as one undo step. The header's Add step menu and the empty diagram have From References…, which only opens References: a send then adds after the selected step.
- [x] **4e.** Analytics: `references step sent to diagram`, and `diagram step added` (`references`).
  - `references step sent to diagram` has `mode`, `via` (`one`/`all`), `count_bucket` and `into` (`new_steps`/`waiting_step`). Each new step counts `diagram step added` (`references`, `references`); a filled one does not. Turn Over counts `diagram picture posed` (`kind: references`); Open in References `diagram source opened` (`references`).
- [x] **Browser:**
  - send one step, then a whole sequence;
  - a Find candidate;
  - a turn-over card and a mirrored back-side card;
  - the M/V direction matches References;
  - edit another sheet: no false "Pattern changed".
  - Results (Chromium, dev server; scripts in the ignored `artifacts/diagram-phase4/`):
    - **Send, Send all.** The crane's first sheet: Send added card 1 with its sentence; Send all added its 30 cards (the opening turn-over and 29 folds, all of the back) after it, one undo step.
    - **Find.** A vertex picked at the crane's middle: its three steps (two diagonals and ReferenceFinder's own diagram) sent.
    - **Turn-over and back.** The turn-over card and the back cards are drawn mirrored on the diagram's back paper; Turn Over in the detail mirrors a front card, makes its valley a mountain, and keeps the focus on the button.
    - **M/V.** A back card and a front card beside References' own: the same folds, valleys in both (dashed in the diagram's pen, blue in References').
    - **Staleness.** A step from one sheet: flipping a crease of another sheet left it as it was; flipping one of its own made it "Pattern changed".
    - **Open in References**, with another sheet selected and Find on, landed on the step's sheet in Sequence. **From References…** made the bar read "Send to Diagram Step 2", and the send filled step 2.
    - **Round trip.** A project with seven sent steps saved, reopened and saved again: the diagram byte for byte the same.
- [x] **Review.** A workflow of four reviewers (state, file, UI and keyboard, repo rules), each finding put to a skeptic. 7 confirmed and 3 plausible, all fixed with a test that fails without the fix; none refuted.
  - **The waiting latch.** From References… kept waiting after its step got a picture some other way (an upload, a Link…, a drop): the card still said "Waiting for References", References' button still read "Send to Diagram Step N", and the send then added after N. Four places each had their own idea of "waiting". Now there is one predicate (`awaitingReferencesStep`: the step is there, unlocked and has no picture). The send, the card, the Step pane and References' label all use it, and every commit and undo drops a latch it no longer holds.
  - **Open in References** landed in Find when References had last been left in Sequence on another sheet. Selecting the sheet resets the view to Find, and the mode switch compared against the last render's mode, so it did nothing. It now reads the store's mode as it is. On a phone it opens the sheet's detail, not the list (`flow.showSheet`, which counts no card press).
  - **A send without the segmentation** (the engine not ready, or restarted) stored the raw outline with no fingerprint, and the step later read "Pattern changed" for good. Such a send is now refused with "The crease pattern isn't ready yet". A step that kept no fingerprint (its sheet matched no region) never says its pattern changed: its status is `unknown`.
  - **A crafted model** under the 50,000-primitive cap could hang the page that draws it, because placing a label is a pass over every primitive and landing an arrow a pass over every mark. The reader now also caps labels (64), fold arrows (64), points (4,096), and labels × primitives (1,000,000; a dense card's is tens of thousands).
  - **Send all** had no keyboard path and no touch path. Both sends are on the viewport bar now, so the keyboard reaches them by Tab. On the phone they fold into one `⋯` with Export.
  - **Focus and styling.**
    - Cancel in the Step pane's waiting notice dropped the focus. It now returns to From References….
    - A waiting (`aria-disabled`) button lit up on hover, because the variants' hover rules only excluded `:disabled`. They now exclude both, edited in place.
    - Refresh's disabled tooltip claimed every linked step was current while References steps said "Pattern changed". It now reads "No linked step is out of date. Steps from References aren't refreshed."
  - Browser (Chromium):
    - Send all from the bar: 7 steps.
    - Open in References from sheet 0 in Sequence landed on sheet 3 in Sequence.
    - An upload into the waiting step cleared the latch, and References went back to "Send to diagram".
    - A hovered `aria-disabled` ghost button stays muted.
    - On the phone, the request opened the sheet's detail, its `⋯` held Export, Send and Send all, and Send all sent 7 steps.

### Phase 5: pages

- [x] **5a.** `lib/paper/textWrap.ts` moved, with code-point iteration and CJK breaking. Its own series; CP export goldens green.
  - As built: one breaker (`wrapGraphemes`) over graphemes, with the caller's measure; kinsoku, Korean keep-all, a word wider than the line broken between graphemes, and line-clamp truncation. `wrapExportText` delegates to it.
- [x] **5b.** Pure page modules, with property tests (every step on exactly one cell, no text below its cell) and goldens:
  - `printPaper.ts`, `diagramPageLayout.ts` (including `breakBefore`, scale policy and overflow);
  - `composeDiagramPage.ts` (the empty step, overlay-only guides, the embedded font per Decision 2, unique ids across cells);
  - the bundled font module (`diagramFont.ts`).
  - As built:
    - **Fonts.**
      - `scripts/diagram-fonts/build_fonts.py` builds them from google/fonts at a pinned commit (sha256-checked): static Regular and Bold, with GSUB, GPOS, GDEF and hinting dropped.
      - Noto Sans is cut to `charsets/latin.txt` and committed (60 KB each, `src/diagram/fonts/`).
      - SC, TC, JP and KR are built as `common` (0.5–2 MB TTF) and `full` (5–11 MB) files plus `manifest.json`, into the ignored `public/fonts/diagram/`.
      - Each family's OFL.txt goes beside its files. NOTICE section 6 and LICENSING.md › Fonts record them.
    - **Measuring.** `fontMetrics.ts` reads advances from `hmtx` and cmap formats 4 and 12; there is no shaping, because there are no features to shape with.
    - **Loading.** `diagramFonts.ts` loads Noto Sans always. A CJK face loads per text that needs it: the common file, then the full one only for a character the common file lacks. Each download is checked against the manifest's size and sha256. Faces are kept per session, and a failure is retried. A face that cannot be had is reported (`unavailable`).
    - **Which font.** `fontScripts.ts` picks one font per run, by Script. Kana make a text JP, Hangul KR, and otherwise it takes the Han style. Common characters join the run before them. Fallback goes through the other CJK fonts, then Noto Sans. A character no font has is reported and set in Noto Sans, so a page never names a family it did not embed.
    - **Setting text.** `setText.ts` is shared by `fontTextSetter.ts` and the layout's `estimateTextSetter.ts`. It keeps the instruction's own line breaks, puts "…" in the font before it, and splits each line into one run per font, with each run's x.
    - **Pictures.** `pagePictures.ts` gives the layout each picture's extent in pattern units:
      - a scene's bounds over its paper scale;
      - a bitmap capture's size over its own paper scale (the field is picture px per unit; its old comment said mm);
      - a References step's region over its sheet, scaled by how far its marks reach.

      Uploads, fixed pictures and 3D are fitted. It draws each picture into its cell: a scene through `paperSceneSvgBody`, a References step built at its sheet's size on the page with its letters set in Noto Sans, and anything else nested. Every id is renamed under the cell (`prefixIds`, tags only).
    - **Laying out twice.** `diagramPages.ts` lays out twice when a References step shares the scale: its marks keep their pt size, so how far they reach past the sheet is measured again at the scale the first pass found.
    - **Composing** (`composeDiagramPage.ts`). The page is drawn in pt:
      - the band (the mockup's smoothing), the title tab, the cells, and a page number right-aligned by its measured width;
      - text as one `<tspan>` per run with `xml:space="preserve"`, and CSS turning off kerning, ligatures and CJK auto-spacing;
      - each face embedded as a data-URI `@font-face`, cut by `harfbuzz-subset.wasm` (`fontSubset.ts`, `fontEmbedding.ts`).
    - `lib/base64.ts` is the one base64 encoder, replacing two copies.
  - Browser (Chromium; `artifacts/diagram-phase5/pages.mjs`):
    - **What was composed.** The crane's sheet-3 sequence (7 steps), with "Crane · 千纸鹤" and instructions in Chinese, Japanese, Korean, Russian and English, composed in about 40 ms (fonts loaded) plus 15 ms to compose.
    - **Grid.** Every sheet is at one scale, CJK text breaks under kinsoku, and Korean keeps its words whole. The long Russian and English steps' pictures shrank for their text, with no overflow.
    - **Flow.** Rows run in alternating directions and odd cells step down. The band runs behind the pictures and off the page's edge where the sequence goes on.
  - Left for Phase 6:
    - text inside an uploaded SVG still names its own fonts. The PDF needs it mapped to the diagram fonts, with its characters embedded (D7 policy).
    - the CJK files still have to be published with the web deploy and the desktop bundle (Decision 2: same origin; the desktop installer carries the common tiers).
- [x] **5c.** The Pages UI.
  - The Steps | Pages tabs; `DiagramPagesView` with its overlay, captions and zoom.
  - The `diagram-page` side pane, its reveal rules and `DiagramPagePanel`.
  - `ui/OptionCard`; `DiagramStyleControl`.
  - The style-change chips: 3D steps show "Lighting changed — Refresh", and simulated steps show "Pose again" (D5).
  - "Start a new page here".
  - As built:
    - **Header.** `DiagramViewSwitch` (a peers `WorkspaceTabStrip`, filling a row of its own on a phone), and "N steps · M pages" from `splitIntoPages`, the layout's own split.
    - **Pages view** (`DiagramPagesView`).
      - **Pages.** One column under `useViewportSurface`'s camera, with no shortcut registration of its own. The Diagram's viewport executor stays the surface's one owner and asks the view's camera for the zoom and fit keys (`registerDiagramViewCamera`).
      - **Fit.** A new `fitAnchor: 'fit-rect'` frames the first page rather than the middle of the column. The library's own `centerOnInit` is off.
      - **Composing.** A page is composed when it comes within a view's height (IntersectionObserver). `useDiagramPages` keeps the last pages on screen until the next lay out, and caches each composed page's `data:` URL per layout.
      - **Overlay.** Laid over each page, never in the file: the margin guide, an empty step's "No picture yet" box, a "Text doesn't fit" mark, and the cells. Pressing a cell selects it; a double press opens Pose; a press elsewhere on the page brings Page forward. "Page n of m" is read from the camera.
    - **Page pane** (`DiagramPagePanel` over `useDiagramPageSetup`):
      - **Paper:** size, orientation, margin.
      - **Layout:** `OptionCards` for Grid and Flow; columns or steps per row; rows; Show path; one scale or fit each; the steps-per-page and pages readout.
      - **Header & footer:** title, page numbers and the first number.
      - **Style:** `DiagramStyleControl` and the Han style.

      Every change is one undo step and one `diagram page setup changed` (by setting, never a value).
    - **Style choices.** `diagramStyleChoices` offers Diagram, Default, the Settings export style, and each saved preset. Anything from Settings is copied into the diagram when chosen; a style no choice holds any more reads "This diagram's own".
    - **Reveal rules.** `useDiagramPaneReveal`, on transitions only, never on touch, after the gesture: to Pages brings Page forward, to Steps brings Step, and a newly selected step brings Step.
    - **Chips.** `lightingChanged` (a 3D capture's baked light key against the diagram's style) gives cards "Lighting changed" and enables Refresh on a current link, and Refresh all and its count include those steps. Cards say "Text doesn't fit" from the same layout the pages use.
    - **Start a New Page Here.** A checked verb in the card menu (`breakBefore`), off on the first step.
    - **Analytics.** `diagram view switched` (`view`) and `diagram page setup changed` (`setting`, plus `style` for a style change).
    - **Fixes on the way.** `useViewportSurface.fitToView` took a toolbar's click event as its animation time, which `setTransform` turns into NaN; it now ignores anything that is not a number. A test that found the selected card by `[aria-selected="true"]` now also matched the new Steps tab, so it asks for `[role="option"]`.
  - Left for Phase 8: simulated steps' "Pose again" (there are no simulated steps until then).
- [x] **Browser:**
  - every paper size and orientation;
  - grid and flow, with and without the path;
  - paper vs fit scale, with the crane model visibly shrinking;
  - a 30-step diagram;
  - CJK and long English text wrap inside their cells;
  - overflow is flagged;
  - a style change repaints a 50-step diagram without a long task over 200 ms, and 3D steps show Lighting changed.
  - Results (Chromium; `artifacts/diagram-phase5/ui.mjs`, `checks.mjs`, `light3d.mjs`):
    - **The 30 steps of the crane's sequence:** four A4 pages.
      - The Pages tab brought Page forward and opened framed on page 1 ("Page 1 of 4"), with two pages composed.
      - A cell press selected step 2 and brought Step forward; Flow, zoom and Fit worked; A5 landscape relaid it as five pages; a double press opened step 3 in Pose.
    - **Every size and orientation** (A4, A5, B5 JIS, Letter): each page kept its paper's ratio (0.707, 0.705, 0.708, 0.773 portrait), and every cell lay inside its page.
    - **One scale against fit each,** on the 50-step linked crane: under one scale a small region and the folded models are drawn smaller than the full sheets; under fit each every picture fills its box.
    - Flow without its path, CJK and long English text (5b), and a cut instruction flagged on the page.
    - **Style change on 51 steps:** no long task in the Pages view, and one of 112 ms in the Steps view.
    - **Lighting changed:** a 3D step of `box_90` showed it after a change of light, and Refresh all relit it and cleared it.
    - 25 of that file's crease-pattern steps read "Out of date". The file was saved before Phase 3's review changed a crease-pattern step's fingerprint to every drawn line, so this is the file's age, not a fault.
- [x] **Review.** A workflow of four reviewers (layout and state, fonts and files, UI and keyboard, repo rules), each finding put to a skeptic. 20 confirmed and 2 plausible, all fixed; 3 refuted. One of the refuted, an unused second `PT_PER_MM`, was removed anyway.
  - **Layout.**
    - The overflow rule shrank the picture by whole lines it counted after clamping at zero, so a slot short of more than one leading kept its text missing: an A4 landscape six-row page printed no instruction at all. The picture now gives up the measured shortfall. In a cell too short for even one line at half the picture, it gives way further for one line.
    - A long title ran past its tab in white on white. It is now cut with "…" to the page (`TextSetter.line`'s `maxWidthMm`).
    - Korean broke between Hangul and the digits or Latin of a word ('45도로', 'CP를'). keep-all now breaks Korean only at spaces.
    - Text is set NFC, so a decomposed accent is the font's own letter.
  - **Fonts.**
    - ①, →, ㎝, ○ and ℃ were reported missing: the full CJK file was fetched only for CJK-block characters, and nothing fetched a CJK font for a Latin text.
      - A face is now loaded for any character Noto Sans lacks.
      - The full file is fetched only when the manifest's per-script coverage (compact base-36 runs, 65 KB for all four scripts) has a character the common file lacks.
      - The common charset gained arrows, circled numbers, geometric shapes, stars, letterlike symbols, maths operators and the CJK unit squares.
    - A full file that failed threw away the common face that had loaded. The common face is now kept, and the face is reported as not whole.
    - The Latin bundle gained Latin Extended-B, the combining marks, spacing modifiers and Vietnamese (107 KB a face). The arrows it claimed were never in Noto Sans; the CJK common tier now carries them, and the build says which requested characters the source lacks.
    - NOTICE called the OFL fonts GPL-compatible. It now names them as distributed alongside the program under their own licence.
  - **Document.**
    - A duplicate copied its original's page break, which left the original alone on its page. The copy now follows the original on its page.
    - A capture kept as a bitmap kept no style. It now records `diagramStyleKey`, reads "Style changed" when the style moves under it, and Refresh draws it again.
  - **Pages view.** It moved to `usePagesView` (camera, composing, selection, pans), and the component only draws.
    - Enter and the arrows did nothing from a page. The steps are now one listbox (pages as groups) marked as the steps surface, so Enter opens the selected step, the selected one is the tab stop, and focus follows the selection.
    - The selected step is brought into view when it changes, and when the pages first lay out.
    - A Space-drag ended in a click that selected the step under it or brought Page forward. A press that ends a pan is now ignored.
    - Zoom presets and Actual size jumped to the middle of the column. With `fitAnchor: 'fit-rect'` they now keep the middle of the view where it is.
    - "Page n of m" mixed the printed number with the count. It now gives a position, and the readout is hidden while the pages lay out. A page is named by the number it prints, or by its place when it prints none.
    - `aria-selected` was on `role="button"`. The cells are now options, so the selection is announced, and a cut instruction is in the option's name.
  - **Page pane and header.**
    - The Scale, Style and Han characters explanations were hover-only titles. They are now help marks (`help` through SelectRow and SegmentedRow).
    - The phone header reordered the tabs with CSS, so the focus order disagreed with what is seen. It no longer reorders: title, tabs, then the verbs.
  - Browser (Chromium, `artifacts/diagram-phase5/review5.mjs`):
    - Enter on a pressed step opened it in Pose.
    - End selected step 50, brought it into view and read "Page 6 of 6".
    - A Space-drag from a step selected nothing.
    - 100% stayed on page 6.
    - ①, →, ㎝, Romanian and Vietnamese were set with nothing missing, and Korean kept '45도로' and 'CP를' whole.
    - A long A5 title ended in "…" inside its tab.
    - The phone header's focus order is title, Steps, Pages, then the verbs.

### Phase 6: export

- [x] **6a.** The PDF writer, and an upload's text in the diagram's fonts (commit "Diagram 6a").
  - **`crates/oristudio-pdf`** prints the composed page SVGs with krilla 0.8.2 and krilla-svg 0.8.1 through usvg 0.47 (pinned: Phase 0 measured exactly these), against only the fonts it is handed.
    - A family it lacks, a weight it lacks, or a glyph a face does not have fails the document (`PdfError::Text`): the composer measured every line in the faces it names.
    - The glyph check reads the glyphs usvg lays out, not its fallback calls. usvg shapes a run of text in each of its spans' faces and keeps each span's own glyphs, so a span's face is asked for its neighbours' characters too; an upload's mixed-script run tripped the first version.
    - Every font must draw something for its missing-glyph box (glyph 0), or the writer refuses it: usvg drops a text that draws nothing before any check sees it (see the review). One case stays out of reach: usvg also drops a run whose spans shape to different numbers of glyphs. The composer sets one span a run, and an upload's spans are cut from subsets holding only their own characters, so the counts agree.
    - **Print shop:** the media box is the trim plus 3 mm bleed and 5 mm slug a side, with BleedBox and TrimBox, and 0.25 pt crop marks from the bleed to the media edge in the registration colour (`/Separation/All`). Art past the bleed is clipped.
    - No XMP, a fixed producer and the title: the same diagram writes the same bytes, natively and in wasm.
    - Images are data URLs only; nothing reads the file system or the network.
  - **`crates/oristudio-pdf-wasm`**, built by `build:oristudio-pdf-wasm` (part of `build:wasm`): 4.2 MB, 1.5 MB gzipped, run in a one-shot worker (`browserPdfWriter`) that is terminated after the export or when it is stopped.
  - **`diagramPdfInput`** composes every page with no fonts embedded and cuts one subset per face for the whole document, so a face is embedded once however many pages set it.
  - **Upload text** (D7's "mapped to the diagram fonts, with a notice"):
    - The sanitizer takes every font property but the size off every element (expanding the `font` shorthand first) and splits each text node into runs by script, with `fontScripts.ts`'s rule.
    - Each run's element gets the family and a weight of 400 or 700, as a browser picks between the two.
    - Han is written as Noto Sans SC, standing for the diagram's Han style, which the upload cannot know. Kana or Hangul in the text, or a `ja` / `ko` language tag, makes it JP or KR.
    - Italic is set upright. Any of this raises a `text-font` notice: "Its text is set in the diagram's font, so it may look a little different."
    - The composer reads the runs back from the stored markup, puts the Han style in, moves a character a face lacks to one that has it (`TextSetter.runs`), and counts what each face sets so the page embeds it. The font loader loads the faces upload text needs, each run in the face it was given.
    - The page's set-text rules (no kerning, ligatures or CJK autospace) now apply to every `<text>`, uploads included, so screen and PDF agree.
- [x] **6b.** Step files, the dialog and the menu.
  - **`stepFiles.ts`.** A file for each step with a picture; the others are listed and skipped. Files are named `<title>-step-NN`, padded to the step count's width, and a skipped step keeps its number.
    - **Same size:** every file is the canvas, W × H mm. The picture's box is the square between the number and a five-line instruction slot. Every paper picture is drawn at D10's shared scale for that box, two passes when a References step is measured. An instruction longer than the slot is cut and listed.
    - **Cropped:** the same scale, but each file is cut to its drawing, with the number over its corner and the whole instruction under it, at least 50 mm wide.
    - The page's number and text writers (`stepNumberElement`, `stepTextElement`, `svgDocument`) are shared with the composer. Each file embeds the subsets it sets. A cell picture now reports its drawn bounds.
    - Transparent, or the page's white.
    - PNG at 300 or 600 dpi through `paperSvgToPng`. The file on show is checked against `pngCanvasLimits` before export, and every file again at export.
  - **`DiagramExportModal`** (in `ExportModalFrame`) and **`DiagramExportOptions`**, with their own modules.
    - **Preview:** the page or file on show, in a box of its own aspect, with a pager and its size ("210 × 297 mm · 6 pages · with 3 mm bleed", "52.4 × 68.5 mm · 1,238 × 1,617 px · 51 files · ZIP").
    - **Options:** `OptionCards` for PDF | Step files (ZIP), then At home | Print shop with "Edit page setup" (closes the dialog and brings the Page tab forward). For step files: SVG | PNG, 300 | 600 dpi, number, instruction, same size, W / H in mm (H's minimum follows the number and text), and transparent.
    - **A `Notice`** names the steps with no picture (blank space in the PDF, skipped in the ZIP), the instructions cut, and characters no font has. A PDF with such characters is refused before it is tried; step files draw a box.
    - **The footer:** Cancel, which reads Stop while the files or the PDF are being written (closing stops them, and nothing is offered to a save dialog), and Export, which shows progress. A sonner toast follows the save.
    - The options are remembered on save (`settingsStore.diagramExport`, `diagram-export`), normalised.
    - The I/O (fonts, PDF writer, file service) is injected (`DiagramExportDependencies`), so the dialog is tested end to end in jsdom.
  - **`file.exportDiagram`:** the menu action, its capability (any workspace, while an engine works, one step or more), File › Export › Export Diagram..., and the header's primary Export… button, which dispatches it so `command invoked` counts it.
  - **Analytics.** `diagram exported` (`format`, `preset`, or for a ZIP `file_type`, `resolution`, `number`, `text`, `size`, `background`; file, step and empty-step buckets), with its `docs/analytics.md` row. `'pdf'` is added to `ExportFormat` for `file exported`.
  - **Changed from the plan.**
    - Print shop has no separate bleed and crop toggles: a print shop wants both, and a file with marks but no bleed is what they reject. The `bleed` and `crop` properties of D18 went with them.
    - D18's `uniform` is `size: same | cropped`. The ZIP's count is `file_count_bucket`, the PDF's pages share it.
- [x] **6c. Fonts in deploys** (Decision 2 (a), served same-origin rather than from R2).
  - The CJK files are named for their content (`NotoSansSC-Bold.full.<sha256:12>.ttf`), and the manifest's reader requires it.
  - The service worker keeps them for good (`immutable`) and revalidates `manifest.json`. They were `bypass`, so a diagram with Japanese text would not have laid out offline.
  - `.github/actions/build-diagram-fonts` restores them from a cache keyed on `scripts/diagram-fonts/**`, or builds them with the pinned toolchain (`requirements.txt`: fonttools 4.65.0, brotli 1.2.0; actions pinned by SHA, since it runs in the signed release). `check_fonts.py` then checks every file against the manifest (size, sha256, name, every script and weight in both tiers, and each OFL.txt).
  - It runs in deploy-web, the PR previews and the release's web bundle. The release then deletes the full files: the desktop app ships the manifest, the common files and the licences (about 6 MB), and reads a full file from the site (`diagramFontUrl`; `_headers` allows it across origins).
  - **Bundle.** The PDF writer's worker and wasm are left out of the service worker's warm set (`UNWARMED_PATTERNS` in `vite.config.ts`), which every installed app downloads, and cached on the first export instead. Built and checked: neither is in `sw.js`'s `workers` or `kernels`.
  - **`LICENSING.md`.** The PDF crates (original, `MIT OR Apache-2.0`) in the crate table, and the 73 crates krilla, krilla-svg and usvg bring in on every target in the inventory: all permissive, none Apache-2.0 alone. The fonts section says where the OFL texts travel.
- [x] **Browser and files** (Chromium, `artifacts/diagram-phase6/export.mjs`, on the 50-step linked crane with an upload of mixed-script text and a Chinese instruction):
  - **The upload's text.** "Squash → 压平" in bold Helvetica was stored as two runs, Noto Sans and Noto Sans SC Bold. "Fold & unfold" in italic Times came out upright Noto Sans, with the notice.
  - **PDF at home.** 6 A4 pages, written and saved in 120–190 ms. `pdffonts`: Noto Sans Regular and Bold and Noto Sans SC Regular and Bold, each embedded once as a subset. The pages match the Pages view.
  - **Print shop.** MediaBox 640.63 × 887.24 pt, BleedBox inset 5 mm, TrimBox inset 8 mm, and crop marks at the four corners.
  - **Step files.** 51 SVGs; 51 PNGs at 600 dpi cropped (step 1 at 1,238 × 1,617 px), each drawn with its embedded fonts, Han and arrow included. The options were remembered between exports.
  - Not yet run: Preview and Acrobat, and the desktop build, whose WKWebView and CSP (`font-src 'self'`; fonts embedded as `data:` inside an `<img>`'s SVG) are listed for Zach's desktop pass.
- [x] **Review.** A workflow of four reviewers (the PDF writer, upload text, the export UI, deploys and the repo's rules), each finding put to a skeptic. All 18 findings were confirmed and fixed.
  - **PDF writer.**
    - A text made only of characters its face lacked was printed missing, with no error. HarfBuzz empties the missing-glyph box by default, usvg drops a text that draws nothing, and the glyph check never saw it; the branch meant to catch "text that could not be laid out" could never run. The subsetter now keeps the box's outline (`HB_SUBSET_FLAGS_NOTDEF_OUTLINE`, about 40 bytes a subset), the writer refuses any font without one (`PdfError::MissingGlyphOutline`), and the dead branch is gone. Crate tests use real hb-subset cuts (`tests/fixtures`), and the wasm test prints a step whose whole instruction is '𠀀'.
    - On a page with no margin the title tab and rule stopped at the trim, so a print shop's cut could show paper. They now run 10 mm past the paper's edge, as the flow band does (Pages view and PDF alike).
  - **Upload text.**
    - A run of only spaces made by the split was a `<tspan>` the second pass stripped, so the sanitizer was not idempotent (`<tspan>折る</tspan> fold`). It is now a plain text node, like every other space.
    - A `font` attribute was read, though renderers ignore it, so text grew and went bold. It is now dropped unread.
    - Text alternating scripts could add a `<tspan>` a character: 4 s and 150 MB of output for a 2 MB file, thrown away afterwards. The split now refuses past the runs a stored picture could ever hold.
    - Small caps, feature settings, size adjustment and widths were dropped without the notice. They now raise it, inherited ones too.
    - Weights 501–599 were set in Regular; a browser picks Bold above 500.
    - A tab made the loader fetch a CJK font nothing used. The loader and the setter now share one "needs no glyph" rule (`needsNoGlyph`).
  - **Export dialog.**
    - "Edit page setup" did nothing outside the Diagram or on touch: it used the automatic reveal. It now shows the Page tab as an explicit request (`showDiagramPane`), switching workspace and opening the drawer.
    - A request outlived its diagram: Undo back to none, or a project opened from the desktop's menu bar, closed the dialog but left the request, which came back on the next diagram. A request now carries its diagram's `diagramLoadId` and is closed when that diagram goes.
    - A CJK font that failed to download was reported as characters the fonts lack ("change the text"). The Notice now says the font could not be downloaded, with Try again, which reloads the fonts; a failed load at all offers it too.
    - A cropped step file too large for a PNG was thrown, and sent to Sentry with the title in its message. It is now a message naming the step, reported nowhere.
    - Russian's "one" covers 21, 31 and 101, so a list of 21 steps got the singular sentence. The one-step and several-step sentences are now separate keys, chosen by length.
    - The abort test could not fail (its writer never settled), and a step-file test named a case it did not exercise. Both now can; a mutant without the abort guard fails.
  - **Deploys.**
    - fontTools stamps the build time into every font, so each rebuild renamed all 16 files. The build pins it (`SOURCE_DATE_EPOCH`), `check_fonts.py` checks the stamp, and two builds were compared byte for byte. The CI build also needed skia-pathops (overlap removal), now pinned.
    - Installed desktop apps read full files by their build's names. Names now change only with the sources, the toolchain or a charset; the production deploy warns when a build would drop a full file the site serves (`--warn-renames-against`), RELEASE.md says to ship a desktop release after such a change, and a font answered with the site's HTML page fails as a download rather than a checksum.
    - The inventory missed fontconfig-parser and roxmltree 0.20, which fontdb uses on Linux; the regeneration command now covers every target.
  - Browser (Chromium, `artifacts/diagram-phase6/review-fixes.mjs`): Edit page setup from Edit switched to the Diagram with the Page tab forward; with the font files blocked the Notice offered Try again and refused the PDF, and after unblocking Try again cleared it; a margin-less print-shop PDF's tab runs from the trim to the bleed edge.

### Phase 7: annotate

- [x] **7a.** New shared primitives, as their own series with References goldens:
  - the one-way valley and mountain arrows;
  - push (straight, hollow, cleft-tailed);
  - rotate (fraction and sense);
  - turn-over with an axis;
  - the `diagram-hidden` line role (package, painter, validator).
  - **As built.**
    - `StepDiagramPrimitive` gains `one-way-arrow` (`out`, `fold: valley | mountain`), `push-arrow` (`from`, `to`) and `rotate` (`at`, `amount`, `direction`), and `turn-over` an optional `axis`. Their geometry is in `stepDiagramGeometry.ts` (`oneWayArrow`, `halfArrowheadPath`, `pushArrowOutline`, `rotateGlyph`), their sizes in ink in `diagramInk.ts` (`DIAGRAM_PUSH_INK`, `DIAGRAM_ROTATE_INK`), and `diagramShapes` draws them on screen and in files, through the paper and ground clip pair as the fold arrow is.
    - A valley's head is the fold arrow's filled head on the shaft's end, which stops at its notch. A mountain's is one barb, outlined, on the outside of the curve, 1.8 times as wide as a filled head's barb: at a filled head's width the outline read as a sliver.
    - A push arrow is hollow: the paper's face inside, the arrow's pen round it, solid, and it shrinks whole when it is shorter than its head and cleft.
    - The rotate glyph is two 140° arrows going the way the model turns, clockwise on the page whatever the paper's handedness, with "1/8", "1/4" or "1/2" inside. A horizontal turn-over is the glyph a quarter turn round.
    - `diagram-hidden` is the edge's pen, dotted (`[1, 2]`, butt): the style has no pen of its own for one. It is in the package's `PaperLineRole`, the painter's roles and `penForRole`, the scene validator, and the folded-figure ink key.
    - The stored-model reader (`stepDiagramModelFile.ts`) reads the new kinds, counts them under the arrow cap, and reads an enumerated value it does not know (a third axis, a third of a turn) as a newer build's, as it does an unknown style.
    - Goldens: `referencesExportTarget.test.ts` paints every new glyph front and back through the export dialog's own path (`__fixtures__/referencesGlyphsGolden.json`), checked by eye before it was frozen; the existing goldens are unchanged.
- [x] **7b.** The `ui/ToolRail` extraction from `CpToolRail`. Its own series; the Edit rail's computed styles match before and after.
  - **As built.** `components/ui/ToolRail` takes groups of `{ id, label, railLabel, collapsedByDefault?, content }`, where `content` is tool descriptors (label, tooltip, glyph, active, available, onSelect) or one control across the grid (the line types' segmented control), plus an optional header row and an optional storage key for the groups' open state. `CpToolRail` composes it from the CP catalog and keeps what is the CP's: the glyphs, the tooltip text, the line-type control and the Shift latch as the header.
  - `CpToolRail.module.css` moved whole to `ToolRail.module.css`. Two rules changed shape and not effect: a control group is `[data-control]` rather than `[data-group='line-type']`, and the two-row grid is keyed on the rail having a header (`[data-header]`) rather than on a coarse pointer, which is the condition it stood for. The unused `data-ui-status` attribute went.
  - **Proof.** `artifacts/diagram-phase7/rail-styles.mjs` dumps every computed property of every element in the Edit rail, in Chromium at 1440 and 700 wide under a fine pointer and at 1180 and 700 under touch, plus a hovered tool and group toggle: before and after are identical (238 and 245 elements, zero differences), with the after run confirmed on the new module's classes.
- [x] **7c.** ~~The `createGestureBracket` option to ignore CP `'document-replaced'`.~~ **Not needed (deviation).** The gesture bracket brackets the CP overlay layers' writes, and the Diagram does not use it. An Annotate drag previews in the canvas and commits once on release, which is one undo entry and leaves nothing to abort on Escape; a label's text extends its newest entry through the slice's edit session, as an instruction does.
- [x] **7d.** Annotate.
  - `annotationModel.ts`, `annotationPrimitives.ts` (compiled at the target scale; M/V/hidden as lines) and `annotationHit.ts`.
  - `DiagramAnnotateCanvas`:
    - draw on drag past the threshold;
    - labels by click, focusing the Step pane's label field;
    - endpoint handles;
    - Flip arc;
    - one undo entry per drag.
  - `DiagramAnnotationList` in the Step pane, with the "picture changed" notice.
  - Tool keys in the scope; the Escape ladder's rungs; Delete through `edit.delete`.
  - Annotations ghosted in Pose and composed into cards, pages and files.
  - The Annotate segment shown.
  - **As built.**
    - **Model and file.** `KnownDiagramAnnotation` is D8's shape, in picture units; `bend` is the arc's sagitta as a share of its chord, positive to the left of travel as the page shows it, ±`1 − cos 30°` for References' 60° arc. The reader (`diagramFile.ts`) drops what does not read — a wrong type, a zero bend, a second annotation with an id already read — and carries verbatim, as a newer build's, a kind, a field, an enumerated value or a well-formed value past this build's ranges (a bend over 0.5, a point more than four frames out, a label over 80 characters). A step keeps at most 500. A sign or a label is put where `from` is, whatever `to` says.
    - **Frames.** Every painted picture reports its frame (`PaintedPicture.frame`): an upload's posed box, a scene's bounds, a fixed picture whole, a References step's sheet (`stepDiagramSheetBox`); a page cell finds the same box (`DrawnPicture.framePt`). `pictures/pictureFrame.ts` gives the frame in picture units without painting, for the carry, and holds the one parsed-scene cache (`storedScene`), which `pagePictures` now shares.
    - **Carry (`annotationCarry.ts`).** `withCarriedAnnotations(before, after, assets)` runs at the end of `setUploadPose`, `setReferencesSide` and `setLinkedPicture`. It carries an upload's re-pose exactly (asset coordinates through both poses), a References step's turn-over as a mirror about its sheet, and a linked picture's turn — crease pattern, or flat with the same side and layer order, the same scope and fingerprint, both pictures scenes — as a rotation about the scene's origin, where both captures turn their pattern. A mirror turns a bend and a rotation's sense over; an odd number of quarter turns turns a turn-over's axis. Anything else, or a step carrying an annotation this build cannot read, leaves them where they were, out of step with the picture.
    - **Drawing (`annotationPrimitives.tsx`, `paintAnnotations.ts`).** Compiled per paint in CSS px with the frame's top-left at the origin, through References' own projector, ink and pens (`STEP_DIAGRAM_LINE_WIDTH`, the style's arrow pen through the References policy), in a y-up primitive space as References' unit frame is, so every arc and head is References' code path. Marks have one ink on and off the paper (no clip pair). A card draws them as if the frame were the size every picture opens at (`CARD_FRAME_PX`, 50 mm); a page and a step file at the size the frame prints. A label is a `<text>` of runs in the upload-text format (`labelRuns`), so a page sets and counts it with `setUploadText`, its Han in the diagram's style; the rotate glyph's fraction is set in Noto Sans Bold the same way. A step file is cropped to reach an arrow that starts off the picture (`annotationReach`).
    - **Surfaces.** Cards and the detail show `annotatedStepUrl` (the picture with its annotations, cached by the picture and the annotations' list); Pose ghosts them at 30%. The Annotate canvas (`useAnnotateCanvas`) shows the picture alone, its frame 1000 world px with a quarter-frame margin, the annotations live over it as React (`DiagramAnnotationLayer`, the painter's pens), a drag previewed and committed once on release; Space, the middle button or two fingers pan (one finger's `touchstart` is kept from the camera natively; `panning.excluded` is not used, since it also blocks the middle button and the pinch — and the library matches each entry as a tag or a class, so an attribute selector throws). A press reaches 8 px (18 on touch) and takes the keyboard.
    - **Store.** `diagramAnnotateTool`, `diagramSelectedAnnotationId` (scoped, never history), `editDiagramAnnotations` (one undo entry, or a label field's session extending it; the slice's text session generalised to a keyed one), `keepDiagramAnnotations`. The selected annotation goes with its step, the detail, or an undo that removes it.
    - **Keys.** The tool letters and F are in the `diagram` scope and decline outside Annotate; a letter pressed again puts its tool down. The registry test's diagram rule now leaves `crease-pattern` out (the diagram scope never stacks with it), and the shadowing test that used M moved to G, which only the crease pattern holds. Escape's rungs: drop the drag (`registerDiagramGestureCancel`), deselect, put the tool down, then the detail's. Delete in Annotate deletes the selected annotation and never the step (`hasDeletableDiagramSelection` follows).
    - **Step pane.** `DiagramStepAnnotations`: out of Annotate, a count and an Annotate button; in Annotate, its section leads — the tool's name and help, the "picture changed" notice with **Keep Them Here**, a notice for annotations a newer build made, the list, and the selected annotation's controls (a label's text as a single-line `TextAreaRow` with a session per sitting, Flip arc, a rotation's turn and sense, a turn-over's axis, Delete). `TextAreaRow` gained `singleLine` and `fieldRef`. A label just put down asks for its field through `labelFocus.ts`.
    - **Detail.** A `SegmentedControl` Pose | Annotate in the top bar; Annotate is disabled without a picture, and on a phone shows "Annotate on a larger screen". The rail is `ToolRail` (`DiagramAnnotateRail`) in Edit's rail column widths.
  - **Deviations.**
    - The cards have no hover verbs (as built since Phase 2), so Annotate is a step verb (`'annotate'` in `diagramActions.ts`): the card's context menu and the Step pane's button.
    - In Annotate the Step pane leads with Annotate's section but keeps the Picture and Instruction sections under it, rather than replacing the summary.
    - Added: **Keep Them Here** on the "picture changed" notice, so annotations that are right as they stand need not be touched to say so; a rotation's and a turn-over's own controls; a new label reads "A", selected in its field to type over.
- [x] **7e.** Analytics: `diagram annotation added` with `{tool}`, from the canvas when an annotation lands (`trackDiagramAnnotationAdded`), with its `docs/analytics.md` row.
- [x] **Browser** (Chromium; probes in `artifacts/diagram-phase7/`):
  - every tool, light and dark (`annotate.mjs`, `surfaces.mjs`): drawn with the keys and the mouse, a label typed in the Step pane after its click took the focus there;
  - undo and redo of draw, move, flip, delete and label edit, through Cmd+Z and Delete;
  - annotations survive a rotate (`rotate.mjs`): an upload turned right and flipped from the detail's toolbar, the arrow staying on its mark and the label upright, then both undone;
  - export to PDF (`export.mjs`): the annotations print, a label in Japanese embeds Noto Sans JP and the fraction Noto Sans Bold;
  - the arrows match References': the same pen and scale on one page (`pagePictures.test.ts`), and the glyphs' goldens (7a).

- [x] **Review.** A workflow of six reviewers (geometry and painting, carry-over, store and undo, the canvas, keys and i18n, the file), each finding put to a skeptic. 35 of 36 were confirmed, overlapping into 24 defects; all fixed, each with a test, the painting ones also rendered before and after. 1 refuted (a sign's or label's `to` read as its `from`: the documented contract).
  - **Writing what the reader reads.**
    - Nothing kept points within the reader's reach (±4 frames): a drag past it, or a mirror of a point far out, saved an annotation that reopened as a newer build's — hidden, uneditable, blocking poses. The model now keeps every point within reach (`withinReach`; a body move stops whole, keeping its shape), carries clamp too, and `editStepAnnotations` writes every annotation through `cleanAnnotation`.
    - A label's text skipped `xmlText`, so one pasted control character broke the card, the page and the PDF; it is now cleaned, on one line, at most 80 characters, wherever it is edited from.
    - Pressing the value a control already shows recorded an undo step and dismissed the "picture changed" notice. Edits are now compared field for field.
    - The 500-annotation cap was only a reader's truncation that the next save made permanent. An edit past it is refused, and a file with more opens that step locked and carries it whole.
    - A `rotate` with a field this build has no name for and no `amount` was dropped as malformed; an unknown field is now news before a missing one is damage, as at the top level.
    - `withReferencedAssets` did not look in a newer build's annotations (or assets) for asset ids, so one naming an asset lost it on the next edit.
  - **One question for "annotating".** Walking in Annotate onto a step with no picture, removing its picture, or an undo that took it away left the detail showing Pose while the keys, Delete, Escape and the Step pane acted on Annotate (Delete dead, a hidden tool put down first). `isDiagramAnnotating` — Annotate on a step that can be annotated (`stepCanBeAnnotated`) — is now the one predicate every one of them asks, and Annotate stays the detail's mode for the next pictured step. Delete's menu hint says "Delete the selected annotation" / "Select an annotation first" in Annotate (`diagramDeleteTarget`), and a locked step's Annotate segment gives the locked reason.
  - **Carry.**
    - Annotations already out of step were moved anyway, keeping their old key, so a later change back to that picture's key called them in step where they no longer fit. Only annotations in step are carried now; others stay where they are.
    - A turn-over's axis was decided per move by rounding, so six 15° presses never turned it and Reset did. It now follows the poses' own quarter turns (`PictureMove.quarterTurns`).
    - The linked carry rested on both captures turning about the scene origin with no test using a real capture. `captureCarry.test.ts` now carries annotations through real crease-pattern and flat captures of an off-centre scope — every 15° press, Reset, the 345° → 0° wrap — and pins that another side or layer order is not carried.
    - **Deviation from D8:** a linked picture kept as a bitmap (over the scene budget) or a fixed no-layer-order picture records no scene frame, so a turn of it does not carry its annotations; they stay, out of step, with the notice. Pinned by a test.
  - **Painting.**
    - Cards and Pose clipped any mark past the picture (an `<img>` cannot paint outside its box) while pages drew it whole: the card's document now grows round the picture to the marks' reach.
    - The reach missed a fold-and-unfold arrow's return, which bulges past the outgoing arc, so a cropped step file cut it on a long arrow; it now counts the return stroke.
    - A push was filled with the style's paper face — yellow under the Default preset, over a photo or off the picture — and is now the page's white.
    - Page cells gave annotations no room: marks past the picture printed over the step's text or into the next cell. A fitted picture now shrinks until it and its marks fit its box (a secant on its size, since marks keep their pt size), and the two together are centred; a picture at the shared scale keeps it, and the layout widens its extent by its marks' reach (laid out twice when any step is annotated, as for References' letters).
  - **The canvas.**
    - A press never took the keyboard (it is `preventDefault`ed), so Space did not pan, letters went into whatever field had focus, and Delete edited text. A press now focuses the canvas, as Edit's does.
    - Excluding the overlay from the camera's panning also stopped the middle button and two-finger pinch. The exclusion is gone; one finger's `touchstart` is kept from the camera natively, so two fingers pinch and pan.
    - A second pointer replaced the stroke in hand, so a pinch with a tool committed a stray annotation. Presses are tracked by pointer; a second one drops the stroke and the rest belongs to the pinch until every finger lifts.
    - Any edit to the step during a drag cancelled it (the layout was rebuilt from the step), and the move then applied the press's copy over edits that landed. The picture is now made from the step's picture inputs alone, and a move applies to the annotation as it is when it lands.
    - On a read-only diagram the canvas ignored every press while the list selected; it now selects, and draws no handles to drag.
    - A finger's 5–9 px drift turned a tap into a move; the slop is 10 px for touch.
    - A fold-and-unfold arrow's head and return, and a push's outline, were not where a press took them; the hit test now measures the drawn ink (`HitSizes.ink`).
    - A CJK label's ends could not be pressed: one width estimate (`labelHalfWidth`, an em for a wide character) serves the hit test, the selection ring and the crop.
    - A label's request for its field outlived the label's selection and later stole the focus; it is dropped when another annotation is selected or Annotate closes.
    - The analytics mapping was a cast; it is an exhaustive map, and the canvas's commit path — draw, click, pinch, cancel, move, an edit landing mid-drag, a finger's drift, read-only, focus — is tested (`DiagramAnnotateCanvas.test.tsx`; three mutants each fail one test).
  - **i18n.** The French and Russian tool names now use each locale's own mountain and valley terms.
  - Browser (Chromium, `artifacts/diagram-phase7/canvas-fixes.mjs`): a press moved focus to the canvas; a press on a fold-and-unfold arrow's head selected it; the middle button and Space panned, Space drawing nothing; a two-finger pinch zoomed with the Valley Line tool in hand and drew nothing; one finger drew. `annotate.mjs` replays unchanged.

### After Phase 7: Zach's design pass (2026-10-03)

- [x] **Crease-pattern steps draw as instructions.** On a page a crease pattern is the step's instruction, so it is drawn as References draws one: mountains and valleys in the diagram-crease pens (dash-dot and dashed, 0.75 pt in the Diagram style), aux lines in the aux pen as the creases already in the paper, the border in the edge pen. They were in the fold pens, which the Diagram style draws as the aux pen's 0.25 pt solid ink, so a mountain, a valley and an aux line looked alike.
  - The roles are the capture's (`creasePatternScene`): the scene's producer says which pen a line takes (`penForRole`). A step captured before this keeps its fold pens until it is refreshed; the branch is unreleased, so no file in the wild has one.
  - A crease pattern's aux lines are drawn whatever the style's aux switch says, as References draws the creases earlier steps made; a folded model's stay the switch's. One helper, `diagramScenePaintStyle`, for the card, the page cell and the over-budget raster. `StepPictureSource`'s scene now says `pattern` rather than `measure`, which follows from it (`sceneMeasure`).
  - Before/after: `artifacts/diagram-cp-pens/cards-before-after.png` (crane steps 3 and 5, both re-captured, so the same pattern on both sides).
  - Where several folds meet at a vertex each one's dash starts there, which reads as a small knot at the centre of a star of creases. Printed diagrams do the same; left as it is.
- [x] **The trailing Add step tile.** The mockup's dashed card after the last step is back: a press adds an empty step at the end, whichever step is selected (`appendDiagramStep`), selects it, and the new card takes focus. A listbox holds only its options, so the tile is for a pointer alone — `aria-hidden`, never focused — and the header's Add step stays the way there from the keyboard and for assistive tech. Not on a read-only diagram. Browser (`artifacts/diagram-add-tile/tile.mjs`, light and dark): with step 2 of 3 selected, a press made step 4 and focused its card; the tile stretches to its row's height.

- **Design parity** (Zach, 2026-10-03: "continue with all the recommended fixes"). The design-vs-built inventory (`artifacts/diagram-inventory/design-vs-built.md`, every element of the prototype classified and put to a second reviewer) found seven gaps no phase schedules, some smaller ones, two unrecorded changes worth undoing, and three defects. All of them:
  - [x] **Adjust pose without hover.** An `adjust-pose` step verb in the catalog, so the context menu and the Step pane's Picture section have it (the pane hides it while the step is open), beside Annotate. The card's two buttons from the mockup, Adjust pose and Annotate, over the picture's top corner: shown on hover, focus or selection and always under a finger, `aria-hidden` and out of the tab order like the card's other shortcuts. The card's status chip moved to the picture's foot to make room. `diagram step opened` gains `via: card|command` and `mode`.
  - [x] **Select in hand**, as the mockup has it: a step opened from the list, a label once placed, and a list row pressed each put Select back; switching Pose and Annotate and walking the steps keep the tool.
  - [x] **The detail's empty body** offers the three ways to a picture (Upload, Link pattern, From References), and **Go to Edit** stands in for the two that need a pattern when none is open — there, on the card and in the empty diagram (D12's promise). Go to Edit is `view.edit` through the menu chokepoint, so it is counted as every workspace switch is. Browser (`artifacts/diagram-parity/empty-sources.mjs`): with the crane open the three sat in a row and Link Pattern… opened the picker; on a fresh `/diagram`, Go to Edit was in the empty state and the detail, and took the page to `/edit`.
  - [x] **A 3D step in Pose**: the yaw/pitch readout (the shared `ViewportStatusReadout`, following the drag), the "Drag to turn · Double-click to reset" hint (a mouse's only, in the corner the view cube leaves), and its annotations ghosted over the live view while it shows the camera they were drawn on. The Step pane's **View** row for a 3D step.
    - The ghost needs the capture's frame on the live canvas. Both are one camera into boxes of different sizes, so `folded3dCaptureFrame` is one scale about the centres; its test projects model points through the real camera code both ways and finds them within a hundredth of a px. A turn hides the ghost (the annotations belong to that picture, and a turn makes a new one); undo brings both back.
    - Browser (`artifacts/diagram-parity/pose3d.mjs`, box_90 in 3D): four lines along the frame's edges hugged the live model's silhouette; mid-drag the ghost was gone and the readout followed; after the turn the annotations were out of step; undo showed the ghost again.
  - [ ] **The Step pane in Pose** for linked and References steps (D13): the same verbs as the floating toolbar, and D5's **angle field** for a crease pattern's and a flat fold's turn.
  - [ ] **The header**: Steps | Pages centred, as in the mockup.
  - [ ] **Export**: the filename in the footer, the step files' notes, Edit page setup switching to Pages, and the page setup summary line.
  - [ ] **Defects**: the Page pane at its default 280 px width (Portrait and Landscape cut, Margin's + past the edge), and the Pages view's "Text doesn't fit" chip over the instruction.

### Phase 8: a linked pattern, shown three ways (D19)

*(Rewritten 2026-10-03: Phase 8 was "simulated steps", Pose-only. D19 makes
how a linked step is shown a first-class choice, of which Simulated is the
third. Proposed; waiting on Zach's go-ahead.)*

- [ ] **8a. Show as, for the two ways that exist.**
  - `remembered` on `DiagramCpSource`: written, read, validated, and carried by
    every edit that changes `render` (`setLinkedPicture`, Pose's verbs). A
    `showLinkedStepAs(stepId, way, via)` action in the capture layer: take the
    remembered pose for `way` (or its default), capture headless, commit as
    one undo step.
  - The Step pane's **Show as** row; the pattern picker's **Show as** header;
    the card's **Show as ▸** and **Duplicate as ▸** in the context menu (from
    the action catalog, so the menu bar and the shortcut registry see them);
    Pose's switch through the same action.
  - The card's hover verbs **Adjust pose** and **Annotate**.
  - Tests: the remembered pose round-trips and survives a relink; switching
    and switching back restores the pose; one undo step per switch; a figure
    step's Simulated is disabled with its reason.
- [ ] **8b. Simulated in Pose.** `useDiagramSimulatedCapture`:
  - `useSimulatorRuntime` over `buildSegmentSimulationFold(foldArtifacts,
    segment)`, the region matched through `cpModelToFoldTransform`; refused
    for an empty `faces_vertices` with `addOristudioCpInlineSimulation`'s
    "unavailable" copy, and at the cap with its "too many simulations" copy.
  - Settle to the remembered fold %; `setCamera` with the remembered view;
    Done → `beginExport()` → `scene({style: diagramStyle, markHidden: true})`
    → a stored scene, `styleKey = simulatorSceneStyleKey(style)`,
    `paperScale: null`. The session is released on every exit (D4's list).
  - The transport: `Toolbar` with Restart, Play/Pause, Step and a
    `GestureSlider` for fold %, over `FoldPlayhead`; Top / Front / Iso chips
    and the yaw/pitch readout. The simulator scope's keys while it is shown.
  - Escape and Revert return the step to the way it was shown before.
- [ ] **8c. Simulated everywhere else.**
  - Link status, the badge ("Simulated 40%"), the Step pane's row.
  - Refresh opens Pose and captures once still; Refresh all skips simulated
    steps and its toast counts them; "Lighting changed — Pose again" from
    `lighting.ts` comparing per kind.
  - Pages fit a simulated step on a "One scale" page; Export paints its stored
    scene like any other.
  - Worker residency sized for Pose's window, with a test that 20 inline
    simulations, Simulate's view and Pose evict nobody.
- [ ] **8d.** Analytics (`diagram step shown as`, `kind: simulated`), i18n in
  all eight locales, `docs/analytics.md` rows.
- [ ] **Browser:**
  - link a crane region as Folded straight from the picker; Show as Crease
    pattern and back, the turn-over kept;
  - Simulated at 40% and 100% in iso: captured, reloaded, refreshed, exported;
  - Duplicate as Folded after a crease-pattern step;
  - the no-WebGL2 CPU fallback; keys in Pose with the simulator shown.
- [ ] **Review** (the Phase 7 workflow: every finding put to a skeptic), and
  its fixes committed.

### Phase 9: phone, touch and finish

- [ ] Phone list and detail through `usePhoneListDetail`.
  - Pages is a read-only pager.
  - Annotate shows its "larger screen" note.
- [ ] iPad: annotate with pointer and pencil, and the drawer inspector.
- [ ] Sync with `main`, re-take the ratchet numbers, run the full validation set, then open the one PR to `main`; a CHANGELOG entry; one line in the README's feature list.

### Later (written up, not built)

- 2-D drag reorder and multi-select.
- A per-step zoom ("enlarge from here").
- Multi-cell steps, a front-matter block, and a first step number for diagrams
  split across files.
- Repeat and zoom symbols.
- Multiple diagrams per project.
- A web Content-Security-Policy mirroring Tauri's `script-src`.
