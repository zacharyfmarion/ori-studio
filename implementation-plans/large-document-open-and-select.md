# Large Documents: Fast Open and Selection

## Goal

Opening a very large `.osf` and selecting one crease pattern in it should be
as fast as the data allows. The reference file is `bodo_large.osf`: 455 MB,
one Edit canvas holding **489,093 creases** in **204 separate sheets** (a
15 × 14 grid of 400-unit squares), plus a 204-step diagram. It is not
committed (user corpus); see Verification for a synthetic stand-in.

Targets, against today's numbers below:

- **Open:** no main-thread task longer than the unavoidable JSON parse, and
  about 3 s from drop to an interactive canvas on the web build (today 31–33 s,
  with a single 26–28 s freeze).
- **Select a sheet:** the selection highlights within a frame or two, and the
  selection toolbar appears without ever blocking the main thread (today
  94 s the first time and 52 s every time after, as single freezes).

Scope is `main` only. The file was written by the diagram-import PR, but
everything measured here is code on `main`: none of the costs below come from
that PR, and nothing in this plan depends on it. Two things that *do* come
from it are noted where they matter: the import leaves T-junctions in the
sheets it lays out, and `main` carries the diagram's steps as a newer build's
data, which costs it a thumbnail scan on open.

## What was measured

`main` at `909c8bf9b`, production build (`PROFILE=1 vite build`, so frames
are readable), headless Chromium 148 on an M1 Max with hardware WebGL, the
real drop path (`openProject`), timed with temporary `performance.mark`s that
were never committed. Traced runs (V8 sampling profiler) were used only for
attribution; the times below are untraced. Kernel numbers are native Rust
on the same document (`CpSession`, release build).

### Open — 31.5 s / 33.4 s (two runs), one 26–28 s freeze

| Phase (ms after drop) | run 2 | run 3 |
| --- | ---: | ---: |
| `File.text()` | 274 | 267 |
| `JSON.parse` + validate (`parseNativeProjectFile`) | +805 | +802 |
| `readDiagram` | +1,774 | +1,783 |
| Kernel restore: structured clone → wasm → geometry → main-thread decode | +2,186 | +2,129 |
| `CheckCamv` + a second snapshot | +220 | +217 |
| **`parseImportedCreasePatternFromFold`** | **+27,664** | **+25,795** |
| Install + first render | +468 | +465 |
| **Total** | **33,392** | **31,486** |

Where the analysis step goes, from a traced run (26.7 s there):
`inferTopology` 23.6 s — of which `splitSegments` 20.8 s, and of that ~13 s
is one `Array.sort` with `localeCompare(…, { numeric: true })` over ~590k
string edge keys — then `collectIntersectionCuts` 3.7 s, `buildPlanarFaces`
2.7 s, and `prepareSimulationFold` (the simulation mesh) 2.9 s.

The JS heap is ~2.5 GB right after open (before GC). That matters most on
desktop: WKWebView has already failed with memory exhaustion opening a 47 MB
`.osf` (`perf_harder.osf`), so this file is likely to crash there outright —
not measured here, but it puts the memory items (1.1, 1.4, 3.2, 4.1) ahead of
pure speed for desktop users.

### Selecting one sheet — 94 s, then 52 s every time

Box Select around one whole sheet (2,699 creases), then a second sheet:

| Phase (ms after mouse-up) | first | second |
| --- | ---: | ---: |
| Kernel `CreaseSelect` + new snapshot decoded on main | 154 | 151 |
| React re-render of the new snapshot | ~370 | (inside the next row) |
| Kernel FOLD export, in the worker (main thread free) | 1,749 | cached |
| `JSON.parse` of the export | 89 | — |
| **Face inference, main thread** (`segmentationFoldArtifactsFromFold`) | **23,865** | — |
| **Region containment, main thread** (`segmentContainment`) | **~67,600** | **~52,000** |
| Toolbar visible | 94,093 | — |

Entering the **Diagram** workspace triggers the same pair: 80 s before the
main thread is free (a 6.9 s mount, 23 s of face inference, a 48.6 s
containment pass), because the 204 linked steps ask for the segmentation.
The mount itself is every card computing its picture geometry at once —
`useStepPictureUrl` → `sceneGeometry` (4.9 s traced, most of it a vertex
lookup in `pictureGeometry.ts:331`) and the X-ray `paintOrder` (3.1 s) — for
all 204 cards, visible or not.

Each selection also grows the heap: 1.7 → 2.0 GB across the two above.

### Kernel, natively

`serde_json` parse of the document 220 ms; `load_document` 7 ms;
`document_geometry` 13 ms; `CheckCamv` 153 ms; `export_fold_document`
1,453 ms. The export has **no faces**, and not because of one bad sheet:
run per component, **all 204 sheets fail the Euler gate**. In the two sheets
inspected, every defect is a T-junction — a flat (`Cyan3`) line ending inside
a border or crease that was never split there (122 in a 1,398-line sheet;
1,533 in a 3,617-line one). The kernel traces faces between endpoints only,
so it can never certify these; the JS fallback splits them, which is why it
finds 344,518 faces where the kernel finds none.

## Root causes

