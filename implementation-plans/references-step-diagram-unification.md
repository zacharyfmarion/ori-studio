# The step diagram, at any size, in one place

## What is changing, in plain English

The References workspace draws the same picture twice. The little card in the
filmstrip is an SVG built from the plan's own steps; the big view beside it is a
WebGL canvas built from the document's creases. They are meant to be the same
drawing at two sizes, and they are not: the card has the arrows, the dashed
fold lines, the turn-over symbol and the lettered references, and the big view —
the one you actually read — has none of them.

Three things follow from that, and this plan does all three.

**The picture becomes one description, drawn twice.** Today there are two sets
of rules for what a step looks like, written in two files, and they have already
drifted apart in four places. After this there is one list of shapes per step,
and two renderers that draw it: SVG for the card, the existing GPU renderer plus
a small overlay for the big view. Neither gets to invent anything.

**The drawing stops being tied to one size.** Every stroke in the card is
currently a fixed number of screen pixels no matter how big the picture is
drawn, so the same SVG at 800 px is a hairline sketch with dashes so short the
mountain and valley lines are indistinguishable. Widths, dashes, dots and
letters move to a unit tied to the *paper*, so the drawing scales with its box.

**The paper's other side stops glowing in dark themes.** Turning the sheet over
paints it a colour derived from the theme, and the derivation has no light/dark
branch. In a light theme it gives the origami-house grey; in a dark theme it
gives a slab far brighter than the ground, and every crease drawn on it loses
about half its contrast.

## Goal

One description of a step, drawn at any size, on both surfaces — and a back face
that reads as the same paper turned over rather than a different material.

## What was measured first

**Element counts, which turned out not to be the argument.** A build-up card
draws every earlier step's creases, so a full-pattern card is about one SVG
element per crease. Over 96 planned designs from the 582-CP native corpus: p50
**171** elements, p90 **978**, p99 **3,485**, realistic worst case
(Aristaeopsis, 6,982 edges) **7,499** — a 28 ms raw-DOM rebuild at that last
one, against a GPU renderer measured at 536k segments in 2.6 ms per frame.

That is a real difference and it is *not* why the main view stays on WebGL. The
filmstrip renders far more SVG than the main view ever would and is fine, so
"SVG cannot do this" was the wrong reading of
`implementation-plans/reference-finder-integration.md:304`. **The main view stays
on the GPU because it is the surface a rigid folding simulation would eventually
live on**, and that is worth a renderer that can already draw hundreds of
thousands of segments a frame.

The cost of that choice is named here rather than hidden: **two renderers
drawing one picture will differ in ways nothing catches.** The stroke program
extrudes a bare quad per segment — no caps, no joins — while the card has round
caps on solid lines and butt caps on dashed ones. At 1.2 px that is invisible;
on a 2.4 px pinch mark, and at the end of every dash on a zoomed-in valley, it
will not be. "The same picture" is true of the vocabulary and the content, not
of every pixel, and if the difference ever reads as a bug the answer is cap
geometry in the shader.

So the big view keeps the GPU renderer for the bulk and gains a **screen-space
SVG layer for what the renderer has no vocabulary for** — arcs, arrowheads, the
turn-over glyph, letters. Not a new idea here: `CpMeasureLayer.tsx:18-22` is the
same layer for the same stated reason ("the renderer has no glyph atlas, and the
object count is tiny"). Bounded by axiom arity at about a dozen nodes per step,
whatever the pattern's size.

**The dark-mode back face is an sRGB asymmetry, not a taste call.**
`applyTheme.ts:103` is `mixHexColors(bg.primary, text.primary, 0.7)` — 70% ground,
30% ink — with no `isLight` branch, unlike every neighbour in that function.
sRGB's transfer curve is steep near black and flat near white, so the same
30% byte move is a far larger luminance move away from a dark ground than
towards a light one. Measured over all 23 built-in themes, the back face sits
**1.80–2.57×** the ground's luminance in the dark themes against **1.74×** in
the light ones — and because crease-on-back contrast is exactly
crease-on-front ÷ that step, mountain red drops from 4.39:1 on dracula's front
to **1.72:1** on its back. Five dark themes put mountain under 2:1.

## Decisions

### D1 — one content model, two backends

A `DiagramPrimitive` list is the description; a `DiagramFrame` supplies the
coordinates. `unitFrame` reads the sequence in the planner's unit frame (the
card); `modelFrame` reads the already-mapped `ReferencesPlanModel` (the view).
The rules that decide *what* a step draws are written once, against the frame.

