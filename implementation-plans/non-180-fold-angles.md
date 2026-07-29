# Non-180° fold angles

## Goal

Let a crease carry any fold angle in `[-180°, +180°]`, not just full mountain
(`-180`) / valley (`+180`). This makes Ori Studio a strict superset of Oriedita:
every existing crease pattern keeps working byte-identically, and 3D-shaped
models (boxes, prisms, tubes, curved-ish surfaces) become expressible.

Primary user workflow is **transcription**, not synthesis: someone folds a model
by hand, then draws the crease pattern for it. They already know the angles they
want. Direct entry is the main path; solvers are an assist, not the centrepiece.

Three sources of truth for this work:

- `oristudio feedback.pdf` (Brandon Wong) — the feature proposal, from prior
  experience building `Ori3Dita`.
- `quaternions.pdf` (Brandon Wong, 2026-04-07) — "3d Kawasaki's theorem with
  quaternions". §2 closure condition, §3 degree-4 coupling, §4 solve for an
  unknown crease, §5 solve for 3 unknown fold angles.
- FOLD spec `edges_foldAngle`, which the repo already conforms to.

### Sign convention (already settled — do not relitigate)

`fold_angle_for_line_color` (`crates/oristudio-cp/src/model/mod.rs:510`) maps
`Blue2` (valley) → `+180` and `Red1` (mountain) → `-180`. That is the FOLD
spec's convention. **Negative is mountain, positive is valley, 0 is unfolded.**
Brandon's note that there is no convention is out of date; ours is fixed by our
own FOLD I/O and cannot change without breaking every existing `.fold` export.

## Merge criteria

The governing rule is: *an end user must never be able to reach an inconsistent
state.* A user who can set fold angles but has no checker can build a pattern
that cannot fold and get no signal until they simulate — that is exactly the
state this rule forbids.

So **Phases 1–6 all land on this branch before it merges.** There is no flag, no
experimental label, and no shipping increment smaller than that set. The phases
are **work order, not release order** — nothing user-facing ships until the whole
set is done.

Phases 1–6 are precisely what the rule requires: they are the difference between
"can reach an inconsistent state" and "cannot".

Phases 7–8 are follow-up work, taken separately if they grow large or
complicated. Neither creates inconsistency: Phase 7 (solvers) only means a user
does more by hand, and Phase 8 (spherical self-intersection) leans on the
simulator the way `G` already leans on the flat folder for taco-tortilla — the
division of labour this plan already accepts.

Three concrete things this rule implies, beyond "ship it all at once":

- **The checker (Phase 6) is a merge blocker**, not a follow-up.
- **`.osf` version skew is not a risk yet — but only because of where we ship.**
  `minimumReaderSchemaVersion` stays hardcoded at `1`. The failure it would guard
  against (an older reader opens a fold-angle document, drops the magnitudes it
  cannot parse, destroys them on save) needs an older reader to exist, and on web
  every user is on the current deploy. **Revisit when desktop ships**: desktop
  builds are pinned and do not auto-update, which is exactly when version skew
  becomes real. See Phase 1.
- **A format mismatch must error, never misparse.** Already true for the compact
  transport: `CompactGeometry::from_bytes` rejects an unrecognised magic
  outright, so the `OCG1` → `OCG2` bump hard-fails rather than misreading a
  buffer. Preserve that property.

## Approach

### 1. Representation: direction × magnitude

The tempting design is `fold_angle: Option<f64>` sitting beside `LineColor`.
Reject it. It encodes one concept in two fields with a consistency invariant
between them (angle sign must agree with Red1/Blue2), so every one of the ~693
`Red1|Blue2` sites in `crates/` becomes latent bug surface, and every consumer
grows an `unwrap_or_else(default_from_color)`.

Instead, split the concept along an axis where the two halves are **orthogonal
by construction**:

- **Direction** stays in `LineColor`. `Red1` = mountain = negative. `Blue2` =
  valley = positive. Unchanged, including its wire codes.
- **Magnitude** is new: `|ρ|` in `[0°, 180°]`, meaningful only for `Red1`/`Blue2`.

```rust
/// |ρ| in units of 1e-7 degrees, 0..=1_800_000_000. `None` ⇒ classic ±180.
pub struct FoldMagnitude(u32);

// on LineSegment:
pub fold_magnitude: Option<FoldMagnitude>,
```

Why this is the right long-term shape:

- **Illegal states are unrepresentable.** There is no way to write a mountain
  with a positive angle, so there is no sign invariant to maintain. (One
  normalisation does exist, but it is about canonical form, not legality:
  setting 180° stores `None`.)
- **Every existing colour operation stays correct with zero edits.** MV-flip
  (`change_mv`) swaps Red1↔Blue2 and leaves magnitude alone, which negates ρ —
  exactly right. Selection, palette, rendering, `.cp`/`.ori` codes: untouched.
- **`None` is the canonical 180°.** It round-trips Oriedita files bit-identically
  and routes to the Oriedita check path. Setting 180° in the editor, or importing
  a FOLD that says 180, normalises *to* `None` — so `Some(FULL)` is unreachable
  in practice and the distinction never reaches the user model. See the Editing
  UX section; exposing "180° vs classic" would be a distinction without a
  difference.
- **Unsigned magnitude preserves `Eq`.** `LineSegment` derives `Eq`, and `f64`
  is not `Eq`; a `u32` newtype keeps the derive, gives exact equality for undo
  and dedup, and dodges float formatting in serialisers.
- **Storage resolution is a format commitment, not a tuning knob.** 1e-7° so
  that quantisation composing around a high-degree vertex still clears CAMV's
  1e-6° bar. See A3.

Normalisation rule, enforced in exactly one place (the colour setter): magnitude
is cleared whenever a segment leaves `{Red1, Blue2}`. Turning a crease into an
edge or aux line and back yields a classic crease. Lossy, and semantically right.

### 2. One semantic accessor

