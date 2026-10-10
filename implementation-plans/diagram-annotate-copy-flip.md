# Diagram Annotate: line type on top, copy and paste, flips

## Goal

Zach, 2026-10-05, after Phase 15:

1. "Can you put line type at the top? Same as how fold type is at the top in
   the edit workspace."
2. "I want to be able to copy and paste all the objects. And there should be
   an option to flip them horizontally or vertically in the right hand side
   when selected. cmd + c and cmd + z should work."

Read as: every kind of annotation can be copied and pasted with ⌘C and ⌘V
(and cut with ⌘X), each undone with ⌘Z; the selected annotation can be
flipped horizontally or vertically from the Step pane. One annotation at a
time: Annotate selects one (multi-select is a question for Zach, below).

## Approach

1. **Line Type heads the rail**, above Select and Edit Path, as Edit's line
   types are its rail's first group (`order: 5`).
2. **Flip Horizontal and Flip Vertical** for the selected annotation: a Flip
   row in the Step pane, its two verbs in the annotation catalog
   (`annotationActions.ts`), each one undo step. A flip mirrors the mark as a
   mirrored picture carries it (`carryAnnotation` with a mirror): an arc bulges
   the other way, a rotation turns the other way, a pleat's Zs step to the
   other side, a label's words stay upright. About what it is drawn round: an
   arrow or a line about its middle, so it stays where it is; any other mark
   about the point it is anchored to — a right angle's corner, an angle mark's
   vertex, a callout's point (its box goes over to the other side), a
   close-up's area (the close-up goes over); a circle, a label and a sign are
   their point, and stay. Named as Edit names its flips ("Flip Horizontal").
   No keys, as Edit's have none. Counted: `diagram annotation flipped`
   {tool, axis}.
3. **Copy, Cut and Paste** through the Edit menu and its keys, in Annotate:
   - The workspace clipboard (`clipboardSlice`) gains a third kind,
     `diagram-annotations`: the annotations as they were, and how many times
     they are already on each step (the step a copy came from counts its
     original). Copy and Cut need an annotation selected (Cut a diagram that
     can change); Paste a step open in Annotate that can change, and
     annotations on the clipboard.
   - Paste puts fresh copies on the step open in Annotate and selects the
     first, Select in hand (Edit Path kept), as a press on the list does. Into
     another step, in place — the same place on its picture, so a mark carried
     from step to step lands where it was; into the step it came from, down
     and right by 0.03 of the frame so it shows; each further paste into the
     same step a further 0.03 on, so repeats never stack.
   - Cut is Copy, then Delete's edit.
   - Each is one undo step on the Diagram's own history (⌘Z), as every
     annotation edit is.
   - Until now the three were hidden in the Diagram, and the store's clipboard
     answered every context but the crease pattern with the TreeMaker tree:
     the Diagram never reached it only because its capabilities were off. The
     Diagram now has its own branch.
   - Counted where every menu action is (`command invoked`), not again.

## Affected Areas

`components/diagram/DiagramAnnotateRail.tsx`; `diagram/annotate/annotationModel.ts`
(`flipAnnotation`), `annotationActions.ts`, new `annotationClipboard.ts`;
`components/diagram/DiagramStepAnnotations.tsx`; `diagram/annotate/useStepAnnotations.ts`;
`store/workspaceStore/slices/clipboardSlice.ts`, `types.ts`, `capabilities.ts`,
`useWorkspaceCapabilities.ts`; `lib/workspaceCapabilities.ts`; `analytics/`,
`docs/analytics.md`; the nine catalogs.

## Questions for Zach

- **Several at once.** "Copy and paste all the objects" is read as every kind.
  If it meant a step's marks all together — select several, or all, and paste
  them on the next step — that is multi-select in Annotate (Shift-press,
  ⌘A), which the clipboard is shaped for (it holds a list) but the selection
  is not.

## Checklist

- [x] Line Type at the top of the rail; before/after.
- [x] `flipAnnotation`, the catalog's two verbs, the Step pane's Flip row
  (since moved, with the list, to the Layers pane:
  [`diagram-layers-pane.md`](diagram-layers-pane.md)),
  analytics, i18n, tests; before/after on the crane.
  - As built: the Flip row's two buttons are icons — the mirror marks Edit's
    toolbars use — named "Flip Horizontal" and "Flip Vertical" by their
    tooltips and for a screen reader: the Step pane is about 280 px wide, and
    two labelled buttons stacked one over the other there. Each is held
    (`flipChangesMark`) where the mark would turn over onto itself, as a level
    line top to bottom. Found on the way: a mirrored picture left an arc
    written without a bend bulging the same way (`carryAnnotation` only
    negated a bend that was spelled out); an arc's own 60° is turned over now.
    Files and new arrows always write one, so no saved diagram changes.
- [x] The clipboard's Diagram branch: copy, cut, paste (placement, ids,
  selection), capabilities and the Edit menu, i18n, tests; ⌘C, ⌘V, ⌘X and ⌘Z
  with a real keyboard on the crane, from step to step.
  - As built: a cut annotation's clipboard counts no step, so its first paste
    puts it back where it was, even on its own step. In the Diagram the three
    verbs answer to the Diagram alone: a crease pattern's selected lines, or
    its copied ones, left in Edit once made Copy and Paste read as on there
    (found by the capability test, before anything shipped).
