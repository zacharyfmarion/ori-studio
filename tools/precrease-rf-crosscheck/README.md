# Precrease planner ↔ ReferenceFinder cross-check

`oristudio-precrease` derives the seven Huzita–Justin constructors — including
the O6 common-tangent cubic — from the axioms' own definitions, and their
validity filters from one principle, *a fold must align in-paper material*.
Nothing is transcribed from ReferenceFinder's `src/core` (plan decision D3),
so the crate is `MIT OR Apache-2.0`. This harness is the evidence that the
derivation is right, and it is deliberately **not** part of the crate:
ReferenceFinder's answers are used here as an oracle, and the predicate that
mimics its legibility rules lives in this file rather than in Rust.

## What it asserts

For each fixture it runs the planner's closure from the bare sheet
(`cargo run --release -p oristudio-precrease --example dump_closure`) and, for
every line the closure folded whose witnesses pass ReferenceFinder's own
legibility rules, asks ReferenceFinder for that line. The line must come back
with `err < 1e-9` — the plan's exactness bar; measured exact solutions carry
1e-8..1e-17.

The legibility predicate applies the two rules the crate only *scores*:

- **visibility** (`sVisibilityMatters`) — at least one input is a sheet edge or
  a mark on one;
- **skinny flap** — the fold leaves a flap thinner than 0.1 of the sheet.

A crease-pattern line has to be folded whether or not it is legible, which is
why the crate scores those rules instead of enforcing them; ReferenceFinder
refuses such a construction, so a line only belongs in the comparison when one
of its witnesses is clean. The third rule, the trivial Haga case of O5, needs
nothing here: the crate's O5 constructor enforces it (a point already lying on
the line it is folded onto has nothing to align), so no witness can carry one.

Lines the closure reaches in later rounds are checked too, but a failure there
is reported as a warning unless `--strict` is given: ReferenceFinder's database
keeps one object per quantised key, so a construction it *can* make may be
shadowed by another line that hashed there first (the plan measured 13 of 42
grid lines lost that way). CI runs with `--strict`, because every line of the
current fixture set passes.

## Running it

```sh
node scripts/build-reference-finder.mjs --node      # once; needs em++
node tools/precrease-rf-crosscheck/crosscheck.mjs --verbose
```

Options: `--lib <dir>` (default `artifacts/reference-finder-node`, falling back
to `apps/web/src/generated/reference-finder`), `--rank N` (default 6, the
shipped default), `--fixture <path>` (repeatable; replaces the default set),
`--dump <cmd>` (the command that prints the planner JSON), `--depth1-only`,
`--strict`, `--verbose`.

The default fixtures are the bird base molecule, kabuto and the synthetic 1/6
grid — the three whose bare-sheet closure is small enough to check line by
line, and between them they exercise O1, O2, O3, O4 and O5 witnesses.

## Current result

21 legible lines, 0 skipped, 0 failures. Every one is exact in ReferenceFinder:
the four rank-1 lines (both midlines, both diagonals) at `err ≤ 2.5e-16`, and
the rank-2 lines — kabuto's four half-diagonals and the bird base's eight
22.5° corner creases — at `err ≤ 4.6e-16`. Note that the routes differ: the
planner reaches the bird base's corner creases by O5 (fold the centre onto an
edge through the far corner) while ReferenceFinder reaches them by O3 off a
diagonal, which it treats as a free rank-1 reference. Agreeing on the *line*
while disagreeing on the *route* is exactly what this check is for.

`rf-node.mjs` drives the Emscripten module from Node; it is adapted from
`tools/reference-finder-oracle/equiv.mjs`, which has no exports, and the header
there explains each shim.
