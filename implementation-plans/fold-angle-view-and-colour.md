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

### Always on, and it does not reintroduce the thinning

Angle colour is **on in the default view**. The Magenta5/Purple8 collision is
accepted: those aux colours are rare enough in practice that trading them for an
always-visible signal is the right call.

The obvious worry is repeating the regression the lightness ramp caused — a
third of the pattern reading as thinner. Measured, it does not, and the reason
is structural: the old ramp *washed toward the canvas*, dropping luminance; this
one is a **hue rotation at roughly constant lightness**.

| angle | mountain | L* vs 180° | valley | L* vs 180° |
| --- | --- | --- | --- | --- |
| 180° | `#ff4d5d` | 100% | `#60a5fa` | 100% |
| 135° | `#f94c73` | 100% | `#7297f8` | 96% |
| 90° | `#f44b89` | 98% | `#8488f7` | 91% |
| 45° | `#ee4a9f` | 98% | `#967af5` | 88% |
| 0° | `#e849b5` | 97% | `#a96cf3` | 87% |

Against the old wash ramp, which put a 90° mountain at **82%** and kept falling.
Nothing here loses enough contrast to read as weight loss.

### Stop the ramp short of the anchor

A full diverging ramp converges: at 0° both halves land on the anchor and become
*the same colour*, ΔE 0. Mountain and valley would be indistinguishable exactly
where the crease is least informative.

Stopping at **60% of the way** to the anchor keeps them apart at every angle:

| angle | full ramp M/V ΔE | 60% ramp M/V ΔE |
| --- | --- | --- |
| 180° | 102 | 102 |
| 90° | 51 | 72 |
| 45° | 26 | 57 |
| 0° | **0** | **41** |

ΔE 41 is still a clearly distinct pair. In a crease pattern, knowing mountain
from valley never stops mattering, so this is worth the slightly less "pure"
zero.

It also lines up with a decision already made: `ρ = 0` deliberately keeps two
encodings (`Red1+0` and `Blue2+0`) because they preserve the user's stated
direction. Rendering them as distinct colours is consistent with keeping them as
distinct states.

### What the toggle does, then

It hides the **whole** fold-angle treatment — colour and badges together —
returning the canvas to plain Oriedita rendering. Default on, so angle colour is
visible out of the box.

Gating both together rather than badges alone avoids the confusing middle state
where creases are magenta with nothing on screen explaining why.

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
- [ ] Crease colouring gates on it (colour and badges hide together)
- [ ] Angle colour is **on by default**
- [ ] Ramp stops at 60% toward the anchor; test asserting M/V stay above a ΔE
      floor across 0–180, so a later tweak cannot let them converge
- [ ] Diverging ramp anchored on a new `--fold-angle-anchor` token, per theme
- [ ] Ramp is chroma-preserving: a test asserting Lab chroma stays above a floor
      across 0–180 on both halves, so the next anchor change cannot quietly
      reintroduce the grey middle
- [ ] Classic creases return their ink by identity in both modes
- [ ] Parity gate extended to the new ramp, with the non-vacuity assertion
- [ ] Golden test: toggle off renders identically to pre-fold-angle Ori Studio
- [ ] Test asserting the ramp holds luminance — this is what separates it from
      the wash ramp that made lines look thin, and it is easy to lose

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Angle view is confusable with aux lines (Magenta5/Purple8) | Only in a mode the user opted into; aux lines also differ in role and usually in dash. Revisit if it bites |
| R2 | Red↔magenta may be hard for protanopes, and the ramp compresses M/V separation as it approaches 0 | Not measured. The badge carries the sign unambiguously, so colour is never the only channel — but worth a real check before calling the scheme accessible |
| R3 | Two stroke builders drift | Existing parity gate, extended |
| R4 | The always-on ramp repeats the thinning regression | Measured: it holds 87–100% of L* because it rotates hue rather than washing toward the canvas, against 82% and falling for the old ramp. Pinned by a luminance test |

## Resolved

- **Angle colour is on by default**, not gated. The Magenta5/Purple8 collision is
  accepted as an edge case.
- **The ramp stops at 60% toward the anchor**, so mountain and valley never
  converge (ΔE 41 at worst, versus 0 for a full ramp).
- **The toggle hides colour and badges together**, avoiding a state where creases
  are magenta with nothing explaining why.
