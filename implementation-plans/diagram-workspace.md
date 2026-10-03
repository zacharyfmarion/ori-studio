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
  Simulated (Simulated from Phase 8), for any pattern source.
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
  - `diagram exported` with `{format: pdf|zip, preset: home|print_shop, file_type, dpi, bleed, crop, number, text, uniform, page_count_bucket, step_count_bucket, empty_step_bucket}`;
  - `references step sent to diagram` with `{scope: one|all, mode: sequence|find}`.

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
- for PDF: the page setup summary and **Edit page setup**, then At home | Print
  shop, and for print shop the bleed and crop toggles;
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
    - The mockup's trailing "Add step" tile was left out: a button cannot sit inside a listbox. The header and the empty state carry Add step.
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
  - **Correction from the code map:** D5's "Crease pattern" row names `buildCreaseExportArtwork`, which yields SVG fragments, not a `PaperScene`. A crease-pattern step is instead built straight from the kernel's lines into a scene: the segment's paper as one face, and its lines with fold, edge and aux roles. The diagram style's fold pens are the crease-pattern pens.
  - **Correction from the code map:** the session ender's *phases* are `'session'` and `'bracket'`. `'history'` and `'document-replaced'` are the *reasons* a session is ended. The capture session registers as `'session'` and acts on the reason.
- [ ] **3b.** Capture and status.
  - `captureFolded.ts`: crease-pattern, flat and 3D captures through the session runtime, with:
    - the capture model at `rotation 0, scale 1`;
    - `outcome`;
    - `fixed` pictures, sanitized at capture and on load;
    - paper scale;
    - the scene budget and raster fallback.
  - `useDiagramCaptureSession.ts`:
    - retain and release;
    - epoch and engine-lost handling;
    - `withFoldInFlight` kinds;
    - the exit table from D4, with Revert and undo during Pose.
  - `linkStatus.ts` with D3's precedence.
  - The step's `revision` check on commit.
  - Test: open a `.cp` file, link a step without editing anything, and it reads `current`.
- [ ] **3c.** The Picture section and linking.
  - The pattern picker over the kernel-space `SheetGrid`.
  - **Link pattern…** from the empty card and header: pick → capture as a crease pattern, then Pose to fold.
  - Refresh, Relink, Remove picture.
  - Card badges, status chips, progress with Stop.
  - Optionally, **its own series first**: move `sheet-grid` / `sheet-card` into `SheetGrid.module.css` with a `columns` prop. It is a shared block, so the References and Simulate overrides become the prop.
- [ ] **3d.** Pose for folded steps inside the step detail.
  - The Crease pattern | Folded form switch (D5).
  - Flat: turn over through `setModel`, rotate, Next solution through `foldAnother`.
  - 3D: `useFolded3dMeshRuntime` + `SimulatorViewport` with presets and the CPU fallback, captured through `folded3dFigureScene` with the diagram style and its `styleKey`.
- [ ] **3e.** Entry points and queues.
  - **Add to diagram** on `CpSelectionToolbar` (one pattern) and in `foldedFigureActions.ts`.
    - It records the figure's provenance and pose: side, foldCase, `rotationDeg` (the figure model's rotation) and the 3D camera.
    - It builds the picture through the capture primitives, never by copying Edit's pictures or mutating Edit's figure.
    - A live 3D figure goes through `folded3dFigureScene(figure, render, {style: diagramStyle})`, recording the `styleKey`.
    - For a live flat figure, its handle's paper scene is read, and the model's rotation and scale are removed through `foldedFlatPaperScene`'s `toScenePx` affine.
    - A figure with no live handle or render model, flat **or 3D**, is added with provenance and opens nothing. Diagram shows "Pose to capture".
  - The `oristudioCpRegionFocusRequest` for **Open in Edit** (latched, consumed on CP panel mount, framed through `cpCamera()`).
  - **Refresh all** (`captureQueue.ts`).
- [ ] **3f.** Analytics: `diagram picture captured` and `diagram step added` (`crease_pattern`, `cp_folded`, `cp_3d`).
- [ ] **Browser** (CP wasm rebuilt first):
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

### Phase 4: References steps

- [ ] **4a.** The verbs: `references.sendToDiagram` and `sendAllToDiagram` in the registry, catalog, executor and context menu, through `useReferencesSendToDiagram.ts`.
  - Capture from filmstrip rows only; skip `done`; handle `StepDiagramAdapterError`.
  - Per-sheet provenance.
- [ ] **4b.** Painting at the target scale (D6) plus `validateStepDiagramModel`. Golden: marks keep their pt size at two cell sizes.
- [ ] **4c.** The References pose (turn over toggles `mirrored`), the staleness copy, and **Open in References** (`openReferencesWorkspace({sheetBoundary})`).
- [ ] **4d.** **From References…** in Diagram (the latched `diagramReferencesTargetRequest`). The sentence becomes the default instruction.
- [ ] **4e.** Analytics: `references step sent to diagram`, and `diagram step added` (`references`).
- [ ] **Browser:**
  - send one step, then a whole sequence;
  - a Find candidate;
  - a turn-over card and a mirrored back-side card;
  - the M/V direction matches References;
  - edit another sheet: no false "Pattern changed".

