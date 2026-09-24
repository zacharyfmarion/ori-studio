# Paper export dialog

## Goal

Three changes that belong together, because each decides where the paper style
applies and what an export looks like:

1. **An export dialog for paper surfaces.** Every image export of a paper
   surface — the Simulate view, an inline simulation window, a folded figure
   (3D and flat), a References step or candidate — opens one dialog before
   anything is saved: a live preview of the exact file, beside the options that
   shape it (format, style, size, margin, background, PNG resolution, hidden
   faces). What Export saves is byte for byte the page the preview showed.
   References can export every step at once, into one ZIP (§7).
2. **A flat crease pattern has one fixed look outside References.** The pattern
   rails, the crease-pattern export and its share card draw a pattern as main
   does: solid lines in the canvas's own colours. References is the exception —
   it draws the pattern as a diagram step, in the paper style. The paper style
   reaches a flat pattern only through a folded figure drawn beside it, whose
   style is picked in that dialog.
3. **Ink by ground in References.** A mark that can leave the paper — an arrow,
   the turn-over glyph, a ring — draws in the style's ink on the paper and in an
   ink that reads against the ground off it, so a dark theme no longer swallows
   it.

Settings ▸ Paper keeps its Display and Export slots as they are. One change
inside it: each pen's sample is drawn on both sides of the paper (§6). And a
simulation draws every line at its own pen's width, so the simulator's own
"Fold line weight" goes (§8).

Out of scope: a size or resolution option for the crease-pattern export (it
keeps its own renderer and fixed 1024 page), a multi-step diagram document
(one file laying the steps out together), batch export anywhere but References,
copy to clipboard, and a "frame" crop of the viewport.

## Findings

All anchors are to this branch at c14dce615. Paths are under `apps/web/src/`
unless they say otherwise. "The older plan" is
`implementation-plans/unified-paper-style-and-export.md`.

**E1. Five paper surfaces save straight to a file.** A format dropdown goes
directly to the save dialog (desktop) or a download (web), with no preview:

| Surface | Trigger today | Handler |
| --- | --- | --- |
| Simulate view | toolbar dropdown "Export view" ▸ SVG image / PNG image (`simulator/SimulatorExportMenu.tsx:32`, mounted `components/panels/SimulatorPanel.tsx:580`) | `useSimulatorViewExport` → worker `exportSvg` → `saveSimulatorView` |
| Inline simulation | the same dropdown in the window's inspector (`cp-workspace/InlineSimulationInspector.tsx:106`) | `exportInlineSimulation` → the same hook, with the window's `appearance` pins |
| Folded figure, 3D and flat | "Export…" choice submenu ▸ SVG image / PNG image, on the figure toolbar and context menu (`cp-workspace/folded/foldedFigureActions.ts:661-684`) | `projectSlice.exportOristudioCpFoldedFigure` (`store/workspaceStore/slices/projectSlice.ts:3136`) |
| References step / candidate | toolbar dropdown "Export step" (`cp-workspace/references/ReferencesViewportToolbar.tsx:155-173`), context menu (`cp-workspace/references/referencesContextMenu.ts:24`), bindable shortcuts `references.exportStepSvg` / `…Png` with no default chord (`keyboard/shortcuts.ts:66-67`) | `useReferencesStepExport` → `referencesStepExportPage` → `saveReferencesStep` |

Each resolves `exportPaperStyle(paperStyle, pins)` and
`paperPageOf(settingsStore.paperExport)` itself, and three of them fire
`paper exported` from three places (`simulator/useSimulatorViewExport.ts:73`,
`projectSlice.ts:3199` as a string literal,
`cp-workspace/references/useReferencesStepExport.ts:90`).

**E2. The options live somewhere else.** Settings ▸ Paper ▸ Export page edits
all five page fields (`components/settings/PaperExportPageSection.tsx`, through
`hooks/usePaperExportPage.ts`); the Simulate pane's Export group mirrors three
of them (`components/panels/SimulatorViewControlsPanel.tsx:183-243` — no
margin, no dpi). Both write the persisted value live. There is no way to pick a
style for one export: it is the Settings export slot or nothing.

**E3. "As shown" is the current zoom, invisibly.** The default sheet size is
the sheet's on-screen size (D3 of the older plan); for a folded figure that is
the CP canvas zoom (`foldedFigureCssPerUserUnit`, `projectSlice.ts:272-275`),
for References the big view's sheet. The same export at two zoom levels makes
two page sizes, and nothing says so.

**E4. The simulator exports whatever the solver holds at that instant.** The
worker's `exportSvg` reads positions at call time
(`simulator/simulatorSession.ts:1291-1341`), so a preview that repaints after
the solver moved would show a different fold. A preview needs the picture
frozen when the dialog opens.

**E5. What a scene bakes in.** A scene carries geometry and roles, no ink —
except each face's `shade` (the style's light) and the hidden test's ink
allowance (the widest pen): `meshToPaperScene`'s `lighting`/`lightDir`/
`lineWidth`, the 3D figure's `folded3dSceneStyleKey`
(`cp-workspace/folded/folded3dScene.ts:153-157`). The References producer also
inlines the style's colours, and the page's background as the letters' halo
(`cp-workspace/references/referencesStepExport.ts:100`), into its markup. So
most page options only repaint; a style change may rebuild the scene; the flat
producer never needs to. `markHidden` is skipped when hidden faces are kept,
because the hidden test is "the expensive half of building the scene"
(`simulatorSession.ts:1330-1332`).

**E6. The crease-pattern dialog is a command dialog.** `CreaseExportDialog`
(`components/CreaseExportDialog.tsx`, 735 lines) is hosted by
`CommandDialogModal`, whose store keeps one dialog at a time: a new request
resolves the current one with its fallback (`store/commandDialogStore.ts:148-152`).
A prompt raised from inside it — `usePaperSettings.choosePreset`'s unsaved-
changes question, say — would silently cancel the export. Its own rule is the
right one to keep: *the preview is the contract* (the saved file reuses what the
preview resolved).

**E7. There is no modal primitive.** Every modal hand-builds `.simple-modal`
markup (`components/CommandDialogModal.tsx:57-92`), with no focus trap, no
initial focus and no focus return, and closes on Escape from a capture-phase
`keydown` listener on `window`. That runs before Radix's own Escape handling (a
capture listener on `document`, which calls `preventDefault` when it closes a
Select) and before `NumberField`'s revert (which does not), so Escape inside an
option closes the whole dialog — read from the code, not reproduced.

**E8. PNG has no size guard.** `lib/svgToPng.ts` makes a canvas of whatever
size it is asked for. A 1000 mm sheet at 600 dpi asks for about 23 600 px a
side, which browsers refuse; today that surfaces as "Failed to encode export
PNG" after the save dialog.

**E9. One folded-figure path ignores the style and the page.** A figure with
no live kernel scene (reopened and not refolded, `Wire2`/`None0` display, or
unsolved) exports its stored render snapshot at a fixed 1024 px through its
own palette (`projectSlice.ts:3211+`, `cp-workspace/folded/foldedFigureExport.ts`).

**E10. The crease-pattern export already reads the paper export settings.**
Its folded-figure inset, in the export dialog and in the share card, paints
with the Settings export style and `paperExport.keepHiddenFaces`
(`hooks/useCreaseExportPaper.ts`, used by `components/CreaseExportDialog.tsx`
and `cp-workspace/share/ShareLinkModal.tsx`).

**E11. Where the export options live today.** One JSON value in browser
storage, `oristudio:paper-export`, through `lib/storage.ts`
(`store/settingsStore.ts:77, 146-152, 484-490`): a `PaperExportSettings` —
the page plus `pngDpi` (`lib/paperExportSettings.ts`) — read at startup
through a normaliser that defaults any malformed field, and written on every
change. It is per device and browser profile (the desktop app's webview has its
own), and never part of the `.osf`.