`cp_spans` endpoints are exact on the fold's chord — `Target::new` projects them
(`crates/oristudio-precrease/src/closure.rs:106`) — so recovering a span's
position along the model chord by its parameter is exact, not an approximation.

### D2 — a line says where it came from, and each line is drawn once

Both surfaces show the same *lines*. What differs is which channel draws them,
and the rule is that **no line is drawn twice**:

- **The step's own crease belongs to the step, never to the pattern.** It has
  not been folded yet — that is the whole content of the card — so the crease
  pattern has no business drawing it. `planVisibility` therefore builds up to
  step *k*−1 on a fold card, and the diagram draws the crease as the dashed fold
  line it is.
- **Earlier creases belong to the pattern, wherever the pattern is present.**
  The card has no pattern under it and draws them itself; the canvas has the
  document's own creases in the document's own ink, so the step there draws only
  what a crease pattern cannot hold — the pinches, and the auxiliary folds that
  leave no crease (`PlannerStepDiagramOptions.earlier`).

This was originally decided the other way — both channels drawing everything,
"a rule that makes one surface draw a different set of lines is the drift this
change exists to end" — and that was wrong on its own terms. Two copies of one
line are not a heavier line: they land a floating-point hair apart, and on a
dashed crease each copy fills the other's gaps, which is how the defect was
found (markhor step 1, commit `fe674906`). Drawing each line once *is* the
anti-drift rule; the check that the surfaces agree belongs in the tests, not in
overdrawing.

`cpLineIds` on the `line` primitive is still worth carrying — it is how a
consumer knows which creases a primitive stands for, and the visibility pass
needs exactly that.

### D3 — ink is a share of the paper, set at fit

`vector-effect: non-scaling-stroke` and every hard-coded `stroke-width`,
`stroke-dasharray` and `font-size` come out of the stylesheet and become a
sheet-relative unit. One ink ≈ one CSS pixel on today's 118 px card (94.4/96 =
0.983), so the card is unchanged to within 1.7%, and the same table drives an
800 px drawing correctly.

On the canvas the unit is fixed by the sheet **at fit zoom**, then modulated by
the existing `cpSizingScales` `widthBoost` — the Edit canvas's own law. Setting
it from the live camera instead would give a 10× pen at 10× zoom.

Colour stays in `theme.css`; only geometry moves. That split is a convention a
test guards by value, not by location.

### D4 — the back face is capped by contrast, not by a fixed ratio

`paperBackFor(bg, ink)` returns the largest ink fraction ≤ 0.30 whose WCAG step
against the ground is ≤ **1.9** — just above the light themes' own measured band
(1.43 solarized-light to 1.88 github-light), so the rule that exists for the
dark themes cannot disturb the light ones it copies and does not hinge on one
preset's exact bytes.

It emits flat hex: `renderer/cssColor.ts` parses only hex and `rgb()`, and a
`color-mix()` there falls back to an invisible back face, which has shipped
before (`cssColor.test.ts:33-38`).

Measured after: every dark theme is inside 1.90, and **mountain on the back face
goes from a worst case of 1.54:1 (cobalt2) to 2.04:1**. Fourteen dark themes
move; four (solarized-dark, palenight, one-dark, tokyo-night) and all five light
themes are untouched.

This is a legibility fix, not a WCAG one. 3:1 for mountain on the back face is
unreachable by any luminance step in a dark theme, and light mode does not
reach it today either.

## Affected areas

- `apps/web/src/themes/paperBack.ts` (new), `applyTheme.ts`, `styles/theme.css` — D4.
- `apps/web/src/cp-workspace/references/diagram/` (new) — `diagramModel.ts`,
  `diagramFrames.ts`, `plannerDiagram.ts`, `diagramInk.ts`, `inkScale.ts`,
  `diagramToScene.ts`.
- `stepDiagramGeometry.ts` — the projector gains a basis and a `flipped` flag;
  `labelPlacement` moves to ink units.
- `StepDiagram.tsx` — reads the ink table, emits geometry as attributes.
- `plannerStepToPrimitives.ts` — deleted, its rules moving to `plannerDiagram.ts`.
- `referencesPlanGeometry.ts` — `planStepOverlay` and `markSpan` replaced by a
  scene built from the shared model.