`crates/oristudio-cp/src/model/mod.rs:510` already has the right function shape;
it just needs the magnitude. Generalise it and make it the *only* sanctioned way
to ask "what is this crease doing":

```rust
pub fn crease_fold_angle(segment: &LineSegment) -> Option<f64>  // signed degrees
pub fn is_classic_crease(segment: &LineSegment) -> bool          // None or |180|
```

New code must not match on `LineColor` to decide fold semantics. Existing code
migrates opportunistically, oracle-verified, one operation at a time — no
big-bang refactor. This is the whole point of the direction×magnitude split: the
migration is optional because the old sites are still *correct*, just incomplete.

### 3. Checks: new module, regime dispatch, and a topology seam

`crates/oristudio-cp/src/checks.rs` is 1577 lines of faithful Oriedita port with
oracle tests (`oriedita_operations_oracle.rs`, `check_diagnostics.rs`). **Do not
generalise it in place.** It stays byte-identical and remains the authority for
flat patterns.

Add `crates/oristudio-cp/src/checks_spatial.rs`:

- `vertex_closure_residual(fan) -> f64` — quaternion product per `quaternions.pdf`
  eq. 13/14, returned as the angle from the **identity quaternion** in radians
  over `[0, 2π]`. Signed `w`, never `2*acos(|w|)` — see A0.
- `vertex_dof(fan) -> usize` — **rank of the closure Jacobian, not `n - 3`.**
  See risk R5; the naive count is wrong on degenerate vertices, which are
  everywhere in real patterns.

Dispatch rule, and this is what keeps the port honest — **per vertex, not per
document**:

> A vertex whose incident folding creases are *all* classic runs the Oriedita
> check path unchanged. A vertex touching any non-classic crease runs the
> spatial path.

Document-level dispatch was the first draft and it is wrong: it would throw away
little-big-little and the Fushimi diagnostics across the *entire* document the
moment one crease became non-flat. Mixed designs — a box with flat-folded flaps —
are the expected case, not an edge case, and the flat regions genuinely have
richer diagnostics available. `find_flat_foldability_violation` already operates
on "one point and its incident lines", so per-vertex dispatch needs no
restructuring of the port.

Consequences to surface in the UI, because they are counter-intuitive:

- 2D Kawasaki stops being an error and becomes "not flat-foldable".
- Odd-degree vertices become legal — **except degree 3**, which is rigid
  (spherical triangle, SSS-determined, so all three angles are forced to 0).
  Also degree 1. The message must be "this vertex cannot fold at all", not
  "these angles conflict".

**Keeping the tolerance revisable.** The checker returns a **residual**, never a
verdict. `vertex_closure_residual` yields radians; nothing in the kernel compares
it to a threshold. The threshold is applied once, late, at the presentation
layer.

This matters because it is cheap now and expensive later. Today's CAMV bakes the
opposite choice in — `FlatFoldabilityViolation` is a verdict type, so its
threshold is spread across every consumer. If the spatial check copies that
shape, revising the tolerance means auditing every caller; if it returns
residuals, revising it is one constant.

The bar starts at **1e-6 deg**, the same one CAMV already uses (see A3). It is
deliberately strict: relaxing later is reversible, tightening later would
invalidate documents users already consider valid. Returning residuals is what
keeps that relaxation a one-constant change if it is ever needed.

Genuinely committed now: `FoldMagnitude`'s storage resolution, because it is
serialised into `.osf`, the compact transport, and the wasm bridge. Quantisation
composes around a vertex (a degree-`n` fan accumulates ~`n` half-ULPs), so the
storage unit is a hard floor on any future tolerance. 1e-6 deg units would floor
a degree-4 vertex at 2e-6 deg — coarser than CAMV's own bar — so the store uses
**1e-7 deg**, which still fits `u32` with 2.39x headroom and costs nothing.
`storage_resolution_is_a_deliberate_format_commitment` asserts the reasoning.

**Topology seam.** The check needs, per interior vertex, creases sorted by θ with
their angles. Today the only such machinery is Oriedita's epsilon-clustered
segment soup (`point_line_map`, `vertex_sorting_box`). `oristudio-cp-compiler`
has a real planar arrangement (`arrangement_v2::ArrangementVertex`) — but the
dependency runs compiler → cp, so the editor cannot reuse it without inverting
or extracting, and pulling the compiler into the editor's wasm would bloat that
bundle badly.

Decision: define a narrow `VertexFan` type (position + creases sorted by θ +
their fold angles) in `oristudio-cp`, populate it from the existing
`point_line_map`, and let the closure check consume **only** that. Swapping the
topology source later becomes a one-file change. Spike A measures whether the
existing extraction is good enough to keep.

### 4. Simulator: no changes expected

`packages/origami-simulator/src/prepare.ts:497` already reads `edges_foldAngle`
verbatim into `targetAngle`, and `model.ts:50` scales it by fold percent. The
only gate is that assignment must be `M`/`V`/`F`, which our sign convention
satisfies. The single lossy step is `crates/oristudio-cp/src/io/fold.rs:147`,
which flattens colour → ±180 on export. Spike B proves this end-to-end before we
write any Rust.

Two consequences of fold-percent semantics, worth documenting rather than fixing:

- `foldPercent` stops doubling as an absolute angle readout (50% no longer means
  90° for every crease). Relabel as progress; put real angles in the inspector.
- `clampFoldPercent` is `[0, 100]`, so a 90° crease can never be driven past 90°
  by the slider. Correct for viewing a designed model; leave it.
- Intermediate states (`t < 1`) are not rigid-folded states — closure is
  nonlinear. **The checker runs on designed angles, never on live solver state.**

### 5. Folded form and export

The 2D folded view (`crates/oristudio-cp/src/folding/`) computes flat states with
layer ordering and has no meaning for non-flat creases. Gate it: when any crease
is non-classic, offer "This pattern isn't flat-foldable — simulate instead?" and
open the simulator. The trigger is the cheap syntactic `is_classic_crease` scan,
so **this ships without any of the check work**.

