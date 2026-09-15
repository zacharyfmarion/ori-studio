# Text box height resize

## Goal

Dragging a text box's top or bottom handle should shrink or grow the box
around its content — the text stays put and the box changes under it — instead
of sliding the text off the selection frame.

## Approach

A text box's height is a *floor*: the box is at least `minHeight` tall and
grows downward when the content outgrows it. The DOM layer sizes the box by
that floor (`min-height`), never by `height`. A handle drag, though, wrote only
`height` and `center` — so the DOM box kept its old floor and, centred on the
moved centre, slid by half the delta while the selection frame shrank.

Two changes, one per defect:

1. A resize that carries a height writes it to `minHeight` as well, through a
   pure helper in `annotations/textAnnotation.ts` that the hook's
   `applyBoxUpdate` applies for text boxes. The box then renders at the dragged
   height when the content fits, and at the content height when it does not —
   content is never hidden, which is the floor's existing contract.
2. The layer's height sync re-runs when the *model* height or floor changes,
   not only when the DOM box resizes. A drag below the content height leaves
   the DOM at the content height (no resize event) while the model holds the
   smaller number; the extra trigger reconciles them so the selection frame
   matches the ink.

## Affected Areas

- `apps/web/src/cp-workspace/annotations/textAnnotation.ts` — resize patch helper.
- `apps/web/src/cp-workspace/annotations/useCpAnnotations.ts` — apply it for text.
- `apps/web/src/cp-workspace/CpTextAnnotationLayer.tsx` — sync on model height change.
- Unit tests beside each.

## Checklist

- [x] `textBoxResizeUpdate` helper + tests.
- [x] `applyBoxUpdate` routes text-box resizes through it.
- [x] Layer re-measures on `height` / `minHeight` change + test.
- [x] Browser verification: bottom-handle shrink keeps the text in place; shrink below content snaps to content height; top-handle shrink.
- [x] lint, typecheck, unit tests.
- [ ] Draft PR.
