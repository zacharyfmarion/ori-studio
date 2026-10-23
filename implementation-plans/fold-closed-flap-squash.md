# Fold: squash a closed flap

## Goal

Squash a flap of four layers: a front and a back wall joined only through
two sides folded in along the flap's centre line, opened into a square
centred on the hinge's midpoint. The book's case is ghost step 10 ("Squash-fold
the flap flat, opening it so the colored side shows inside"); the engine knows
only a two-layer squash and refuses it (`NoFlap::NoSpine` on the centre line,
not free off it). For the launch the refusal only says so (the squash
`noSpine` text); the research notes list this fold as unimplemented ("spread
squash", `research/2026-10-08-fold-workspace/r1-theory.md:176`).

## Approach

- Recognise the closed flap at the click: the top two layers are walls joined
  through a pair of folded-in side layers on the flap's centre line, held to
  the body along one hinge.
- With the hinge's midpoint O and the precrease that bisects the tip and O:
  - the front wall swings up over the hinge (its hinge crease unfolds), and
    its tip folds back on the precrease, a mountain, landing on O;
  - the back wall's tip folds up on the precrease, a mountain;
  - each side layer opens, new valleys running from O to where the precrease
    meets the flap's edges; their hinge pieces and centre-line creases flatten.
- A new branch in `squash_flap` and its compile step; the result is unique,
  so no choice. Diagram marks follow from the before and after states.

## Affected Areas

- `crates/oristudio-fold/src/compound/squash.rs`, its refusals and tests.
- The Squash tool's preview and words; a synthetic fixture under
  `tests/fixtures/fold-regressions/` (never the owner's ghost.osf).

## Checklist

- [ ] Recognise the closed flap; leave every two-layer squash unchanged.
- [ ] The geometry above, checked against folded paper and against the
      owner's after-CP (the sheet at x 800 to 1200 in ghost.osf).
- [ ] Synthetic fixture and replay test; the corpora replay unchanged.
- [ ] The `noSpine` text narrowed back once the closed flap squashes.
