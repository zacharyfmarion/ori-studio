# Fold: petal fold of a squashed corner whose second layer runs on

## Goal

A petal fold of a corner flap squashed with its spine onto its hinge line
lands the paper a folder expects, and a petal fold refused for a hinge it
cannot crease offers "Precrease the hinge first" only where that route lands.

The case: the square folded on its diagonal, then in half across that, the
corner flap squashed onto its hinge line, its kite precreased; H through the
squash's creases at the spine's midpoint. It was refused as
`petal_not_precreased` (line), naming the back layer above the spine, and the
offered fix — H precreased through every layer — was then refused too
(`residual`, or `petal_not_precreased` kite by the crease).

## Approach

**Root cause (a motion wrong for this geometry).** The second layer is the
paper across the flap's closed edges, grown across flat creases that reach
below H. At the end below the spine, that paper runs on, flat across the
hinge the squash unfolded, into the back layer above the spine — under the
other end's second layer and the paper folded in behind it. The motion turned
every second-layer piece outside *either* end's kite crease *line* across it,
so the back layer, outside the other end's kite line, would fold on that kite;
the `reaching` check refused it as needing H precreased. Precreasing H only
split the back layer at H, so its part below H still folded on the wrong kite
and the gate refused the result. Physically the back layer stays: the expected
crease pattern has no crease in it.

**Fix.** Each end's second-layer kite crease folds, scores and is checked
against the paper across *its own* end's closed edge alone (`second_at` in
`compound/petal.rs`): kite pairs read that end's flat creases, the kite cuts
cross that end's faces, the `reaching` check and the block of each piece look
at its own end's kite. On the bird and frog bases the two ends' paper is
already two pieces, each wholly inside the other end's kite, so the old rule
(every piece against either kite's line) decided the same; a differential
build confirmed it (below).

**Honest refusal.** A new engine fix, `precrease_first { line }`, is attached
to `petal_not_precreased` (line) when the same petal fold lands over H
precreased through every layer (the precrease, then `compile_petal` +
`Compiled::lands`). The petal tool shows "Precrease the hinge first" only for
that fix; without it the notice says the hinge cannot fold there and offers
no precrease. The button's Precrease tool now takes every layer, as the
engine's check does.

## Affected Areas

- `crates/oristudio-fold/src/compound/petal.rs` — per-end second layer;
  `with_hinge_fix`.
- `crates/oristudio-fold/src/refusal.rs` — `Fix::PrecreaseFirst`.
- `crates/oristudio-fold-wasm/src/wire.rs` — the wire fix.
- `crates/oristudio-fold/tests/petal.rs` — the squashed corner (refused, then
  landing the expected creases and stacks), the fix offered or not.
- `apps/web/src/fold/engine/foldEngineWire.ts`,
  `apps/web/src/fold/tools/vertex/vertexRefusal.ts`,
  `apps/web/src/fold/tools/refusalNotice.ts`,
  `apps/web/src/fold/canvas/useFoldCanvasVerbs.ts` and their tests; locale
  catalogs.

## Checklist

- [x] Reproduce in a Rust test from generic ops, asserting today's refusal.
- [x] Root cause: the second layer's motion across the other end's kite.
- [x] Per-end second layer; the squashed corner lands the only order.
- [x] Landed creases equal the expected crease pattern's (9 folded, letters
      included); stacks equal that pattern's one flat state.
- [x] Every petal fold that landed lands identically: instrumented build
      comparing old and new decisions over the fold and bridge suites and the
      corpus replay (23 petal steps in 9 models), no difference but the new case.
- [x] `precrease_first` fix, offered only where the route lands; tests both ways.
- [x] Petal tool: button only for the engine's fix; honest words without it;
      Precrease tool through every layer.
- [x] cargo fmt / clippy / tests; vitest (affected and wasm-backed files);
      lint; i18n check; typecheck (no errors in touched files).
- [x] Corpus replay against the final build.
