# Fold-angle display mode

## Goal

A **dropdown in the View panel** choosing how a non-180° crease reads on the
canvas, alongside the existing "Line style" and "Fold angle labels" rows. It adds
an **opacity** encoding: the shallower the fold, the more transparent the crease,
floored so a near-0° crease is still clearly visible.

Today the encoding is fixed — a diverging hue ramp toward a magenta anchor,
unconditional and unchooseable (`foldAngle/foldAngleRamp.ts`). This makes it one
of two, without giving up the property that made it unconditional: whichever
mode is picked, a non-180 crease still never renders as a full fold.

Three things in the code today argue for opacity specifically:

- **It keeps mountain and valley unambiguous at every angle.** This is the main
  point. `applyFoldAngleRamp` spends *hue* on magnitude, so direction and
  magnitude compete for the same channel — and direction loses as the fold
  flattens. `foldAngleRamp.test.ts` asserts exactly that: separation shrinks
  monotonically, and at 0° a mountain and a valley are ΔE 0, the same colour.
  Opacity spends a channel nothing else is using, so a 20° mountain is still
  plain `--fold-mountain` red and a 20° valley is still plain blue.
- **It is the only encoding that survives the monochrome line styles.** In
  `black-white`, `black-one-dot`, and `black-two-dot`, `cpLineStyleInk` resolves
  every crease to black or grey — and the hue ramp then shifts non-180 creases
  toward magenta, contradicting the whole premise of a black-and-white style.
  Opacity leaves RGB alone, so those styles stay monochrome.
- **It does not have to carry the whole signal.** The midpoint badge
  (`foldAngleBadges.ts`) is already the primary readout for *which* angle.
  Opacity only has to say "this one is shallower".

## Approach

### 1. The mode enum

`OristudioCpFoldAngleDisplay = 'color' | 'opacity'`

Naming follows `OristudioCpLineStyle`, which already uses `'color'`, so the two
dropdowns read as siblings.

- **`color`** — today's diverging hue ramp. Unchanged. (Was the default as this
  shipped; see Open decisions, where that was later flipped.)
- **`opacity`** — alpha ramp, RGB untouched. (Now the default.)

**Two modes, not three.** A composed `color-and-opacity` is one line to
implement, and it is the wrong line: hue-ramping *and* fading the same crease
gives up the property that makes opacity worth having, which is that
`--fold-mountain` red and `--fold-valley` blue stay exactly themselves at every
angle. The two modes are alternatives about which channel carries magnitude —
hue or alpha — and spending both leaves nothing carrying direction cleanly. Each
mode also stays a single-channel transform, which is what makes the two pins in
§4 (one touches only RGB, one touches only alpha) total rather than partial.

**There is deliberately no "None".** A dropdown invites one, but the codebase
currently enforces the opposite invariant: `applyFoldAngleRamp` takes no
visibility argument, and `foldAngleRamp.test.ts` pins that signature so colour
cannot be gated on UI state — a non-180 crease can never render as a full fold.
Every mode here still encodes the angle, so the invariant survives. Adding
"None" would break it, and that is one enum member and one test to change —
worth being an explicit call rather than something a dropdown drags in by shape.
See Open decisions.

### 2. The opacity curve, and why it steps at 180°

Linear-in-|ρ| from 1.0 is too quiet at the top: 135° would land at α 0.87 against
a classic 1.0, which is invisible on a hairline.

So the curve is categorical first, continuous second:

```
classic (magnitude undefined, or ≥ 180°)  ->  α = 1, ink returned by identity
non-classic                                ->  α = FLOOR + (CEIL - FLOOR) * (|ρ| / 180)
```

Measured at `FLOOR = 0.4`, `CEIL = 0.8` (see the acceptance bar below). That
gives a visible step the moment a crease stops being a full fold, then a readable
ramp within: 179° → 0.80, 90° → 0.60, 45° → 0.50, 0° → 0.40.

**The step is not a cliff the user can land on.** Setting 180° normalises to
`None` in the kernel, and FOLD import normalises an explicit 180 the same way
(`non-180-fold-angles.md`, "Normalise 180 to classic on write"), so `Some(180°)`
is unreachable. The discontinuity sits exactly at the edge of the reachable set.

It also mirrors a decision already made elsewhere: classic creases never get a
badge either. Non-classic is a *categorical* fact first and a magnitude second,
in both channels.

**FLOOR and CEIL are module constants, not theme tokens** — they are numbers, not
colours, and a CSS custom property carrying a scalar buys nothing. They are
derived from the acceptance bar below rather than picked; if one theme measures
worse than the rest, per-theme values are the follow-up, not the starting point.

