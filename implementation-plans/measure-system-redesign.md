# Measure Tool Redesign (V1)

## Goal

Replace the ported Oriedita measure UI — five separate rail tools writing into
five anonymous registers in a corner panel — with **one measure tool** that
answers on the canvas, in a unit a person can read, and leaves nothing behind
when you leave it.

Deliverable: a single `Measure` tool on `Shift+M`, live on-canvas dimension
lines and angle arcs with the value at the cursor, a unit system, and
measurements that accumulate while the tool is active and are **discarded when
the tool is escaped**.

## Scope decisions (settled)

- **Tool, not modeless.** No hover-inspect, no selection-derived readout. A
  designer interacts with a line to measure it a small fraction of the time;
  ambient readouts would be noise for the other 99%. Measuring is a deliberate
  act, so it gets a deliberate mode.
- **No persistence.** Measurements live for the duration of the tool session.
  Escape clears them. No measurement objects, no deletion UX, no re-anchoring
  when geometry moves, no `.osf` changes. This removes the largest and riskiest
  chunk of the original plan.
- **`Shift+M`.** Mirror Line keeps bare `M` (see below).

Note the *only* thing "no persistence" rules out is surviving tool exit —
measurements still accumulate **within** a session, so comparing three distances
side by side works without any deletion UX. Escape is the eraser.

## Current state (verified, not assumed)

**The kernel side is thin and correct, and non-mutating.**
`operations::measure` is two functions — `length_between_points` and
`angle_between_three_points`
([measure.rs:6,11](../crates/oristudio-cp/src/operations/measure.rs)) — reached
only through the *preview* arm, which sets `preview.measurement` and pushes guide
segments; there is no execute arm by design
([lib.rs:3224-3252](../crates/oristudio-cp/src/lib.rs)). Oriedita never persists
measures either (they live in `MeasuresModel`, a databinding object, not in any
file writer), so **there is no file-format or parity risk in this work.**

**The frontend is a five-slot mapping.**
[`cp-workspace/measure.ts`](../apps/web/src/cp-workspace/measure.ts) maps five
operation ids to five slots labelled `L1 L2 A1 A2 A3`, formatted at fixed
3dp/2dp. `CreasePatternPanel` holds them in one `useState` (:963), fills a slot
on commit (:2389, :2684), clears them when the document handle changes (:3289).
`CpContextToolPanel` renders a 5-column grid of label/value cells (:535-554).

### What's actually clunky

1. **Five tools for one job.** `Measure length 1/2` and `Measure angle 1/2/3` are
   five `left-rail` commands
   ([oristudioCpCommands.ts:458-472](../apps/web/src/lib/oristudioCpCommands.ts);
   `placement` defaults to `left-rail` at :139). You must choose a *storage
   register* before you can measure anything — Oriedita's `MeasuresModel` field
   list leaking into the tool rail.
2. **We pay for the registers and get none of their benefit.** Upstream, the five
   slots exist for symbolic reuse: `string2double` substitutes `"L1"`, `"A2"`, …
   into any numeric field
   ([MeasuresModel.java:96-115](../third_party/oriedita/oriedita-data/src/main/java/oriedita/editor/databinding/MeasuresModel.java)),
   and each field click copies to clipboard
   ([ReferencesTab.java:95-99](../third_party/oriedita/oriedita-ui/src/main/java/oriedita/editor/swing/tab/ReferencesTab.java)).
   Neither is ported. The complexity is here; the payoff is not.
3. **The answer lands away from the question** — a 0.62rem cell in the context
   panel (theme.css:4313-4352) while your eyes are on two points on the canvas.
   Nothing is drawn near the measured geometry.
4. **The result is anonymous.** On commit the tool resets and the dashed guide
   disappears; the number survives with no record of what produced it, and
   measuring again overwrites the slot silently.
5. **No frame of reference.** Raw 400-space model units, so the square's diagonal
   reads `565.685` — see the units section below.
