# A configurable snap radius, on one law

## Goal

Give the user Oriedita's adjustable snapping radius, and make that number mean
one thing everywhere. Requested on Discord (2026-08-12): *"on oriedita it lets
you change how big the snapping radius is … people can choose how sensitive they
want the snapping to be"*.

The setting is the easy half. The reason it needs a plan is that the app
currently has **five** different answers to "how close is close enough", and a
slider dropped on top of them would move some of the snapping and not the rest.

## What is true today

Let `k = CP_PAPER_RECT.width / ORIEDITA_PAPER_SIZE = 588 / 400 = 1.47` (SVG user
units per model unit) and `z = zoomPercent / 100`.

| # | Law | Where | Value at 100% zoom |
| --- | --- | --- | --- |
| 1 | Canvas snap: `cssTol / (k·z)` with `SNAP_TOLERANCE_CSS = 10` | `CreasePatternWebglCanvas.tsx:1740` | **6.803** model units |
| 2 | Kernel payload: `(8/k) / max(1, z)` | `modelSelectionDistance`, `CreasePatternPanel.tsx:322` | **5.442** model units |
| 3 | Dead default `max(span) · 0.015` | `nearestCpSnapTarget`, `nearestOrieditaDrawPointTarget` | 6.0 — no production caller, tests only |
| 4 | Hardcoded `selection_distance: 1` | `menuActions.ts:464`, the Delete key / Edit ▸ Delete → `DeletePoint` | **1.0** model units, zoom-independent |
| 5 | Kernel fallback `DEFAULT_SELECTION_DISTANCE = 1.0` | `lib.rs:39`, every caller that omits the field: CLI, headless wasm, CP-detect import | **1.0** model units |
| — | **Upstream** | `calculateDecisionWidth()` | `mouseRadius / max(1, zoom)`, default **10** model units |

Facts that are easy to get wrong, and that the first draft of this plan did:

- **Neither live law is document-relative.** `modelSelectionDistance` takes
  `bounds`, but its only two production callers pass `editableCpBounds`, which is
  the constant `ORIEDITA_PAPER_BOUNDS` (`CreasePatternPanel.tsx:973`). The
  document-derived `getEditableCpModelBounds` has no production caller at all.
  So laws 1 and 2 are both fixed-scale, and their ratio is exactly **1.25× for
  `z ≥ 1`**, widening to `1.25/z` below it because law 1 divides at every zoom
  while law 2 (and upstream) divide only above 1.
- **Law 2's `8` is not a stray constant — it is `HIT_TOLERANCE_CSS`.**
  `modelSelectionDistance(paper, 1) = (400/588)·8 = 5.442177` and
  `modelToleranceOf(HIT_TOLERANCE_CSS) = 8/k = 5.442177`, equal to the last
  digit. The kernel is currently being handed our **hit-test** radius, not our
  snap radius. Any plan that moves it to 10 is promoting it, not correcting a
  typo — that is a decision (D4), not a cleanup.
- **In screen terms our snap radius already equals upstream's default.**
  Upstream's camera scale at zoom 1 is exactly 1, so its 400-unit paper draws
  400 px wide and `mouseRadius = 10` is 10 model units *and* 10 screen px. We
  draw the same paper 588 px wide, so our 10 CSS px is also 10 logical px, but
  only 6.8 model units — 1.7% of the paper edge against upstream's 2.5%. The DPR
  factor in `modelToleranceOf` cancels against the DPR baked into `cam.zoom`, so
  this holds on any display.
- **Grid snapping is already unconditional on fine grids.** Once the radius
  exceeds half a cell diagonal (`282.84/N`), every cursor position snaps. That is
  `N ≥ 42` under law 1 and `N ≥ 52` under law 2 — the two laws cross that line at
  different grid sizes, which is its own argument for unifying them.

## Decisions

**D1 — Adopt upstream's law, plus a screen-px floor.** Upstream's
`mouseRadius / max(1, zoom)` is not an arbitrary quirk: it holds the *screen*
radius constant while zoomed in (so the radius never swallows the drawing) and
the *model* radius constant while zoomed out (so it never swallows the geometry).
It is exactly the "screen-constant law plus a model-unit cap" this plan's first
revision asked for, already written. Take it.

The one place to diverge: our editable canvas is `CP_EDITABLE_CANVAS_RECT` =
6000 user units ≈ **10 paper widths**, where upstream's world is the 400-unit
paper. `fitUserCamera` (`padding = 0.7`) therefore opens large documents far
below 100%, where upstream's law decays the on-screen radius toward nothing —
1 px at a 10-paper fit. Add a floor in CSS px below 100% zoom, and document it as
an Ori Studio addition made necessary by a canvas upstream does not have.

