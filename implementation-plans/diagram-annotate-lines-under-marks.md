# Annotate: a line drawn over a picture's line hides it

## Goal

When a line mark in Annotate lies on a line of the step's picture — snapped to
the same two points, so it runs exactly along it — the picture's line is not
drawn under it. Only the mark shows.

Why: a dashed valley or mountain line drawn over a thin crease shows the crease
through every gap between its dashes, and the fold no longer reads as dashed
(Zach's screenshot, 2026-11-18: a valley fold along a precrease on a Fold
step). Diagrammers leave the crease out where the fold line is drawn.

## Approach

### The rule

A picture line is hidden wherever a drawn line mark lies along it:

- **Marks that hide:** every straight line mark that is drawn — valley,
  mountain, hidden, solid and uncreased lines. Not arrows, equal divisions or
  any other mark, and not a mark set `hidden`.
- **Lines that hide:** every line of the picture except the paper's edges —
  precreases and aux lines, a crease pattern's mountain and valley lines, a
  crease-pattern step's instruction lines, a References step's lines. Edges
  stay, so the paper's outline never has a gap in it.
- **Lies along:** the shorter line's two ends lie on the longer one (run on
  past its ends) within a thousandth of the frame the mark is drawn on (a
  window's for an enlarged step), and the two overlap by more than that. The
  plan first said the snap's own "same point" (`PICTURE_POINT_EPSILON`, 5e-5),
  but a flat fold draws a crease once per layer, and the example crane's step
  7 draws its precrease's second copy 0.0003 off the first at one end (its 1%
  spread): the point tolerance hid one copy and left the other showing through
  the dashes. A thousandth is about 0.05 mm on a 50 mm card, far under half
  any pen's width. A snapped line always matches; one drawn by hand misses
  unless it lands within that, where it would cover the line anyway — so no
  separate "was snap on" check is needed.
- **How much hides:** only what the mark covers (D3, Zach 2026-11-19). The
  case Zach described, same two ends, hides the whole line. A valley line
  along half a long precrease hides that half, and the rest stays drawn.

### Nothing is stored

What hides is worked out from where the marks lie each time a picture is
painted. Nothing is written to the file, so:

- moving, deleting or undoing the mark brings the line back, with no extra
  undo step;
- the file format and reader version do not change;
- diagrams saved before this get it when opened, for example a Fold step whose
  own valley line lies on a precrease. Under the document evolution policy, a
  change of look applies to every saved file. Nothing moves: a cut scene keeps
  its `bounds`, as `sceneCulledTo` does (`paintDiagramStep.ts:199`), so no
  picture's frame, size or page place changes.

### Where it applies

The rule applies wherever the marks are drawn at full strength over the
picture: the Annotate canvas, Steps grid cards, step detail, pages, PDF and
print, step-file export, an enlarged step's window and a close-up's inside.

Two places keep the whole picture:

- **Export picture…** writes the bare picture with no marks
  (`exportStepPicture.ts`). Hiding a line with nothing drawn over it would just
  lose it.
- **Pose** shows the marks ghosted over the picture being posed.

In Annotate the line hides when the mark is committed: when the second point is
placed or a drag is dropped. It does not hide during the drag preview, which
would repaint the picture on every snap change.

### Seam

1. **What covers** (`annotate/linesUnderMarks.ts`, new, pure): the step's
   straight marks that lie along a line of its picture they can hide, in
   picture units. An enlarged step's marks are mapped out of its window with
   `fromBox`. They are tried against the lines the painted scene would draw in
   a crease's pen (`hideableSceneLines`), read once per picture object — not
   the snap geometry, which has no roles: the example crane's only two marks
   along a picture line (steps 13 and 15) lie on raw edges, and the snap
   geometry counted them, so their cards would have repainted to hide nothing
   and analytics would have said they hid a line. A step with no line marks
   reads nothing; most steps return null. It also produces a short key (the
   ends, rounded) for cache keys. `useLinesUnderMarks` holds it by that key
   for the canvas and the cards.
2. **Gaps along a segment** (`lib/uncoveredSpans.ts`, shared, pure): the parts
   of a segment that a set of intervals along it leave uncovered. References
   already did this for pinches (`uncreased`, `plannerDiagram.ts`); it now
   uses the shared helper, so there are not two copies. References' tests pin
   its behaviour.
3. **The scene filter** (`sceneUnderMarks(scene, lines, toPicture)` beside
   `sceneCulledTo`): the scene with every covered stretch of a non-edge line
   taken out.
   - A line item that is wholly covered is dropped. A partly covered one is cut
     into what is left. Each piece keeps the crease's `whole`, so erode still
     measures on the crease, and its cut ends get `joined: false`.
   - **A face that strokes its own outline in a crease's pen**
     (`outline: 'aux'`) needs its own handling. A flat fold gives a face a
     uniform outline when every side is a flat crease (`emitWholeFace`,
     `foldedFlatScene.ts:863`): a face boundary made only of precreases is
     drawn by the face, not as lines. When a mark covers one of its sides, the
     outline comes off the face and goes back in as a line per side, right
     after the face, the way the producer emits a lined face. Then those lines
     are cut. A face outlined in `edge` is never touched.
   - When nothing is covered, it returns the same scene object, so object keys
     and caches hold.
