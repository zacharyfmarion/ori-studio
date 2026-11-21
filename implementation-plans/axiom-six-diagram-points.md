# Axiom 6 point alignments in Diagram

## Goal

Show both point-to-line alignments of an imported Axiom 6 fold, including the Star Garland step that folds along an earlier precrease.

## Approach

Use the chosen fold line in the picture before the step to place two arrows and circle their endpoints. For a fold along an existing crease, use the operation that made that crease on the same branch and check that its two points still land on their indicated lines. Use the same construction for the import card and captured step.

## Affected Areas

Fold-to-Diagram mark placement, capture, import cards, translated instructions and regression tests.

## Checklist

- [x] Identify the construction behind Diagram step 7 in the supplied project.
- [x] Place both arrows and the source and landing circles.
- [x] Generate the direction-specific instruction for direct and reused constructions.
- [x] Verify the garland example and run web checks.