**D2 — The unit is model units, so the number means exactly what it means in
Oriedita.** *(Reversed from the first revision, which chose CSS px.)* The reason
is that our 100% is not upstream's 100%: `CreasePatternWebglCanvas.tsx:1600`
defines 100% as "1 user unit == 1 CSS px", so our 400-unit paper draws **588 CSS
px** wide where upstream's draws 400. Matching *pixels* would therefore make our
radius cover less of the drawing than the same number does in Oriedita (1.7% of
the paper edge against 2.5%). Matching *model units* makes 10 mean the same reach
relative to the crease pattern in both apps — which is what "how sensitive is the
snapping" actually means when you are aiming at a vertex.

Two consequences worth stating: at 100% zoom the radius becomes `10 × k = 14.7`
CSS px rather than today's 10, i.e. **more forgiving on the default view**, which
is the direction the request points. And the range and default carry over from
upstream unchanged (D6), because they are now in the same unit.

**D3 — The setting is an application preference.** `oristudioCpViewport` is
persisted per document inside the `.osf` viewState, so a viewport option would
travel with saved files. (Share links are *not* affected — a share payload is a
codec-encoded FOLD frame carrying no viewState.) `storage.ts` + `settingsStore`
is the preference machinery, and already owns the sibling canvas preference
`cpWheelGesture`. **Open question for Zach:** `cpWheelGesture` is surfaced in
`SettingsModal`, and every row in `CpViewControlsPanel` today is document-scoped.
Putting the radius in the view-controls panel is more discoverable but mixes
scopes in one panel; putting it in Settings is consistent but buries it. My lean
is Settings, beside `cpWheelGesture`, with upstream as precedent (its slider is
in the Preferences dialog).

**D4 — One base radius, existing ratios preserved, and the kernel is promoted to
the snap radius.** The 10/8/6 spread is load-bearing: a crease's nearest point is
its perpendicular foot, which sits on top of its own endpoint, so an equal point
radius makes vertices nearly unpickable (`CreasePatternPanel.tsx:1806-1815`).
Express them as ratios of one base `R` (1.0 / 0.8 / 0.6) and note the
consequence: the kernel payload moves from `0.8R` to `1.0R`, a 25% widening of
every kernel-side selection distance. **Caveat that constrains D6:** the
vertex-priority failure is governed by the *absolute* point radius, not the
ratio, so at `R = 2` the point radius is 1.2 model units ≈ 1.8 CSS px at 100%
zoom — below usable pointer precision. That is what the D1 floor has to cover.

**D5 — `CLICK_MOVE_THRESHOLD` does not scale.** It is the click-vs-drag gesture
threshold, not a radius. A proportional threshold at `R = 100` would be 40 CSS
px, so deliberate short drags would arm instead of drawing; the arming rule
compares snapped-to-snapped points (`angle-drag-shared-engine.md`), which makes
that worse, not better.

**D6 — Default 10, range 2–100, integer step — upstream's slider verbatim**, now
that D2 puts us in the same unit. The low end still needs care: at `R = 2` the
0.6 point ratio gives 1.2 model units ≈ 1.8 CSS px at 100% zoom, below usable
pointer precision, so the derived radii need a CSS-px floor (the same mechanism
D1 needs below 100% zoom, which is one floor serving both).

**D7 — `POINT_SNAP_DISTANCE_MULTIPLIER = 1.75` is multiplicative, not
orthogonal.** Both snappers compute `pointSnapDistance = maxDistance × 1.75`, so
the widest live reach in the system is `1.75R`, not `R`. Leaving it alone is
fine; the setting's documentation must not pretend `R` is the maximum.

## Approach

### Phase 0 — Stop feeding a snap radius to things that are not one

- `FlatFoldableCheck` reads `payload.selection_distance` as a boundary-loop
  closure tolerance whose intended default is `Epsilon::UNKNOWN_1EN4` — which is
  `FACTOR(0.01) × 1e-4` = **1e-6**, not 1e-4 (`epsilon.rs:13`). The frontend hands
  it ~5.44 model units because the command declares `toolSteps` and
  `inputMode: 'drag-path'`, so it is roughly **seven** orders of magnitude out.
  Latent rather than user-visible (`placement: 'hidden-ui-only'`), but the radius
  becoming user-movable makes it worse. Give the check its own payload field —
  a two-sided change: the Rust `CreasePatternCommandPayload` **and** its
  hand-written TS mirror in `engine/oristudioCpTypes.ts`.
