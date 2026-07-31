# Optimizer Symmetry Constraints

## Goal

Let a user require that the Box Pleating optimizer produce a **mirror-symmetric
layout** — book symmetry (fold in half edge-to-edge) or diagonal symmetry (fold
corner-to-corner) — and have both the continuous pre-solve and the discrete
grid-fitting stage respect it.

Symmetry has no counterpart in upstream Box Pleating Studio. This is an Ori
Studio extension, so the overriding constraint is that **the non-symmetric path
must stay bit-identical to upstream**: `crates/oristudio-bp/tests/optimizer_oracle.rs`
compares our solver against the vendored WASM over 400+ cases and must keep
passing untouched. Everything below is gated on `symmetry: Option<Symmetry>`
being `Some`.

## Approach

### Terminology and the four axes

The optimizer works in a normalized unit sheet, so the only candidate axes are
the square's own symmetry axes, and they are *fixed constants* independent of
the sheet-size variable `m`:

    x = 1/2      y = 1/2      y = x      y = 1 - x

Their paper-relative meaning depends on the sheet type, because a diagonal-grid
sheet is the paper rotated 45° against the grid:

| normalized axis | rectangular sheet | diagonal sheet |
| --- | --- | --- |
| `x = 1/2`, `y = 1/2` | book              | diagonal |
| `y = x`, `y = 1 - x` | diagonal          | book     |

The UI therefore offers *book* / *diagonal* and the kernel resolves that to a
normalized axis per sheet type. The diagonal sheet needs no extra work — see
"grid origin" below.

### Stage 1 — continuous pre-solve: linear equality constraints

