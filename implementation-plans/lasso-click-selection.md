# Lasso click selection

## Goal

A click (press with no drag) while a lasso select/deselect tool is armed applies
that tool to the crease under the cursor, the way Box Select already does:

- **Lasso Select** — a plain click takes just that crease; `Shift`+click adds it
  to the selection, or removes it when it is already in.
- **Lasso Deselect** — a click takes that crease out of the selection and leaves
  an unselected one alone.

Today a click with either lasso tool does nothing at all: the `drag-path` engine
needs two points to commit, and no click behaviour is declared for those
operations, so the release falls through with the gesture discarded.

## Approach

The region-select tools — Box Select/Deselect and Lasso Select/Deselect (plus
the hidden polygon pair) — are one family: a dragged region that selects or
unselects the creases it takes in, differing only in the region's shape. A click
has no region at all, so it means the same thing in every one of them. Name that
family and its click direction once, in `cp-workspace/tools/predicates.ts`, and
route every one of them through it.

Upstream owns the box half of this rule: `BoxSelectStepNode.runReleaseAction`
runs the box action only for a gesture that moved, and otherwise applies the tool
to the crease nearest the cursor. Upstream's lasso has no click behaviour —
`BaseMouseHandlerLasso.mouseReleased` closes a degenerate path and selects
nothing — so extending it to the lasso pair is a product decision, consistent
with the modern-selection divergences these tools already carry (a plain lasso
drag replaces the selection; upstream's is always additive).

The click mutates the **selection store** rather than running a kernel select
command. That is what Box Select's click has always done, and it is the only
path that composes with itself: the kernel keeps its own `selected` flags, a
kernel select rebuilds the whole store selection from those flags, and the flags
have never seen a click. Running Box **Deselect**'s click through the kernel is
why a click there drops every crease that was clicked into the selection — and
marks the document dirty for what is only a selection change. Moving all four
tools onto the store path fixes that as a direct consequence.

Out of scope, reported separately: a region *drag* still resolves kernel-side
and so still drops click-made selections when `Shift` makes it additive
(reproducible on `main` with Box Select alone — click a crease, `Shift`+click
another, then `Shift`+drag a box over a third: only the third survives). Fixing
that needs the command payload to carry the UI selection into the kernel.

## Affected Areas

- `apps/web/src/cp-workspace/tools/predicates.ts` — the region-select family
  predicate, and `toolClickAction` for the lasso/polygon operations so the canvas
  routes their clicks at all.
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — one click branch for
  the whole family, replacing the CreaseSelect-only one.
- `apps/web/src/store/workspaceStore/` — an "unselect this one crease" action,
  which the toggles cannot express (a toggle would *add* an unselected crease).
- Tests: `predicates.test.ts`, `store.test.ts`.

## Checklist

- [x] Confirm the current behaviour in the browser (lasso click is a no-op; box
      deselect's click wipes click-made selections)
- [x] `regionSelectionClick` + `creaseClickSelection` predicates
- [x] `toolClickAction` covers the lasso and polygon select/deselect operations
- [x] `unselectOristudioCpLine` store action
- [x] Panel routes the whole family through one click branch
- [x] Unit tests for the predicates and the store action
- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [x] Browser verification of both lasso tools
- [x] Draft PR against `main`
