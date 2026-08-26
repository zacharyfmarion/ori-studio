# Export fold-angle display

## Goal

Draw non-180° creases into an exported picture the way the editor draws them,
and let the person exporting choose which encoding — the same **Color** /
**Opacity** pair the View panel already offers.

The control is a dropdown directly below "Line style" in the Export Image dialog
(SVG and PNG), with a counterpart in the Share crease pattern modal. It appears
**only when the exported pattern actually contains non-classic creases**, so a
flat pattern's export is unchanged and gains no decision.

This closes the gap named at the end of `fold-angle-display-mode.md`:

> **SVG and PNG export carry no fold angle at all.** `creaseExport.ts` builds its
> own SVG from FOLD edge assignments (`edgeAppearance` takes `M`/`V`/`B`/`F`/`U`),
> so neither the existing hue ramp nor this opacity mode reaches an exported
> picture — a 3D design exports as a picture that hides the very thing it is
> about.

A pattern whose whole point is that four creases fold to ±90° currently exports
as plain red and blue lines, indistinguishable from the same pattern folded
flat.

## Approach

### 1. Reuse `foldAngleInk`; do not restate the encoding

`cp-workspace/foldAngle/foldAngleRamp.ts` already owns both modes, behind one
dispatcher:

```ts
foldAngleInk(ink: Rgba, magnitudeUnits: number | undefined, { display, anchor }): Rgba
```

It is pinned by tests that each function stays in its own channel (`ramp` never
touches alpha, `opacity` never touches RGB), that no mode is a no-op, that a
classic crease returns `ink` **by identity**, and that an unrecognised `display`
falls back to the declared default. Re-deriving any of that in hex-and-SVG terms
would create a second encoding that drifts from the canvas's — which is the one
thing this feature exists to prevent.

So `creaseExport.ts` imports it. That is a `lib/ → cp-workspace/` import, which
the panel-decomposition rule discourages; it is the right call anyway, and there
is runtime precedent in `lib/nativeProjectFile.ts` (`validateCpImages`,
`validateInlineSimulations`, `validateUserCamera`). `lib/oristudioCpLineStyle.ts`
is the shape this *would* take if it were moved, and moving a module with two
test files and six call sites to satisfy a directional rule buys nothing here:
`foldAngleRamp` is typed in `Rgba`, which lives in `cp-workspace/renderer/types`,
so the dependency inverts rather than disappears.

`parseCssColor` (`cp-workspace/renderer/cssColor.ts`) comes along for the hex →
`Rgba` conversion, for the same reason.

### 2. The magnitude arrives in degrees, not kernel units

This is the one genuine impedance mismatch. The canvas reads `fold_magnitude`
off each `OristudioCpLineSegment` — kernel units, `undefined` for classic. The
export has only a `FoldDocument`, where the same fact lives in
`edges_foldAngle` as a **signed angle in degrees**.

It does survive the trip: `buildSegmentFold` preserves `edges_foldAngle`
(`creasePatternSegmentation.ts:451`), and the `.osf` `foldProjection` for the
attached `simple_example.osf` carries `[0, 0, 0, 0, -90, -90, 90, -90]`.

Convert at the boundary, with three rules:

- **Only `M` and `V` are creases.** `defaultFoldAngle` gives `B` and `U` `null`
  and `F` a literal `0`, and the kernel writes `0` for borders. Feeding a border
  to the ramp because "it is at 0°" would fade the sheet outline to α 0.2 — the
  obvious bug in this change, and the first thing to test.
- **Absent or `null` is classic**, matching `foldAngleFromParts`, which reads
  `magnitudeUnits === undefined` as a full ±180 fold.
- **|180| needs an epsilon.** `creaseExportFold.ts:64-75` documents that a
  classic crease reaches FOLD as `179.9999999`, because the angle has been
  through the kernel's own unit conversion. `degreesToFoldMagnitude` on that
  lands one tick under `FOLD_MAGNITUDE_FULL`, `nonClassicFoldFraction` returns
  `0.9999…` instead of `null`, and **every crease in the document steps to
  α 0.8** — a whole-pattern regression from a rounding artifact. Reuse
  `FLAT_ANGLE_EPSILON` / lift `isFlatAngle`'s 180 arm into a shared
  `isClassicFoldAngle(degrees)` rather than writing a second epsilon that can
  drift from the first.