### Phase 5: pages

- [ ] **5a.** `lib/paper/textWrap.ts` moved, with code-point iteration and CJK breaking. Its own series; CP export goldens green.
- [ ] **5b.** Pure page modules, with property tests (every step on exactly one cell, no text below its cell) and goldens:
  - `printPaper.ts`, `diagramPageLayout.ts` (including `breakBefore`, scale policy and overflow);
  - `composeDiagramPage.ts` (the empty step, overlay-only guides, the embedded font per Decision 2, unique ids across cells);
  - the bundled font module (`diagramFont.ts`).
- [ ] **5c.** The Pages UI.
  - The Steps | Pages tabs; `DiagramPagesView` with its overlay, captions and zoom.
  - The `diagram-page` side pane, its reveal rules and `DiagramPagePanel`.
  - `ui/OptionCard`; `DiagramStyleControl`.
  - The style-change chips: 3D steps show "Lighting changed — Refresh", and simulated steps show "Pose again" (D5).
  - "Start a new page here".
- [ ] **Browser:**
  - every paper size and orientation;
  - grid and flow, with and without the path;
  - paper vs fit scale, with the crane model visibly shrinking;
  - a 30-step diagram;
  - CJK and long English text wrap inside their cells;
  - overflow is flagged;
  - a style change repaints a 50-step diagram without a long task over 200 ms, and 3D steps show Lighting changed.

### Phase 6: export

- [ ] **6a.** Step files, the dialog and the menu.
  - `stepFiles.ts`: the shared scale in a fixed box, crop, number and text; PNG through `paperSvgToPng` with limits.
  - `DiagramExportModal` + `DiagramExportOptions`: preview, pager, Notice, remembered options, progress, abort and toast.
  - `file.exportDiagram`: the menu action, capability, File › Export row and header button.
  - Analytics: `diagram exported`, and `'pdf'` added to `ExportFormat`.
- [ ] **6b.** The PDF writer, per Decision 1.
  - A guarded lazy load.
  - Page boxes, bleed, slug and crop marks.
  - The allowed-API test (A).
  - `scripts/diagram-pdf-check.mjs` (playwright library), as a CI step.
  - Bundle stubs and the service-worker exclusion (A), or the crate and its CI step (C).
  - `LICENSING.md`.
  - The non-Latin rule per Decision 2.
- [ ] **6c.** (Only if Decision 2 (a).) The per-script font subsets on R2: publish script, registry with sha256, cache and offline behaviour.
- [ ] **Browser and files:**
  - PDF at home and print shop, checked with the CLI tools and opened in Preview and Acrobat;
  - a ZIP of SVG and of PNG at 600 dpi;
  - the same exports on the desktop build.

### Phase 7: annotate

- [ ] **7a.** New shared primitives, as their own series with References goldens:
  - the one-way valley and mountain arrows;
  - push (straight, hollow, cleft-tailed);
  - rotate (fraction and sense);
  - turn-over with an axis;
  - the `diagram-hidden` line role (package, painter, validator).
- [ ] **7b.** The `ui/ToolRail` extraction from `CpToolRail`. Its own series; the Edit rail's computed styles match before and after.
- [ ] **7c.** The `createGestureBracket` option to ignore CP `'document-replaced'`. Its own commit.
- [ ] **7d.** Annotate.
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
- [ ] **7e.** Analytics: `diagram annotation added`.
- [ ] **Browser:**
  - every tool, light and dark;
  - undo and redo of draw, move, flip, delete and label edit;
  - annotations survive a rotate;
  - export to PDF;
  - the arrows match References'.

### Phase 8: simulated steps

- [ ] **8a.** `useDiagramSimulatedCapture`.
  - Pose's Simulated mode drives `useSimulatorRuntime` with `buildSegmentSimulationFold(foldArtifacts, segment)`, the region matched through `cpModelToFoldTransform`.
  - `setCamera` with the stored view; Done goes `beginExport()` → `snapshot.scene({style: diagramStyle, markHidden: true})` → frozen scene.
  - The session is released on every exit.
  - Disabled at the inline-simulation cap, and when `buildSegmentSimulationFold` returns an empty `faces_vertices` (the "unavailable" copy `addOristudioCpInlineSimulation` uses).
- [ ] **8b.** The transport (`Toolbar`, `GestureSlider`, `FoldPlayhead`).
  - The `simulator` scope owns Space and the arrows while it is shown.
  - Refresh opens Pose and settles again from flat.
  - Figure-sourced steps cannot be simulated.
- [ ] **8c.** Analytics: `kind simulated`.
- [ ] **Browser:**
  - crane states at 40% and 100% in iso, captured, reloaded and exported;
  - the no-WebGL2 CPU fallback;
  - a test that the worker never exceeds `MAX_LIVE_SESSIONS`.

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
