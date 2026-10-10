# Diagram: a References step's marks as annotations

**Status: planned 2026-10-07; 17a–17f built the same day (17f's close-out at the end). Decisions RM1–RM13 are DECIDED** — his own answers are quoted under RM3, RM4, RM6, RM8 and RM9, RM12 is superseded by his Text request, and the rest take the recommendation (Zach, 2026-10-07: "use your recs and include the enlarged steps follow ups in the branch"). It lands in a PR of its own, stacked on #436 (the same answer).

**Revised 2026-10-07: there is no `letter` kind.** A pulled letter is a Text annotation (`label`), and Text gains the options it needs (§4). Zach: "why is letter different from text annotation in diagram references? Id rather just extend text to have color / any other options we need". RM1 and RM3 now speak of Text options, RM12 is superseded, and Reset Position is dropped.

This builds on D6 (a References step is a snapshot), D8 (the annotation model,
and when a picture changes), D20 (pulling through the browser), D22 (turns are
not steps) and D23 (the Way chooser) in `implementation-plans/diagram-workspace.md`,
on Annotate's decision 7 (`diagram-annotate.md`: marks are in the arrow ink),
on 15e (behind a flap) and on Revision 2's enlarged steps (16f,
`diagram-revision-2.md`). When built it is D25 and Phase 17 there.

Conventions:
- Paths are under `apps/web/src/` unless they say otherwise.
- Line numbers are at c716ce3f4 (HEAD), checked on 2026-10-07. Other agents'
  uncommitted edits under `diagram/**` may have shifted some of them.
- *Text* is the `label` kind: Annotate's Label tool, in the rail's Text group.
  *Hung text* is Text with an `offsetPt` (§4).
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
   as annotations. A letter is ordinary Text, with options any text can use
   (§4). The step looks as it does today until someone edits one.
2. **Solid lines with a colour.** A fourth Line Type, Solid, for any step.
   A reference line imports as one.
3. **Show or hide on import.** Letters and Reference lines, with the same
   filter and defaults as the export dialog's Marks.

His screenshot's step would arrive as twelve annotations: two valley lines,
one magenta solid line, three circles, three letters as Text (bold, haloed,
magenta) and three fold-and-unfold arrows. The picture keeps the paper.

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
  folds, the reference lines, the rings, the letters and the fold arrows. A
  letter becomes Text; there is no letter kind.

Nothing has to be parsed, because a card is already a list of typed pieces in
known coordinates. `stepDiagramToPicture(model, mirrored)`
(`diagram/pictures/paintStepDiagram.ts:75`) already maps a card point to
picture units, and D8 makes the sheet box a References picture's frame, so
lifted marks land where the card drew them.

Six rules:
- **Looks the same.** In the Diagram preset, a pulled step paints the same
  pixels as today at the 50 mm the cards and canvas draw, but for the letters'
  typeface on screen (§4). Where it cannot, this plan says so and why (Tests).
- **A snapshot, not a link** (D6). The pull changes the Diagram's copy only.
  References' cards, exports and goldens do not change. Diagram edits never
  flow back.
- **One Text.** A pulled letter is a Text annotation. The options it needs (a
  colour, bold, a halo, a print size and an offset from its point) are Text's,
  for any text (§4).
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
- every letter, as Text;
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
| `label`: A–J and P–Z | Text (`label`): the letter, bold, haloed, 9 pt, magenta, hung from the point it names by `offsetPt` (§4) | Yes at 50 mm, to the pixel as a page sets it. On cards and the canvas the same place, size, colour and halo, in Text's typeface (§4). Stable at other sizes (RM1). |
| `region`, `dotted`, `unfolded`, `pinch`, `crease`, `aux`, `fold-*`, `sheet` | stay in the picture | Unchanged |

**Order.** Lifted marks are emitted in the card's primitive order, which is
`diagramShapes`' draw order, so stacking matches. Text draws over every other
mark, as every label does (`annotationMarks`, `annotationPrimitives.tsx:876-892`).
The planner pushes its letters last (`plannerDiagram.ts:1370`), so its
letters' halos stack as today; the equivalence test checks every fixture.
Lifted marks go before any marks the author has drawn.

**Draw order against the sheet's edge.** The baked scene draws the sheet's
edge outline over the step's fold lines (`diagramToPaperScene.ts:253-263`).
Annotation lines paint after the whole picture (`pagePictures.ts:618`). In a
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
- `annotationDrawing` (`annotationPrimitives.tsx:513-530`) overrides `arrow`
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
  (`DiagramLayers.tsx:271-288`). Changing the type away from Solid drops the
  colour. Text has the same row (§4).
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
- Text's Color row and the rail's Text Style use this same select (§4).
- The swatch in a select item is the global `.select-swatch`
  (`styles/theme.css:6106`), whose one owner is `CpTextEditor`. It moves into
  `components/ui/Select.module.css` as a `SelectSwatch` part, in a commit of its
  own that changes nothing on screen, before the colour select uses it.

### 4. Text gains colour, weight, halo, size and an offset

There is no `letter` kind. A pulled letter is Text: the `label` kind,
Annotate's Label tool in the rail's Text group. Text gains five optional
fields, and a pulled letter is one use of them. Each field is absent on every
label drawn today, so existing diagrams draw exactly as now.

**Model.** `{id, kind: 'label', from, to, text, color?, bold?, halo?, sizePt?,
offsetPt?, imported?}`.
- `color`: a `#rrggbb` string, from the solid line's colour select (§3, RM2).
  Absent, the style's arrow ink, as a label is drawn today
  (`annotationPrimitives.tsx:576`).
- `bold`: written only `true`, as `numbered` and `mirrored` are. The text
  fonts come in Regular and Bold only (`fonts/diagramFontFaces.ts:17`), so a
  weight field could say nothing more.
- `halo`: written only `true`. The text is knocked out of what it stands on.
- `sizePt`: the text's em in print pt. Absent, 5% of the frame (`LABEL_SIZE`,
  `annotationModel.ts:133`), so the text scales with its picture, as D8 has it.
- `offsetPt`: `[dx, dy]` in print pt, y down. The text's centre is drawn at
  `from` plus this. Absent, the centre is at `from`, as today.

`from` keeps one meaning: the point the text is anchored at. With no offset the
text is centred on it. With one, the text hangs off it and keeps its distance
in print at every size, as a References letter keeps its distance from its
ring. `to` stays equal to `from`.

**Why a size too.** The design put to Zach named colour, weight, halo and an
offset. The code needs a size as well, one of the "other options we need".
- A References letter is 9.6 ink, which is 12 CSS px, 9 pt, at every print
  size (`DIAGRAM_LABEL_INK`, `diagramInk.ts:441`; one ink is 1.25 CSS px,
  `canvasInk.ts:31-37`).
- A label is 5% of its frame: 9.45 CSS px at the 50 mm the cards and canvas
  draw, and larger or smaller with the page cell.
- Without `sizePt`, a pulled letter would be a fifth smaller than today's at
  50 mm, and would grow and shrink on pages, which is L2's drift (RM1). And a
  letter made by hand could not match a pulled one, which retiring RM12 relies
  on.

**How it is drawn.** Text keeps its own element, `labelElement`
(`annotationPrimitives.tsx:754-772`), so it keeps its script fonts
(`labelRuns`). References' label code is not used for it, so
`createDiagramRenderContext` and References' `label` primitive do not change.
- `compileAnnotation` carries the options. `annotationDrawing` (`:573-578`)
  puts the centre at `from` on the frame plus `offsetPt` × 4/3 px, the size at
  `sizePt` × 4/3 px or `LABEL_SIZE` × the frame, and the fill at `color` or
  the arrow ink.
- Bold writes `font-weight="700"` on the `<text>` and its runs.
  `setUploadText` reads the weight off the markup (`upload/uploadText.ts:67-69`),
  so a page sets and counts the Bold face.
- The halo is References' look: a stroke under the fill (`paint-order:
  stroke`, round joins), 0.3125 em wide. That is References' 3 ink halo on its
  9.6 ink letter, so a pulled letter's halo is today's.

**What the halo is filled with.** What the text stands on:
- on a References picture, the paper's face where the text's centre is on the
  sheet: white on the front and grey `#b3b3b3` on the back in the Diagram
  preset (`lib/paper/paperPresets.ts:52`). That is the test a baked letter
  makes (`labelOnPaper`, `DiagramPrimitives.tsx:462-477`, used at `:1011`).
- page white off the sheet, and on every other picture.

`annotationInk` whitens both faces on purpose, so a hollow push or a white
arrow is filled with page white (`annotationPrimitives.tsx:284-304`). So:
- `annotationDrawing` takes an optional `paper`: the sheet's outline in
  picture units, its side, and the style's two face colours, read from the ink
  before it is whitened. A References picture's sheet is its frame (D8). On an
  enlarged step it is that frame in the window's units.
- Cards, pages, the canvas, step files and close-ups pass it for a References
  picture. Other pictures pass none.

**PDF.** `annotationTextRuns` (`annotationPrimitives.tsx:465-477`) hard-codes
400 (`:473`). It learns `bold`, so `diagramFontTexts`
(`pages/diagramPages.ts:364-372`) loads and embeds Noto Sans 700, and a CJK
face's Bold for CJK text. A lifted step's sheet holds no letters, so
`labelsOf` (`pagePictures.ts:878-884`) asks for nothing there.

**Measuring it.** `labelHalfWidth` (`annotationModel.ts:955`) measures Latin by
Noto Sans Regular's advances (`labelAdvances.ts`). Bold Latin sets wider, so a
long bold label's hit box, selection and crop would fall short.
- `labelAdvances.ts` gains Noto Sans Bold's advances, kept equal to the bundled
  `NotoSans-Bold.ttf` by its test.
- `labelHalfWidth` takes the weight and the size.
- `bodyDistance` (`annotationHit.ts:705-711`) measures a label round its
  centre, at its size: `from` plus the offset, in picture units as the canvas
  draws the frame (50 mm, `CARD_FRAME_PX`). `canvasInk.ts` gains
  `ptInPictureUnits` beside `mmInPictureUnits`.
- `annotationReach` (`:742-748`) counts a label at its size and weight, with
  its halo, so Fit each and the cell's size loop count it.

**Dragging.**
- **Text with no offset** drags as it does today. A press on it moves it whole
  (`useAnnotateCanvas.ts:934-939`). It never snaps: a label is put beside what
  it names (`annotateSnap.ts:40-50`).
- **Hung text, by its words,** drags as a callout's box does
  (`useAnnotateCanvas.ts:943-948`). The words go by the pointer's travel, and
  `offsetPt` changes, in pt at the canvas's 50 mm. `from` stays, and nothing
  snaps.
- **Hung text, by its anchor.** Selected, it shows one dot at `from`, as a
  callout shows its point (`annotationEnds`, `annotationModel.ts:901`, which
  answers per annotation, not per kind, for a label). Dragging the dot moves
  `from`, which snaps to
  circles, line ends and crossings as a callout's point does (`snapsEnd`,
  `annotateSnap.ts:81`). The words follow, the offset kept. The anchor is on
  what the text names, so it snaps where plain text does not.