1. **Open runs the file-import analysis and throws it away.**
   `loadNativeCreasePattern` (`projectSlice.ts:1218`) feeds the saved FOLD
   projection to `parseImportedCreasePatternFromFold` (`:1249`), which infers
   faces, builds the simulation mesh and a `TreeProject` of 489k creases. Of
   all that, the load keeps `title`, `source`, `sourceFold` and the frame
   list. The editable document is already in the kernel by then. 83% of the
   open.
2. **The JS face inference is slow, mostly for incidental reasons.**
   The sort comparator in `splitSegments` (`creasePatternImport.ts:770`) is
   ICU string collation over keys that are two integers — over half the
   inference. Vertex welding builds nine template strings per probe; the
   intersection sweep is on x only, so a column of sheets is one huge active
   set.
3. **The kernel never supplies faces for this file** (T-junctions, above), so
   every consumer falls back to (2) over the whole canvas — including Simulate,
   which also builds the simulation mesh for the whole canvas
   (`computeFoldArtifacts`, from reading the code; Simulate was not timed).
4. **Region containment is O(regions × edges), and recomputed on every
   selection.** `rimAssignmentCounts` (`creasePatternSelectionSegment.ts:92`)
   rebuilds `buildAssignmentByKey(fold)` — a string-keyed map of all ~590k
   edges — once *per region* (`:108`, called from `:157`): 204 times.
   Its cache is keyed on the document *snapshot* (`:144`), and every kernel
   command, a selection included, produces a new one, so the second
   selection pays it again. The diagram's link statuses (`linkStatus.ts:152`,
   `captureCreases.ts:151`) are keyed the same way.
