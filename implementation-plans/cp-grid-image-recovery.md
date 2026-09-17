# Recover mixed grid constructions using image evidence

## Goal

Root-cause and correct the Halberd Knight's residual grid errors after a correct
crop, and improve complete-reference recovery beyond S070's 285/421 at 1e-9
and 276/421 at 1e-12, within the shared 25-second browser budget. Knight has no
ground truth; establish confidence through structural and image checks without
claiming unavailable reference equality.

## Approach

Freeze S070 and reproduce the saved corrected recognition graph plus a fresh
recognition with an accurate crop. Trace which grid/direction constraints are
missed or lost. Test general mixed-grid construction propagation and direct
image scoring in isolated experiments, retaining rejected results. References
are evaluation only; no real-pattern training or truth-informed proposals.
Compare per-case gains and losses on the unchanged 421-case gate, with AUX,
pins, old desktop compatibility, and timing preserved.

## Affected Areas

- Original CP compiler recovery and recognition fallback.
- Image evidence and crop-to-paper coordinate calibration.
- Research scripts, experiment notes, and browser validation.

## Checklist

- [x] Freeze and reproduce Knight and S070 benchmark baseline.
- [x] Diagnose missed grid, direction, and construction constraints.
- [x] Test direct image scoring against independent reference evaluation.
- [x] Implement general corrections and synthetic regression coverage.
- [x] Verify fresh Knight geometry, source alignment, and folded wireframe; document the older saved-graph limitation.
- [x] Replay full native/browser benchmarks with exact recovery and timing.
- [x] Run affected validation.
- [x] Update the existing PR and archive evidence without merging.

No cloud resources, model publication, or merge is part of this work. Preserve
the existing evidence archive; new experiments get separate artifact paths.