So: `|deg|` → classic check → `degreesToFoldMagnitude` → `foldAngleInk`.

### 3. Alpha becomes `stroke-opacity`, not a baked colour

`edgeAppearance` currently returns `{ stroke, dash }`. It gains
`strokeOpacity`, and splits by what the mode touched:

| mode | `foldAngleInk` changes | export emits |
| --- | --- | --- |
| `color` | RGB, alpha stays 1 | a different `stroke` hex |
| `opacity` | alpha only, RGB untouched | `stroke-opacity="…"` |

**Do not pre-multiply the alpha into the stroke colour.** It is the same trap
the canvas plan rejected, for the same reason: creases draw over the facet
backgrounds and (since PR #305) over the grid, so a colour blended against the
page paints the wrong colour wherever anything sits behind it.
`stroke-opacity` is a real composite. It is plain SVG 1.1 and rasterizes
unchanged through the `<img>` → canvas path in `svgToPng` / `svgToPngCard`, so
PNG and SVG cannot disagree.

Parse the palette's mountain, valley and anchor into `Rgba` **once per artwork
build**, not once per edge — `buildCreaseExportArtwork` already re-runs on every
slider drag in the dialog's preview.

### 4. The palette gains one colour

`CreaseExportPalette.foldAngleAnchor`, `#d946ef` in **both** light and dark.

Not an oversight: `--fold-angle-anchor` is defined exactly once, at `:root` in
`theme.css:108`, with no per-theme override anywhere in the app. The export's
light palette is already documented as matching the live view's `--fold-*`
tokens, so a single shared anchor is the faithful transcription rather than a
shortcut. If a dark export's magenta later reads wrong, that is a second value
in one table.

Note what this does and does not promise. The export runs the *same encoding*
over the *export's own* palette — `#ff4d5d` / `#60a5fa`, not the canvas's
`--fold-mountain` / `--fold-valley` — so a 90° mountain will not be pixel-equal
to the canvas. Same construction, same anchor, different starting ink. Claiming
pixel parity would be wrong and the tests should not assert it.

### 5. The gate is "has non-classic creases", not "is not flat"

Both modals already compute `isFlatFoldableFold(fold, segment)` for the
folded-figure toggle, and it is tempting to reuse. It is wrong by exactly one
case: `isFlatAngle` counts **0° as flat**, but a 0° mountain is a *non-classic*
crease that the editor draws at the ramp's anchor or at the opacity floor. A
document made entirely of 0° creases would hide the dropdown and then still
render them differently — a dead control's opposite, an encoding with no way to
choose it.

Add `hasNonClassicCreases(fold, segment)` beside `isFlatFoldableFold` in
`creaseExportFold.ts`, scoped through the same `buildSegmentFold` call so the
two predicates cannot disagree about which creases belong to the pattern, and
applying the same M/V-only rule as §2.

When the dropdown is hidden the option still rides in `CreaseExportOptions`.
With no non-classic creases it changes nothing — every edge takes the identity
path — so there is no hidden state to reconcile and no reason to special-case
the render.

### 6. Seed from the editor, in both modals

`defaultCreaseExportOptions(viewport)` (`projectSlice.ts:627`) already carries
`lineStyle` and `lineWidth` across from the View panel. `foldAngleDisplay` joins
that list, so an export opens showing what the editor was showing — which is
what "renders in the same way that the editor renders those lines" should mean
on first open, not just as an available option.

The Share modal reads `oristudioCpViewport.foldAngleDisplay` from the store as
its initial state. A `useState` initial value is correct here: the modal is a
snapshot of one moment, and the document cannot change while it is open.

### 7. Share modal placement, and why it earns a control at all

There is no line-style dropdown in `ShareLinkModal` to put it below. It goes in
the controls column after the divider, above "Show grid lines", gated the same
way.

The modal's own doc comment sets a bar it has to clear:

> The controls are deliberately a fraction of the export dialog's. A social card
> is a preview, not a deliverable; line style, width, point size, theme and
> background do not earn a decision here.

This clears it on a different footing than line style does. Line style is a
choice between two pictures that are equally true. Without a fold-angle
encoding the card shows a pattern that **is not the pattern** — the same
argument that made the encoding unconditional on the canvas. And because the
control only appears when the document has non-classic creases, it adds nothing
to the flat-pattern share that the quoted paragraph is about.

### 8. A stale-cache defect this will expose

`computeCreaseFingerprint` (`cp-workspace/cpSegmentationArtifacts.ts:22-37`)
hashes each segment's four endpoint coordinates and its colour. It does **not**
hash `fold_magnitude`. Magnitude and colour are orthogonal by construction
(`lib/foldAngle.ts`), so changing a crease from 180° to 90° changes neither
input: the fingerprint is unchanged, the cached `FoldArtifacts` are returned,
and the fold that gets drawn carries the **old** angles.

That reaches two entry points, both segment-scoped:

- `exportOristudioCpSegment` — per-region image export.
- `shareOristudioCpSegment` — which is the *only* way the share modal opens, so
  every share card is affected.

It is invisible today because nothing downstream reads the angle. It becomes a
visible wrong picture the moment this ships. The fix is one line — mix the
magnitude into the hash — and it belongs in this change rather than as a
follow-up, because this change is what makes it observable.

`resolveCreaseExport` (the main Export Image path) instead goes through
`ensureFoldArtifacts`, which keys on `foldArtifactRevision`
(`creasePatternSlice.ts:1073`). A magnitude-only edit *should* advance that
through history. **Verify it rather than assuming** — write the test either way,
since a second stale path would fail the same way and be attributed to the
renderer.

### 9. Two interactions to document, not to fix

- **Monochrome line styles.** In `black-white` / `black-one-dot` /
  `black-two-dot`, `color` mode shifts non-180 creases toward magenta,
  contradicting a black-and-white export. This is the same interaction the
  canvas has, and `fold-angle-display-mode.md` already decided the answer:
  leave it to the explicit choice, because invisible coupling between two
  dropdowns is worse than the defect. The export inherits both the behaviour and
  the decision — the difference being that here the user picking `black-white`
  now has `opacity` sitting one row below it.
- **Double-composite at shared vertices.** Crease lines are drawn with
  `stroke-linecap="round"`, so caps overlap at every shared endpoint. Below
  α 1 each vertex may composite twice and read as a darker dot — risk R4 from
  the canvas plan, which was accepted there because WebGL had no cheap fix. SVG
  does: `opacity` on a `<g>` isolates, rendering children into a temporary
  surface at full alpha and compositing once. Creases bucketed by exact alpha
  would each become one such group. Do **not** build that up front — emit
  per-line `stroke-opacity`, look at a real pattern, and only reach for buckets
  if it reads as dirt.

## Affected Areas

**Web only.** No kernel, no wasm, no `.osf` schema change, no new `.osf` field —
`foldAngleDisplay` already rides `viewState.viewport`.

- `apps/web/src/lib/creaseExport.ts` — `foldAngleDisplay` on
  `CreaseExportOptions` + its default; `foldAngleAnchor` on
  `CreaseExportPalette` (both themes); `edgeAppearance` returns
  `strokeOpacity`; the degrees → units boundary; parsed-palette memo.
- `apps/web/src/lib/creaseExportFold.ts` — `hasNonClassicCreases`, and
  `isClassicFoldAngle` lifted out of `isFlatAngle` so one epsilon serves both.
- `apps/web/src/components/CreaseExportDialog.tsx` — the `Select` row directly
  below Line style, gated on the predicate scoped to the selected pattern.
- `apps/web/src/cp-workspace/share/ShareLinkModal.tsx` — same control above the
  grid toggle; initial value from the viewport.
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts` —
  `defaultCreaseExportOptions` carries the mode across.
- `apps/web/src/cp-workspace/cpSegmentationArtifacts.ts` — mix `fold_magnitude`
  into the crease fingerprint (§8).
- `apps/web/public/locales/*` — one dialog row label per modal, 9 locales. The
  option labels already exist: `cpFoldAngleDisplayLabel` in `i18n/enumLabels.ts`
  is translated in every locale for the View panel, and is reused verbatim.

**Explicitly not touched**

- `foldAngleRamp.ts` — the encoding is complete and pinned; this change is a
  second caller, not an edit.
- `strokeProgram.ts`, `CreasePatternWebglCanvas.tsx` — the canvas is unchanged.
- `foldAngleBadges.ts` — see Open decisions.
- `supersetFeatures.ts` — its note that `.svg`/`.png` "are pictures — nobody
  re-imports them as a crease pattern, so there is no data to lose" stays true.
  This change is about what the picture *shows*, not about round-tripping.

**No analytics event.** The export format is already captured at the
`handleMenuAction` chokepoint, and the directly comparable "Show grid lines"
work (PR #305) added none. A second hand-placed event for the same action is
what `AGENTS.md` tells us not to do.

## Checklist

### Encoding
- [x] `foldAngleDisplay` on `CreaseExportOptions`, default `'color'`
- [x] `foldAngleAnchor` on both palettes (`#d946ef`), with the note on why it
      does not vary by theme
- [x] `edgeAppearance` returns `strokeOpacity`; `stroke-opacity` emitted only
      when it is not 1, so a flat pattern's SVG is byte-identical to today's
- [x] Degrees → units boundary: M/V only, absent = classic, 180 within
      `FLAT_ANGLE_EPSILON` = classic
- [x] Test: a `B` border and an `F` flat crease at angle 0 are **untouched** in
      both modes — the bug this change is most likely to ship
- [x] Test: 179.9999999 renders as a classic crease, not at α 0.8
- [x] Test: `color` changes the stroke hex and emits no `stroke-opacity`;
      `opacity` keeps the hex and emits `stroke-opacity` — the export-side mirror
      of the per-channel pins
- [x] Test: the two modes differ from each other on the same 90° crease
- [x] Palette colours parsed once per artwork, not per edge

### Gating
- [x] `hasNonClassicCreases(fold, segment)` beside `isFlatFoldableFold`, sharing
      `buildSegmentFold` scoping
- [x] Test: a 0° mountain counts as non-classic even though
      `isFlatFoldableFold` calls it flat — the case that makes this a separate
      predicate
- [x] Test: scoped per segment, so a non-flat pattern elsewhere in the document
      does not surface the control for a pattern that is entirely classic

### UI
- [x] Export dialog `Select` directly below Line style, hidden when the scoped
      pattern has no non-classic creases
- [x] Share modal control above the grid toggle, same gate
- [x] Both seeded from `oristudioCpViewport.foldAngleDisplay`
- [x] `CommandDialogModal.test.tsx`: the row appears / does not appear, and
      changing it changes the previewed SVG
- [x] `shareCardFoldAngle.test.tsx`, mirroring `shareCardGrid.test.tsx`

### Cache correctness
- [x] `fold_magnitude` in `computeCreaseFingerprint`, with a test that an
      angle-only edit invalidates it
- [x] Confirm (do not assume) that a magnitude-only edit advances
      `foldArtifactRevision`, so the main Export Image path is not stale too.
      **Checked: it does.** `executeOristudioCpCommand` and
      `applyOristudioCpLineMutation` both call `staleFoldArtifactResourceState`
      for any document-mutating command, which is how a fold angle is set. Only
      the segmentation cache was blind, and only that needed fixing

### i18n and validation
- [x] `i18n:extract`, translate 8 locales, `i18n:stamp`, `i18n:check` green
- [x] `npx tsc --noEmit` and vitest run **in the web workspace** (from the repo
      root vitest loads no config and every test fails on `localStorage`)
- [x] `npm run lint:web`, and `npm run build:web` — the new `lib/` →
      `cp-workspace/` import is exactly the kind of thing that bundles
      differently than it tests, so the production build was worth running
- [ ] Browser checklist below
- [x] Draft PR — https://github.com/zacharyfmarion/ori-studio/pull/307

## Browser checklist (author)

`simple_example.osf` (four creases at ±90°) is the minimum case; a real
3D-designed pattern is the honest one.

**Already checked in the running app** (`simple_example.osf` opened through the
real `openProject`, Export PNG dialog, light theme):

- The row appears directly below "Line style", and is **absent** for a blank
  classic CP — the gate fires both ways.
- `color`: the three −90° mountains render `#ec4aa6` and the +90° valley
  `#9d76f4`, the exact halfway blends toward `#d946ef`. The four borders stay
  `#111417`.
- `opacity`: the creases keep `#ff4d5d` / `#60a5fa` and carry
  `stroke-opacity="0.500"`; the borders carry none.
- Changing the dropdown redraws the preview immediately.

What that leaves is everything a look has to settle:

1. **Both export themes, and the PNG raster.** Only light-theme SVG was checked
   above. The PNG path rasterizes the same string, so the open question is
   narrowly whether `stroke-opacity` survives the `<img>` → canvas step.
2. **Vertex dots.** §9 — do the round caps composite into visible dots at
   shared vertices in `opacity` mode? If yes, alpha-bucketed `<g opacity>`.
3. **Opacity over the grid.** Turn on Show grid lines with `opacity` selected. A
   shallow crease over ruling is the worst background in the export, and it is
   newly reachable as of PR #305.
4. **The share card at real size.** 1000×525 is much smaller than the 1024-box
   export; α 0.2 on a hairline that has been downscaled may be invisible. If it
   is, the answer is a card-specific floor, not a global one.
5. **A `black-white` export with `color` selected**, to see how bad the magenta
   contradiction actually looks before deciding it stays documented-not-fixed.

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Borders and flat creases fade, because they carry angle `0` | M/V-only rule in §2, with the test called out first in the checklist |
| R2 | A classic crease arriving as 179.9999999 fades the whole pattern | Shared `isClassicFoldAngle`, reusing the epsilon `creaseExportFold.ts` already documents; explicit test |
| R3 | Stale cached fold angles make the export disagree with the editor, and it is read as a renderer bug | §8 — fix the fingerprint in this change, and verify the second path rather than assuming |
| R4 | Round-cap double-composite reads as dirt at every vertex | Browser check 2; `<g opacity>` bucketing is available if needed, which the canvas did not have |
| R5 | α 0.2 is invisible on a downscaled 1000×525 share card | Browser check 4. A card-specific floor is a constant, not a redesign |
| R6 | Encoding drifts from the canvas | There is one implementation; the export calls `foldAngleInk` rather than restating it. What differs is the palette, and the tests say so instead of asserting pixel parity |
| R7 | The gate hides the control on a pattern that still renders faded | R2's sibling — `hasNonClassicCreases` is the same predicate the renderer uses, applied to the same scoped fold |

## Open decisions

- **Fold-angle badges are out of scope — confirmed.** The editor also draws
  `−90°` midpoint labels (`foldAngleBadges.ts`), and they are visible in the
  screenshot that prompted this. They are a separate View-panel toggle from the
  display mode, deliberately — "do I want numbers cluttering this pattern" is a
  different question from "how should the ink encode the angle". Drawing them
  into an export is a real feature and probably a wanted one; it is text layout,
  label collision and a third control, and it does not belong in the same
  change.
- **Default stays `'color'`,** inherited from the editor. `opacity` is arguably
  the better *export* default — it is the mode that survives the monochrome line
  styles, and an exported picture is more likely to be printed or embedded in a
  black-and-white context than the canvas is. Worth deciding after browser
  check 5, not now.
- **Whether the Share modal gets a dropdown at all,** rather than silently
  following the editor's mode with no control. §7 argues for the dropdown and
  the request asks for it; the alternative is one fewer control in a modal that
  is deliberately spare. Reversible either way.