5. **A selection is a whole-document round trip.** `CreaseSelect` counts as
   mutating: the kernel's geometry is re-fetched and decoded into 489k objects
   on the main thread, every canvas memo keyed on `lineSegments` rebuilds
   (hit index, bounds, spacing sort), fold artifacts go stale, `dirty` is set,
   and the previous snapshot is pushed onto undo. Undo on select is upstream
   behaviour (Oriedita's `MouseHandlerCreaseSelect` calls `d.record()`), so
   it stays — but each entry holds a **131 MiB** object graph here (26 MiB as
   the compact typed arrays), and the command paths push it with **no cap**
   (`projectSlice.ts:786`, `:2495`; only the overlay path at
   `creasePatternSlice.ts:713` applies `MAX_CP_HISTORY`). Twenty operations on
   this file is ~2.6 GB of undo.
6. **Smaller costs on open:** the document crosses to the worker as a
   structured clone of 2M objects; `CheckCamv` runs synchronously with a second
   snapshot, where edits already defer it; `readDiagram` re-parses, validates
   and re-stringifies every scene picture, and scans every thumbnail key
   against every carried step (1.3 s here — carried steps only exist because
   a newer build wrote them). On desktop the file also crosses Tauri IPC as a
   JSON-escaped string (not measured here).
7. **Found in passing (from reading, not yet confirmed by a save):** opening a
   native file stores its FOLD *projection* as `importedCreasePattern.sourceFold`
   (`creasePatternImport.ts:342` via `projectSlice.ts:1243`), so the next save
   writes the projection a second time as `sourceFold` (`projectSlice.ts:1790`)
   — about +23 MB compact here. Falls out of fix 1.1.

## Approach

Four phases. Phase 1 is a set of small, independent fixes that remove most of
the time; the later phases remove what Phase 1 can only shrink.

### Phase 1 — remove the waste (small PRs, each independently shippable)

Measured where noted; every "identical" was checked on this file.

- **1.1 Open without the import analysis.** Split a metadata-only reader out
  of `creasePatternImport.ts` (frames, title, source, the frame list) and use
  it in `loadNativeCreasePattern`; leave `parseImportedCreasePatternFromFold`
  to the real `.fold` import path. Nothing on the `.osf` path reads
  `fold`/`stats`/`lineOnly`/`simulationModelError`/the `TreeProject` (checked
  by grep; Export FOLD uses `importedCreasePattern.fold` only when there is no
  kernel document). Do not adopt the projection as `sourceFold` (cause 7).
  Expected open: **~33 s → ~5.5 s**, the 27 s freeze gone. High confidence:
  it is the measured 26–28 s step, and nothing after it uses the result.
- **1.2 Region containment: one map, keyed on geometry.** Build the
  assignment map once per fold (one `WeakMap`, shared with
  `segmentFoldDocument`, which builds the same map), and key the containment
  cache on `creaseFingerprint` rather than snapshot identity — containment
  reads only line positions and endpoints, and a selection changes neither.
  The diagram's `regionCache` / `choices` need the same, but with a wider
  key: `relativeCreaseFingerprint` also reads `active`, `customized` and the
  custom colour, which `creaseFingerprint` does not, so they key on a
  fingerprint of every line field except `selected`. Measured in Node on this file: the
  hoist alone is **59.0 s → 1.4 s with the same match** (segment 99, 2,123
  lines); the re-keying makes every later selection skip it. High confidence.
- **1.3 Numeric sort in `splitSegments`.** Sort `[a, b]` pairs numerically
  instead of collating `"a:b"` strings. Measured: **23.5 s → 11.0 s, output
  bit-identical** (244,012 vertices, 588,342 edges, 344,518 faces). High
  confidence; a unit test should pin the ordering against the old comparator
  on a fixture.
- **1.4 Cap the CP undo stack on every push.** Route the command and
  line-mutation pushes through the same capped append the overlay path uses.
  Memory safety, not speed. High confidence.

After Phase 1 (estimated from the measured parts): open ~5.5 s; first
selection ~14 s, of it a ~12 s main-thread freeze (11 s inference + 1.4 s
containment); later selections ~0.5 s. Phase 1 makes the file usable;
it does not make it fast.

### Phase 2 — one sheet index for every workspace; faces only for the sheet in use

**Why one index.** "Which sheet is this line in?" is answered four ways
today, and the sheets users see come from two of them, which disagree:

| Added | Where | How it splits the canvas | Used by |
| --- | --- | --- | --- |
| Jul 24 (`6c44d3dea`, `118bd2942`) | JS, main thread: `inferTopology` → `segmentFoldDocument` | faces of the whole arrangement, flood-filled across non-border edges | Edit selection toolbar; Diagram links, picker and capture; Simulate rail and mesh; inline simulation; segment export |
| Aug 20 (`feb60f765`) | Rust, `crease_graph.rs` | lines sharing an endpoint, aux lines left out | fold propagation's scope |
| Aug 27 (`c5036e0f3`) | Rust, FOLD export (`calculate_faces_per_component`) | lines sharing an endpoint; the face check per component, all-or-nothing | FOLD export only — and every sheet here fails it |
| Sep 5 (`e6343b522`) | Rust, `oristudio-precrease` `analyze` (`sheet_frames`), in the precrease worker | closed border loops; lines placed by containment; no faces | References; Diagram steps pulled from References |

The first is the expensive one, and it does whole-canvas work to answer
questions about one sheet. The toolbar asks "is this selection one sheet?",
which needs membership, not faces. The Simulate rail and the Diagram picker
list sheets and draw thumbnails from face edges, then simulate or capture
one. Simulate goes furthest: `computeFoldArtifacts`
(`creasePatternSlice.ts:1110`) builds faces *and* the simulation mesh for the
whole canvas on the main thread — the same ~27 s as the open's analysis step —
keyed on a revision that every selection advances.

**Measured on this file:**

| | Whole canvas | Index, or one sheet |
| --- | ---: | ---: |
| Face inference, current code (Node) | 23.5 s | 90 ms median, 164 ms max |
| Face inference with 1.3's numeric sort (Node) | 11.0 s | 28 ms median, 79 ms max |
| Border loops for all 204 sheets (native) | | 18 ms |
| Membership of all 489,093 lines (native) | 426 ms, scanning every sheet | 10 ms, through a grid of sheet bounds |
| The sheet index as built in 2.1: loops, membership and outlines | | 35 ms native, 44 ms wasm (median of 7) |
| References' full analysis (native; adds merge and exactness for every sheet) | 1.4–2.5 s | |

Inference one sheet at a time gives exactly the whole-canvas output (244,012
vertices, 588,342 edges, 344,518 faces), as long as lines that touch —
T-junctions included — stay in the same sheet.

- **2.1 The sheet index.** *(Done: `oristudio-cp/src/sheets.rs`, the
  `sheet_index` engine command, `cp-workspace/sheets/cpSheetIndex.ts`.)* One
  structure, built in Rust from the kernel document by the CP engine (the
  worker on the web, the native engine on desktop), cached on the main thread
  by `creaseFingerprint` so a selection never rebuilds it, and handed over as
  typed arrays, 1.9 MB here:
  - per sheet: its position in reading order (top-left first), its outline
    ring (corners only), bounds, and line count;
  - per line: its sheet, or none. Member lists are derived from this on the
    main thread, once, when first asked for.

  No rectangle flag: a frame is a property of an outline (four corners,
  axis-aligned), so References derives it where it needs it.

  A sheet is the **region inside a closed outer border**: border lines are
  chained where they meet or cross, each closed outer boundary is a sheet, and
  border lines *inside* it — a wall across it, or a loop within it — are
  ignored for the outline and are simply members (decided below). For a sheet
  with no border lines inside it, that is by construction the region the face
  segmentation finds today — flood-filling faces across non-border edges stops
  only at border lines — without tracing any of the 344,518 crease faces; the
  differential test in Verification is what confirms it. Precrease's simple
  loops are the same thing. It walks only the border lines (13,169 here), so it
  should cost about what border loops cost: tens of milliseconds — measured,
  35 ms native and 44 ms in wasm. It lives in `oristudio-cp`, beside the
  document it reads; `oristudio-precrease` depends on nothing, and References
  takes its sheets from this index in 2.2, at which point precrease's own
  border chaining is deleted rather than kept as a second copy.
- **2.2 Every consumer reads the index.**
  - *Edit toolbar:* a selection is a sheet when its ids are exactly that
    sheet's members — O(selection) through the line → sheet array. No faces.
    *(Done, with 2.3.)* Its verbs build that one sheet's faces: Export and Save
    to image, Share, and Simulate inline, whose window gets a mesh for its
    sheet alone. The image dialog it opens is handed that one sheet, so it no
    longer offers a picker of every region on the canvas. Simulate enters the
    Simulate workspace on that sheet (below).
  - *Diagram:* links resolve by outline as today (`ringsMatch` compares corners
    within 1e-6, so it does not care how the rim was traced); fingerprints are
    taken over member lines; the picker lists index sheets, with thumbnails
    drawn from member lines as References' rail already draws them.
    *(Done.)* Simulated pictures and Pose take the sheet's own mesh, a
    crease-pattern picture the sheet's own faces' rim (so a hole stays out),
    and the choice caches key on line content rather than the snapshot (1.2b).
    Measured on this file: entering the Diagram 28.3 s → 6.4 s to quiet
    (longest freeze 10.1 s → 4.3 s); **selecting a step 98.8 s → 0.29 s** —
    the Step pane drew every region's face thumbnail for a picker that was not
    open; the picker itself 3.1 s → 2.7 s. What is left of entering is the
    cards' own pictures (4.5).
  - *References:* precrease takes its sheets from the index (frames from
    rectangular outlines) instead of chaining borders again, and runs merge and
    exactness for the sheet being looked at, not for all 204.
    *(Done.)* The rail lists the index's sheets, each outline framed by the
    planner (`outline_components`: 3 ms for all 204, where `sheet_frames` took
    3.5 s). The planner is built from one sheet's lines
    (`PrecreasePlanner::for_sheet`: 21 ms, where it analysed the whole canvas
    again for 1.6 s). A crease picked in Find asks for its own sheet's merged
    lines. The chosen sheet is kept by its outline, because reading-order ids
    move when a sheet is added above or to the left; a saved file already
    named it by its box and frame. Every sheet of this file comes out with the
    planner's own frame, lines and exactness (`referencesFrames.wasm.test.ts`).
    Measured on this file: entering References 5.2 s → 3.0 s to the rail, a
    sheet's sequence 47.1 s → 45.7 s, heap after 927 → 862 MiB. What is left
    of entering is mostly the rail's cards (4.6). What is left of a sequence
    is the planner's own work on one sheet. On the biggest, an off-lattice
    sheet, about 30 s of the 47 s is the order optimiser spending its 10 s
    budget on each `sequence()` call, and 12 s is the stuck search.
    Precrease's own chaining (`analyze`) stays until the whole-canvas paths
    go, since its fixture tests and the differential test read it.
  - *Simulate:* the rail lists index sheets; the mesh is built for the selected
    sheet only. *(Done.)* One hook, `useSimulateSource`, gives the panel its
    rail, the sheet shown and that sheet's fold. For an editable pattern those
    are the index's sheets, sized in creases as References' rail sizes them,
    and the shown sheet's own mesh. A design's generated pattern, or an
    editable one with no closed border, still reads the whole canvas's
    artifacts. The sheet shown is kept by outline, so an edit that renumbers
    the index keeps it. Inline windows rebuild from their own sheet's mesh on
    open, undo and Rebuild. Measured on this file: the toolbar's Simulate →
    simulator ready 85.4 s (one 82.9 s freeze) → 2.75 s. What is left is the
    rail drawing 204 cards as some 489k SVG lines, and the layout after (4.6).
- **2.3 Faces per sheet, on demand.** Export, Fold, Simulate, inline
  simulation and Diagram capture need faces for one sheet. Use the kernel's
  face graph on that sheet's lines when it passes the Euler check, and
  otherwise the JS inference on those lines alone (28 ms median here). Run it in
  the worker, cached by the sheet's content fingerprint, so editing one sheet
  re-infers only that sheet. **Passing the Euler check is not proof the faces
  are right**: 2.1's differential test found that a line ending part-way along
  an unsplit border (a T-junction) is certified as two self-touching faces
  whose areas still sum to the sheet's — today's whole-canvas export has the
  same flaw. 2.3 either splits lines at T-junctions before tracing or refuses
  any face graph with a vertex inside an edge, and bodo's sheets, which are
  full of T-junctions, are the measure of which. The whole-canvas paths
  (`ensureCpSegmentationArtifacts`, and `computeFoldArtifacts` for an Edit
  document) go away.

  *Done, as built:* the kernel's `export_fold_lines` writes one sheet's lines
  as FOLD and keeps the traced faces only when those lines meet nowhere but at
  their ends (`meetings.rs`, the sweep the index's border splitting already
  used) — refusing rather than splitting, because the frontend's inference
  already splits, and every sheet of bodo goes to it either way.
  `ensureCpSheetArtifacts` turns that into artifacts whose one segment is the
  whole sheet. The inference still runs on the main thread, one sheet at a
  time, and the cache is the crease fingerprint plus the sheet, so any edit
  drops every cached sheet and the next action rebuilds only the one it needs.
  The differential test (`cpSheetArtifacts.wasm.test.ts`) gives every sheet the
  faces and the exported lines today's whole-canvas segmentation gives its
  region, on every fixture and on all 204 sheets of bodo; the one named
  difference is a sheet whose aux lines end on unsplit borders, which today's
  export dropped. The whole-canvas paths go when the Diagram and Simulate stop
  reading them.

  *Deleted, once they had:* nothing that asks about an editable sheet
  segments the canvas any more. The whole-canvas segmentation artifacts went
  with the Diagram's move, and the containment and selection matching
  (`creasePatternSelectionSegment.ts`) went after References', its reading
  kept only as the differential tests' reference (`regionsToday`). What still
  infers the whole canvas does so because it is about the whole canvas or has
  no sheet to read: a design's generated pattern, an editable pattern with no
  closed border (Simulate falls back to the canvas), and the whole-document
  export, whose dialog lists face regions to pick from (4.7). 2.4 made that
  inference four times cheaper.

  Measured with the Edit toolbar on it (`large-osf-perf.mjs --action`, same
  boxes, main 89da66832 against the branch):

  | | main | sheet faces |
  | --- | ---: | ---: |
  | First selection → toolbar | 13.0 s, longest freeze 9.3 s | 0.63 s, 0.39 s |
  | Save to image → preview drawn | 12.7 s | 0.58 s |
  | Export `.cp` → download | 1.2 s | 0.49 s |
  | Simulate inline → window ready | 15.5 s | 0.61 s |
  | Fold → done | 2.6 s | 2.3 s |
  | Heap after Simulate inline | 1,341 MiB | 984 MiB |

  What is left of the first selection is the selection command itself
  (~0.6 s), which is Phase 3. Checking it in the browser turned up a case the
  plane-graph check fixes: a book fold whose crease ends on unsplit borders
  got the bare square as its one certified face, so its inline simulation and
  the Simulate workspace showed flat paper that would not fold. Built for the
  sheet alone, it folds, in both since the Simulate move.
- **2.4 Inference speed** still matters for one huge sheet: integer-keyed
  welding instead of template strings, a 2D grid instead of the x-only sweep,
  typed adjacency in `buildPlanarFaces` — output bit-identical.
  *(Done.)* Measured on this file's FOLD projection in Node: the whole canvas
  10.3 s → 2.3 s, one sheet 27 ms → 7 ms median (60 → 29 ms for the
  slowest), with every vertex coordinate, edge, assignment and face identical
  to the bit. The sweep had been the largest part: a long border keeps its
  whole column of sheets in the active list.

**Definitions — decided 2026-10-18.** The two definitions users see today
disagreed on all of these; the last column is what the index does:

| | Face segmentation today (Edit, Diagram, Simulate) | Border loops today (References) | Decided |
| --- | --- | --- | --- |
| Shape | any border-enclosed region; holes allowed | rectangle → frame; other closed loops kept as polygons without one | every closed outer border is a sheet; References derives a frame from a four-corner, axis-aligned outline |
| A border line inside a sheet | a wall: two regions | outline "non-simple": refused, its lines unassigned | **ignored for now**: neither splits nor refuses the sheet; it is a member like any other line |
| A border loop inside a sheet | an outer region with a hole, plus the inner region — and an *empty* inner loop is its own region whenever the kernel cannot certify the faces | two loops; lines inside both go to the first, with a warning | the same rule read the same way: ignored, so no inner sheet, and its lines are the outer sheet's — *2.1 takes this reading; its PR asks for confirmation*. Faces are unchanged by it: an empty loop is still a hole wherever the kernel certifies the faces (`drop_hole_faces`) |
| Closing a border | points within 1e-8 model units weld | within 1e-6 × the border's whole-canvas extent (7.4e-3 units here), so whether a sheet closes depends on what else is on the canvas | the kernel's own "same point", `Epsilon::POINT` (2.5e-4 model units), everywhere |
| Which lines a sheet holds | midpoint inside the region or on its rim, every kind | both endpoints inside the frame (padded 1e-6 or 2e-3); aux lines only in rectangles; the rest unassigned | the midpoint rule for every kind — the rule saved Diagram fingerprints were taken with |
| Areas closed only by creases | listed as regions in the Diagram picker and the Simulate rail; the toolbar refuses them | not sheets; one paper-rectangle fallback when the canvas has no border lines at all | **not sheets, and not shown**: the picker and the rail stop listing them |
| Ids | position in a top-left sort | the order the border graph was walked | top-left reading order everywhere; stored ids are hints only |
| What is saved | Diagram: outline rings plus an id hint | References' reader state: a component id | References saves an outline reference, as the Diagram does; old ids read as hints |

Keeping the midpoint rule and the corner-based outline match is what keeps
existing Diagram links "current" across the switch. What can still move a link
is a sheet that changes under the new tolerance, or a step linked to one half
of a sheet that a border line used to split: that half no longer exists as a
sheet, so the step reads as missing and is relinked to the whole sheet. A
differential test over the fixtures — index sheets against today's
border-enclosed regions: same outlines, same members — makes every such change
visible before it ships. It is `cp-workspace/sheets/cpSheetIndex.wasm.test.ts`:
every fixture agrees, the two decided differences (a wall, an inner loop) are
pinned as named cases, and `CP_SHEET_INDEX_CORPUS` points it at files outside
the repository. On this file all 204 sheets agree with today's regions on
outline and on every one of the 489,093 lines.

Expected on this file: the first selection's toolbar costs the index (tens of
milliseconds in the worker, once per geometry change) plus a lookup; Diagram
entry pays no segmentation at all; Simulate pays one sheet's faces and mesh;
nothing in this phase blocks the main thread. Confidence: high on the costs,
since each piece is measured natively, in Node, and (the index) in wasm;
medium on the effort, since five consumers move.

