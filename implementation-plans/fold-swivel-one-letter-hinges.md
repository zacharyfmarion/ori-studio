# Swivel at a hinge end: a flap whose hinges show it one letter

## Goal

The swivel at a hinge end (`fold-swivel-hinge-end.md`) turns a flap about the
corner where its two hinges end, named by a valley and a mountain. It refuses
a flap whose two hinges show it the same letter. Tutorials make that move
too: a flap lying over the layers on both sides of it (its hinges both
mountains as it shows them) is turned about its corner, the diagram drawing
a mountain on the flap and a valley in the layer it folds in. Those steps
land today only as a crease-pattern import.

Turn such a flap with the existing Swivel tool's Valley and mountain, and
keep every swivel that lands today landing the same way.

## Approach

- **The move is the hinge-end swivel's.** Both hinges move one angle ψ the
  same way round, the flap turns through 2ψ, and each new crease keeps its
  hinge's letter. Only the reading changes; the compile, the wedges, the
  seeds and the landing are `swivel_hinge_end`'s.
- **Which hinge the flap leaves.** Two letters say it (the crease on the flap
  keeps the letter of the hinge it leaves). One letter does not: the crease
  on the flap keeps it either way, so the flap leaves the hinge that gives it
  room. Where both do, refuse `swivel_line_meeting`: the other crease runs
  along the same model line either way, so the lines cannot say which.
- **The kind is the letter's.** The crease on a flap whose hinges show it
  mountains is a mountain (open's letters); valleys, a valley (inside's).
  The other kind finds no plan.
- **Only on the paper the lines are drawn on.** A one-letter flap is read
  only where the viewer sees it on both sides of the crease named on it,
  near the vertex: the swivel by valley and mountain names lines on the
  layer that faces the viewer.
- **Only where today refuses.** Plans of two-letter flaps are read first,
  exactly as today. A one-letter flap is read only when they give none, or
  the one they give refuses; if it refuses too, today's refusal stands.
  One #578 test asserted that a strip's lines with their letters swapped
  refuse. They still do not turn the strip, but the mountain lies on the
  layer in view across the strip's hinge, whose hinges show it mountains,
  and that layer now turns: the test now says so.
- **Known gap (today's reading, unchanged).** Where a one-letter flap lies
  over a two-letter one, both lines run into the layer underneath too, and
  today's reading turns that hidden layer when it can (it lands, or fails
  only at the order). The one-letter flap the folder drew on is then not
  reached. Preferring the flap in view would change what those lines land
  today, so it is left for a decision.
- **A precrease along a new crease.** For a one-letter flap's turn, the
  wedge split also cuts a flat crease lying along a new crease's run, so a
  precrease there folds instead of holding two wedges together
  (`fan_ray_blocked`). A two-letter flap's turn is left as it is: cutting
  there too would make a #578 test case land (the strip's other turn, whose
  computed crease runs along the flat half of an opened fold), which is a
  separate change to that reading.
- **Why not the Rabbit ear tool.** On the sheet the move is a rabbit ear (the
  incentre fan of a triangle whose fourth crease is an existing fold), but on
  the folded pane two of that triangle's corners are one point, and the two
  new creases run in different directions in different layers: no fan of
  model-frame rays names it. The diagrams draw exactly a valley and a
  mountain from the flap's corner, which is the Swivel tool's input.

## Affected Areas

- `crates/oristudio-fold/src/compound/swivel_hinge_end.rs`: `plans_at` reads
  one-letter flaps on request (`Hinges`), `HingeEnd::reading` falls back to
  them, `blocks` cuts precreases along the new creases.
- `crates/oristudio-fold/tests/swivel_one_letter_hinges.rs` (new).
- `crates/oristudio-fold/tests/swivel_valley_mountain.rs`: the swapped-letter
  case now asserts what turns instead of a refusal.
- `crates/oristudio-fold/README.md`.

No wire, UI, document-format or op change.

## Checklist

- [x] Verify the reading against the tutorial diagrams and the saved
      crease-pattern nodes (outside the repo)
- [x] One-letter plans in `plans_at`, read only where two-letter ones refuse
- [x] Cut precreases a new crease runs along
- [x] Synthetic tests: the turn lands, valid, letters kept, flap turned 2ψ and
      still seen; a rough other line gives the same fold; the other kind is
      refused; a precrease along the crease on the flap folds
- [x] Real-design check outside the repo: both corpus nodes land the same
      paper, and every later node still does
- [ ] App check: make the step by hand with the Swivel tool
- [ ] Draft PR with before/after files
