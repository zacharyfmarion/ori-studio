# Crease pens and fold pens

## Goal

Give the paper style two pen pairs for the two things a mountain or valley
line can mean, as origami draws them:

- a **crease** — a fact about the paper: this crease exists and goes this way.
  Drawn solid, coloured by direction (the crease-pattern convention). Where a
  crease pattern lies on the style's paper: the pattern on References' *Find a
  reference* tab and simulations drawing creases by direction.
- a **fold** — an instruction on a diagram step: fold here, this way. Drawn
  dashed (valley) and dash-dot (mountain), the diagramming convention. Only on
  References steps: the step's own fold, on the card, the big view and the
  step's paper export.

Today one pair, `mountainFolds` / `valleyFolds`, serves both, and the Default
preset dashes it because steps need dashes — so the Find tab's pattern and a
simulation drawn by direction come out dashed.

Decided with the user (2026-09-29):

- The Find tab's pattern keeps using the paper style — the new crease pens.
- Creases earlier steps made keep their look on a step card. (They already
  read the aux pen, not the M/V pens, so they are untouched by this.)
- No backwards compatibility and no migration: the style is unreleased. A
  stored style missing the new fields takes their defaults, field by field,
  as `normalizePaperStyle` already does for any missing field.

## Approach

### The model

`PaperStyle` gains `mountainCreases` and `valleyCreases` (pens). The existing
`mountainFolds` / `valleyFolds` keep their name and become fold pens only.

| Field | Meaning | Default preset | Diagram preset |
| --- | --- | --- | --- |
| `mountainCreases` | a mountain crease on the paper | solid, `#db1f24`, 0.825 pt | solid, `#db1f24`, 0.75 pt |
| `valleyCreases` | a valley crease on the paper | solid, `#1c5cd9`, 0.825 pt | solid, `#1c5cd9`, 0.75 pt |
| `mountainFolds` | "mountain fold here" on a step | dash-dot, `#db1f24`, 0.825 pt (as now) | black dash-dot, 0.75 pt (as now) |
| `valleyFolds` | "valley fold here" on a step | dashed, `#1c5cd9`, 0.825 pt (as now) | black dashed, 0.75 pt (as now) |

The Diagram preset keeps red/blue crease pens: a crease pattern is read by
colour, and black crease pens would leave mountain and valley apart only by
dash, which is the fold pens' job. (Proposed — the user can pick black.)

Default's crease pens are exactly main's simulator crease look, so
`creaseStyleOf(DEFAULT_PAPER_STYLE)` becomes `'color'`, main's simulator
default, and the Oriedita-dash multiples stay valid.

Registration: `PaperStyleFieldValues`, `PAPER_STYLE_FIELDS`, and — easy to
miss — the pen cases of `parsePaperStyleField`, whose `default:` returns
undefined, so a field missing there resets to its default on every load and
drops from every pin without a type error. A test asserts every pen field
round-trips through `normalizePaperStyle` and `normalizePaperStyleOverrides`.
`PAPER_STYLE_PEN_FIELDS` is dead and goes.

### Which pen each line reads

