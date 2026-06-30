# Oriedita Native Document Interchange

## Goal

Import, edit, preserve, and export native Oriedita-oriented documents with exact
format semantics against the pinned Oriedita source baseline.

This plan covers Oriedita `.ori` as the primary native editor-save format, plus
the adjacent Oriedita interchange formats that matter for arbitrary user
documents:

- `.ori`: Oriedita native JSON save files.
- `.fold`: Oriedita FOLD files, including Oriedita extension fields and embedded
  `file_frames` / `foldedForm` frames.
- `.orh`: legacy Oriedita/Orihime files where users still have old documents.
- `.cp`: Oriedita's plain crease-pattern exchange format as the lossy baseline.

The parity target is Oriedita behavior, not just "can read something similar".
The app must not silently drop Oriedita data, silently downgrade to CP, or invent
non-Oriedita fields as a substitute for native parity.

## Approach

Follow `implementation-plans/oriedita-port.md` and
`implementation-plans/oriedita-source-map.md` as the migration authority:

- Oriedita behavior is the canonical reference.
- Staging is allowed; scope reduction is not.
- Do not replace Oriedita behavior with simpler approximations.
- Unknown or unsupported behavior must be explicitly preserved, reported, or
  blocked with a typed unsupported result.
- Every enabled format path needs focused Rust tests and Oriedita oracle coverage
  where the upstream code can act as an oracle.
- The web UI can expose a format only after the Rust/WASM path has a tested
  preservation story for that format.

### Parity Baseline

The exact Oriedita oracle baseline for this plan is:

- `9d39135ae232cc03be4ffaf74baa7ae2df970507`

This matches `implementation-plans/oriedita-source-map.md` and is the commit
the oracle harness should build against unless a deliberate baseline update is
made. Some later notes mention `17434b90ff8bea1ad9acf7ce147893025f47e95b` as an
inspected vendored snapshot; do not regenerate oracle fixtures from that snapshot
until the source map and this plan are updated together. A baseline update must
include regenerated oracle fixtures and a changelog entry in this plan.

### Source Areas

Primary Oriedita source files:

- `oriedita-data/src/main/java/oriedita/editor/save/Save.java`
- `oriedita-data/src/main/java/oriedita/editor/save/BaseSave.java`
- `oriedita-data/src/main/java/oriedita/editor/save/SaveV1_0.java`
- `oriedita-data/src/main/java/oriedita/editor/save/SaveV1_1.java`
- `oriedita-data/src/main/java/oriedita/editor/save/SaveConverter.java`
- `oriedita-data/src/main/java/oriedita/editor/save/SaveProvider.java`
- `oriedita-data/src/main/java/oriedita/editor/save/FileVersionTester.java`
- `oriedita-data/src/main/java/oriedita/editor/json/DefaultObjectMapper.java`
- `oriedita-data/src/main/java/oriedita/editor/export/OriImporter.java`
- `oriedita-data/src/main/java/oriedita/editor/export/OriExporter.java`
- `oriedita-data/src/main/java/oriedita/editor/export/FoldImporter.java`
- `oriedita-data/src/main/java/oriedita/editor/export/FoldExporter.java`
- `oriedita-data/src/main/java/oriedita/editor/export/OrhImporter.java`
- `oriedita-data/src/main/java/oriedita/editor/export/OrhExporter.java`
- `oriedita/src/main/java/oriedita/editor/service/impl/FileSaveServiceImpl.java`
- `oriedita/src/main/java/oriedita/editor/canvas/impl/CreasePattern_Worker_Impl.java`
- `oriedita-data/src/main/java/oriedita/editor/databinding/FoldedFigureModel.java`
- `oriedita-data/src/main/java/oriedita/editor/databinding/GridModel.java`
- `oriedita-data/src/main/java/oriedita/editor/databinding/CanvasModel.java`
- `oriedita-data/src/main/java/oriedita/editor/databinding/ApplicationModel.java`

Current local target files:

