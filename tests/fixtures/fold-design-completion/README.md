# Five flat authoring cases

Authored in Ori Studio from the traditional models taught by Origami.me, checked
2026-10-13. These files contain our original operation sequences and witnesses;
no tutorial pictures or text are copied. Open an individual `.osf` with File →
Open: it contains a Fold sequence, no Edit document or diagram.

| File | Reference | Accepted endpoint |
| --- | --- | --- |
| `cicada.osf` | https://origami.me/cicada/ | Separate head layers, wings and side folds; completed flat model. |
| `swan.osf` | https://origami.me/swan/ | Neck wraps outside the body; head also reverses outside. Flat pose. |
| `heart.osf` | https://origami.me/heart/ | Both side pockets released, side triangles retained, corners and top points folded, final turnover. |
| `box.osf` | https://origami.me/box/ | Complete flat preparation through tutorial stage 6. Upright assembly excluded. |
| `crane.osf` | https://origami.me/crane/ | Square/bird base, narrowing, reverse neck/tail/head, both wings down flat. Wing opening excluded. |

The owner explicitly limited the implementation to 2D. Box walls and crane wing
opening are not represented by fake flat folds. The bird routes decompose the
construction into supported flat endpoints rather than duplicating every
intermediate hand motion in the tutorial.

## Critical witnesses and acceptance

- Heart `fstep-heart-9` is the 16-face parent. Node 10 is a valley tuck beneath
  the two separate side triangles, named by original-sheet points
  `(0.05, 0.6)` and `(0.95, 0.6)`. Its central seed is near `(0.4, 0.98)`.
  The lowered flap must also lie above the stationary bottom triangle: both
  `(0.4, 0.85)` and `(0.6, 0.85)` on the original sheet must cover the respective
  `(x, 0.1)` bottom-strip points, which coincide after folding. The former choice
  was admissible but exposed the wrong paper and an extra band;
  `heart-tuck-layer-order.json` retains it as a semantic negative.
  Only four central faces split: the child has 20 faces. Each target's material
  face and isometry stay identical. The four corner folds select all layers at
  the outer corners and one layer at the inner corners; this avoids carrying
  the other lobe. The final node turns the completed heart over.
- Swan node 9 is an **outside** reverse with a descending crease through the
  neck root in the folded view. The balanced central-spine opening separates
  the two neck blocks. Node 10 also reverses outside. On the corrected neck
  input, requesting Inside is geometrically infeasible. The old ascending
  neck line required Inside; merely replacing that old operation's kind was
  never a valid correction. The final quarter-turn is only view orientation.
- `bird-swivel-refusals.json` preserves the original tutorial-order parent
  sequences and 12 probes. The swan probes meet the wide-fold restriction;
  the crane probes meet the blocked-ray restriction. These remain refusals.
  No valid unsupported swivel configuration was established by those probes,
  so this change does not weaken either check.

Rust acceptance tests replay every node and compare fresh-engine canonical
results; check the heart's retained material, exposed flap and turn-over equivalence; reject a
moving target and wrong swan kind; and reproduce the swivel refusals. Canvas
flow tests drive the actual preview/builder/commit path for the heart and both
swan reverses, comparing it to these API-authored operations. Document tests
preserve all target witnesses and lock malformed/future constraints.

Generate from the preserved original trial prefixes, with current Fold WASM:

```sh
node research/2026-10-13-origami-fold-trials/build-deliverables.mjs
```

That research directory is kept outside the repository; the tests do not need
it. The script also updates the user-facing native files, combined project,
separate FOLD interchange exports and per-node replay hashes in the research
directory.
Coordinates are adjustable model proportions, not a general origami solver.
