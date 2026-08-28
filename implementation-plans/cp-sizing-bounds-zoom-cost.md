# CP Sizing Bounds Zoom Cost

## Goal

Take the stroke-sizing reference off the per-render path. `cpSizingBounds` was
~45% of all JavaScript in a zoom profile of a real crease pattern, which is a
regression from `2ce41e76` (PR #315). Keep its trimming semantics bit-identical:
the poisoned-document behaviour it exists for must not change.

## Approach

The profile put ~1.9s of a 6.4s trace in `trimmedExtent`'s `Array.sort` and its
comparator, reached through a `useMemo` in `CreasePatternWebglCanvas`. Renderer
main was 66% busy against the GPU process' 20%, so this is JavaScript-bound —
the inverse of the two previous CP camera investigations, which were both
paint-bound. Three independent costs, fixed separately:

1. **It recomputed per render.** The memo keys on
   `[lineSegments, images, overlayBoxes, foldedFigures, modelToSvg]`, and the
   three object arrays are rebuilt per render. `lineSegments` is *not* — the
   sibling `hitIndex` memo, which keys on it alone, never recomputed in the
   trace. So the expensive crease half is split onto `[lineSegments, modelToSvg]`
   and the cheap placed-object half keeps the churning deps.
2. **It projected every endpoint before selecting.** `modelToSvg` is applied per
   axis and monotonically, so order survives it. Select in model space and
   project the two resulting corners instead of 2N points.
3. **It sorted for two order statistics.** Quickselect is O(n) where the sort was
   O(n log n).

(1) is what fixes zoom. (2) and (3) still matter because the memo legitimately
recomputes on every document edit, which is once per stroke while drawing.

## Affected Areas

- `apps/web/src/cp-workspace/cpContentBounds.ts`
- `apps/web/src/cp-workspace/cpContentBounds.test.ts`
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx`

## Checklist

- [x] Split `cpTrimmedCreaseBounds` out of `cpSizingBounds`
- [x] Select in model space; project the two corners
- [x] Replace the sort with quickselect
- [x] Split the canvas memo so the crease half keys on geometry alone
- [x] Tests: quickselect matches a sort-based reference; axis-flipping transform;
      partially non-finite segments; existing trim semantics unchanged
- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [ ] Re-profile a production build to confirm the sort is gone from the zoom path