4. **Painters:** the step's covering lines ride on the picture source as an
   optional field. They are set by the surfaces that draw marks. `stepPictureSource`
   stays the bare picture, which Export picture and Pose use. Every painter that
   builds a scene applies the filter where it already culls:
   - `paintScene` (`paintDiagramStep.ts:238`);
   - the scene and References branches of pages' `draw`
     (`pagePictures.ts:810`, `:831`);
   - `paintStepDiagram`, through the sheet's map to picture units.

   `sourceKey` (`useStepPictureUrl.ts:239`) includes the key, so a card or the
   canvas repaints only when what is hidden changes.
5. **Annotate canvas** (`useAnnotateCanvas.ts:440–473`): its picture memo
   deliberately ignores mark edits. It gains the covering key as one more input,
   so the picture repaints when a commit changes what is hidden, and not on
   other mark edits.

### Decisions (standing recs apply)

- **D1** Marks that hide: all five straight line kinds, not only dashed ones.
  A dotted hidden line has the same gaps, and a thin solid line in its own
  colour would let a wider crease show along its sides.
- **D2** Edges never hide. Found while building: the example crane's steps 13
  and 15 draw their valley lines along raw edges where flaps meet, so those
  still read solid. Asked Zach whether edges should hide too.
- **D3** A partial cover hides only the covered part (Zach, 2026-11-19: "yes
  hide that part").
- **D4** Nothing is stored (above).
- **D5** It applies wherever marks are drawn at full strength, but not in Export
  picture… or Pose.
- **D6** In Annotate it takes effect on commit, not during the preview.
- **D7** A mark drawn over another mark hides nothing. Marks are the author's,
  and one can be deleted.
- **D8** An upload or a fixed picture cannot hide its lines, which are pixels or
  markup.
- **D9** There is no per-mark "show the line under it" switch. Add one only if
  a real step needs both drawn.

### Risks, as checked

- **Carry drift.** Refresh Picture on the crane's step 6 carried a corner to
  corner valley line onto the new picture, and it still hid the precrease.
  Rotating the step in Pose leaves its marks where they were (as before this
  change), so a line no longer on its crease hides nothing — correct.
- **Two faces share a flat crease.** Each draws its own copy. At the crane's
  1% spread the copies lie within the tolerance and both hide; a larger
  spread parts them visibly, and then only the copy the mark is on hides.
- **Swapping the canvas picture's `<img>` source on commit.** No flash seen;
  the canvas showed the new picture on each commit, move, delete and undo.

## Affected Areas

- `apps/web/src/diagram/annotate/` — new `linesUnderMarks.ts`,
  `useLinesUnderMarks.ts` (+ tests); `useAnnotateCanvas.ts` — the canvas's
  picture, close-ups and window under the committed marks, and the analytics
  property
- `apps/web/src/diagram/pictures/` — new `sceneUnderMarks.ts` (the filter and
  `hideableSceneLines`, + tests); `paintDiagramStep.ts` — `sourceUnderMarks`,
  the source field, `paintScene`; `paintStepDiagram.ts` — References
  pictures; `useStepPictureUrl.ts` — `sourceKey`, cards
- `apps/web/src/diagram/pages/pagePictures.ts` — pages, PDF, print, step files
- `apps/web/src/diagram/zoom/paintZoomed.ts` — `zoomedUnderMarks`, enlarged
  windows
- `apps/web/src/lib/uncoveredSpans.ts` — the shared gaps helper (+ tests);
  `cp-workspace/references/diagram/plannerDiagram.ts` — `uncreased` on it
- `apps/web/src/analytics/trackDiagram.ts`, `analytics/events.ts`,
  `docs/analytics.md` — one enum property
- Pose (`DiagramStepDetail.tsx`) and Export Picture are unchanged: they paint
  the bare source.
- No Rust, wasm, file format, i18n strings or CSS.

## Checklist

- [x] D3 answered by Zach
- [x] Shared gaps-along-a-segment helper; References' `uncreased` on it, its tests green
- [x] `linesUnderMarks`: snapped line found; hand-drawn line a hair off not; `hidden` marks ignored; enlarged step's marks mapped out of the window; edges never count; a crease's near copy counts
- [x] `sceneUnderMarks`: whole and partial covers, reversed direction, two marks along one crease, edges kept, a uniform `aux` outline expanded and cut, `whole`/`joined` on cut pieces, bounds kept, same object when nothing is covered
- [x] Painters apply it (`paintScene`, `paintStepDiagram`, pages' `draw`); `sourceKey` keyed
- [x] Annotate canvas repaints on a commit that changes what hides, not on other mark edits
- [x] Export picture… and Pose unchanged (test)
- [x] Analytics: `diagram annotation added` gets `covers_line: 'whole' | 'part' | 'none'` for line marks
- [x] Browser: on a Fold step, a valley line along a precrease hides it at commit; moving the line off, deleting it and undoing each bring it back; the card, page and PDF match the canvas; no flash. Before/after screenshots
- [x] Risks checked: carry on re-pose and re-capture, a spread step; a face bounded by precreases by unit test (the crane has none)
- [x] Relevant tests + `tsc`/eslint; CI runs the full suite
- [ ] Zach: should edges hide too (D2)?
