# Axiom 6 point alignments in Diagram

## Goal

Show both point-to-line alignments when an imported Axiom 6 fold creases new paper. A fold entirely along existing creases keeps its usual arrow and caption.

## Approach

Check the creases on the sheet before and after the step. Split creases keep their creation step, and earlier partial marks can cover any or all of a new edge. When a fold adds a new stretch, draw arrows from the two source points to their reflections across the chosen fold line and circle the endpoints. A fold that extends a picked crease can use the original construction when both points still land on their indicated lines.

## Affected Areas

Fold-to-Diagram mark placement, capture, import cards, translated instructions and regression tests.

## Checklist

- [x] Locate the original Axiom 6 precreases and the later fold along a crease in Star Garland.
- [x] Place the two arrows and their endpoint circles on new and partly precreased folds.
- [x] Use the direction-specific instruction for those alignments and the ordinary caption for fully precreased folds.
- [x] Verify both imports in Star Garland and cover full and partial reuse in engine-backed web tests.
