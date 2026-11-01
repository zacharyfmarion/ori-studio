# Spread and layer order in Edit, Export and Share

Decided 2026-10-31; implementation in progress on this branch.

- **Designs:** [canvas](https://claude.ai/artifact/1NKHfnrFj1RkBP64bBYbbo)
  (Edit Properties, Export, Share, and the Export → Layer order flow). Board
  A4 still shows spread disabled under X-ray; X-ray is now supported (below).
- **Research:** seven reports, read at #563's earlier head ad7339db5 and
  origin/main df061128d, in
  [research/2026-10-31-spread-and-layer-order-in-edit-export-share/](../research/2026-10-31-spread-and-layer-order-in-edit-export-share/)
  (kept out of git). This plan cites them by file name. Where this plan and a
  report disagree, the plan wins.
- **Base:** this branch sits on PR #563's head f11ccb7cc
  (`codex/connected-layer-spread`), which has merged main (cd279bbab, so it
  carries the Layer order dialog, #551) and added the shared live spread
  renderer (231a37ce7, f11ccb7cc). **[#563]** below means that tree;
  **[main]** cites from the research that still hold in it. Paths are under
  `apps/web/src/` unless they say otherwise.

## Goal

The owner's three asks:

1. **Spread on Edit's folded figures.** It is saved with the file, and its
   controls live in the Properties sidebar.
2. **Layer order in Export and Share.** The Export crease pattern dialog
   and the Share modal can open the Layer order dialog on their folded
   figure.
3. **Spread in Export and Share.** The same two dialogs can spread their
   folded figure.

What must hold throughout:

- **Byte-identical when unused.** With spread off and the default order,
  files, SVG/PNG exports and share cards stay exactly as they are today.
- **Oriedita's fold is never changed.** Spread presents the kernel's ordered
  paper scene. With spread off, Edit keeps drawing the kernel's render
  snapshot. Spread never enters `FoldedFigureModel`, Oriedita's parity type.
- **Nothing the user set is dropped silently.** That covers older builds,
  failed solves and reopened files.
- **One concept, one control.** The same spread rows (`LayerSpreadRows`) and
  the same Layer order row (pager plus Edit…) appear in the Diagram, Fold,
  Edit, Export and Share, with the same words.

## Decisions

Decided by the owner on 2026-10-31, in his words: "okay yeah, please support
it, go with your other recs, and implmeent". "It" is spread under X-ray; the
"recs" are the recommendations below, and the calls under "My calls".

1. **New Edit figures start with spread Off.** Spread is opt-in per figure:
   Edit's default picture stays Oriedita's drawing, and files that never use
   spread keep their bytes. Turning it on starts from the spread most
   recently set on another figure in the document, else
   `DEFAULT_CONNECTED_SPREAD` (Default 7% since #563's 9f45241ec, reveal
   (0.8, 0.6)).
2. **A reopened spread figure re-spreads a moment after opening.** For spread
   figures only, the figure's paper scene is saved with its spread (a
   reopened flat figure has no live fold, and the spread needs the fold's
   scene: `spread-563.md` §5, `edit-figures.md` §1). On open the solve reruns
   in the background (median ~0.1 s, worst ~3 s on Bodo-size models), with
   the flat picture until then. This works for figures with a chosen layer
   order too, with no refold and no Fold engine at open.
   - **Budget:** above a measured size budget (step C0), the scene is left
     out. The figure then draws flat, with "Refold to show the spread" beside
     the toggle, until it is folded again.
3. **Export and Share's layer order and spread are the export's own.** No undo
   entry and nothing written to the document. A chosen order is kept in
   memory per crease pattern (by source digest) while the app is open, so
   Export and Share reopen on it.
4. **Share links carry the preview card only, this round.** PR D (links that
   carry the figure) is not built. The scope note under Create link says so.
5. **Export and Share spread starts Off the first time, then remembers the
   last choice.** Export and Share share it, as they already share the
   figure's style (`oristudio:crease-pattern-folded-figure`).
6. **Settled by #563 itself.** Its shared live renderer landed (231a37ce7):
   worker bitmaps for Fold's and the Diagram's single-figure panes.
   - Edit's canvas is different: one main-thread WebGL canvas holding many
     figures, panned, zoomed and rotated at frame rate, with screen-sized
     pens. A worker bitmap per figure would blur during camera moves and need
     re-rendering at every zoom.
   - So Edit draws spread through its own renderer's spread pass
     ([#563] `cp-workspace/renderer/reglRenderer.ts:158-459`, which still
     exists), extended to several figures.
   - It shares what the worker renderer shares: `spreadProgram`,
     `spreadGeometry`, the global ordering, `prepareConnected` and
     `spreadService`.
7. **Spread under X-ray is supported** (the owner's "please support it").
   - **Look:** see-through layers, with the face transparency the Layer order
     dialog's X-ray uses (`xrayFaceAlpha` of the stack depth), back to front
     in the spread's global rank order, and lines on top.
   - **Not Oriedita's drawing:** because spread paints through our paper
     painter, an X-ray figure's look changes slightly when spread turns on.
   - **Wireframe:** stays unsupported for now (rows disabled with a reason).

### My calls (decided with the recommendations above)

- **Step aside, don't stack.** While the Layer order dialog is open, the
  Export or Share dialog unmounts and comes back afterwards, settings and
  preview kept and focus on Edit…. This is the approved Import CP precedent
  ([main] `components/fold/import/FoldImportDialog.tsx:100-107`). The Layer
  order dialog is workspace-sized and covers them anyway. Stacking them
  instead would mean moving both dialogs onto `useModalDialog` and mounting
  them before `LayerOrderDialogMount`.
- **Export's "Fold case" becomes the Layer order row**: ‹ 1 of 9+ › Edit….
  It is the same solution stepping, in the standard "solutions" wording. With
  the default order, output stays byte-identical.
- **Edit: Spread is its own section after Pose**, not rows inside Pose.
  Pose's layer-order notice renders after all of Pose's rows
  ([main] `components/properties/PropertySheetView.tsx:157-172`), so spread rows
  there would push it away from its row.
- **Spread draws on Paper and X-ray** (decision 7).
  - Under Wireframe the rows stay in place, disabled, the setting is kept,
    and the reason sits under the toggle.
  - 3D figures and folds with no layer order show the existing reasons.
  - Shadow is disabled while spread is on, because spread pictures carry no
    kernel shadow paint.
- **Head-on (Diagram) presentation only** on Edit, Export and Share. None of
  them has an orbit camera for Perspective 3D, and Fold offers only head-on
  too.
- **Reveal is set only from the pad.** A drag on an Edit figure moves it.
- **The reveal direction is fixed to the page.** It applies after the
  figure's own Rotation and ignores rotating the canvas view, so canvas and
  export agree and a view rotation never re-solves.
- **Save Edit spreads in the crease pattern's `extensions` bag**, as layer
  orders are (D15), so installed older builds carry them instead of dropping
  them. No reader-version bump.
- **The Layer order dialog never shows spread** (D18). When the host's figure
  is spread, it opens with X-ray on (D5), so its stepper walks the orders
  spread can tell apart.
- **The dialog's Rotate turns the export or card figure** for that export,
  as every host takes the turn (H11).
- **The folded-figure sections of Export and Share switch to FieldRows**,
  like the Diagram export and the sidebars. The rest of the Export dialog
  keeps its style. No rules are added to the shared `.export-modal` or
  `.simple-modal` blocks.
- **An over-budget Default spread in an SVG export embeds a 300 dpi bitmap**
  of the figure, as #563's plan requires, and never drops faces. This is rare
  and mostly happens on large cyclic models.
- **No status text.** While a fold, solve or capture runs, previews keep the
  last picture, dimmed with aria-busy. Errors sit beside their control.

## Prerequisites and order of work

1. **Done by #563 itself.** It merged main on its own branch (cd279bbab) and
   fixed S1 and S3 (f11ccb7cc). S2 still looks open; see
   [Findings for #563](#findings-for-563).
2. **Every branch starts from #563's head**, f11ccb7cc, which carries main.
   A small scaffold commit comes first: the figure's `spread`/`spreadScene`
   fields, `foldedFigureSpreadOptions` and `setOristudioCpFoldedFigureSpread`.
   With it in place, the Edit data/UI work and the Edit drawing work can run
   side by side.
3. **PR A: Layer order in Export and Share** — runs alongside the PR C work.
4. **PR C: spread on Edit figures** — its data and Properties work, and its
   drawing work, run side by side and merge.
5. **PR B: spread in Export and Share**, after PR A and PR C. It also makes
   each figure's own Export… write the spread, which needs PR C's figures.
6. **PR D: not built** (decision 4).

**Worktree setup:** #563 adds an npm workspace (`packages/layer-spread`) and
a wasm bridge (`build:oristudio-layer-spread-wasm`). A worktree bootstrapped
from a primary checkout that hasn't built them needs `npm install` plus both
builds before typecheck, tests or the browser mean anything.

## Approach

### 1. Layer order in Export and Share (PR A)

**Pre-work, with no visual change:**

- **Put both dialogs on one preview hook.** `CreaseExportDialog.tsx:151-260`
  still has its own copy of the fold that `useFoldedFigurePreview.ts:54-136`
  was extracted to serve; only Share uses the hook (`share-modal.md` §1).
  Move Export onto the hook first, so the order and the spread are added
  once.
- **Move Share's one-owner global block into `ShareLinkModal.module.css`.**
  That is `.share-link-modal`/`.share-embed` (`styles/theme.css:1000-1197`,
  plus its coarse-pointer copy near :6468).
  - Switch the tests that query `.share-embed__image img`
    (`shareCardFoldAngle.test.tsx:86`, `shareCardGrid.test.tsx:99`) to role
    or data attributes.
  - Lower the ratchet in `styles/globalStylesheets.test.ts`.
  - Prove in the browser that the computed styles match before and after.

**Fold plumbing** (`lib/creaseExportFold.ts`):

- **Expose the source.** `foldSegmentForExport` ([main] :384-414) takes
  main's `CpFoldRuntime` instead of the narrower `CreaseExportFoldRuntime`.
  It reads `runtime.source(handle)` before freeing the handle, and returns
  the source with the picture plus what the pager needs (the current case,
  whether more solutions exist, and whether any layer order was found).
- **Fold with a given order.** A sibling folds with the order:
  `runtime.foldWithOrder(source, relations, model)`, then
  `readFoldedPicture`, then free. It returns a typed refusal that keeps the
  old picture.
- **Share the Diagram's helpers.** Move `stepFoldSource` and
  `foldAppliedOrder` from [main] `diagram/capture/captureLayerOrder.ts:215-252,
  331-346` into a shared module, rather than copying them.
- **Keep the no-order path unchanged** (`fold(1, 'Order5')` + `foldToCase`),
  and pin byte-identical SVG/PNG output with a test.
- **Never call `prepareOristudioCpLayerOrderFold`.** Its CAMV confirmation
  goes through the single-slot command-dialog store, which would cancel the
  open Export (`layer-order-hosts.md` §4).

**The host:**

- **Request builder.** A pure `exportLayerOrderRequest(...)` builds the
  request from:
  - the export's source, and `shown` = the scene the preview shows (D19);
  - `region` from `layerOrderRegionOfLines`;
  - `record`: the last applied record for this crease pattern, or null;
  - `look`:
    - style: the dialog's style with its front and back colours pinned, as
      the inset is painted;
    - policy: `folded-flat`;
    - turnDeg: the export's current turn;
    - side;
    - xray: true when the figure is spread;
    - line pen: Edit's view pen (D18);
  - `name`: the document title or "Pattern N" for Export; for Share, the
    typed title, with the author as byline;
  - `surface`: the new `crease_export` or `share_card`.
- **One hook, `useExportLayerOrder`, beside the dialogs' modules.** It holds:
  - the applied orders `{record, relations, turnDeg}`, keyed by the source
    digest, so Export and Share of the same creases share one order;
  - the `ordering` flag that drives the step-aside;
  - the AbortController;
  - the open and apply verbs.
- **Outcomes.**
  - `applied`: refold with the order, then show the new picture.
  - `unchanged` with a turn: apply the turn only.
  - `cancelled`, `busy` and `unavailable`: change nothing (the gateway
    already shows a toast for unavailable).
- **Later changes keep the order.** Side and colour changes refold with the
  current model through `foldWithOrder`; relations do not depend on the side.
  The preview's cache key gains an order key.
- **The turn.** The export painter has no figure rotation today
  (`lib/creaseExport.ts:561-604`). Add one for the inset and the card.

**Stepping aside** (all verified on [main]):

- **Today the Layer order dialog would sit underneath.** `App.tsx:197` mounts
  `LayerOrderDialogMount` before `ShareLinkModal` (:204) and
  `CommandDialogModal` (:225). All of them sit at `--z-modal` with no
  portals, and the topmost dialog is the last one in the DOM
  (`keyboard/shortcutDispatcher.ts:171-179`).
- **Unmount, don't hide.** `CreaseExportDialog` and `ShareLinkModal` render
  null while `ordering`, after all their hooks, so state and fold cache
  survive. A hidden dialog would still count as topmost.
- **Their Escape listeners stand down while ordering.** Both are window
  capture listeners with no topmost check (`CommandDialogModal.tsx:65-77`,
  `ShareLinkModal.tsx:132-143`).
- **The app keyboard must let the dialog's keys through.** `handleAppKeyDown`
  returns early while a command dialog is open ([main] `lib/appKeyboard.ts`,
  fed by `App.tsx:143`), which would stop ⌘Z reaching the Layer order
  dialog's history. Add an `isLayerOrderDialogOpen()` getter to the gateway
  (the boundary rule allows only the gateway) and skip that return while it
  holds.
- **On return,** focus goes back to Edit….
- **Withdraw through the signal** if the host dialog unmounts or the
  single-slot command store replaces it.

**UI** (canvas boards B, C and D):

- **The row.** One Layer order row component, reusing main's `Pager` and
  `layerOrderCount` wording ("1 of 9+", "None"):
  - ‹ › step through solutions;
  - Edit…;
  - the note "N constraints" or "Chosen order" once an order is applied;
  - D3's reason, "Layer order couldn't be determined for this figure.", when
    the fold found no order.
- **Stepping with a chosen order.** ‹ › step through the solutions that fit
  it, through the host engine's solution cursor, as Edit's row does (H6). If
  that cursor cannot be reused as it is, ‹ › are disabled while an order is
  chosen, with that reason.
- **Export:** the row replaces "Fold case" and its "N found so far" hint. The
  Folded figure section opens when "Include folded figure" is turned on (today
  it opens collapsed, `CreaseExportDialog.tsx:159-165`).
- **Share:** the row sits under the folded rows. Its controls are disabled
  once the link exists, because the card is uploaded once.

### 2. Spread in Export and Share (PR B)

**One settled-picture function for every one-shot spread.**
`settledSpreadPicture(scene, spread, {scale, policy, signal})` returns
`{scene} | {raster, frame} | {flat, reason}`.

- **Where it comes from.** It is extracted from three near-copies:
  `fold/canvas/foldStatePicture.ts:73-96`,
  `diagram/capture/captureFolded.ts:525-546` and
  `store/workspaceStore/diagramCapture.ts:441-460`. Fold cards and the
  Diagram move onto it with no change in behaviour.
- **Raster pens.** The raster worker hard-codes the `fold` paper policy
  (`layer-spread/raster.worker.ts:28`); it gains a policy parameter, so a
  fallback bitmap uses the export's `folded-flat` pens.
- **Timeouts.** A capture that comes back unresolved, on the 12 s timer or a
  budget error (`captureConnected.ts:19, 31`), goes to the raster. It is
  never painted in painter's order.

**Export content and painter** (`lib/creaseExport.ts`):

- `CreaseExportOptions.foldedFigure.spread` holds the setting.
  `CreaseExportContent` carries the resolved scene, or the raster and its
  frame. The artwork builder stays synchronous, so the file is the preview.
- **No doubled faces.** A connected scene is painted with
  `keepHiddenFaces: false`, because its hidden anchor rings would otherwise be
  written twice; today's figure uses `true` at :1221.
- **Keep the figure's size.** The figure is fitted by its flat bounds
  (`layer-spread/spreadFrame.ts`), not its spread bounds (`fitFolded`,
  :1186-1199). Raising Amount must not shrink the figure beside the crease
  pattern.
- **Rasters.** A raster is embedded as `<image>` at its frame.

**Preview behaviour:**

- **Spread is prepared once per fold** (`prepareConnected`, priority 1).
- **Captures run when a gesture commits.** The rows already separate preview
  from commit. During a drag the last settled picture stays up.
- **Colour edits repaint without refolding.** Today both dialogs key the fold
  by colours (`CreaseExportDialog.tsx:221`, `useFoldedFigurePreview.ts:82-92`),
  and with spread a colour change would also re-prepare and recapture. Key
  the fold by geometry (pattern, side, order) and pin colours at paint time.
- **Failures.** A spread that cannot be prepared or solved turns Spread layers
  off, with its reason beside it, so the preview and the file always agree.

**Controls:**

- **The rows.** `LayerSpreadRows` sits after the Layer order row in both
  folded sections, with no Presentation row.
- **Remembered setting.** `oristudio:crease-pattern-folded-figure` grows from
  `{style}` to `{style, spread}`, read through `readLayerSpread`
  (`store/settingsStore.ts:101, 210-214, 707-710`). It is written when an
  export is saved and when a share is published, as the style is
  (`store/workspaceStore/slices/projectSlice.ts:294-296, 3230-3232`).
- **Share's Create link waits** for the fold, order and spread. Its reason
  goes in the footer's existing status slot, so the button never moves.
  Today, Create during "Folding…" publishes a card without the figure.

### 3. Spread on Edit figures (PR C)

**C0, before any code: measure.**
- Paper-scene and resolved-picture sizes for flat figures on the cpoogle set
  (p50/p95/max), to set decision 2's budget.
- Cold solve plus first-frame time on a Bodo-size figure in Edit.

**Data and saving:**

- **In memory.** Each figure entry gets
  `spread?: {kind: 'record', spread} | {kind: 'newer', saved}`, on
  `OristudioCpFoldedFigureEntry` and never on `FoldedFigureModel`.
- **On disk.** It is saved in the crease pattern's
  `extensions["oristudio.foldedFigureSpreads"]`, built like main's layer-order
  bag ([main] `cp-workspace/folded/foldedFigureLayerOrders.ts`):
  - it links by figure key and refold key, so a figure an older build
    refolded is detected rather than mis-attached;
  - it attaches at install and re-keys after save
    ([main] `projectSlice.ts:1255-1266, 1874-1885`);
  - it is composed in `createNativeCreasePatternDocument`
    ([main] `lib/nativeProjectFile.ts:933`);
  - it tells the id allocator which ids it names.
- **The values.** `writeLayerSpread`/`readLayerSpread`
  ([#563] `cp-workspace/folded/layerSpreadSettings.ts:239-285`): a newer
  value is carried back as it came, and a damaged one is dropped.
- **Zero bytes by default.** The key is left out when no figure has a spread.
  Extend main's `layerOrderZeroBytes*.osf` file-snapshot tests.
- **Reopen data** per decision 2. Recommended: the figure's paper scene in the
  same bag entry, under the measured budget.

**Store and undo:**

- **The setter.** `setOristudioCpFoldedFigureSpread(id, next)` selects the
  figure and sets dirty, and returns the same entry on a no-op, because
  history compares figure lists by identity.
- **Discrete and continuous edits.** A React-free
  `setFoldedFigureSpreadAsEntry` in `foldedFigureVerbs.ts` handles the
  toggle, kind, keep and direction. Amount, skew, axis and reveal use the
  pane's continuous protocol (`usePaneGesture`, owners such as
  `pane:spread-amount`), giving one undo entry, "Change layer spread", per
  gesture.
- **Copies.** Duplicate copies the field by hand: it builds an explicit
  literal ([main] `creasePatternSlice.ts:4017-4060`). Refold, Apply layer
  order, Another solution and side flips keep it through `...candidate`.

**Properties sidebar** (canvas board A):

- **A React-free fields module.** `cp-workspace/folded/foldedFigureSpreadFields.ts`
  is built from `layerSpreadControls` and `withSpreadField`. It adds a
  "Spread" section after Pose in `buildFoldedFigureProperties`
  ([main] `foldedFigureProperties.ts:347-357`), bound in
  `useFoldedFigureProperties`.
- **Two new field kinds, added on purpose as `stepper` was** (custom sections
  were rejected, `canvas-object-properties-panel.md:1374-1385`):
  - `reveal`, rendering `LayerRevealControl`, on the continuous protocol;
  - `direction`, the eight-way compass.

  `SliderField` gains `ariaLabel` and `valueText`. Extend PropertySheetView's
  exhaustive switch and its one-field-of-every-kind test.
- **Wording.** It is the Diagram's: "Spread layers", "Spread by" Default |
  Affine | Depth, "Amount", "Layer reveal" with its hint, "Direction", "Keep
  still", "Skew", "Axis". Resets are always present, so nothing shifts while
  a value is edited.
- **Reasons** sit under "Spread layers":
  - "Only a flat folded picture has layers to spread" (3D);
  - "This fold has no layer order, so it has no layers to spread";
  - new: "Only the Paper and X-ray looks can spread their layers"
    (Wireframe);
  - new: "These layers couldn't be spread" (a failed or over-limit solve);
  - for a reopened figure saved without its scene (over budget): "Refold to
    show the spread".

  Shadow gets the new reason "Spread layers draw without shadows". There is
  no "Preparing…" text anywhere.

**Drawing on Edit's canvas:**

- **The scene.** A new hook, `useFoldedFlatSpread`, sits beside
  `useFoldedFlatAux`. It fetches kernel paper scenes for spread figures
  through the existing `foldedFlatScenes` table; today the fetch happens only
  while aux creases show. It holds one `prepareConnected` lease per figure:
  priority 1 for the selected or visible figure, 0 for the rest. Generation
  checks ensure a late solve never lands on a superseded fold (undo, refold,
  side flip, document swap).
- **The frame adapter.** Kernel coordinates go through `cpModelToSvg`, then
  the figure's rotation. Offset and scale apply afterwards as a cheap
  post-transform, so moves and resizes never re-project.
- **The renderer.** #563's spread pass holds one spread geometry, uses the
  whole depth range and, on cyclic stacks, clears the global depth buffer
  ([#563] `renderer/programs/spreadProgram.ts:46, 256-260`). That breaks
  Edit's per-figure depth bands, so it needs per-figure entries:
  - a band base and span;
  - the figure's transform;
  - an opacity, for stale figures;
  - a band-safe replacement for the depth clear;
  - no re-upload when the geometry is unchanged.

  `cpFoldedToScene` skips a spread figure's snapshot fills, strokes and aux
  overlay (decision 6 explains why Edit keeps this main-thread pass rather
  than the worker bitmaps).
- **X-ray** (decision 7). `spreadProgram` gains a see-through option, off by
  default, so Fold's and the Diagram's pictures stay unchanged:
  - fills take `xrayFaceAlpha` of the stack depth, are drawn back to front in
    the global rank order, and write no depth;
  - ink is drawn over all of them.

  A figure in Transparent3 with spread on draws that way, from its paper
  scene.
- **Chrome.** The pivot stays at the flat picture's centre. The box, the
  floating toolbar anchor, Fit and the hit area grow to the spread picture
  once an edit settles.
- **Fallback.** Until the solve lands, or if it fails, the figure draws its
  snapshot as today.
- **The figure's own Export…** exports the spread as drawn, through the
  settled-picture function. Today's flat target builds an unspread scene
  (`cp-workspace/folded/foldedFigureExportTarget.ts:150-165`).

### 4. Share links that carry the figure (PR D, only if decision 4 says so)

- **Encoding.** One ancillary codec tag, 0x0007 (the URL-compression registry
  reserves 0x0006), carries `{startingFace, side, turnDeg, record, spread}`
  as UTF-8 JSON, appended without re-encoding the crease block. Old decoders
  skip it. The RAW fallback cannot carry it, so such a link goes without the
  figure and says so.
- **Fold what the link carries.** The card and the dialog's source are folded
  from the decoded payload rather than the live sheet, because import
  rescales the sheet, the codec quantizes and creases come back in canonical
  order, so face ids can differ (`share-modal.md` §3).
- **The receiving side.** It creates one Edit figure, lazily: a CP fold; then,
  with a record, the Fold engine's restore and `fold_with_order`; then the
  spread. Every failure leaves the pattern open with the default order.
  `load_share` reports skipped extensions, so a later build can say what it
  couldn't load.
- **Size check.** The client checks the size before posting and names the
  cause ("too large with this layer order"), with "Create without the layer
  order" as a way out.

### 5. Analytics, i18n, styling

- **Analytics** go through `analytics/` only, with enums and buckets:
  - `crease_export` and `share_card` join the Layer order dialog's `surface`
    enum, which exists in two copies ([main] `lib/layerOrder/layerOrderRequest.ts:108`,
    `analytics/trackLayerOrder.ts:26`);
  - `crease pattern exported` and `crease pattern shared` gain
    `folded_figure_layer_order: default|chosen` and
    `folded_figure_spread: none|connected|affine|depth`, optionally with
    `spread_render: vector|raster`;
  - Edit's rows report `canvas object property changed` automatically, with
    no duplicate event;
  - update `docs/analytics.md`.
- **Fix #563's bucket for Default spread first.** Its amount is a 0–2
  multiplier, so `spreadProperties` reports the default 0.5 as 50%, in the top
  bucket (`>12.5`), every time (verified, [#563] `analytics/events.ts:473`,
  `analytics/trackDiagram.ts:267-273`). It needs its own ladder before
  anything new reuses it.
- **i18n.** Reuse the `panels:diagram.pose.*`, `panels:diagram.spread.*` and
  `panels:cpProperties.folded.layerOrder*` keys. New strings go through
  `t()` in all nine locales, then `i18n:stamp` and `i18n:check`. The locale
  hash file conflicts on every rebase; regenerate it, never hand-merge it.
- **Styling.** `simple-modal` and `export-modal` are shared blocks and gain
  no rules. The new rows are FieldRow-family module components placed by
  each dialog. Share's block moves to a module in the pre-work commit.

### 6. Validation

- **Every PR:** lint and typecheck on the touched files, focused vitest, and
  one browser check with before/after pictures. Rebuild the CP and
  layer-spread wasm before trusting the browser.
- **PR A:**
  - unit tests for the request builder and for every outcome;
  - step-aside tests: one Escape closes only the Layer order dialog, ⌘Z
    reaches its history while Export is pending, focus returns to Edit…,
    and the ask is withdrawn on unmount;
  - byte-identical SVG/PNG with the default order;
  - the share card drawn in the chosen order;
  - a check that opening Export or Share spawns no worker until Edit… is
    pressed.
- **PR B:**
  - painter tests: connected scenes have no doubled faces, the figure fits by
    its flat bounds, rasters embed;
  - the raster fallback with its policy;
  - the remembered-setting reader;
  - SVG and PNG of each spread kind on a mid-size cpoogle model, in a
    browser.
- **PR C:**
  - file round trip, zero bytes, a newer value carried, damage dropped, and
    an older-reader simulation;
  - Duplicate, refold and undo keep the spread;
  - the new field kinds;
  - two overlapping figures, one spread, in a browser;
  - a Bodo-size figure: a cold solve does not block, and a spread change
    costs about 20 ms.

## Affected Areas

- **PR A:**
  - `components/CreaseExportDialog.tsx`, `components/CommandDialogModal.tsx`,
    `store/commandDialogStore.ts`;
  - `cp-workspace/share/ShareLinkModal.tsx` (+ a new module CSS);
  - `cp-workspace/folded/useFoldedFigurePreview.ts`, `lib/creaseExportFold.ts`,
    `lib/creaseExport.ts` (figure turn);
  - `store/workspaceStore/slices/projectSlice.ts` (foldSegment injection);
  - a new `use*` hook and a request builder beside them;
  - [main] `layer-order/dialog/layerOrderDialogGateway.ts` (a getter);
  - `App.tsx` (the keyboard gate);
  - `lib/layerOrder/layerOrderRequest.ts` and `analytics/trackLayerOrder.ts`
    (surfaces);
  - the shared `captureLayerOrder` helpers;
  - `styles/theme.css` and `styles/globalStylesheets.test.ts` (the move);
  - locales and docs.
- **PR B:**
  - `layer-spread/` (settled picture, raster worker policy);
  - `fold/canvas/foldStatePicture.ts`, `diagram/capture/captureFolded.ts`,
    `store/workspaceStore/diagramCapture.ts` (adopt the shared function);
  - `lib/creaseExport.ts` (content, painter, fit);
  - both dialogs and the preview hook;
  - `store/settingsStore.ts`, `lib/storage.ts`;
  - `analytics/` (events, buckets);
  - locales and docs.
- **PR C:**
  - `engine/oristudioCpTypes.ts`;
  - `store/workspaceStore/slices/creasePatternSlice.ts`, `projectSlice.ts`;
  - `lib/nativeProjectFile.ts` and a new `cp-workspace/folded/foldedFigureSpreads.ts`;
  - `cp-workspace/folded/foldedFigureVerbs.ts`, `foldedFigureProperties.ts`,
    a new `foldedFigureSpreadFields.ts`, `useFoldedFigureProperties.ts`;
  - `lib/propertyDescriptors.ts`, `PropertySheetView.tsx` (new kinds);
  - `components/paper/LayerSpreadRows.tsx` and `LayerRevealControl.tsx`
    (reused, possibly given props);
  - a new `cp-workspace/folded/useFoldedFlatSpread.ts`,
    `cp-workspace/adapters/cpFoldedToScene.ts`, `CreasePatternWebglCanvas.tsx`
    (wiring only);
  - `cp-workspace/renderer/programs/spreadProgram.ts`, `renderer/reglRenderer.ts`;
  - `cp-workspace/folded/foldedFigureExportTarget.ts`;
  - locales.
- **PR D:**
  - `crates/oristudio-cp/src/share/*` (tag, accessor, skipped count) and the
    CP wasm bridge;
  - `cp-workspace/share/*`, `creasePatternSlice.ts` (receiver);
  - the codec freeze tests.

## Checklist

- [x] Research: seven reports (spread engine, Edit figures, Export, Share,
  Layer order hosts, #563 × #551, screens and tokens).
- [x] First-look designs on the canvas.
- [x] Owner answers decisions 1–6 and reviews "My calls" (2026-10-31: X-ray
  added as decision 7).
- [x] #563 merges main (cd279bbab) and fixes S1 and S3 (f11ccb7cc); S2 left
  to #563.
- [x] Scaffold commit: `spread`/`spreadScene` fields,
  `foldedFigureSpreadOptions`, `setOristudioCpFoldedFigureSpread`.
- [x] PR A pre-work: Export on `useFoldedFigurePreview`; Share's CSS moves
  to a module (no visual change, computed styles checked).
- [x] PR A: fold plumbing (source, `foldWithOrder`, shared helpers),
  byte-identity test.
- [x] PR A: request builder, `useExportLayerOrder`, outcomes, figure turn.
- [x] PR A: step-aside (unmount, Escape, keyboard gate, focus, withdraw)
  with tests.
- [x] PR A: Layer order row in both dialogs; Fold case replaced; section opens
  on toggle; analytics surfaces; i18n.
- [x] PR B: `settledSpreadPicture` extracted and adopted by Fold and the
  Diagram; raster policy parameter.
- [x] PR B: export content and painter (hidden rings, flat-bounds fit,
  raster embed); colour edits repaint only.
- [x] PR B: spread rows in both dialogs; remembered `{style, spread}`; Share
  waits before Create; X-ray when spread; analytics and buckets; i18n.
- [x] PR C0: size and timing measurements; budget for decision 2 (see
  [What the work found](#what-the-work-found)).
- [x] PR C: data and bag storage, zero-bytes and round-trip tests, Duplicate.
- [x] PR C: setter, verbs, gestures, undo label.
- [x] PR C: `reveal` and `direction` field kinds; the Spread section and its
  reasons; Shadow reason.
- [x] PR C: `useFoldedFlatSpread`, frame adapter, per-figure renderer
  entries, box and pivot rules, fallback.
- [x] PR C: X-ray see-through spread (`spreadProgram` option).
- [x] PR C: reopen per decision 2 (saved scene under a budget).
- [x] PR B: each figure's own Export… writes the spread.
- [x] Final check on the merged branch: full web suite, typecheck, lint, and
  a browser pass through the real controls (see below).
- [x] Owner's first test pass: four reports, each answered (see
  [Review fixes](#review-fixes-2026-11-01-on-draft-pr-568)).
- [x] #563's precision fix and seven percent default merged in (3ff03854e),
  then main once #563 merged (97febe4c2).
- [x] Pre-merge review: twelve confirmed findings, each fixed with a test that
  fails without it (see [Pre-merge review](#pre-merge-review-2026-11-01)).
- PR D: not built (decision 4).

## What the work found

Recorded as each part landed, for whoever picks the work up next.

- **C0, saved-scene size** (54 cpoogle designs, every 9th of 484, each folded
  whole): the paper scene as compact JSON is p50 103 KB, p95 539 KB, max
  3.42 MB. The budget is 2 MiB, the Diagram's precedent; 1 of the 54 is over
  it. A save reads each live spread figure's scene from the kernel (p50 1 ms,
  max 64 ms).
- **C0, Edit solve timing** (headless Chromium, software GL): a cold Default
  solve on an 842-face design took 2.9 s and the canvas kept drawing
  (p95 frame gap 9.9 ms). A spread change costs about 10 ms to build; the
  buffer upload dominates on software GL.
- **Deviations from the design:**
  - Edit's *Spread by* is stacked (label above, choices across). At Edit's
    260 px pane the Diagram's side-by-side row cut the labels to "Def…".
  - The *Spread layers* switch stays live when the canvas could not spread
    a figure ("These layers couldn’t be spread"), so it can be turned off.
  - One reason string beyond the design: a spread saved by a newer build.
  - Edit's sheet shows the "About affine spreading" credit beside Spread by
    while Affine is chosen, through a descriptor part of its own
    (`SegmentedField.credit: 'affine-spread'`) and an `aside` slot on
    `FieldRow`, `SegmentedRow` and `StackedRow`.
- **One predicate.** Whether a figure can draw its spread is the Properties
  sheet's `foldedFigureSpreadBlock`; the canvas's `foldedFigureSpreadDrawable`
  derives from it, so the two never disagree.
- **Known limits of Edit's spread drawing:** a faded (stale) figure with a
  cyclic stack blends approximately; a see-through spread figure behind a
  translucent plain figure is hidden by it rather than showing through; the
  selection box grows symmetrically about the pivot, so it is looser than the
  spread on turned figures.
- **PR B, beyond the design:**
  - A Default spread's bitmap is sized in the inch the figure's pens are
    drawn in, for the pattern's drawn height, so its pens match the vector's
    (about 2.2 bitmap px per SVG px). A PNG exported above about 2x scales
    the bitmap up; a sharper one needs the raster worker to take a pen scale.
  - `settledSpreadPicture` also takes the host's own solve (`prepared`), so
    one prepare serves every capture, and a bitmap size that depends on the
    scene drawn.
  - Whether a dialog's figure can spread is true, false, or null while no
    fold has landed; while null the rows say nothing against it.
  - `LayerSpreadToggle` gained a `note` (the reason under Spread layers), and
    `useExportLayerOrder` exposes `busy`, which Share's wait reads. Share
    reports what its card drew (`foldedFigureSpreadDrawn`), not what was
    asked.
  - No CSS changed: `.simple-modal` and `.export-modal` gained no rules.
- **Known limits of spread in Export and Share:**
  - A large Default spread can take about 10 s to capture
    (alice-margatroid: 9.8 s, vector). The preview stays dimmed meanwhile,
    and Share's Create waits.
  - Export's save does not wait for a capture: it writes the dimmed picture
    on show, as it already writes the last fold while one is folding.
  - Some designs do not solve (honeybee, xenomorph, cockroach); Spread layers
    turns itself off with "These layers couldn’t be spread", and the file is
    the flat figure, as the preview is. Still so after #563's precision fix
    (re-checked 2026-11-01, Export's own toggle, SVG and PNG).
  - The remembered `{style, spread}` is shared, so a share overwrites the
    export's, as the style already does.
  - The drag in progress lives in one module-level object, which assumes one
    Export or Share dialog at a time.
  - A fold that lands without a paper scene still refolds on a colour edit:
    its colours are in its drawing.
- **Final check (2026-10-31, on d7cce891c; the one-predicate cleanup after
  it, a258ee4c0, re-ran its tests, typecheck and lint):** the full web suite
  (1402 files, 18043 tests), typecheck and the full lint pass. A browser pass
  through the real controls, on kabuto and on cpoogle camel (298 creases),
  light and dark: Spread layers on from Properties, Amount by keyboard, the
  Affine credit, X-ray keeps the spread, Wireframe says why and draws flat;
  saved, the file carries the bag, and reopened (no fold) the figure draws
  its spread from the saved scene. Export: the Layer order row and Spread
  layers rows, Edit… steps the dialog aside and opens the Layer order dialog
  on X-ray, closing it returns focus to Edit… with the spread still on, the
  written SVG equals the preview, and the next Export opens on the
  remembered spread. Share: Create link waits ("Create link waits for the
  folded figure to be drawn.") until the card is drawn, then opens on the
  remembered spread. No console errors.

## Findings for #563

These are for #563's own merge with main, found while reading both trees
(`merge-interplay.md` §1). S1–S3 were spot-checked in code on 2026-10-31.

**Status at f11ccb7cc (checked the same day):**
- S1 is fixed: `captureInLayerOrder` awaits `captureFlatPicture` with the
  presentation.
- S3 is fixed: `prepareConnected` passes `heldLayerOrderOf(linked)`.
- S2 still re-poses without `presentation` (`linkedPose.ts:290-296`).

The findings as first reported:

- **S1. Steps with a layer-order record lose Default spread.** Main's
  `captureInLayerOrder` paints with the synchronous `flatPicture`
  ([main] `diagram/capture/captureFolded.ts:634`). Without a prepared solve,
  that returns the flat scene ([#563] `foldedFlatScene.ts:143-147`). So
  Apply, Refresh, Refresh All, Show as and Duplicate on a constrained step
  save a flat picture under a Default spread. It should await #563's
  `captureFlatPicture` with the presentation.
- **S2. Perspective is lost on Apply and on constrained ‹ ›.** The
  `layer-order` Pose verb re-poses without `presentation`
  ([main] `diagram/capture/linkedPose.ts:284-290`).
- **S3. The live Pose view ignores the record.** #563's `prepareConnected()`
  folds without the step's record ([#563] `poseController.ts:637`). That
  releases main's record-ordered hold and draws the kernel's own order.
- **S4 (minor).** Main's `commitStepLayerOrder` lacks #563's
  `guard.current` check.
- **Tests.** Neither side tests a record together with Default spread, so
  both suites can pass with all of the above.
- **FoldPane.** Its conflict cannot be resolved inside FoldPane, because main
  moved the pane into the shared `PaperPane`. It needs an optional pointer
  interceptor prop on `PaperPane`, a no-op by default.
- **Warm-up (verified).** #563's layer-spread wasm and workers are not in
  `UNWARMED_PATTERNS` ([#563] `apps/web/vite.config.ts:144-150`), so every
  visitor downloads them at install. That may be intended now that Default
  spread is the default; it is worth a deliberate call.
- **Analytics (verified).** The Default-spread amount bucket saturates (§5).

## Smaller observations

- **Three counts for one kabuto figure.** Edit's row reads "1 of 1+", the
  Layer order dialog "9 solutions · 4 of 9", and Export "1 found so far".
  Seen in the screenshots, not investigated; the Layer order row in Export
  and Share would inherit Edit's count.
- **Share layout.** Share's Style picker overflows its 296px column (screen
  D), and the modal has no layout below 720px.
- **Share during folding.** Create link while the figure is still folding
  published a card without it. Fixed in PR B: Create waits for the fold, the
  order and the spread, and says so in the footer.
- **Export's column overflows.** Its controls column shows 536px at
  1440x900 and 431px at 980x655. With the folded figure and Default spread
  rows, its content is 1222px (the folded section 545px, the spread rows
  319px), so the reveal pad lands below the fold and the column scrolls (it
  already scrolls today; canvas board B). Making the dialog taller is a
  change to the shared `.export-modal` block, so it needs the owner's call
  and its own PR.

## Review fixes (2026-11-01, on draft PR #568)

Zach's first pass through the built branch, and what each report came to.

- **Amount moved under its own drag.** It stepped in half percents and read
  out "47.5%", and the slider takes the room its readout leaves, so the
  slider moved and the value under the pointer with it. Amount is in whole
  percents everywhere now (`spreadAmountSlider`, one helper for Edit's sheet
  and the shared rows; Depth and Affine start at 1%, not 0.5%), and a slider
  row's readout keeps the width of its widest end (`SliderRow`).
- **The PNG's figure lines were rough.** A Default spread's 300 dpi bitmap is
  shrunk about 2.2 times onto the page, and the SVG renderer shrinks an
  embedded bitmap with a cheap filter, which zippered the pens; the share
  card, smaller again, was worse. A page with a bitmap is drawn at twice the
  larger of its place and its own size, then shrunk by halves
  (`drawSvgPage`). One large high-quality shrink is not enough: it left the
  card's pens stair-stepped.
- **Adding a crease pattern dropped a figure's spread until reselected.** An
  import that adds aux lines refetches each figure's scene; the canvas asked
  the leases by scene in the render before `sync` saw the new one. They
  answer by fold now (`spreadFold`).
- **"These layers couldn't be spread" after a layer order edit.** Not
  reproduced as an Edit bug: on 9 designs a constraint applied through the
  dialog re-solved on the chosen order and drew (fox, shoebill, lizard among
  them). Every note seen came from the solver refusing the pose, the check at
  `crates/oristudio-layer-spread/src/qp.rs:264` (mai-22-5: "relative warp
  0.0038, slope 0.3553"; panda: "0.0129, 0.4002"), and both refused the
  default order too. The heights are scaled to a slope of 0.349 in f64, cast
  to f32, then checked against 0.351; f32 rounding on sliver faces tipping it
  over is a guess, not shown. The note does not say which reason it was
  (`foldedFlatSpreadLeases.ts` keeps only `unavailable`).
  **Cured by #563's d681aae81**, merged here in 3ff03854e: the heights stay
  f64 through that check, and sliver triangles are repaired. Re-run through
  the dialog, panda and mai-22-5 now spread in the default order and in the
  constrained one (panda ready in 107 ms, mai-22-5 in 754 ms).

## Pre-merge review (2026-11-01)

Four reviewers (Edit's model, Edit's drawing, Export and Share, UI and
analytics), each finding then checked by another agent trying to refute it.
Twelve held, two of them one bug seen from both sides; each is fixed in a
commit of its own with a test that fails without it, and each fix was
checked the same way.

- **Export and Share preview** (`useFoldedFigurePreview`):
  - the blocker: after picking another pattern, its fold used the order chosen
    for the previous one. Each pattern keeps its own source now (25bf8a8c2);
  - a refused order with no picture on show drew nothing: it draws the
    kernel's own order (ece709a9a); and it keeps the picture on show only at
    the pattern, side and case that picture was folded at, so switching Side
    no longer leaves the other side's figure on show and in the file
    (ec7ca7c89);
  - a cache hit that replaced a running fold left `folding` on, so Share's
    Create link stayed disabled (442c61177);
  - while a newly picked pattern folds, the dimmed figure it replaces keeps
    its own turn (370f4b17a);
  - the preview keeps its twelve newest folds; the Share modal's lasted the
    session and grew with every edited re-share (cddd02922).
- **Share:** the Layer order ‹ › stand still once the link is made
  (d491cc0cc); a re-shared sheet folds again after its creases change
  (ec0b6db12) or anything else in its document does, such as an aux line,
  which the shared creases do not show (e2eeeea96); Spread by and Layer order
  stand over their controls rather than overflowing the label (86bcdf2bb).
- **Edit:**
  - a write of a figure's colours (a pin, the paper-style mirror, the model
    reconcile every undo runs) dropped its spread to flat and solved it
    again; the solve is held by the paper scene the snapshot shows now
    (369607295, its key typed in 11ef81ec2);
  - after an undo of Another solution the handle shows the later order:
    the canvas takes no scene from it (7e5881caf), the save writes none
    (db2cb25e2), and the figure's own Export draws it as the canvas does
    (577fe044d);
  - the spread pictures' cache lets go of a figure that no longer draws
    spread (2a9155e8d).
- **Drawing and export:** X-ray with Affine or Depth draws every layer's
  lines over the fills, not just the top one's (71aee56ef); a figure's
  export bitmap that fails is forgotten, so asking again draws it
  (f6285f99d).
- **Known limit found on the way:** a chosen layer order folds the source it
  was chosen on (`foldSegmentInOrderForExport`), aux lines included, so an
  aux line drawn after the choice is missing from that order's figure until
  the order is chosen again.
