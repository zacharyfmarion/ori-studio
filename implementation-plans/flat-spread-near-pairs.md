# Default spread: penalise only layers near each other

## Goal

Make the Default (connected, flat) spread solve cheap enough that large
models spread instead of being refused, without changing how a spread picture
reads.

The trigger was a 940-face model, stacked 86 layers deep, refused with "Spread
resource limit exceeded: overlap regions": 228,983 overlapping triangle pairs
against the 200,000 cap. With the cap lifted the same model solves, but takes
12.8 s and 308 MB in the release wasm, at the solver's own 12 s limit. The same
cap refuses 20 of the 465 corpus models that reach the solve.

## Approach

### Where the cost is

The solve is a quadratic program. Its size is set almost entirely by the
crossing penalties: one slack variable and two inequality rows per distinct
sample of "this triangle must stay above that one". Before this change a sample
was made for every pair of overlapping triangles from any two ordered faces, so
a stack of `n` layers cost `n²/2` pairs. On the trigger model 182,735 of the
solver's variables were those slacks; the paper itself is 1,628 vertices.

### 1. Penalise only pairs near each other

Two faces are *near* when some overlap cell stacks them within `REACH` (8)
places of each other. Every other ordered pair has, wherever the two overlap,
at least eight faces between them. If A stays above B and B stays above C
there, A stays above C: the order of a far pair follows from the near pairs
between them.

So crossing samples are made only for near pairs, and a stack of `n` layers
costs about `8n` pairs. The pair test runs before the triangle clip, so a
skipped pair costs a hash lookup, not a clip.

The penalty weight is unchanged: 50 × the spacing mass over the overlap area of
*every* ordered pair, now summed from the cells (`area × n(n-1)/2`), since the
far pairs are no longer clipped. A near pair is therefore exactly as stiff as
before. With an unlimited reach the solve reproduces the old one (see Tuning).

### 2. Drop the redundant slack row

Each crossing minimises `w·s²` under `s ≥ -gap` and `s ≥ 0`. The first row
alone already gives `s = max(0, -gap)`, so the second is redundant at the
optimum. The 3D spread dropped it on 2026-11-03
(`spatial-spread-solver-efficiency.md`); the flat solve never did. Same answer,
one fewer row per crossing.

### 3. Count the cap on what is solved

The 200,000 cap stays, but counts the overlap regions that become penalties,
which is what the solver pays for. The largest corpus model has 158,419; the
trigger model 94,380. A second guard (20,000,000) bounds the pair lookups of
the sweep, so a model whose pairs are nearly all skipped cannot run the
preparation unbounded; the largest corpus model makes 5,929,258.

### 4. Fall back to the layers that touch

A model with more than 200,000 near-pair regions is prepared again with a
reach of 1: only layers lying directly on each other are penalised. It is
refused only if that is over the cap too (owner's call, 2026-11-19: "default to
closest, fall back to fastest if closest is over the limit but fastest would
not be").

At reach 1 the weight changes with it. At the all-pairs stiffness, touching
pairs alone let paper cross far more (410 of 464 corpus models clearly worse),
so the fallback weighs the penalties against the penalised overlap only. That
holds layers in order as well as the old solve did, and opens a deep stack
less (see Tuning). The solution's diagnostics say which was used (`reach`: 8
or 1).

No corpus model needs the fallback: the largest has 158,419 near-pair regions,
and 32,908 at reach 1.

### 5. The 3D spread shares the rule

The 3D (spatial) solve penalised every pair of each cell's stack too. Both
solves now take the rule from one module, `reach.rs`: which places of a stack
are penalised (`Reach::pairs`), what the penalties are weighed against
(`Reach::mass`), and the fallback from near layers to touching ones
(`Reach::widest`).

In 3D the pairs are per cell, so the rule is exact there: a pair left out has
eight faces between it over the whole cell. Every face of a cell's stack covers
the cell, so each pair left out overlaps in the cell's area, and the weight
adds that area back. A stack up to nine deep leaves nothing out and is prepared
exactly as before.