**E12. References inks assume a light ground.** Every References colour is a
`--fold-*` token, which the style re-sets on the workspace root (D12 of the
older plan). Arrows and their heads (`.step-diagram__line--arrow`,
`.step-diagram__arrowhead` in `styles/theme.css`, and the canvas's `arrow` line
style in `cp-workspace/references/diagram/diagramColors.ts`) draw in
`--fold-border`, which becomes the style's edge ink — black in both built-in
presets. On main that token was the theme's, light in the dark theme, and
nothing lay under the diagram but the theme's ground. This branch fills the
sheet with the paper colour (D13), so an arrow that arcs off the sheet is black
on the paper and black on a near-black ground. Mark rings
(`.step-diagram__point`) and the turn-over glyph (whose head is an
`.step-diagram__arrowhead`) draw the same way. Letters already follow a ground rule
(`labelOnPaper`, e007f9f99). Arcs, heads, the glyph, rings and letters are
drawn by the DOM symbol layer; straight lines, including ReferenceFinder's
arrow-style lines, by the GPU (`diagram/diagramToScene.ts`).

**E13. The arrow pen's colour reaches the export and not the screen.** The
screen draws arrows in `--fold-border`, the edge pen's colour; the export draws
them in `arrows.color` (`cp-workspace/references/diagramToPaperScene.ts:157`).
They agree only because both built-in presets give edges and arrows one ink.

**E14. The pattern rails draw in the paper style.** Phase 10 of the older plan
made both rails' thumbnails (`cp-workspace/sheets/sheetThumbnailInk.ts` and
`useSheetThumbnailInk.ts`, for `cp-workspace/sheets/SheetGrid.tsx`,
`cp-workspace/references/ReferencesSheetsSidebar.tsx` and
`components/panels/SimulatorSegmentsPanel.tsx`) take the display style through
the References policy: paper fill, pens with their dashes, erode. Since Phase 13
gave Default dashed folds, a thumbnail is a field of dots and dashes. Main drew
them solid in the theme's inks (`.sheet-card__stroke--*`: border
`--text-tertiary` at 1.6, mountain, valley and other `--fold-*` at 1.1,
non-scaling), on the rail's own tile.

**E15. The folded figure beside a crease pattern ignores the style's paper.**
The crease-pattern dialog's and the share card's Front and Back fields start
from Oriedita's `#ffff32` / `#e9e9e9` (`DEFAULT_CREASE_EXPORT_FOLDED_FIGURE`,
`lib/creaseExport.ts:132-133`; `ShareLinkModal.tsx:83-84`) and are always
pinned over the style (`creaseExportPaperStyle`, `lib/creaseExport.ts:904-913`),
so the inset shows yellow paper whatever the export style says.

**E16. A pen's sample shows one side of the paper.** Every pen card in
Settings ▸ Paper (edges, mountain and valley folds, aux creases, arrows) draws
its sample line on the paper's front only: the strip's CSS background is the
`ground` prop, `paper.front` (`components/settings/PaperPenCard.tsx:80-96`,
`PaperSettings.tsx:164`). A pen is drawn on both sides — on the back wherever
the paper turns over — so a pen that reads on the front can vanish on the
back, and the card cannot show it. The Lines section's hint also still names
the crease pattern among the surfaces its pens draw
(`dialogs:settings.paper.pensHint`, "Crease pattern, folded figures, steps"),
which stops being true with X10. So do two more strings from the same
commit: the Display slot's hint (`dialogs:settings.paper.slot.displayHint`,
"Crease pattern, simulator, folded figures and steps, on screen.",
`PaperSlotHeader.tsx`) and the aux switch's (`…paper.auxVisibleHint`, "drawn
on every surface", `PaperFoldedCard.tsx`), which the Simulate rail stops
honouring (§4).

**E17. Steps export one at a time, and only from the view.** The References
export verbs (`references.exportStepSvg` / `…Png`) paint the step the big view
shows. Every step's page can be built without showing it — a Sequence's with
`planStepScene(sequence, model, index, …)` (`referencesPlanGeometry.ts:188`),
a Find candidate's with `candidateStepDiagram(raw, step)`
(`referencesCandidateSteps.ts:123`) — but nothing does. The right rail
(`components/panels/ReferencesViewControlsPanel.tsx`: Candidates, Precreasing
sequence) is its own panel and cannot reach the view's verbs: the References
executor is private to `keyboard/shortcutRuntime.ts:104`. The app has no zip
writer of its own; `fflate` is in the tree only as posthog-js's dependency, at
0.4.9.

**E18. "Fold line weight" is the simulator's one line width.** The simulator's
renderer carries a single `creaseWidthPx` for the paper's edge and both kinds
of fold (`packages/origami-simulator/src/webgl/meshRenderer.ts:158`); aux
creases alone have their own (`auxWidthPx`, picked per line by assignment in
the edge shader, `:691`). So `surfacePaperStyle` draws every edge and fold at
the mountain pen's width (`lib/paper/paperStyleResolve.ts:117-143`), and the
Simulate pane's *Fold line weight (pt)* slider writes that width into both fold
pens (`simulator/useSimulatorPaperStyle.ts:149-154`,
`components/panels/SimulatorViewControlsPanel.tsx:171-180`); an inline window's
Properties sheet has the same row, pinned per window
(`cp-workspace/paper/paperStyleFields.ts:155-172`). The edge pen's own width —
the Edges card in Settings ▸ Paper — is never seen in a simulation, and the 3D
figure's window, which draws through the same `RenderSettings`, is held to the
same one width.

## Decisions

Agreed on 2026-09-24 unless marked *proposed*.

- **X1. One dialog, its own host.** `PaperExportModal`, mounted at the app
  root beside Settings, opened through a small UI store — not a command
  dialog (E6), so a prompt raised from it stacks on top instead of cancelling
  it.
- **X2. The preview is the contract.** Export saves the SVG string the preview
  shows, or rasterises that same string; nothing is rebuilt at save time.
- **X3. The picture is frozen when the dialog opens.** Each surface captures
  what it would have exported at that moment (the simulator in a worker-side
  snapshot, E4), and every repaint and rebuild works from that capture.
- **X4. Format is chosen in the dialog.** The per-surface "SVG image / PNG
  image" menus collapse into one verb — *Export view…*, *Export…*, *Export
  step…* — that opens on the format that kind of export last used. The two
  References shortcut ids stay and open the dialog on their own format, so no
  saved binding needs a migration.
- **X5. Style: the export slot, or any preset.** The picker's first entry is
  the Settings export style, labelled with its chip (*Export style · Default*);
  the rest are the presets. Settings ▸ Paper keeps its Display and Export
  slots exactly as they are: the export slot is what the first entry means. An
  object's own pins (a folded figure's or inline window's `appearance`) still
  apply on top, and the dialog names them.
- **X6. Each kind of export remembers its options, when you export.**
  *Proposed.* Three kinds — *simulation* (the Simulate view and inline
  windows), *folded figure* (3D and flat) and *step* (References) — each
  remember what they were last exported with: format, style choice, sheet,
  margin, background, hidden faces and dpi. Saved when a file is written, not
  as they change: once the old editors go (X7) the dialog is their only
  editor, so Cancel can mean nothing happened.
- **X7. One home for the options.** Settings ▸ Paper's Export page section
  and the Simulate pane's Export group are removed; the dialog shows the
  options with their effect.
