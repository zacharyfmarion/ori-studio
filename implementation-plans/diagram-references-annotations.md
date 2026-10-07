# Diagram: a References step's marks as annotations

**Status: planned 2026-10-07. Nothing is built. Decisions RM1–RM13 are DECIDED: every recommendation** (Zach, 2026-10-07: "please just go with your recommended answers for everything"; his own answers, given while the plan was being written, are quoted under RM4, RM6, RM8 and RM9). It lands in a PR of its own, stacked on #436, as page overrides and the simulator tools do.
This builds on D6 (a References step is a snapshot), D8 (the annotation model,
and when a picture changes), D20 (pulling through the browser), D22 (turns are
not steps) and D23 (the Way chooser) in `implementation-plans/diagram-workspace.md`,
on Annotate's decision 7 (`diagram-annotate.md`: marks are in the arrow ink),
on 15e (behind a flap) and on Revision 2's enlarged steps (16f,
`diagram-revision-2.md`). When built it is D25 and Phase 17 there.

Conventions:
- Paths are under `apps/web/src/` unless they say otherwise.
- Line numbers are at 493e7b4e1 (HEAD). Other agents' uncommitted edits under
  `diagram/**` may have shifted some of them.
- *The card* is the References step card a step was pulled from: its
  `StepDiagramModel`. *Lift* means turning a card's mark into an annotation.
  *Baked* means a mark that is still part of the picture, as every mark is
  today.
- *(inferred)* marks a claim read from code but never run.

## Goal

Zach, 2026-10-07:

> Also for imported reference steps, I want all the annotations to be imported
> and editable as annotations. So the import is like a snapshot of the step but
> then you can edit the arrows and text and lines. This would be a good time to
> add support for solid lines where you can choose the color since references
> has them. And i want the option to show / hide the letters and reference
> lines on import, like in export

