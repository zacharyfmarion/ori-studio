# Keep BP flaps on the grid, and stop hiding it when they are not

## Goal

Two defects combine to make the BP Editor lose every crease, river, gadget and
conflict region while leaving the flap circles behind — the state saved in
`broken_bp_editor_ui.osf`:

1. The symmetry axis clamp parks a mirror-paired zero-extent flap **half a grid
   interval** from the mirror. On a sheet whose centre falls on a grid line (any
   even size) that is a position the grid does not have, and the BP kernel
   requires integral flap coordinates.
2. When the kernel then refuses the layout, the runtime swallows the error
   (`.catch(() => null)`) and the mapper renders the resulting `null` as "no
   graphics" — indistinguishable from a healthy empty layout.

Fix both: the clamp must only ever land a flap somewhere the grid actually has,
and a layout the kernel could not compute must be visible as a diagnostic rather
than as a blank canvas.

## Why it breaks

A fractional flap coordinate makes the junction separation `s` fractional, hence
the overlap `o = distance - s` fractional
(`crates/oristudio-bp/src/layout.rs` `create_junction`). Measured on the saved
file: junctions `3↔6` and `4↔5` have `s = (7.5, 7)` against a tree distance of
8, so `ox = 0.5`. `single_overlap_devices` then fails
`integer_dimension(overlap.ox)` and returns
`InvalidInput("overlap ox must be integral for BP GOPS generation")`
(`crates/oristudio-bp/src/layout/generators.rs`). That error escapes the whole
of `project_graphics_snapshot`, so one bad gadget takes out every node contour,
ridge, river, device *and* every invalid-junction polygon.

Isolation, same design with only f3/f4's x changed:

| f3.x / f4.x | snapshot |
| --- | --- |
| 11 / 5 | OK — 6 node graphics, 2 device graphics, 2 conflicts |
| 11.5 / 4.5 | **ERR** |
| 12 / 4 | OK — 6 node graphics, 0 device graphics, 2 conflicts |
| 10.5 / 5.5 | **ERR** |

The fraction is also sticky: `eventToPackingPoint` rounds the *cursor*, and the
grab offset is `roundedCursor - anchor`, so every drag translates by a whole
number of cells. Once an anchor is off-grid no ordinary drag brings it back.

This is not upstream behaviour. Box Pleating Studio's `dragController` returns
`$round(local)`, `core/math/gops.ts` keys its memo through `intDoubleMap`, and
`core/math/kamiya.ts` doubles the overlap with `ox <<= 1` — an int32 shift. Its
flap coordinates are integers by construction, and a fractional `ox` would make
`generate` yield nothing (no pattern) rather than throw. Our port turned
"no pattern here" into a fatal error with global reach.

## Approach

### 1. The clamp lands on the grid, by construction

`minimumAxisClearance` in `apps/web/src/lib/bpPackingSymmetry.ts` picks a
*distance* (`interval / 2`) and assumes the grid has it. Replace the distance
with a question the grid can answer: **how many whole cells along the axis
normal until this flap is clear?**

- The perpendicular axes are grid-aligned, so one cell of movement is one cell
  of distance. The diagonals need `interval · √2`, *not* `interval / √2`: the
  nearest lattice point to a diagonal does sit `1/√2` from it, but reaching it
  needs a step *along* the axis as well, which a normal-only correction has no
  way to make. `√2` is the (1, -1) hop — the shortest purely perpendicular move
  the lattice has. (Getting this backwards lands the flap on a half-integer,
  which is the very bug being fixed; the tests catch it.)
- A box with extent across the mirror may rest its near edge *on* it; a
  zero-extent flap may not, because a point on the mirror **is** its own
  reflection and the pair collapses to two flaps at one spot. That is the only
  difference between the two cases, and it is exactly a strict-vs-non-strict
  inequality.

Solving in whole steps is what makes this correct on both parities without a
special case: a centre on a grid line yields a stop one full cell out, a centre
between two yields half a cell — which is what the old constant happened to get
right, and is the reason the bug hid.

### 2. A layout the kernel refused is a diagnostic, not silence