Export gating rides on the existing registry at `apps/web/src/lib/supersetFeatures.ts`
("adding the next superset feature is a one-line addition here"). One deviation
from the existing entries: `.fold` is *not* lossy for this feature, so its
`droppedByFormats` must exclude `fold`. And unlike images/rich-text, presence is
sourced from kernel geometry rather than frontend state, so `SupersetPresence`
grows a field populated from the compact transport.

Per the discussion, `.cp` export is **disabled**, not warned, when any crease is
non-classic — gate on `angle ∉ {-180, +180}`, so an explicit `Some(180°)` still
exports fine as a mountain/valley.

### 6. Divergence budget

Stated explicitly so review can hold us to it:

| Surface | Divergence |
| --- | --- |
| `LineColor`, its wire codes, `.cp`/`.ori`/`.orh` codecs | **none** |
| `checks.rs` and every Oriedita operation | **none** |
| `LineSegment` | one additive optional field |
| Semantic accessor layer | new, additive, Ori-Studio-native |
| `checks_spatial.rs` | new, additive |
| Folded-form entry | new gate only |

## Editing UX (Phase 3 in detail)

### What the workflow actually is

The user folds a model by hand, then draws the crease pattern for it. They
already know the angles. Two things follow, and they set the whole design:

1. **Angles come in small vocabularies.** A box is 90 deg everywhere. A prism is
   60/120. A non-flat design typically uses two or three distinct angles across
   hundreds of creases. So per-crease numeric entry is the *wrong* primary
   interaction — it is a hundred interactions to express one fact.
2. **Drawing must not get slower.** A/S/D/F on the left home row with the mouse
   in the right hand is most of why the CP editor feels good. Anything that adds
   a step per crease is a regression, even if the feature is opt-in.

### The core move: an active fold angle

`activeLineColor` already exists — the editor has a "what am I drawing right
now" concept, surfaced in `CpContextToolPanel`'s Line type group. Add
`activeFoldMagnitude` beside it, and new folding creases inherit it.

That makes non-flat drawing exactly as fast as flat drawing: set 90 deg once,
then draw the whole box with the existing keys and gestures. Zero added
interactions per crease. Everything else in this section is secondary to it.

**The hazard this creates, and the mitigation.** An active non-180 angle
silently changes what you draw. Leave it at 90 by accident and every subsequent
crease is wrong, with no error — the pattern is perfectly valid, just not what
you meant. So the active angle must be *loud*:

- The readout reads `Mountain 90 deg`, never just `Mountain`.
- The in-progress line preview renders in the ramped colour, so the canvas shows
  it before you commit.
- Returning to classic is one action, not "type 180".

### The workhorse: assign to a selection

Draw everything classic first, then select and assign. This is how transcription
actually goes, because you learn the angles by folding, not while drawing.

Lives on `CpSelectionToolbar` (the existing floating surface for selection verbs)
and in the context menu. Mixed selections show `Mixed` and can be set wholesale.
Multi-select assign is what makes a 400-crease box a two-gesture job.

### Snap palette

`180, 135, 120, 90, 60, 45` as quick-pick chips, plus free numeric entry.
90 covers orthogonal work, 60/120 triangular and hex, 45/135 the 22.5 family,
180 back to classic. Between them that is nearly every transcription case, and
it removes the typing from the common path.

### Inspector: type + magnitude, not a signed field

Mirror the storage model. Show the **M/V type** and a **magnitude 0..180**, not a
signed -180..180 field:

- The sign is already visible as the line colour; a signed field duplicates it
  and invites a contradictory state in the UI that the model forbids.
- Typing `-90` for a mountain is awkward and easy to get backwards.

Show the signed FOLD value as a secondary readout for people who think in
`edges_foldAngle`.

### Normalise 180 to classic on write. NEW — simplifies the model.

The representation keeps `None` (classic) distinct from `Some(FULL)`. Thinking
through the UI, exposing that distinction would be actively bad: `180 deg` and
`classic` would look identical, behave identically, and differ only in a
serialisation detail nobody can see.

So: **setting 180 deg stores `None`.** `Some(FULL)` becomes unreachable from the
editor, and a FOLD import carrying an explicit 180 normalises the same way.

This keeps every property the distinction was protecting — untouched Oriedita
documents still round-trip byte-identically, `.cp` export still works, the
Oriedita check path is still selected — while removing the concept from the user
model entirely. `None` simply *is* 180.

### Decisions on the awkward cases