- **X8. Size is stated, never guessed.** Under the preview: the page in mm,
  and in px for PNG; *As shown* says it follows the current zoom (E3). A PNG
  past the engine's canvas limit disables Export with the reason (E8).
- **X9. Hidden faces is an SVG option, where faces can hide.** It exists so
  that deleting a face in a drawing editor reveals the one beneath; a PNG has
  no faces to delete, so PNG keeps them — the cheaper page (E5) — and the row
  hides. A References step is one sheet with nothing under it, so the row
  never shows there either.
- **X10. A flat crease pattern has one fixed look outside References.** A
  pattern drawn flat is read, not admired, and broken lines read worse than
  solid ones at any size. So the canvas (as today), the pattern rails (E14),
  the crease-pattern export and its share card draw it as main does, in solid
  lines of the canvas's colours. References draws the pattern as a diagram
  step, and keeps the paper style. The paper style reaches a flat pattern only
  through a folded figure drawn beside it (X12).
- **X11. Ink by ground.** A References mark that can leave the paper draws in
  the style's ink where it lies on the paper, and off it in an ink that reads
  against the ground: the theme's on screen, and in a file the page's (a
  transparent page reads as light).
- **X12. The folded figure beside a crease pattern picks its style.**
  *Proposed in detail.* The crease-pattern dialog and the share card get the
  export dialog's style picker for their folded figure. Its paper colours
  start from the picked style (E15); the pick is remembered once for both,
  apart from the folded-figure export's (a figure beside its pattern is a
  different picture from the figure alone, and one dialog's choice must not
  repaint another's — E10's lesson); and the inset always keeps its hidden
  faces.
- **X13. References exports all steps, as a ZIP.** The dialog, opened for a
  References step, gets a *This step | All steps* switch; the right rail gets
  an *Export all steps…* button that opens it on *All steps*. All steps writes
  one file per step, with the dialog's options, into one ZIP to download
  (desktop: to save).
- **X14. A simulation draws every line at its own pen's width.** The *Fold
  line weight* control goes, from the Simulate pane and from an inline
  window's sheet; widths are set where every other surface's are, in the pen
  cards of Settings ▸ Paper. With *Render all creases as edges* on, the folds
  are one kind of line — drawn in the edge pen's colour, dash and cap — at
  the average of the mountain and valley pens' widths. The paper's own edge
  is drawn exactly as the edge pen, its width included, in both modes.

## Approach

### 1. The dialog: what it looks like

Desktop: the crease-pattern dialog's frame (`.simple-modal__document--export`,
`.export-modal` grid) — preview left, options right, footer across.

```
┌ ⤓ Export folded figure ────────────────────────────────────────────────── ✕ ┐
│ ┌────────────────────────────────────────────┐  Format                     │
│ │                                            │  [   SVG   |   PNG   ]      │
│ │      ┌──────────────────────────────┐      │                             │
│ │      │▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚│      │  Style                      │
│ │      │▚▚   the page, exactly as   ▚▚│      │  [ Export style · Default ▾]│
│ │      │▚▚   it will be saved —     ▚▚│      │  Keeps this figure's own    │
│ │      │▚▚   checkered where the    ▚▚│      │  front colour.              │
│ │      │▚▚   page is transparent    ▚▚│      │                             │
│ │      │▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚│      │  Size                       │
│ │      └──────────────────────────────┘      │  Sheet [As shown | Custom]  │
│ │                                            │        [ 150 ] mm           │
│ └────────────────────────────────────────────┘  Margin [   5 ] mm           │
│  142 × 98 mm · 1 072 × 740 px                   Resolution [ 2× · 192 dpi▾] │
│                                                                             │
│                                                 Page                        │
│                                                 Background [■] Transparent  │
│                                                 Keep hidden faces     [●]   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                   [ Cancel ] [ Export PNG ] │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Preview.** The painted page drawn at fit on the pane's ground, with a
  hairline page edge; a transparent page shows a checkerboard inside the page
  only, so the margin is visible. A caption under it states the page: mm
  always, px for PNG, the file size for SVG, and "N hidden faces kept" when
  there are any.
- **Format** — a two-way segmented control. It decides which rows show:
  *Resolution* for PNG, *Keep hidden faces* for SVG on a surface whose
  picture can bury faces (X9).
- **Style** — a Select: *Export style · ⟨chip⟩*, then Default, Diagram and the
  user's presets. The hint line under it names the object's pins, when there
  are any.
- **Size** — *Sheet*: *As shown* (hint: "The size it is on screen at the
  current zoom") or *Custom* with a mm field (the unfolded sheet spans that
  size; lines keep their widths — the existing hint). *Margin* in mm.
  *Resolution* for PNG: 1× (96 dpi), 2× (192 dpi), 3× (288), 4× (384),
  300 dpi, 600 dpi, or Custom with a dpi field.
- **Page** — *Background*: transparent, or a colour (`ColorField` with a clear
  action). *Keep hidden faces*, per X9.
- **Footer** — Cancel, and a primary *Export SVG* / *Export PNG*.

Phone (≤ 620 px, the existing breakpoint): one column — the preview at up to
40 vh, the options scrolling under it, the footer pinned.

States, all inside the preview pane: *Preparing preview…* over the previous
page while a scene builds (the first build runs after the dialog has painted,
so a large simulation never freezes the click that opened it); *Nothing to
export* with the reason (a simulation showing neither faces nor edges); the
error, with Export disabled, if a scene fails; *Too large to export as PNG* in
the caption, with Export disabled, past the canvas limit.

Keyboard and focus: focus starts on the Export button, so Enter exports at the
remembered options in one keystroke; Enter in a field submits; Escape closes
unless a control inside handled it (§2); focus returns to whatever opened the
dialog.

A figure on the legacy snapshot path (E9) opens the same dialog with the
format switch only, the preview of its saved picture, and a hint: refold the
figure to export it with a paper style and page size.

### 2. The dialog: architecture

**The target — one per surface, React-free.** A surface's export verb no
longer saves; it captures its picture into a target and opens the dialog.

```ts
// paperExport/paperExportTarget.ts
interface PaperSceneInput {
  style: PaperStyle;
  markHidden: boolean;
  /** The page's background: the ground for References' letters and off-paper marks (X11). */
  background: Hex | null;
}

