# Select a buried reverse-fold flap from the crease pattern

## Goal

An Axiom 2 reverse fold whose moving point is picked on the crease pattern
operates on that material's connected flap, including a buried flap, instead
of silently asking to reverse the surrounding stack too.

## Approach

Preserve the pane of point picks as transient input metadata. Resolve the
reverse tool's default seed from the moving CP point and the engine's existing
cross-section/flap partition. Store the chosen flap by its existing interior
witness; no document format or engine semantics change. The destination point
remains a reference, and explicit layer/flap selections take precedence.

Do not infer material selection from arbitrary line-construction references.
Other line modes and folded-pane clicks retain their existing defaults. A
swapped moving side or override is not anchored to the original source point.

## Affected Areas

- Point-pick provenance and default seed resolution.
- Shared cross-section hook; preview, selection chips and commit use one seed.
- Real-WASM canvas and unit regressions.

## Checklist

- [x] Copy current Heart and reproduce all six openings without editing it.
- [x] Verify selecting its interior flap produces one valid inside reverse.
- [x] Preserve source-pane provenance and resolve the default material flap.
- [x] Verify destination references, explicit selections and side changes.
- [x] Test actual canvas clicks and fresh saved replay, including the Heart copy.
- [x] Run web checks and leave the local server ready.

## Reproduction

Ignored snapshot: `artifacts/heart-interior-reverse/heart-snapshot.osf`.
All 21 nodes replay. Axiom 2 picks `[0, .5]` and `[.25, .5]` locate model
`x=.375`, positive moving side. The default selects faces `[3..19]`: the
intended flap `[3,5,6]` plus the surrounding 14-face component. The latter
supplies six candidate openings and makes the requested operation infeasible.
Selecting just flap `[3,5,6]` produces one opening, inside only, without an
order choice. Existing engine validation is sufficient; no guard changes.

## Verification

The real-WASM canvas flow uses the actual hit tests, tool hooks, selection
controls, commit and fresh replay. A synthetic four-layer triangle proves
that selecting a buried material tip moves its two sides together and leaves
the covering flap still. It also checks that chip toggles widen from the
interior selection, explicit all/flap selections win, and no pane metadata
leaks into the saved file.

An ignored local adaptation ran the same flow on the copied Heart: its 21
nodes replay, the two CP picks select faces `[3,5,6]`, only Inside is feasible,
and no opening or layer-order chooser is needed. The tip lands on its target;
all other faces remain still. Committing and rereading the 22-node sequence
reproduces its exact fingerprint. The original file's SHA256 still equals
the copied snapshot's. No model migration is needed.

No engine/solver or geometry guards changed. The existing Fold WASM was
current; native rebuild/tests and production bundling are unnecessary for
this transient web input-selection change.

Validation: all 145 Fold test files / 1,069 tests pass; the separate local
Heart canvas flow passes; TypeScript passes; web lint passes with only the
existing StepFilmstrip React Compiler warning. `git diff --check` passes.
The existing server at `http://localhost:5328/fold` is healthy. Work is local;
no commit, push or PR.
