# Fold pens and diagram-crease pens

## Goal

Give the paper style two pen pairs for the two things a mountain or valley
line can mean, as origami draws them:

- a **fold** (`mountainFolds` / `valleyFolds`) — a line of a crease pattern:
  this crease exists and goes this way. Drawn solid, coloured by direction
  (the crease-pattern convention). Wherever a crease pattern lies on the
  style's paper: the pattern on References' *Find a reference* tab, the
  finished card of a precreasing sequence, and simulations drawing creases by
  direction.
- a **diagram crease** (`mountainDiagramCreases` / `valleyDiagramCreases`) —
  an instruction on a diagram step: fold here, this way. Drawn dashed
  (valley) and dash-dot (mountain), the diagramming convention. Only on
  References steps: the step's own fold, on the card, the big view and the
  step's paper export.

"Crease" and "fold" alone are used interchangeably in origami, so the names
carry the distinction: *diagram* crease is the instruction.

Today one pair, `mountainFolds` / `valleyFolds`, serves both, and the Default
preset dashes it because steps need dashes — so the Find tab's pattern and a
simulation drawn by direction come out dashed.

Decided with the user (2026-09-29):

- The names: `mountainFolds` / `valleyFolds` keep the crease-pattern meaning;
  the new pair is `mountainDiagramCreases` / `valleyDiagramCreases`
  (plural, as every pen field is).