### Phase 3 — selection without a whole-document round trip

- **3.1 Selection commands return the selection, not a new document.** For
  `SYNC_CP_LINE_SELECTION_AFTER_OPERATIONS` the kernel answers with the
  selected ids; the store keeps the same `document`/`geometry` objects, so
  canvas memos, hit index and every geometry-keyed cache survive. Read
  `cp-selection-two-sources-of-truth` first: the store ids stay what the
  canvas draws, and the kernel flags stay what region commands read.
- **3.2 Cheap undo entries.** A selection-only entry records the selection it
  replaced (ids), not the document; an edit entry stores the compact typed
  arrays (`restore_from_compact` already exists) instead of the decoded object
  graph — 26 MiB instead of 131 MiB here.

  *3.1 and the selection half of 3.2 done, as built (#472):* the kernel runs
  the eight region selects through `execute_selection_command`, which answers
  with the selected lines before and after (`line_selection.rs`) and refuses
  anything else, and `set_selected_lines` puts an exact selection back for
  undo, redo and deselect — in the session, the wasm bridge and the Tauri
  commands alike. The store keeps its snapshot and geometry and writes the
  changed `selected` flags into them in place (`mirrorSelectedLines`): an
  `.osf` save writes those flags, and an edit's undo entry puts its snapshot
  back into the kernel, so they must stay the kernel's; nothing draws from them
  and no fingerprint reads them. It writes in place only while the snapshot is
  current: the runtime counts every edit, in-place restore, insert, replace and
  merge as it is asked for and stamps the count on each state it reads
  (`isCurrentOristudioCpDocumentState`). Otherwise the selection fetches the
  document again, as `main` always did, because an edit or undo in flight has
  already taken that snapshot for its undo or redo entry (found in review:
  Escape during a grid change, then undo, left the store showing a selection
  the kernel no longer had).
  A selection's undo entry holds the selected
  lines it replaced (`selectedLines`) with `document` a shared reference to the
  live snapshot, never a copy. Dirty is unchanged: `.osf` and `.ori` both carry
  the selection, and a save after the same actions is byte-identical to
  `main`'s apart from `savedAt`. Measured on this file (same boxes, main
  0be4cdff3 against the branch, two runs each):

  | | main | selection returns ids |
  | --- | ---: | ---: |
  | First sheet → selected | 627 / 594 ms | 290 / 254 ms |
  | Second sheet → selected | 746 / 792 ms | 226 / 202 ms |
  | Longest freeze per selection | 394–618 ms | 100–124 ms |
  | Heap per selection (its undo entry) | +92–94 MiB | +2–6 MiB |

  Re-measured with the current-snapshot check (two runs each, alternating
  with main and the branch before it): first sheet 299 / 294 ms, second
  228 / 228 ms, heap +6 / +2 MiB, so a selection after an open still writes
  in place; main 591 / 689 and 728 / 828 ms in the same runs.

  Merged with main after #455 (the diagram batch import and its compound
  undo across Edit and Diagram). The import appends its sheets, and rolls them
  back, through the client directly, so it counts those as changes itself
  (`countOristudioCpDocumentChange`): its compound entry holds the store's
  snapshot from the moment it starts, and a selection landing meanwhile must
  not write into it. Selection entries never carry a `compoundId`, so the
  compound history's pruning passes them through; select, import, select
  undoes and redoes one step at a time with the store's ids, the kernel's
  flags and the snapshot's flags agreeing at each (kernel-backed test).
  Re-measured on the merge (c32c16cc5) against main with #455 (0bc59d6b1),
  two runs each, alternating: first sheet 258 / 267 ms (main 602 / 601),
  second 201 / 202 ms (main 776 / 748), longest freeze 98–114 ms (main
  394–619), heap +6 / +2 MiB per selection (main +95 / +92).

  What is left of a selection is about 100 ms of the kernel's box select in
  the worker and one ~107 ms main-thread task of passes over every line keyed
  on the selection — the canvas's stroke scene for the highlight, the move-snap
  document, the selected endpoints, the fold-angle layer — which is 3.3.

  *The edit half of 3.2 done, as built (#473):* an edit's undo entry holds
  `{ geometry }`, the compact typed arrays the store already keeps beside its
  decoded snapshot (shared, not copied), and undo and redo put them back with
  `restore_from_compact` (`restoreOristudioCpGeometryInPlace`, through
  `cpHistory.ts`). Overlay and selection entries hold no document at all; a
  selection entry's shared snapshot had stayed alive once an edit replaced
  it. Nothing writes into an entry's arrays: the one in-place writer is a
  selection, into the current state only. A restore posts the arrays as a
  copy, never transferred, so an entry restores again (checked in the
  browser: undo and redo three times over the same entries through the real
  worker). Desktop sends them as a raw request body, the bytes of
  `CompactGeometry::to_bytes` with the handle and session as headers, where
  `cp_restore_from_compact` took JSON arrays. The import's compound entry
  holds geometry too, and the cap and the compound pruning compose: 100 edits
  after an import drop it from both histories (kernel-backed test). Measured
  on this file with `--edits 120 --draw 440,715,850,820` (#472's branch
  de4a4189c against 0c8d0e2d2, two runs each, alternating):

  | | before | compact entries |
  | --- | ---: | ---: |
  | Undo of an edit | 2,435 / 2,453 ms | 592 / 589 ms |
  | Redo | 2,407 / 2,444 ms | 523 / 521 ms |
  | An edit (a line drawn) | 493 / 493 ms | 493 / 491 ms |
  | Kept per edit | +89 MiB heap | +25.7 MiB buffers, heap flat |
  | 120 edits | tab crashed at edit 39, both runs | levels off at 100: 598 MiB heap + 2,713 MiB buffers |

  Cause 5 put an entry at 131 MiB; measured here as heap retained after a
  forced collection, each one kept 89 MiB alive. What is left of an undo is one
  ~0.5 s main-thread task, the size of an edit's own (0.42 s): decoding the
  restored geometry and rebuilding what is keyed on it, which is 3.3 (not
  traced). A full stack on this file is still 2.7 GB of buffers, one whole
  copy of the geometry per entry; smaller entries would have to share
  unchanged geometry, which this plan does not cover.
- **3.3 Stop decoding 489k objects on every command.** The compact-transport
  work deliberately left consumers on the decoded snapshot because decoding
  was "~ms"; at this size it is ~150 ms and 131 MiB of garbage per command.
  Move the hot consumers (canvas memos, hit testing, fingerprinting,
  containment) onto the `CpGeometry` accessor, and decode only where a whole
  snapshot is genuinely needed (save, clipboard).

Expected: a selection costs one kernel call and a re-render that rebuilds
nothing — tens of milliseconds. Medium confidence on the exact number: the
kernel's box select is one linear pass, and today's whole select-to-store step
is 154 ms *including* the geometry fetch and the 489k-object decode this
removes.

### Phase 4 — the rest of the open

- **4.1 Parse where the kernel lives.** Hand the dropped `File` (a cheap
  handle) or the read bytes (transferred, zero-copy) to the CP worker; parse
  there, load the document into the kernel without crossing threads, drop the
  projection, and post back only geometry (transferred) plus the small
  remainder (view state, diagram strings). Removes the 2M-object structured
  clone and the main-thread parse.
- **4.2 Defer `CheckCamv` on open**, as edits already do.
- **4.3 Lazy diagram reading.** Validate scene pictures and resolve thumbnails
  when a page needs them, not all 204 at open.
- **4.4 Desktop reads bytes,** not a JSON-escaped string over IPC. Measure
  this one first in the Tauri build; it was not measured here.
- **4.5 Diagram cards compute picture geometry when they are shown.**
  `useStepPictureUrl` already waits for `useNearView` before painting, but
  the `viewGeometry(…).layers` and `xraySurfaceOf` memos above that check run
  for every card on mount. Gate them on the same `seen`.
  Measured after 2.2 (a profiling build of #465): entering the Diagram is
  about 3.3 s of these memos for all 204 cards (the X-ray paint order 2.4 s,
  the picture geometry 0.85 s), 0.8 s of link statuses fingerprinting each
  step's sheet, and about 2 s of mounting 204 cards. #455 virtualizes the
  step list (about 16 cards mounted), skips X-ray reconstruction for unmarked
  pictures and yields between link checks, which should take most of it:
  re-measure (`large-osf-perf.mjs --diagram`) once it lands before doing more.
- **4.6 Sheet cards draw cheaply.** The Simulate and References rails draw
  every line of every card as its own SVG `<line>`. On this file that is 204
  cards and about 489k elements: around 2 s of React commit, and a layout of
  all of them, on entering Simulate. Draw one `<path>` per ink per card, a few
  elements a card, and build a card's picture when it scrolls into view.
- **4.7 The whole-document export lists sheets.** File › Export to an
  image format opens a dialog that lists the canvas's face regions to pick
  from, so it infers the whole canvas first (2.3 s here since 2.4). Listing
  the index's sheets, with faces only for the one picked or drawn, would make
  it cost what the selection toolbar's export costs.

Expected: ~5.5 s → ~2–3 s total, the main thread busy for well under a second;
Diagram entry no longer pays 6.9 s for cards nobody is looking at.

### Later, needs a decision — not part of this plan's checklist

- **Kernel faces for T-junction documents.** Splitting at T-junctions before
  tracing faces would let the kernel certify these sheets and put faces back
  in the saved projection — an Ori Studio divergence in the exporter, the
  same kind as the per-component gate (`fold_graph.rs:136`), with FOLD-export
  oracle impact to check. Phase 2 removes the performance reason for it.
- **File size.** The `.osf` is pretty-printed (2-space indent is over half
  of 455 MB) and stores the geometry twice (native document + projection;
  the projection is part of the format — `scripts/osf-fold-projection.mjs`).
  A format change, so its own plan.

## Affected Areas

- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` — native open,
  command execution, undo pushes
- `apps/web/src/lib/creasePatternImport.ts` — metadata reader; inference
- `apps/web/src/lib/creasePatternSelectionSegment.ts`,
  `apps/web/src/lib/creasePatternSegmentation.ts` — containment, segmentation
- `apps/web/src/cp-workspace/cpSegmentationArtifacts.ts`,
  `apps/web/src/cp-workspace/CpSelectionToolbar.tsx` — onto the sheet index
- `apps/web/src/diagram/capture/` (`linkStatus.ts`, `captureCreases.ts`,
  `useLinkStatus.ts`, `useDiagramPatternSheets.ts`, `captureQueue.ts`,
  `poseController.ts`), `apps/web/src/store/workspaceStore/diagramCapture.ts`,
  `diagramZoom.ts` — Diagram links, picker and capture
- `apps/web/src/cp-workspace/regions/regionReference.ts`,
  `regionIdentity.ts` — outline matching stays; ids become hints everywhere
- `crates/oristudio-precrease` (`outline.rs`, `components.rs`),
  `apps/web/src/workers/precreaseWorker.ts`,
  `apps/web/src/cp-workspace/references/` (`sheetFrames.ts`,
  `referencesReaderState.ts`) — References on the shared index; saved sheet by
  outline
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts`
  (`computeFoldArtifacts`), `apps/web/src/components/panels/SimulatorPanel.tsx`,
  `SimulatorSegmentsPanel.tsx`, `apps/web/src/cp-workspace/sheets/segmentSheet.ts`
  — Simulate rail and per-sheet mesh; thumbnails from member lines
- `apps/web/src/cp-workspace/inlineSimulation/resolveSimulationRegion.ts`,
  `apps/web/src/lib/creaseSegmentExport.ts` — per-sheet faces
- `crates/oristudio-cp` (or the crate 2.1 picks), `crates/oristudio-cp-wasm`,
  `apps/web/src/workers/oristudioCpWorker.ts`,
  `apps/web/src/store/workspaceStore/oristudioCpRuntime.ts` — the sheet index,
  per-sheet faces, selection results, compact undo
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — memos onto the
  geometry accessor
- `apps/web/src/lib/nativeProjectFile.ts`, `apps/web/src/platform/fileService.ts`,
  `apps/tauri/src-tauri/src/lib.rs` — Phase 4 open pipeline

## Verification

The user file stays out of the repo. A synthetic stand-in reproduces both
costs: tile a committed fixture into a grid of ~200 sheets, with flat lines
ending on creases (T-junctions) so the kernel export has no faces. Keep the
Playwright harness used for this plan (drop → `performance.mark`s →
Box Select a sheet) as a script under `scripts/`, run against `web-prod`, and
record before/after for every PR. Output-equality tests for 1.2, 1.3 and 2.4
(same faces, same segment ids, same containment) on the existing fixtures,
and a per-sheet check for 2.3: one sheet at a time must reproduce the
whole-canvas faces, as it does on this file. For 2.1, a differential test over
every fixture: index sheets against today's border-enclosed regions, same
outlines and same members, with each intended difference from the
definitions table listed by name.

## Checklist

Phase 1
- [x] 1.1 Metadata-only reader on the `.osf` open path (#458); projection no longer saved again as `sourceFold` (#461)
- [x] 1.2 Assignment map built once; containment cache keyed on crease geometry (#459)
- [x] 1.2b Diagram region caches keyed on line content (with the Diagram's move to the index)
- [x] 1.3 Numeric edge sort in `splitSegments`, ordering pinned by a test (#460)
- [x] 1.4 Every CP undo push capped at `MAX_CP_HISTORY` (#462)
- [x] Harness script (`scripts/large-osf-perf.mjs`, #457); before/after numbers in each PR. No synthetic fixture: the measurements use the real file, kept outside the repository

Phase 2
- [x] Answers for the definitions table (2026-10-18; the inner-loop reading to confirm at 2.1)
- [x] 2.1 Sheet index in Rust from outer border loops, in the CP engine, cached by crease fingerprint; differential test against today's regions
- [x] 2.2 Edit toolbar on the index; its verbs on one sheet's faces
- [x] 2.2 Diagram links, picker and thumbnails on the index
- [x] 2.2 References on the index; merge and exactness per open sheet; sheet saved by outline
- [x] 2.2 Simulate rail on the index; mesh for the selected sheet only
- [x] 2.3 Faces per sheet on demand (kernel when its lines meet only at their ends, else JS), cached per sheet
- [x] 2.3 Whole-canvas paths deleted for every question about an editable sheet (the whole-document export's dialog: 4.7)
- [x] 2.4 Inference hot spots, output bit-identical

Phase 3
- [x] 3.1 Selection commands return ids; document identity preserved (#472)
- [x] 3.2 Selection-only undo entries (#472)
- [x] 3.2 Compact geometry for edit entries (#473)
- [ ] 3.3 Hot consumers on the `CpGeometry` accessor

Phase 4
- [ ] 4.1 Parse and load in the CP worker
- [ ] 4.2 Deferred `CheckCamv` on open
- [ ] 4.3 Lazy scene/thumbnail reading
- [ ] 4.4 Desktop byte read (measure first)
- [ ] 4.5 Diagram card picture geometry deferred to visible cards
- [ ] 4.6 Sheet cards: one path per ink, pictures for cards in view
- [ ] 4.7 The whole-document export dialog lists index sheets, faces only for the one picked