- `moveAnnotation` does not change. A paste offsets a copy whole
  (`annotationClipboard.ts:149`), anchor and words together.
- **Text is anchored to a point, not linked to a mark.** Moving a circle
  leaves its letter behind, and Annotate has no multi-select yet.
- No verb adds or removes an offset in v1. Only the lift makes hung text, and
  Duplicate, copy and paste keep it.

**Reset Position is dropped.** It applied to pulled letters only, and it had
to rebuild a References model from the step's marks to run `placeLabels`
again. Undo takes back a drag, and Replace from References lays every pulled
mark out again from the card (RM6). A verb that works on some Text and not the
rest is the special case this revision removes.

**Carrying it.** A label's words stay upright, as today (`carryAnnotation`,
`annotationModel.ts:1803-1810`). Hung text's offset is carried as a callout's
box is (`carryCallout`, `:1914`): turned and mirrored by `move.vector`, its
length kept in pt. Turn over and Upright keep a letter on the same side of its
ring.

**UI.**
- **Rail.** While the Label tool is in hand, a Text Style group sits under the
  Text group, one control across the rail as Line Type is: the colour select,
  Bold and Halo toggles, and Size. They set the next text's style, kept as
  `settingsStore` preferences, as the solid line's colour is (§3). Their
  defaults are today's look: ink, regular, no halo, with the picture.
- **Layers.** A selected label gets Color, Bold, Halo and Size rows under its
  Text row (`DiagramLayers.tsx:228-241`), on `SelectRow` and `ToggleRow`
  (`components/ui/fieldRows/`). The Color row is the solid line's (§3).
- **Size** offers With the picture (unset), 7, 9, 12 and 16 pt. A References
  letter is 9 pt, and a label at 50 mm is about 7. A size from a file that is
  not one of these shows as its own item, as a custom colour does.
- The rows are keyed on `label`, not on `carriesText`, which the Text row
  shares with Callout.

**Callout keeps its look** (recommended; not in this plan). Its words sit in a
white box outlined in the arrow ink, so a halo means nothing there. Its line is
already its offset. Its box is sized from its words at a share of the frame
(`calloutHalfBox`, `annotationModel.ts:1178`), so a size or a weight would
resize the box everywhere that measures it. A colour would have to say whether
it inks the words, the box or the line. None of that is nearly free, and
nobody has asked for it. A later change can give Callout `color` and `bold`
through the same fields and controls.

**A pulled letter** is Text with:
- `text`: the letter;
- `from`: the point it names, in picture units;
- `color: '#c91d87'` (RM3), `bold`, `halo` and `sizePt: 9` (RM1);
- `offsetPt`: from References' placement at 50 mm, below.

**Where the lift puts it** (RM1). The lift places letters with the same
`placeLabels` call `diagramToPaperScene` makes
(`diagramToPaperScene.ts:170-182`), at a 50 mm sheet (`DEFAULT_PAPER_SIZE_MM`),
the size the cards and canvas draw a References step
(`paintDiagramStep.ts:176`). That call is exported from
`diagramToPaperScene.ts` as one function, so the two cannot drift apart.
- References anchors a letter at its edge nearest its point
  (`labelLayout.ts:204-216`). Text is centred. The lift turns the anchor into a
  centre with the letter's Noto Sans Bold advance, the face a page sets both
  in, so a page draws the same glyph in the same place.
- Its height needs no conversion. References' baseline is 0.86 of the box
  down (`labelLayout.ts:215`), and Text's is 0.36 em below its centre
  (`LABEL_BASELINE`, `annotationPrimitives.tsx:133`). With the centre at the
  box's middle, they are the same line.
- At 50 mm the letter is where it is today.
- At any other size it keeps its distance from its ring in pt. Today a page
  cell re-runs `placeLabels` at the cell's size (`pagePictures.ts:720-731`),
  and collision costs against lines that scale with the sheet can move a
  letter to another side (`labelLayout.ts:251-323`). A lifted letter stays
  where the canvas shows it. That is *stable*, not *identical*.

**On screen.** A baked letter names the References font (`INLINE_LABEL_FONT`,
`DiagramPrimitives.tsx:88`), and a page swaps it for Noto Sans
(`pagePictures.ts:743`). A pulled letter names Noto Sans everywhere, as every
label does. So on cards and the canvas its typeface can differ from today's.
Its place, size, colour and halo do not.

### 5. The import

**Converter.** A new pure module, `diagram/references/referencesCardMarks.ts`:
`liftCardMarks(model, mirrored, marks)` returns `{sheet, annotations}`.
1. Filter with `referencesStepDiagramMarks(model, marks)`
   (`cp-workspace/references/referencesStepExport.ts:131`), unchanged.
2. Read directions through `seenFromTheBack` when the card is mirrored.
3. Map points with `stepDiagramToPicture(model, mirrored)`.
4. Merge touching collinear pieces of one style (RM10).
5. Turn letters into Text, each offset from the shared `placeLabels` call at
   50 mm (§4).
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
an enlarged step map lifted marks through `unitsMove` (`zoomFrames.ts:118`)
into the window and run under `withAnnotationReach(stepReach(step))`. The
window shows a mark near it whole (`marksInWindow`), where the baked picture
cuts it at the window's edge. So a lifted line or arrow that crosses the edge
draws past it. Lines and solid lines are cut to the window at the lift; other
marks are kept whole and the difference is accepted. A fixture covers it.

*Revised in 17d's review (2026-10-07).* "Kept whole" proved wrong on a real
page: crane's last step, enlarged round the head and filled with Card 2, drew
the card's fold-and-unfold arrow whole, two arcs across the steps beside it and
off the page, and Card 1 pulled after it printed folds that lie wholly outside
its window under the next step's text — where the baked card is cut at the
frame. Now a step never draws more of its card than the baked picture showed:
at the lift into a window (Fill, Replace and Way through `marksIntoUnits`, and
a card pulled after an enlarged step through `seedNewSteps`), a line is cut at
the frame and dropped when it misses it, and any other mark is pulled only
when every point it is drawn through — an arrow's ends and the top of its arc,
a ring's centre, the point a letter hangs from — is in the frame, or no
further past its rim than a cut line runs (`liesInFrame`). One the frame cuts
is not pulled at all: a mark cannot be cut as a picture is, and half an arrow
says nothing. Enlarging a pulled step by hand later is the author's edit and
keeps every mark, as it keeps the author's own. This was the 16g open
question's visible consequence; the other way out — a References pull never
keeping or seeding an enlarged frame — stays open for Zach, and would lose the
frame a seeded empty step was made with.

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
  `withCarriedAnnotations`, zoom's `carryMarks` (`zoomFrames.ts:157-177`),
  `followOwnPicture`, and enlarge and unenlarge.