His screenshot is a step pulled from References ("Step 1 of the folding
sequence"): a square sheet with two dashed valley lines, a thin solid
diagonal (a reference line), the corners R, P and Q ringed and lettered in
magenta, and three fold-and-unfold arrows. The Step pane says "No
annotations", because all of it is part of the picture.

So:

1. **Editable marks.** A pulled step's arrows, lines, rings and letters arrive
   as annotations. The step looks as it does today until someone edits one.
2. **Solid lines with a colour.** A fourth Line Type, Solid, for any step.
   A reference line imports as one.
3. **Show or hide on import.** Letters and Reference lines, with the same
   filter and defaults as the export dialog's Marks.

His screenshot's step would arrive as twelve annotations: two valley lines,
one magenta solid line, three circles, three letters and three fold-and-unfold
arrows. The picture keeps the paper.

## Approach

### The shape of it

Today `referencesCardPicture` (`diagram/references/referencesPulledSteps.ts:44`)
stores the card's whole model as the step's picture, and every surface
repaints every mark from it through `diagramToPaperScene`.

The pull splits the card instead:
- **The picture keeps the paper as it stands:** the sheet, the creases already
  made, the pattern's aux lines, the band wash, and anything with no
  annotation that means the same thing.
- **Everything the step asks the folder to do becomes an annotation:** its own
  folds, the reference lines, the rings, the letters and the fold arrows.

Nothing has to be parsed, because a card is already a list of typed pieces in
known coordinates. `stepDiagramToPicture(model, mirrored)`
(`diagram/pictures/paintStepDiagram.ts:75`) already maps a card point to
picture units, and D8 makes the sheet box a References picture's frame, so
lifted marks land where the card drew them.

Five rules:
- **Looks the same.** In the Diagram preset, a pulled step paints the same
  pixels as today at the 50 mm the cards and canvas draw. Where it cannot,
  this plan says so and why (Tests).
- **A snapshot, not a link** (D6). The pull changes the Diagram's copy only.
  References' cards, exports and goldens do not change. Diagram edits never
  flow back.
- **The card's marks follow the card.** Each lifted mark is tagged. Replace
  from References and the Way chooser swap tagged marks and keep the author's
  (RM6).
- **Turn over renames folds.** Once folds are annotations, the carry has to
  do what the picture's `seenFromTheBack` did (RM7).
- **Old steps stay as they are.** The reader never rewrites a file. A verb
  converts an old step when wanted (RM8).

### Porting

There is no upstream parity obligation here.
- ReferenceFinder defines which lines and points appear in which style and
  the letter scheme (`refBase.cpp DrawDiagram`, `refLine.cpp:140-210`,
  `refMark.cpp:100-135`, alphabets at `ReferenceFinder.cpp:45-46`). The
  planner copies that vocabulary in our own code (`inputLetters.ts`). Its
  arrow arcs come from `foldArrowArc`, a verbatim port of upstream `CalcArrow`,
  so every References arrow is a 60° arc.
- Ours: every colour and pen, the ring round a point, `placeLabels`, reading
  ReferenceFinder's arc as a fold-and-unfold arrow, directional pinches, aux,
  the band wash and the planner's synthesis.

The import is a Diagram-side transform of a snapshot. The obligation is to
ourselves: a lifted step must paint like the baked one, and the tests below
pin that.

### 1. What stays in the picture and what lifts

**Stays in the picture** (the paper as it stands):
- the sheet;
- earlier creases (`crease`) and the pattern's aux lines (`aux`);
- the finished card's crease pattern (`fold-valley`, `fold-mountain`);
- the band wash (`region`);
- the uncreased rest of a ReferenceFinder pinch (`dotted`) and of a planner
  fold (`unfolded`);
- a pinch with no direction (`pinch`), and a step whose own fold is unassigned,
  which the planner draws as `crease` and cannot be told apart by style (RM9);
- the edge style, and lines or arcs in the arrow style. Cards never produce
  these.

**Lifts** (the step's instructions and names):
- its own valley and mountain folds, and pinches with a direction;
- the reference lines (`highlight` style);
- every ring;
- every letter;
- every fold arrow.

**Turn-over cards** are still pulled as turns between steps (D22), so nothing
changes for them.

### 2. Mark by mark

| Card piece (who defines it) | Becomes | Same on the page? |
|---|---|---|
| `line` valley / mountain: the step's fold (ReferenceFinder's action line, the planner's direction) | `valley-line` / `mountain-line`. Pieces of one fold that touch end to end merge into one line (RM10). | Yes. Same diagram-valley / diagram-mountain pen. The Diagram page ignores `dashPhase` already. A merged line runs one dash pattern where today each piece restarts it (RM10). |
| `line` pinch-valley / pinch-mountain | `valley-line` / `mountain-line` | Yes. The page already draws them in those pens through `LINE_ROLES` (`diagramToPaperScene.ts:117`). The heavy pinch look exists only on References' own card. |
| `line` highlight: ReferenceFinder's immediate inputs, the planner's input pieces, a grid step's band bounds | `solid-line`, colour `#c91d87` (RM3) | Yes, once `annotationDrawing` gives `highlight` the arrow pen with no minimum (§3, *Pen*). |
| `fold-arrow` (`foldArrowArc`, a port of upstream `CalcArrow`) | `fold-unfold-arrow`. `from` and `to` are the arc's mapped ends. `bend` is worked out from the mapped apex, not assumed. | Yes. It compiles back to the same `fold-arrow` primitive. Its head stops on ring rims because the rings lift too. The bend comes out at ±`ARROW_BEND`, and a mirrored card flips its sign by itself. |
| `point`, any style (normal, highlight, action) | `circle` | Yes in the Diagram preset (both inks `#231f20`). References inks a ring in the edge colour, an annotation circle in the arrow ink (Annotate decision 7), so in a style where those differ the ring changes colour. Accepted. |
| `label`: A–J and P–Z | `letter` (§4) | Yes at 50 mm. Stable at other sizes (RM1). |
| `region`, `dotted`, `unfolded`, `pinch`, `crease`, `aux`, `fold-*`, `sheet` | stay in the picture | Unchanged |

**Order.** Lifted marks are emitted in the card's primitive order, which is
`diagramShapes`' draw order, so stacking and letter halos match. They go
before any marks the author has drawn.

**Draw order against the sheet's edge.** The baked scene draws the sheet's
edge outline over the step's fold lines (`diagramToPaperScene.ts:253-263`).
Annotation lines paint after the whole picture (`pagePictures.ts:602`). In a
one-ink style nothing shows. Where the valley colour differs from the edge
colour (Default), a fold's end now covers the edge outline for half a pen
width. Accepted: every hand-drawn line on every picture already does this.

### 3. `solid-line`: Line Type "Solid"

**Model.** `{id, kind: 'solid-line', from, to, color?, behind?, imported?}`.
`'solid-line': 'line'` in `ANNOTATION_SHAPES` (`annotationModel.ts:81`) puts it
in `LINE_KINDS`, which gives it the line behaviour everywhere: hit testing
(`distanceToSegment`), snapping to its ends and crossings (`drawnLines`),
flip, carry, clipboard and Layers. About 13 files switch exhaustively on
kind; the compiler finds them.

**Pen.** The arrow pen with a round cap, which is References' reference-line
pen. One weight in v1.
- `annotationDrawing` (`annotationPrimitives.tsx:509-530`) overrides `arrow`
  but not `highlight`. So `highlight` keeps `canvasDiagramPens`' floor of
  1.4 ink (`diagramInk.ts:400-405`): a 0.75 pt arrow pen would draw a 1.31 pt
  reference line. `annotationDrawing` gets the same override the baked scene
  has (`diagramToPaperScene.ts:148-157`):
  `highlight: {...pens.highlight, width: arrowCss / ink}`.

**Colour.**
- No colour stored means the style's arrow ink, so changing the style
  recolours it.
- A stored colour is a `#rrggbb` string and prints as given, even in a
  one-ink style.

**How it is drawn.** It cannot be a `PaperLineItem`: a role carries the
style's fixed colours, and `PaperLineRole` lives in
`packages/origami-simulator` under the `.osf` validator. It compiles to
References' own `line` primitive in the `highlight` pen, with a new optional
`ink?: Hex` that `diagramShapes` honours. References never sets `ink`, so its
cards and goldens do not change. The canvas, step cards, pages, step files and
the PDF all draw it through `annotationMarks`.

**Behind a flap** (15e). The `line` primitive has no `hidden` field, and
`withHidden` (`annotationPrimitives.tsx:494-505`) skips it. `line` gains
optional `hidden` stretches, drawn dotted in the line's own pen and colour as
the other marks' are.

**Reach.** `annotationReach` (`annotationPrimitives.tsx:696-750`) has no case
for a `line` primitive. It gains one: the pen's half-width round the ends.
`markReach.ts`' `isDiagramMark` stays as it is, because widening it would
change References' own `grownToMarks` and its export bounds.

**UI.**
- `lineTypes.ts` gains `solid`, so `DIAGRAM_LINE_TYPES` is valley, mountain,
  hidden and solid.
- The rail's Line Type control (`DiagramAnnotateRail.tsx:69-96`) gets a fourth
  segment with a plain-stroke glyph.
- While Solid is the type, a colour select sits beside the control. It sets
  the next line's colour, kept as a `settingsStore` preference.
- The Layers pane gets a Color row under Type for a selected solid line
  (`DiagramLayers.tsx:271-287`). Changing the type away from Solid drops the
  colour.
- The Line tool and the Angle Bisector draw it, as they draw every type.
- Key: Shift+L, as Shift+V and Shift+M pick their types. It is free in the
  diagram scope (`keyboard/shortcuts.ts:612-641`); only References' scope uses
  it, and the two are never live together.

**The colour control** (RM2). A `Select` with a swatch per item, as Edit's
text colour is (`cp-workspace/CpTextEditor.tsx:315-336`):
- Ink (unset), Reference `#c91d87`, then five print colours: red `#e03131`,
  orange `#e8590c`, green `#2f9e44`, blue `#1971c2`, purple `#7048e8`. Edit's
  `TEXT_COLORS` are screen colours, and its orange and light blue print with
  low contrast. 17a checks these five against a printed proof.
- Custom… opens the engine's colour picker, as `ContextMenuColorItem` does. A
  custom colour shows as its own item while chosen.
- The swatch in a select item is the global `.select-swatch`
  (`styles/theme.css:6106`), whose one owner is `CpTextEditor`. It moves into
  `components/ui/Select.module.css` as a `SelectSwatch` part, in a commit of its
  own that changes nothing on screen, before the colour select uses it.

### 4. `letter`: References' letter, editable

**Model.** `{id, kind: 'letter', from, offsetPt, text, color?, imported?}`.
- `from` is the point the letter names, in picture units.
- `offsetPt` is the letter's centre from `from`, in print pt, y down.
- `offset` is already divisions' mm offset on the one flat
  `KnownDiagramAnnotation` (`diagramDocument.ts:765`, written at
  `diagramFile.ts:389`, read at `:1022`), so the letter's field takes a name
  of its own.

**Look.** Drawn by References' own label code
(`DiagramPrimitives.tsx:1000-1035`): bold 700, a fixed print size
(`DIAGRAM_LABEL_INK`), a halo knocked out of what it stands on.
- `createDiagramRenderContext` always runs `placeLabels`
  (`DiagramPrimitives.tsx:247`). It gains an option to take placements as
  given, and the annotation path fills them from `from` and `offsetPt`. There
  is no second text renderer to keep in step.
- `label` gains an optional `ink?: Hex`, as `line` does, for the letter's
  colour.

**The halo.** The baked halo is the face the letter stands on: the back's
grey `#b3b3b3` in the Diagram preset on a turned card
(`DiagramPrimitives.tsx:1011-1027`, `paperPresets.ts:52`). The annotation
context sets `outline: []` and whitens both faces on purpose, so a hollow push
or white arrow is filled with page white (`annotationPrimitives.tsx:285-304`,
`640-646`). Letters therefore get a route of their own:
- `annotationDrawing` takes the picture's paper (outline in picture units, and
  side) as an optional argument.
- Letters draw in a second context built with that outline, that side and the
  step style's real References ink. Everything else keeps `annotationInk`.
- Every caller passes it: cards, pages, the canvas, step files and close-ups.
  For a References picture the paper is the sheet, front or back. Other
  pictures pass none, so a letter there stands on page white (RM12).

**Size and placement** (RM1). The lift places letters with the same
`placeLabels` call `diagramToPaperScene` makes, at a 50 mm sheet
(`DEFAULT_PAPER_SIZE_MM`), the size the cards and canvas draw a References step
(`paintDiagramStep.ts:176`). That call is exported from
`diagramToPaperScene.ts` as one function, so the two cannot drift apart.
- At 50 mm the letter is where it is today.
- At any other size it keeps its distance from its ring in pt. Today a page
  cell re-runs `placeLabels` at the cell's size (`pagePictures.ts:695-705`),
  and collision costs against lines that scale with the sheet can move a
  letter to another side (`labelLayout.ts:251-323`). A lifted letter stays
  where the canvas shows it. That is *stable*, not *identical*.

**PDF.** Letters embed Noto Sans at 700, as `labelsOf` does for baked letters
(`pagePictures.ts:853`). `annotationTextRuns` hard-codes 400
(`annotationPrimitives.tsx:473`) and learns the letter's weight.

**Reach.** `annotationReach` gains the letter's box, so Fit each and the
cell's size loop count it.

**Editing.**
- Text and Color are rows in the Layers pane.
- Dragging the letter changes `offsetPt`. Dragging its anchor dot moves
  `from`, which snaps to circles and line ends.
- **A letter is anchored to a point, not linked to a mark.** Moving a circle
  leaves its letter behind, and Annotate has no multi-select yet.
- **Reset Position** runs `placeLabels` for that letter on a model rebuilt
  from the step: the picture's sheet layer, circles as points, lines as lines,
  and the other letters' current boxes reserved. At 50 mm, as the lift does.

**Why a kind, not a style on `label`.** `from` means the named point here, not
the text's centre. A shared kind would make the reader switch meanings on a
field.

### 5. The import

**Converter.** A new pure module, `diagram/references/referencesCardMarks.ts`:
`liftCardMarks(model, mirrored, marks)` returns `{sheet, annotations}`.
1. Filter with `referencesStepDiagramMarks(model, marks)`
   (`cp-workspace/references/referencesStepExport.ts:131`), unchanged.
2. Read directions through `seenFromTheBack` when the card is mirrored.
3. Map points with `stepDiagramToPicture(model, mirrored)`.
4. Merge touching collinear pieces of one style (RM10).
5. Place letters at 50 mm through the shared `placeLabels` call (§4).
6. Build the sheet from the original, unflipped model minus everything lifted
   or filtered out, because the painter flips it itself.
7. Pass each annotation through `cleanAnnotation` and the file reader, as
   `storedReferencesSource` does, so what is stored is already in the form an
   edit would leave it in.

**Where it plugs in.**
- `referencesCardPicture` and `pullCards` produce the sheet picture and the
  marks. `SentReferencesStep` gains `annotations`.
- `pullReferencesSteps` (`diagramDocument.ts:1382`) creates the step with them
  and sets `annotatedPictureKey` to the picture's key.
- The whole pull is still one undo step.
- Import fires no per-mark `diagram annotation added`.

**An enlarged step** (16f). Its marks are in its window's units
(`zoom/stepView.ts:7-10`), and Replace keeps `zoom`
(`diagramDocument.ts:1420-1426`). Pull into, Replace, Way and Make Editable on
an enlarged step map lifted marks through `unitsMove` (`zoomFrames.ts:123`)
into the window and run under `withAnnotationReach(stepReach(step))`. The
window shows a mark near it whole (`marksInWindow`), where the baked picture
cuts it at the window's edge. So a lifted line or arrow that crosses the edge
draws past it. Lines and solid lines are cut to the window at the lift; other
marks are kept whole and the difference is accepted. A fixture covers it.

**Cap.** If a card's marks would take a step past `MAX_STEP_ANNOTATIONS`
(500), that card is pulled baked, as today, and a toast says so. A grid step
of 64ths is the likely case.

**The Show menu** (RM4).
- A "Show ▾" menu in the browser's bar beside Sequence | Find
  (`DiagramReferencesBrowser.tsx:153-160`), built on `components/ui/Menu`,
  with two checkable items:
  - Letters: "The names of the points a step refers to. Its instruction may
    still name them."
  - Reference lines: "The lines a step lines up against."
- The card previews (`stepPictureUrl`) render the filtered card, so what you
  see is what you pull.
- The choice is a `settingsStore` preference shaped as `PaperExportMarks` and
  read through `normalizePaperExportMarks` (`lib/paperExportSettings.ts`).
  Both are on by default, as in export.
- A mark toggled off is not pulled. Rings stay, as they do in export.
- The step records its choice on its source (`marks?: {letters, highlights}`).
  The browser opened for Replace starts from that choice, and the Way chooser
  pulls with it.
- **The instruction.** With Letters off, the card's sentence still says "Fold
  P onto Q" (`referencesStepSentences.ts`). The hint is the only mitigation,
  as in export.

**Pose** (RM13). Lifted marks show ghosted in Pose, as every annotation does
(`DiagramPoseStage.tsx`). Today they are solid there, because they are part of
the picture.

### 6. Storage, keys and the tag

**The stored model is the sheet layer only** (RM11). Nothing that reads
`picture.model` needs a filter: the painter, `stepDiagramGeometry`'s snap
targets, `labelsOf`, `fittedSheetMm`'s `drawingRatio`, thumbnails, step files
and the preview. With the full model kept instead, one missed reader would
draw the marks twice.

**Key.** `steps-<digest(full card)>-marks`, with `-back` after it on the back.
- The digest of the full card keeps the card's identity, and the toggles do
  not change the sheet layer, so one card has one lifted sheet.
- The suffix keeps paint caches from mixing a baked and a lifted picture of
  the same card.
- `referencesStepWays.keyOf` strips `-marks` as it strips `-back`, so old and
  lifted steps both match their ways.

**The tag.** Each lifted mark carries `imported: 'untouched' | 'edited'`.
- **Edits.** `editStepAnnotations` (`diagramDocument.ts:1564`) is the one route
  for an author's edits. It compares each mark it returns with that mark's
  prior self in the same normal form (`cleanAnnotation` under the step's
  reach). A changed mark goes from `untouched` to `edited`. A mark it does not
  change keeps its tag, so cleaning and the reach clamp on an unrelated edit
  never count as edits.
- **Carries** keep the tag as it is: Turn over, Upright,
  `withCarriedAnnotations`, zoom's `carryMarks` (`zoomFrames.ts:150-178`),
  `followOwnPicture`, and enlarge and unenlarge.
- **Duplicate Step** keeps it: the copy shows the same card.
- **Paste** keeps it only onto a step showing the same card (same key, less
  `-back`), as the clipboard records. Anywhere else a pasted mark becomes the
  author's. Cut and paste in place therefore keeps it.
- **The picture stops being the card** (Remove Picture, a capture or an upload
  in its place). `releaseCardMarks` drops every tag, and the marks become the
  author's, under the notice. Readers ignore a tag on a step whose source is
  not a References card.
- Rejected: a digest stamp per mark. It needs re-stamping in at least three
  carry paths, and the reader's and `cleanAnnotation`'s normalising break it
  on the first unrelated edit. Also rejected: a list of ids on the source,
  which Duplicate and paste make stale.

**Tagged marks are never out of step.** Each one is made for the picture it
arrives with, and every carry takes it along.
- `annotationsOutOfStep` (`diagramDocument.ts:1595`) and the "picture changed"
  notice look at the author's marks only.
- `withCarriedAnnotations` (`annotationCarry.ts:424-440`) and
  `followOwnPicture` carry tagged marks even when the author's are out of
  step. Today an out-of-step step carries nothing, so after a Replace that
  kept the author's marks, a Turn over would leave the fresh card's marks on
  the wrong side.

**Telling an old step from a lifted one.** An old step's model still holds
liftable pieces. No flag is needed.

### 7. Turn over renames folds

`setReferencesSide` → `withCarriedAnnotations` → `pictureMove`
(`annotationCarry.ts:148`) gives `mirrorMove`, which moves geometry but never
renames a fold. The baked picture renamed its folds through `seenFromTheBack`.
Once folds are annotations, a turned step would print the front's valley as a
valley. Hand-drawn lines on References steps have this bug today.

- The References `PictureMove` gains `otherSide: true`, and `carryAnnotation`
  swaps under it (RM7):
  - `valley-line` ↔ `mountain-line`;
  - `valley-arrow` ↔ `mountain-arrow`, and a shaped arrow's `fold`.
- Fold-and-unfold arrows, solid lines, circles and letters only move. A
  letter's `from` and `offsetPt` mirror.
- It applies to every mark on the step, tagged or drawn: which way a fold goes
  is a property of the paper.
- **Not a crease-pattern step's Front | Back.** Zach decided on 2026-10-06 that
  it changes the face's colour only and does not flip the creases
  (`diagram/capture/creasePatternScene.ts:52-56`). It is the `recolouredOnly`
  path, which carries nothing, and it stays so.
- This lands before the split, or lifted steps print wrong instructions when
  turned over.

### 8. Replace, Way, Open in References

**Replace from References and the Way chooser** (RM6, recommended R-A): every
tagged mark follows the card, edited or not. One pure function,
`swapCardMarks(step, next)`, serves both `pullReferencesSteps`' Replace branch
and `setReferencesWay`.
- Every tagged mark goes. The new card's marks arrive with the step's toggles.
- The author's marks stay. If there are any, the notice shows, as today.
- If any edited marks went, a toast says "Replaced 2 marks you had edited ·
  Undo".
- One undo step.
- **Why edited marks go too.** If they stayed, nudging one arrow and then
  trying another way would leave two arrows, or two Ps, side by side. Ways are
  browsed to explore. The same happens on a Replace with the same card to get
  letters back.
- If the swap would pass the cap, the new card is pulled baked, with the toast
  from §5.

**An old baked step.** Replace and Way pull the new card lifted. The author's
marks stay, under the notice, as today.

**Open in References** does not change. It opens the plan's card as References
draws it.

### 9. Existing diagrams

Steps already in saved diagrams paint exactly as now. The reader never
rewrites a file.

**Make Marks Editable** converts one (RM8):
- Where: in Annotate's notice bar on such a step ("This step's marks are part
  of its picture." with Make Editable) and in the Step pane's References
  section.
- It lifts everything, with no toggles. Delete what you don't want.
- The author's marks stay, on top.
- `annotatedPictureKey` moves to the new key only if the author's marks were
  in step. The sheet does not move, so they stay right. A legitimate "picture
  changed" notice is never cleared silently.
- On an enlarged step, marks go into the window's units (§5).
- One undo step.
- When the lift would pass the cap, the verb is disabled with the reason
  ("612 marks: more than a step holds"), not offered and then refused.

### 10. File format (`diagram/document/diagramFile.ts`)

- `ANNOTATION_FIELDS` (≈line 1003) gains:
  - `'solid-line': fields('color', 'behind', 'imported')`;
  - `letter: fields('offsetPt', 'text', 'color', 'imported')`;
  - `imported` on every existing kind.
- `color` is read as `readFill` reads `fill`:
  - absent means the default;
  - a `#rrggbb` string is the colour;
  - any other string is a newer build's, so the mark is kept verbatim;
  - anything else is damage.
- `offsetPt` is two finite numbers, each within ±200 pt.
- `imported` is `'untouched'` or `'edited'`. Another string is a newer build's.
- `readReferencesSource` (≈line 727) learns `marks?: {letters, highlights}`.
  An older build drops it, which is harmless.
- `stepDiagramModelFile` does not change. Stored cards never carry `ink`;
  only compiled annotations do.
- **Older builds of this unreleased branch** treat every tagged mark and the
  new kinds as a newer build's: kept, not drawn, Turn over disabled. A pulled
  step there shows its paper without its marks, and the Way chooser does not
  match `-marks` keys. No file outside the branch holds a diagram, so this is
  acceptable.

### 11. Analytics

In `analytics/trackDiagram.ts`, `analytics/events.ts`, `docs/analytics.md` and
`implementation-plans/posthog-analytics.md`:
- **`diagram steps pulled from references`** gains `letters: shown|hidden`
  and `reference_lines: shown|hidden`, as `paper exported` reports them
  (`paperExport/savePaperExport.ts:125-154`), and `marks: lifted|baked` for
  the cap.
- **`diagram annotation added`** gains tools `solid_line` and `letter` in
  `annotationEventKind.ts`, with `color:
  ink|reference|red|orange|green|blue|purple|custom`. No hex is ever sent.
- **New `diagram annotation recolored`** `{kind, color}`.
- **New `diagram references marks lifted`** `{via: annotate_notice|step_pane,
  count_bucket}`.
- **New `diagram imported mark edited`** `{kind, edit: changed|deleted}`. It
  fires from the store action when a tag goes from `untouched` to `edited` or
  a tagged mark is deleted. It answers whether people edit what they pull. It
  can fire again for the same mark after an undo and a fresh edit, so it is a
  rough count.

### 12. i18n (en plus 8 locales)

New strings:
- the Line Type "Solid" and the tool name "Solid Line";
- Color, the seven swatch names and Custom…;
- the Show menu, Letters, Reference lines and their two hints;
- the new kinds' names in Layers ("Solid line", "Letter");
- the letter's Text and Reset Position rows;
- Make Editable, its notice, its disabled reason and its toast;
- the toasts for a card pulled baked and for replaced edited marks;
- under RM5, the export dialog's "Line highlights" renamed, with its hint.

Then `i18n:extract`, translate, `i18n:stamp` and `i18n:check`.

### 13. Tests

**`referencesCardMarks.test.ts`:**
- every style maps as in §2;
- the toggles drop letters and reference lines and keep rings;
- a mirrored card takes the back's directions;
- an arc compiled back from its fold-and-unfold arrow equals the original
  within 1e-9, front and back;
- each letter's `offsetPt` equals the `placeLabels` placement at 50 mm;
- the sheet keeps exactly the pieces that were not lifted;
- touching collinear pieces merge and disjoint ones do not (RM10);
- every mark is already in its cleaned, read-back form;
- a card past the cap stays baked.

**Equivalence (vitest, the CI gate).** Fixtures:
- a planner card with P, Q and R, a reference line, valley lines, fold arrows
  and rings (Zach's screenshot's step);
- a ReferenceFinder Find card with a pinch and its dotted rest;
- a band step;
- a pleat grid step;
- the finished card;
- an enlarged step whose window cuts a line and an arrow.

Each runs front and back, in the Diagram preset, Default and a coloured-paper
preset. The baked `stepDiagramScene` is compared with the sheet scene plus
`annotationScene`, at 50 mm:
- line items equal by role and endpoints, merged pieces by coverage;
- drawn SVG elements equal once groups are flattened, attributes within 1e-6,
  with lifted lines moved after the edge outline (§2);
- letters' boxes and halo fills equal, on the back too.

At twice the size, everything but letters must still match. Letters there are
checked against their `offsetPt`, not against `placeLabels`.

**Pages.** For each fixture laid out in a diagram, every step lands on the
same page and in the same cell. The sheet's printed size is within 2%:
`fittedSheetMm` now fits the sheet without its marks, and `cellPicture`'s loop
then shrinks it to the annotations' reach (`pagePictures.ts:252-278`,
`542-564`), so the two converge to slightly different sizes.