**Acceptance bar, in Lab ΔE.** Asserted per theme in `foldAngleOpacity.test.ts`
over all 23 bundled presets plus `theme.css`'s own fallback canvas — a new preset
with an unusual canvas is exactly the change that would silently make shallow
creases vanish, and it should fail there rather than ship.

| | bar | worst measured |
| --- | --- | --- |
| floor keeps a crease visible | ≥35% of full-opacity ΔE from the canvas | 38% (`cobalt2` mountain) |
| …and visible in absolute terms | ≥20 ΔE | 22.2 (`catppuccin-latte` valley) |
| classic→ceiling step reads | ≥8 ΔE | 11.0 (`gruvbox-light` valley) |

**The originally-planned WCAG 3:1 bar was unreachable and had to be replaced.** A
*fully opaque* valley is only **2.25:1** on `catppuccin-latte` and `gruvbox-light`
— so an absolute contrast bar worth having fails before alpha is involved at all.
Contrast ratio also misranks the problem: it is super-linear on dark canvases, so
it names a dark theme as the worst case when perceptually dark themes have the
most room (5.7–7.8:1 to spend, against 2.25:1 on light). ΔE is the yardstick the
hue ramp's own tests already use, and it puts the worst case where it belongs.

### 3. Composite in alpha, not in RGB

Two ways to implement "less opaque", and the wrong one is tempting because it
matches the shape of the existing ramp:

- **CPU lerp toward the canvas colour**, mirroring how `applyFoldAngleRamp` lerps
  toward the anchor. It is wrong over anything that is not the canvas: creases
  draw *after* the grid, the paper fill, and imported reference images
  (`reglRenderer.ts` draw order), so a lerp toward the canvas colour paints the
  wrong colour wherever a reference image sits behind the pattern. Reference
  images beside crease patterns are a first-class feature here. Do not do this.
- **True per-instance alpha** — set `rgba[3]`. Correct over any background.

Use alpha. **No shader change is needed:** `strokeProgram.ts` already carries a
per-instance `aColor` with alpha, premultiplies in the fragment stage
(`vec4(vColor.rgb * vColor.a, vColor.a)`), and blends with
`srcRGB: 1 / dstRGB: 'one minus src alpha'`. It is a no-op at α = 1 today, which
is why nothing has exercised it on creases. Verify against
`strokeProgram.test.ts` rather than trusting this paragraph.

### 4. Module shape: extend, do not rewrite

`applyFoldAngleRamp` is pinned by two tests that exist for good reasons —
`expect(applyFoldAngleRamp).toHaveLength(3)` ("takes no visibility argument") and
"never touches alpha". Both would break if the mode were threaded through it, and
working around them by editing the assertions would delete the guard rather than
satisfy it.

They do not need to break. Keep `applyFoldAngleRamp` **exactly as it is** — it is
the `color` mode's implementation and it genuinely still does only hue — and add
two things beside it in the same module:

```ts
/** Alpha only. RGB is returned untouched; pinned by test. */
export function applyFoldAngleOpacity(ink: Rgba, magnitudeUnits: number | undefined): Rgba

/** The mode dispatcher. Classic creases return `ink` by identity in every mode. */
export function foldAngleInk(
  ink: Rgba,
  magnitudeUnits: number | undefined,
  options: { display: OristudioCpFoldAngleDisplay; anchor: Rgba }
): Rgba
```

Each function owns one channel, and each gets its own pin:

| function | pinned property |
| --- | --- |
| `applyFoldAngleRamp` | never touches alpha (existing) |
| `applyFoldAngleOpacity` | never touches RGB (new, the mirror) |
| `foldAngleInk` | **no mode is a no-op** — for every member of the enum, a 90° crease differs measurably from a classic one |

That last test is the direct statement of what `toHaveLength(3)` was proxying
for. The proxy stays; the direct assertion joins it.

The classic-crease identity fast path (`=== ink`, not merely equal) must hold in
every mode, so a document with no fold angles renders byte-identically and
allocates nothing regardless of the setting.

### 5. Plumbing

Both stroke builders take the mode. Their sixth parameter changes from
`foldAngleAnchor?: Rgba` to a single options object, rather than growing a
seventh positional argument:

```ts
foldAngle?: { anchor: Rgba; display: OristudioCpFoldAngleDisplay }
```

`undefined` keeps its current meaning — no fold-angle treatment at all. The only
production caller is `CreasePatternWebglCanvas.buildStrokes`, which always
passes it; `undefined` is exercised by the tests, and keeping it is what lets the
parity gate compare ramped against unramped output.

The two builders stay in step under the existing Phase 2 parity gate, which
extends to run per mode, with the non-vacuity assertion per mode too — otherwise
a mode that silently did nothing would pass parity trivially.

