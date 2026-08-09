# Folded-model appearance options for a 3D figure

## Goal

The **Folded models** section of the CP inspector — Front colour, Back colour,
Line colour, Shadow, and the rest of `FoldedFigureModel` — currently governs a
flat folded figure only. A 3D figure honours three of its fields and silently
ignores the others, so a control that is on screen and enabled does nothing.

Make every option either **work** on a 3D figure or be **visibly unavailable**,
with no third state. A control that is present, enabled, and inert is the thing
this plan exists to remove.

## The constraint that shapes everything

Ori Studio's folded figure is an Oriedita port. The flat renderer *is*
`crates/oristudio-cp/src/folding.rs`, checked against the Java drawer by the
render oracle, and Oriedita continues to develop. So the rule from `PORTING.md`
applies at full strength here:

> **Read the upstream implementation before changing ported behaviour.** Do not
> substitute simpler or approximate algorithms.

Which means the seam this plan must protect is not "flat vs 3D" — it is
**"Oriedita's, and therefore re-portable" vs "ours, and therefore ours to
change"**. Those are not the same line, and today they are blurred: the 3D
projector reads `FoldedFigureModel`, a *ported* type, and quietly honours a
subset of it.

### Where the line goes

| Layer | Owner | Rule |
| --- | --- | --- |
| `FoldedFigureModel` and its fields | **Oriedita** | Field set, defaults, wire codes and `.ori`/`.orh` round-trip stay byte-identical. A new upstream field is added here and nowhere else |
| `folding.rs` flat drawing | **Oriedita** | Unchanged. The render oracle is the check |
| `folding3d/` | **Ori Studio** | Ours. `PORTING.md` already records `folding3d` as native |
| `foldedFigure3dProjection.ts` | **Ori Studio** | Ours. It *reads* the ported model but must not redefine it |
| The inspector controls | **shared** | One control set; availability differs per figure kind |

**The concrete thing to build for that seam** is a single place that answers
"does this option mean anything for this figure", rather than each surface
guessing:

```ts
// apps/web/src/cp-workspace/folded/foldedFigureAppearance.ts
export type FoldedAppearanceOption =
  | 'frontColor' | 'backColor' | 'lineColor' | 'antiAlias'
  | 'shadow' | 'transparency' | 'scale' | 'rotation';

export function foldedAppearanceSupport(
  figure: OristudioCpFoldedFigureEntry,
  option: FoldedAppearanceOption
): 'supported' | 'unsupported' | 'not-applicable';
```

React-free and store-free, beside the other folded modules, per the panel rules
in `AGENTS.md`. The inspector renders from it; nothing else decides.

Why a function rather than a table on the entry: the answer is a property of the
*kind of figure*, and putting it on the entry would mean persisting it, which
would mean a stored figure disagreeing with the build that opens it.

## What each option needs

Measured against `FoldedFigureModel` (`folding.rs:286`) and what
`folded3dPaperStyle` (`foldedFigure3dProjection.ts:239`) reads today.

| Option | 3D today | Work |
| --- | --- | --- |
| **Front colour** | works | none |
| **Back colour** | works | none |
| **Line colour** | works | none |
| **Anti-alias** | works (drives `lineWidth`) | none |
| **Shadow** | **ignored** | §1 |
| **Transparency** (`transparent_transparency`, `transparency_color`) | **ignored** | §2 |
| **Scale / rotation** | already work, via the canvas handles | none — §3 |
| **State** (front/back) | works, as a camera | none |

So the honest scope is **two options to implement**, not eight. Everything else
either already works or is deliberately not a control.

### 1. Shadow

Oriedita draws a shadow as *offset bands* along the silhouette, and the kernel
already models the choice (`FoldedShadowGeometry`, `folding.rs:386`) because the
offset length depends on the figure's scale. That is a **2D** construction: the
band is the outline swept by a fixed screen-space offset.

Two ways to give a 3D figure a shadow, and they are not equivalent:

- **Port the band construction.** The projector already produces a silhouette;
  sweeping it is the same operation. Cheap, matches Oriedita's look, and stays
  inside our own module because the *input* is our projection rather than
  Oriedita's flat geometry.
- **Light the paper properly.** The projector already computes a per-face view
  normal for shading (`lightIntensity`). A cast shadow would need a ground plane
  and a light, which is a renderer this surface does not have.

**Recommendation: the band.** It is what the control means today, it keeps one
visual language between flat and 3D, and it does not invent a lighting model the
rest of the canvas cannot honour. Record the divergence explicitly: our bands are
computed from *our* silhouette, so they will not be pixel-identical to Oriedita's
on the same document, and that is expected rather than a parity bug.

### 2. Transparency

`Transparent3` already exists as a display style and works on a 3D figure. The
model's `transparent_transparency` (a 0–255 amount) and `transparency_color`
(a flag) are the *flat* renderer's knobs and the projector ignores both, using a
fixed `TRANSPARENT_FACE_ALPHA`.