This follows TreeMaker 5.0.1, which solves the same problem with
`tmConditionNodesPaired` (two linear equalities per mirrored node pair:
"the joining segment is perpendicular to the axis" + "its midpoint is on the
axis") and `tmConditionNodeSymmetric` (one equality for a node on the axis).
See `third_party/treemaker-5.0.1/Source/tmModel/tmOptimizers/tmConstraintFns.cpp`
(`PairFn1A` / `PairFn1B` / `StickToLineFn`).

Because our axes are axis-aligned or at 45°, the residuals specialize to
something simpler. A flap's anchor is its **lower-left corner** and its box is
`w·m` by `h·m`, so mirroring a flap is not just mirroring its anchor — the
`w·m` / `h·m` term is what makes these affine in `m` rather than purely linear
in position:

For a pair `(i, j = σ(i))`:

| axis | residuals |
| --- | --- |
| `x = 1/2`   | `x_j + x_i + w_i·m − 1`, `y_j − y_i` |
| `y = 1/2`   | `x_j − x_i`, `y_j + y_i + h_i·m − 1` |
| `y = x`     | `x_j − y_i`, `y_j − x_i` |
| `y = 1 − x` | `x_j + y_i + h_i·m − 1`, `y_j + x_i + w_i·m − 1` |

For a flap on the axis (`σ(i) = i`), one residual each:
`2x_i + w_i·m − 1`, `2y_i + h_i·m − 1`, `x_i − y_i`, `x_i + y_i + h_i·m − 1`.

All are linear in the full variable vector, which is why SLSQP copes well.
`slsqp_rssl::Constraint::Eq` already exists in the port (it backs the grid pins),
so this is additive.

Flap-dimension compatibility must be validated up front and reported clearly,
because these are hard requirements, not preferences:

- pairs: `w_j = w_i, h_j = h_i` (book axes); `w_j = h_i, h_j = w_i` (diagonal axes)
- on-axis: `w_i` even (`x = 1/2`) / `h_i` even (`y = 1/2`); `w_i = h_i` (diagonal axes)

### Stage 1 — seeding and basin-hopping

- `symmetrize(x)` projects any starting vector onto the symmetry manifold by
  overwriting each partner with the mirror of its representative. Applying it
  before every solve makes SLSQP start feasible; the spike showed solver
  failures become rare with it and common without.
- `RandomDisplacement` should displace representatives only and mirror the
  displacement, so basin-hopping stays on the manifold instead of spending half
  of every step being pulled back onto it.
- Random/hierarchy mode needs no change to `AreaTree`: the coarse levels only
  produce starting points, so leave them unconstrained and symmetrize before the
  final-level solve.

### Stage 2 — discrete fitting: the part that actually bites

**Grid origin must be per-axis.** `Sheet::offset` is currently a scalar (0 for
rect, 0.5 for diag — the diagonal sheet already measures grid coordinates from
the sheet centre). Make it a pair, and under symmetry set it to:

| axis | x origin | y origin |
| --- | --- | --- |
| `x = 1/2`   | centre | 0      |
| `y = 1/2`   | 0      | centre |
| `y = x`     | 0      | 0      |
| `y = 1 − x` | centre | centre |

This is the load-bearing decision. In absolute grid coordinates the book mirror
is `x ↦ s − x − w`, which **depends on the sheet size `s`**. The greedy grows `s`
lazily while pinning already-placed flaps at absolute grid coordinates, so every
growth step would silently move the axis out from under every pinned pair. In
centred coordinates the mirror maps become

    (−x − w, y)      (x, −y − h)      (y, x)      (−y − h, −x − w)

all independent of `s`, and growth is just symmetric margin. `y = x` on a rect
sheet needs no centring at all because the axis passes through the origin corner.

Cost: a centred axis forces an **even** sheet size, since the centre must land on
a grid point. This is exactly the rule `Diag::output` already applies ("we only
output even grid size"), so there is precedent; the cost is at most one grid
unit. Only `y = x` on a rect sheet keeps odd sizes available.

**Branch by orbit, not by flap.** Fix a whole orbit at once:

- paired flaps: branch the representative over its 4 surrounding grid points and
  derive the partner from the mirror map;
- on-axis flaps: one degree of freedom, so 2 candidates along the axis;
- validity must check representative-vs-pinned, partner-vs-pinned, **and
  representative-vs-partner** — a pair can collide with itself across the axis,
  which is easy to miss;
- `enlarge_if_necessary` must consider both members and the centred axes;
- the annulus fallback must keep on-axis flaps on the axis.

One trap worth recording, because the spike hit it: the fallback for an
**on-axis** flap must be a 1-D scan outward *along the axis*, not the usual 2-D
annulus. Projecting annulus points onto the axis collapses hundreds of distinct
points onto the same handful of placements and re-runs a full SLSQP solve for
each, which turned a sub-second fit into minutes. With the 1-D scan in place the
fallback rate is comparable to the asymmetric greedy (0–4 per solve across the
test set).

Worth trying as a later refinement: also generate candidates from the partner's
own rounded position, mirrored back, since the partner's placement is derived
rather than independently optimized.

### What symmetry costs (measured)

Spike results over eight synthetic trees, best-of-4 random starts, no
basin-hopping, comparing the best symmetric result against the unconstrained
optimizer given the same budget:

| tree | baseline | best symmetric | delta |
| --- | --- | --- | --- |
| bug v=2 (6 flaps)  | 42 | 42 | 0% |
| bug v=3 (8 flaps)  | 56 | 52 | **−7%** |
| bug v=4 (10 flaps) | 83 | 80 | **−4%** |
| star n=4 | 20 | 20 | 0% |
| star n=5 | 30 | 30 | 0% |
| star n=6 | 34 | 34 | 0% |
| star n=8 | 40 | 40 | 0% |
| lopsided (asymmetric tree) | 21 | 22 | +5% |

Symmetry cost nothing on every genuinely symmetric tree, and on two of them beat
the unconstrained optimizer. The likely reason is that symmetry halves the
effective search dimension, so the same number of random starts explores the
reduced space far better — the unconstrained run is simply getting stuck in
worse local optima. That is a hypothesis, not a measured mechanism, but it means
the feature can be offered without a "this will cost you paper" warning.

The one tree where symmetry cost anything is the one with no nontrivial
automorphism, which is the expected and explainable case.

### Where the pairing comes from: the existing symmetry mode

The pairing is **user-declared, not inferred**. `OristudioBpSymmetryState`
(`apps/web/src/store/workspaceStore/types.ts`) already holds
`{ enabled, angle, loc, pairs }` for the BP tree, and `lib/bpTreeSymmetry.ts`
already resolves a vertex's mirror — explicit pair first, then geometric
inference (a vertex on the axis mirrors to itself; otherwise the vertex nearest
the reflected position within tolerance). It drives mirrored leaf-add,
vertex-move and edge-length edits today. The optimizer consumes the same state.

This deletes the auto-detection work entirely. What remains is the adapter:

- **Vertex pairs → leaf involution.** Pairs are between arbitrary tree vertices;
  the optimizer only constrains leaves. Take explicit leaf pairs directly. A pair
  of *internal* vertices implies a subtree correspondence, and pushing it down to
  leaves needs a tie-break rule when a node has interchangeable children — so
  treat internal pairs as a hint, not a source of truth, and require the induced
  leaf pairing to be a **total involution** before running. If some flaps are
  unpaired and not on the axis, name them and stop rather than silently
  optimizing a partial symmetry.
- **Geometric inference is only trustworthy in view mode.** It reads the *current*
  positions, so it is right when the layout is already roughly symmetric and
  meaningless when it is not. In random-layout mode the current positions are
  about to be discarded, so require explicit pairs there.
- **Axis.** The optimizer can only honour the four axes of the square through the
  paper centre, because the sheet must share the layout's symmetry and the sheet
  size is a free variable. `symmetryPresets.ts` already distinguishes exactly
  this: `symmetrySelectValueForState` returns `'custom'` for an off-centre `loc`
  or an off-preset `angle`. Accept the four presets, reject `'custom'` with a
  clear message (optionally offering to snap).
- **Today's BP symmetry mode is book-vertical only** (`BpTreePanel` toggles
  `angle: 90` at the paper centre, no variant picker). Diagonal symmetry needs the
  axis widened to the four presets — the vocabulary in `symmetryPresets.ts` is
  already shared with the TreeMaker conditions UI, so this is wiring, not new
  concepts.
- **Pairs are ephemeral** (explicitly not persisted to the document/.bps). That is
  fine for a session, but a layout optimized under symmetry outlives the constraint
  that produced it — reload and the symmetry is only accidental. Deciding whether
  symmetry becomes document state is a real product call; TreeMaker persists its
  equivalent as conditions. Not a blocker for v1.

Two findings from the spike still matter even with explicit pairing:

- **The pairing choice is worth a lot.** On a 4-flap star one involution cost +50%
  sheet area and another cost 0%. With explicit pairing that choice is the user's,
  which is right — they know the subject's symmetry — but a bad pairing now costs
  paper silently. Worth a hint when the declared pairing is not distance-consistent
  (i.e. not a tree automorphism). It is still *feasible* — symmetry is a purely
  geometric constraint, and a mismatched pair just means the looser distance binds
  — so this is a warning, never a rejection.
- **The two variants of a preset are the same problem, except when flaps have
  dimensions.** Vertical vs horizontal book (and rising vs falling diagonal) are
  related by a 90° rotation of the square, so for dimensionless flaps the optimal
  sheet size is identical and there is nothing to choose between them. The spike
  appeared to show otherwise (`bug v=3`: 52 on the falling diagonal vs 57 on the
  rising one), but that is an artifact: the spike centres coordinates for the
  falling diagonal and not for the rising one, so the two ran under different
  parity and sheet-growth rules. The book pair, which the spike *does* treat
  symmetrically, agrees in three of four cases.

  Flap **dimensions** break the equivalence for real: a 90° rotation would swap
  every flap's width and height, and BP flaps cannot rotate. So cross the two
  variants only when `useDimension` is on. Otherwise, crossing them is just extra
  restarts — which may still help a heuristic solver, but should be described and
  budgeted as restarts, not as a principled search over variants.

### Settled: a symmetric layout does give a symmetric CP (both axes)

`Repository` selects `Configuration` index 0 and `Pattern` index 0, and
normalizes stretch orientation through `Repository.$f`, an `ISignPoint` — sign
flips only, no x↔y transpose. The concern was that diagonal symmetry, being a
transpose, would fall outside that canonicalization and let the two halves of a
symmetric model pick structurally different patterns.

Measured in `crates/oristudio-bp/tests/symmetry_pattern.rs`: **both axes work,
by different routes.**

- **Book mirror** — the sign-flip canonicalization absorbs it completely. Two
  mirror-image stretches produce byte-identical pattern geometry; only the flap
  ids and quadrant labels differ.
- **Diagonal mirror** — not absorbed, so the two stretches carry genuinely
  transposed geometry, with detour paths traversed in the opposite order. That is
  still a mirror-image crease pattern; the hypothesis that this would break was
  wrong.

Crucially, in both cases the two stretches select the *same* configuration and
pattern index, which is what could have gone wrong.

Coverage limit: both fixtures yield a single configuration with two candidate
patterns, so they exercise the pattern choice but not a choice between competing
configurations. Worth a harder fixture if pattern asymmetry is ever observed in
the wild.

## Affected Areas

- `crates/oristudio-bp/src/optimizer.rs` — `Symmetry` types, axis resolution,
  equality residuals, per-axis sheet offsets, orbit greedy, symmetric output sizing
- `crates/oristudio-bp-wasm/src/lib.rs` — request plumbing (symmetry is currently
  a frontend-only concept; the BP Rust crate knows nothing about it)
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` — feed
  `oristudioBpSymmetry` into the optimizer request
- `apps/web/src/lib/bpTreeSymmetry.ts` — leaf-involution derivation + validation
- `apps/web/src/components/panels/BpTreePanel.tsx` — axis variants, pair editing
- `apps/web` — optimizer dialog option, i18n strings
- `crates/oristudio-bp/tests/optimizer_oracle.rs` — must keep passing unchanged
- `PORTING.md` — record symmetry as an Ori Studio extension with no upstream counterpart
- Spikes: `crates/oristudio-bp/examples/symmetry_spike/` (throwaway; delete before merge)

## Checklist

- [x] **Phase 0 — settle the CP-symmetry risk.** Build symmetric layouts that
      contain stretches, generate patterns, and compare each CP against its own
      mirror image. Measure book vs diagonal separately. If diagonal breaks,
      decide whether to canonicalize the transpose in pattern search or ship
      book-only first.
- [x] Phase 1 — `Symmetry` / `SymmetryAxis` types, paper-relative to normalized
      axis resolution per sheet type, dimension-compatibility validation
- [x] Phase 1 — equality residuals + `symmetrize()` seeding in the continuous solve;
      unit tests per axis, including flaps with dimensions
- [x] Phase 2 — per-axis grid offsets (generalize `Sheet::offset` to a pair)
- [x] Phase 2 — orbit-based greedy branching, symmetry-aware validity (including
      representative-vs-partner), enlargement, annulus fallback, and output sizing
- [x] Phase 2 — assert exact symmetry of the fitted integer result in tests
- [x] Phase 3 — adapter from `OristudioBpSymmetryState` to the kernel's leaf
      involution: explicit leaf pairs, geometric inference in view mode only,
      totality check with the offending flaps named, preset axis mapping with
      `'custom'` rejected
- [x] Phase 3 — warn (do not reject) when the declared pairing is not
      distance-consistent
- [x] Phase 4 — manifold-preserving basin-hopping; random/hierarchy mode integration
- [x] Confirm `optimizer_oracle.rs` still passes with symmetry absent
- [x] Delete the spike examples
- [x] Update `PORTING.md`

## UI work, now that the Optimize Layout dialog has landed

The dialog from `implementation-plans/bp-layout-optimizer-ui.md` is in place:
`BpOptimizerModal` + `bpOptimizerUiStore` (persisted options) + the slice action
`optimizeOristudioBpLayout`, which already runs as one undoable step and holds
`oristudioBpBusy` for the duration. `optimizeOristudioBpLayout` in
`oristudioBpRuntime.ts` accepts `options.symmetry` and attaches it to the request
as plain JSON, so **no wasm change is needed**. What remains is deciding
symmetry at run time and letting the user author it.

### First, a correction to fix

`BpOptimizerDialogOptions` is `Omit<OristudioBpOptimizerOptions, 'openNew' | 'seed'>`,
so adding `symmetry` to the options type quietly made it part of the *persisted
dialog options*. It is not a user preference — it is derived from the tree and
the symmetry-authoring mode at the moment the run starts. Nothing actually
persists today, because `sanitize()` rebuilds the object from four known fields
and drops it, but the type is lying and the next person to touch `sanitize` will
believe it.

Add `'symmetry'` to the `Omit` list and resolve it in the slice action instead.

### Resolving symmetry at run time

In `optimizeOristudioBpLayout` (the slice action), before calling the runtime:

```
const symmetry = get().oristudioBpSymmetry;
const tree = get().oristudioBpDocument.snapshot.tree;
const resolved = symmetry.enabled
  ? resolveOptimizerSymmetry(tree, symmetry, { allowInference: options.layoutMode === 'view' })
  : null;
```

`allowInference` must be `true` only in view mode. Inference reads the current
flap positions, which random mode is about to discard.

**When symmetry is on but unusable, fail the run and show the reason.** Do not
fall back to an unconstrained solve: the user turned symmetry on, and quietly
handing back an asymmetric layout is the same mistake as assuming an unpaired
flap sits on the axis. The rejection messages are already written for a person
and name the offending flaps.

### Dialog

A symmetry row that reflects the authoring mode rather than duplicating it:

- symmetry off — one line saying so, pointing at the tree panel's symmetry mode;
- symmetry on — name the fold (see labelling below) and offer a *Respect
  symmetry* toggle, defaulting on, so a run can opt out without leaving symmetry
  mode;
- symmetry on but unusable — show the reason inline and block Run;
- pairing not distance-consistent — a non-blocking hint that it will cost paper.

That last one exists already: `resolveOptimizerSymmetry` returns
`inconsistentPairs` on success.

### Labelling: book and diagonal swap between grid types

A diagonal-grid sheet is the paper turned 45° against the grid, so the same fold
line means opposite things on the two sheets:

| fold line | rectangular sheet | diagonal sheet |
| --- | --- | --- |
| vertical / horizontal | book fold | diagonal fold |
| 45° rising / falling | diagonal fold | book fold |

The UI must name the fold by what it does to the *paper*, or a user on a diamond
sheet will be told a corner-to-corner fold is a "book" fold. Needs a TS helper
alongside `optimizerSymmetryAxisForAngle`, mirroring `axis_label` in the
showcase generator.

### Authoring: four axes, and declaring pairs

Two gaps in the existing symmetry mode block real use:

- **The axis is hardwired.** `BpTreePanel.handleToggleSymmetry` sets
  `angle: 90` with no variant picker, so diagonal symmetry cannot be chosen at
  all. The four-preset vocabulary already exists in `symmetryPresets.ts`; this is
  wiring plus sheet-aware labels.
- **On-axis flaps cannot be declared.** A flap on the axis has no partner to pair
  with, and `addBpTreeSymmetryPair` refuses `a === b`. The resolver already reads
  a self-pair as "on the axis"; the authoring side has to be able to write one.
  Until then, **random mode cannot use symmetry at all**, because inference is
  off there and any on-axis flap comes back unresolved.

So: a way to select two flaps and pair them, select one and place it on the axis,
and see which flaps are already spoken for.

### One decision taken during implementation

The symmetry-authoring mode **defaults on** for every BP design, because it
drives mirror-draw. Keying the optimizer off that alone would have silently made
every run symmetric, and would have failed every random-mode run outright, since
inference is disabled there and nothing is declared by default.

So a run carries an explicit `respectSymmetry`. It defaults on, and the dialog
shows what it will do; when symmetry cannot be resolved the row says why and the
run proceeds unmirrored rather than being blocked. The stored preference is left
alone — rewriting the user's choice because it does not apply right now would
lose their intent the moment it applies again.

### Phasing

1. Un-persist `symmetry`, resolve in the slice action, fail loudly with the
   reason. View mode with geometric inference works end to end after this.
2. Dialog symmetry row: state, respect toggle, rejection reason, inconsistency hint.
3. Sheet-aware fold labels + the four-axis picker in the tree panel.
4. Pair / on-axis authoring. Unblocks random mode.
5. i18n extract / translate / stamp / check; capability and modal tests following
   the patterns in `BpOptimizerModal.test.tsx`.

### Still open

**Symmetry state is ephemeral.** `OristudioBpSymmetryState` is explicitly not
persisted to the document or `.bps`. A layout optimized under symmetry therefore
outlives the constraint that produced it: reload, and the symmetry is only
accidental. TreeMaker persists its equivalent as conditions. Not a blocker for
any phase above, but it is a product call rather than an implementation detail,
and it gets more awkward the more authoring we add.

## Checklist: UI

- [x] Drop `symmetry` from `BpOptimizerDialogOptions`; resolve it in the slice action
- [x] Fail the run with the resolver's reason when symmetry is on but unusable
- [x] Dialog symmetry row: state, *Respect symmetry* toggle, reason, inconsistency hint
- [x] Sheet-aware fold labels (book/diagonal swap by grid type)
- [x] Four-axis picker in the BP tree panel's symmetry mode
- [x] Pair two selected flaps; place one flap on the axis (self-pair), including
      relaxing `addBpTreeSymmetryPair`
- [x] Show which flaps are paired and which sit on the axis
- [x] i18n extract / translate / stamp / check
- [x] Tests: resolver-to-slice wiring, dialog states, axis labelling per grid type
- [ ] Browser check: view mode on a rect sheet, view mode on a diamond, random
      mode once on-axis flaps can be declared
