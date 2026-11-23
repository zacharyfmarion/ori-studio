# Reverse folding through a swivel vertex

## Goal

Explain the all-layer inside reverse refused after a fold in half through two swivelled walls. Verify a candidate against the saved origami.me sequences.

## Approach

Reconstruct the unsaved point-onto-point operation from the saved parent and the screenshot. The moving-side traversal stops at the new hinge. At each swivel vertex it therefore finds a separate pleat. At the full ten-ply overlap, a ply of one pleat lies between two faces of a pocket wall. Opening all three flaps independently keeps the pleat between those faces in their original order, while turning over the wall requires the opposite order.

Carry an attached pleat with its wall when there is one pocket spine continuing through the hinge, the pleat ends at a shared material vertex, and the independent plan has that ordering contradiction. Check the separation of both enlarged walls and their stationary material before using the existing completion and validity checks. Retain the chosen opening’s original sheet witnesses for replay.

## Affected Areas

The Fold engine's reverse-fold planner and its regression tests.

## Checklist

- [x] Replay the supplied file to its saved parent and reproduce the refusal.
- [x] Verify which plies move together and test the proposed correction.
- [x] Compare baseline and candidate replays of all external corpus models.


## Validation

The app replayed the ten saved nodes to their fingerprints. Before the change, all five opening choices refused both kinds. With the right corner moving onto the bottom point, the center opening now lands inside. The moving segment of the fold-in-half crease reverses and both swivel pleats keep their crease assignments. A fresh replay of the saved result gives `fs1:03084a38170b892b`.

A four-operation synthetic setup exercises the exact hinge and a precrease on that hinge. It checks the material in stack order, the crease that reverses, the valid flat state, the refused outside kind and the stored opening.

Rebuilt baseline and candidate Fold WASM engines were compared through the app’s project sequence reader and replayer over the external corpus. All 271 files, 275 sequences and 6,999 saved step outcomes matched, including all 218 reverse folds. The 117 fingerprint mismatches and 445 broken or blocked steps already present in private working files had identical outcomes on both builds.
