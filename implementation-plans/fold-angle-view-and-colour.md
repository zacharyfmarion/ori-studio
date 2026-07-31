# Fold-angle view toggle and colour mapping

## Goal

Two refinements to how non-180 creases read on the canvas:

1. A **View-panel toggle** for the fold-angle labels, beside the existing CAMV
   toggle.
2. A **colour mapping** that distinguishes angles, replacing the lightness ramp —
   which failed twice: too weak to signal the angle, yet strong enough to make a
   third of a pattern look thinner.

Colour is unconditional; the toggle governs only the badges.

## Part 1 — The view toggle

The toggle controls the **numeric badges only**. Crease colour is unconditional:
a non-180 crease always looks different from a full fold, in every view, with no
way to turn that off. Colour is what the angle *is*; the badge is the readout you
may or may not want cluttering a dense pattern.

- `camvIssuesVisible?: boolean` already lives on `OristudioCpViewportOptions`
  (`lib/creasePatternViewport.ts:84`), is rendered by `CpViewControlsPanel`, and
  persists through `.osf` `viewState.viewport`. The new option follows it
  exactly — same shape, same panel, same persistence, no new machinery.
- Both badges and colour default **on**.
- **Name it for what it does**: `foldAngleLabelsVisible`, shown as "Fold angle
  labels". Calling it "fold angles" would imply turning it off removes the angle
  treatment entirely, and it does not — the creases stay coloured.

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

### Unconditional, and it does not reintroduce the thinning

Angle colour is **always on** — not gated, not defaulted-on-but-disableable. A
non-180 crease is a different thing from a full fold, so it should never be able
to masquerade as one. The Magenta5/Purple8 collision is accepted: those aux
colours are rare enough that trading them for a permanent signal is the right
call.

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

## Affected Areas

- `apps/web/src/lib/creasePatternViewport.ts` — `foldAngleLabelsVisible`
- `apps/web/src/components/panels/CpViewControlsPanel.tsx` — the toggle
- `apps/web/src/cp-workspace/foldAngle/foldAngleRamp.ts` — replace the wash with
  the diverging ramp; stays unconditional
- `apps/web/src/cp-workspace/adapters/{cpGeometryToScene,cpSnapshotToScene}.ts` —
  both builders, kept in step for the parity gate
- `apps/web/src/cp-workspace/foldAngle/CpFoldAngleLayer.tsx` — gate badges on the
  new option
- `apps/web/src/styles/theme.css` — the anchor token, per theme

## Checklist

- [x] `foldAngleLabelsVisible` on `OristudioCpViewportOptions`, defaulting on
- [x] Toggle in `CpViewControlsPanel` beside CAMV issues, labelled "Fold angle
      labels", with i18n across 8 locales
- [x] Persists through `.osf` `viewState.viewport` (no schema change)
- [x] **Badges** gate on it — the layer owns its own visibility, so the panel
      stays a one-line mount and no cap raise was needed
- [x] **Colour does not** — `applyFoldAngleRamp` takes no visibility argument at
      all, pinned by a signature test so the two cannot be wired together later
- [x] Diverging ramp on a new `--fold-angle-anchor` token
- [x] Ramp converges fully at 0°, because an unfolded mountain and an unfolded
      valley are the same physical thing
- [x] Chroma floor test (never drops into the grey a yellow anchor would cause)
- [x] Luminance test — the property that makes always-on safe
- [x] M/V separation: identical at 0°, monotone, above a floor at 45/90/135/180
- [x] Classic creases return their ink by identity
- [x] Parity gate covers the ramp

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | Angle view is confusable with aux lines (Magenta5/Purple8) | Only in a mode the user opted into; aux lines also differ in role and usually in dash. Revisit if it bites |
| R2 | Red↔magenta may be hard for protanopes, and the ramp compresses M/V separation as it approaches 0 | Not measured. The badge carries the sign unambiguously, so colour is never the only channel — but worth a real check before calling the scheme accessible |
| R3 | Two stroke builders drift | Existing parity gate, extended |
| R4 | The always-on ramp repeats the thinning regression | Measured: it holds 87–100% of L* because it rotates hue rather than washing toward the canvas, against 82% and falling for the old ramp. Pinned by a luminance test |

## Resolved

- **Angle colour is unconditional.** Not gated, not disableable. A non-180 crease
  must never be able to look like a full fold. The Magenta5/Purple8 collision is
  accepted as an edge case.
- **The toggle controls badges only**, and is named `foldAngleLabelsVisible` /
  "Fold angle labels" so it does not imply otherwise. Both it and colour default
  on.
- **The ramp converges fully at 0°.** Revised after pushback, correctly: a
  mountain at 0° and a valley at 0° are the same physical thing, so they should
  look the same. The earlier argument for stopping short leaned on the *storage*
  decision to keep `Red1+0` and `Blue2+0` distinct, which is a different
  question — storage remembers which way to go when the angle is raised again;
  the canvas shows what the pattern is. Separation stays useful where real folds
  live (ΔE 102/51/26 at 180/90/45°) and only collapses below ~20°.