interface PaperExportTarget {
  /** The analytics enum and the style policy both: `PAPER_STYLE_POLICIES[surface]`. */
  surface: PaperSurface;
  title: string;                           // "Export step 3"
  fileStem: string;                        // suggested name, no extension
  /** The Settings export style with the object's pins; the picker's first entry. */
  exportStyle: PaperStyle;
  /** The object's own pinned fields, applied over a picked preset too. */
  pins: PaperStyleOverrides | null;
  /** Whether the picture can have buried faces at all — false for a References step (X9). */
  buriesFaces: boolean;
  /**
   * What the picture depends on (E5): the scene is rebuilt only when this
   * changes. '' for a producer that reads nothing of it (the flat figure).
   */
  sceneKey(input: PaperSceneInput): string;
  buildScene(input: PaperSceneInput): Promise<PaperScene | null>;
  /** A picture the page options cannot change (E9); null for every scene target. */
  fixedPicture: { svg: string; widthPx: number; heightPx: number } | null;
  release(): void;                         // drop the worker snapshot / captured model
}
```

Factories live beside their surfaces and capture at creation:

- `cp-workspace/references/referencesExportTarget.ts` — the page diagram,
  camera, mirroring, line width, subject and `referencesShowAuxCreases`, as
  `useReferencesStepExport` reads them today; `buildScene` is
  `diagramToPaperScene` (cheap; its key is the resolved style and the
  background, since the markup inlines both).
- `cp-workspace/folded/foldedFigureExportTarget.ts` — 3D with a live model:
  the render model, camera (`folded3dSceneCamera`) and aux lines captured,
  `buildScene` = `folded3dPaperScene`, key = `folded3dSceneStyleKey` +
  `markHidden`. 3D with only a stored scene: that scene in CSS px, which
  cannot be re-lit — when the picked style's key differs, the hint says the
  figure is shaded as it was last folded. Flat: the kernel scene fetched once
  (`getOristudioCpFoldedFigurePaperScene`), `buildScene` =
  `foldedFlatPaperScene`, key = `markHidden` only. Legacy: `fixedPicture`.
- `simulator/simulatorExportTarget.ts` — a worker-side snapshot (below);
  `buildScene` asks the worker for a scene from it; key = light + widest pen
  + `markHidden`, as `folded3dSceneStyleKey` does for the 3D figure.

**The worker snapshot (E4).** `simulatorSession.ts` gains three calls and
loses `exportSvg`:

```ts
beginExportSnapshot({ token, camera?, settings?, devicePixelRatio }): number  // copies positions, camera uniforms, sheet, faces/edges flags
exportScene(snapshot: number, { lighting, lightDir, lineWidth, markHidden }): PaperScene | null
endExportSnapshot(snapshot: number): void                                     // also dropped when the session unloads
```

The scene crosses to the main thread (structured clone) and is painted there,
so a page change is a repaint with no round trip. `exportSvg`'s tests move to
`exportScene`; the painter's are unchanged.

**The session — scene cache and painter.** `paperExport/paperExportSession.ts`
(React-free) holds a target's scenes by `sceneKey` and paints
`paperSceneToSvg(scene, surfacePaperStyle(style, PAPER_STYLE_POLICIES[target.surface]), page)`.
`paperExport/usePaperExportSession.ts` is the hook the dialog uses: it resolves
the style from the choice (`exportStyle`, or `effectivePaperStyle(preset.style, pins)`),
builds on a key change (keeping the previous page on screen while it runs),
repaints on every option change through `useDeferredValue` so typing a margin
stays responsive on a large scene, and owns the preview's object URL (revoked
on each repaint and on close). Returns `{ status, page, pngSize, stats }`.

**Saving.** `paperExport/savePaperExport.ts` — one function for every surface:
the SVG string through `saveTextFile`, or `paperSvgToPng(page, dpi)` through
`saveBinaryFile`, named `exportFilename(target.fileStem, ext)`; the success
toast; the one `paper exported` event (E1's three copies go); and, once a file
is written, the options remembered (X6). A native save dialog cancelled
leaves the export dialog open; a failed encode shows in the dialog, which
stays open.

**PNG limits (X8).** `lib/paper/pngCanvasLimits.ts`: the largest side and
area each engine will encode. The numbers are measured at implementation on
Chromium, WebKit on macOS (Tauri and Safari) and WebKit on iOS — not taken from
memory — and stored with the engine they were measured on. `paperPngSize`
feeds the check; the dialog disables Export past it.

**Options and persistence (X5, X6, X12).** Still one JSON value under
`oristudio:paper-export` (E11) — per device, never in the `.osf`. Its end
state:

```ts
type PaperExportKind = 'simulation' | 'folded-figure' | 'step';

interface PaperExportOptions {           // what one kind remembers; defaults
  format: 'svg' | 'png';                 // 'svg'
  style: 'export-style' | string;        // a paperPresetKey(); 'export-style'
  sheet: 'as-shown' | { mm: number };    // 'as-shown'
  paddingMm: number;                     // 5
  background: Hex | null;                // null: transparent
  keepHiddenFaces: boolean;              // true
  pngDpi: number;                        // 192
}