- The Find tab's pattern keeps using the paper style — the fold pens.
- The finished card draws in the fold pens, not the diagram-crease pens: it
  is the pattern. (This reverses the older plan's Phase 9 row "the collapse is
  the next fold".)
- Creases earlier steps made keep their look on a step card. (They already
  read the aux pen, so they are untouched.)
- No backwards compatibility and no migration: the style is unreleased. A
  stored style missing the new fields takes their defaults, field by field,
  as `normalizePaperStyle` already does for any missing field.

## Approach

### The model

`PaperStyle` gains `mountainDiagramCreases` and `valleyDiagramCreases`. The
existing `mountainFolds` / `valleyFolds` keep their name and meaning for every
surface but References steps, and turn solid by default.

| Field | Meaning | Default preset | Diagram preset |
| --- | --- | --- | --- |
| `mountainFolds` | a mountain line of a crease pattern | solid, `#db1f24`, 0.825 pt | solid, `#db1f24`, 0.75 pt |
| `valleyFolds` | a valley line of a crease pattern | solid, `#1c5cd9`, 0.825 pt | solid, `#1c5cd9`, 0.75 pt |
| `mountainDiagramCreases` | "mountain fold here" on a step | dash-dot, `#db1f24`, 0.825 pt (today's fold pen) | black dash-dot, 0.75 pt (today's) |
| `valleyDiagramCreases` | "valley fold here" on a step | dashed, `#1c5cd9`, 0.825 pt (today's) | black dashed, 0.75 pt (today's) |

The Diagram preset keeps red/blue fold pens: a crease pattern is read by
colour, and black would leave mountain and valley apart only by dash, which is
the diagram creases' job. (Proposed — the user can pick black.)
> **Decided otherwise** (2026-09-30): the user picked black. Diagram is black
> and white throughout — its fold pens are its one `#231f20` ink, as its aux
> creases and edge are — so a simulation in it has no colour on the page. It
> is lit, too, as the Default is.

Default's fold pens become exactly main's simulator crease look, so
`creaseStyleOf(DEFAULT_PAPER_STYLE)` becomes `'color'` (main's simulator
default) and the Oriedita dash multiples stay valid. The simulator's editors,
the crease-style modes, `edgeInkEdits`, the legacy simulator seed and the
start figure already read `mountainFolds` / `valleyFolds` and do not change.

Registration: `PaperStyleFieldValues`, `PAPER_STYLE_FIELDS`, and — easy to
miss — the pen cases of `parsePaperStyleField`, whose `default:` returns
undefined, so a field missing there resets to its default on every load and
drops from every pin without a type error. A test asserts every pen field
round-trips through `normalizePaperStyle` and `normalizePaperStyleOverrides`.
`PAPER_STYLE_PEN_FIELDS` is dead and goes.

### Which pen each line reads

| Line | Meaning | Pen after the split |
| --- | --- | --- |
| Simulation by direction (GPU, canvas-2D fallback, vector export), inline windows, the start figure | crease pattern | fold pens (unchanged; now solid by default) |
| Simulation with *Render all creases as edges* | folded edge | edge pen at the average of the fold widths (unchanged) |
| 3D and flat folded figures | folded edge | edge pen (unchanged) |
| References *Find a reference* pattern, and the picked crease on it (keeps its accent, takes the fold pen's width and dash) | crease pattern | fold pens (unchanged; now solid by default) |
| References finished card — strip card and big view | crease pattern | fold pens |
| References step: the step's own fold, pleats, pinches (colour), ReferenceFinder action lines, diagonals — card, big view, fold animation, export | instruction | **diagram-crease pens** |
| References step: creases earlier steps made | there but flat | aux pen (unchanged) |
| Settings: preset thumbnail's little crease pattern; the erode close-up's valley line | crease pattern | fold pens (unchanged) |
| Edit canvas, crease-pattern export, share card's pattern, pattern rails | — | unchanged: their own fixed look, not the style |

### The painter's roles

`PaperLineRole` (`packages/origami-simulator/src/paperScene.ts`) is
`'edge' | 'mountain' | 'valley' | 'aux'`, and `penForRole` maps it to a pen
with no knowledge of the surface. `'mountain'` / `'valley'` keep meaning a
crease-pattern line → the fold pens, as the mesh producer and stored `.osf`
3D scenes emit them. New `'diagram-mountain'` / `'diagram-valley'` mean an
instruction → the diagram-crease pens; only `diagramToPaperScene` emits them
(the step's `mountain`, `valley` and `pinch-*` styles, mirrored M↔V as today).

Every list of roles gains the two: `penForRole`, `widestPenPt`,
`cpFoldedToScene`'s `PAPER_LINE_ROLES`, `nativeProjectFile`'s
`sceneLineRole`, the scene fixtures. The simulator package's `dist` is
rebuilt (a stale copied `dist` presents as a missing role).

### Policies

`PAPER_STYLE_POLICIES.references` applies the fold pens, the diagram-crease
pens and the arrows. No other policy applies the diagram-crease pens (no other
surface draws an instruction), so no object can pin them. `surfacePaperStyle`
does alias them, though, for every surface whose policy leaves them out: to
that surface's fold pens. `widestPenPt` counts every role, and left at their
defaults (0.825 pt) the diagram-crease pens would widen a simulation's or a
folded figure's ink allowance and page margin — the Diagram preset's 0.5 pt
edge would measure 0.825 pt — though the surface never draws one.

### References

Two channels draw M/V on the canvas, and now take different pens:

- the **crease channel** (`referencesCreasePens`' `ROLE_PEN`, and the `done`
  directions branch of `applyCreaseVisibility`) — the Find tab's pattern and
  the finished card on the big view: fold pens, as today;
- the **diagram channel** (`diagramToScene`) and the cards — the step's own
  fold: diagram-crease pens.

Line styles: the step's `mountain` / `valley` / `pinch-*` styles take the
diagram-crease pens. The finished strip card (`plannerFinishedDiagram`) today
emits the same `mountain` / `valley` styles, so it gains its own pair (e.g.
`fold-mountain` / `fold-valley`) that reads the fold pens, added to every
style table that must know it (`DiagramLineStyleName`, `DIAGRAM_LINE_INK`,
`TOKENS`, `OTHER_FACE`, `LINE_ROLES`, the card CSS, `diagramDashSlot`) and
**not** to `NEW_CREASE_STYLES` or `LOUD_LINES`, which mean "the step's own
new crease".

Colours: the workspace root gains `--diagram-mountain` /
`--diagram-valley` beside `--fold-mountain` / `--fold-valley`
(`referencesPaperTokens`); the instruction styles and their card classes read
the diagram tokens, the crease channel and the finished card the fold tokens.
`--references-dim-alpha`, derived from the fold inks and read by nothing, goes.

Dash slots: a stroke geometry carries one dash table of at most
`MAX_DASH_SLOTS = 4` patterns, today `['valley', 'mountain', 'dotted',
'crease']` for both channels. During a fold the pose merges the crease
channel's flap with the diagram's under **one** table, the crease channel's
(`foldPoseGeometry`, `dashPatterns ??= …`). With the pens split, the diagram's
fold lines would then draw in the fold pens' (solid) dash mid-animation. So
the table grows to six shared slots — the two diagram creases, `dotted`,
`crease`, the two folds — both channels use the same assignment, and
`MAX_DASH_SLOTS` and the stroke program's uniform arrays go to 6. `FoldPaint`'s
other-face swap (`otherFaceInk`, `swapSlot`) learns both pairs.

### Settings ▸ Paper (content only; the tab's shell is unchanged)

- **Lines** — Edges, Mountain folds, Valley folds, Auxiliary creases. Hint:
  where they draw (simulations, folded figures, the pattern in References).
- **Steps** — Mountain diagram creases, Valley diagram creases, Arrows. Hint
  stays "References only".

Labels: `dialogs:settings.paper.pen.mountainDiagramCreases` /
`valleyDiagramCreases` and the pin labels, eight locales. Analytics:
`PaperStyleFieldName` gains the two fields (a fixed list not tied to
`PaperStyleField`; a test pins the two lists equal); `docs/analytics.md`
follows.

### Not in scope

- Pre-existing and unrelated: a pinch is solid in the table pen on screen but
  takes the full pen (dash included) on the exported page; `dotted` is dashed
  on screen and the aux pen on the page.
- The edit canvas, crease-pattern export and pattern rails keep their fixed
  look.

## Affected Areas

- Model and presets: `lib/paper/paperStyle.ts`, `paperPresets.ts`,
  `paperStyleResolve.ts`, `paperSvg.ts`
- Painter roles: `packages/origami-simulator/src/paperScene.ts` (type only),
  `cp-workspace/adapters/cpFoldedToScene.ts`, `lib/nativeProjectFile.ts`,
  `lib/paper/paperScene.fixtures.ts`,
  `cp-workspace/references/diagramToPaperScene.ts`
- References: `usePaperStyleTokens.ts`, `diagram/diagramInk.ts`,
  `diagram/diagramColors.ts`, `diagram/diagramModel.ts`,
  `diagram/plannerDiagram.ts`, `referenceFinderDiagramToPrimitives.ts`,
  `referencesViewGeometry.ts`, `referencesCreaseVisibility.ts`,
  `ReferencesCpView.tsx`, `fold/foldPoseGeometry.ts`, `styles/theme.css`
- Renderer: `renderer/types.ts` (`MAX_DASH_SLOTS`),
  `renderer/programs/strokeProgram.ts`
- Settings: `components/settings/PaperSettings.tsx`
- `analytics/events.ts`, `i18n/enumLabels.ts`, `public/locales/*/dialogs.json`,
  `docs/analytics.md`
- Plans: `unified-paper-style-and-export.md` (§1, D10, presets, policies,
  Phase 9 table, Phase 11) and `paper-export-dialog.md` (E16, the Lines hint)
  marked as superseded where they name one M/V pair

## Checklist

Ordered so every commit draws correctly: the new pens arrive carrying
today's dashed values (nothing changes on screen), References moves its
instruction lines onto them, and only then do the fold pens turn solid.

### Phase 1 — The model, the painter, Settings

- [x] `mountainDiagramCreases` / `valleyDiagramCreases` in `PaperStyle`, the
      field lists, `parsePaperStyleField`, `DEFAULT_PAPER_STYLE` and the
      Diagram preset — at today's fold-pen values, so nothing changes yet;
      `PAPER_STYLE_PEN_FIELDS` deleted; a round-trip test over every pen field
- [x] Roles `'diagram-mountain'` / `'diagram-valley'`; `penForRole` and
      `widestPenPt`; every role list; simulator `dist` rebuilt. (Emitting
      them from `diagramToPaperScene` moved to Phase 2: switched alone, a
      step's page would draw in the diagram-crease pens while its card still
      drew in the fold pens, which differ as soon as either is edited — the
      Simulate pane's Mono mode writes the fold pens, for one.)
- [x] The References policy applies the diagram-crease pens; every other
      surface sees them as its fold pens (`surfacePaperStyle`)
- [x] Settings ▸ Paper: Lines (Edges, Mountain folds, Valley folds,
      Auxiliary creases), Steps (Mountain diagram creases, Valley diagram
      creases, Arrows); hints; pen and pin labels; `PaperStyleFieldName` and a
      test tying it to `PAPER_STYLE_FIELDS`; `docs/analytics.md`; i18n loop
- [x] Tests, mutation-checked; validate; commit

### Phase 2 — References

- [x] `--diagram-mountain` / `--diagram-valley` on the workspace root;
      `--references-dim-alpha` removed. (Also from `:root`: `applyTheme` set
      it too, and `referencesDimAlpha` goes with it. The visibility's own
      `dimmed` / `dimAlpha` fields stay — every visibility still returns 1 —
      since dropping that channel is a separate change. Outside the workspace
      the diagram-crease inks fall back to the theme's fold inks, in the card
      CSS and in `diagramColors`' `TOKEN_FALLBACKS`, as the arrow pen does.)
- [x] The instruction styles (cards, big view, animation) on the
      diagram-crease pens, and `diagramToPaperScene` emitting the diagram
      roles for them, in the same commit; the crease channel and the finished
      card (strip and big view, with its own style pair) on the fold pens.
      (The pair is `fold-mountain` / `fold-valley`; the crease channel's
      `ROLE_PEN` and the `done` directions read them through one `FOLD_PEN`
      map, and its ink record is keyed by them.)
- [x] Six shared dash slots; `MAX_DASH_SLOTS` and the stroke program to 6;
      the fold pose's merged table and other-face swap carry both pairs.
      (The fold slots are appended as 5 and 6, so the first four keep their
      numbers. `FoldPaint` carries a list of direction pairs, and a stroke's
      pair is found by its dash slot — no two pairs share one — with its ink
      as the fallback for a solid pinch; ink alone would be ambiguous as soon
      as one pair's mountain ink equals the other's valley.)
- [x] Tests: tokens, card and canvas pens, the finished card, crease
      visibility, the fold pose (a fold animating over the crease channel
      keeps its diagram-crease dash), the step export, and **screen–page
      parity**: for one style, a step card's ink and dash for each line equal
      the exported page's pen; mutation-checked. (Parity is
      `referencesPenParity.test.tsx`: card, big view and page, for a step's
      fold and for the real finished card, with the two pairs apart in colour,
      width, dash and cap. Twenty mutations, each caught.) The review found
      the canvas's own inks untested — which pair the Find tab's pattern and a
      flap's other face take — so they moved out of `ReferencesCpView` into
      `referencesCanvasInks.ts`, pure over a token reader, with tests; and
      pinned each dash uniform to its own slot and the pinches' card colours.
- [x] Validate; commit

### Phase 3 — The fold pens turn solid

- [x] Default: `mountainFolds` / `valleyFolds` solid, same inks and weight;
      Diagram: solid red/blue at 0.75 pt (*later black: see the note on the
      Diagram preset above*); the diagram-crease pens keep the dashes. `creaseStyleOf(DEFAULT_PAPER_STYLE)` is now `'color'`
- [x] Re-pin every test that read Default's fold dash (simulations, the
      Simulate pane, the preset thumbnail, the erode close-up, Settings) —
      nine, in the presets, crease modes, resolver, thumbnail, Settings and
      the simulation export's golden, which is now painted with the fold pens
      dashed as they were when it was written rather than re-recorded, so it
      still proves the dialog's page is the retired `exportSvg`'s
- [x] Browser: Find tab solid under Default and Diagram; a step card and its
      big view still dashed (the animation runs too fast to catch mid-pose;
      its dash under the merged table is the fold pose's unit test); earlier
      creases unchanged (the aux pen); the finished card solid on the strip
      and the big view; a simulation drawn by direction solid; dark and light
      themes
- [x] Validate; commit

### Phase 4 — Plans and docs

- [x] Mark the older plans' one-pair wording as superseded here — D10, §1
      `PaperStyle`, the Phase 9 ink table's "about to be folded" row and
      Phase 11 of `unified-paper-style-and-export.md`; E16 of
      `paper-export-dialog.md`, which also names `pensHint` → `linesHint`
- [x] `git diff --check`; commit
