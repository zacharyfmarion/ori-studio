# Fold: list only reverse-fold openings that land

## Goal

The Reverse fold and Crimp tools' Opening stepper lists every geometric way a
tip opens, in the engine's scan order, and asks which kinds land only for the
way on screen. On real tutorial models the first listed way is almost never
the designer's (1 of 44 multi-opening reverse folds in a private corpus), most
listed ways land only as the other kind, and some land as neither. Separately,
the Layers section disappears whenever the fold is refused through the order
resolution, so a flap that was deselected cannot be reselected without
Cancel. Fix both, and stop the folder from deselecting a flap the fold cannot
land without.

1. The engine decides, in the tool's one ask, which kinds land for every way
   the tip opens (tri-state, under a deadline), and which tip flaps cannot be
   left out.
2. The stepper lists only the ways that land, the even split first.
3. The Layers section stays on screen when the fold is refused.
4. A flap the fold cannot land without is locked in the window.

## Approach

- **Engine (`crates/oristudio-fold/src/compound/reverse.rs`, `crimp.rs`).**
  Factor the plan-building half of `Tip::choose` into `Tip::plan`, which
  builds a plan from per-flap opening indices. A new `Tip::landings` (child
  module `reverse/landings.rs`) computes the tip once, enumerates the ways in
  `reverseOpenWays`' product order (last flap fastest), capped at
  `MAX_WAYS = 256`, and decides each way's Inside and Outside landing as
  `Option<bool>` through tri-state `Prepared::landing` /
  `Prepared::landing_flipped` (the boolean `lands` / `lands_flipped` become
  `== Some(true)` of them). Ways are decided most-even first, so a deadline
  that runs out leaves the least likely ways undecided; they are reported in
  product order. Locked flaps: for a tip of two or more flaps that lands some
  way, each flap left out is tried (`Tip::new` without it) until one of its
  ways lands; a flap none of whose ways lands for either kind is locked, one
  the deadline leaves undecided is not. The reverse fold and the crimp share
  the code through a small trait (`Opens`): its tip, its prepared fold of a
  plan, and itself without a flap.
- **Bridge (`ops_reverse.rs`, `ops_crimp_tuck.rs`).** The reverse and crimp
  asks add `landings: { ways, more, locked }` when the choices name no
  opening, decided under a 150 ms deadline exactly like Tuck's target
  listing. `ways` is filled only when some flap opens several ways. Additive
  wire field; saved steps still store the same `opening` choice.
- **Tools (`fold/tools/reverse/reverseStep.ts`).** `reverseLandingWays`
  builds the stepper's list from the analysis and the landings: decided ways
  where the kind in play lands (requested kind, or either on Automatic),
  most even first (sum of |lower − upper| faces over the choosing flaps),
  then Inside-landing before Outside-only, then product order; then
  undecided ways (and ways past the cap) in product order; never a decided
  way that lands as neither. When the requested kind lands nowhere but the
  other does, the other kind's ways. When nothing lands and nothing is
  undecided, one way (the first) so the refusal names an opening. Same
  `FoldReverseWays` shape, so the window stepper and the canvas chooser step
  the same list. A kind change keeps the way on screen (`openingForKind`).
- **Preview (`useFoldToolPreview`).** When the order resolution refuses and
  leaves no step, the base step is analysed for its layers through the
  existing `layersAsk` path, only when `foldPreviewWants(op).analysis`.
  Never previewed, so nothing treats it as a landing.
- **Window.** `FoldPreview.locked` (section flap indices); `foldFlapChips`
  and `foldSectionPicker` mark a picked locked flap; `FoldFlapChips` renders
  it `aria-disabled` with a dot and the app's Tooltip, the picker's row
  `aria-disabled` with the same dot; the canvas verb `toggleFlap` refuses to
  unpick a locked flap whatever the path.

## Affected Areas

- `crates/oristudio-fold/src/compound/{mod.rs,reverse.rs,reverse/landings.rs,crimp.rs}`, `src/lib.rs`
- `crates/oristudio-fold/tests/reverse_landings.rs`
- `crates/oristudio-fold-wasm/src/{ops_reverse.rs,ops_crimp_tuck.rs}`
- `apps/web/src/fold/engine/{foldEngineReverseWire.ts,foldEngineCrimpTuckWire.ts}`
- `apps/web/src/fold/tools/reverse/reverseStep.ts`, `fold/canvas/{useFoldReverseStep.ts,useFoldCrimpStep.ts,useFoldToolPreview.ts,useFoldCanvasVerbs.ts,foldCanvasModel.ts}`
- `apps/web/src/fold/tools/{crossSection.ts,foldToolWindow.ts}`
- `apps/web/src/components/fold/{FoldFlapChips.tsx,FoldCrossSectionPicker.tsx}` and their modules, `components/ui/Chip.module.css`
- `apps/web/src/locales/*/tools.json`

## Checklist

- [x] Engine: `Tip::plan` factored out of `Tip::choose`; tri-state `Prepared::landing(_flipped)`
- [x] Engine: `State::reverse_landings` / `State::crimp_landings` (ways, cap, undecided, locked)
- [x] Engine tests: several openings' landing kinds, cap/undecided, locked flaps (8-ply corner)
- [x] Bridge: reverse and crimp asks carry `landings` under a 150 ms deadline
- [x] Wire types mirrored in TypeScript
- [x] Tools: `reverseLandingWays` ordering/filtering, used by reverse and crimp; kind change keeps the way
- [x] Preview: Layers stay on a refused opening
- [x] Window: locked chips and rows, tooltip, i18n in every locale
- [x] Web tests: ordering/filtering, Layers on refusal, locked chip
- [x] Rust fmt/clippy/tests; web lint/typecheck/relevant vitest
- [x] Corpus replay identical to main; stepper re-measured
- [x] Draft PR