The 3D fallback is taken on any of its preparation limits (2,000,000 visits,
100,000 distinct crossing rows).

Results on the non-flat test corpus (14 models that fold; release wasm, one
model per process). "Moved" is the largest change in any vertex's displacement,
as a share of the model's largest displacement. Order violation is measured
against every ordered pair.

| Model | Deepest stack | Before | After | Moved | RMS order violation |
| --- | ---: | ---: | ---: | ---: | --- |
| Tortoise, 1,242 faces | 55 | 2.0 s, 95 MB | 1.35 s, 71 MB | 1.1% | 5.0e-5 → 5.2e-5 |
| Hex head 2, 122 faces | 76 | 2.8 s, 78 MB | 0.7 s, 27 MB | 0.7% | 3.8e-5 → 3.9e-5 |
| Pangolin, 365 faces | 26 | 0.59 s, 32 MB | 0.55 s, 29 MB | 0.3% | 9.9e-5 → 1.0e-4 |
| Stick on a floor, 519 faces | 131 | refused | 2.2 s, 79 MB | — | — |
| Two penguins | 12, 14 | 0.11 s | 0.11 s | under 0.003% | unchanged |
| The other eight | 7 or less | — | — | 0, bit for bit | unchanged |

In the live 3D view at 100% spread, 900 pixels square, 905 pixels of the
Tortoise differ (0.11%), 333 of Hex head 2 and 96 of the Pangolin. With every
pair penalised the new code gives the old displacements bit for bit on the 12
models with stacks that the old solve accepted.

Most 3D models are shallow, so most see no change; the gain is on the few deep
ones. "Stick on a floor" was refused for too many crossing rows and now spreads
at the default reach. Its vector capture still runs out its 12 s and falls back
to a bitmap, as any model too dense to clip in time does.

### Not changed

- The input format, the gap objective, planarity, slope and warp limits, the
  reference planes and the in-plane shift.
- The 3D spread's version, input format, limits and worker lifetime.
- The flat worker's lifetime. Peak memory falls with the problem size, so
  recycling the worker (as the 3D spread does) is left for when it is needed.
- The solution's `version`. Heights move by less than a picture shows (below).
  Its diagnostics gain `reach`.

### Tuning

Measured on the 465 corpus inputs that reach the solve plus the trigger model,
native release, six at a time. "Before" is the old solve with the cap lifted.
Opening is the height span. Move is how far a vertex's height shifts, as a
share of the span. Crossing is the RMS depth by which ordered paper crosses,
measured against **every** ordered pair, in units of the old mean gap.

| Variant | Total time | Opening within ±10% | Move, median / 90th | Crossing, median / 90th | Models crossing clearly more / less |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before | 440 s | — | — | 0.106 / 0.245 | — |
| Unlimited reach (check) | 418 s | 463 of 464 | 0.2% / 0.6% | 0.113 / 0.257 | 1 / 0 |
| **Reach 8, same weight (the default)** | 93 s | 442 of 464 | 0.4% / 1.7% | 0.120 / 0.315 | 31 / 0 |
| Reach 5, same weight | 68 s | 414 | 0.7% / 3.1% | 0.132 / 0.412 | 90 / 0 |
| Reach 3, same weight | 50 s | 372 | 1.4% / 5.7% | 0.172 / 0.715 | 187 / 0 |
| Reach 1, same weight | 33 s | 282 | 4.3% / 13.3% | 0.363 / 1.865 | 410 / 0 |
| **Reach 1, weight over penalised area only (the fallback)** | 36 s | 327 | 2.1% / 5.5% | 0.090 / 0.355 | 54 / 36 |

Reach 1 with the weight renormalised is the fastest variant that keeps crossing
at today's level (about 10× faster on models over a second), but it is a
different picture: stiff neighbour penalties close deep stacks up, and one
model in ten opens at least 19% less (the lobster: half as far). Reach 8 keeps
the picture.