interface PersistedPaperExport {
  version: 2;
  kinds: Record<PaperExportKind, PaperExportOptions>;
  /** The folded figure beside a crease pattern, in its export and share card (X12). */
  creasePatternFoldedFigure: { style: 'export-style' | string };
}
```

- `style` is a pointer, not a copy. `'export-style'` means the Settings export
  slot as it is when you export; a key means that preset as it is then. A key
  that names no preset any more (deleted, or a saved preset renamed) reads as
  `'export-style'`.
- `sheet: 'as-shown'` is a mode, not a number: it is measured from the zoom at
  every export (E3).
- Read: normalised field by field per kind, as today. A value with no
  `version` is today's single object, and seeds every kind (with the default
  format and style), so nobody's page resets. Nothing stored: today's
  first-run seed from the old simulator setting, for every kind. An older
  build reading a v2 value finds none of its fields and uses its defaults;
  nothing breaks.
- Write: once, when a file is saved (or a share published) —
  `rememberPaperExportOptions(kind, options)` and
  `rememberCreasePatternFoldedFigureStyle(style)` in the settings store,
  which replace `setPaperExportField`. The dialog edits a draft seeded from
  its kind's options (and a shortcut's format), so Cancel, or closing,
  changes nothing.
- Not remembered: the picture (captured at each open), the file name (from
  the workspace, figure or step, and editable in the save dialog), and an
  object's pins (the document's, saved in the `.osf`).

Order: Phases 5–9 add `format`, `style` and the crease-pattern folded-figure
style to today's single object, which the dialogs write on export while
Settings and the Simulate pane still edit the page live. Phase 10 removes those
two editors and only then splits the value per kind, so no surface ever reads
options nothing can edit. The preset rows (`BUILT_IN_PAPER_PRESETS` + saved,
as `usePaperSettings` builds them inline) move to a React-free
`paperPresetRows()` in `lib/paper/paperPresets.ts` for everything that lists
them.

**The UI store.** `store/paperExportUiStore.ts`:
`{ request: { target: PaperExportTarget; format?: 'svg' | 'png'; returnFocus: HTMLElement | null } | null; open(request); close() }`.
`close()` releases the target. Opening while a request is open replaces it
and releases the old target.

**Components.** `components/paperExport/`:

- `ExportModalFrame.tsx` — the chrome: backdrop, document, header with title
  and close, a preview slot, an options slot, a footer; the Escape rule;
  initial focus and focus return. Extracted from `CreaseExportDialog`'s
  markup; the CSS stays the existing `.export-modal*` classes, with the
  preview-caption and checkerboard additions. The crease-pattern dialog keeps
  its own markup (X10 leaves it where it is); it can adopt the frame later.
- `PaperStylePicker.tsx` — the Style select and its pins hint, from
  `paperPresetRows()` and the export slot's chip; used by the dialog, the
  crease-pattern dialog and the share card (§5).
- `PaperExportModal.tsx` — mounted in `App.tsx` under an
  `OverlayErrorBoundary`; reads the UI store, wires the session hook, options
  and save.
- `PaperExportPreview.tsx` — the page image, checkerboard, caption and states.
- `PaperExportOptions.tsx` — the sections, from the existing primitives:
  `SegmentedControl`, `Select`, `NumberField` (with `suffix`), `ColorField`,
  `Toggle`. Not the Settings components: those bind the settings store's
  style slots (`usePaperSettings`) and lay out in a 680 px tab.

**Escape (E7).** The frame listens on `window` in the *bubble* phase and
closes only if `event.defaultPrevented` is false, so an open Select or a field
reverting its edit keeps the key; `NumberField` calls `preventDefault` when
Escape reverts. A prompt raised over the dialog flags it through the
nested-dialog context (`components/settings/settingsNestedDialog.ts`, renamed
to a general `nestedDialog.ts`) exactly as it does for Settings.

**Triggers (X4).**

- `SimulatorExportMenu` becomes an icon button, *Export view…*, on the Simulate
  toolbar and the inline window's inspector (the file keeps its reason for not
  being in File ▸ Export: that exports the document, this one viewport).
- `foldedFigureActions`' `export` becomes a plain action, *Export…*, on the
  figure toolbar and context menu; `deps.exportAs(format)` becomes
  `deps.openExport()`.
- References: the toolbar's export node becomes one button, *Export step…*;
  the context menu shows one *Export step…*; the two shortcut commands stay and
  open the dialog on their format.
- File ▸ Export ▸ Export SVG… / Export PNG… (the crease pattern) keeps its own
  dialog (§5).

**Analytics.** `paper export opened { surface }` when the dialog opens (the
funnel's first step; the triggers are toolbar and context-menu verbs the menu
chokepoint does not see). `paper exported` keeps `surface`, `format`,
`hidden_faces` and gains `style` (`export-style`/`default`/`diagram`/`custom`),
`sheet` (`as-shown`/`custom`), `background` (`transparent`/`colour`),
`resolution` (`1x`/`2x`/`3x`/`4x`/`300`/`600`/`custom`, `none` for SVG) and
`options_changed` (`yes`/`no` — whether anything was touched before
exporting, which says whether the dialog earns its step). Enums only; never a
colour, size or name. `docs/analytics.md` rows updated.

**i18n.** New strings under `dialogs:paperExport.*`; the page hints reuse the
existing `dialogs:settings.paper.exportPage.*` keys (and their translations)
until Phase 10 removes their old home. Trigger labels gain their ellipsis.
Extract, translate the eight locales, stamp, check.

### 3. Ink by ground (X11)

**The rule.** A mark draws in its style ink where it lies on the paper, and in
the ground ink where it does not.

- **The paper** is the outline the sheet is filled with — the hull
  `sheetOutline` the canvas fills (the rail's cards stopped drawing the paper
  in Phase 2, §4) — and, while a
  fold plays, the moving flap's outline too, since it is paper and filled as
  such (the marks do show during a fold: only those riding the flap fade,
  and a fold card rests folded — Phase 1 found). The symbol
  layer's `paper`, which `labelOnPaper` reads, is the square's corners
  (`sheetCorners`) today; it moves to the same outline, so letters and marks
  agree on where the paper is.
- **The marks** are the fold arrows (arc and head), straight lines in the
  arrow style, the turn-over glyph, mark rings and the canvas's dot on a
  picked or named vertex — the ones that were `--fold-border` on main.
  Letters keep their own rule (the reference colour, haloed by what they
  stand on — the face the view shows, which the caller names: a projector
  onto the canvas's model space reports a mirror on the front). Creases and
  edges lie on the paper and are untouched.
- **The ground ink on screen** is the theme's own value of the mark's token —
  what main drew with. Inside the workspace the style has re-set the
  `--fold-*` names (D12), so the theme's values are reached through aliases
  declared on `:root` (`--references-ground-ink: var(--fold-border)` and
  kin): a custom property is resolved where it is declared, so the alias
  carries the root's value into the workspace untouched by the re-set.
- **The ground ink in a file** comes from the page, which
  `diagramToPaperScene` already takes as `ground` (the page's background, or a
  printed diagram's white when transparent — the letters' halo). The mark
  keeps the style's ink wherever that reads against the ground (contrast of at
  least 3:1) and otherwise takes black or white, whichever reads. So a
  transparent or light page changes nothing in a file, and a dark page
  background lifts the off-paper arrows.

**Where it is drawn.**

- The symbol layer (`cp-workspace/references/diagram/DiagramPrimitives.tsx`,
  for the big view and every card) draws each such symbol twice, clipped inside
  and outside the paper outline: one `<clipPath>` pair per diagram, from the
  projected outline it holds as `paper`.
- The canvas (`diagram/diagramToScene.ts`) splits an arrow-style line where it
  crosses the outline (a segment against a convex polygon) and packs each
  piece with its ink.
- The canvas's vertex dot (`highlightedVerticesToOverlayPoints`) cannot be
  clipped, so its ink goes by where the vertex lies: the style's on the
  paper, the theme's off it, and on the paper's edge — most references —
  the style's fill ringed in the theme's ink.
- The export's markup item (`diagramToPaperScene.ts`) carries the same clip
  pair, with the ground ink resolved from the page as above.

**The arrow pen (E13).** A `--references-arrow` token, set from
`arrows.color` by `referencesPaperTokens`, is what `.step-diagram__line--arrow`,
`.step-diagram__arrowhead` and the canvas's `arrow` style read on the paper, so
the screen draws the arrow pen the export already draws. Off the paper,
arrows take the ground ink like every other mark.

### 4. The pattern rails (X10)

Back to main's look: each role's stroke in the theme's ink at main's widths —
the paper's edge in `--text-tertiary` at 1.6, mountain, valley and the rest in
their `--fold-*` at 1.1 — solid and non-scaling, on the rail's own tile, with
no paper fill and no erode.

- **Kept from Phase 10 of the older plan**, because it was not about style: one
  thumbnail renderer and one role vocabulary for both rails (`SheetStrokeRole`,
  read from colours and FOLD assignments alike), so the two rails still agree.
- **Aux lines:** References' rail follows its own "Show auxiliary creases"
  option, resolved as the canvas beside it resolves it (the style's switch
  until the reader sets it). Simulate's draws them always, as main's did: the
  style's switch there belongs to the simulation, and no longer reaches the
  flat pattern beside it. So while that switch is off, the Simulate view hides
  aux lines its rail still draws — deliberate, for review in Phase 2's browser
  pass: a card is for picking the pattern, all of it.
- **The theme's inks, not the workspace's:** the References rail sits inside
  `.references-workspace`, where the style re-sets `--fold-*` (D12), so both
  rails read root-level aliases (`--sheet-thumb-border`, `-mountain`,
  `-valley`, `-unassigned`) — the same device as §3's ground inks.
- **Deleted:** `sheetThumbnailInk.ts`, `useSheetThumbnailInk.ts` and their
  tests. `penSvgStroke` stays; the erode close-up in Settings uses it.

### 5. The folded figure beside a crease pattern (X10, X12)

The crease pattern in the crease-pattern export and the share card is untouched:
main's rendering, with its theme and line styles. Only the folded figure beside
it changes.

- **A style picker.** The dialog's Folded figure section and the share card's
  folded-figure controls gain `PaperStylePicker` (§2) above Side:
  *Export style · ⟨chip⟩* and the presets.
- **Its paper follows the pick (E15).** The Front and Back fields start from
  the picked style's paper colours and re-seed when the pick changes; editing
  them still pins over the style, as `creaseExportPaperStyle` does now.
- **Hidden faces are kept.** The inset stops reading
  `paperExport.keepHiddenFaces` (E10), which becomes the paper dialog's per
  kind; `useCreaseExportPaper` becomes the resolver of the pick.
- **Remembered once for both** (`creasePatternFoldedFigure.style`), written
  when a file is saved or a share published, and separate from the
  folded-figure export's kind.
- **Analytics.** `crease pattern exported { folded_figure }` on save
  (`none`/`export-style`/`default`/`diagram`/`custom`; the menu chokepoint
  sees only the command), and `crease pattern shared` gains the same
  property.

### 6. Pen samples on both sides of the paper

Every pen card's sample strip is split down the middle: the left half on the
paper's front, the right half on its back, with the one sample line running
across both — so each pen is judged against both colours it is drawn on.

- `PaperPenCard` takes `paper: { front, back }` in place of `ground`; the two
  halves are two `<rect>`s under the line rather than a CSS background, so a
  test can read which colour each half is. When front and back are the same
  colour, the strip reads as one.
- The width, dash and cap the line is drawn at are unchanged
  (`samplePenWidth`, `samplePenDash`); the line spans both halves, so a dash
  pattern is seen crossing the fold between them.
- Every pen card gets it, arrows included: an arrow crosses flaps showing
  either side.

### 7. Export all steps (X13)

**Entry points.**

- **The right rail.** An *Export* section at the foot of
  `ReferencesViewControlsPanel`, one button: *Export all steps…*, enabled when
  the strip has a step with a diagram. The rail is its own panel and the
  diagrams live in `ReferencesPanel`, so the button runs a new command,
  `references.exportAllSteps` (bindable, no default chord, like the other
  two), through a public `runReferencesCommand(id)` beside the private
  executor in `keyboard/shortcutRuntime.ts` — the one registry the keyboard
  already uses, and focus-independent. Its enabled state is a selector over
  the References slice, the same condition the panel uses.
- **The dialog.** When the target is a References step and the strip has more
  than one, a *This step | All steps* switch heads the options. *Export
  step…* opens on *This step*; the rail's button on *All steps*. The scope is
  not remembered: where you started says what you meant.

**Which steps.** The strip's, as it shows them, captured when the dialog opens
(X3). Sequence: every card with a diagram — `planStepScene(…).pageDiagram` for
each index, turn-overs included, symmetric steps merged as the strip merges
them, the finished card (which has no diagram of its own) left out. Find:
every step of the shown candidate (`candidateStepDiagram`).

**A multi-page target.** The References target carries
`pages: { label: string; fileStem: string }[]` and the index of the step on
show; `sceneKey` and `buildScene` take the page. A single step is one page.
The session caches scenes per page and key, and builds a page's scene when
the preview first shows it or when Export reaches it.

**One crop for the set.** Under *All steps*, every page is painted with one
crop — the union of all the steps' scene bounds — so the sheet sits at the
same place and size on every page, and the set lines up when flipped through
or laid side by side. The painter crops to `scene.bounds`, so the session
hands it scenes whose bounds are the union. *This step* keeps its own crop.
(All steps therefore builds every page's scene before the first preview; the
steps are cheap, E5.)

**Preview.** The page of the step shown, with a pager under it (‹ Step 3 of
12 ›) to look at every page before saving; the caption gives this page's size
(px for PNG) and the footer "12 files · ZIP". The PNG limit (X8) is checked on
every page; one too large disables Export and names the step.

**Saving.** Each page painted (SVG) or rasterised (PNG) in turn, then zipped
with `fflate` — a direct dependency of `@treemaker/web` at its current major
rather than posthog-js's copy, deflate for SVG (text) and stored for PNG
(already compressed) — and saved once through `saveBinaryFile`
(`application/zip`, `.zip`): a download on the web, the save dialog on
desktop. `fflate` is loaded on demand, and the `import()` is guarded as
`StartFigure` guards its own: after a deploy an old tab's chunk is gone, and
a bare `await import()` becomes an unhandled rejection. A failed load shows in
the dialog. While exporting, the footer shows progress ("Exporting 5 of
12…"); Cancel stops before the next page, and nothing is saved unless every
page is.

**Names.** The ZIP is `<title> steps.zip` for a Sequence and
`<title> reference C steps.zip` for a Find candidate. Inside, each file is
`referencesStepExportName` with its step number zero-padded to the count's
width, so the files sort in order (`… step 01.svg`, `… turn over after step
03.svg`).

**Analytics.** `paper exported` gains `scope` (`step`/`all-steps`) and, for
all steps, `step_count` in buckets (`2-5`/`6-10`/`11-25`/`26+`). The file
service's `file exported` fires once, `format: 'zip'`.

### 8. Every simulated line at its own pen's width (X14)

- **The renderer learns a width per kind.** `RenderSettings.creaseWidthPx`
  becomes `edgeWidthPx`, `mountainWidthPx` and `valleyWidthPx` beside the
  existing `auxWidthPx`; the edge shader picks the half-width by the line's
  assignment, as it already does for aux; the canvas-2D fallback sets each
  kind's `lineWidth`; the frame shrink an inline window applies
  (`creaseWidthReferenceEdge`) scales all four alike.
- **The widths.** `resolvePaperStyle` fills them from the pens, and
  `surfacePaperStyle` stops unifying: every line is its pen, except that with
  *Render all creases as edges* on, mountain and valley are both the edge pen
  at `(mountainFolds.width + valleyFolds.width) / 2`. The painter already draws
  per-pen widths, so an export matches the screen with no further change; the
  hidden test's ink allowance is still the widest pen (`widestPenCssPx`).
- **The 3D figure** draws through the same settings, so its borders take the
  edge pen's width and its folds their own, as its export already would.
- **The controls go:** the Simulate pane's slider and `setCreaseWeight` /
  `SIMULATOR_FOLD_WEIGHT_RANGE`, and the inline sheet's `foldLineWeight` row.
  An inline window's existing pins need nothing: its fold-pen pins hold whole
  pens, width included, and the colour rows' reset clears them.
- **What changes on screen:** the Default preset's edge pen is 0.9 pt and its
  folds 0.825 pt, so a simulation's outline gets slightly heavier than today,
  where everything drew at 0.825.

## Affected Areas

- New `apps/web/src/paperExport/` — target type, session, hook, save, and
  tests.
- New `apps/web/src/components/paperExport/` — frame, style picker, modal,
  preview, options, and tests; `App.tsx` mount.
- New `apps/web/src/store/paperExportUiStore.ts`.
- `apps/web/src/lib/paperExportSettings.ts`, `lib/paper/paperPresets.ts`,
  new `lib/paper/pngCanvasLimits.ts`; `store/settingsStore.ts` (the stored
  value's end state, the two `remember…` writers).
- References: `cp-workspace/references/diagram/DiagramPrimitives.tsx`,
  `diagram/diagramToScene.ts`, `diagram/diagramColors.ts`,
  `diagramToPaperScene.ts`, `usePaperStyleTokens.ts` (ink by ground, the
  arrow token); `referencesActions.ts`, `ReferencesViewportToolbar.tsx`,
  `referencesContextMenu.ts`, `referencesShortcuts.ts`,
  `useReferencesStepExport.ts` (retired), new `referencesExportTarget.ts`;
  `components/panels/ReferencesPanel.tsx`; `styles/theme.css` and the theme
  files (root-level aliases).
- All steps: `components/panels/ReferencesViewControlsPanel.tsx` (the Export
  section), `keyboard/shortcutRuntime.ts` (`runReferencesCommand`),
  `keyboard/shortcuts.ts` and `i18n/shortcutLabels.ts`
  (`references.exportAllSteps`), `cp-workspace/references/referencesShortcuts.ts`,
  `referencesActions.ts`, new `paperExport/zipPages.ts`; `apps/web/package.json`
  (`fflate`).
- Rails: `cp-workspace/sheets/SheetGrid.tsx`, `sheetThumbnail.ts`,
  `sheetThumbnailInk.ts` and `useSheetThumbnailInk.ts` (deleted),
  `cp-workspace/references/ReferencesSheetsSidebar.tsx`,
  `components/panels/SimulatorSegmentsPanel.tsx`.
- Simulator: `simulator/simulatorSession.ts` (snapshot calls, `exportSvg`
  retired), `useSimulatorRuntime.ts`, `SimulatorExportMenu.tsx`,
  `useSimulatorViewExport.ts` and `simulatorViewExport.ts` (retired), new
  `simulatorExportTarget.ts`; `components/panels/SimulatorPanel.tsx`,
  `SimulatorViewControlsPanel.tsx` (Export group removed).
- Inline simulation: `cp-workspace/InlineSimulationLayer.tsx`,
  `inlineSimulation/inlineSimulationRuntime.ts`, `useInlineSimulations.ts`.
- Folded figures: `cp-workspace/folded/foldedFigureActions.ts`,
  `useFoldedFigures.ts`, `CpFoldedFigureToolbar.tsx`,
  `foldedFigureMenuItems.tsx`, new `foldedFigureExportTarget.ts`;
  `projectSlice.exportOristudioCpFoldedFigure` (retired into the target).
- Crease-pattern export and share card: `components/CreaseExportDialog.tsx`,
  `cp-workspace/share/ShareLinkModal.tsx`, `hooks/useCreaseExportPaper.ts`,
  `lib/creaseExport.ts` (the folded-figure defaults).
- Simulator line widths: `packages/origami-simulator/src/webgl/meshRenderer.ts`
  (and its tests), the canvas-2D fallback (`simulator/canvas2dFrame.ts`),
  `lib/paper/paperStyleResolve.ts` (`resolvePaperStyle`, `surfacePaperStyle`),
  `simulator/useSimulatorPaperStyle.ts`, `SimulatorViewControlsPanel.tsx` (the
  slider), `cp-workspace/paper/paperStyleFields.ts` (the inline row), the 3D
  figure window's `RenderSettings` adapter.
- Settings ▸ Paper's pens: `components/settings/PaperPenCard.tsx` (both
  sides), `PaperSettings.tsx` (the `paper` prop, the Lines hint),
  `PaperSlotHeader.tsx` and `PaperFoldedCard.tsx` (the Display slot's and the
  aux switch's hints), `styles/theme.css` (`.settings-paper-pen__sample`).
- Settings: `components/settings/PaperExportPageSection.tsx` and
  `hooks/usePaperExportPage.ts` (removed in Phase 10), `PaperSettings.tsx`,
  `settingsNestedDialog.ts` → `nestedDialog.ts`.
- `components/ui/NumberField.tsx` (Escape `preventDefault`).
- `analytics/events.ts`, `docs/analytics.md`, `public/locales/**`.

Not touched: the Rust engine, the wasm bridges, the Tauri shell (saving goes
through the shared file service), the painter, the producers' geometry, the
CP canvas, and the crease-pattern export's own rendering of the pattern.

## Checklist

### Phase 1 — References: ink by ground

- [x] Root-level aliases for the theme's inks that the workspace re-sets; a
      test that inside `.references-workspace` the alias gives the theme's
      value while `--fold-*` gives the style's
      — `--theme-fold-{mountain,valley,border,unassigned}` and
      `--references-ground-ink` on `:root` in `theme.css`. jsdom inherits a
      custom property but never substitutes `var()`, so the test shows that
      nothing but `:root` declares or sets the aliases, then resolves what the
      workspace inherits against `:root` as a browser does: the dark and the
      light theme's `--fold-border`, while the workspace's own is the style's.
      The colour a browser hands the canvas is still a browser check.
- [x] `--references-arrow` from `arrows.color`; arrows, heads and the canvas's
      arrow lines read it (E13); tests
- [x] Symbol layer: arrows, the turn-over glyph and rings in two inks,
      clipped by the paper outline, on the cards and the big view (and the
      flap's outline during a fold, if they show then); tests on the clip
      — they do show during a fold: only the marks riding the moving flap
      fade (`foldSymbolFade`), and a fold card rests folded. So the big
      view's clip follows the pose (`foldPosePaper`: the sheet on the resting
      side plus the flap's posed outline, `foldPoseOutline`). The paper the
      layer is told of (`outline`) is the canvas's hull (`sheetOutline`), a
      card's its sheet rect.
- [x] Canvas: arrow-style lines split at the outline, each piece in its ink;
      tests — at the resting outline only: while a fold plays, a piece riding
      the flap keeps the ink it was cut in, where the symbol layer's clip
      follows the pose. Left so because no step draws such a line
      (ReferenceFinder's arrow is an arc; a planner step has no arrow-pen
      line); a later phase that adds one, or an as-shown export mid-fold,
      re-cuts at `foldPosePaper`.
- [x] Canvas: the picked or named vertex's dot, which review found still in
      the style's ink (`--fold-border`) and half lost on a dark ground at the
      sheet's edge — inked by where the vertex lies (`paperSideOf`); tests
- [x] Letters' halo on the paper takes the face from the caller
      (`DiagramRenderContext.back`), not the projector's handedness: the big
      view and a step's export haloed a letter on the front in the back's
      colour (pre-existing, e007f9f99); tests
- [x] One way to draw a diagram's shapes with their clip pair
      (`diagramShapes`), so no shape names a clip its document lacks
- [x] Export: `diagramToPaperScene`'s markup in the same two inks, the ground
      ink from the page by contrast; tests (a transparent page unchanged —
      pinned byte for byte to c53cc04d9's markup — and a dark background
      lifts the off-paper arrows)
- [ ] Browser: dark and light themes, a card and the big view, a fold whose
      arrow leaves the sheet — not run by the implementing agent or the one
      that applied review (no browser in either session). Check that
      `getComputedStyle(workspaceRoot).getPropertyValue('--references-ground-ink')`
      is the theme's `--fold-border` and not the style's edge ink; that a
      card's turn-over glyph and an arrow arcing off the sheet read on the
      dark ground; that the big view's clip follows the flap through Play; that
      a picked vertex on the sheet's edge (Find) reads on both grounds; and
      that a letter on the front face is haloed in the front's colour. In
      Chromium and WebKit
- [x] Validate; commit

### Phase 2 — The pattern rails: main's look

- [x] Thumbnails in the theme's inks at main's widths, solid, no fill, no
      erode, through root-level aliases; one renderer and role vocabulary kept
- [x] Aux lines: References' option in its rail, always in Simulate's
- [x] Delete `sheetThumbnailInk` / `useSheetThumbnailInk`; re-pin the rails'
      tests
- [x] The Lines hint (`pensHint`) names what the pens now draw — "Simulations,
      folded figures, steps"; so do the Display slot's hint (`displayHint`)
      and the aux switch's (`auxVisibleHint`); eight locales
- [ ] Browser: both rails, both themes, with Default's dashed folds
- [x] Validate; commit

### Phase 3 — Settings: each pen's sample on both sides of the paper

- [ ] `PaperPenCard`'s strip: front and back halves under one sample line;
      `paper: { front, back }` replaces `ground`
- [ ] Tests: each half carries its side's colour, the line spans both, and
      width, dash and cap are unchanged (re-pin "draws each pen's live
      sample…" in `PaperSettings.test.tsx`)
- [ ] Browser: Default and Diagram presets, a pen whose colour matches one
      side
- [ ] Validate; commit

### Phase 4 — Simulations: every line at its own pen's width

- [ ] `RenderSettings`: `edgeWidthPx`, `mountainWidthPx`, `valleyWidthPx`
      (with `auxWidthPx`); the edge shader and the canvas-2D fallback draw each
      kind at its width, shrunk alike in an inline window; package tests
- [ ] `resolvePaperStyle` fills them from the pens; `surfacePaperStyle` stops
      unifying, keeping only the folds-as-edges rule (the edge pen at the
      average of the fold widths); re-pin "draws every simulator pen at the
      fold line weight…" and the palette and session tests that assumed one
      width
- [ ] Remove the Simulate pane's *Fold line weight* slider and the inline
      sheet's row, `setCreaseWeight` and `SIMULATOR_FOLD_WEIGHT_RANGE`;
      re-pin `SimulatorViewControlsPanel.test.tsx` and
      `inlineSimulationProperties.test.ts`; the string leaves every locale
- [ ] Rebuild the simulator package's `dist`; browser: the Simulate view, an
      inline window and a 3D figure in both modes of *Render all creases as
      edges*, with the edge and fold pens set to clearly different widths
- [ ] Validate; commit

### Phase 5 — The export dialog, on References steps

References first: its producer is synchronous and cheap, so the whole flow —
open, preview, options, save — is proven before the harder captures.

- [ ] `PaperExportSettings` gains `format` and `style` (normaliser defaults,
      deleted-preset fallback); the dialog edits a draft and writes it only
      when a file is saved; tests
- [ ] `paperPresetRows()` extracted from `usePaperSettings`; both use it
- [ ] `pngCanvasLimits.ts` with measured caps per engine; tests on the check
- [ ] `PaperExportTarget`; `paperExportSession.ts` (scene cache by key, paint)
      with tests: a page change repaints without a build, a key change
      rebuilds, the flat figure's empty key never rebuilds
- [ ] `usePaperExportSession` (style from the choice + pins, deferred repaint,
      object URL lifecycle, build status) with tests
- [ ] `savePaperExport` (SVG / PNG at dpi, filename, toast, `paper exported`,
      remembering) with tests; a cancelled native dialog keeps the dialog open
- [ ] `paperExportUiStore` (open, replace releases, close releases)
- [ ] `ExportModalFrame` (bubble-phase Escape honouring `defaultPrevented`,
      initial focus on Export, focus return); `NumberField` Escape
      `preventDefault`; nested-dialog context generalised
- [ ] `PaperStylePicker`, `PaperExportModal`, `PaperExportPreview`,
      `PaperExportOptions`; CSS (checkerboard page, caption, narrow layout)
- [ ] `referencesExportTarget` (key: resolved style + background);
      toolbar and context menu → *Export step…*; shortcuts open on their
      format; `useReferencesStepExport` retired
- [ ] A parity test: at the default options the dialog's SVG equals what the
      old References export wrote for the same step
- [ ] Modal tests: preview shows; format switch swaps Resolution and Keep
      hidden faces (and a target that buries no faces never shows the
      latter); picking a preset repaints; Export saves the previewed string;
      Escape in an open Select does not close; a too-large PNG disables
      Export
- [ ] Analytics: `paper export opened`, `paper exported`'s new properties;
      `docs/analytics.md`
- [ ] i18n: extract, eight locales, stamp, check
- [ ] Validate; commit

### Phase 6 — Export all steps

- [ ] `fflate` as a direct dependency; `paperExport/zipPages.ts` (deflate for
      SVG, stored for PNG) with a guarded on-demand import; tests: the entries
      round-trip, a failed import surfaces as an error, not a rejection
- [ ] The References target goes multi-page: every step captured at open
      (Sequence: `planStepScene` per card with a diagram; Find: the shown
      candidate's `candidateStepDiagram`); tests: turn-overs in, the finished
      card out, merged steps as the strip merges them
- [ ] One crop for the set (the union of the pages' bounds); a test that the
      sheet lands at the same page coordinates on every page
- [ ] Dialog: *This step | All steps* switch (References only, more than one
      step); the pager; "N files · ZIP"; the PNG limit per page; progress and
      Cancel; nothing saved unless every page is
- [ ] Names: `<title> steps.zip` / `<title> reference C steps.zip`, entries
      zero-padded to sort; tests
- [ ] `references.exportAllSteps` (catalog, shortcut label, bindable, no
      chord); `runReferencesCommand` in the shortcut runtime; the rail's
      Export section and button with its enabled selector; tests: the button
      opens the dialog on All steps, and does nothing while no References
      view is mounted
- [ ] Analytics: `scope`, `step_count`; `docs/analytics.md`
- [ ] i18n; validate (`npm run build:web` too: the lazy chunk); browser:
      a Sequence and a Find candidate, SVG and PNG, the ZIP opened and its
      pages compared with the preview; desktop save dialog; commit

### Phase 7 — The export dialog, on folded figures

- [ ] `foldedFigureExportTarget`: 3D live (captured model and camera, key =
      `folded3dSceneStyleKey` + hidden), 3D stored scene (re-light hint),
      flat (kernel scene once), legacy `fixedPicture` (format only + hint)
- [ ] `foldedFigureActions` `export` → action; toolbar and context menu;
      `projectSlice.exportOristudioCpFoldedFigure` retired into the target;
      the `paper exported` literal goes
- [ ] The dialog names the figure's pins under Style
- [ ] Parity tests: 3D and flat default-option SVG equals the old export's;
      re-pin `exportFoldedFigure3d.test.ts` / `exportFoldedFigureFlat.test.ts`
- [ ] Validate; commit

### Phase 8 — The export dialog, on simulations

- [ ] Worker `beginExportSnapshot` / `exportScene` / `endExportSnapshot`;
      snapshots dropped on unload; `exportSvg` retired; tests: a solver step
      after `begin` does not change the scene
- [ ] `simulatorExportTarget`; the Simulate view and inline windows open the
      dialog; `SimulatorExportMenu` → *Export view…* button;
      `useSimulatorViewExport` / `saveSimulatorView` retired
- [ ] The first build runs after the dialog paints; *Preparing preview…* on a
      large model
- [ ] Parity test against the old worker export at default options; re-pin
      `simulatorSession.test.ts`, `useSimulatorRuntime.test.tsx`,
      `inlineSimulationExport.test.ts`, `SimulatorPanel.test.tsx`
- [ ] Validate; `npm run build:web`; commit

### Phase 9 — The folded figure beside a crease pattern

- [ ] `PaperStylePicker` in the crease-pattern dialog's Folded figure section
      and in the share card's folded-figure controls
- [ ] Front and Back seeded from the pick and re-seeded when it changes;
      editing still pins (E15); tests
- [ ] The inset keeps hidden faces; `useCreaseExportPaper` resolves the pick;
      re-pin the dialog's (`CommandDialogModal.test.tsx`) and the share
      card's tests
- [ ] Remember the pick (`creasePatternFoldedFigure.style`) on save and on
      publish; tests
- [ ] Analytics: `crease pattern exported { folded_figure }`;
      `crease pattern shared` gains `folded_figure`; `docs/analytics.md`
- [ ] i18n; validate; commit

### Phase 10 — Retire the old export settings; remember options per kind

- [ ] Remove the two editors of export options outside the dialog: Settings ▸
      Paper's Export page section (with `usePaperExportPage`) and the
      Simulate pane's Export group
      (`SimulatorViewControlsPanel.test.tsx:340-352` goes with it)
- [ ] Per kind: `PaperExportKind`, `PaperExportOptions`,
      `PersistedPaperExport` v2, `rememberPaperExportOptions`; the dialog
      seeds from and writes to its target's kind; tests — today's single
      object seeds every kind, the first-run simulator seed still applies, a
      malformed kind defaults alone, an older build's read of v2 defaults
- [ ] Move the reused `exportPage.*` strings under `dialogs:paperExport.*`;
      i18n loop
- [ ] Mark the superseded wiring in the older plan (Phase 2 "Export page
      settings", Phase 6 "Verbs", Phase 10's rail ink) as moved here
- [ ] Validate; commit

### Validation per phase

`npm run lint:web`, `npm run typecheck:web`, `npm run test:web` (Node 22, from
`apps/web`), `npm run i18n:check`; `npm run build:web` in Phase 6 (a new
dependency, loaded on demand) and Phase 8 (worker API); the simulator
package's own tests and a rebuilt `dist` in Phase 4. Browser: dark and light
themes wherever a phase touches colour; every trigger opens the dialog; the
preview matches the saved file opened in a browser and in a vector editor;
Escape and Enter; the phone layout; on desktop (Tauri), cancelling the native
save dialog keeps the export dialog.
