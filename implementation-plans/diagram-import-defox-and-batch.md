# Defox and batch CP/SVG import into Diagram and Edit

## Goal

Import Defox projects and ordered batches of CP/SVG files into Ori Studio.
Imported CPs initially show folded models in Diagram and are appended to Edit
in one translated grid. Preserve existing content, original geometry, source
links, and the ability to undo the whole import from either workspace.

Confirmed with Zach on 2026-10-16. Implementation is complete on
`codex/diagram-batch-import`; the measurements and remaining performance gates
below accompany the draft PR. No private corpus files or generated pictures
are checked in.

## Approach

### Behavior delivered

- **File → Import Diagram Steps…** and Diagram's add-step menu open the shared
  import dialog. It accepts multiple CP/SVG files or one Defox project. Diagram
  also accepts CP/Defox and folder drops; existing image/SVG-only drops retain
  their picture-upload behavior.
- File and folder selection use the platform service. Folder traversal is
  shallow by default, with an explicit include-subfolders option. Native
  traversal skips symlinks; enumeration is bounded. Natural sorting preserves
  repeated files, with controls to reorder before import.
- CPs are folded in local coordinates before placement, using the existing
  first-solution capture route. A failed/timed-out solve retains the CP and an
  explicitly marked preview. **Finish import now** stops folding but imports
  every parsed CP with pending previews. Cancel discards staged imports.
- CPs with multiple paper regions produce a step per region, in file/region
  order, while their geometry is placed as one block. A CP with no resolvable
  region still enters Edit with a diagnostic step.
- Default placement is a near-square row-major grid, with translation only,
  configurable columns and a default gap of 100 model units. Existing CPs,
  annotations, simulation windows and folded figures contribute to occupied
  bounds. The batch goes to their right without moving them. On a truly empty
  or untouched starter canvas, the starter border is replaced and the grid is
  centered. The 205-file fixture produces 15 columns and 14 rows.
- Import initializes an absent Edit canvas through the existing Edit
  self-provisioning action. A pending/refused file retains its normal load flow.
  Provisioning an empty canvas is separate from adding imported content; Cancel
  can leave that empty canvas, but adds no imported geometry or steps.
- SVGs use the existing sanitizer and stored-asset limits. They remain vector
  pictures, without inferred crease geometry. Same-stem CP/SVGs are separate
  entries. The existing single-SVG/selected-empty-step rule is retained.
- The dialog shows file ordering, a schematic CP grid preview, progress, and
  per-entry failures/notices. Prepared pictures publish together at completion;
  live per-step preview during staging was not implemented.

### Defox compatibility