| case | behaviour |
| --- | --- |
| Angle control on an edge/aux line | Disabled, not a silent no-op. The magnitude-clearing rule already covers the model side |
| Magnitude 0 | Allowed — it is a real state (a crease you have decided is flat, FOLD's `F`). Render distinctly and offer "convert to auxiliary" as a nudge; do not block it |
| MV flip on an angled crease | 90 deg mountain becomes 90 deg valley. Falls out of the architecture with no code, and is what users expect |
| Slider drag | Coalesce into one undo entry on release, not one per frame |
| Setting an angle on a mixed selection | Applies to folding creases only; edges and aux in the selection are skipped, and the toolbar says how many were affected |

### Keyboard

One chord, registered in `apps/web/src/keyboard/` — never a panel listener. It
opens angle entry for the selection, or sets the active angle when nothing is
selected. Then: type a value, Enter commits, Escape cancels and reverts, matching
the measure tool's Escape behaviour.

`Shift+A` is the proposal — `A` is already Mountain, so the chord reads as
"angle, in the fold-type family" and keeps the mnemonic near the keys it
modifies. It must go through `findShortcutConflict` before landing: duplicate
chords in this registry fail *silently*, which has bitten before.

A/S/D/F, Ctrl-toggle, and every existing gesture keep their current behaviour.

### Discoverability

The failure mode is shipping a whole feature behind an inspector field nobody
opens. Three things carry it:

- The active-angle readout sits inside the Line type group users already watch.
- The selection toolbar surfaces the angle control whenever folding creases are
  selected — it appears in the flow of work rather than waiting to be found.
- Non-classic creases render differently (ramp + badge), so opening someone
  else's non-flat CP shows immediately that something new is going on.

### Explicitly not in Phase 3

- Drag-a-dial on canvas — superseded by inline simulation, and numeric entry
  suits transcription better anyway.
- Solver-assisted entry and branch picking (Phase 7).
- Propagation along a crease chain — the `X` "change MV in a line" analogue.
  Multi-select covers it; revisit only if selection proves clumsy in practice.

## Phase 0 findings (spikes complete)

All four spikes ran. Two changed the design; two confirmed it cheaply.

### A0 — the residual must be measured from the identity QUATERNION

The single most important finding, and the easiest bug to reintroduce.

Given a closed vertex, the natural residual is "how far is the composed rotation
from identity", and the reflexive way to write that for quaternions is
`2*acos(|w|)` — taking `|w|` because quaternions double-cover SO(3) and `q`/`-q`
are the same rotation. **That is wrong here, and it fails silently.**

Measured directly:

| vertex | q |
| --- | --- |
| deg-4 square VVVM (Maekawa satisfied) | `+1` |
| deg-4 square VVVV (Maekawa violated) | `-1` |
| deg-2 collinear V/V | `+1` |
| deg-2 collinear V/M | `-1` |

Both `+1` and `-1` are the identity *rotation*. At rho = +/-180 a mountain and a
valley are the same half-turn in SO(3), and the M/V distinction survives **only
in the quaternion lift**. So `|w|` reports every Maekawa-violating vertex as a
perfect zero. Measuring from `+1` is precisely what makes closure subsume
Maekawa — this is why `quaternions.pdf` eq. 14 writes `[1,0,0,0]` and not `+/-1`.

Use `residual = 2*atan2(||vec||, w)` with **signed** `w`, over `[0, 2*pi]`.
`q = -1` must come out at 2*pi (maximally far), never 0.

Same trap in the solver: `vec = 0` admits both lifts, so a Newton solve must
also require `w > 0` or it happily converges to the Maekawa-violating branch.

Self-test: 15/15 cases pass, including rigidity of degree-2-non-collinear and
degree-3. A Newton solve on a non-singular Kawasaki degree-4 vertex reproduces
`quaternions.pdf` §3 exactly (rho1 = +/-rho3, rho2 = -/+rho4), and both branches
are reachable. The square vertex is unusable as a test case — delta12 = 90 deg
is the documented singularity in footnote 1, where the angles decouple.

### A1 — tolerance, measured over 563 real crease patterns

Corpus: `artifacts/cp-detect-correctness/packs/native-cp-v1` (563 scraped CPs
with ground-truth planar graphs), 124,217 fully-determined interior vertices.

| tolerance | accepted | delta |
| --- | --- | --- |
| 1e-9 deg | 57.51% | |
| 1e-6 deg | 58.31% | +0.8pt |
| 1e-5 deg | 67.89% | +9.6pt |
| 1e-4 deg | 87.34% | +19.5pt |
| 1e-3 deg | 88.45% | +1.1pt |
| 1e-2 deg | 88.48% | +0.03pt |
| 1.0 deg | 88.50% | +0.02pt |
| 10.0 deg | 88.50% | +0.00pt |

The distribution is sharply bimodal: a mode at machine epsilon, a
coordinate-imprecision band from 1e-6 to 1e-4, then a dead-flat plateau from
1e-3 all the way to 10 deg, then the failure mode at 360 deg.

This table describes the *corpus*, not our bar. It is the evidence that imported
CPs are genuinely inaccurate — 1e-3 deg is what it would cost to accept them as
they are. We are not going to do that; see A3 for the decision.

**At the chosen 1e-6 deg bar, 41.7% of vertices in real scraped CPs fail.** That
is the intended, accepted outcome, not a trap: it is the same phenomenon as the
TreeMaker-CPs-fail-CAMV work, and those CPs fail CAMV in Oriedita today for the
same reason. Real CP coordinate precision lives around 1e-5 to 1e-4 degrees,
which is simply below the bar. See R17 for the presentation consequence.

Implementation validated by parity: odd-degree vertices close at **0.0%**
(0/135 degree-3, 0/53 degree-5), exactly as Maekawa parity demands.

### A1b — `U` (unassigned) needs an explicit policy. NEW.

The corpus carries 13,817 `U` edges. Mapping `U -> rho = 0` (the obvious
reading of "no fold") does two bad things: it fabricates an answer for something
unknown, and it drops the crease out of the fan, so odd-degree vertices
spuriously "close". Before excluding them, degree-3 closed at 56%; after, 0%.

`F` genuinely means rho = 0 and is correct to include. `U` must make the vertex
**indeterminate** — report neither a pass nor a violation.

### A3 — how accurate is geometry Ori Studio produces itself?

The A1 number came from scraped CPs and absorbs *their* coordinate imprecision.
Geometry Ori Studio produces itself is a completely different population.
Measured on the same degree-4 vertex:

| source | residual | note |
| --- | --- | --- |
| Grid snap (exact integers) | **2.0e-14 deg** | |
| 22.5 deg radial snap (f64 trig) | **2.1e-14 deg** | identical from radius 0.1 to 400 — `atan2` is scale-free, so crease length is irrelevant |
| Imported / scraped (A1, p88) | **~1e-3 deg** | |
| Free-hand drag, 0.05 units, 100-unit crease | **0.18 deg** | |
| Free-hand drag, 0.05 units, 10-unit crease | **1.8 deg** | |

**Snapped construction is exact for our purposes.** ~2e-14 deg is eleven orders
of magnitude inside 1e-3, and trig-derived 22.5 deg geometry is just as clean as
integer grid snap.

**Free-hand dragging is 3-5 orders of magnitude _worse_ than the imported
corpus**, and it is not even a constant — the residual scales as
`drag_error / crease_length`, so the same mouse slip costs 10x more on a short
crease. 0.05 units is Oriedita's own `fix_inaccurate` default precision, so this
is the expected magnitude, not a pathological case.

### Decision: one bar, 1e-6 degrees, matching CAMV

A per-provenance threshold was considered and **rejected**. Three reasons:

1. **Relaxing later is reversible; tightening later is a breaking change.**
   Documents that were valid becoming invalid is far worse than the reverse, so
   strict is the safe starting direction.
2. **Imported CPs already fail CAMV today**, in Oriedita and in Ori Studio, for
   exactly this reason. A looser import bar would invent an inconsistency that
   does not currently exist, and would hide real inaccuracy behind a threshold.
3. **Provenance is not durable.** Import a CP, edit it, and it is neither
   imported nor native. The distinction rots the moment it is useful.

So the spatial check uses **1e-6 degrees — the same bar CAMV already uses.**
Nothing new to justify, and native construction clears it by eight orders of
magnitude.

What that implies, stated plainly: roughly 42% of vertices in real scraped CPs
will fail. That is the status quo, not a regression, and the remedy already
exists (`fix_inaccurate`, and potentially exactize on import). The check becomes
a *reason* to run those tools rather than something that quietly tolerates
sloppy geometry.

Storage quantisation is the only thing that could make the bar unreachable, and
it does not, except adversarially at very high degree:

| fan degree | worst case (n/2 ULP) | typical (sqrt(n)/2 ULP) |
| --- | --- | --- |
| 4 | 2.0e-7 | 1.0e-7 |
| 16 | 8.0e-7 | 2.0e-7 |
| 24 | 1.2e-6 (over) | 2.5e-7 |
| 30 | 1.5e-6 (over) | 2.7e-7 |

Only reachable if every crease's quantisation error aligns, and only for
*explicitly-angled* creases — classic creases carry exact +/-180 from colour with
zero quantisation, so the entire existing flat-CP world is unaffected. Degree >=24
vertices were 5 of 124,217 in the corpus. If one ever shows a marginal failure,
the principled fix is a degree-aware floor (`base + n * half_ulp`), not a looser
base. Do not build that until something actually fails.

This is also why the 1e-7 deg storage decision mattered: at micro-degree units a
degree-4 vertex would floor at 2e-6 deg, and a 1e-6 deg bar would have been
unreachable by construction.

### A2 — topology source: keep `point_line_map`, but gate on determinacy

`point_line_map` clusters segment **endpoints** at eps 1e-4.

| input | extracted degree | residual |
| --- | --- | --- |
| degree-4 vertex, segments split at the vertex | 4 (correct) | 1.985e-14 deg |
| same geometry, one unbroken through-segment | **2 (wrong)** | **360 deg** |

Exact for graph-shaped input, which covers FOLD and any properly split CP. But
an unsplit T-junction silently loses the two through-rays — and the failure mode
is a **false positive that is indistinguishable from a Maekawa violation**.

Decision: **keep `point_line_map`** behind the `VertexFan` seam; do not build an
arrangement yet. Oriedita's existing `check2` ("near-T intersection pairs")
already detects exactly this condition, so gate on it.

Both A1b and A2 point at the same missing concept: `VertexFan` needs a
**determinacy** state, and there are two ways to be indeterminate — an incident
`U` crease, or an unsplit T-junction. Neither may be reported as a violation. A
naive implementation emits false Maekawa failures for both.

### B — the simulator needs no work, confirmed

`edges_foldAngle` reaches `CreaseParameter.targetAngle` verbatim, and the solver
relaxes to it:

| target | measured | target | measured |
| --- | --- | --- | --- |
| -180 | -179.99973 | 45 | 44.99990 |
| -135 | -134.99979 | 90 | 89.99981 |
| -90 | -89.99981 | 135 | 134.99979 |
| -45 | -44.99990 | 180 | 179.99973 |

Accurate to ~3e-4 deg across the whole range, with **zero code changes**.
`packages/origami-simulator/tests/spikeFoldAngle.test.ts` graduates into the
Phase 2 acceptance test.

### C — transport cost is a non-issue

52,000 segments, compact codec:

- baseline **51 bytes/segment**, 2.65 MB total (32 endpoints + 16 attr + 3 colour)
- with a `u32` magnitude array: +4 bytes/segment, 2.86 MB, **+7.84%**
- classic document with the array omitted: **+4 bytes total (+0.0002%)**
- full round trip (encode + to_bytes + from_bytes + decode): **1.39 ms**

R3 downgraded. Also worth separating: the WKWebView OOM on the 47 MB `.osf` is
the JSON path, an order of magnitude larger than the 2.65 MB compact payload.
The memory risk lives in the `.osf` schema v5 work, not in the compact array.

### D — blast radius is two lines

Adding `Option<FoldMagnitude>` to `LineSegment` produced **two** compile errors
across the entire workspace, both in `geometry_transport.rs`. The `..*self`
functional-update builders absorb everything else, and `FoldMagnitude` being
`Copy` keeps them working.

- `cargo test --workspace`: **1031 passed, 0 failed**
- `cargo clippy --workspace --all-targets -- -D warnings`: clean
- `cargo fmt --check`: clean
- Legacy JSON without the field round-trips **byte-identically** (asserted
  directly, not inferred from the oracle suite passing)

R1 and R2 are both resolved as designed. Phase 1's representation work is
effectively started and green.

## Affected Areas

**Rust kernel**
- `crates/oristudio-cp/src/geometry/line_segment.rs` — the new field, `Eq` derive
- `crates/oristudio-cp/src/model/mod.rs` — semantic accessors; `fold_angle_for_line_color`
- `crates/oristudio-cp/src/geometry_transport.rs` — new per-segment array, `OCG1` → `OCG2`
- `crates/oristudio-cp/src/io/fold.rs` — the lossy line at :147, both directions
- `crates/oristudio-cp/src/io/cp.rs`, `ori.rs`, `orh.rs` — export gating only
- `crates/oristudio-cp/src/checks_spatial.rs` — **new**
- `crates/oristudio-cp/src/lib.rs` — `OperationId::CreaseSetFoldAngle` (follows
  the `CreaseSetLineColor` / `"OriStudioSetLineColor"` precedent for native ops)
- `crates/oristudio-cp/src/operations/construction.rs` — `FlatFoldableVertexCandidates`
  is what §4 generalises (phase 7)
- `crates/oristudio-cp-wasm/src/lib.rs` — bridge + compact codec, **plus the
  committed `.wasm` rebuild**

**Web**
- `apps/web/src/engine/oristudioCpTypes.ts`, `oristudioCpGeometry.ts` — transport types
- `apps/web/src/lib/nativeProjectFile.ts` — `.osf` schema v4 → v5
- `apps/web/src/lib/supersetFeatures.ts` — registry entry
- `apps/web/src/cp-workspace/renderer/programs/strokeProgram.ts` — colours are
  already resolved CPU-side into a per-instance `aColor` buffer, so the lightness
  ramp is a colour-resolution change, **not a shader change**
- `apps/web/src/cp-workspace/` — inspector, selection toolbar, angle overlay
- `apps/web/src/keyboard/` — any shortcut goes in the registry, never a panel listener
- `apps/web/src/cp-workspace/folded/` — the not-flat-foldable dialog
- `apps/web/public/locales/*` — new strings, subject to the `i18n:check` gate

**Tests**
- `crates/oristudio-cp/tests/oriedita_*_oracle.rs` — must stay green untouched
- `crates/oracle-tests/` — parity
- `packages/origami-simulator/tests/prepare.test.ts`

## De-risking spikes

Run all four **before** committing to the architecture. Together they cost maybe
a day and test every load-bearing claim in this plan.

**Spike A — closure residual against known-good data (highest value).**
Compute the quaternion closure residual at every interior vertex of the existing
flat fixture corpus, taking ρ = ±180 from colour. Flat-foldable vertices must
come out near zero. This validates the math *and* the epsilon-clustered topology
extraction *and* produces the residual distribution we need to pick a tolerance —
all against ground truth, before any architecture is committed. If residuals are
noisy, that is the signal to invest in a real arrangement (§3) rather than
discovering it late.

**Spike B — end-to-end angles with zero Rust.** Hand-write a `.fold` file with
non-180 `edges_foldAngle`, load it, simulate. Proves or kills the "simulator is
already done" claim in minutes. If it fails, the whole plan reshapes.

**Spike C — transport cost.** Add a throwaway per-segment array and measure size
and latency on the 52k-edge `perf_harder.osf`. Desktop is already at the memory
edge on large documents (WKWebView OOM on that file), so a +4 bytes/segment
regression needs a number, not a guess.

**Spike D — oracle blast radius.** Add the field to `LineSegment` with
`#[serde(default, skip_serializing_if = "Option::is_none")]` and run the full
oracle suite. Measures actual breakage rather than predicted breakage.

## Non-goals

Named so they don't creep in:

- Global rigid-foldability solving, or maintaining global consistency during
  editing. Local vertex closure is sufficient for a consistent folded state on a
  simply-connected sheet; the simulator arbitrates realisability. This is the
  same division of labour as CAMV-vs-`G`.
- Layer ordering or self-intersection for non-flat states.
- Curved creases.
- Changing `foldPercent`'s clamp or scaling semantics.
- Non-developable (cone) vertices.

## Checklist

### Phase 0 — De-risking (COMPLETE)
- [x] Spike A0: closure math self-test, 15/15 — found the `|w|` / Maekawa trap
- [x] Spike A1: residual distribution over 563 real CPs (124,217 vertices)
- [x] Spike A1b: `U` policy — unassigned must be indeterminate, not rho = 0
- [x] Spike A2: topology source — keep `point_line_map`, gate on determinacy
- [x] Spike B: non-180 `.fold` → simulator, ~3e-4 deg accurate, no code changes
- [x] Spike C: transport cost — +7.84% worst case, +0.0002% for classic documents
- [x] Spike D: `LineSegment` field — 2 compile sites, 1031 tests green, fmt/clippy clean
- [x] Spike A3: native construction measured at 2e-14 deg (snapped and 22.5 deg
      radial alike); free-hand drag at 0.18-1.8 deg
- [x] **Tolerance decided: one bar at 1e-6 deg, matching CAMV.** Per-provenance
      thresholds rejected — relaxing is reversible, tightening is breaking
- [x] Storage resolution raised to 1e-7 deg (format commitment; 1e-6 would floor
      a degree-4 vertex above CAMV's own bar)

### Phase 1 — Representation and storage
- [x] `FoldMagnitude` newtype; `Option<FoldMagnitude>` on `LineSegment` (Spike D)
- [x] Legacy-JSON byte-identical round-trip test (R2)
- [ ] `crease_fold_angle` / `is_classic_crease` accessors + unit tests
- [ ] Magnitude-clearing rule in the colour setter, with tests for `advance_folding`
      and make-edge/make-aux
- [ ] Compact transport array + `OCG1` → `OCG2`, both codecs
- [x] **`.osf` needs no schema change.** It stores `OristudioCpDocumentSnapshot`
      verbatim, so the magnitude rides inside the kernel snapshot via serde. No
      v6, and the `claude/persist-inline-simulations` v5 collision evaporates
- [x] `document_snapshot_round_trips_fold_magnitudes` pins that, including the
      assertion that a classic crease leaks no key into the snapshot
- [x] `minimumReaderSchemaVersion` stays `1` — deliberate, not an oversight. Web
      has no version skew, so there is no older reader to protect against.
      Gate on it only once desktop ships (pinned builds, no auto-update)
- [ ] wasm bridge + **committed `.wasm` rebuild**
- [ ] Oracle suite green with no fixture edits

### Phase 2 — FOLD I/O and simulator
- [ ] `io/fold.rs` reads and writes real angles, both directions
- [ ] Round-trip tests including non-180 values
- [ ] Simulator end-to-end from an imported `.fold`
- [ ] Confirm `F`/zero-angle mapping is right

### Phase 3 — Editing (the core workflow)

See **Editing UX** above for the reasoning behind each item.

*Active angle — DEFERRED, see below*
- [ ] `activeFoldMagnitude` store state beside `activeLineColor`
- [ ] New folding creases inherit it; edges and aux never do
- [ ] Readout in the `CpContextToolPanel` Line type group reads `Mountain 90°`,
      never bare `Mountain`
- [ ] In-progress line preview renders in the ramped colour
- [ ] One-action return to classic

> **Deferred after looking at the draw path.** `active_line_color` has 51 call
> sites across the ported draw operations, and threading a magnitude beside it is
> a medium refactor of the port surface.
>
> The cheap alternative — apply the active magnitude to segments appended by a
> draw command — is **unsafe**, and it took reading `divide_line_segment_with_new_lines`
> to see why: drawing across an existing crease *splits* it, and the split pieces
> are appended too. They correctly inherit the original's magnitude via
> `with_coordinates`, but a piece of a *classic* crease has `None` and would be
> indistinguishable from a newly drawn one. Drawing a 90° crease over a classic
> mountain would silently turn that mountain's two halves into 90°.
>
> Nothing about the merge criteria needs this: without it a user draws classic
> and then assigns, which is the workhorse path and is already shipped. It buys
> clicks, not correctness. Revisit as its own change, where the draw-path
> refactor can be reviewed on its own merits.

*Splitting*
- [x] Splitting a crease carries the fold angle into both halves, and a classic
      crease's pieces stay classic (`splitting_a_crease_preserves_its_fold_angle`)

*Assign to selection — the transcription workhorse*
- [ ] `OperationId::CreaseSetFoldAngle` with payload, undo/redo
- [ ] Angle control on `CpSelectionToolbar` + context menu
- [ ] Mixed-selection state; applies to folding creases only, reports how many
      were affected
- [ ] Slider drag coalesces to one undo entry on release

*Entry surfaces*
- [ ] Snap palette chips (180/135/120/90/60/45) + free numeric entry
- [ ] Inspector shows M/V type + magnitude 0–180, with the signed FOLD value as a
      secondary readout — not a signed input
- [ ] Angle control disabled (not silently ignored) on edge/aux lines
- [ ] Magnitude 0 allowed, rendered distinctly, with a "convert to auxiliary" nudge

*Model rule*
- [ ] Setting 180° normalises to `None`; FOLD import normalises an explicit 180
      the same way, so `Some(FULL)` is unreachable and the distinction never
      reaches the user
- [ ] Test: a document round-trips byte-identically after setting 180° on a crease

*Keyboard*
- [ ] One chord registered in `apps/web/src/keyboard/` (proposal: `Shift+A`),
      never a panel listener
- [ ] Verified against `findShortcutConflict` — duplicate chords fail silently
- [ ] Type-value / Enter commits / Escape reverts
- [ ] A/S/D/F and Ctrl-toggle behaviour unchanged, asserted by test

*Architecture check*
- [ ] Verify MV-flip negates the angle with no code change (the architecture's
      main falsifiable prediction)

### Phase 4 — Rendering
- [x] Lightness ramp in colour resolution, floored so it can't read as dimmed
- [x] Classic creases return their ink **by identity**, so a classic pattern is
      untouched; parity gate extended to the ramp, with a non-vacuity assertion
- [x] Midpoint badge for non-classic creases, degrading number → dot → nothing
      by available on-screen room, capped at `MAX_BADGES` (longest creases win)
- [ ] "Fold angles" overlay mode, sibling to the CAMV overlay

> **The ramp alone was not enough**, which only became clear on real geometry.
> At 90° the wash is 27.5% toward the canvas on a 1px stroke, and lightness is a
> weak channel on hairlines — worse in dark theme, where washing red toward a
> dark canvas mostly just darkens it, and with no adjacent 180° crease to compare
> against. The midpoint badge is now the primary signal: it is the only option
> that says *which* angle rather than merely "this one differs", and its dot form
> at low zoom is the same badge degraded, not a separate affordance. The ramp
> stays as reinforcement.

### Phase 5 — Export and folded-form gating
- [ ] `supersetFeatures` entry, with `fold` excluded from `droppedByFormats`
- [ ] `SupersetPresence` sourced from kernel geometry
- [ ] `.cp`/`.ori`/`.orh`/`.dxf`/`.obj` disabled on non-classic creases
- [ ] "Not flat-foldable — simulate instead?" dialog on the folded-form entry
- [ ] i18n extraction; `i18n:check` green

### Phase 6 — Generalised checks
- [ ] `VertexFan` extraction, carrying a **determinacy** state
- [ ] Indeterminate when any incident crease is `U`, or when `check2` flags an
      unsplit T-junction at the vertex — report neither pass nor violation
- [ ] `vertex_closure_residual` (quaternions.pdf eq. 13/14), measured from the
      identity **quaternion** with signed `w` — never `2*acos(|w|)`, see A0
- [ ] Regression test asserting a Maekawa-violating vertex reports 360 deg, not 0
- [ ] `vertex_dof` via Jacobian rank
- [ ] Checker returns residuals, never verdicts; the threshold is applied once at
      the presentation layer so the tolerance stays a one-constant change
- [ ] Regime dispatch; Oriedita path provably unchanged for classic documents
- [ ] Degree-1/3 rigidity reported as rigidity, not inconsistency
- [ ] Violation rendering; reuse the deferred CAMV scheduling
- [ ] Perf check on the large fixture

### Phase 7 — Solvers (separate follow-up, not this branch)
- [ ] §5 three-unknown solver, both roots surfaced as a branch choice
- [ ] Degree-4 "set one, solve three"
- [ ] §4 unknown-crease insertion, generalising `FlatFoldableVertexCandidates`
- [ ] Offer §4 as the one-click fix for a rigid or non-closing vertex
- [ ] Explicit propagate-from-selection (never automatic)

### Phase 8 — Spherical simplicity and multiply-connected patterns (separate follow-up)
- [ ] Spherical simplicity (generalised big-little-big / local self-intersection)
- [ ] Loop checks for non-simply-connected patterns

## Risks and mitigations

| # | Risk | Likelihood / impact | Mitigation |
| --- | --- | --- | --- |
| R1 | ~~`LineSegment: Eq` breaks~~ | **RESOLVED** | `u32` fixed-point newtype at 1e-7 deg; workspace builds, `Eq` derive intact |
| R2 | ~~Adding a field perturbs oracle fixture serialisation~~ | **RESOLVED** | `#[serde(default, skip_serializing_if)]`; 1031 tests green, byte-identical legacy round-trip asserted |
| R3 | ~~Compact transport regresses the desktop large-CP path~~ | **DOWNGRADED** | Measured +0.0002% for classic docs, +7.84% worst case, 1.39ms round trip at 52k segments. Residual memory risk is the `.osf` JSON path, not this |
| R15 | **NEW.** False Maekawa violations from indeterminate vertices. An unsplit T-junction (A2) and an incident `U` crease (A1b) both produce a 360 deg residual identical to a real parity failure | High / high | `VertexFan` carries a determinacy state; both cases report "cannot evaluate", never a violation. Gate on the existing `check2` |
| R16 | **NEW.** Reintroducing `2*acos(\|w\|)` for the residual. It is the reflexive way to write a rotation residual and it silently accepts every Maekawa violation | Medium / high | Regression test asserting a Maekawa-violating vertex reports 360 deg; the rationale is documented at the call site. The Newton solver needs the matching `w > 0` branch guard |
| R4 | Kernel change doesn't reach app or CI because the committed `.wasm` wasn't rebuilt | High / high | Explicit checklist item in Phase 1; it has bitten before |
| R5 | `n - 3` DOF is wrong on degenerate vertices (collinear degree-2 is ubiquitous — any point splitting a straight crease) | High / high | Jacobian rank, never the degree count. Fixture test with a mid-crease vertex |
| R6 | ~~Residual tolerance repeats the CAMV/exactize trap~~ | **RESOLVED** | One bar at **1e-6 deg**, same as CAMV. Native construction clears it by 8 orders of magnitude (measured 2e-14); imported CPs fail it, which is the status quo, not a regression |
| R17 | **NEW.** A strict bar means importing a community CP lights up ~42% of its vertices. Rendering each as a marker is a wall of red that reads as "this app is broken" | High / medium | Presentation, not threshold: summarise (`1,247 vertices exceed tolerance — run Fix Inaccurate?`) rather than marking every one. Same remedy Oriedita already offers |
| R7 | Epsilon-clustered topology makes closure residuals unreliable | **PARTLY RESOLVED** | Exact (2e-14 deg) for split segments; fails only on unsplit T-junctions, now tracked as R15. `VertexFan` seam keeps an arrangement swap a one-file change if the indeterminate rate proves high |
| R8 | Scope creep into global rigid foldability | Medium / high | Listed as a non-goal; the local-implies-global result for simply-connected sheets is the justification |
| R9 | Lightness ramp collides with existing dim/fade semantics | Medium / low | Floor the ramp; golden test that classic patterns are pixel-identical |
| R10 | ~~`.osf` v5 collides with a parallel branch~~ | **MOOT** | `.osf` needs no schema change: it stores the kernel document snapshot verbatim, so the magnitude rides inside it. No version claimed, no collision |
| R11 | Merge pain on hot files (`lib.rs` 4000+ lines, `checks.rs` 1577) | Medium / medium | New behaviour goes in new modules; `lib.rs` gets registration lines only |
| R12 | Users set angles that don't close and get no feedback until they simulate | High / medium | Phases 2–5 are honestly experimental until Phase 6 lands; sequence accordingly or label it |
| R13 | Folded-form gate misfires and regresses flat workflows | Low / high | Predicate is `None` or exactly ±180, unit-tested; classic documents take the identical path |
| R14 | Simulator "failure" is ambiguous (inconsistent design vs. coarse mesh vs. bad local minimum) | High / medium | Surface `maxStrain` (already in the frame payload) as an explicit threshold verdict; document that it is a hint, not a proof |

## Open decisions

None outstanding. Both former decisions are resolved below.

### Resolved while planning

- **Phase ordering vs. release.** Everything lands before merge; no flag, no
  experimental label. See Merge criteria. The phases are work order only.
- **Non-classic as a document mode.** No UI mode for now — it can be
  disambiguated later if it proves needed. Consequence: the active-angle hazard
  mitigations in the Editing UX section (loud `Mountain 90°` readout, ramped
  line preview, one-action return to classic) now carry that weight alone, since
  no mode indicator is backing them up. `.cp` export disabling and the
  folded-form dialog still fire at the moment of the action rather than being
  signposted in advance, which is acceptable and reversible.

- **`ρ = 0` has two encodings** (Red1+0 and Blue2+0). Keep both. It is benign,
  and it preserves the user's stated direction for when they dial the angle back
  up — normalising would silently discard intent.
- **Does the per-vertex dispatch lose Oriedita diagnostics?** No — dispatch is
  per vertex, so flat regions of a mixed design keep the full Oriedita check.
- **`.osf` version.** v6. `claude/persist-inline-simulations` already claims v5.
- **Clipboard.** `cloneCpLineSegment` and `swapMountainValleyLine` both spread,
  so magnitude survives copy/paste and MV-swap for free. No production code
  constructs a `LineSegment` literal — only tests — so nothing silently drops the
  field. Worth preserving that property rather than re-verifying it later.
- **`exactize` / the CP compiler.** Not user-facing today, so there is no path
  that could run flat-foldability exactization over a non-flat document. When
  the TreeMaker Send-to-Edit exactize work lands, it must skip or refuse
  non-classic documents — it solves *for* flat-foldability and would silently
  destroy a deliberate 3D design.