6. **Two clicks for a crease.** Measuring an existing crease means clicking both
   its endpoints; the tool can't take the crease itself
   ([inputModelRegistry.ts:78-79](../apps/web/src/cp-workspace/tools/inputModelRegistry.ts)
   is a 2-point sequence).
7. **Angles are 3-point only**, with two straight rays and no arc
   ([lib.rs:3236-3252](../crates/oristudio-cp/src/lib.rs)).

## What Oriedita actually displays (answering the units question)

Verified upstream:

- Points live in Oriedita's internal paper frame **(-200,-200)–(200,200)**, i.e.
  paper edge = `400`
  ([CreasePattern_Worker_Impl.java:627](../third_party/oriedita/oriedita/src/main/java/oriedita/editor/canvas/impl/CreasePattern_Worker_Impl.java)),
  which is where our `ORIEDITA_PAPER_SIZE = 400.0` comes from.
- `setLength(measuresModel, p1.distance(p2))` stores the **raw** distance in that
  space — no division by grid width, no normalization.
- The text field is bound through a `DoubleConverter` constructed with **no
  format**, so it renders `Double.toString(value)` — full precision. The square's
  diagonal shows as `565.685424949238`.

So Oriedita shows raw internal units at full double precision. Two consequences:

- We are already at **value** parity; only presentation differs (we truncate to
  3dp). Changing the displayed unit is a display change, not a parity break.
- Our help text — "Length is measured in grid units… relative to crease pattern
  size with grid size of 1"
  ([oristudioCpToolInstructions.ts:243-256](../apps/web/src/lib/oristudioCpToolInstructions.ts))
  — is **ours, not upstream's**: the upstream English help for `l1Action` reads
  only "Display the length between two points." Our sentence describes neither
  what is computed nor what is shown, and should be fixed regardless.

**Recommendation: default to paper fraction (edge = 1)**, so the diagonal reads
`1.4142` — scale-free, and how origami instructions actually talk. Offer grid
squares, physical mm/cm/in (against a user-set paper edge), and **Model units
(Oriedita)** in the switcher for parity checks. One line changes the default if
you'd rather ship raw units.

## How `Shift+M` slots into the shortcut system

Read in full: `shortcuts.ts`, `shortcutDispatcher.ts`, `shortcutRuntime.ts`.

**The conflict.** Bare `M` is Mirror Line (`symmetricDrawAction: 'M'`,
shortcuts.ts:99) and `Ctrl/Cmd+M` is Reflect (`reflectAction`). Mirror Line keeps
`M`; **Measure takes `Shift+M`**, which keeps the whole mirror family on one key
and adds the measure tool beside it.

**The mechanism**, end to end:

1. Chords for CP tools come from `ORIEDITA_DEFAULTS`, keyed by *upstream action
   name* (shortcuts.ts:70-132) and resolved by `defaultChordForCpAction` (:249).
2. That name reaches the registry through the per-operation override map in
   `oristudioCpActions.ts` — e.g. `DisplayLengthBetweenPoints1` carries
   `upstreamAction: 'l1Action'` (:441). The consolidated Measure tool inherits
   `l1Action` as its upstream identity, so menu/keybind parity is preserved and
   the chord is one table entry: **`l1Action: 'shift M'`**.
3. `parseOrieditaKeyStroke` already handles the `shift` token (:419), so
   `'shift M'` parses to `{key: 'm', shift: true}`.
4. `keyChordFromKeyboardEvent` records `shift: event.shiftKey` unconditionally
   (:441), so `Shift+M` and bare `M` are **distinct chords** — Mirror Line is not
   shadowed, and no dispatcher change is needed.
5. `classifyReservedKey` allows it (the test even asserts bare `m` is `allowed`,
   shortcuts.test.ts:91), and `isShortcutEditingTarget` already suppresses
   shortcuts while typing (shortcutDispatcher.ts:40).

**Three things to watch:**

- **This is the first bare `Shift`+letter chord in the app.** Every existing
  shift chord also carries `primary` (`Cmd+Shift+S`, `Cmd+Shift+M`). Nothing in
  the matcher cares, but the keybinding-settings UI and `formatKeyChord` output
  (`Shift+M`) want an eyeball, and conflict detection should be checked against a
  user rebinding onto plain `M`.
