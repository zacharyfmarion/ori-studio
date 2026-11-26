# Title block: the final crease pattern, without aux lines and from a file

## Goal

Two changes to the first page's title block (`diagram-title-block.md`):

1. **No aux lines.** The block's crease pattern draws the final mountain and
   valley folds and the paper's edge, and nothing else. The finished model in
   front of it draws no aux lines either.
2. **A crease pattern from a file.** The author can upload a `.cp`, `.fold`,
   `.ori` or `.orh` file, and the block draws that as the final crease
   pattern instead of a linked step's. The file's lines are stored in the
   diagram, so the project file carries them and prints without the original.

## What the report showed

The report's file is a square with four aux diagonals (Edit's cyan lines, `F`
in FOLD) and one Diagram step linked to it, shown folded flat. Opened headless
as the app opens it (`parseNativeProjectFile`, `readDiagram`,
`preparedPages(...).compose(0)`):

- **The pattern** (the large square at the block's top right) already leaves
  aux lines out. Its scene holds the paper's four edges and nothing else:
  `patternScene` gives an Edit link's `aux` strokes no pen
  (`pages/titleBlockContent.ts`, `PATTERN_ROLES`), and this pattern has no
  mountain or valley fold.
- **The X is the finished model**, drawn in front of the pattern's lower-left
  corner. Auto takes the last step with a picture, step 1. Its picture is the
  unfolded sheet, and the sheet's aux lines are drawn on it in the style's aux
  pen (`auxCreases.visible` is on in the Diagram preset).

Lines in the aux pen do reach the pattern by two other routes:

- a Fold step's link. Its thumbnail's `aux` strokes are the state's flat
  creases (precreases, pinch marks), drawn in the aux pen on purpose
  (`FOLD_PATTERN_ROLES`, a8a9f0900);
- an Edit link's `unassigned` strokes (U lines), drawn in the aux pen.

## Approach

Two pull requests: Part 1 is a look change and needs no format change; Part 2
adds the upload and the format for it. Part 2 builds on Part 1's drawing rule.

### Part 1: the block draws only the folds

- **One role table for every pattern source.** `edge` → edge pen, `mountain`
  → mountain pen, `valley` → valley pen, and `unassigned` and `aux` are not
  drawn. `FOLD_PATTERN_ROLES` and `patternRoles` go: an Edit link, a Fold
  step and an upload draw alike.
- **`drawsPattern` keeps its meaning**: a thumbnail with any line the block
  draws, the edge included. A pattern with no folds still draws its edge, as
  the report's file does.
- **The model draws no aux lines.** `titleBlockArt` paints the model with the
  style's aux pen off (`auxCreases.visible: false`, for that one picture).
  Steps keep their aux lines as the style says. The block already draws its
  model without the step's marks and window (`wholePicture`), since it shows
  "the finished model, not an instruction" (`diagram-title-block.md`,
  section 4); aux lines on it are the same kind of thing. A model kept as a
  bitmap (a capture too large for a scene) keeps them: a bitmap cannot be
  inked again.
- **Both are looks** (class (b) in `diagram-document-evolution.md`): a saved
  diagram's block changes when it opens. No step moves, nothing stored
  changes, and no page's signature changes.

### Part 2: a crease pattern from a file

#### What the author does

Page pane → Header & footer → Crease pattern. The select gains an entry at its
foot, **Upload a CP or FOLD file…**, which opens the file picker (`.cp`,
`.fold`, `.ori`, `.orh`).

- The file is read (below). If it reads, the select shows the file's name as
  the chosen entry, with the size slider under it as for any pattern, and the
  block draws it.
- Choosing Upload again replaces it. Choosing Auto, a step or None lets it go;
  undo brings it back.
- A file that does not read, or has no mountain or valley fold, is refused
  with a notice, and nothing changes.

The picker must open inside the click (a browser allows a picker only from a
gesture). Radix's select calls its change handler synchronously from the
item's pointer-up or key-down, so the handler can open the picker there. Use the picker that makes no save
target (`openBinaryFiles`, single, as the import dialog does), not
`openTextFile`, which remembers the file as a place to save to. Verify on
WebKit; if Safari does not count the select's event as the gesture, the row
gets a button instead.

#### How the file is read

Through the CP kernel, in a task session of its own (`createCpTaskSession`),
as the Diagram's import dialog reads a `.cp` (`diagram/import/prepareCp.ts`):
`loadCp`, `loadFold`, `loadOri` or `loadOrh` by extension, then
`documentGeometry`, decoded to a document snapshot. The lines are exactly
those Edit shows for the same file. Edit's own pattern is never touched,
unlike the import dialog, which places each file's pattern in Edit
(`batchPlacement`).

Every main line becomes a stroke in its role, by the rule a link's thumbnail
uses (`linesSheetThumbnail`), fitted to a **1000-unit** box instead of a
link's 100. It is then kept as every stored pattern is kept
(`storedSheetThumbnail`: snapped to a tenth of a unit, at most 20,000
strokes). Every role is stored, aux lines included. What the block draws is
decided when it draws (Part 1), so the stored record is the file's, not
today's drawing rule.

Why 1000 units:

- A link can be refreshed from its pattern. An upload is the only copy the
  diagram has.
- At 100 units a point may be off by up to 0.05% of the side. On the block's
  largest pattern (about 130 mm) that is 0.065 mm, against a 0.088 mm fold
  pen. At 1000 units it is a tenth of that, for one more digit per
  coordinate.

Why 20,000 strokes is enough: across a local corpus of 484 published
designers' crease patterns, the most edges in any one is 9,396, and the 99th
percentile is about 6,000. A larger file loses its shortest creases first, as
a link does, and the notice says so.

#### How it is stored

Two pieces in the diagram (`workspace.diagrams[i]`):

```jsonc
"titleBlockContent": {
  "pattern": { "kind": "upload", "assetId": "asset-6c1e…" }
},
"assets": {
  "asset-6c1e…": {
    "id": "asset-6c1e…",
    "kind": "crease-pattern",
    "name": "crane.cp",
    "pattern": "{\"viewBox\":\"0 0 1000 1000\",\"strokes\":[{\"x1\":0,\"y1\":0,\"x2\":500,\"y2\":500,\"role\":\"valley\"}, …]}",
    "bytes": 48213
  }
}
```

- **The part** names the asset, as an uploaded picture's step source does
  (`{ kind: 'upload', assetId }`). It has no turn or mirror: a mirrored crease
  pattern whose folds are not swapped is another pattern, and a turn belongs
  to the block, not the file (see "Not in this plan").
- **The asset** is a new kind beside `svg` and `raster`:
  - `name`: the file's name, one plain line, shown in the select and nowhere
    else (never sent to analytics);
  - `pattern`: the lines, as a `SheetThumbnail` (the shape a link's thumbnail
    has, read by `readSheetThumbnail`), written as one JSON string so the
    file is not a line per coordinate (decision 4 of the launch review);
  - `bytes`: what it costs in the file (the string's length), as every asset
    says.
- **Not stored: the original file.** The lines are what prints. The original
  is still on the author's disk, and uploading again replaces the lines.

Why an asset, and not the lines inside the part or in the thumbnails table:

- The assets table is where uploaded things live. It is pruned when nothing
  names an entry, and undo snapshots share an entry by id. A later feature
  that takes an upload (a step that shows a CP file, or a photo as the
  finished model with `{ kind: 'upload' }` on `model`) uses the same record.
- The thumbnails table holds previews of linked patterns, keyed by their
  content. An upload is not a preview of anything.
- Lines inside the part would put a large value among the block's small
  fields.

#### Reading and writing

- `readTitleBlockSource` knows `upload` for the pattern only; the model
  keeps `step` and `none`, so a model of kind `upload` is a newer build's
  (carried, shown as Auto). The pattern part reads only if its asset is there
  and of kind `crease-pattern`. A missing asset, or one of another kind, makes
  the part one that does not read: it is dropped alone and reads as Auto, the
  rule for every part. If the asset is a newer build's, the part is carried as
  a newer build's and shows Auto.
- `readAsset` knows `crease-pattern`: `name` a string, `pattern` a string that
  `readSheetThumbnail` takes back. A newer thumbnail (`isNewerSheetThumbnail`:
  a role or field this build has no name for, or more than 20,000 strokes) or
  a field the asset has no name for makes the asset a newer build's, carried
  as it came. Anything else is dropped.
- A step whose source or picture names a `crease-pattern` asset reads as no
  picture, as one naming a missing asset does. Every other switch on an
  asset's kind (painting an upload, export, the save notice's count) gains
  the case.
- `withReferencedAssets` keeps the asset the pattern names. Without that, the
  store's prune on the next edit would drop it.
- `writeTitleBlockContent` writes the part; `writeAsset` writes the asset in
  the order shown above.
- No reader version bump and no `formatVersion` change: older builds carry
  both pieces (next section).

#### What older builds do with such a file

Checked against the reader in the v0.10.0 tag (`diagramFile.ts`,
`diagramDocument.ts`):

- `{ kind: 'upload' }` is a source kind it has no name for. It is carried
  under `newer.titleBlockContent.pattern`, written back as it came, and the
  block shows Auto's pattern in its place (`readTitleBlockSource`).
- An asset of kind `crease-pattern` is an unknown asset. It is read as
  `{ id, unknown }`, written back as it came, and always kept, since only a
  newer build knows what names it (`withReferencedAssets`).
- So a file goes through 0.10.0 and back with its upload intact. If the
  author picks another pattern there, the part goes and the asset stays,
  named by nothing; the next build to edit the diagram drops it.
- `__fixtures__/diagram-title-block.json` already proves this carry for the
  same shape: an `own` model naming an asset.

#### Drawing

`resolveTitleBlock` gives `pattern: { from: 'upload', step: null, number:
null, scene }`, the scene made from the asset's lines by `patternScene` with
Part 1's roles. Nothing after that changes: the square, the model on its
corner, the sizes, and every printed surface (the Pages view, the PDF, Print,
the one-sheet SVG). The Pages view never marks an upload missing: one with no
folds is refused when uploaded.

#### Decisions

All four taken as recommended (Zach, 2026-11-25: "Yes, build it", answering
"Build it with the plan's recommendations, F-1 to F-4?").

**F-1. What the block draws.**
- A. The pattern draws mountain and valley folds and the paper's edge, from
  every source; the model draws no aux lines.
- B. The pattern as in A; the model keeps the step's aux lines.
- C. As today.
- **Recommended: A.** It is what was asked ("just the final M/V folds"), and
  in the report's file the aux lines on show are the model's. It drops a Fold
  diagram's precreases and pinch marks and Edit's U lines from the block.

**F-2. Where the uploaded lines live.**
- A. An asset of kind `crease-pattern`, named by `{ kind: 'upload', assetId }`.
- B. Inside the part.
- C. In the thumbnails table, named by key.
- **Recommended: A**, for the reasons above. All three survive 0.10.0.

**F-3. Whether the original file is kept.**
- A. No: the drawn lines only.
- B. Its text too, beside the lines.
- **Recommended: A.** B costs a few hundred KB for a dense `.cp` and several
  MB for a `.fold` with faces, and nothing in this plan reads it. B is only
  worth it if a later feature should fold the file or open it in Edit.

**F-4. How precise the stored lines are.**
- A. Fitted to 1000 units.
- B. Fitted to 100, as a link's thumbnail.
- **Recommended: A**, for the reasons above.

Small choices I would make, stated rather than asked: one upload per diagram;
every sheet in the file is drawn together; choosing another pattern lets the
upload go (undo brings it back).

### Not in this plan

- Turning the block's pattern, to show a crease pattern as a diamond. If
  wanted, it belongs to the block (a `patternRotationDeg` whatever the
  source), not to the upload.
- A step that shows an uploaded crease pattern.
- A region of Edit's pattern as the block's pattern without a step (the
  second half of T-13 A in `diagram-title-block.md`).

## Affected Areas

Part 1:

- `apps/web/src/diagram/pages/titleBlockContent.ts`: one role table;
  `distinctPatterns`' comment in `titleBlockChoices.ts`.
- `apps/web/src/diagram/pages/composeDiagramPage.ts` (`titleBlockArt`): the
  model painted with the aux pen off.
- Tests beside both; `implementation-plans/diagram-title-block.md` sections 4
  and 5 and T-14.

Part 2:

- `apps/web/src/diagram/document/diagramDocument.ts`: the asset kind, the
  pattern's `upload` source, `withReferencedAssets`, a document edit that
  adds the asset and sets the part in one step.
- `apps/web/src/diagram/document/diagramFile.ts`: reading and writing both
  pieces; a new fixture `__fixtures__/diagram-title-block-upload.json`, made
  of synthetic geometry (never a user's file).
- `apps/web/src/cp-workspace/sheets/linesSheetThumbnail.ts`: a box size.
- A reader for the file through a CP task session, beside the title block's
  modules (`diagram/pages/`).
- `apps/web/src/diagram/pages/titleBlockContent.ts`,
  `titleBlockChoices.ts`, `useDiagramTitleBlock.ts`;
  `components/diagram/DiagramTitleBlockRows.tsx`.
- The store's title block action (`slices/diagramSlice.ts`): one commit, one
  undo step.
- Analytics (`analytics/trackDiagram.ts`, `docs/analytics.md`):
  `title_block_choice` gains `upload`, and a `title_block_pattern_format`
  (`cp`/`fold`/`ori`/`orh`) on that event.
- i18n: the new strings in all 8 locales.
- `implementation-plans/diagram-workspace.md` (The v1 file: the pattern part
  and the assets list) and `diagram-title-block.md` (sections 5 and 8: the
  `own` sketch gives way to `upload`).

## Checklist

Both parts were built in one change, on Part 1's drawing rule (2026-11-25).

Part 1:

- [x] One role table for the block's pattern: folds and edge, nothing else
      (`PATTERN_ROLES`). An Edit link and a Fold step with one thumbnail are
      now one choice in the Page pane (`distinctPatterns`): they draw alike.
- [x] The block's model drawn, and measured, with no aux lines
      (`WHOLE_PICTURE` in `pagePictures.ts`; `PictureDrawing` and
      `sceneSourcePaintStyle` in `paintDiagramStep.ts`), a crease pattern's
      included.
- [x] Tests: a Fold link's flat creases and an Edit link's U lines are not
      drawn, folds and the edge are (`titleBlockContent.test.ts`, the two
      Fold wasm tests); the model's aux line is drawn in its cell and not in
      the block, folded or as a crease pattern (`pagePictures.test.ts`).
- [x] Before and after renders of the report's file. A Fold-made diagram is
      not rendered; the two Fold wasm tests pin the roles it draws.
- [x] `diagram-title-block.md` updated (sections 4, 5 and 8).
- [x] Lint, typecheck, tests; `npm run diagram-corpus` (see the PR).

Part 2:

- [x] F-1 to F-4 answered.
- [x] Types: `DiagramCreasePatternAsset`, the pattern's `upload` source
      (`DiagramTitleBlockPatternSource`); pictures are `DiagramPictureAsset`.
- [x] Reader and writer; `__fixtures__/diagram-title-block-upload.json`
      written back byte for byte; a missing asset, or one of another kind,
      reads as Auto; a newer asset, part or field is carried and shows Auto;
      a model of kind `upload` is a newer build's; a step naming the asset
      reads with no picture (`diagramFileTitleBlockUpload.test.ts`).
- [x] `withReferencedAssets` keeps the named asset through an edit; undo
      restores a replaced upload (checked in the app).
- [x] Every switch on an asset's kind handles the new one (the type split
      made the compiler find them; `stepPictureSource` and `stepAsset` take
      pictures only).
- [x] The file reader (`titleBlockPatternFile.ts`, with the shared
      `engine/loadCpFile.ts` Edit's two dispatches now use too): each
      format, a file with no folds, a file the kernel refuses, a name no
      loader takes. A timeout is the session's, read as unreadable; not
      tested apart.
- [x] The Page pane's entry and the file's name as a choice; the picker
      inside the press — Chromium (the agent's browser pane) and WebKit 26.4
      (Playwright, by pointer and keyboard); both notices, in the app.
- [x] Analytics (`upload`, `title_block_pattern_format`) and
      `docs/analytics.md`.
- [x] i18n extract, 8 locales, stamp, check.
- [x] Contract docs updated (`diagram-workspace.md`, The v1 file).
- [ ] The desktop app's native dialog: not run. It is the call Fold's Import
      CP already makes (`openBinaryFile`, filter "Ori Studio").