In pictures (vector captures at the default 7% spread, 31% and 100%, six
models): at reach 8 the corner of the paper that moves most is drawn 0.00–0.1%
of the figure's width from where it was at 7%, and at most 1.3% at 100%. At
reach 1 it is up to 0.7% at 7% and 9.8% at 100%.

Release wasm, one model per process:

| Model | Before | Reach 8 | Reach 1 |
| --- | ---: | ---: | ---: |
| Trigger model, 940 faces | 12.8 s, 308 MB | 5.1 s, 124 MB | 1.5 s, 45 MB |
| Xenomorph, 1,990 faces | 14.1 s, 457 MB | 2.5 s, 114 MB | 1.1 s, 87 MB |
| Megumin, 708 faces | 13.1 s, 307 MB | 0.7 s, 39 MB | 0.3 s, 17 MB |
| Kirin, 1,136 faces | 5.2 s, 195 MB | 1.3 s, 62 MB | 0.5 s, 29 MB |
| Lobster, 636 faces | 4.5 s, 178 MB | 0.9 s, 42 MB | 0.3 s, 18 MB |
| Meerkat, 56 faces | 80 ms, 4 MB | 50 ms, 3 MB | 30 ms, 2 MB |

All 20 corpus models the old cap refused now solve, the slowest in 3.8 s
native. Five of them never converged under the old solve even with the cap
lifted (it ran out its 12 s), so they have no "before" to compare with.

## Affected Areas

- `crates/oristudio-layer-spread/src/prepare.rs`: near pairs, the sweep's
  skip, the ordered overlap area, the cap, the fallback and the pair-lookup
  guard; unit tests of the fallback against a small cap.
- `crates/oristudio-layer-spread/src/qp.rs`: the slack row, the weight's
  denominator, the crossing diagnostic's.
- `crates/oristudio-layer-spread/src/reach.rs`: the rule both solves share.
- `crates/oristudio-layer-spread/src/spatial.rs`: near pairs per cell, the
  weight of the pairs left out, the fallback; unit tests against a small
  budget.
- `crates/oristudio-layer-spread/src/lib.rs`, `packages/layer-spread/src/types.ts`,
  `apps/web/src/cp-workspace/folded/folded3dMaterial.ts`: the `reach`
  diagnostic of each solve.
- `crates/oristudio-layer-spread/tests/solve.rs`: deep stacks, far pairs, a
  pair near in one cell only, a stack over the old cap.
- `apps/web/src/generated/oristudio-layer-spread-wasm` (build output).

## Checklist

- [x] Near-pair crossing samples, skipped before the clip.
- [x] Redundant slack row removed.
- [x] Cap counts penalised regions; sweep lookups guarded.
- [x] Reach and weight chosen on the corpus; results recorded here.
- [x] Falls back to touching pairs over the cap; refused only past that too.
      Forced on the trigger model (cap lowered to 50,000 for one run), it gives
      the reach-1 heights of the comparison page to 1e-11.
- [x] Rust tests (29 in the crate), clippy, fmt; the 26 web test files that
      run the real solver or the spread layer (268 tests); the spread
      package's 53.
- [x] Before/after pictures on the trigger model and five corpus models
      (git-ignored `artifacts/spread-touching-pairs/spread-before-after.html`).
- [x] In the app: the trigger model opens, folds and spreads by Default in
      about 5 s, where it was refused.
- [x] Owner's call (2026-11-19): reach 8 by default, reach 1 as the fallback.
- [x] The 3D solve on the same rule, through a shared module; 34 crate tests.
- [x] 3D before and after: displacements and order violations on the non-flat
      corpus, live-view renders of the four deepest models (git-ignored
      `artifacts/spread-touching-pairs/spread-3d-before-after.html`).
- [x] `scripts/layer-spread/spatial/check-production.mjs --examples` (14
      rendering cases; seven models, 84 captures, picking against GPU face
      ids) and `--model tortoise` (12 captures) pass on the new solve.