- **Duplicate chords fail silently.** `buildCpShortcutDefinitions` drops the
  later duplicate in `ORISTUDIO_CP_ACTIONS` order (:229-247) rather than erroring
  — which is exactly how a naive `M` assignment would have killed Mirror Line
  without a test failure. `getShortcutRegistryDiagnostics().duplicateDefaultChords`
  is the guard; assert on it.
- **Upstream ships no hotkey for `l1Action`** (`hotkey.properties:122` is empty),
  so `Shift+M` is an Ori Studio addition — mark it in the table comment the way
  `drawCreaseRestrictedAction: 'SPACE'` is.

**Escape already has a ladder** (CreasePatternPanel.tsx:3212-3240): pan tool →
clear selection → cancel/deactivate tool. Session measurements are discarded at
the *tool deactivation* rung, so the existing Escape semantics carry the V1
lifetime rule with no new key.

## The tool

One rail entry in the Measure group, `Shift+M`. The measurement *kind* is
inferred from what you pick, with a segmented control in the context panel to
force one:

| Pick | Measurement |
| --- | --- |
| 2 points | distance |
| 1 crease | that crease's length (one click, not two) |
| 3 points | angle at the middle point |
| 2 creases | angle between them, at their intersection |

Behavior:

- **Live before commit.** The value updates continuously at the cursor as you
  move, rendered next to the dimension line. The kernel already computes on
  preview, so this is display work, not new math.
- **Snap identity is visible.** A chip names what each end locked onto (vertex /
  intersection / grid / midpoint / free), so a measurement is never silently
  off by a pixel.
- **Measurements accumulate** during the session and stay drawn, so you can
  compare several. `Backspace` drops the last one; `Escape` exits the tool and
  clears them all.
- **Click-to-copy** on any value (upstream parity), full precision on copy.

**Values still come from the kernel.** Crease picks are resolved to their
endpoints frontend-side — exactly how point-sequence tools already work — and
those points go through the existing `previewOristudioCpCommand` path, so every
number remains upstream's. Crease-to-crease angle resolves to (intersection,
point on A, point on B) and reuses `angle_between_three_points`. **V1 therefore
needs no kernel or WASM changes**, which also means no `.wasm` rebuild — worth
protecting, since the committed bridges under `apps/web/src/generated/**` are
tracked and a kernel change doesn't reach the app or CI until they're rebuilt.

### Visual language

- Dimension line: thin, extension lines with a small gap, arrowheads, value in a
  chip on the theme surface — quiet by default, accent while live.
- Angle: low-opacity arc wedge plus the two rays, radius adapting to zoom.
- Labels ride the **DOM overlay** (as text annotations do — `CpTextAnnotationLayer`,
  `useCanvasObjectAnchor`): the renderer has no glyph atlas and label counts are
  tiny. Dimension lines and arcs go through the existing stroke/wedge programs.

### Units and formatting

Document-level unit setting, persisted through `lib/storage.ts` per the existing
storage convention, applied to every measure readout:

- **Paper fraction** (default, edge = 1)
- **Grid squares** — divides by `grid_width`, which already exists kernel-side as
  `ORIEDITA_PAPER_SIZE / grid_size` ([lib.rs:3452-3461](../crates/oristudio-cp/src/lib.rs))
- **Physical** — mm / cm / in against a user-set paper edge
- **Model units (Oriedita)** — raw 400-space, for parity checks

Angles in degrees (radians optional), recognizing exact origami angles within
epsilon (22.5°, 30°, 45°, 60°, 67.5°, 90°) and showing the exact form alongside.
Lengths get adaptive precision with full precision on copy, and recognize common
radicals the way the ratio field already parses `a + b√c`
([oristudioCpToolSettings.ts:226-241](../apps/web/src/lib/oristudioCpToolSettings.ts)).

## What V1 gives up, honestly