**`CreasePatternWebglCanvas.buildStrokes` must list the mode in its `useCallback`
deps.** It currently deps on `lineStyle`, `mode`, `currentTheme` and friends;
omitting the new one means switching the dropdown does not repaint until
something else invalidates the callback. This is the concrete footgun in this
change.

### 6. Storage

`foldAngleDisplay?: OristudioCpFoldAngleDisplay` on `OristudioCpViewportOptions`,
defaulting to `'color'`. It rides `.osf` `viewState.viewport` verbatim with **no
schema change**, exactly as `lineStyle` does.

One thing to handle that `lineStyle` currently does not: `nativeProjectFile.ts`
casts `viewState.viewport` to `OristudioCpViewportOptions` without validating it,
so a hand-edited or future-version file can deliver an unknown string. Normalise
at the point of use — `foldAngleInk` falls back to the declared default mode on
anything it does not recognise — which covers the store being written from
anywhere, not just from a file load, and costs one `default:` arm. That arm is
pinned by test against `DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY` rather than
hard-coded, which is what let the default flip later without leaving it behind.

## Affected Areas

**Web only.** No kernel, no wasm, no `.osf` schema bump, no rebuild of committed
`.wasm`.

- `apps/web/src/lib/creasePatternViewport.ts` — the union,
  `ORISTUDIO_CP_FOLD_ANGLE_DISPLAYS`, the `foldAngleDisplay` field, the default
- `apps/web/src/cp-workspace/foldAngle/foldAngleRamp.ts` —
  `applyFoldAngleOpacity` + `foldAngleInk`; `applyFoldAngleRamp` untouched
- `apps/web/src/cp-workspace/adapters/cpGeometryToScene.ts`,
  `cpSnapshotToScene.ts` — the options object, both kept in step
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — read the mode, pass
  it, **and add it to the `buildStrokes` deps**
- `apps/web/src/components/panels/CpViewControlsPanel.tsx` — one `Select` row,
  placed directly above "Fold angle labels" so the two fold-angle rows group.
  `Select` is already imported; the panel is 435 lines against a 800-line cap, so
  no cap raise
- `apps/web/src/i18n/enumLabels.ts` — `cpFoldAngleDisplayLabel`
- `apps/web/public/locales/*` — panel row label + 2 option labels, 8 locales

**Explicitly not touched**

- `strokeProgram.ts` — per-instance alpha already works
- `foldAngleBadges.ts` / `CpFoldAngleLayer.tsx` — `foldAngleLabelsVisible` stays
  its own toggle. "Do I want numbers cluttering this pattern" is a different
  question from "how should the ink encode the angle", and merging them into one
  dropdown would make hiding the numbers also change the colour

## Checklist

### Encoding
- [x] `applyFoldAngleOpacity`, alpha only, with the classic identity fast path
- [x] Test: never touches RGB (the mirror of the existing alpha pin)
- [x] Test: mountain/valley ΔE is *unchanged* at every angle — the property the
      hue ramp deliberately gives up, and the reason this mode exists
- [x] Step at the classic boundary; ramp `FLOOR..CEIL` within, monotone in |ρ|
- [x] **Bar measured**, per theme, over all 23 presets + the `theme.css`
      fallback. The planned WCAG 3:1 bar was unreachable (a *fully opaque* valley
      is 2.25:1 on light themes) and was replaced with Lab ΔE retention;
      constants derived from it, not picked
- [x] `foldAngleInk` dispatcher; an unrecognised value falls through to the
      default mode, pinned against the declared default so changing that constant
      cannot leave the `default:` arm behind
- [x] Test: no mode is a no-op — every enum member shifts a 90° crease measurably
- [x] Test: classic creases return `ink` **by identity** in every mode
- [x] `applyFoldAngleRamp` and both its existing pins unchanged — the mode never
      reaches it, so nothing had to be edited to fit

### Plumbing
- [x] `CpFoldAngleStyle` on both stroke builders; `undefined` keeps its meaning
- [x] Parity gate runs per mode, with the non-vacuity assertion per mode, plus
      one that the two modes differ from each other
- [x] `buildStrokes` deps include the mode (switching repaints immediately)

### UI and storage
- [x] `foldAngleDisplay` on `OristudioCpViewportOptions` (shipped defaulting to
      `'color'`; now `'opacity'` — see Open decisions)
- [x] `Select` row in `CpViewControlsPanel`, above "Fold angle labels"
- [x] `cpFoldAngleDisplayLabel` in `enumLabels.ts`
- [x] `.osf` `viewState.viewport` round-trip, no schema change — plus the
      absent-field case, so an older file is carried by `?? DEFAULT` at each use
      site rather than being filled in on read
- [x] `i18n:extract`, translate 8 locales, `i18n:stamp`, `i18n:check` green

### Validation
- [x] `npx tsc --noEmit` clean, full vitest suite green (187 files, 1816 tests) —
      run directly, **not** via `npm run typecheck:web`, which regenerates tracked
      `generated/**` wasm bindings nondeterministically