- `ReferencesCpView.tsx`, `ReferencesDiagramLayer.tsx` (new),
  `useReferencesDiagram.ts` (new), `ReferencesPanel.tsx`.
- `renderer/CpRenderer.ts`, `reglRenderer.ts` — `previewWidthPx` on the frame.
- `cpOverlayViewStore.ts` — extracted as a factory so the References view owns
  its own instance rather than publishing into the editor's singleton (D5 of the
  integration plan names this explicitly).

## Checklist

- [x] **Phase 0 — stop highlighting the creases that locate a mark.** Shipped:
      `locatingSpans` and its index are gone, a test pins the ring-alone rule,
      and the existing test that named axiom inputs still highlight stays green.
      The main view never had the behaviour (`referencesPlanGeometry.ts:243`).
- [x] **Windowing the filmstrip.** Done, using the `@tanstack/react-virtual`
      the diagnostics HUD already uses. Measured in a real browser at 200 steps:
      **9 cards and 117 SVG elements mounted** instead of 200 cards, with the
      track reporting the full 27,200 px so the scrollbar is still the plan's
      length. The window follows the scroll (cards 92–105 at 13,000 px).
- [x] **Phase 1 — the dark-mode back face.** `paperBackFor` + a test that runs
      the rule over all 23 built-in themes, so it is checked in CI rather than
      trusted from a table. Worst mountain-on-back 1.54:1 → 2.04:1.
- [x] **Phase 2 — the ink unit and the scale law.** Card-only, and should be
      visually near-identical, which is why it ships before anything moves. A
      test renders one model at 100 and at 800 and asserts every numeric
      attribute scales by exactly 8 — that is the definition of "any size", and
      it fails today for all of them.
- [x] **Phase 3 — the shared content model.** No visible change. Four existing
      drifts get resolved explicitly, and an anti-drift test runs the same
      sequence through both frames and asserts identical primitives.
- [x] **Phase 4 — the main view gets the picture.** Scene adapter, the overlay
      layer, `previewWidthPx`, per-instance overlay store.
- [x] **Phase 5 — arrows in target mode.** After Phase 4 the plan
      view has arrows and the *targeted* view — what a first vertex click lands
      you on — does not. Its overlay is built from mapped **points**
      (`referencesStepGeometry.ts:100`), and an arrow is an arc: centre, radius,
      two angles, none of which a point map carries.

      Done exactly that way, and it needed no Rust: `arcSamplePoints` puts three
      points on the arc into the batch `rfToModelMany` already sends, and
      `arcThroughPoints` fits the image circle back out of them. The middle
      sample is load-bearing — it carries the direction, which the two ends
      cannot, and the reflection in the frame map reverses it.


## Flagged, not fixed

- `--fold-unassigned` is a hard literal in `theme.css:118` that `applyTheme`
  never sets, unlike every other `--fold-*`, so the context-crease ink cannot
  follow a per-theme rule. Fixing it touches the Edit canvas.
- `referencesSheets.ts:125` is a fourth SVG renderer of CP creases, uncapped.
  A real dedupe target; folding it in would grow this past landability.

## Settled

- **Dark mode matches light mode's outcome** (D4), on the author's call. If the
  complaint was ever "I can't tell which face I'm on" rather than "the back face
  washes out the creases", this moves the wrong way and the lever is chroma at
  matched luminance instead.
- **The main view stays on WebGL**, for the folding simulation it will host
  rather than for element counts. The drift that buys is named under "What was
  measured first" and is the thing to watch.
- **Both surfaces draw the same lines, and each line once** (D2). Which channel
  draws a given line depends on whether that surface already has the crease
  pattern beneath it; what is drawn does not.
- **The big view draws the letters.** They are part of "the same picture". The
  caption still names references in words, so a reader gets a legend with no
  key until the sentence learns the letters — worth doing, and not in this plan.

## Still open


- **The pink is now inconsistent.** A reference mark is a ring in the drawing's
  own ink; the letter beside it and the input lines it names are still
  `--cp-reference-input`. That is defensible — the circling picks out a point,
  the colour picks out a line, and a letter is an annotation rather than part of
  the picture — but it is a call, not a derivation.