Dropping the five-slot grid removes the ability to hold two lengths and three
angles at once *across* tool exits. Within a session you can still keep several
measurements on screen, and since `string2double` was never ported the slots
were only ever a display — so the practical loss is small, but it is not zero.
Registers return in a later phase (below), where they belong: as an outcome of
measuring, not the entry point.

## Affected areas

- `apps/web/src/cp-workspace/measure.ts` — from a slot map to the session
  measurement model (kinds, values, unit conversion, formatting)
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` + `renderer/` —
  dimension-line and arc geometry
- New `apps/web/src/cp-workspace/CpMeasureLayer.tsx` — DOM label layer
- `apps/web/src/components/panels/CpContextToolPanel.tsx` — replace the 5-cell
  grid with the live readout, kind control, and unit control
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — session measurement
  state, crease-pick resolution, Escape-clears wiring
- `apps/web/src/lib/oristudioCpCommands.ts` — one `Measure` command; demote the
  five legacy ids to `menu` / `hidden-ui-only`
- `apps/web/src/cp-workspace/tools/inputModelRegistry.ts` — the new tool's input
  model (point sequence + crease pick)
- `apps/web/src/keyboard/shortcuts.ts` — `l1Action: 'shift M'`
- `apps/web/src/lib/oristudioCpToolInstructions.ts` — fix the wrong grid-units text
- i18n: inline English + `i18n:extract` + 8 locales + `i18n:check`, per
  `apps/web/CLAUDE.md`

Unchanged: `crates/**`, the WASM bridges, and every file format.

## Checklist

### Phase 1 — One tool, one shortcut
- [ ] Single `Measure` command in the Measure group; five legacy ids demoted to
      `menu` / `hidden-ui-only` (kept in kernel + registry for parity)
- [ ] Input model: 2-point / 3-point sequence plus single-crease pick
- [ ] Kind inference from picks + segmented override in the context panel
- [ ] `l1Action: 'shift M'` in `ORIEDITA_DEFAULTS`, marked an Ori Studio addition
- [ ] Test: `getShortcutRegistryDiagnostics().duplicateDefaultChords` stays empty,
      and Mirror Line still resolves to bare `M`
- [ ] Check the keybinding-settings UI renders and rebinds a bare `Shift`+letter
- [ ] Replace the 5-cell grid with a single live readout

### Phase 2 — Units and formatting
- [ ] Unit model + conversions in `measure.ts`, with tests
- [ ] Unit preference in the store, persisted via `lib/storage.ts`
- [ ] Unit control in the measure context panel
- [ ] Exact-angle and radical recognition with epsilon, with tests
- [ ] Click-to-copy, full precision on copy
- [ ] Fix the `l1Action` / `l2Action` help text to describe reality

### Phase 3 — On-canvas measurement
- [ ] Dimension-line geometry (extension lines, arrowheads)
- [ ] Angle arc wedge, zoom-adaptive radius
- [ ] DOM label layer, value live at the cursor before commit
- [ ] Snap-identity chip

### Phase 4 — Session measurements
- [ ] Measurements accumulate while the tool is active
- [ ] `Backspace` drops the last, `Escape` exits and clears all (via the existing
      Escape ladder's tool-deactivation rung)
- [ ] Session list in the context panel, hover-to-highlight

### Deferred (not V1)
- Registers + `string2double` substitution in numeric fields
- Persistent measurement objects (needs anchoring + deletion UX + `.osf`)
- Area / perimeter; folded-view measuring
- Hold-a-modifier transient measure during another tool (explicit, not ambient)

### Validation
- [ ] `cd apps/web && npx tsc --noEmit`, `npm run lint:web`, `npm run test:web`
- [ ] `npm run i18n:extract` + translations + `npm run i18n:check`
- [ ] No Rust or WASM changes expected — if that stops being true, rebuild and
      commit the tracked bridges
- [ ] Browser pass: measure under zoom, under view rotation, in dark mode; verify
      `M` still mirrors, `Shift+M` measures, `Cmd+Shift+M` still checks CAMV, and
      Escape clears measurements without disturbing the selection rung