- `crates/oristudio-cp/src/io/ori.rs`
- `crates/oristudio-cp/src/io/fold.rs`
- `crates/oristudio-cp/src/io/orh.rs`
- `crates/oristudio-cp-wasm/src/lib.rs`
- `apps/web/src/workers/oristudioCpWorker.ts`
- `apps/web/src/store/workspaceStore/oristudioCpRuntime.ts`
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts`
- `apps/web/src/lib/creasePatternImport.ts`
- `apps/web/src/lib/nativeProjectFile.ts`
- `apps/web/src/components/panels/CreasePatternPanel.tsx`
- `tests/fixtures/oriedita`
- `tools/oriedita-oracle`

### Format Semantics

`.ori` is the native Oriedita editor-save format. It stores the editable crease
pattern plus selected editor models. The relevant top-level fields are:

- `@version`
- `lineSegments`
- `circles`
- `texts`
- `title`
- `points`
- `auxLineSegments`
- `creasePatternCamera`
- `canvasModel`
- `gridModel`
- `foldedFigureModel`
- `applicationModel`

The `.ori` format does not store the full list of calculated folded figure
drawers. Oriedita saves a single `FoldedFigureModel` settings object and, on
open, restores folded front, back, and line colors through
`CreasePattern_Worker_Impl.Memo_jyouhou_toridasi`. Do not claim `.ori` persists
multiple movable folded models. Ori Studio's own `.osf` remains the format for
persisting the app's richer local workspace state, including multiple generated
folded overlays.

Embedded folded geometry belongs to FOLD `file_frames`, usually through
`foldedForm` frames. Preserve those frame graphs during `.fold` import/export
even when the editable CP view operates on one active crease-pattern frame.

### Responsibility Matrix

| Format/state | Native responsibility | Ori Studio responsibility | Parity rule |
| --- | --- | --- | --- |
| `.ori` | Oriedita editor save JSON: CP primitives, grid, camera, canvas, application, folded-figure preferences. | Import/export as Oriedita `.ori`, restore supported editor state, preserve unsupported fields. | Never treat `.ori` as a container for Ori Studio-only folded overlay lists. |
| `.fold` | FOLD geometry plus Oriedita extension fields and embedded `file_frames`. | Preserve all frames, edit the selected active CP frame, render preserved folded-form frames. | Do not drop unrelated frames or unknown frame extras during export. |
| `.orh` | Legacy Oriedita/Orihime text format with charset quirks and folded colors. | Import/export the legacy surface and warn when a modern document cannot fit. | Keep legacy quirks oracle-tested; expose unavoidable loss before writing. |
| `.cp` | Plain crease-line exchange format. | Import/export as the lossy fallback for line-only crease patterns. | Warn before dropping circles, texts, aux lines, points, or editor state. |
| `.osf` | Not an Oriedita format. | Full-fidelity Ori Studio workspace, including multiple generated folded overlays and app view state. | Use for Ori Studio state; support later export back to Oriedita formats when representable. |

### Oriedita Save Field Matrix

| `.ori` field | Upstream owner | Local owner | Handling |
| --- | --- | --- | --- |
| `@version` | `Save.java`, `SaveV1_0.java`, `SaveV1_1.java`, `FileVersionTester.java` | `io::ori` | First-class strict/permissive version policy. |
| `lineSegments` | `LineSegmentSave`, `FoldLineSet` | `model::line`, `io::ori` | First-class editable data. |
| `circles` | `PointSave`, `FoldLineSet` | `model::circle`, `io::ori` | First-class editable data. |
| `texts` | `TextSave` | `model::text`, `io::ori` | First-class editable data. |
| `title` | `BaseSave` | `CreasePatternDocument` | First-class document data. |
| `points` | `PointSave` | `model::point`, `io::ori` | First-class editable data. |
| `auxLineSegments` | `BaseSave`, auxiliary line service | `model::line`, `io::ori` | First-class editable data kept separate from fold lines. |
| `gridModel` | `GridModel` | `model::grid`, web viewport/grid state | First-class grid data. |
| `creasePatternCamera` | `Camera` | preserved metadata, later web viewport restore | Preserved now; Phase 6 promotes supported fields. |
| `canvasModel` | `CanvasModel` | preserved metadata, later tool/input state restore | Preserved now; Phase 6 promotes supported fields. |
| `foldedFigureModel` | `FoldedFigureModel` | preserved metadata, `folding::FoldedFigureModel` defaults | Preserved now; Phase 6 promotes colors/defaults. |
| `applicationModel` | `ApplicationModel` | preserved metadata | Preserve-only unless a field maps to shared app settings. |
| unknown top-level fields | Jackson `FAIL_ON_UNKNOWN_PROPERTIES=false` behavior | `document.metadata` with `oriedita:ori:` prefix | Preserve exactly as structured JSON. |

### Oracle Strategy

Use Oriedita as a structured semantic oracle. Do not rely on raw text equality as
the only test because JSON object ordering and pretty-printing are not the
behavior. Do compare exact structured values after canonicalization.

Add or extend an Oriedita oracle CLI with commands for:

- import `.ori` with strict version policy,
- import `.ori` with Oriedita's "open anyway" unknown-version behavior,
- export `.ori` through `OriExporter`,
- run `SaveConverter.convertToNewestSave`,
- import/export `.fold` through `FoldImporter` / `FoldExporter`,
- import/export `.orh` through `OrhImporter` / `OrhExporter`,
- emit canonical JSON for save objects,
- emit canonical summaries for line segments, circles, text, points, aux lines,
  grid, camera, canvas model, folded figure model, and application model.

Canonical comparisons must include:

- coordinates with Oriedita-compatible precision,
- line color enum names and active-state enum names,
- selected/customized flags,
- custom RGB colors using Oriedita's ARGB hex convention,
- circles by center, radius, color, and custom color,
- texts by position and content,
- points by coordinate,
- aux lines separately from fold lines,
- grid model fields and defaults,
- camera model fields when present,
- canvas model fields when present,
- folded figure model fields when present,
- application model fields when present,
- unknown top-level `.ori` fields preserved under the metadata prefix,
- FOLD root metadata, frame metadata, `file_frames`, `frame_parent`,
  `frame_inherit`, `frame_classes`, unknown frame extras, and
  `oriedita:*` extension fields.

Oracle tests should be gated so normal Rust unit tests do not require Java:

- Rust unit tests: always run with `cargo test -p oristudio-cp`.
- WASM tests: run for all exposed import/export bindings.
- Oracle tests: run when the Oriedita oracle binary is present.
- External corpus tests: run only when an external corpus path is configured.

## Phases

### Phase 0: Baseline And Source Map

Lock the exact Oriedita baseline and update the source map so native file parity
has a visible owner.

Work:

- [x] Pick and record the pinned Oriedita commit.
- [x] Update `implementation-plans/oriedita-source-map.md` statuses for `.ori`,
  `.fold` `file_frames`, `.orh`, save conversion, and web exposure.
- [x] Document which Oriedita save fields are first-class, preserved-only, or
  unsupported.
- [x] Add a compatibility matrix that distinguishes `.ori` native save data from
  `.fold` embedded folded-form data and `.osf` Ori Studio workspace data.

Validation:

- `git diff --check`
- Source-map review against the pinned Oriedita files.

Done when:

- A future implementer can tell from the source map exactly which upstream class
  owns every saved field and which local module owns the port.

### Phase 1: Native Save Model Completeness

Make the Rust `.ori` model complete enough to preserve Oriedita save semantics
without hiding important fields in anonymous metadata forever.

Work:

- Keep the current preserving metadata path for unknown fields.
- Add typed helpers for `creasePatternCamera`, `canvasModel`,
  `foldedFigureModel`, and `applicationModel` where the app needs to restore or
  synthesize values.
- Preserve unknown fields inside those model objects, not only unknown top-level
  fields.
- Match `DefaultObjectMapper` color and point encoding exactly.
- Match `SaveConverter` behavior for `v1`, `v1.1`, missing version, and unknown
  version.
- Add a permissive import entry point that mirrors Oriedita's "open anyway"
  branch while keeping strict import as the default for automated paths.

Validation:

- Rust fixtures copied from `third_party/oriedita/oriedita/src/test/resources/save`.
- Unit tests for strict and permissive `.ori` version behavior.
- Unit tests for canonical import/export of every known `.ori` top-level field.
- Oracle tests comparing Rust imports with Oriedita `OriImporter`.
- Oracle tests comparing Rust exports with Oriedita `OriExporter` after canonical
  JSON normalization.

Done when:

- Importing and exporting every vendored Oriedita `.ori` save fixture round-trips
  canonical CP data and preserved metadata with no unexplained loss.

### Phase 2: FOLD Frame Graph Preservation

Finish arbitrary Oriedita FOLD document preservation, including embedded folded
forms.

Work:

- Treat `treemaker-fold::FoldDocument` as a full file-plus-frame document when a
  source file contains `file_frames`.
- Keep active editable CP frame selection explicit.
- Preserve root metadata and all non-active frames.
- Preserve `foldedForm` frames and render all renderable folded-form frames, not
  only the first.
- Preserve unknown frame classes and unknown frame extras.
- When exporting an edited FOLD file, update only the active CP frame and leave
  other preserved frames unchanged unless the user explicitly deletes or replaces
  them.
- Make invalidation explicit when edits make preserved folded forms stale.

Validation:

- Rust lossless parse/export tests for nested `file_frames`.
- Web import tests for selected active frame plus preserved folded-form inventory.
- Web render tests for multiple imported folded-form frames.
- Export tests proving edited active CP geometry does not drop unrelated frames.
- Oriedita oracle tests for the parts Oriedita's `FoldImporter` and
  `FoldExporter` can canonicalize.
- Rust-only preservation tests for FOLD fields that Oriedita does not expose
  through its editor save object.

Done when:

- A FOLD file with multiple crease-pattern and folded-form frames can be opened,
  edited in the active frame, saved/exported, and reimported without dropping the
  frame graph.

### Phase 3: Legacy ORH Parity Surface

Expose legacy `.orh` support consistently with Oriedita and preserve folded
color metadata.

Work:

- Keep byte-based import with Oriedita's charset order.
- Expose `.orh` through WASM where browser file input can supply bytes or a
  decoded string safely.
- Export `.orh` only from data that Oriedita can represent.
- Surface lossy export warnings when circles, text, aux state, folded colors, or
  grid data would not survive as expected.
- Preserve folded-front, folded-back, and folded-line color sections.

Validation:

- Existing `.orh` Rust tests remain green.
- Oracle tests compare Oriedita `OrhImporter` / `OrhExporter` canonical output.
- Web tests cover opening `.orh` and export warning behavior.

Done when:

- `.orh` behaves as a legacy Oriedita-compatible path, with explicit warnings for
  any unavoidable loss.

### Phase 4: WASM And Runtime Format APIs

Expose each supported Oriedita document path through the shared CP worker without
format guessing in the UI.

Work:

- Add `load_ori`, `load_ori_permissive`, and `export_ori` to
  `crates/oristudio-cp-wasm`.
- Add `.orh` load/export bindings if Phase 3 is in scope for the current slice.
- Add full FOLD file import/export bindings that preserve `file_frames`.
- Update generated wasm package and TypeScript worker imports.
- Add runtime wrappers in `oristudioCpRuntime.ts`.
- Keep each format entry point explicit instead of routing everything through
  `load_fold`.
- Return typed `WasmErrorEnvelope` codes for unsupported format, invalid version,
  lossy export, and parse failure.

Validation:

- `wasm-pack build crates/oristudio-cp-wasm --target bundler`
- `wasm-pack test --node crates/oristudio-cp-wasm`
- Type tests for worker API shape.
- Web runtime tests for each format binding.

Done when:

- The React store can ask the worker to load or export `.ori`, `.fold`, `.orh`,
  and `.cp` without duplicating parser logic in TypeScript.

### Phase 5: Web Open, Save, Save As, And Export Semantics

Make the product file workflow match Oriedita where the format is Oriedita, and
match Ori Studio where the format is richer than Oriedita.

Work:

- Add `.ori` to openable editable crease-pattern documents.
- Add `.orh` to open/import where byte handling is supported.
- Extend `ImportedCreasePatternFormat` and native project source typing to
  include `.ori` and `.orh`.
- Add `Export ORI...` to menus, command dispatch, capabilities, file panel, and
  tests.
- Teach Save to save back to `.ori` when the active source is `.ori` and the user
  has not chosen `.osf`.
- Keep Save As offering `.osf` as Ori Studio's full-fidelity workspace format.
- Warn before saving to `.cp`, `.orh`, or any lossy target.
- Preserve recent-file entries with their original source format.
- Keep browser and Tauri behavior aligned through the file-service abstraction.

Validation:

- Store tests for open/save/save-as/export state transitions.
- Menu action tests for `file.exportOri`.
- Capability tests for enabled/disabled state.
- File service tests for extension filters.
- Tauri command/menu checks if native menus include the new action.
- Manual smoke check opening an Oriedita `.ori`, editing one line, exporting
  `.ori`, and reopening in both Ori Studio and Oriedita.

Done when:

- Users can open a native `.ori`, edit it, save/export `.ori`, and reopen it in
  Oriedita without silent data loss.

### Phase 6: Oriedita UI State Restoration

Restore Oriedita save fields that affect user-visible behavior without pretending
that `.ori` stores Ori Studio-only workspace state.

Work:

- Map `gridModel` to the existing editable CP grid state.
- Map `creasePatternCamera` to the CP viewport where coordinate systems align.
- Map useful `canvasModel` fields such as active line color, aux line color,
  selection mode, toggle-line-color state, and input mode defaults.
- Map `foldedFigureModel` colors to the default model for newly generated folded
  figures.
- Preserve folded figure scale, rotation, state, anti-alias, shadow, and
  transparency fields even when the current UI does not expose every control.
- Do not create multiple generated folded overlays from `.ori`; Oriedita does
  not serialize them there.
- Add user-visible metadata status for preserved-only fields.

Validation:

- Rust tests for model parsing and synthesis.
- Web store tests for viewport, grid, active color, and folded color restoration.
- Visual tests for restored grid/camera where deterministic.
- Oracle tests for `.ori` import/export model values.

Done when:

- Opening an Oriedita `.ori` restores the same Oriedita editor-state fields that
  Oriedita itself applies on open, and preserves the rest for export.

### Phase 7: Native Project Interop Boundaries

Keep Ori Studio `.osf` and Oriedita `.ori` responsibilities explicit.

Work:

- Update `.osf` schema typing so original `.ori`, `.orh`, and `.fold` sources are
  recorded accurately.
- Store preserved Oriedita source metadata inside `.osf` when a user imports an
  Oriedita document and then saves an Ori Studio project.
- Keep Ori Studio's multiple generated folded overlays in `.osf` only.
- Add export paths from `.osf` back to `.ori` and `.fold` when the underlying
  document can be represented.
- Explain lossy boundaries in the UI before export, not after the file is
  written.

Validation:

- Native project migration tests.
- `.osf` round-trip tests preserving imported Oriedita source identity.
- Export-from-`.osf` tests to `.ori` and `.fold`.

Done when:

- Saving to `.osf` never prevents a later faithful Oriedita export, and exporting
  to `.ori` never pretends to include Ori Studio-only overlay state.

### Phase 8: Corpus, Compatibility Report, And Release Gate

Do not claim arbitrary Oriedita compatibility until the corpus says so.

Work:

- Extend `oriedita_folded_document_corpus` to report format-specific pass/fail
  details for `.ori`, `.fold`, `.orh`, and `.cp`.
- Add external corpus support for private user documents without committing them.
- Track unsupported preserved-only fields separately from data loss.
- Add a developer compatibility report summarizing:
  - files scanned,
  - files imported,
  - files exported,
  - files round-tripped,
  - Oriedita oracle mismatches,
  - preserved-only fields,
  - lossy export warnings,
  - embedded folded-form frame counts.
- Add a small public fixture gallery under `tests/fixtures/oriedita`.

Validation:

- `cargo test -p oristudio-cp --test oriedita_folded_document_corpus`
- Oriedita oracle corpus tests when the oracle binary is available.
- Web smoke tests against the public fixture gallery.
- External corpus run before release claims.

Done when:

- The project can produce a compatibility report that distinguishes exact
  parity, preserved-but-not-edited data, explicit unsupported behavior, and real
  bugs.

## Affected Areas

- `crates/oristudio-cp`: native import/export, save models, canonicalization,
  metadata preservation, FOLD frame graph handling, ORH legacy support.
- `crates/oristudio-cp-wasm`: explicit load/export bindings for Oriedita formats.
- `apps/web/src/workers`: worker API surface for format-specific commands.
- `apps/web/src/store/workspaceStore`: open/save/export routing, source typing,
  dirty state, recent files, restored Oriedita state, folded-form inventory.
- `apps/web/src/lib`: crease-pattern import typing, native project schema,
  command capabilities, menu actions, file warnings.
- `apps/web/src/components`: file panel controls, CP grid imported folded-form
  rendering, metadata/lossy-warning UI.
- `apps/tauri`: native menu and file-dialog filters if desktop menus expose the
  new actions.
- `tools/oriedita-oracle`: import/export oracle commands and canonical JSON
  emitters.
- `tests/fixtures/oriedita`: public fixtures for `.ori`, `.fold`, `.orh`, and
  edge-case saves.
- `implementation-plans/oriedita-source-map.md`: parity status and upstream
  source ownership.

## Checklist

- [x] Phase 0: Pick and record the pinned Oriedita baseline.
- [x] Phase 0: Update the Oriedita source map for native document interchange.
- [x] Phase 0: Add the `.ori` / `.fold` / `.orh` / `.osf` responsibility matrix.
- [x] Phase 1: Add typed `.ori` helpers for Oriedita editor model fields.
- [x] Phase 1: Preserve unknown nested Oriedita model fields.
- [x] Phase 1: Match Oriedita strict and permissive version handling.
- [ ] Phase 1: Add `.ori` Rust unit and oracle round-trip tests.
- [ ] Phase 2: Promote FOLD frame graphs to first-class imported document state.
- [ ] Phase 2: Preserve and render all renderable `foldedForm` frames.
- [ ] Phase 2: Export edited FOLD files without dropping unrelated frames.
- [ ] Phase 2: Add FOLD frame graph preservation and oracle tests.
- [ ] Phase 3: Expose `.orh` through the runtime with legacy charset behavior.
- [ ] Phase 3: Add `.orh` lossy-warning and oracle coverage.
- [x] Phase 4: Add explicit WASM load/export APIs for `.ori`.
- [ ] Phase 4: Add explicit WASM load/export APIs for full FOLD documents.
- [ ] Phase 4: Add `.orh` WASM APIs if legacy support is in the implementation
      slice.
- [ ] Phase 4: Regenerate and test the wasm package.
- [ ] Phase 5: Add `.ori` open/save/export routing in the web app.
- [ ] Phase 5: Add `.orh` open/export routing where supported.
- [ ] Phase 5: Add `Export ORI...` menu, capability, file panel, and tests.
- [ ] Phase 5: Add save-back semantics for current `.ori` sources.
- [ ] Phase 6: Restore Oriedita grid, camera, canvas, and folded color state.
- [ ] Phase 6: Preserve unsupported editor-state fields with clear status.
- [ ] Phase 7: Update `.osf` source typing and Oriedita metadata preservation.
- [ ] Phase 7: Add export-from-`.osf` tests for `.ori` and `.fold`.
- [ ] Phase 8: Extend corpus reporting for native Oriedita document interchange.
- [ ] Phase 8: Run public fixture, oracle, and external corpus validation before
      claiming arbitrary Oriedita compatibility.
