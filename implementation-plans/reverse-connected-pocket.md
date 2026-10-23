# Reverse a connected pocket as one opening

## Goal

Inside-reversing the roof-shaped top flap must open its front and back layers
together, instead of offering separate left-edge and right-edge reversals.

## Approach

Reproduce against an ignored copy of the user's current Heart and reduce it to
two corner folds on a square. The current scan only cuts collinear folded hinges;
it cannot describe the pocket bounded by both sloping sides. Its two offered
splits put a side-by-side front panel in the back block.

Represent the complete pocket boundary, preserve genuinely distinct stacked
openings, and validate the resulting connectivity, crease reversals and layer
order through the existing compound pipeline. Keep the solver and geometry
guards intact. Saved choices continue to name material by witnesses.

## Affected Areas

- Reverse-fold opening discovery and multi-hinge opening metadata.
- Reverse action visualization and bridge types as needed.
- Engine and real-WASM canvas regression coverage.

## Checklist

- [x] Snapshot the external Heart before inspecting it; preserve the original.
- [x] Reproduce both one-sided openings and replay all 18 saved nodes.
- [x] Add a failing synthetic regression for the connected pocket.
- [x] Discover and fold its one complete opening while retaining genuine choices.
- [x] Verify view/precrease invariance, layer order, and saved replay.
- [x] Rebuild WASM, verify the copied Heart and the UI flow, and report validation.

## Implementation and scope

The scan retains its straight-spine candidates and adds boundary unions at a
shared **material vertex** on the moving tip. A newly supported bent pocket has
one layer on each side wherever they overlap; deeper pleated stacks keep their
existing straight-spine semantics. A complete pocket supersedes its one-sided
splits only when it extends the same gap sideways, preserving every already
crossed layer relation. Search limits remain explicit and duplicate discoveries
do not consume the output budget.

Both tip blocks still pass through the existing compound solver and full gate.
No connectivity, layer-order, near-miss or geometric guard was relaxed. A bent
boundary has no single `spine` line in transient analysis metadata; its full
`across` list names both creases. Saved steps still use material witnesses and
need no format migration. The ordinary fold arrow remains; no misleading
single-edge push arrow is drawn for a bent pocket.

## Validation

- Before the fix, the synthetic two-corner-fold regression offered two openings
  and failed its one-pocket assertion. The ignored Heart snapshot reproduced
  `[1, 3] / [4]` and `[1, 4] / [3]`, reversing one roof edge each.
- Afterward the copied Heart has one opening `[1] / [3, 4]`, both roof edges
  `[7, 8]`, inside as its only feasible kind, and no opening/order prompt.
- All 18 original nodes replayed unchanged. Appending the actual Axiom 2
  tip-to-waist operation and reading its JSON into a fresh engine reproduced
  fingerprint `fs1:4dd1c4a1eea7e29a`. The external Heart was never written.
- Native regression checks inspect the four-layer stack on **both** sides after
  folding: stationary front, moved front, moved back, stationary back. They also
  check full state validity, both hinge reversals, precrease subdivisions,
  rotation/turnover, and saved replay.
- The real-WASM React canvas test clicks tip then waist using Axiom 2, confirms
  no opening chooser, commits, and freshly replays the saved sequence.
- `cargo test -p oristudio-fold -p oristudio-fold-wasm`: **471 passed**.
- `npx vitest run src/fold` after the final WASM rebuild: **143 files,
  1,065 tests passed**, including existing true-opening, outside-reverse and
  design-completion flows.
- `cargo fmt --check`, targeted Clippy with `-D warnings`, web typecheck,
  web lint and `git diff --check` passed. Existing warnings remain for the
  toolchain's unknown Clippy lint and the timeline's React virtualization hook.
- Rebuilt the Fold WASM bridge with its npm build script; the persistent server
  is healthy at `http://localhost:5328/fold`. Other engines, production bundling,
  desktop packaging and upstream oracles were not rerun: their code and contracts
  are unchanged by this original Fold-engine correction.

Reproduction inputs, scripts and logs are ignored under
`artifacts/heart-reverse-connected/`; only synthetic regressions are source files.