- **Duplicate Step** keeps it: the copy shows the same card.
- **Paste** keeps it only onto a step showing the same card (same key, less
  `-back`), as the clipboard records, and only as the one copy there: where
  no copy of it lies yet (the clipboard's `pastes`). Anywhere else a pasted
  mark becomes the author's. Cut and paste in place therefore keeps it; a
  copy pasted beside the original, or a second paste, is a mark the author
  made — a second P placed by hand — which a Replace must not take unsaid
  (refined in 17d's review).
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
- `withCarriedAnnotations` (`annotationCarry.ts:417-435`) and
  `followOwnPicture` carry tagged marks even when the author's are out of
  step. Today an out-of-step step carries nothing, so after a Replace that
  kept the author's marks, a Turn over would leave the fresh card's marks on
  the wrong side.

**Telling an old step from a lifted one.** An old step's model still holds
liftable pieces. No flag is needed.

### 7. Turn over renames folds

`setReferencesSide` → `withCarriedAnnotations` → `pictureMove`
(`annotationCarry.ts:147`) gives `mirrorMove`, which moves geometry but never
renames a fold. The baked picture renamed its folds through `seenFromTheBack`.
Once folds are annotations, a turned step would print the front's valley as a
valley. Hand-drawn lines on References steps have this bug today.

- The References `PictureMove` gains `otherSide: true`, and `carryAnnotation`
  swaps under it (RM7):
  - `valley-line` ↔ `mountain-line`;
  - `valley-arrow` ↔ `mountain-arrow`, and a shaped arrow's `fold`.
- Fold-and-unfold arrows, solid lines, circles and Text only move. Hung
  text's offset mirrors with its anchor (§4).
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
- **The notice.** Editing only the card's marks never puts the author's back
  in step: `editStepAnnotations` moves `annotatedPictureKey` only when the
  author's marks are touched, or none were out of step (17d review: nudging
  the new card's arrow cleared the notice on marks the author never looked
  at).

**An old baked step.** Replace and Way pull the new card lifted. The author's
marks stay, under the notice, as today — unless the card is the one the step
showed, from the same side: its sheet has not moved under them, so marks in
step with the baked picture stay in step with the lifted one, as Make
Editable keeps them (§9; 17d review).

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

*As built, after 17e's review (2026-10-07):*
- **An enlarged step does not look the same after.** §5's rule for a lift
  into a window applies, as this section says: a line is cut at the frame
  and runs `ZOOM_LINE_OVERSHOOT` past it, any other mark is lifted only when
  it lies in the frame, and one the frame cuts is not lifted at all. So
  where the baked picture showed an arrow cut at the frame, the converted
  step shows none; a letter whose point is just inside the rim draws whole
  past it. This is the one place a converted step does not look as it did,
  and §5 and §9 together say it should. Nothing is lost silently: the toast
  counts the marks the step holds now and says how many the frame left out,
  with Undo ("Step 2’s 4 marks are editable now · 6 marks outside the
  enlarged frame were left out"). Whether to keep that, or instead leave the
  marks the frame cuts baked in the sheet so the picture is unchanged (a
  partly lifted sheet: a new key form, a frame-aware notice, and a second
  Make Editable after Unenlarge that adds rather than swaps), or hold the
  verb on an enlarged step, is open for Zach (17e as built, "Open for
  Zach").
- **The cap counts the whole card**, as a pull's does (`fits`, §5): on an
  enlarged step it is the card's marks beside the author's, not only those
  the window would take. The reason names the limit, and the author's marks
  when there are any: "612 marks: a step holds 500", "501 marks with yours:
  a step holds 500".
- **Marks the author had edited that go.** A copy of an edited mark of the
  card, pasted onto the old step, keeps its tag (the clipboard), so the swap
  takes it with the rest (RM6); the toast says so with Undo, as Replace and
  another way do.
- **Where it is offered.** Annotate's notice shows in the Step pane and over
  the Layers pane's list (whose "Nothing drawn yet." said nothing of the
  marks the picture holds). The Step pane's Picture section leaves the verb
  out while Annotate's notice offers it, as it leaves out Adjust Pose in
  Pose. Out of Annotate the Annotations summary of such a step with no marks
  of its own reads "Its marks are part of its picture", not "No
  annotations".

### 10. File format (`diagram/document/diagramFile.ts`)

- `ANNOTATION_FIELDS` (`diagramFile.ts:1004`) gains:
  - `'solid-line': fields('color', 'behind', 'imported')`;
  - on `label` (`:1019`, today `fields('text')`): `color`, `bold`, `halo`,
    `sizePt`, `offsetPt` and `imported`;
  - `imported` on every other existing kind.
- `color` is read as `readFill` reads `fill` (`:1260`):
  - absent means the default;
  - a `#rrggbb` string is the colour;
  - any other string is a newer build's, so the mark is kept verbatim;
  - anything else is damage.
- `bold` and `halo` are read as `numbered` is (`:1556`): absent or false, no;
  true, yes; anything else is damage. They are written only true.
- `sizePt` is a finite number from 4 to 48. A larger one is a newer build's;
  anything else is damage.
- `offsetPt` is two finite numbers, each within ±200 pt. A larger one is a
  newer build's.
- `imported` is `'untouched'` or `'edited'`. Another string is a newer build's.
- The writer writes Text's fields only when set, so a plain label is written
  as today.
- `readReferencesSource` (`:729`) learns `marks?: {letters, highlights}`. An
  older build drops it, which is harmless.
- `stepDiagramModelFile` does not change. Stored cards never carry `ink`;
  only compiled solid lines do.
- **Older builds of this unreleased branch.** The reader keeps an annotation
  with a field it has no name for verbatim, as a newer build's (`:1069`). So
  an older build keeps a label with any of Text's new fields, and every tagged
  mark, and the new `solid-line` kind: kept and saved back as they were, not
  drawn, Turn over disabled. A plain label reads as today. A pulled step there
  shows its paper without its marks, and the Way chooser does not match
  `-marks` keys. No file outside the branch holds a diagram, so this is
  acceptable.

### 11. Analytics

In `analytics/trackDiagram.ts`, `analytics/events.ts` and `docs/analytics.md`
— the one place the Diagram's events are documented, as every Diagram phase's
are; `implementation-plans/posthog-analytics.md`'s table holds the original
rollout's domain events and has no Diagram rows (amended in 17d's review):
- **`diagram steps pulled from references`** gains `letters: shown|hidden`
  and `reference_lines: shown|hidden`, as `paper exported` reports them
  (`paperExport/savePaperExport.ts:125-154`), and `marks: lifted|baked` for
  the cap.
- **`diagram annotation added`** gains the tool `solid_line` in
  `annotationEventKind.ts`. There is no `letter` tool: a letter is `label`.
  It gains, enums only:
  - `color: ink|reference|red|orange|green|blue|purple|custom`, on
    `solid_line` and `label`. No hex is ever sent.
  - on `label`, the rail's Text Style: `bold: on|off`, `halo: on|off` and
    `size: picture|7|9|12|16|other`.
- **New `diagram annotation recolored`** `{kind, color}`: a solid line's or a
  label's colour changed in Layers.
- **New `diagram text styled`** `{option: bold|halo|size, value:
  on|off|picture|7|9|12|16|other}`: a label's Bold, Halo or Size changed in
  Layers. It answers whether people style text beyond what they pull.
- **New `diagram references marks lifted`** `{via: annotate_notice|step_pane,
  count_bucket}`. *As built (17e):* `via` also `card_menu`, as the Step
  pane's verb is the step catalog's, which the card's menu shares, and
  `layers_notice`, Annotate's notice over the Layers pane's list (17e's
  review). `count_bucket` is the marks the step holds from its card after,
  not the card's whole lift: fewer on an enlarged step (§9).
- **New `diagram imported mark edited`** `{kind, edit: changed|deleted}`. It
  fires from the store action when a tag goes from `untouched` to `edited` or
  a tagged mark is deleted. It answers whether people edit what they pull. It
  can fire again for the same mark after an undo and a fresh edit, so it is a
  rough count. A pulled letter reports as `label`.

### 12. i18n (en plus 8 locales)

New strings:
- the Line Type "Solid" and the tool name "Solid Line";
- Color, the seven swatch names and Custom…;
- Text's style: the rail's "Text Style", Bold, Halo and its hint (as built,
  after review: "Outlines the text so it reads over lines: in the colour of a
  References sheet under it, and in white anywhere else."), Size, "With the
  picture" and "{{size}} pt";
- the Show menu, Letters, Reference lines and their two hints;
- the new kind's name in Layers ("Solid line");
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
- each letter is a label with its letter, `#c91d87`, bold, halo and 9 pt, and
  its glyph lands where `placeLabels` puts it at 50 mm, the anchor turned into
  a centre by Noto Sans Bold's advance, front and back;
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
- drawn SVG elements other than letters equal once groups are flattened,
  attributes within 1e-6, with lifted lines moved after the edge outline (§2);
- letters, as a page sets them, start at the same x on the same baseline at
  the same size and weight, with the same fill and the same halo width and
  fill, on the back too.

At twice the size, everything but letters must still match. Letters there are
checked against their `offsetPt`, not against `placeLabels`.

**Pages.** For each fixture laid out in a diagram, every step lands on the
same page and in the same cell. The sheet's printed size is within 2%:
`fittedSheetMm` now fits the sheet without its marks, and `cellPicture`'s loop
then shrinks it to the annotations' reach (`pagePictures.ts:251-283`,
`565-580`), so the two converge to slightly different sizes.

**Pixel comparison** (the phase's evidence, not a CI lane):
`artifacts/diagram-references-annotations/pixels.mjs` rasterises each
baked/lifted pair as a page sets it, where both letters are Noto Sans Bold, in
headless Chromium, with Inkscape as the fallback, at a fixed sheet size.
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

**File.** Round trips, a label with every new field included. A colour, size,
offset or tag from a newer build is kept verbatim. A `bold` or `halo` that is
not true or false is damage. Damage is dropped. A label with a field this
build has no name for is kept verbatim, as an older build will keep a styled
one. An old baked step is offered Make Editable, and a too-large one gets the
disabled reason.

**Solid line.** Hit testing, snapping, flip, clipboard, behind, Layers rows,
the rail's colour select and preference, and `SelectSwatch` moving with no
change on screen.

**Text options.**
- A label with none of the new fields draws the same markup as today, byte
  for byte, on a card, a page and in a step file.
- Each option drawn, alone and together: a colour, bold, a halo on the front,
  on the back and off the sheet, each size, an offset.
- Hit testing, the selection and the reach at a label's size, weight, halo and
  offset. A long bold label is not cropped.
- Dragging: plain text moves whole and does not snap; hung text taken by its
  words changes only `offsetPt`; taken by its anchor it moves `from`, snapped,
  and the words follow.
- Carrying: Turn over and Upright turn and mirror the offset and keep its
  length.
- `annotationTextRuns` and the PDF embed Bold for bold text, Latin and CJK.
- The rail's Text Style and its preferences, and the Layers rows. A callout
  shows none of them.

**References.** The `cp-workspace/references` tests are in every phase's
gate, because `line` grows there and the letter placement is exported from
`diagramToPaperScene`.

**Browser.**
- The Show menu changes the previews and what is pulled, and is remembered.
- Zach's screenshot's step pulled, then an arrow, a letter and the reference
  line's colour edited, then turned over.
- A label made by hand to match a pulled letter (magenta, bold, haloed, 9 pt)
  beside it, on a front and a back step, on the canvas, a page and in the PDF.
- Performance: a 30-step References diagram in the Pages view and its PDF
  export, before and after. These steps now paint annotations in every
  `cellPicture` pass, where today they had none. If it is more than 10%
  slower, cache each step's compiled `annotationDrawing` by its marks and
  frame.

## Decisions for Zach

All DECIDED. Zach's own answers, 2026-10-07, are quoted where they apply; everything else takes the **(rec)** option (Zach, 2026-10-07: "use your recs and include the enlarged steps follow ups in the branch"). Later that day he asked for letters to be Text with options: RM1 and RM3 are re-worded for it, and RM12 is superseded.

**RM1. How do pulled letters look and sit? DECIDED: L3** (his recs answer). Revised 2026-10-07:
each look is now a set of Text options, since a letter is Text (§4).
- **L1.** Plain Text with a colour: regular, no halo, at the picture's size,
  so smaller at 50 mm and scaling with the picture. Visibly not today's letter.
- **L2.** Text styled as References' letter (bold, haloed, 9 pt), at a fixed
  spot in picture units, with no offset. As Fit each resizes the step, the gap
  to its ring drifts by up to about 40%.
- **L3 (rec).** Text styled as References' letter, hung from its point by
  `offsetPt`, laid out once at 50 mm. Identical to today at 50 mm (cards,
  canvas), but for the typeface on screen (§4). On pages it keeps its distance
  from its ring where today it can hop to another side as the cell's size
  changes.
- **L4.** Re-laid out on every paint, as References does. Letters then jump
  when you move other marks, and an edit to a letter's place cannot stick.

Why L3: it is the only one that is both editable and keeps the look at every
size.

**RM2. Choosing a solid line's colour. DECIDED: (rec)**, palette plus Custom (his recs answer).
- A fixed palette only.
- A free picker only.
- **(rec)** Palette plus Custom: Ink, Reference magenta, red, orange, green,
  blue, purple, Custom….

Why: the palette covers diagrams' usual accents and keeps analytics to named
colours. Custom answers "choose the color" without a second control. The five
colours are print colours, not Edit's screen ones. Text's colour uses the same
control (§4).

**RM3. Which marks have a colour, and what colour do pulled marks keep? PARTLY ANSWERED:** Zach asked for solid lines in a colour he chooses and for Text to gain colour, so "which" is solid lines and Text. What pulled marks keep: DECIDED (rec), References magenta (his recs answer). Revised 2026-10-07: letters are Text, so the colour is Text's.
- Which:
  - **(rec)** Solid lines and Text.
  - Every mark.
  - Solid lines only. A pulled letter would then be black, or Text would need
    a fixed magenta of its own.
- Pulled reference lines and letters:
  - **(rec)** Keep References' magenta: identical to today.
  - Take the style's ink: monochrome, matching the one-ink Diagram preset.

Why: colour on arrows and folds would bypass the paper style (Annotate's
decision 7), which nobody asked for. A callout keeps the arrow ink for now
(§4).

**RM4. The import toggles. DECIDED: (rec)** (where: his answer, at import; remembered, and a hidden mark not pulled: his recs answer) — Zach: the show/hide choices live at import, "since they become editable" a toggle elsewhere "would be confusing".
- Where:
  - **(rec)** A Show ▾ menu in the browser's bar, the previews following it.
  - Checkboxes in the footer beside "With the turn-over before it".
- Remembered: **(rec)** yes, or no. *As built:* a switch remembers the one
  mark switched, over the remembered choice — a Replace opens on its step's
  own choice, which is the step's and not to be remembered for later pulls
  (17d review). The trigger says "Show · 1 hidden" while any mark is hidden,
  so a choice remembered from another day is no surprise.
- A hidden mark:
  - **(rec)** Not pulled.
  - Pulled but hidden. That needs a per-mark visibility switch, a feature of
    its own.

Why: the bar is where the browser's view options live, and previews that
follow the menu show what you will get.

**RM5. One name. DECIDED: (rec)** (his recs answer).
- **(rec)** "Reference lines" in the Show menu and the export dialog.
- Keep "Line highlights" in both.
- Different names in each.

**RM6. Replace from References and the Way chooser on a step with pulled marks. DECIDED: R-A** (Replace replaces: his answer; edited pulled marks too: his recs answer) — Zach: "Replace should replace."
- **R-A (rec).** Every pulled mark follows the card, edited or not. Your own
  marks stay, with the notice. A toast with Undo says when edited marks went.
- **R-B.** Edited pulled marks stay, as D20 keeps an edited instruction. Nudge
  an arrow, try another way, and you have two arrows, or two Ps.
- **R-C.** Ask "Replace your edited marks too?" whenever any were edited. That
  is a dialog in the middle of browsing ways.
- **R-D.** Today's behaviour: nothing is swapped, the new card brings no marks.

Why R-A: it never leaves duplicates, Undo restores the edits, and your own
marks are never touched.

**RM7. Turning over renames folds. DECIDED: (rec)** (his recs answer).
- What is renamed:
  - Lines only, References' own rule.
  - **(rec)** Lines plus valley and mountain arrows and a shaped arrow's fold,
    which also say a direction.
- Marks you drew: **(rec)** renamed too, or left.

A crease-pattern step's Front | Back is not affected: you decided on
2026-10-06 that it only recolours the face.

**RM8. Steps already in your diagrams. DECIDED: (rec)** (left as pictures: his answer; Make Marks Editable: his recs answer) — Zach: "For steps already in the diagram, i guess they just get rendered as a picture? ... if its easy not to have to migrate and it won't cause tech debt thats slightly preferred."
- **(rec)** Leave them, and offer Make Marks Editable in Annotate's notice and
  the Step pane.
- Convert them when the file opens.
- Never convert them.

Why: opening a file never changes it, and one click converts a step you
want to edit.

**RM9. What lifts. DECIDED: (rec)** (aux creases stay and the pink reference lines lift: his answer; the rest: his recs answer) — Zach: "If you mean aux crease, those stay in the picture. If you mean the pink highlighted lines, those are editable."
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

**RM10. One fold drawn in pieces. DECIDED: (rec)** (his recs answer). The planner draws one crease as several
spans (`plannerDiagram.ts:1319-1352`).
- **(rec)** Pieces of one style that touch end to end merge into one line.
  Disjoint pieces, like two pinches, stay apart. The dashes then run as on
  References' own card, but differ from today's page along those lines.
- One annotation per piece: identical dashes, but you edit two or three
  segments for one fold.

**RM11. Can a step bring back marks you chose not to pull? DECIDED: (rec)** (his recs answer).
- **(rec)** No: pull it again with Replace from References. The step stores
  only the paper, so nothing that paints it can draw a mark twice.
- Yes, with Letters and Reference lines toggles on the step at any time. The
  step keeps the whole card, and every reader of a picture has to filter it.

**RM12. A Letter tool in Annotate's rail. SUPERSEDED 2026-10-07** by this
revision: there is no `letter` kind, so there is no Letter tool. The Label
tool with Text's options (colour, bold, halo, size) draws a letter that looks
like a pulled one. It sits where it is put, as every label does; only a pulled
letter hangs from its point (§4). Off a References card its halo is page
white.

It was decided as: **(rec)** yes, beside Label, with no key in v1; or pulled
letters only.

**RM13. Pose. DECIDED: (rec)** (his recs answer).
- **(rec)** Pulled marks ghost in Pose, as every annotation does.
- They show solid there, as they do today.

Why: Pose shows the paper. Ghosting every mark keeps it clear which are
marks, and a References step behaves like every other step.

### Small calls made here

Decided, not pending. Say if any is wrong.
- A pulled letter's offset is laid out once, at 50 mm, the size cards and the
  canvas draw.
- `annotationDrawing` gives `highlight` the arrow pen with no floor.
- Text draws its own halo from a `paper` argument to `annotationDrawing`.
  `annotationInk` keeps whitening the faces for hollow arrows.
- Text's new fields are `sizePt` and `offsetPt`, the suffix saying the unit.
  `offset` is divisions' mm offset (`diagramDocument.ts:765`) and `size` an
  enlarge area's `[w, h]` (`:825`), on the same flat annotation.
- `bold` and `halo` are flags written only true. The fonts have no weight but
  Regular and Bold.
- Text gains a size, which the design put to Zach did not name: without it a
  pulled letter is a fifth smaller at 50 mm and scales on pages (§4).
- Size offers 7, 9, 12 and 16 pt besides With the picture. The file reads 4
  to 48 pt.
- The halo is 0.3125 em: References' 3 ink on its 9.6 ink letter.
- Hung text is centred, not anchored at its near edge as References' letters
  are. The lift converts the anchor with Noto Sans Bold's advance.
- Hung text dragged by its words changes its offset; by its anchor, its
  `from`. Plain text drags as today.
- Reset Position is dropped (§4).
- Callout keeps its look (§4).
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
- **A separate `letter` kind** (this plan's first design, 2026-10-07). It drew
  through References' own label code in a second render context. That needed
  given placements in `createDiagramRenderContext`, an `ink` on References'
  `label`, a Letter tool (RM12), and Layers rows, an analytics kind and strings
  of its own. Its reason was that a shared kind would make `from` mean the
  named point on a letter and the text's centre on a label. `offsetPt` answers
  that: `from` is where text is anchored, and with no offset the text is
  centred there, as today. Zach preferred one Text with options (2026-10-07),
  and the options then serve any text.
- **Hung text anchored at its near edge**, as References anchors a letter so a
  glyph wider than its box grows away from its mark. The anchor would flip as
  the words are dragged past their point, and they would jump by half their
  width. Centred text never jumps; the lift converts the anchor (§4).
- **A fixed print size whenever text has an offset**, instead of `sizePt`. It
  ties two options together, and a letter made by hand, with no offset, could
  not match a pulled one.
- **Reset Position for pulled letters.** It needs a References model rebuilt
  from the step's marks, for one use of Text. Undo and Replace cover it (§4).
- **Text's options on Callout too.** Not nearly free: a callout's box is sized
  from its words, and its colour would have three parts to ink (§4).
- **Letters re-laid out on every paint** (L4). Placement edits could not stick.
- **Colour on every kind.** It bypasses the paper style for arrows and folds.
- **A coloured `PaperLineItem` role.** It changes `packages/origami-simulator`
  and the `.osf` validator for one Diagram mark.
- **Keeping edited pulled marks on Replace** (R-B). It leaves duplicates.

## Risks

- **Merge conflicts.** Other agents are editing `annotationCarry`,
  `annotationClipboard`, `diagramFile` and the zoom code. Start each phase
  only when that work has landed and `git status` is clean under `diagram/**`.
- **Shared References code grows.** `line` gains `ink` and `hidden`, and the
  letter placement is exported from `diagramToPaperScene`. References' `label`
  and `createDiagramRenderContext` do not change. References must not change;
  its tests are in every gate.
- **Ring colour and the clip in multi-ink styles.** Baked marks go through
  `onAndOffPaper`; annotation marks skip the clip. The coloured-paper fixture
  shows whether it matters. If it does, the `paper` that `annotationDrawing`
  takes for Text's halo (§4) gives the other marks a clip too.
- **Styled text in an older build.** A label with any of Text's new fields is
  a newer build's there: kept, not drawn, under the notice (§10). A plain
  label is untouched.
- **Measuring bold text.** A bold label's hit box and crop rest on a second
  advances table. Its test holds it to the bundled font.
- **A halo off a References card** is page white, even where the text stands
  on a capture's coloured face. Accepted for v1. A capture's faces could feed
  `paper` later.
- **Typeface on screen.** On cards and the canvas a pulled letter is set in
  Noto Sans Bold, where the baked one named the References font (§4).
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
  - `diagram/document/diagramDocument.ts` (the `solid-line` kind; `color`,
    `bold`, `halo`, `sizePt`, `offsetPt` and `imported` on
    `KnownDiagramAnnotation`; `DiagramReferencesSource.marks`,
    `pullReferencesSteps`, `setReferencesWay`, `swapCardMarks`, `releaseCardMarks`,
    `editStepAnnotations`, `annotationsOutOfStep`, `duplicateStep`, Make
    Editable);
  - `diagram/document/diagramFile.ts` (`ANNOTATION_FIELDS`, `readAnnotation`,
    `readReferencesSource`, the writer).
- **Annotations:**
  - `diagram/annotate/annotationModel.ts` (`ANNOTATION_SHAPES`,
    `carryAnnotation`'s `otherSide` and hung text's offset, `annotationEnds`
    for hung text, `labelHalfWidth` at a size and weight);
  - `annotationPrimitives.tsx` (compile, the `highlight` pen, Text's options
    and halo, the `paper` argument, `labelElement`, `withHidden`,
    `annotationReach`, `annotationTextRuns`);
  - `labelAdvances.ts` (Noto Sans Bold's advances) and its test;
  - `canvasInk.ts` (`ptInPictureUnits`);
  - `annotationHit.ts` (a label at its centre and size), `annotateSnap.ts`
    (hung text's anchor), `useAnnotateCanvas.ts` (dragging hung text);
  - `annotationCarry.ts` (`pictureMove`, the out-of-step rule);
  - `annotationClipboard.ts` (paste and the tag);
  - `pictureSnap.ts`, `applyAnnotationEdit.ts`, `annotateTools.ts`,
    `lineTypes.ts`, `paintAnnotations.ts`;
  - `diagram/zoom/zoomFrames.ts` (`carryMarks`, `followOwnPicture`).
- **Shared References drawing:**
  `cp-workspace/references/referenceFinderDiagramToPrimitives.ts` (`line`'s
  `ink` and `hidden`), `cp-workspace/references/diagram/DiagramPrimitives.tsx`
  (`line`'s `ink` and hidden stretches). References' `label` and
  `createDiagramRenderContext` do not change.
- **Pages:** `diagram/pages/pagePictures.ts` (the paper for Text's halo).
- **UI:**
  - `components/diagram/DiagramAnnotateRail.tsx` (Text Style),
    `DiagramLayers.tsx` (Color, Bold, Halo and Size),
    `DiagramAnnotateCanvas.tsx`, `DiagramAnnotationLayer.tsx`,
    `DiagramAnnotateToolGlyph.tsx`;
  - `components/diagram/DiagramReferencesBrowser.tsx` (the Show menu);
  - the Annotate notice bar and the Step pane's References section;
  - `components/ui/Select.tsx` and `Select.module.css` (`SelectSwatch`),
    `cp-workspace/CpTextEditor.tsx`, `styles/theme.css` (`.select-swatch`
    out, ratchet lowered);
  - `components/paperExport/PaperExportOptions.tsx` (under RM5);
  - `store/settingsStore` (the line colour, the text style and the Show
    preference);
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

- [x] Zach answers RM1–RM13; record each here with his words. His own answers where quoted, his recs answer for the rest; RM12 superseded.
- [x] Revised the same day: no `letter` kind; a pulled letter is Text with options (Zach). RM1 and RM3 re-worded, RM12 superseded.

### 17a: Solid line

- [x] `SelectSwatch` in `components/ui/Select` with its module; `.select-swatch`
  out of `theme.css`; `CpTextEditor` on it; the ratchet lowered. Its own
  commit, computed styles matching before and after.
- [x] `solid-line` in the model, `ANNOTATION_SHAPES` and every exhaustive switch.
- [x] `line` gains `ink` and `hidden` in References' primitives, drawn by
  `diagramShapes`; References' tests unchanged.
- [x] `annotationDrawing`'s `highlight` override; `annotationReach` for `line`.
- [x] The Solid Line Type segment, Shift+L, the rail's colour select with its
  preference, and the Layers Color row.
- [x] Behind, flip, clipboard and snapping.
- [x] File: `color` and the new kind; tests.
- [x] Analytics (`solid_line`, `color`, `annotation recolored`) and i18n.
- [x] Browser: a solid line in each palette colour and a custom one, behind a
  flap, on a page and in the PDF. A printed proof of the five colours: the
  PDF is made (`17a/evidence/17a-crane.pdf`, page 1); printing it is Zach's.

**17a as built** (2026-10-07; the SelectSwatch move is its own commit):
- `SelectSwatch` is a part in `Select.tsx`, its rule `.swatch` in
  `Select.module.css`; `.select-swatch` is out of `theme.css` (ratchet 5425).
  Edit's text-colour list and trigger compute identical styles at HEAD, at
  the move and in the final tree, light and dark
  (`artifacts/references-marks/17a/swatch-styles.mjs`).
- The colours live in `diagram/annotate/annotationColors.ts`: the palette, the
  `#rrggbb` test (either case), `paletteEntryOf` (the one case-insensitive
  lookup: `#1971C2` is Blue, and the file keeps it as written) and the names
  the events send. `carriesColor(kind)` (only `solid-line`; 17b adds `label`)
  and `withColor` are in `annotationModel.ts`; `cleanAnnotation` drops a
  colour a kind has no use for, so a solid line made another type loses it.
- No colour stored is the arrow ink: `annotationInk`'s `highlight` stroke is
  now the arrow's. References' magenta stays `--cp-reference-input` for
  References' own drawings.
- References' `line` gains `ink` (the stroke attribute in a file;
  `style="stroke: …"` on screen, where a class would beat an attribute) and
  `hidden` (stretches dotted with the arrows' dash). References never sets
  either; `diagramToScene` strips both before packing, as its own `ink` is an
  `Rgba` for the off-paper pieces.
- `annotationReach` counts half the pen round each end of a `line`;
  `enlargeArrow.ts` measures only `isDiagramMark` primitives.
- §3 was wrong that `LINE_KINDS` gives a solid line the line behaviour for
  hit testing too. It is drawn among the marks, so it is pressed among them,
  in the order added (`underMarks` in `annotationHit.ts`): over an arrow it
  takes the press. Snapping, flip, clipboard and Layers keep the line
  behaviour.
- The select is `components/diagram/DiagramColorSelect.tsx`; the rail's Line
  Type and its select are `DiagramLineTypeControl`. On the rail it sits under
  the Line Type, not beside it: four segments fill the 172 px column. A
  colour picked by hand is an item of its own, named by its hex; Custom… has
  a hue swatch so the names line up.
- Custom… opens the picker on the list's `onCloseAutoFocus` through
  `components/ui/openColorPicker.ts` (shared with `ContextMenuColorItem`),
  with `focusInput: false`: the trigger keeps the focus, as a focused colour
  input owns every key (`isShortcutEditingTarget`) and left Undo, Delete,
  Escape and Shift+L dead after a pick. So "as `ContextMenuColorItem` does"
  holds for opening the picker, not for focus: the context menu still
  focuses its input, because it commits on the blur. Every move of one pick
  shares a negative session number: one undo step, one `diagram annotation
  recolored`. The Layers select is keyed by the mark, so a pick still open
  when another line is selected ends with it.
- `SelectContent` takes `fit="available"` (a `data-fit` rule in
  `Select.module.css`): the colour list is as tall as the window allows. The
  shared 220 px cap cut Custom… in half, and hid it behind a hand-picked
  colour.
- A selected solid line is washed under its stroke (`SelectionUnder`, 12 px,
  in the canvas's module), so it shows its own colour; washed over it,
  orange read mauve.
- Each solid line's Layers row draws its glyph in the line's colour; with
  none stored, in the icon's ink, as the style's would vanish on a dark
  theme.
- `trackDiagramAnnotationAdded`'s third argument is an object,
  `{ placed?, color? }`. A solid line the Angle Bisector draws takes the
  colour and counts as `angle_bisector`, with no `color`.
- Left out: `imported` (the tag is 17d's); a "Solid line" string for Layers,
  which names the kind by its tool, "Solid Line", as for the other lines;
  `implementation-plans/posthog-analytics.md`, which has no Diagram table
  (`docs/analytics.md` has both events).

**17a verified** (2026-10-07): lint, typecheck, `i18n:check` and the whole
vitest suite (874 files, 11,662 tests) green on what was committed. In the
browser (`artifacts/references-marks/17a/evidence/`, composite
`17a/17a-evidence.png`): Ink, each palette colour and a custom one drawn by
real input on crane step 8 and on step 1, a References step, in Chromium
light and dark at 1280 px and in an iPad-sized WebKit by touch; each colour
exact in screen pixels, on the page and in the PDF at 300 dpi (about
0.72 pt wide); a line behind the right flap dotted under it; every option
of both lists in view; Undo by key after a Layers pick. At 375 px a phone
has no Annotate (unchanged); in a 375 px desktop window the Layers Color
row works, and the rail is clipped by the side pane, as every rail row
already was.

Open, Zach's call: Ink's swatch reads as an empty ring in a dark theme (a
lighter ring read worse, `fixes/shots/swatch-ring-compare.png`); choosing
Solid moves the rail's tools down about 36 px; the printed proof of the
five colours (`17a/evidence/17a-crane.pdf`, page 1, steps 1 and 8).

### 17b: Text options: colour, weight, halo, size and offset

- [x] `label` gains `color`, `bold`, `halo`, `sizePt` and `offsetPt` in the
  model, `compileAnnotation`, `annotationDrawing` and `labelElement`; a plain
  label draws byte-identical markup.
- [x] `annotationDrawing` takes the picture's `paper`; cards, pages, the
  canvas, step files and close-ups pass it for a References picture.
- [x] Noto Sans Bold's advances in `labelAdvances.ts`; `labelHalfWidth`,
  `bodyDistance` and `annotationReach` at a label's size, weight, halo and
  offset; `annotationTextRuns` at 700.
- [x] Dragging hung text by its words and by its anchor; plain text unchanged.
  Carrying turns and mirrors the offset.
- [x] The rail's Text Style with its preferences; the Layers Color, Bold, Halo
  and Size rows.
- [x] File, analytics (`color`, `bold`, `halo`, `size`, `text styled`) and
  i18n.
- [x] Browser: a bold, magenta, haloed 9 pt label on a front and a back
  References step in the Diagram preset, the halo against the grey back; a
  hung label from a fixture file (the lift comes in 17d) dragged by its words
  and its anchor; the PDF's font.

**17b as built** (2026-10-07; the review's fixes folded in):
- **Model.** Text's look is a leaf, `diagram/annotate/textStyle.ts`
  (`TextStyle`, `PLAIN_TEXT_STYLE`, the sizes and ranges, `TEXT_HALO_EMS`,
  `readTextStyle`), so the settings store reads it without
  `annotationModel`, which now pulls in the paper painter through
  `canvasInk`. The verbs are in `annotationModel.ts`: `carriesTextStyle` (a
  label alone; a callout keeps its look), `withTextStyle` (each option
  written only as set), `textStyleOf`, `withLabelOffset` (each axis within
  ±200 pt), `isHungText`, `labelCentre`, `labelSize`, `moveLabelWords`, and
  `cleanTextStyle` in `cleanAnnotation`. `carriesColor` answers yes for a
  label. `annotationEnds` takes the annotation, not its kind: hung text
  offers `from`, plain text nothing.
- **Carrying.** `carryHungText` moves the anchor as a point and turns or
  mirrors the offset by `move.vector` (or where the move takes its far end),
  its length kept in pt. A turn that is no quarter turn (a linked step's 15°
  presses) could carry an axis past the ±200 pt a file reads, and carried
  marks are not cleaned, so the words come in along the same way until both
  axes are in reach (45° takes `[180, 180]` to `[0, 200]`); a 45°
  `sceneTurnMove` written and read back holds it.
- **The paper.** `AnnotationPaper` (`annotationPrimitives.tsx`) is the
  sheet's outline in the marks' units and its side; `markPaper(step,
  assets)` and `sourcePaper(source, window)` are in `zoom/stepView.ts`. It
  reaches the drawing as `annotationDrawing`'s sixth argument,
  `paintAnnotations`' `paint.paper`, `annotatedPicture`'s seventh and
  `posedZoomPicture`'s eighth: cards (`annotatedStepUrl`,
  `zoomedCardPicture`), Pose's enlarged picture, pages and step files
  (`cellPicture`), the canvas and its close-ups. Calls that only measure a
  reach pass none. The face is read from the style's inks before an
  annotation's whiten them (`seenInk`); the on-sheet test is References' own
  `labelOnPaper` at the words' centre. `textHaloSurfaces.test.ts` (page, step
  file, card, whole and enlarged) and a canvas test hold the wiring. Pose's
  3D and simulated ghosts take none: they are never References pictures.
- **Drawing.** A plain label is byte-identical (verified below;
  `textOptions.test.tsx` holds HEAD's markup as a literal). Bold writes
  `font-weight="700"` on the text and each run, so a page sets and embeds
  Noto Sans Bold; a halo is a stroke 0.3125 em wide, round joins,
  `paint-order="stroke"`.
- **Measuring.** `LABEL_BOLD_ADVANCE_RUNS` is the bundled `NotoSans-Bold.ttf`'s,
  held to it by `annotationModel.test.ts`. Beyond the plan,
  `CJK_RUN_BOLD_ADVANCE_RUNS`: the CJK fonts' Bold set a digit or a sign
  among CJK words wider than Regular (a digit 0.590 em, not 0.555), so a
  bold label with them would have measured short; its test runs where the
  CJK fonts are built. `labelBox` (`annotationHit.ts`) is the one box a
  press, the selection's ring and the reach use, and `markExtent` counts
  hung text's words by it, so an enlarged step draws words that hang into
  its window from an anchor a window or more off it.
- **Dragging.** A press on hung text's words moves its offset alone
  (`moveLabelWords`), never snapping; its anchor's dot snaps as a callout's
  point does (`snapsAnchor`) and the words follow. The selection ties the
  dot to the ring round the words with a hairline, as a right angle's corner
  is tied (§4 named the dot alone).
- **Rail.** Text Style sits under Text while the Label tool is in hand: the
  colour select ("Text Color"); Bold and Halo as the rail's own buttons
  (`ToolRailButtons`; a `toggle` tool says `aria-pressed`; their tooltips
  open above, so Bold's never covers Halo); then Size on a row of its own,
  led by a text-size glyph (With the picture did not fit beside the toggles
  in the 172 px column). The group asks to be revealed (`ToolRail`'s
  `reveal`): on an iPad on its side it came in below the fold, and the
  rail's own column now scrolls to show it. One preference,
  `diagramAnnotateTextStyle` (key `diagram-annotate-text-style`, JSON,
  removed when it is the plain look).
- **Layers.** A label's Color row is the solid line's; under it
  `DiagramTextStyleRows`: Bold, Halo with its hint, and Size, where a size
  from a file is an item of its own. Undo labels: Change color, Change bold,
  Change halo, Change text size. A label's row glyph takes its colour.
- **File.** A label reads `text`, `color`, `bold`, `halo`, `sizePt` and
  `offsetPt` by §10's rules; a callout still reads `text` alone, so a bold
  callout is a newer build's.
- **Analytics.** Every label added sends `color`, `bold`, `halo` and `size`
  (a plain one `ink`/`off`/`off`/`picture`), as every solid line sends its
  colour; `diagram annotation recolored` counts a label's; `diagram text
  styled` is new. `posthog-analytics.md` still has no Diagram table.
- **Strings.** Select's help says a hung label moves by its words alone and
  by its dot whole; Snap to Picture's names the dots labels hang from;
  Halo's hint says what it is filled with. All nine catalogs.

**17b verified** (2026-10-07): lint, typecheck, `i18n:check` and the whole
vitest suite (880 files, 11,809 tests; 2 files and 15 tests skipped) green
on what was committed. Evidence in `artifacts/references-marks/17b/verify/`,
composite `17b/17b-evidence.png`:
- No option set: Zach's four diagrams (crane, heart, chipmunk, Reference
  Diagrams), as saved and with two plain labels and a callout on every step
  with a picture, give identical pages, step files, cards, canvas markup and
  PDF bytes at `ade79de26` (its source exported afresh) and in this tree
  after the review's fixes.
- One label per option, and one with all of them hung, on crane's front
  References step, its back and a folded step, on the canvas, on the page and
  in the PDF rasterised at 300 dpi: the halo white on the front, `#b3b3b3` on
  the back, white off the sheet and on the folded step; 9 and 12 pt keep
  their size on the page while plain labels scale; the PDF embeds Noto Sans
  Bold and Regular, nothing missing.
- Hung text in Chromium at 1280 px, light and dark, and in an iPad-sized
  WebKit (selected by a tap): by its words the offset moved by the pointer's
  travel in pt and the anchor stayed; by its dot it snapped onto the sheet's
  corner, the offset kept; two undos restored it; plain text still moves
  whole. The rail and the Layers rows at 1280 px in both themes, at 375 px,
  and on the iPad (Layers in the Settings sheet, Bold toggled by touch).
- Not checked in a browser: a CJK bold label in the PDF. The CJK fonts are a
  build output this worktree lacks; `diagramFontTexts` asks for their Bold
  in a unit test.

Open, Zach's call (built as §4 says until he says otherwise):
- **A halo across the sheet's edge** takes one colour, by where the text's
  centre is, as a baked letter's does: a label straddling a References
  back's edge paints grey over the page's white (or a white notch into the
  grey just off it), and a white halo off the sheet shows on a page's grey
  flow band. Painting it twice, clipped inside the sheet in its face and
  outside in white, would follow the edge. *Built in review fix 6
  (`diagram-review-fixes.md`): the face inside, white outside, as one
  stroke painted by a pattern of the sheet. For Text labels and pulled
  letters only: References' baked letters still take one colour, so
  pulling a letter across the edge changes how it looks (a follow-up for
  Zach there).*
- **A halo on any other picture is white**, a folded step's grey faces
  included; the hint says so. Giving scene and folded pictures a `paper` of
  their faces would fill it with the face under the text instead.
- In a 375 px desktop window the Label tool's floating window lies over the
  lower half of the rail's Text Style; the rail there is already clipped by
  the side pane, as 17a found.

### 17c: Turn over renames folds

- [x] `otherSide` on the References `PictureMove`; `carryAnnotation` swaps per
  RM7.
- [x] Tests: hand-drawn lines and arrows turned over; a crease-pattern step's
  Front | Back unchanged.
- [x] Browser: before/after of a hand-drawn valley line on a References step
  turned over.

**17c as built** (2026-10-07, commit `2563c5c9f`):
- **Model.** `PictureMove.otherSide?: true` (`annotationModel.ts`).
  `carryAnnotation` is a wrapper: `carriedOnPicture` moves every point as
  before, then under `otherSide` the kind goes through `kindFromOtherSide`,
  an exhaustive switch (`valley-line` ↔ `mountain-line`, `valley-arrow` ↔
  `mountain-arrow`, every other kind kept). One rename after every branch,
  so a shaped arrow (the early `path` branch) is renamed too.
- **Carry.** `pictureMove`'s References branch (`annotationCarry.ts`)
  returns `mirrorMove(frame)` with `otherSide`. `mirrorMove` stays the plain
  mirror, so Flip, an upload's mirror and a linked picture's turn rename
  nothing, and a crease pattern's Front | Back is still the
  `recolouredOnly` path, which carries nothing.
- **Enlarged steps.** Their marks are carried through `unitsMove`
  (`reposeFrame`), which now forwards `otherSide`; a units change with no
  move (enlarge, unenlarge, a paste between windows) sets none. Without the
  forwarding a turned enlarged step kept its names; its test fails without
  it.
- **Where the plan was wrong.** "A shaped arrow's `fold`" is not a stored
  field: the `path-arrow` primitive's `fold` is compiled from the kind
  (`PATH_FOLD`), so renaming the kind renames it. A test compiles a turned
  shaped arrow and reads `valley`.
- **Tests.** `annotationModel.test.ts` (the rename, a shaped arrow, every
  kind that keeps its name, the involution, a plain mirror and Flip naming
  nothing); `annotationCarry.test.ts` (every kind drawn on a References step
  turned over and back with `behind`, `color` and `offsetPt` kept; an
  upload flipped and a crease pattern's Front | Back naming nothing);
  `zoomFrames.test.ts` (an enlarged References step turned over and back).
- **No strings, no events.** Turn over is one undo entry and is already
  counted (`diagram picture posed`). `diagram-workspace.md` D8 and its
  carry note are amended.
- **Browser** (`artifacts/references-marks/17c/`, Chromium, crane.osf
  through the project reader). `turn.mjs before|after light|dark`: on the
  front References step a valley, mountain and solid line and a valley,
  mountain and fold-and-unfold arrow drawn by the rail's keys and real
  drags, plus a shaped valley arrow through the store; Turn Over clicked in
  the Pose toolbar twice; crane's crease-pattern step put on Back in the
  Pose pane. At `ccb837d05` the back kept every name (a dashed valley over
  the card's dash-dot creases), in light and dark. With 17c the lines and
  the three fold arrows are renamed, the solid line and the
  fold-and-unfold arrow are not, and the second Turn Over gives back every
  name and place; the crease pattern's three valley arrows stay valley
  arrows in both builds. Composite: `17c-evidence.png` (four rows: before
  and after, light and dark). `enlarged.mjs` repeats it on a card pulled
  into crane by the UI, which lands enlarged: the drawn marks are renamed
  and mirrored inside the window, beside the card's own crease turned
  dashed to dash-dot (`enlarged/enlarged-evidence.png`). No page errors in
  any run.
- **Gate** (Node 22, the tree as committed): `npm run lint:web` clean;
  `npx tsc --noEmit` exit 0; `npm run i18n:check` passed; `npx vitest run`,
  all of it, 880 files passed and 2 skipped, 11816 tests passed and 15
  skipped. The `pretest` hook's simulator and wasm rebuild was not run: 17c
  changes no Rust and no simulator code.
- **Claims and confidence.**
  - High: a References Turn over renames valley ↔ mountain lines and arrows,
    a shaped arrow's head and drawn marks included (tests that fail without
    the change; the browser before and after, light and dark).
  - High: turning over twice gives back every name and place (the
    involution test; `after.json`, `enlarged.json`).
  - High: fold-and-unfold arrows, solid lines and Text only move (tests over
    every kind; in the browser the fold-and-unfold arrow and the solid line,
    Text not drawn there).
  - High: a crease-pattern step's Front | Back renames nothing (a test; the
    browser before and after).
  - High: an enlarged References step renames the same way (a test that
    fails without the forwarding; `enlarged.json` and its shots).
  - Medium: Flip and an upload's mirror rename nothing (tests only; neither
    path changed).
- **Not done.** A mark pasted from a card's front step onto a step showing
  its back keeps the name it was copied with, as it keeps its place: a paste
  is not a turn-over. A step saved before 17c with drawn valley or mountain
  marks renames them on its next Turn over, as Risks expects; the reader
  rewrites nothing.
- **Found in review, not 17c.** A References card pulled after an enlarged
  run lands enlarged, through 16g's rule that a run made after an enlarged
  step keeps its imprint, so crane's head circle frames a square card at
  coordinates that mean nothing on it. Whether a pull (or an upload, or a
  link to another pattern) starts unenlarged is Zach's call; it bears on
  17d's pulls into enlarged steps.

### 17d: The split at import

- [x] `liftCardMarks` and its tests, with the letter placement exported from
  `diagramToPaperScene`.
- [x] The `-marks` key; `keyOf` strips it.
- [x] The tag: set at the lift, kept by carries and Duplicate, changed in
  `editStepAnnotations`, paste by card key, `releaseCardMarks`.
- [x] Tagged marks never out of step: `annotationsOutOfStep`,
  `withCarriedAnnotations`, `followOwnPicture`.
- [x] `pullReferencesSteps` with annotations and `annotatedPictureKey`;
  enlarged steps through `unitsMove`; the cap and its toast.
- [x] The Show menu, its preference, the previews and `source.marks`.
- [x] `swapCardMarks` for Replace and Way, with the toast.
- [x] Analytics (`steps pulled` properties, `imported mark edited`) and i18n.
- [x] The equivalence and page tests; the pixel probe and its images.
- [x] Performance on a 30-step diagram, before and after.
- [x] Browser: Zach's screenshot's step pulled, edited and turned over;
  Replace and Way with an edited mark; the toggles.

**17d as built** (2026-10-07, commit `a100c7dd3`; the review's fixes folded in):
- **The lift.** `diagram/references/referencesCardMarks.ts`:
  `liftCardMarks(model, mirrored, marks, style, newId?)` returns `{sheet,
  annotations}`, or null past the cap; `liftedCardPicture` keys the sheet
  `steps-<card>-marks[-back]` and reads it back through
  `storedStepDiagramModel`; `shownCardPicture` is the browser's preview.
  The signature gained `style`: a ring's rim is three quarters of the
  style's arrow pen, so where `placeLabels` puts a letter depends on it.
  Letters are laid out once, at 50 mm, in the diagram's style at the pull.
  The sheet leaves out every mark the Show menu can hide whether shown or
  not (a reference line drawn as an arc, which nothing draws today,
  included), so one `-marks` key is one sheet.
- **One letter layout.** `diagramToPaperScene.ts` exports
  `diagramLetterPlacements` through one `sceneDrawing`;
  `paintStepDiagram.ts`'s `stepSceneOptions` feeds both
  `stepDiagramScene` and `stepDiagramLetters`, so baked and lifted letters
  cannot drift. Baked painting is byte-identical to before.
- **Storage and the tag.** `imported` on every kind: a state the reader does
  not know is a newer build's, kept verbatim and told before damage; one
  that is not a word is damage and drops the mark, as any field's does.
  `source.marks` is dropped alone when it does not read. The predicates and
  the tag's moves are in `diagram/document/cardMarks.ts` (`showsCard`,
  `isTagged`, `isCardMark`, `authorMarksOf`, `authorMarksChanged`,
  `untagged`, `releaseCardMarks`, `withEditTags`, `cardMarkEdits`,
  `editedCardMarksGone`); `stepDiagramCardKey`, `liftedStepDiagramKey`,
  `swapCardMarks` and `sameSheetInStep` in `diagramDocument.ts`; one
  field-for-field comparator, `sameAnnotation`, in `annotationModel.ts`.
  Tags drop on Remove Picture, an upload and a capture. Paste keeps one
  only onto the same card and only as the one copy there.
- **The notice and the carries.** Card marks are never out of step and go
  with every carry (`withCarriedAnnotations`, `carryMarks`); the author's
  go only when in step. `editStepAnnotations` moves `annotatedPictureKey`
  only when the author's marks changed or none were out of step, paste and
  cut included.
- **Pull, Replace, Way.** `SentReferencesStep.lifted`; `pullReferencesSteps`
  returns `baked` and `replaced`. Replace and Way swap every tagged mark,
  the new card's first, and keep the author's; a same-card Replace or Way
  from the same side keeps in-step author marks in step. Past the cap
  beside the author's marks a card is pulled baked with a toast, for the
  Way chooser too (`chooseReferencesWay`, its React-free action in
  `referencesPulledSteps.ts`). A Replace that took edited marks shows one
  toast, "Replaced step N's card" with "Replaced N marks you had edited"
  and Undo; a Way, "Replaced N marks you had edited" with Undo. Undo acts
  only while that edit is the newest.
- **Enlarged steps** (§5 revised). `marksIntoUnits` (Fill, Replace, Way) and
  `seedNewSteps` (`withCardMarksInFrame`) pull only marks that lie in the
  frame (`liesInFrame`): lines cut at it or dropped, other marks only when
  every point they are drawn through is inside. A page test holds every
  painted mark inside its cell.
  *Amended 2026-10-08 (`diagram-review-fixes.md`, item 3).* A card never
  continues an enlarged run: one pulled after an enlarged step, or filling an
  empty step seeded enlarged, starts whole with all its marks.
  `withCardMarksInFrame` is removed. `marksIntoUnits` still takes a new card
  into the window of a References step enlarged since, through Replace, Way
  and Make Editable.
- **Show menu.** `DiagramReferencesShowMenu` (its own module) between
  Sequence | Find and Open References; `diagramReferencesMarks` in the
  settings store (`diagram-references-marks`); `toggleReferencesMark`
  remembers only the mark switched; the trigger reads "Show · N hidden";
  `MenuCheckboxItem` gained `multiline`. The previews follow it, and a
  Replace opens on its step's `source.marks`. The card's "Shown now" / "In
  diagram" flag moved off the picture into its foot.
- **Small calls.** A circle's centre snaps as a picture point. A press on a
  label's halo or margin, not its words, goes to a mark under it in reach,
  so a pulled ring is taken anywhere on its rim. The menu's hint is full
  ink on the highlighted row.
- **Analytics and i18n.** `steps pulled` gains `letters`,
  `reference_lines` and `marks`; `diagram imported mark edited` sends
  `{kind, edit}`; both in `docs/analytics.md` (§11 amended). All 9
  catalogs.
- **Gate** (Node 22, the tree as committed): `npm run lint:web` clean;
  `npx tsc --noEmit` exit 0; `npm run i18n:check` passed; `npx vitest run`,
  all of it, 884 files passed and 2 skipped, 11968 tests passed and 15
  skipped.
- **Evidence** (`artifacts/references-marks/17d/`, composite
  `17d-evidence.png`; the verify run's scripts and data under `verify/`):
  - Looks the same. The equivalence test (7 fixtures and a pieces card,
    front and back, three styles, 50 and 100 mm: 96 cases) and the page
    test pass. `verify/` painted 72 pairs (crane's two References steps both
    sides, every card of crane's and chipmunk's plans; Diagram preset,
    Default, a coloured paper) with HEAD's own painter and this build's:
    HEAD's baked markup is byte-identical to this build's. Against the
    lifted step, the Diagram preset differs on at most 20 pixels by at most
    2 of 255 levels (antialiasing; the plan's 0 was not met), 9 of 24
    identical. Default and coloured paper differ by up to 217 levels on at
    most 40 pixels, all within 1 pt of the sheet's edge: a lifted fold's
    end drawn over the edge outline (§2). No ring colour differs. No real
    card had pieces to merge.
  - Browser, Chromium light and dark and WebKit at iPad size (touch, Layers
    behind Settings), on chipmunk's planned Card 3: the Show menu, a pull
    with Letters hidden and one with Reference lines hidden (no labels, or
    no solid lines, and a bare sheet either way); a reference line
    recoloured Blue, P dragged by its words and a circle drawn; Replace
    (one toast, Undo restores both edits) and Way 2 (its toast, the circle
    kept under the notice). The three runs give the same store states, with
    no page or console errors. WebKit under vite dev needs the isolation
    headers added (`verify/webkit-probe.mjs`) for the planner's worker.
  - Performance, 30 steps, Chromium, 40 rounds, medians: the pull 0.4 to
    2.8 ms; the Pages layout 24.7 to 31.4 ms; composing every page 8.8 to
    14.5 ms. The Pages view is 37% slower lifted, about 0.4 ms a step. In
    Node, HEAD's baked pages time as this build's do (43.2 and 44.7 ms).
    The implementer's "23% faster" came from a bimodal baked series and is
    withdrawn.
- **Open, Zach's call.**
  - §13 says to cache `annotationDrawing` past 10% slower. Not added:
    compiling is about a third of painting a step's marks, and `cellPicture`
    paints them at least twice, so the cache would win back a few of the
    12 ms per 30 steps.
  - The enlarged spill took option (b); option (a), a pull never keeping or
    seeding a frame, stays open. A pull after an enlarged run starts
    enlarged (16g's seeding, kept).
  - A Replace or Way restores a pulled mark the author deleted without
    saying so: telling needs a record of what was pulled, which §6
    rejected.
  - A card pulled baked past the cap shows its whole card; the Show menu
    does not apply to it. Choosing the way an old baked step already shows
    changes nothing; Make Editable is 17e.
  - A pulled letter dragged across the sheet's edge keeps 17b's halo, the
    colour of the face its point stands on, so a grey patch reaches past
    the edge. A press exactly on a ring's named point takes the letter.

### 17e: Existing steps

- [x] Make Marks Editable in Annotate's notice and the Step pane, with the
  disabled reason past the cap.
- [x] `diagram references marks lifted`; i18n.
- [x] The export rename, if RM5 says so.
- [x] Browser: an old diagram opened unchanged, then a step made editable.
- [x] The Pages view's regression from 17d (37% slower lifted): measured,
  fixed, measured again.

**17e as built** (2026-10-07: built, reviewed, fixed and verified; commit
`28a7cb97e`):
- **Model.** `makeCardMarksEditable(document, stepId, lifted)`
  (`diagramDocument.ts`) gives an old step its own card from the same side,
  split as a fresh pull splits it (`liftedCardPicture`, every mark shown),
  through 17d's `swapCardMarks`. The card's marks go first and the author's
  over them. `annotatedPictureKey` moves only when the author's marks were in
  step (or there are none). An enlarged step's marks go into its window.
  `revision` is bumped, and a `source.marks` that recorded a Show menu choice
  records both marks now. It refuses another card, the other side, a lifted
  step, an empty lift and a lift that would not fit. The store's
  `makeDiagramStepMarksEditable` is one undo step ("Make marks editable").
- **Gate.** `editableCardMarks(step, style)` (`referencesCardMarks.ts`)
  returns `{lifted, total, fits}`. It returns null unless the step's sheet
  still holds liftable pieces. That is how an old step is told from a lifted
  one, by its model and with no flag (§6). The count is the lift run uncapped
  (`liftCardMarks` gained a `cap`), cached per picture and style key. The cap
  counts the whole card, as a pull's does, an enlarged step included.
- **Action.** `makeStepMarksEditable(stepId, via)`
  (`diagram/references/makeMarksEditable.ts`) lifts, then counts from the
  committed step:
  - the card's marks the step holds now, used for the toast's title and for
    `count_bucket`;
  - the marks an enlarged step's frame left out;
  - the edited card marks the swap replaced. An edited mark pasted onto the
    old step keeps its tag, so the swap takes it with the rest.
  Either of the last two adds a note to the toast, with Undo, e.g. "Step 2’s
  4 marks are editable now · 6 marks outside the enlarged frame were left
  out", or "Replaced a mark you had edited". The toast helpers that Replace
  and Way share moved to `cardMarksToast.ts`.
- **Where it is offered.**
  - Annotate's notice (`DiagramCardMarksNotice`, with its own CSS module), in
    the Step pane (`via: annotate_notice`) and over the Layers list
    (`layers_notice`).
  - The step catalog's `make-marks-editable`, in the Step pane's Picture
    section (`step_pane`) and in the card's menu, which shares the catalog
    (`card_menu`). The Picture section leaves the verb out while Annotate's
    notice offers it.
  - The plan named neither the card menu nor the Layers notice, so those two
    `via`s are new (§11).
  - Past the cap the verb is disabled, with the reason as its title, and the
    notice shows the reason inline: "612 marks: a step holds 500", or "501
    marks with yours: a step holds 500".
  - Out of Annotate, such a step's summary reads "Its marks are part of its
    picture" instead of "No annotations".
- **RM5.** The export dialog's row is "Reference lines", hinted "The lines a
  step lines up against." (`paperExport.referenceLines(Hint)`).
- **Performance.** A CPU profile showed that the double paint was not most of
  17d's cost. Each compile of a step's marks re-derived the style's inks,
  including `referencesPaperTokens`' 40-step colour bisection. That was about
  three quarters of each compile, and the layout compiles a step at every
  size it measures. Two fixes:
  - The inks and the seen style are worked out once per style object
    (`perSeenStyle`, `annotationPrimitives.tsx`).
  - `cellPicture` compiles a step's marks once, where it used to paint them
    twice. `placeAnnotations` returns the bounds and a function that makes
    the markup.

  The plan's per-step drawing cache was not added: performance is under the
  bar without it, and a cold layout measures steps at sizes it has not
  compiled at.
- **Tests that fail before the change:**
  - `pagePictures.compile.test.ts` and `annotationInk.test.ts`: at
    `115e15fd2`, 2 compiles and 8 colour searches.
  - `makeMarksEditable.test.ts`: an enlarged step's count, toast and Undo,
    and a pasted edited mark's toast and Undo.
  - The Step pane tests (no second verb in Annotate; the summary), the Layers
    test (the notice), and the catalog test (the reason's two wordings).

  Also new or extended: `cardMarks.test.ts`, `referencesCardMarks.test.ts`
  and the event's test.
- **Verify** (`artifacts/references-marks/17e/verify/` and
  `17e-evidence.png`; Chromium, crane.osf, dev server :5310):
  - **The look.** Step 1 was converted from Annotate's notice and step 2 from
    the Step pane, both by real clicks. Pixels that differ by more than 64
    levels:
    - the composed first page: 2 of 3.6M (max 70);
    - the Steps-view cards: 228 and 136, all at the letters;
    - the Annotate canvas: 1,149 and 679. The on-screen letters are set in a
      slightly wider face and sit a few px over (§4).

    Light and dark give the same counts. No page or console errors.
  - **Performance against the pre-17d code.** `perf-versions.mjs` loads
    `68efa59fc`, `115e15fd2` and the working tree into one page (the old
    trees were extracted beside `src` with `git archive`, then removed). It
    times 30 steps of 17d's fixture over 80 rounds. 25th percentile, ms:

    | | pre-17d baked | 17d lifted | 17e lifted | 17e baked |
    | --- | --- | --- | --- | --- |
    | Layout | 31.6 | 36.4 (+15%) | 26.2 (−17%) | 30.7 |
    | Compose | 9.2 | 16.6 (+80%) | 8.0 (−13%) | 7.0 |

    By minimum and median, 17e lifted compose is −14% and −10%. At every
    version, pre-17d included, a baked layout runs at two speeds about 2x
    apart, in about half the rounds, so its median misleads.

    At 50 steps (one run), 17e lifted is −15% (layout) and −5% (compose) at
    p25, and −13% and −3% at the minimum. Its compose median is +37%, because
    more of its rounds landed in its slow speed, whose times match pre-17d's.
  - **The export dialog** shows "Reference lines" and its hint in both
    themes, and "Line highlights" nowhere.
  - **From the implementer's and fixer's runs** (`17e/editable.mjs`,
    `fix/fixes.mjs`, `fix/crowded.mjs`, light and dark):
    - crane.osf writes back identical to the file;
    - Cmd/Ctrl+Z restores the baked picture and the notice, and Shift+Z
      lifts again;
    - an author's circle stays last and in step;
    - past the cap, both places show the verb disabled.
  - **Gate**, on exactly what was committed: lint, typecheck and i18n:check
    pass; the whole vitest suite passes (888 files; 11,992 tests, 15
    skipped). Not run here, and left for 17f: WebKit and phone width, and
    `build:web`.

**Open for Zach** (17e):
- **An old enlarged step's conversion** changes its picture (§9 as built).
  §5's rule drops the marks the frame cuts, and the toast now announces them
  with Undo. The alternatives:
  - (a) Leave those marks baked in the sheet, so the picture does not change.
    That needs a partly lifted sheet with a key of its own, a notice that
    knows the frame, and a second Make Editable after Unenlarge that adds
    rather than swaps.
  - (c) Disable the verb on an enlarged step. But converting and then
    enlarging by hand keeps every mark whole past the frame (17d's spill).
- **Composing alone, against 17e's own baked step.** Against the pre-17d
  code (§13's bar) both layout and compose are faster. A lifted step still
  composes about 14% slower than a baked one does in 17e, because 17e also
  made baked composing about 24% faster. If that comparison matters, the fix
  is a cache of each placed step's final markup, so recomposing skips
  `renderToStaticMarkup`.
- **Open in References** (found in review, not 17e): from a Diagram step it
  opens on the Finished card, not the step's card, so Export step… is
  disabled there. `openDiagramStepInReferences` passes no `card`, whereas §8
  says it opens the plan's card. Fixed in 17f.

### 17f: Close-out

- [x] As-built notes here, and D25 with Phase 17 in `diagram-workspace.md`
  (D8 already amended for 17c's renaming).
- [x] Full gate: lint, typecheck, `test:web`, `i18n:check`, `build:web`.
- [x] PR notes with any skipped checks and why.

**17f as built** (2026-10-07):
- **Open in References opens on the step's own card** (§8; found in 17e's
  review, commit `098d701a1`). `openDiagramStepInReferences` asked for the
  sheet and the mode only, so the plan opened where it would have anyway.
  On crane.osf that was the Finished card its file was saved on, where
  Export step… has nothing to export.
  - A sequence step's request now carries its card: the number printed on
    it and the line it folds (`ReferencesSheetRequest.card`). A Find step
    carries none.
  - Once the sheet is open, the request hook latches the card in the store
    (`referencesCardRequest`). A switch to another sheet, or another open,
    drops it.
  - `useReferencesBreakdown` opens on it as the plan lands, over a reopened
    file's saved card, or at once when the sheet's plan is already on
    screen. Nothing is planned again.
  - `locateStepCard` (`referencesReaderState.ts`) finds it. Of the cards
    folding its line, it takes the one with its number: a press shares its
    fold's line, and turn-overs shift a card's place, so the number alone
    or the place alone can name another card. A step that names neither is
    the ending. When its line is gone, the first card.
  - References shows its own choice of way, as §8 says.
  - **Tests:** 8 new tests and 2 extended, in `referencesReaderState`,
    `useReferencesBreakdown.restore`, `useReferencesSheetRequest`,
    `referencesStepActions` and `referencesSlice`. All 10 fail with the
    source change reversed alone.
  - **Browser** (`artifacts/references-marks/17f/open/`, Chromium 1280,
    crane.osf, the Step pane's Open in References clicked):

    | | step 1 (card 1) | step 2 (card 2, back) |
    | --- | --- | --- |
    | before | Finished, Export step… disabled | Finished, disabled |
    | after | Card 1, enabled | Card 2, enabled |

    Step 1's plan lands from the cache, over the saved Finished card; step
    2's is already on screen. WebKit gives the same on the iPad and the
    phone below. Confidence: high.
- **Wording** (`a4d8bcdbb`). The last "line highlights", in two comments
  and a test title, say "reference lines".
- **WebKit at iPad size and phone width** (`17f/webkit/ipad.mjs`,
  `phone.mjs`; crane.osf; the isolation headers 17d's script adds; taps for
  everything under test, the store to navigate and read):
  - **iPad**, 1024×1366, touch, light and dark. Every check passed, with no
    page or console errors:
    - Annotate's notice (behind Settings), Make Editable and its toast;
    - the lifted step's Layers rows, and a letter's Color, Bold, Halo and
      Size rows, recoloured Blue;
    - the Solid segment, the Line Color list, and a blue solid line drawn;
    - Text Style under the Label tool;
    - the Step pane's Make Marks Editable and its toast;
    - Open in References, on Card 1, Export step… enabled;
    - the Show menu, Letters off ("Show · 1 hidden") and on again;
    - Replace, with its toast and Undo; Way 2 in Pose, with its toast.
  - **Phone**, 375 px (iPhone X), light: the Step pane's Make Marks
    Editable, Open in References, the Show menu, and Replace and Way with
    their toasts all pass. A phone has no Annotate (as since Phase 10). So
    the rail's controls and the Layers rows are checked on the iPad only,
    and the letter edited before Replace is edited through the store.
  - **Fixed** (`f33a84796`): at 375 px with a mark hidden, "Show · 1
    hidden" pushed Open References 46 px past the browser's edge (measured,
    `phone-bar.mjs`). The tools row wraps now, so Open References takes a
    second row there. At 1280 px the bar is one row, as before.
  - **Cosmetic, and older than this feature:**
    - On a phone, Replace from References… in the Settings sheet opens the
      browser under the sheet; closing the sheet shows it. The same at
      `31e1d6d84` on #436's own dev server (`phone-drawer-base.mjs`).
      *Fixed in review fix 6: sheets come before dialogs in the document.*
    - On a phone, a step's header wraps onto three rows. This branch does
      not touch it. *Review fix 6: it is the open step's header, not a
      card's; left for Zach, with a recommendation (leave out Pose |
      Annotate on a phone) in `diagram-review-fixes.md`.*
    - On a phone, the Step pane's Annotate button and the Layers tab lead
      to "Annotate on a larger screen" and "Open a step in Annotate to see
      its layers".
  - Crane's References steps came from an older plan key, so the browser
    marks none of their cards "Shown now". That is §8's rule, not a fault.
- **Gate**, on what is committed (Node 22): `npm run lint:web` clean;
  `npx tsc --noEmit` exit 0; `npm run i18n:check` passed; `npx vitest run`,
  all of it: 888 files passed and 2 skipped, 12,000 tests passed and 15
  skipped. `npm run build:web` passed: its pre-hooks rebuilt the five wasm
  bridges, vite built, and the prerender wrote 37 pages, a 36-URL sitemap
  and a robots.txt that disallows crawlers, as off production it should.
  Its only warning is vite's chunk-size one.
- **Evidence:** `artifacts/references-marks/17f/17f-evidence.png`.

**Open with Zach** (from 17b–17e; each built as recommended until he says
otherwise):
- A References pull, upload or link after an enlarged run starts enlarged
  (16g's seeding). Recommended: start unenlarged.
- A halo straddling a sheet's edge takes one colour. Recommended: paint it
  in two clipped parts, the face's colour inside and white outside. *Built
  in review fix 6, as one stroke painted by a pattern of the sheet, for
  Text labels and pulled letters; baked letters are unchanged.*
- Halos on folded steps are white. Recommended: leave them white.
- Replace and Way quietly restore a pulled mark the author deleted.
  Recommended: accept.
- Converting an old enlarged References step drops the marks its frame cuts.
  Recommended: keep, with its count in the toast and Undo.
- Pasting across sides keeps the fold names a mark was copied with.
  Recommended: keep.