- Audit the other reuses of the same scalar: Fishbone's per-station vertex
  dissolve, Voronoi's add-vs-delete seed toggle, Foldable Line's drag-length
  gesture gate, and three endpoint-redirect/abort gates. These are
  upstream-faithful (upstream reuses `selectionDistance` the same way across ~226
  call sites), so the outcome may be "documented, not changed" — but we should
  choose, rather than discover, which of them a slider moves.
- Decide laws 4 and 5: the hardcoded `selection_distance: 1` on the Delete-key
  path and the kernel's `DEFAULT_SELECTION_DISTANCE = 1.0`. If the goal is one
  number, these two are in scope; law 4 is pinned by an existing test, so
  changing it is a deliberate behaviour change with a test to update.

### Phase 1 — One law, no setting yet

A single module owns the radius; everything derives from it:

```ts
// apps/web/src/cp-workspace/snapRadius.ts
export function cpSnapRadiusModel(radiusModelUnits: number, zoom: number): number  // R / max(1, z), floored
export const SNAP_RATIO = 1.0, LINE_HIT_RATIO = 0.8, POINT_HIT_RATIO = 0.6
```

`k` is a compile-time constant, not a parameter — `cpModelToSvg` is a fixed
affine over `ORIEDITA_PAPER_BOUNDS`, documented as the only one.

**The zoom input is the subtle part.** Calling one function from both sites does
*not* make them agree: the canvas has the exact `cam.zoom`, while the panel only
has `zoomPercent`, a rounded integer (`CreasePatternWebglCanvas.tsx:1602`). One
side must own the number and publish it. The plumbing already exists in the
opposite direction (`cpToolSelectionDistance` flows panel → canvas), so invert
it: the canvas computes the radius from its live camera and the panel uses that
value when building payloads.

Also delete what this orphans: `modelSelectionDistance`, the dead
`getEditableCpModelBounds`, and the unused `bounds` parameter and `max(span) ·
0.015` default on the two `nearest*` functions.

This phase is behaviour-changing on its own (the kernel radius moves 0.8R → 1.0R
and law 3/4/5 get resolved), which is why it lands before the setting — one
variable at a time.

### Phase 2 — The setting

- `storage.ts` gains a `readNumber` (it has only string/boolean/JSON today), with
  the clamp applied on read so a hand-edited key degrades to the default the way
  `readCpWheelGesture` does.
- `settingsStore` scalar + `clampCpSnapRadius`, defaulting to 10.
- A `NumberField` row wherever D3 lands, with an inline `t()` string,
  `i18n:extract` + 8 locales + `i18n:stamp` + `i18n:check`.
- A hand-placed `track()` in the store setter — no chokepoint sees a preference
  change, and no viewport option is instrumented today. Bucket with the repo's
  `bucketCount(value, thresholds)` helper, whose labels are `<=t` / `>last`; do
  not invent range strings. Add the row to `docs/analytics.md`'s tracked-events
  table.

### Phase 3 — Not in scope

Unifying the *candidate sets* (kernel: crease endpoints + circle centres + grid;
frontend: also standalone points, paper corners, line interiors) is the larger
follow-up. This plan unifies the radius only.

## Risks and edge cases

- **Nothing in CI covers any of these laws.** The canvas constants have no test
  file; every Rust test hardcodes its own `selection_distance`; every oracle test
  passes explicit values into both the Rust and Java sides. The parity suite is
  structurally incapable of catching a regression here, so green CI will not
  validate this work — the new tests are the validation.
- **The Measure tool reports a snap *kind*** (`vertex` / `grid` / `point` /
  `crease` / `free`) decided by the same radius, so moving `R` changes what
  Measure tells the user an endpoint *is*, not merely where it lands.
- **Small `R`**: `DrawCreaseRestricted` refuses to start when nothing snaps, so a
  small radius makes it fiddly, and the D4 caveat (1.2 px point radius at `R=2`)
  makes vertices hard to grab in the dual-mode tools.
- **Large `R`**: grid snapping goes unconditional (see the 42/52 thresholds), and
  crease *picking* widens too, because `SNAP_TOLERANCE_CSS` is deliberately
  reused as a hit radius in five places to stop the dual-mode classifier and the
  crease pick from disagreeing (`CreasePatternWebglCanvas.tsx:2105, 2131, 2296,
  2320, 2385`). That coupling is intentional; do not hold "hit" fixed while
  moving "snap" or the dead zone those comments document comes back.