Wiring the amount through is small and worth it — it is a real control with a
real meaning in 3D. `transparency_color` needs a look at the Java drawer before
anything is decided; it is not obvious it has a 3D reading at all, and
`unsupported` is an acceptable answer if it does not.

### 3. Scale and rotation — already work, and nothing changes

**No work here.** An earlier draft of this plan had a phase to "retire the
scale/rotation controls", which was wrong on both counts: the controls the user
scales and rotates a figure with are the **canvas handles**, they already work,
and the Folded models inspector section has no scale or rotation control to
retire. It contains display style, side, the three colours and shadow — nothing
else.

The handles drive `FoldedFigurePlacement`, which the `.osf` stores, and they stay
live on a focused figure: `inertBodyIds` makes only the *body* polygon inert, so
orbiting a figure never costs you the ability to size or turn it on the page.
A folded figure is aspect-locked, so it gets corner handles plus rotate.

The fact worth recording — and the only reason this section exists — is why
`FoldedFigureModel.scale` / `.rotation` are *not* wired to any of that. They are
Oriedita's own display transform, seeded only from imported Oriedita metadata.
Wiring them would give one figure two transforms that disagree. They stay on the
ported type, untouched, so `.ori` round-trips are unaffected.

`foldedAppearanceSupport` reports them `not-applicable` so that a future control
cannot be added against the wrong field by accident.

## Preserving the Oriedita export

The reason to be careful, stated as a check rather than an intention:

- **Nothing in this plan adds a field to `FoldedFigureModel`.** Shadow and
  transparency reuse fields Oriedita already has; the 3D-only state that has no
  upstream meaning (camera, frame radius) already lives on the *web-side entry*,
  outside the ported type, which is what keeps `.ori`/`.orh` writable.
- **A round-trip test is the gate**, not a code review: open an Oriedita file,
  change every appearance option, save, and assert the folded-figure metadata is
  byte-identical to what Oriedita would write for those values.
- **The render oracle must stay green.** Any change that touches `folding.rs`
  outside a new-upstream-feature port is out of scope for this plan.
- **A note in `PORTING.md`** naming the shadow-band divergence (§1), so the next
  person porting an upstream shadow change knows ours is computed from our
  projection.

## Affected Areas

- `apps/web/src/cp-workspace/folded/foldedFigureAppearance.ts` (new) + tests
- `apps/web/src/cp-workspace/folded/foldedFigure3dProjection.ts` — shadow bands,
  transparency amount
- The inspector's Folded models section — render from `foldedAppearanceSupport`
- `crates/oristudio-cp/src/folding.rs` — **read only**
- `PORTING.md` — the divergence note
- `docs/analytics.md` if an option gains an event

## Non-goals

- Any change to `FoldedFigureModel`'s fields, defaults or wire codes.
- Any change to the flat renderer.
- A lighting model, ground plane or cast shadows (§1).
- Wiring `FoldedFigureModel.scale`/`.rotation` to anything (§3). The canvas
  handles already scale and rotate a figure, through `FoldedFigurePlacement`.
- Per-face or per-crease colour. Oriedita has no such concept and adding one
  here would put a field on the ported type.

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | An option is wired for 3D and silently drifts from the flat meaning | One support function, and a test that every `FoldedAppearanceOption` is answered for both figure kinds — a new option cannot be added without deciding |
| R2 | Shadow bands diverge from Oriedita and get "fixed" later by someone reading the oracle | Divergence recorded in `PORTING.md` with its reason (§1) |
| R3 | The Oriedita export changes shape | Byte-identical round-trip test as the gate, not review |
| R4 | `transparency_color` turns out to have no 3D reading and gets a guessed one | Read the Java drawer first; `unsupported` is a legitimate answer |
| R5 | The inspector grows a per-kind branch per control | It renders from the support function; the branch exists once |

## Checklist

### Phase 1 — The seam
- [ ] `foldedFigureAppearance.ts` with `foldedAppearanceSupport`, React-free
- [ ] Exhaustiveness test: every option answered for a flat and a 3D figure
- [ ] Inspector renders availability from it; no control is enabled-and-inert
- [ ] `PORTING.md` records where `folding.rs` ends and `folding3d`/the projector
      begin for appearance

### Phase 2 — Shadow
- [ ] Read Oriedita's Java drawer for the band construction before writing any
- [ ] Bands from the projector's silhouette, honouring `display_shadows`
- [ ] Golden primitive-stream test at two cameras
- [ ] `PORTING.md` divergence note

### Phase 3 — Transparency
- [ ] `transparent_transparency` drives the projector's alpha
- [ ] Decide `transparency_color` from the Java drawer; `unsupported` if it has
      no 3D reading, and say so in the support function's doc

### Validation
- [ ] `npx tsc --noEmit`, `npx vitest run`, `npx eslint .`
- [ ] `npm run i18n:check` for any new label
- [ ] `cargo test --workspace` — expected to be a no-op; if `folding.rs` changed,
      the change is out of scope
- [ ] Oriedita render oracle green
- [ ] Browser checklist: each option on a 3D figure and on a flat one