- [x] `npm run lint:web` clean
- [ ] Browser checklist below

## Browser checklist (author)

Four things this change can only be judged by looking at, on a real non-flat
pattern. The automated browser pane runs at `visibilityState: hidden` with no
rAF, so the WebGL canvas cannot be verified there.

1. **Are `FLOOR` and `CEIL` right?** The contrast bar sets a lower bound; whether
   the ramp *reads* is a look. Compare a box CP in both modes at a few zoom
   levels. Adjust the two constants — they exist to be tuned, and the tests are
   written against the shape of the curve, not the numbers.
2. **Vertex dots.** Segment quads overlap in a roughly `width × width` square at
   every shared endpoint. At α = 1 the double-composite is invisible; below it,
   each vertex may render as a darker dot. Cheap fixes do not exist (it would
   need a single-pass or stencil), so the likely outcome is accept-and-document —
   but it needs a look before that is claimed.
3. **Show-through.** Creases draw after the grid and after imported images. Check
   a shallow crease over the grid and over a reference image. The contrast bar is
   against the *canvas*; against an arbitrary image nothing can guarantee it, and
   the plan should say so rather than imply otherwise.
4. **Dark theme, and the monochrome line styles.** The monochrome case is the one
   opacity is supposed to fix outright — confirm a non-180 crease in
   `black-white` stays black instead of turning magenta.

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | `FLOOR`/`CEIL` land wrong for real patterns — too faint at one end, indistinguishable at the other | The contrast bar fixes the lower bound; the step at the classic boundary fixes the upper. Both are module constants and the tests assert the curve's shape, not its numbers, so tuning after browser check 1 is a two-line change |
| R2 | Editing `applyFoldAngleRamp`'s pins to fit the new shape deletes a guard rather than satisfying it | The ramp is not touched at all. The mode lives in a new dispatcher with its own, stronger pin |
| R3 | The mode is not in `buildStrokes` deps, so the dropdown appears dead until an unrelated invalidation | Explicit checklist item; a store-driven test that a mode change produces different stroke colours |
| R4 | Vertex double-composite reads as dirt at every vertex | Browser check 2. Accept and document if it is mild; if not, the mode is worse than it looked and the floor rises |
| R5 | A future/hand-edited `.osf` delivers an unknown mode string through the unvalidated `viewState.viewport` cast | `default:` arm in `foldAngleInk` falls back to the declared default mode. Total, and covers non-file writes too |
| R6 | The two stroke builders drift per mode | Existing parity gate, extended per mode, with per-mode non-vacuity so a dead mode cannot pass trivially |

## Open decisions

- **No "None" mode — confirm.** Recommended, because it keeps the invariant the
  ramp's signature pin currently enforces: a non-180 crease can never look like a
  full fold. Reversible in one enum member and one test if you want the escape
  hatch.
- **Monochrome coupling.** In `black-white` / `black-one-dot` / `black-two-dot`
  the current hue ramp turns non-180 creases magenta, which contradicts the
  style. Auto-switching those styles to `opacity` would fix it invisibly, and
  invisible coupling between two dropdowns is worse than the defect. Recommend
  leaving it to the explicit choice and documenting the interaction; revisit if
  it actually annoys.
- **Default.** ~~Stays `'color'`~~ — **resolved: flipped to `'opacity'`.** This
  shipped with `'color'` as the default, on the reasoning that nothing should
  change for anyone who does not touch the dropdown, and that flipping it was a
  one-line follow-up worth deciding *after* looking at real patterns. That look
  happened and `opacity` won, for the two reasons this plan already gave for
  adding it: it is the only mode that keeps mountain and valley readable at every
  angle, and the only one the monochrome line styles survive. Every surface that
  offers the choice — View panel, export dialog, share card — seeds from
  `DEFAULT_ORISTUDIO_CP_FOLD_ANGLE_DISPLAY`, so the flip was the one constant
  plus the `default:` arm below.

  This also settles the **monochrome coupling** decision above without the
  invisible coupling it warned against: the styles that the hue ramp contradicts
  are now correct by default, because the default no longer spends hue. Picking
  `color` explicitly still contradicts them, and still does so only on request.

## Out of scope, but worth naming

**SVG and PNG export carry no fold angle at all.** `creaseExport.ts` builds its
own SVG from FOLD edge assignments (`edgeAppearance` takes `M`/`V`/`B`/`F`/`U`),
so neither the existing hue ramp nor this opacity mode reaches an exported
picture — a 3D design exports as a picture that hides the very thing it is about.
That is a pre-existing gap, not one this change introduces, and it is a separate
piece of work: the export path would need the magnitude threaded through
alongside the assignment.
