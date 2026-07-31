# Inline Simulate from the Non-Flat Fold Dialog

## Goal

When folding a selection that contains creases with a non-180 fold angle, the CP
editor raises "This pattern isn't flat-folded" and offers **Simulate**. Today that
button calls `activatePanel('simulator')`, which throws the user into another
workspace. It should instead open an inline simulation window over the crease
pattern — the same result as the selection toolbar's "Simulate inline" action —
so the answer appears beside the pattern the question was asked about.

## Approach

The inline path already exists (`addOristudioCpInlineSimulation`), but it needs a
`CpSegment`, and the only code that resolves one from a crease selection lives
inside the React hook `useSimulateSelection`. `foldOristudioCpDocument` is a store
action and cannot call a hook.

Extract the resolution — which is already React-free — into a shared module and
call it from both places:

- New `cp-workspace/inlineSimulation/resolveSimulationRegion.ts` resolves a set of
  1-based crease ids to the single border-enclosed region they exactly constitute,
  ensuring the segmentation-only artifacts on the way (the peek/ensure dance the
  hook does today).
- `useSimulateSelection` keeps its toasts and delegates resolution to it, so the
  toolbar and `Shift+S` behaviour is unchanged.
- `foldOristudioCpDocument` resolves the region from the ids the fold was scoped
  to — `options.lineIds`, which the toolbar passes as the region's own crease ids —
  and opens the inline window.

The fold action is also reachable from the folded-figure inspector, where the
selection is an arbitrary set of foldable creases rather than a whole region. When
no region resolves (or the window cap is reached) the dialog falls back to
`activatePanel('simulator')`, today's behaviour, so the button is never dead.

Reporting stays where it is: the store does not toast (see the comment in
`addOristudioCpInlineSimulation`), so the fallback is how the store path degrades
rather than a new message channel in a slice.

## Affected Areas

- `apps/web/src/cp-workspace/inlineSimulation/resolveSimulationRegion.ts` (new)
- `apps/web/src/cp-workspace/inlineSimulation/useSimulateSelection.ts`
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts`
- `apps/web/src/store/workspaceStore/store.test.ts`
- `apps/web/src/cp-workspace/inlineSimulation/resolveSimulationRegion.test.ts` (new)

## Checklist

- [x] Add the shared region resolver
- [x] Delegate `useSimulateSelection` to it, unchanged behaviour
- [x] Open the inline window from the non-flat fold dialog, falling back to the
      Simulate panel when no region resolves
- [x] Unit-test the resolver
- [x] Store-test that confirming the dialog adds an inline simulation and does not
      activate the simulator panel
- [x] Lint, typecheck, and web unit tests
- [ ] Draft PR against `main`