- **Zoomed-out extremes** are what upstream's `max(1, z)` bounds, and it bounds
  them completely: the model radius never exceeds `R`. (For scale, the law it
  replaces — screen-constant at every zoom — reaches ~680 model units at
  `MIN_ZOOM` on a 1× display and ~1361 at 2×, and `cameraZoomForPercent` is
  deliberately unclamped, so a typed percentage can go below `MIN_ZOOM`.) The
  live risk therefore inverts: it is the *floor* from D1, not the cap, that needs
  browser judgement.
  The kernel's grid origin-fallback is *not* the live hazard the first draft
  claimed: reaching it needs a pointer more than one cell diagonal outside the
  paper, with vertex candidates off (otherwise the nearest paper corner wins),
  and the result must still land within 1e-5° of the drag ray. A cap makes the
  question moot; it should not be sold as fixing a present-tense bug.
- **Touch** flows through the identical path with no coarse-pointer allowance, so
  the setting is currently the only way to make touch drawing comfortable —
  worth remembering when choosing the maximum.
- **Phase 0 touches the kernel**, so any browser verification of it must follow a
  `build:oristudio-cp-wasm`; the generated bridge is untracked and a body-only
  kernel edit leaves the `.js`/`.d.ts` glue unchanged, so lint, typecheck and
  vitest all pass over a stale `.wasm`.

## Affected Areas

- `apps/web/src/cp-workspace/snapRadius.ts` (new) + tests
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — `modelToleranceOf`,
  the three radius constants become ratios, and it publishes the payload radius
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — delete
  `modelSelectionDistance`, consume the canvas's value
- `apps/web/src/lib/creasePatternViewport.ts` — drop the dead `bounds` parameter
  and `max(span)·0.015` default; `getEditableCpModelBounds` goes
- `apps/web/src/commands/menuActions.ts` — the hardcoded `selection_distance: 1`
- `apps/web/src/lib/storage.ts` (`readNumber`), `store/settingsStore.ts`
- `SettingsModal.tsx` or `CpViewControlsPanel.tsx` per D3, + i18n catalogs
- `apps/web/src/analytics/` + `docs/analytics.md`
- `crates/oristudio-cp/src/lib.rs` — Phase 0's `FlatFoldableCheck` field, and a
  decision on `DEFAULT_SELECTION_DISTANCE`
- `apps/web/src/engine/oristudioCpTypes.ts` — the TS mirror of any new field
- `PORTING.md` — the radius law and the unit divergence from upstream
- Cross-references to refresh: `angle-restricted-endpoint-snap.md` and the other
  plans citing the constants this renames

## Checklist

- [ ] Phase 0: `FlatFoldableCheck` gets its own tolerance field (Rust + TS
      mirror); the five other non-radius reuses audited and documented; laws 4
      and 5 decided
- [ ] `snapRadius.ts` with upstream's law, the CSS-px floor and the ratios; unit
      tests across zoom and DPR (not document size — both laws are fixed-scale),
      including a case pinning `R = 10` at 100% zoom to 10 model units so the
      Oriedita-parity claim is enforced rather than asserted
- [ ] One owner for the live zoom: the canvas publishes the radius, the panel
      consumes it; a test asserting the two agree at fractional zooms
- [ ] Dead code removed (`modelSelectionDistance`, `getEditableCpModelBounds`,
      the `bounds` parameter and its default)
- [ ] Regression tests CI would actually fail on — no on-screen element displays
      the radius (`SNAP_INDICATOR_RADIUS = 5` is a fixed marker at the *snapped*
      point), so assert on the resolved snap targets and the payload value, not
      on a ring
- [x] `readNumber` + `settingsStore` + clamp + tests
- [x] Control row per D3, i18n extract/translate/stamp/check
- [x] `bucketCount`-formatted analytics event + `docs/analytics.md` row
- [ ] `PORTING.md`; refresh the plans that cite the renamed constants
- [ ] Rebuild the CP wasm before any browser pass that exercises Phase 0
- [ ] Browser matrix: `R = 2 / 10 / 100` × (fit zoom on a multi-paper document,
      100%, 400%) × (grid snap on/off), checking drag-draw still drags, restricted
      draw still draws, vertices stay pickable beside a crease, and Measure still
      reports the kind you expect. The fit-zoom column is the one that judges the
      floor.
