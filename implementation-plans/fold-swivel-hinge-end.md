# Swivel at a hinge end

## Goal

A swivel by its valley and mountain needs its two lines to meet inside a
folded edge. Tutorials also swivel a flap about its corner: the point where
the flap's two hinges end, a flat vertex of four folds. There the lines meet
at the end of every folded edge, so the engine refuses `swivel_line_meeting`
and the step has to be imported as a crease pattern.

Turn the flap about that corner when its valley and mountain name it, and keep
refusing everything else exactly as today.

## Approach

- **The move.** At a flat vertex of four folds, the flap is the sector between
  two of them (its hinges). Turning it about the vertex moves both hinges one
  angle ψ the same way round. The other two folds stay, and the sectors either
  side of the flap change by ±ψ, so Kawasaki holds for every ψ. The flap's
  paper beside the hinge it leaves unfolds onto the layer across it. The other
  layer's paper beside the hinge it turns toward folds in with the flap. The
  flap turns through 2ψ.
- **How it is named.** With the existing Swivel tool, by Valley and mountain:
  two lines from the corner into the flap. The layer across the flap's valley
  hinge lies over it. Open swings the flap out from under that layer, so the
  mountain is the crease on the flap and the valley the one in the covering
  layer. Inside swings it in under that layer: the valley is on the flap.
- **The crease on the flap sets the turn.** It lies ψ inside the hinge whose
  letter it keeps, as the flap shows it. A flap whose hinges show it one
  letter cannot be named this way and stays refused.
- **The other crease is computed**, ψ inside the other hinge, the way the
  crease behind a swivel on a folded edge is computed. The folder's line only
  has to run into the flap. It is hidden under the covering layer, nothing
  marks where it goes, and diagrams draw it only roughly. Requiring it exactly
  would make the fold impossible to click. The preview draws the computed
  crease, dotted where it is hidden.
- **Where.** A new `compound::swivel_hinge_end`, tried only after the
  on-edge reading refuses `swivel_line_meeting`, so every swivel that lands
  today lands the same way. It scores the two new creases (`ray_run`,
  `score_cuts`) and splits the paper into three moving wedges by material
  continuity. Paper that holds two of them refuses `fan_ray_blocked`. It seeds
  each piece in its old place in the stack and lands through
  `Compiled::land_checked`, so the layer order is solved and checked like
  every compound fold.
- **Preview and picture.** The analysis gives the two creases (the one in
  the covering layer dotted where it is hidden), the moving regions (the flap
  brightest), and the hinge that opens. The picture is the crease on the
  flap, with the arrow from the flap across it.

## Affected Areas

- `crates/oristudio-fold/src/compound/swivel_hinge_end.rs` (new)
- `crates/oristudio-fold/src/compound/swivel_valley_mountain.rs`: the
  reading becomes on-edge or hinge-end; analysis, landing and picture
  dispatch on it
- `crates/oristudio-fold/tests/swivel_valley_mountain.rs`
- `crates/oristudio-fold/README.md`

No wire, UI or document-format change: the op is the existing
`swivel` / `valley-mountain` step.

## Checklist

- [x] Hinge-end reading: find the flap both lines run into, the hinge the
      crease on it belongs to by its letter, and the way it turns by the kind
- [x] Score, wedge, seed and land it through the compound pipeline
- [x] Analysis, landing and picture dispatch in the valley-and-mountain swivel
- [x] Tests: a strip turned about its hinges' end equals a wider swivel
      (same paper), the other kind turns it the other way, a rough second line
      gives the same fold and its computed crease, swapped letters refuse
- [x] Real-design check outside the repo: the corpus steps that needed a
      crease-pattern import land the same paper
- [x] Check the preview and the landed fold in the app (made by hand with a
      rough valley: same paper as the exact one)
- [ ] Draft PR with before/after files