`oristudioBpRuntime.ts` drops the snapshot error on the floor in two places.
Capture it instead and thread it to the mapper, which already owns a diagnostics
channel (`projectDiagnostics`) and already reports the neighbouring
`patternNotFound` case. Add a `layout-graphics-error` diagnostic kind, surface
it through the packing pane's existing `BpPackingAlerts`, and add it to
`staleReasons` so the packing does not read as current when it could not be
drawn.

Keeping the fetch non-fatal is deliberate: the rest of the document (tree,
flaps, sheet) is still valid and editable, and dragging the offending flap back
onto legal ground is exactly how a user recovers. What must not survive is the
*silence*.

### 3. A lone flap can come back onto the grid

Fix 1 stops new off-grid flaps; it cannot rescue a file already saved with one,
because drags translate by whole cells and carry the fraction along forever. So
`constrainBpPackingFlapGroupTarget` — the single funnel both the drag and the
nudge pass through — rounds a **single** flap's target onto the grid. Rounding an
on-grid anchor is a no-op, so this cannot change any healthy gesture.

Deliberately not done for a group: one vector moves every member, so a correction
that puts the reference back on the grid takes an on-grid partner off it. A group
keeps its shape.

## Affected Areas

- `apps/web/src/lib/bpPackingSymmetry.ts` — grid-aligned axis clamp.
- `apps/web/src/store/workspaceStore/oristudioBpRuntime.ts` — capture the layout
  snapshot failure instead of discarding it.
- `apps/web/src/engine/oristudioBpSnapshotMapper.ts` — new diagnostic + stale
  reason.
- `apps/web/src/engine/oristudioBpTypes.ts` — `layout-graphics-error` kind.
- `apps/web/src/components/panels/BpPackingPanel.tsx` — surface it in the pane's
  alerts.
- `apps/web/src/lib/bpPackingViewport.ts` — `snapBpPackingAnchorToGrid`, and the
  single-flap snap in `constrainBpPackingFlapGroupTarget`.
- `apps/web/public/locales/*` — one new label string.
- Tests: `bpPackingSymmetry.test.ts`, `bpPackingViewport.test.ts`,
  `oristudioBpSnapshotMapper.test.ts`.

## Known follow-ups, deliberately out of scope

**Self-mirrored flaps on an odd sheet.** `projectBpFlapAnchorOntoAxis` puts a
flap that is its own mirror at the sheet centre, which is off-grid on an
odd-sized sheet (centre 7.5 on a 15-wide sheet). Unlike the paired case there is
no on-grid answer — a flap that is its own mirror has nowhere else to be — so
choosing one is a product decision (refuse the fold, snap and accept asymmetry,
or allow a half-grid sheet), not a bug fix.

**The kernel's reaction is harsher than upstream's.** Given a fractional `ox`,
Box Pleating Studio's `generate` yields nothing and the design ends up with no
pattern; ours raises `InvalidInput` and loses the entire snapshot. Softening that
to match upstream is parity work that wants its own change and oracle coverage —
and here the loud version is the more useful one, now that fix 2 lets it speak.

Fix 2 turns both into legible errors rather than blank canvases, which is the
right containment until each is decided on its own terms.

## Checklist

- [x] Grid-aligned axis clamp in `bpPackingSymmetry.ts`
- [x] Unit tests: even and odd sheets, perpendicular and diagonal axes, boxes
      with and without extent, multi-flap groups
- [x] Single-flap grid snap in `constrainBpPackingFlapGroupTarget`, with tests
- [x] Capture the layout snapshot error in `oristudioBpRuntime.ts`
- [x] `layout-graphics-error` diagnostic + stale reason in the mapper
- [x] Surface it in `BpPackingAlerts`, with i18n for all 8 locales
- [x] Mapper tests for the new diagnostic
- [x] `npm run lint:web`, `tsc --noEmit`, full web vitest, `i18n:check`
- [x] Browser-verified against `broken_bp_editor_ui.osf`
- [x] Draft PR against `main` — https://github.com/zacharyfmarion/ori-studio/pull/218