**Pixel comparison** (the phase's evidence, not a CI lane):
`artifacts/diagram-references-annotations/pixels.mjs` rasterises each
baked/lifted pair in headless Chromium, with Inkscape as the fallback, at a
fixed sheet size.
- Diagram preset: 0 differing pixels, unmerged fixtures, front and back.
- Merged folds: differences only in those lines' dash pattern.
- Default and coloured paper: differences only within a pen width of the
  sheet edge where a fold meets it, and ring colour.
- The before/after images go in the PR, with Zach's screenshot's step first.

**Turn over.** A front pull turned over equals a back pull in lines, kinds,
arrows and rings, with letters mirrored. A hand-drawn valley line becomes a
mountain line, and a valley arrow a mountain arrow. A crease-pattern step's
Front | Back renames nothing.

**Tags.** An unrelated edit leaves tags untouched. A changed mark goes to
`edited`. Carries, Duplicate and paste onto the same card keep tags; paste
elsewhere and a picture change drop them. Tagged marks carry on a step whose
author's marks are out of step.

**Replace and Way.** All tagged marks are swapped, edited too, with the toast.
The author's marks stay, with the notice. One undo step. An enlarged step's
marks arrive in window units. An old baked step's Replace pulls lifted.

**File.** Round trips. A colour, `offsetPt` or tag string from a newer build
is kept verbatim. Damage is dropped. An old baked step is offered Make
Editable, and a too-large one gets the disabled reason.

**Solid line and letter.** Hit testing, snapping, flip, clipboard, behind,
Layers rows, the rail's colour select and preference, Reset Position, the
PDF's font weight, and `SelectSwatch` moving with no change on screen.

**References.** The `cp-workspace/references` tests are in every phase's
gate, because `line`, `label` and `createDiagramRenderContext` grow there.

**Browser.**
- The Show menu changes the previews and what is pulled, and is remembered.
- Zach's screenshot's step pulled, then an arrow, a letter and the reference
  line's colour edited, then turned over.
- Performance: a 30-step References diagram in the Pages view and its PDF
  export, before and after. These steps now paint annotations in every
  `cellPicture` pass, where today they had none. If it is more than 10%
  slower, cache each step's compiled `annotationDrawing` by its marks and
  frame.

## Decisions for Zach

All DECIDED: the **(rec)** option in each (Zach, 2026-10-07: "please just go with your recommended answers for everything"). Zach's own answers, 2026-10-07, agree with the recommendations and are quoted where they apply.

**RM1. How do pulled letters look and sit? DECIDED: L3.**
- **L1.** A plain label with a colour: smaller, regular weight, no halo, and
  scales with the picture. Visibly not today's letter.
- **L2.** References' letter look at a fixed spot in picture units. As Fit each
  resizes the step, the gap to its ring drifts by up to about 40%.
- **L3 (rec).** References' letter look, standing at its point with an offset
  in pt, laid out once at 50 mm. Identical to today at 50 mm (cards, canvas).
  On pages it keeps its distance from its ring where today it can hop to
  another side as the cell's size changes.
- **L4.** Re-laid out on every paint, as References does. Letters then jump
  when you move other marks, and an edit to a letter's place cannot stick.

Why L3: it is the only one that is both editable and keeps the look at every
size.

**RM2. Choosing a solid line's colour. DECIDED: (rec).**
- A fixed palette only.
- A free picker only.
- **(rec)** Palette plus Custom: Ink, Reference magenta, red, orange, green,
  blue, purple, Custom….

Why: the palette covers diagrams' usual accents and keeps analytics to named
colours. Custom answers "choose the color" without a second control. The five
colours are print colours, not Edit's screen ones.

**RM3. Which marks have a colour, and what colour do pulled marks keep? DECIDED: (rec).**
- Which:
  - **(rec)** Solid lines and letters.
  - Every mark.
  - Solid lines only. Letters would then be black (L1) or fixed magenta.
- Pulled reference lines and letters:
  - **(rec)** Keep References' magenta: identical to today.
  - Take the style's ink: monochrome, matching the one-ink Diagram preset.

Why: colour on arrows and folds would bypass the paper style (Annotate's
decision 7), which nobody asked for.

**RM4. The import toggles. DECIDED: (rec)** — Zach: the show/hide choices live at import, "since they become editable" a toggle elsewhere "would be confusing".
- Where:
  - **(rec)** A Show ▾ menu in the browser's bar, the previews following it.
  - Checkboxes in the footer beside "With the turn-over before it".
- Remembered: **(rec)** yes, or no.
- A hidden mark:
  - **(rec)** Not pulled.
  - Pulled but hidden. That needs a per-mark visibility switch, a feature of
    its own.

Why: the bar is where the browser's view options live, and previews that
follow the menu show what you will get.

**RM5. One name. DECIDED: (rec).**
- **(rec)** "Reference lines" in the Show menu and the export dialog.
- Keep "Line highlights" in both.
- Different names in each.

**RM6. Replace from References and the Way chooser on a step with pulled marks. DECIDED: R-A** — Zach: "Replace should replace."
- **R-A (rec).** Every pulled mark follows the card, edited or not. Your own
  marks stay, with the notice. A toast with Undo says when edited marks went.
- **R-B.** Edited pulled marks stay, as D20 keeps an edited instruction. Nudge
  an arrow, try another way, and you have two arrows, or two Ps.
- **R-C.** Ask "Replace your edited marks too?" whenever any were edited. That
  is a dialog in the middle of browsing ways.
- **R-D.** Today's behaviour: nothing is swapped, the new card brings no marks.

Why R-A: it never leaves duplicates, Undo restores the edits, and your own
marks are never touched.

**RM7. Turning over renames folds. DECIDED: (rec).**
- What is renamed:
  - Lines only, References' own rule.
  - **(rec)** Lines plus valley and mountain arrows and a shaped arrow's fold,
    which also say a direction.
- Marks you drew: **(rec)** renamed too, or left.

A crease-pattern step's Front | Back is not affected: you decided on
2026-10-06 that it only recolours the face.

**RM8. Steps already in your diagrams. DECIDED: (rec)** — Zach: "For steps already in the diagram, i guess they just get rendered as a picture? ... if its easy not to have to migrate and it won't cause tech debt thats slightly preferred."
- **(rec)** Leave them, and offer Make Marks Editable in Annotate's notice and
  the Step pane.
- Convert them when the file opens.
- Never convert them.

Why: opening a file never changes it, and one click converts a step you
want to edit.

**RM9. What lifts. DECIDED: (rec)** — Zach: "If you mean aux crease, those stay in the picture. If you mean the pink highlighted lines, those are editable."
- Rings with no letter (ReferenceFinder's earlier marks):
  - **(rec)** Circles too, so every ring behaves the same and arrows land on
    them.
  - Stay in the picture.
- Grid and pleat steps:
  - **(rec)** Every line, pulled baked past the 500 cap.
  - Keep the line families in the picture.
- A step whose own fold is unassigned, and a pinch with no direction:
  - **(rec)** Stay in the picture for now.
  - The planner tags them, which changes References' model and goldens, and
    they lift as thin solid lines. That needs a second weight.

**RM10. One fold drawn in pieces. DECIDED: (rec).** The planner draws one crease as several
spans (`plannerDiagram.ts:1319-1352`).
- **(rec)** Pieces of one style that touch end to end merge into one line.
  Disjoint pieces, like two pinches, stay apart. The dashes then run as on
  References' own card, but differ from today's page along those lines.
- One annotation per piece: identical dashes, but you edit two or three
  segments for one fold.

**RM11. Can a step bring back marks you chose not to pull? DECIDED: (rec).**
- **(rec)** No: pull it again with Replace from References. The step stores
  only the paper, so nothing that paints it can draw a mark twice.
- Yes, with Letters and Reference lines toggles on the step at any time. The
  step keeps the whole card, and every reader of a picture has to filter it.

**RM12. A Letter tool in Annotate's rail. DECIDED: (rec).**
- **(rec)** Yes, beside Label, with no key in v1. On a picture that is not a
  References card its halo is page white.
- Pulled letters only.

**RM13. Pose. DECIDED: (rec).**
- **(rec)** Pulled marks ghost in Pose, as every annotation does.
- They show solid there, as they do today.

Why: Pose shows the paper. Ghosting every mark keeps it clear which are
marks, and a References step behaves like every other step.

### Small calls made here

Decided, not pending. Say if any is wrong.
- Letters are laid out at 50 mm, the size cards and the canvas draw.
- `annotationDrawing` gives `highlight` the arrow pen with no floor.
- Letters get a halo route of their own. `annotationInk` keeps whitening the
  faces for hollow arrows.
- The letter's field is `offsetPt`. `offset` is taken.
- The tag is a state, `untouched | edited`, kept by carries and changed only
  in `editStepAnnotations`.
- Tagged marks never count toward the "picture changed" notice and always
  carry.
- A circle's centre snaps at a picture point's rank (`pictureSnap.ts:53`),
  so a pulled ring snaps as the card's point did. This applies to drawn
  circles too.
- Make Editable moves `annotatedPictureKey` only if the author's marks were in
  step, and is disabled past the cap.
- Replace opens the browser on the step's own toggles. Way pulls with them.
- Way on an old baked step pulls lifted.
- The edge outline's draw order and the ring's colour in multi-ink styles are
  accepted differences.
- `SelectSwatch` moves out of `theme.css` before it gets a second user.
- The Line Type is "Solid", Zach's word, and the tool is "Solid Line", on
  Shift+L, though the Solid Arrow (S) uses "solid" to mean filled.
- `stepDiagramModelFile` learns nothing.

## Alternatives considered

- **Keep the full card and add a "lifted" flag** (storage B). It lets a step
  restore marks later (RM11). But every reader of `picture.model` has to
  filter it, and one missed reader draws marks twice. The flag also has to be
  a step key, or an older build drops it and double-draws after a save.
- **A digest stamp per mark** instead of a tag state. Normalising breaks it,
  and every carry has to re-stamp (§6).
- **A list of pulled ids on the source.** Duplicate and paste re-id marks.
- **Converting on file open.** The reader would rewrite files, and old steps
  would change look without being asked.
- **Letters re-laid out on every paint** (L4). Placement edits could not stick.
- **Colour on every kind.** It bypasses the paper style for arrows and folds.
- **A coloured `PaperLineItem` role.** It changes `packages/origami-simulator`
  and the `.osf` validator for one Diagram mark.
- **Keeping edited pulled marks on Replace** (R-B). It leaves duplicates.

## Risks

- **Merge conflicts.** Other agents are editing `annotationCarry`,
  `annotationClipboard`, `diagramFile` and the zoom code. Start each phase
  only when that work has landed and `git status` is clean under `diagram/**`.
- **Shared References code grows.** `line` and `label` gain `ink`, `line`
  gains `hidden`, and `createDiagramRenderContext` takes placements. References
  must not change; its tests are in every gate.
- **Ring colour and the clip in multi-ink styles.** Baked marks go through
  `onAndOffPaper`; annotation marks skip the clip. The coloured-paper fixture
  shows whether it matters. If it does, the letter context's clip (§4) is
  reused for the rest.
- **Hidden letters and the instruction.** With Letters off, the instruction
  still names them. The hint is the only mitigation.
- **Crowding.** A grid step lifts dozens of lines into the Layers pane, and
  Annotate has no multi-select yet.
- **Turning over existing steps.** 17c changes what Turn over does to
  hand-drawn lines on References steps already in diagrams. It is a fix, but
  a visible one.
- **Performance.** Every References step now paints annotations in every page
  pass. Measured in 17d.
- **Letters on pages.** Under L3 a page letter can sit on another side of its
  ring than today's page puts it. It matches the canvas instead.

## Affected Areas

- **The split:**
  - `diagram/references/referencesCardMarks.ts` (new) and its test;
  - `diagram/references/referencesPulledSteps.ts` (`referencesCardPicture`,
    `pullCards`, `SentReferencesStep`);
  - `diagram/references/referencesStepWays.ts` (`keyOf`);
  - `cp-workspace/references/diagramToPaperScene.ts` (the exported letter
    placement).
- **Model, document and file:**
  - `diagram/document/diagramDocument.ts` (kinds, `color`, `offsetPt`,
    `imported`, `DiagramReferencesSource.marks`, `pullReferencesSteps`,
    `setReferencesWay`, `swapCardMarks`, `releaseCardMarks`,
    `editStepAnnotations`, `annotationsOutOfStep`, `duplicateStep`, Make
    Editable);
  - `diagram/document/diagramFile.ts` (`ANNOTATION_FIELDS`, `readAnnotation`,
    `readReferencesSource`, the writer).
- **Annotations:**
  - `diagram/annotate/annotationModel.ts` (`ANNOTATION_SHAPES`,
    `carryAnnotation`'s `otherSide`);
  - `annotationPrimitives.tsx` (compile, the `highlight` pen, the letter
    context, `withHidden`, `annotationReach`, `annotationTextRuns`);
  - `annotationCarry.ts` (`pictureMove`, the out-of-step rule);
  - `annotationClipboard.ts` (paste and the tag);
  - `annotationHit.ts`, `pictureSnap.ts`, `annotateSnap.ts`,
    `applyAnnotationEdit.ts`, `annotateTools.ts`, `lineTypes.ts`,
    `paintAnnotations.ts`;
  - `diagram/zoom/zoomFrames.ts` (`carryMarks`, `followOwnPicture`).
- **Shared References drawing:**
  `cp-workspace/references/referenceFinderDiagramToPrimitives.ts` (`ink`,
  `hidden`), `cp-workspace/references/diagram/DiagramPrimitives.tsx` (given
  placements, `ink`, `line` hidden stretches).
- **Pages:** `diagram/pages/pagePictures.ts` (the paper for letters, Noto Sans
  700).
- **UI:**
  - `components/diagram/DiagramAnnotateRail.tsx`, `DiagramLayers.tsx`,
    `DiagramAnnotateCanvas.tsx`, `DiagramAnnotationLayer.tsx`,
    `DiagramAnnotateToolGlyph.tsx`;
  - `components/diagram/DiagramReferencesBrowser.tsx` (the Show menu);
  - the Annotate notice bar and the Step pane's References section;
  - `components/ui/Select.tsx` and `Select.module.css` (`SelectSwatch`),
    `cp-workspace/CpTextEditor.tsx`, `styles/theme.css` (`.select-swatch`
    out, ratchet lowered);
  - `components/paperExport/PaperExportOptions.tsx` (under RM5);
  - `store/settingsStore` (the line colour and the Show preference);
  - `store/workspaceStore/slices/diagramSlice.ts` (the verbs, analytics).
- **Keys:** `keyboard/shortcuts.ts`, `diagram/useDiagramShortcuts.ts`,
  `i18n/shortcutLabels.ts`.
- **Analytics and i18n:** `analytics/trackDiagram.ts`, `analytics/events.ts`,
  `diagram/annotate/annotationEventKind.ts`, `docs/analytics.md`,
  `implementation-plans/posthog-analytics.md`, `public/locales/*` (9
  catalogs).
- **Plans:** this plan; D25 and Phase 17 in `diagram-workspace.md`.

## Checklist

Every phase gets:
- tests near what changed, and the `cp-workspace/references` tests;
- analytics and i18n for what it adds;
- browser before/after shots with a confidence level for each claim;
- the dev-server link;
- a gate: lint, typecheck, `test:web`, `i18n:check`, green and shared before
  the next phase.

Vitest runs in the web workspace under Node 22.

### Phase 0: decisions

- [x] Zach answers RM1–RM13; record each here with his words. Every recommendation, 2026-10-07.

### 17a: Solid line

- [ ] `SelectSwatch` in `components/ui/Select` with its module; `.select-swatch`
  out of `theme.css`; `CpTextEditor` on it; the ratchet lowered. Its own
  commit, computed styles matching before and after.
- [ ] `solid-line` in the model, `ANNOTATION_SHAPES` and every exhaustive switch.
- [ ] `line` gains `ink` and `hidden` in References' primitives, drawn by
  `diagramShapes`; References' tests unchanged.
- [ ] `annotationDrawing`'s `highlight` override; `annotationReach` for `line`.
- [ ] The Solid Line Type segment, Shift+L, the rail's colour select with its
  preference, and the Layers Color row.
- [ ] Behind, flip, clipboard and snapping.
- [ ] File: `color` and the new kind; tests.
- [ ] Analytics (`solid_line`, `color`, `annotation recolored`) and i18n.
- [ ] Browser: a solid line in each palette colour and a custom one, behind a
  flap, on a page and in the PDF; a printed proof of the five colours.

### 17b: Letter

- [ ] `letter` in the model with `from`, `offsetPt`, `text` and `color`.
- [ ] `createDiagramRenderContext` takes given placements; `label` gains `ink`.
- [ ] The letter's own context with the picture's paper and side, passed by
  cards, pages, the canvas, step files and close-ups.
- [ ] `annotationReach` for the letter's box; `annotationTextRuns` at 700.
- [ ] Dragging, the anchor, Text and Color rows, Reset Position.
- [ ] The Letter tool, if RM12 says yes.
- [ ] File, analytics (`letter`) and i18n.
- [ ] Browser: a letter on a front and a back References step in the Diagram
  preset, halo against the grey back; the PDF's font.

### 17c: Turn over renames folds

- [ ] `otherSide` on the References `PictureMove`; `carryAnnotation` swaps per
  RM7.
- [ ] Tests: hand-drawn lines and arrows turned over; a crease-pattern step's
  Front | Back unchanged.
- [ ] Browser: before/after of a hand-drawn valley line on a References step
  turned over.

### 17d: The split at import

- [ ] `liftCardMarks` and its tests, with the letter placement exported from
  `diagramToPaperScene`.
- [ ] The `-marks` key; `keyOf` strips it.
- [ ] The tag: set at the lift, kept by carries and Duplicate, changed in
  `editStepAnnotations`, paste by card key, `releaseCardMarks`.
- [ ] Tagged marks never out of step: `annotationsOutOfStep`,
  `withCarriedAnnotations`, `followOwnPicture`.
- [ ] `pullReferencesSteps` with annotations and `annotatedPictureKey`;
  enlarged steps through `unitsMove`; the cap and its toast.
- [ ] The Show menu, its preference, the previews and `source.marks`.
- [ ] `swapCardMarks` for Replace and Way, with the toast.
- [ ] Analytics (`steps pulled` properties, `imported mark edited`) and i18n.
- [ ] The equivalence and page tests; the pixel probe and its images.
- [ ] Performance on a 30-step diagram, before and after.
- [ ] Browser: Zach's screenshot's step pulled, edited and turned over;
  Replace and Way with an edited mark; the toggles.

### 17e: Existing steps

- [ ] Make Marks Editable in Annotate's notice and the Step pane, with the
  disabled reason past the cap.
- [ ] `diagram references marks lifted`; i18n.
- [ ] The export rename, if RM5 says so.
- [ ] Browser: an old diagram opened unchanged, then a step made editable.

### 17f: Close-out

- [ ] As-built notes here, and D25 with Phase 17 in `diagram-workspace.md`.
- [ ] Full gate: lint, typecheck, `test:web`, `i18n:check`, `build:web`.
- [ ] PR notes with any skipped checks and why.