The reference is [Kei Morisue's DEFOX / Step-Folder](https://github.com/kei-morisue/step-folder),
MIT licensed, pinned to
[`63e08215297f4edc5e4a50a7b12f3e2249f18d55`](https://github.com/kei-morisue/step-folder/tree/63e08215297f4edc5e4a50a7b12f3e2249f18d55).
Unmodified source, resources and license are under `third_party/step-folder/`;
`upstream-sync.json` and `PORTING.md` record the compatibility surface.

The bounded adapter validates the saved JSON array and runs upstream drawing
and distortion functions against an inert SVG DOM in a worker. It does not run
upstream GUI/load code. Output still goes through Ori Studio's SVG sanitizer.
It supports saved linear stacks (including cycles), the saved cell branch,
transforms, distortion/catalyst data, colours, clipping and all 16 symbol kinds.
Import uses saved display state, with **no layer-order search**. Entry zero is
also imported as a step.

`fold_cp` supplies editable geometry. Defox's CP conversion reverses M/V codes
relative to standard CP; the adapter corrects this at its boundary without
changing ordinary CP parsing. Saved display geometry is kept distinct from the
source CP. A saved view must resolve to exactly one paper region; otherwise the
entry reports an unsupported result instead of inventing its source link.

Each linked Defox step retains a bounded saved-state JSON string and sanitized
vector picture using an explicit `defox` render mode. Global artwork colours
are copied into each snapshot so deleting the first step cannot lose them.
Symbols stay part of the vector artwork rather than editable native annotations.
Pose controls explicitly replace the saved view with an Ori Studio capture;
the UI explains the change, and Undo restores the imported view. Viewing,
annotating, saving or exporting does not re-fold it.

The original proposal's shared snapshot table and automatic transfer of Defox
credits/title into Diagram fields were not implemented. Saved source metadata
remains in snapshots; Ori Studio retains its own diagram title/style and page
layout. Defox does not save all its pagination controls, so those cannot be
recovered. The compatibility claim is limited to the pinned saved-state schema,
not every historical or future `.defox` file.

### Worker and cache ownership

| Facility | Ownership and implementation |
| --- | --- |
| Import CP task | One disposable instance of the existing `oristudioCpWorker.ts`/WASM engine; desktop uses an isolated existing Rust `CpSession` with its own mutex and cancellation channel. Same solver and capture API, no new fold algorithm. |
| Task lifecycle | `engines/cpTaskSession.ts` binds client, timeout, diagnostics, cancellation and disposal. Numerical handles never escape into Edit's figure registry. Canceling a task cannot terminate Edit's worker. |
| Defox adapter worker | A separate format renderer, not a fold worker. Its protocol returns validated CP/snapshot/vector records. |
| Whole-document analysis | `engine/cpAnalysisClient.ts` runs the CP worker's pure TypeScript analysis entry point without initializing WASM. This serves ordinary live documents and native clients, and disposes after idle time. |
| Shared segmentation cache | Existing `cpSegmentationArtifacts.ts` content-keyed cache remains authoritative. Superseded analysis is coalesced; completion checks current document identity before publication. |
| Region/thumbnail acceleration | Shared immutable bounds indexes narrow candidates while callers retain exact predicates. Sheet assignments, loose-edge lookup and thumbnails are cached by immutable FOLD identity. All consumers benefit. |
| Picture cache | Existing byte-bounded picture cache remains in place. Near-viewport gating now also skips expensive source/zoom/layer work. |
| Import memo | A short-lived 64 MiB exact-input memo avoids repeated successful preparation within the same job. Duplicate inputs still get separate placements and step IDs. Failed folds are not memoized as intrinsic file properties. |

The task memo is deliberately local: one job fixes style, fold route and first
solution, and its contents disappear after the job. A persistent cross-session
fold cache would need explicit solver/settings/version keys and is not added.
There is **no import-only region membership or link-status cache**. Cold
segmentation and source links are recomputed from normal editable geometry.
No unproved incremental region invalidation was introduced.

The shared geometry improvements address specific measured costs:

- Spatial bounds lookup replaces scanning every line against every region, and
  broad-phase intersection lookup replaces the previous one-dimensional sweep.
  Exact intersection/containment tests and tolerances remain unchanged.
- Global edge-assignment maps are built once per immutable source, rather than
  repeatedly for each sheet.
- Closed pattern pickers do not build thumbnails for every sheet.
- Consecutive equal-style thumbnail strokes use independent SVG path subpaths,
  preserving every segment and draw order while reducing React/DOM overhead.
- Whole-document topology inference runs off the main thread. Exporting large
  geometry, final publication and JSON persistence still have blocking costs.

### Transaction, placement and history

Rust's additive `append_disjoint` decodes and validates the entire batch before
mutating the live document. It proves placed bounds do not intersect one another
or existing geometry before omitting cross-model intersection division. It
preserves input line order and geometry; Oriedita's existing `import_add` is
unchanged. WASM, native commands and the shared client expose the same operation
using packed geometry transports.

Preparation happens outside the live document. The commit checks captured
load/revision, diagram identity, annotations, figures and simulations, performs
one append, then publishes both surfaces once. A refresh failure restores the
pre-import kernel document. A changed destination rejects the import with an
explicit restart message; automatic rebase onto intervening edits was deferred.

Source region boundaries/bounds are translated into placed space. Local captured
paper scenes stay local. Steps use normal region references/fingerprints, not
filenames or import ranges, for later link resolution.

A paired history marker coordinates Edit and Diagram. Undo/redo travels both
sides only when their matching entries are at the head. Later ordinary edits
must first be undone in their own workspace. Branch changes/history trimming
expire unreachable paired entries rather than leaving a dangling shared undo.
Redo restores stored geometry and pictures without parsing or solving again.
Existing Edit and Diagram retention policies still apply.

Persistence uses the existing native project serializer plus explicit Defox
render and pending/failed fields. Save/reopen does not require the source files
or restart solves. This change does **not** introduce a compact project format
or move project serialization off-thread; the measurements below expose that
remaining cost.

### Admission and cancellation limits

- At most 1,000 selected files; at most 10,000 enumerated folder entries.
- CP/SVG input: 16 MiB each. Defox input: 64 MiB. Total input: 256 MiB.
- Prepared batch content: 384 MiB accounting limit; exact-input memo: 64 MiB.
- Defox renderer output: 128 MiB total, 2 MiB saved-state string per entry;
  bounded nesting/arrays and finite/index validation.
- One active import CP session; native session registry has a hard cap of four.
- Preparation budget: 30 seconds per task. Fold budget: default 5 seconds,
  adjustable from 1 to 120 seconds. Defox rendering budget: 30 seconds.
- Cancel aborts staged work and disposes its session; native stop remains
  cooperative. Commit disables cancellation while publishing the atomic pair.

These limits bound admitted content and concurrency, **not process RSS**.
Structured clones, object geometry and native project JSON can multiply retained
bytes. Lower-memory-device admission still needs profiling before claiming a
memory safety envelope.

### Measured results, 2026-10-16

Baseline: Apple M1 Max, 64 GB RAM, macOS 26.6.2; Chromium/Metal via Playwright;
release WASM with the Vite development frontend. Large-corpus figures are single
recorded runs, not statistical latency guarantees. The production bundle was
separately smoke-tested with the eight-step Defox file through the visible UI.

The external harness is `scripts/diagram-import-check.mjs`; it accepts corpus
paths at invocation and writes only ignored `artifacts/diagram-import/` outputs.
It exercises live import, diagram round-trip, cold segmentation/link resolution,
the native OSF save/open methods and Edit/Diagram screenshots. Its native save
check uses the exact serializer with an in-memory file-service transport, so
reported save times exclude physical disk writes.

| Fixture/run | Import | Result | Cold analysis | OSF save / reopen | OSF size |
| --- | ---: | --- | ---: | ---: | ---: |
| 205 Betta CPs, normal folds | 91.8 s | 205 imported steps; 490,853 segments; included unfinished wireframes (classification corrected below) | 25.5 s; 205/205 links current | 3.77 s / 24.90 s | 428.5 MB |
| Same batch, Finish import now | 21.7 s | 205 pending previews; all geometry retained | 31.2 s; 205/205 links current | 4.25 s / 26.92 s | 489.2 MB |
| Supplied Defox project | 0.52 s | 8 saved views; 2,861 segments; no failed entries | 0.10 s; 8/8 links current | 0.07 s / 0.58 s | 4.23 MB |
| Synthetic mixed batch | 0.18 s | SVG, folded CP, SVG; 5 editable segments | 0.001 s; source link current | 0.02 s / 0.43 s | 16.3 KB |

The Betta input has 38,840,361 bytes, 205 files numbered 002–206, 171 distinct
contents and 306,187 auxiliary segment records. All are preserved. There is no
missing `001.cp` generated by the importer. The Defox file has eight entries,
including cycles and saved zoom/distortion, and is 3,756,426 bytes.

A separate release Rust engine benchmark parsed the full CP corpus in 474 ms,
appended it in 15 ms and exported raw FOLD in 3,393 ms (3,887 ms total). These
numbers isolate engine costs; they are not frontend end-to-end timings.

The initial full import recorded a worst main-thread long task of about
2.0 seconds, with another 1.8-second serialization task. Shared thumbnail work
reduced the Finish-now run from roughly 30 seconds to 22 seconds and removed an
earlier 7–8-second publication stall, but the original targets are still missed:

| Initial target | Actual disposition |
| --- | --- |
| Eight-step Defox under 3 seconds | Met in the supplied fixture; no layer-order search. |
| CP preparation/placement under 10 seconds excluding solves | Not met: Finish-now is 21.7 seconds. |
| No import-owned main-thread task over 50 ms | Not met: about 2 seconds at full publication. |
| Input/cancel acknowledgement under 100 ms; native quiescence under 500 ms | Cancellation correctness tested; latency percentiles not established. |
| Edit/Diagram p95 frame time under 33 ms | Large Edit grid and Diagram visually verified; frame-time gate not measured. |
| Numeric total-process memory envelope | Content/concurrency budgets implemented; final peak/retained RSS not established. |

Further work should profile and reduce normal whole-document reconstruction and
project serialization, rather than introduce an importer-specific geometry
truth. A compact project format/off-thread save would be a separate architectural
change. Do not describe this draft as satisfying all original performance gates.

### Validation and compatibility boundaries

- Rust workspace tests, fmt, workspace clippy, rebuilt WASM bridges and web build.
- Oriedita oracle: 8 I/O and 64 operation parity checks against freshly built
  vendored source. The new append is additive; ordinary import semantics stay
  covered by the existing oracle.
- Defox oracle: inert-adapter output compared with unmodified upstream drawing
  in jsdom for all 16 symbols plus saved cell-state rendering. Synthetic fixtures
  cover conversion, transformations, distortion/cycles and malformed input.
  Repeat-label text metrics are deterministic in the oracle; production uses
  OffscreenCanvas. No claim of pixel identity across arbitrary platform fonts.
- Web tests cover ordering/duplicates, malformed neighbors, cancel/Finish-now,
  placement, shared exact-predicate indexing, source links, history branching,
  rollback, folder acquisition/drop routing and persistence. The final full suite passed
  13,681 tests across 964 files (16 tests/two files skipped); lint, typecheck
  and i18n check also passed.
- Tauri compile/check, native tests (including isolated handles/cancellation and
  symlink-free traversal), and dev-app launch passed. Native picker/drop UI was
  not automated: installed and development apps shared a bundle identity, making
  the available app selector ambiguous. Do not claim a completed native UI matrix.
- Browser production Defox and mixed-import-from-an-unopened-Edit smoke tests
  passed with no page errors. Full private
  corpora and mixed CP/SVG passed in Chromium, including all source links after
  cold reconstruction and save/open without unknown/read-only steps. A mixed
  batch also passed keyboard Undo/Redo through the live WASM engine, restoring
  both Edit geometry and Diagram steps together.
- The existing SVG sanitizer/export tests run in the web suite; a full 205-step
  PDF/SVG export, WebKit/Firefox import matrix, and frame/memory benchmarks remain
  explicit follow-ups. TreeMaker C++/WASM parity was not rerun because no
  TreeMaker behavior changed; Oriedita is the affected upstream.

Analytics uses the existing command chokepoint plus one completion event with
format enums and bucketed added/failure counts. No filenames, paths, geometry,
raw timing or source content is sent. All new UI styling uses its CSS module.

`git diff --check` passes outside the unmodified vendored source. That source
contains nine existing trailing-whitespace lines and one final blank line;
byte-for-byte comparison with the pinned checkout passed, so they are retained.

## Affected Areas

| Area | Change |
| --- | --- |
| `apps/web/src/diagram/import/` | Format adapters, bounded coordinator, placement and dialog |
| `diagram/upload/`, `platform/`, menus/commands | File/folder/drop acquisition and entry points |
| `diagram/document/`, `diagram/capture/`, `diagram/pictures/` | Defox saved views, statuses, persistence and lazy picture work |
| Shared geometry/segmentation and sheet modules | Spatial indexing, immutable lookup reuse and thumbnail costs |
| `store/workspaceStore/diagramBatchImport.ts`, `compoundHistory.ts` | Atomic publication, source translation, coordinated undo/redo |
| CP Rust/WASM/native clients and worker | Additive disjoint append and independent task sessions |
| `engine/cpAnalysisClient.ts`, `engines/cpTaskSession.ts` | Shared background analysis and disposable engine lifecycle |
| `third_party/step-folder/`, `tools/step-folder-oracle/` | Pinned upstream and compatibility harness |
| `scripts/diagram-import-check.mjs`, Rust benchmark example | External corpus validation and measurements |
| Locales, analytics, `PORTING.md`, `upstream-sync.json` | Product integration and compatibility documentation |

## Import review follow-up

The initial dialog did not follow the existing export dialog and control
conventions. It now shares the preview/options dialog frame, ToggleRow,
NumberField/NumberRow and icon buttons. Verify light/dark, narrow screens,
keyboard focus and cancellation before shipping.

The Steps grid mounted every card and delayed painting with IntersectionObserver;
it was not virtualized. Adopt the existing TanStack Virtual dependency with
measured responsive rows and preserve selection, keyboard focus, turns and
insertion targets. Avoid annotation geometry for unannotated thumbnails. Profile
scrolling and switching to CP on the supplied 205-file corpus.

An Order5 request can return Wire2/NotAttempted with zero solutions without
throwing. Import incorrectly accepted that as a finished fold. Require a paper
view with a discovered solution; retain a failed CP preview otherwise. Earlier
counts of “205 folded” only counted absence of an import error and are superseded
by the corrected classification below.

The scroll CPU profile on the original grid showed a 2,363 ms frame stall:
`xraySurfaceOf`/face-overlap calculations dominated, even though the imported
steps have no annotations. The grid now paints only mounted/overscanned rows,
without a second visibility observer, using the existing 48 MiB URL cache.
Thumbnail markup retains the exact crease order and CSS theme tokens while
avoiding a React fiber for every alternating mountain/valley stroke run.

Show as also paid roughly 688 ms across the sampled captures to construct a
whole-document sheet-thumbnail index. Capture thumbnails now read the chosen
region's `scopedLineIds`, using the same shared fitting and stored-stroke budget,
so switching one step costs that step's creases. No importer-only cache or
additional worker was introduced.

A separate kernel limitation explains why a later refold can succeed: isolated
192.cp stopped at Wire2/NotAttempted, while the same lines translated to their
appended Edit position reached Paper5/Solved. This was reproduced in the same
worker/session; no edits to the geometry beyond translation. Import prepares
folds before placement. The completion/fallback fix does not change the ported
solver's sensitivity to coordinates or claim to repair it.


### Follow-up measurements and validation

Chromium/Metal, same 205-file external corpus, development UI and release WASM:

- Final import: 118.45 s, **190 completed paper folds, 15 failed CP previews,
  zero pending previews and zero imported wireframes**. All 490,853 segments
  remain in Edit. The additional failed CP previews make this output different
  from the initial incorrect wireframe run.
- Five cold scroll jumps (25%, 50%, 75%, end, start): mounted cards stayed at
  17–32 rather than 205. Worst frame gaps were 200, 169, 233, 620 and 101 ms.
  The original grid's worst gap was 2,363 ms. The remaining cost is dense SVG
  construction/decoding/mounting, not unused face-overlap analysis. These are
  jump samples, not a p95 interaction guarantee or the original 50-ms target.
- Dense step 205, folded → CP: 540 ms before scoped thumbnails and stable card
  mounts, 345 ms after. Capture CPU work across the sampled view changes fell
  from about 757 ms to 125 ms after removing whole-document thumbnail indexing;
  rendering and worker time are separate from that CPU figure.
- The affected step 191 refolded successfully after placement. Another completed
  import can fail when refolded at its translated position; the existing manual
  Pose/capture flow still offers its diagnostic transparent drawing. This change
  enforces the strict completed-fold-or-CP contract at **import** and does not
  change that established manual flow or the coordinate-sensitive kernel.
- Light/dark and 390px dialog screenshots inspected; folder toggle, numeric
  controls, shared dialog Escape/focus and cancellation verified. Closing while
  Edit provisions cannot reopen the dialog or publish a cancelled job.
- Browser virtual-grid checks: selected off-screen card mounts, Home/End reach
  the first/last entries, resizing preserves selection, no ResizeObserver-loop
  warning, and no page errors. The shared export dialog's existing tests pass.
- Follow-up suite: 3,811 passed / 3 skipped across 220 diagram, export and style
  files. Final targeted captures/import regressions: 122 passed; final virtual
  grid/thumbnail/picture regressions: 27 passed. Lint, typecheck and i18n check
  pass. `git diff --check` and the external harness syntax check pass.
- Rust/native/oracle and production bundling checks from the initial feature
  were not repeated: this follow-up changes shared frontend behavior and does
  not change engines, bindings, routing, native APIs or build configuration.

For repeatable scroll samples, run the external harness with
`ORI_IMPORT_SCROLL_CHECK=1 node scripts/diagram-import-check.mjs <corpus-folder>`.
It also records unfinished wireframes separately from retained CP failures.
Ignored browser profiles/screenshots are under `artifacts/diagram-import-ui/`;
no corpus data or screenshots are committed.

## Checklist

- [x] Inspect merged Diagram, existing SVG/Append behavior, supplied files and workers/caches.
- [x] Confirm folded CP steps plus simultaneous translated grid append to Edit.
- [x] Pin/vendor unmodified Defox source and add rendering/conversion oracle coverage.
- [x] Implement shared spatial lookup and off-thread whole-document analysis.
- [x] Implement atomic batch append and translated source links.
- [x] Implement isolated existing-engine task sessions and cancellation on web/native.
- [x] Implement bounded staging, duplicates, failures, Cancel and Finish import now.
- [x] Implement coordinated Edit/Diagram history, rollback and branch/retention handling.
- [x] Add file/folder/drop UI, layout controls and existing SVG behavior.
- [x] Preserve Defox saved views/symbols, with explicit undoable native pose replacement.
- [x] Persist snapshots/statuses and verify private corpus save/reopen and cold links.
- [x] Validate 205 CPs, eight Defox steps and a mixed CP/SVG batch in Chromium.
- [x] Validate the production Defox worker bundle and native build/launch.
- [x] Add locales, private analytics and measured-result documentation.
- [x] Verify shared modal UI and controls in browser and focused tests.
- [x] Verify incomplete folds become failed CP previews and completed folds remain paper views.
- [x] Virtualize the grid and measure scrolling and CP switching.
- [ ] Meet the original 10-second preparation and 50-ms main-thread targets.
- [ ] Establish p95 interaction/cancel latency and total-process peak/retained memory.
- [ ] Complete native picker/drop and WebKit/Firefox UI matrix plus full-corpus PDF/SVG export.

## Follow-up: import ordering and raster step previews

- [x] Merge main through the Pages bitmap-preview PR (#452) and retain its rendering path.
- [x] Reuse the favorites reorder hook for import files, including keyboard handles and opt-in edge scrolling.
- [x] Remove the Columns Auto/readout reset, and name the time limit Max seconds per fold.
- [x] Use one localized new-diagram initializer for first edits and imports; retain authored fields.
- [x] Replace the empty-state upload shortcut with the shared Import command.
- [x] Generalize the Pages bitmap cache/component to step cards; keep vector export unchanged.
- [x] Rasterize dense source badges with the same ordered strokes and theme inks; use native base64 where available.
- [x] Validate drag, defaults, raster cache invalidation, and cold/warm scrolling in the browser.
- [x] Run affected frontend checks and update PR #455 with measured results.

### Raster-preview architecture and measurements

Main was merged through `34bc7c3c8` (#452). That change rasterized Pages only;
Steps still mounted SVG images. The page implementation is now
`DiagramPicturePreview` / `picturePreviewCache`, shared by both surfaces, with
one 64 MiB pixel-and-source-bounded LRU. The existing 48 MiB SVG URL cache remains
shared as before. There is no importer-only bitmap cache or additional worker.
Pages retain their zoom-settling policy; virtual step cards request their measured
resolution immediately, reuse ready bitmaps on remount, and show the SVG only if
rasterization fails. They do not mount the expensive SVG as well as rasterizing
it. Source badges draw the same ordered strokes and theme inks onto canvas,
without a DOM path for each crease run. Native byte-to-base64 encoding is used
where available, with the previous portable fallback retained.

The other unnecessary blank state came from constructing a bare diagram during
batch commit. Import and first edit now share `newDiagram`, including localized
title, subtitle, credits and Han style. Existing authored values, including
intentional blanks, are preserved. The empty-state Import button dispatches the
same instrumented command as File > Import Diagram Steps.

Final full-corpus browser run (Chromium/Metal, 1440×1000, development renderer):

- 205 files in 108.60 s: 190 completed paper folds, 15 failed CP previews,
  zero pending steps and zero imported wireframes. The default title and all
  three title-block credits were verified after actual publication.
- Cold jump frame gaps at 25%, 50%, 75%, end and start: 88, 74, 110, 135 and
  43 ms. Repeating those jumps: 74, 79, 73, 70 and 52 ms. The previous full
  import's worst cold jump was 620 ms. Mounted cards stayed at 17–32; every
  visible picture was a bitmap after settling, with no blank pictures or
  browser errors.
- A separate replay of those completed imported pictures measured the time
  until every visible bitmap was ready: 62–575 ms on first jumps, 50–125 ms
  on repeat jumps. The densest first-time CP previews still have a real SVG
  construction/decoding cost. These are individual samples, not p95 guarantees
  or proof of the original 50-ms budget.
- 205-file dialog checks cover pointer dragging, duplicate-name identity in
  unit tests, keyboard moves, edge scrolling, disabled ordering during import,
  light/dark themes and a 390px viewport. The existing favorites drag hook
  gained opt-in edge scrolling; no drag library was added.
- The external import harness now reports `readyAtMs` alongside frame gaps.
  Private corpus files, imported documents and profiles remain ignored.

Validation: **3,790 passed / 3 skipped across 224 files** (diagram models,
components, imports, store/defaults, drag hook, encoding and stylesheet checks).
Full web lint, final changed-file lint, TypeScript, i18n, and production build
with landing prerender pass. The build reused generated WASM because this
follow-up and the merged changes do not alter Rust/WASM sources. Rust/native
and oracle validation from the initial feature was not repeated for these
shared frontend changes. The benchmark script passes `node --check`, and
`git diff --check` is clean for the follow-up.

## Follow-up: import list simplification and large page documents

- [x] Remove import drag reordering at the user's request; retain a plain numbered file list.
- [x] Profile continuous Pages scrolling using the supplied 205-step, 23-page OSF.
- [x] Remove measured scrolling bottlenecks while retaining page selection, placement, navigation and vector export.
- [x] Add regression coverage and repeat browser checks on the full saved document.
- [x] Run affected frontend validation and update the draft PR with measured results.

### Root causes and changes

The existing Pages visibility observer limited artwork, but left every step's
interaction targets mounted. Targets now mount only near the viewport, plus the
selected page so keyboard reveal and pointer capture retain their DOM. The 23
lightweight page shells remain for layout, visibility and camera navigation.
Pages reuse the shared bitmap cache, skip the extra live SVG paint while loading,
and rasterize a new source immediately; resolution refinements still wait for
zoom to settle. Export continues to use the vector composition.

Profiling also found three expensive operations that virtualization alone could
not fix:

- Page composition reconstructed face overlap/layer order for x-rays on pictures
  without any x-ray annotation. Pages and step cards now ask for this geometry
  only when a known x-ray mark needs it. Actual x-rays retain the same renderer.
- The Page inspector subscribed to the page in view and rebuilt all its controls,
  including 205-option picture selectors, on page changes. Only the current-page
  step-count row now subscribes to that value.
- When segmentation arrived, all source links were checked synchronously during
  rendering. The first check also constructed containment for the roughly 490k
  Edit creases. Containment now uses the exact existing geometric predicate in
  the existing CP analysis worker, with transferable midpoint input, and seeds
  the existing selection/link cache. Bulk link checks yield between batches and
  discard results when the document or steps change; single-step inspectors
  retain immediate checks. There is no new worker type or duplicate cache.

Import rows have no drag handles, reorder buttons, drag hints or grab cursors.
The unused importer-only edge-scrolling extension to the shared favorites hook
was removed, restoring that hook to main. No other drag interaction was removed.

### Measured result

Chromium/Metal, 1440×1000, development renderer, the supplied saved OSF including
its full Edit document. Frame intervals are measured with requestAnimationFrame
while real wheel events scroll down and back; these are local observations, not
a cross-device guarantee.

| Run | Scroll extent | p95 frame interval | Worst frame interval | Frames over 50 ms |
| --- | --- | --- | --- | --- |
| Before | 65 wheel ticks each way | 83.29 ms | 4,481.94 ms | 109 |
| After, same trace | 65 wheel ticks each way | 9.14 ms | 107.42 ms | 2 |
| After, full cold pass | All 23 pages, down and back | 10.10 ms | 189.93 ms | 6 |
| After, repeat pass | All 23 pages, down and back | 10.01 ms | 17.76 ms | 0 |

The full-document check finished with 16 interaction targets and two page bitmaps
mounted, versus 205 targets before. Home/End selected and revealed the first and
last steps, picture placement committed and Undo restored it, and no browser
errors occurred. The 205-file import dialog passed plain-list checks in light,
dark and narrow layouts. The cold pass still has occasional work above 50 ms;
this does not claim the original performance budget is fully met.

`scripts/diagram-pages-check.mjs /absolute/path/to/project.osf` repeats the full
scroll/navigation/placement check and writes timings, a CPU profile and a
screenshot to ignored `artifacts/diagram-pages/`. Corpus data stays external.

Validation for this follow-up: **3,842 passed / 3 skipped across 229 files**,
including diagram/import/export, components, the store, selection containment,
the native client adapter and styles. Full web lint, TypeScript, i18n and the
production bundle with explicit landing prerender pass; the browser harness
passes `node --check`, and `git diff --check` is clean. Generated WASM was reused:
Rust, native commands, file formats and ported solver behavior are unchanged,
so Rust/oracle/native-launch checks from the initial implementation were not
repeated. No new analytics event is needed for removing a control and changing
rendering/scheduling.