| Line | Meaning | Pen after the split |
| --- | --- | --- |
| Simulation by direction (GPU, canvas-2D fallback, vector export), inline windows, the start-screen figure | crease | crease pens |
| Simulation with *Render all creases as edges* | folded edge | edge pen at the average of the **crease** widths |
| 3D and flat folded figures | folded edge | edge pen (unchanged — neither policy applies a direction pen) |
| References *Find a reference* pattern, and the picked crease on it (keeps its accent, takes the crease pen's width and dash) | crease | crease pens |
| References step: the step's own fold, pleats, pinches (colour), ReferenceFinder action lines, diagonals — card, big view, export | fold | fold pens (unchanged) |
| References step: creases earlier steps made | there but flat | aux pen (unchanged) |
| References finished card (strip and big view) | the collapse — the next fold | fold pens (unchanged; see Open question) |
| Settings: preset thumbnail's little crease pattern; the erode close-up's valley line | crease | crease pens |
| Edit canvas, crease-pattern export, share card's pattern, pattern rails | — | unchanged: their own fixed look, not the style |

### The painter's roles

`PaperLineRole` (`packages/origami-simulator/src/paperScene.ts`) is
`'edge' | 'mountain' | 'valley' | 'aux'`, and `penForRole` maps it to a pen
with no knowledge of the surface. Two surfaces put M/V roles on a page:
simulations (creases) and References steps (folds). So the role says which:

- `'mountain'` / `'valley'` — a crease; `penForRole` → the crease pens. The
  mesh producer (`roleOf(EDGE_CODE)`) and stored `.osf` 3D scenes keep
  emitting these, and their meaning does not change.
- new `'mountain-fold'` / `'valley-fold'` — an instruction; `penForRole` →
  the fold pens. Only `diagramToPaperScene` emits them (the step's `mountain`,
  `valley`, `pinch-*` styles, mirrored with M↔V as today).

Every list of roles gains the two: `penForRole`, `widestPenPt`,
`cpFoldedToScene`'s `PAPER_LINE_ROLES`, `nativeProjectFile`'s
`sceneLineRole`, the scene fixtures. The simulator package's `dist` is
rebuilt (a stale copied `dist` presents as missing roles).

The alternative — keep the roles and have `surfacePaperStyle` copy the crease
pens into the fold slots per surface — was rejected: References draws both
kinds on one surface, so the alias would have to be per scene, and "the
`mountainFolds` slot holds a crease pen" is a trap.

### Policies and the resolver

`paperStyleResolve.ts`:

- `SIMULATION_FIELDS` swaps `mountainFolds` / `valleyFolds` for
  `mountainCreases` / `valleyCreases` (both simulation policies, which must
  stay identical — `exportScene` always applies the simulator's).
- The `references` policy applies both pairs and the arrows.
- `surfacePaperStyle`: folded figures alias the crease pens (and the fold
  pens, harmlessly) to the edge pen; a simulation with `foldsAsEdges` draws
  the crease pens as the edge pen at the average of the crease widths.
- `resolvePaperStyle` reads the crease pens into `RenderSettings`'
  `mountainColor` / `valleyColor` / `mountainWidthPx` / `valleyWidthPx` /
  `creaseDash`. `RenderSettings`, `CreaseDash`, the shaders and the worker
  protocol already mean "a crease of that direction" and do not change.

### Simulations' editors

The Simulate pane's Mountain / Valley rows, a simulation window's Properties
rows and pins, the crease-style modes (`creaseStyleOf` / `applyCreaseStyle`,
`ORIEDITA_CREASE_PX`), `edgeInkEdits`' mono follow, and the start-screen
figure all move to the crease pens. `paperStyleFromSimulatorSettings` — the
one real migration, from main's released simulator settings — seeds the
crease pens.

The folded figure's Properties and Style-menu branches gated on
`policyApplies(policy, 'mountainFolds')` are always false today (neither
folded policy applies a direction pen since Phase 9 of the older plan); they
and their stale comments go.

### References

Two channels draw M/V on the canvas, and they now take different pens:

- the **crease channel** (`referencesCreasePens`' `ROLE_PEN`, the `done`
  directions branch of `applyCreaseVisibility`) — the Find tab's pattern
  takes the crease pens; the finished card's directions stay on the fold pens
  (per the table);
- the **diagram channel** (`diagramToScene`) — the step's fold, fold pens.

Colours: the workspace root gains `--crease-mountain` / `--crease-valley`
beside `--fold-mountain` / `--fold-valley` (`referencesPaperTokens`), and
`overlayColors` reads the crease tokens for the crease channel.
`--references-dim-alpha`, derived from the fold inks and read by nothing,
goes.

Dash slots: a stroke geometry carries one dash table of at most
`MAX_DASH_SLOTS = 4` patterns, today `['valley', 'mountain', 'dotted',
'crease']` for both channels. During a fold the pose merges the crease
channel's flap with the diagram's under **one** table, the crease channel's
(`foldPoseGeometry`, `dashPatterns ??= …`). With the pens split, the
diagram's fold lines would then draw in the crease pens' dash mid-animation.
So the table grows to six shared slots — `valley`, `mountain`, `dotted`,
`crease`, `crease-valley`, `crease-mountain` — both channels use the same
assignment, and `MAX_DASH_SLOTS` and the stroke program's uniform arrays go to
6. `FoldPaint`'s other-face swap (`otherFaceInk`, `swapSlot`) learns the
crease pair as well as the fold pair.

### Settings ▸ Paper (content only; the tab's shell is unchanged)

- **Lines** — Edges, Mountain creases, Valley creases, Auxiliary creases. Hint:
  where they draw (simulations, folded figures, the pattern in References).
- **Steps** — Mountain folds, Valley folds, Arrows. Hint stays "References
  only".
- The *Render all creases as edges* hint and the Simulate pane's help say the
  crease widths are averaged.
- Pen cards keep the two-sided sample; the preset thumbnail and the erode
  close-up draw the crease pens.

Labels: `dialogs:settings.paper.pen.mountainCreases` / `valleyCreases` and the
pin labels `dialogs:paperExport.pin.mountainCreases` / `valleyCreases`, eight
locales. Analytics: `PaperStyleFieldName` gains the two fields (a fixed list,
not tied to `PaperStyleField` — nothing enforces it, so a test pins the two
lists equal); `docs/analytics.md` follows.

### Open question

**The finished card.** The older plan's Phase 9 decided "the collapse is the
next fold", so it draws in the fold pens — dashed under Default. It is also
the whole pattern, which reads as a crease pattern. This plan keeps the
decision; moving it to the crease pens is one visibility branch and one
diagram style.

### Not in scope

- Pre-existing and unrelated: a pinch is solid in the table pen on screen but
  takes the full fold pen (dash included) on the exported page; `dotted` is
  dashed on screen and the aux pen on the page.
- The edit canvas, crease-pattern export and pattern rails keep their fixed
  look.

## Affected Areas

- Model and presets: `lib/paper/paperStyle.ts`, `paperPresets.ts`,
  `paperStyleResolve.ts`, `paperSvg.ts`, `paperThumbnail.ts`,
  `lib/paperStyleSettings.ts`
- Painter roles: `packages/origami-simulator/src/paperScene.ts` (type only),
  `cp-workspace/adapters/cpFoldedToScene.ts`, `lib/nativeProjectFile.ts`,
  `lib/paper/paperScene.fixtures.ts`,
  `cp-workspace/references/diagramToPaperScene.ts`
- Simulations: `simulator/useSimulatorPaperStyle.ts`,
  `components/panels/SimulatorViewControlsPanel.tsx`,
  `cp-workspace/paper/paperStyleFields.ts`,
  `cp-workspace/inlineSimulation/inlineSimulationProperties.ts`,
  `components/start/startFigurePaper.ts`
- Folded figures (dead-branch removal): `foldedFigureProperties.ts`,
  `foldedFigureActions.ts`
- References: `usePaperStyleTokens.ts`, `diagram/diagramInk.ts`,
  `diagram/diagramColors.ts`, `referencesViewGeometry.ts`,
  `referencesCreaseVisibility.ts`, `ReferencesCpView.tsx`,
  `fold/foldPoseGeometry.ts`, `styles/theme.css`
- Renderer: `renderer/types.ts` (`MAX_DASH_SLOTS`),
  `renderer/programs/strokeProgram.ts`
- Settings: `components/settings/PaperSettings.tsx`, `PaperErodePreview.tsx`,
  `PaperFoldedCard.tsx`, `PaperSlotHeader.tsx`
- `analytics/events.ts`, `i18n/enumLabels.ts`, `public/locales/*/dialogs.json`,
  `public/locales/*/panels.json`, `docs/analytics.md`
- Plans: `unified-paper-style-and-export.md` (§1, D10, presets, policies,
  Phase 9 table, Phase 11) and `paper-export-dialog.md` (E16, the Lines hint)
  marked as superseded where they name one M/V pair

## Checklist

### Phase 1 — The model, simulations and the painter

- [ ] `mountainCreases` / `valleyCreases` in `PaperStyle`, the field lists,
      `parsePaperStyleField`, `DEFAULT_PAPER_STYLE` and the Diagram preset;
      `PAPER_STYLE_PEN_FIELDS` deleted; a round-trip test over every pen
      field (normalise and overrides)
- [ ] Crease-style modes, `edgeInkEdits`, `ORIEDITA_CREASE_PX` and the legacy
      simulator seed on the crease pens
- [ ] Roles `'mountain-fold'` / `'valley-fold'`; `penForRole` and
      `widestPenPt`; every role list; `diagramToPaperScene` emits them;
      simulator `dist` rebuilt
- [ ] Policies and resolver: simulations read the crease pens, References
      both pairs, folded figures alias to the edge pen; the as-edges average
      over the crease widths
- [ ] Simulate pane rows, simulation-window rows and pins, the start figure;
      the folded figure's dead fold-pen branches removed
- [ ] Tests re-pinned (simulation, resolver, painter, step export, presets,
      Simulate pane, inline properties, objects) and mutation-checked
- [ ] Validate; commit

### Phase 2 — Settings ▸ Paper, labels, analytics

- [ ] Lines: Edges, Mountain creases, Valley creases, Auxiliary creases;
      Steps: Mountain folds, Valley folds, Arrows; hints
- [ ] Preset thumbnail and erode close-up on the crease pens
- [ ] Pen and pin labels; `PaperStyleFieldName` and a test tying it to
      `PAPER_STYLE_FIELDS`; `docs/analytics.md`
- [ ] i18n loop (extract, eight locales, stamp, check)
- [ ] Tests (PaperSettings, PaperFoldedCard, thumbnail, usePaperSettings)
- [ ] Validate; commit

### Phase 3 — References

- [ ] `--crease-mountain` / `--crease-valley` on the workspace root;
      `--references-dim-alpha` removed
- [ ] The crease channel's pattern (Find tab, picked crease) in the crease
      pens; the finished card and the diagram channel on the fold pens
- [ ] Six shared dash slots; `MAX_DASH_SLOTS` and the stroke program to 6;
      the fold pose's merged table and other-face swap carry both pairs
- [ ] Tests: tokens, card and canvas pens, crease visibility, fold pose (a
      fold animating over a crease channel keeps the fold pen's dash), step
      export unchanged
- [ ] Browser: Find tab solid under Default and Diagram; a step card and its
      animation still dashed; earlier creases unchanged; the finished card;
      dark and light themes
- [ ] Validate; commit

### Phase 4 — Plans and docs

- [ ] Mark the older plans' one-pair wording as superseded here
- [ ] `git diff --check`; commit
