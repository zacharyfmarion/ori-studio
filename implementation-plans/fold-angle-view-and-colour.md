# Fold-angle view toggle and colour mapping

## Goal

Two refinements to how non-180 creases read on the canvas:

1. A **View-panel toggle** for fold-angle display, beside the existing CAMV
   toggle.
2. A **colour mapping** that distinguishes angles, replacing the lightness ramp —
   which failed twice: too weak to signal the angle, yet strong enough to make a
   third of a pattern look thinner.

They turn out to be one design, not two, which is the main finding below.

## Part 1 — The view toggle

Straightforward, and it slots into an existing pattern.

- `camvIssuesVisible?: boolean` already lives on `OristudioCpViewportOptions`
  (`lib/creasePatternViewport.ts:84`), is rendered by `CpViewControlsPanel`, and
  persists through `.osf` `viewState.viewport`. `foldAnglesVisible` follows it
  exactly — same shape, same panel, same persistence, no new machinery.
- Default **on**. A user who has set fold angles wants to see them; a classic
  document is unaffected either way because it has none.

## Part 2 — The colour mapping

### Your instinct is structurally right

A signed quantity with a meaningful zero wants a **diverging** ramp: two hues at
the extremes, something neutral at 0. That is exactly ±180 mountain/valley with
an unfolded crease in the middle. The only open question is *which* anchor.

### But the palette is nearly full

Oriedita's line colours already occupy most of the hue wheel:

| token | value | |
| --- | --- | --- |
| `--fold-mountain` | `#ff4d5d` | Red1 |
| `--fold-valley` | `#60a5fa` | Blue2 |
| `--fold-flat` | `#64c8c8` | Cyan3 |
| `--fold-unassigned` | `#9aa4ad` | grey |
| `--cp-color-orange` | `#f97316` | Orange4 |
| `--cp-color-magenta` | `#d946ef` | Magenta5 |
| `--cp-color-green` | `#22c55e` | Green6 |
| `--cp-color-yellow` | `#eab308` | **Yellow7 — your proposed anchor is already a line colour** |
| `--cp-color-purple` | `#8b5cf6` | Purple8 |
| `--cp-color-other` | `#14b8a6` | Other9 |

So *any* third hue collides with something. The question is which collision
hurts least — and, separately, whether the ramp stays **saturated**, which is
what actually decides legibility on a 1px line.

### Measured: chroma along each candidate ramp

Lab chroma (higher = more saturated, more legible on a hairline) and the nearest
palette colour by ΔE:

| anchor | 135° M | 90° M | 135° V | 90° V | verdict |
| --- | --- | --- | --- | --- | --- |
| **Yellow** `#eab308` | 71 | 71 (ΔE 11 → Orange4) | **17** | **24** | mountains great, valleys collapse |
| **White** `#f5f5f5` | 55 | 35 | 37 | 25 | both collapse |
| **Magenta** `#d946ef` | 69 | 71 | **59** | **72** | both stay saturated |

Reference: red is chroma 74, blue 49. Anything under ~30 reads as grey.

**Your yellow instinct is right for mountains and wrong for valleys, for a
concrete reason.** Blue and yellow are near-complementary, so a blue→yellow path
crosses the neutral axis: a 135° valley lands on `#82a8be`, chroma 17, whose
nearest palette neighbour is **`unassigned` grey at ΔE 11**. It would read as a
dimmed or unassigned line — precisely the failure the lightness ramp already had.
The mountain half is genuinely good (chroma stays ~71); it just collides with
Orange4 around 90°.

**White fails outright.** Chroma collapses on both sides and everything trends
toward grey. This is the same dimming failure in a different costume.

**Magenta is the only anchor that keeps both halves saturated**, because red→
magenta and blue→magenta both travel the *short* way round the hue wheel without
crossing neutral. Its cost is collision: 90° valley `#9c76f4` sits ΔE 18 from
Purple8, and the mountain half runs through Magenta5.

### The toggle is what licenses the bold scheme

This is why the two requests are one design.

- **Toggle off** — creases render exactly as Oriedita does: red, blue, no ramp
  at all. This also *retires the lightness ramp*, which fixes the "lines look
  thin" complaint permanently rather than tuning it.
- **Toggle on** — the mode declares "I am showing you angles", which is what
  makes a loud red→magenta→blue ramp legitimate and makes an aux-colour
  collision acceptable: the user asked for this view, and aux lines are a
  different role anyway.

So the recommendation is: **no ramp in the default view; magenta-anchored
diverging ramp in angle view; badges in both** (they are the exact readout and
are already working).

That also means the answer to "which collision hurts least" stops mattering
much, because the collision only exists in a mode the user opted into.

## Affected Areas

- `apps/web/src/lib/creasePatternViewport.ts` — `foldAnglesVisible`
- `apps/web/src/components/panels/CpViewControlsPanel.tsx` — the toggle
- `apps/web/src/cp-workspace/foldAngle/foldAngleRamp.ts` — replace the wash with
  the diverging ramp; it becomes mode-gated rather than always-on
- `apps/web/src/cp-workspace/adapters/{cpGeometryToScene,cpSnapshotToScene}.ts` —
  both builders, kept in step for the parity gate
- `apps/web/src/cp-workspace/foldAngle/CpFoldAngleLayer.tsx` — gate badges
- `apps/web/src/styles/theme.css` — the anchor token, per theme

## Checklist

- [ ] `foldAnglesVisible` on `OristudioCpViewportOptions`, defaulting on
- [ ] Toggle in `CpViewControlsPanel` beside CAMV issues, with i18n across 8 locales
- [ ] Persists through `.osf` `viewState.viewport` (no schema change — the field
      is already a free-form viewport bag)
- [ ] Badges gate on it
- [ ] Crease colouring gates on it
- [ ] **Default view drops the ramp entirely** — classic creases render exactly
      as before, which is what retires the thinning complaint
- [ ] Diverging ramp anchored on a new `--fold-angle-anchor` token, per theme
- [ ] Ramp is chroma-preserving: a test asserting Lab chroma stays above a floor
      across 0–180 on both halves, so the next anchor change cannot quietly
      reintroduce the grey middle
- [ ] Classic creases return their ink by identity in both modes
- [ ] Parity gate extended to the new ramp, with the non-vacuity assertion
- [ ] Golden test: toggle off renders identically to pre-fold-angle Ori Studio

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Angle view is confusable with aux lines (Magenta5/Purple8) | Only in a mode the user opted into; aux lines also differ in role and usually in dash. Revisit if it bites |
| R2 | Red↔magenta may be hard for protanopes, and the ramp compresses M/V separation as it approaches 0 | Not measured. The badge carries the sign unambiguously, so colour is never the only channel — but worth a real check before calling the scheme accessible |
| R3 | Two stroke builders drift | Existing parity gate, extended |
| R4 | A new always-on visual treatment repeats the thinning regression | Default view has *no* treatment at all now, which is strictly safer than today |

## Open decisions

1. **How much mountain/valley separation to trade for angle legibility.** A full
   diverging ramp converges both hues toward the anchor, so at 45° a mountain is
   pink-magenta and a valley is violet — distinguishable, but far less so than
   red vs blue. The alternative is two *independent* ramps that approach the
   anchor without meeting, keeping M/V distinct at every angle at the cost of a
   less clean "zero" reading. I lean to the second: in a crease pattern, knowing
   mountain from valley never stops mattering.

2. **Does the toggle gate colour, or only badges?** This plan assumes colour too,
   because that is what makes the bold ramp affordable and simultaneously fixes
   the thinning. If you would rather angle colouring were always on, the anchor
   has to be much more conservative and we are back to the same compromise.
