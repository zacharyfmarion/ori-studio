# CP detection: snap box-pleated patterns to their grid

## Goal

A box-pleated design is drawn on a square grid: every vertex on a grid point,
every crease along a grid line or a cell diagonal. A detection of one lands
within a pixel or so of that grid at nearly every vertex, which is close enough
to read the grid from and not close enough to be the design. The creases miss
the grid lines by a fraction of a pixel, which the checks, the folder and the
editor's grid snapping all see.

Give the Detect CP dialog a **Snap to grid** option for patterns that read as
box-pleated: creases near the grid are put exactly on it in what the dialog
shows and adds.

## Approach

### UX

- **Offered only when the detection reads a grid.** The toggle appears in the
  review step's action row, after Detect and before the buttons that add, and
  names the grid it snaps to: `Snap to grid  32 × 32`. It is the dialog's
  pressed-toggle idiom (the preview's Inferred / M/V changes toggles).
- **On by default.** A box-pleated design is drawn on its grid, and on real
  detections the snap is a large, safe gain (below).
- **Placed where nothing it causes moves it.** Flipping it can start a solve,
  and the verdict above the previews changes length with the solve; the action
  row sits above the verdict, and the toggle sits before the add buttons, which
  come and go with the solve.
- **The preview shows the grid.** While snapping, the Detected preview draws
  the grid's interior lines faintly behind the creases, so the reading can be
  checked by eye.
- **What is added is what is shown.** Review & Fix and Add as-is add the
  snapped candidate; Add adds the solver's answer, snapped where it still folds
  flat. The improved and partial results stay as the solver left them: snapping
  them unjudged would put geometry the verdict did not describe into the
  document.
- **It never trades flat-folding for the grid.** An exact solve is snapped only
  if it stays exact; when it would not, the verdict says so in one sentence:
  "It is not snapped to the 32 × 32 grid: on the grid it would no longer fold
  flat."
- **The flip costs a solve only where the two positions can disagree:** an
  exact answer the solver snapped. Every other ending is the same answer either
  way, and the candidate's snap came with the recognition, so those flips are
  instant; a solved answer for each position is kept for the session.

### Engine

- `oristudio_cp_compiler::box_pleat_grid`: `read_box_pleat_grid` says whether a
  detection is box-pleated (≥ 90% of its creases of 12 px or more within 3° of
  a multiple of 45°, with at least 20 voting) and on which grid (the coarsest
  with ≥ 95% of the pattern's coordinates within 1.5 px, read by
  `lattice::dominant_square_lattice`, the same reading the solver's
  partial-lattice fallback uses — that proposal now calls it).
  `snap_to_box_pleat_grid` moves each coordinate within the tolerance onto its
  grid line, a boundary contact only along its side, never a corner, and never
  two vertices onto one point.
- Recognition reports `compiler_report.box_pleat_grid` (the grid and the
  candidate's snapped vertices; the FOLD's copy drops the vertex list).
- `ExactSolveOptions::grid_snap` (`Off` by default, `BoxPleat` from the dialog):
  after an exact solve, snap the answer to the read grid and then its multiples
  (up to 4×, a sixth of a cell at a multiple), and keep the first snap
  `judge_original` still calls exact. Reported as `movement_report.grid_snap`.

### Measured (September recognition archive, truth read only to score)

- Snapping before the solve, with the snapped vertices pinned, was rejected: it
  ran in 0.07 s against 1.33 s, and produced four silent wrong answers (exact,
  not the designer's pattern). Solve, then snap, then judge invents nothing.
- The reading: 93 of 526 real patterns read as box-pleated, 83 of them on a
  grid in truth and the rest hybrids that mostly are. The family vote is what
  makes it specific: coordinates alone read a grid on 134 of the 435 that are
  not box-pleated.
- Unsolved candidates: on the 58 pure box-pleated designs, 2.9% of detected
  vertices sit exactly on the truth's, 98.0% after the snap, none moved away.
  Over all admitted patterns, 51,934 vertices better and 57 worse, no pattern
  net worse; 1.5 px is the knee (2.5 px adds 0.1% and doubles the losses).
- Exact solves: all 86 stay exact; 6 snapped (forest fairy 0.70 → 1.00 of its
  vertices on the truth's, swan 0.01 → 0.95), 8 refused and kept as solved;
  vertices on the truth's 0.966 → 0.983; no answer made less faithful; extra
  time p90 0.19 s, max 0.58 s.

## Affected Areas

- `crates/oristudio-cp-compiler/src/{box_pleat_grid.rs, lattice.rs, exact_solve.rs, exact_solve/grid_snap.rs, exact_solve/recognition.rs}`
- `crates/oristudio-cp-detect/src/decode.rs` (the recognize report)
- `apps/web/src/engine/{cpDetectTypes.ts, cpExactSolve.ts, cpExactSolveTypes.ts, cpDetectNativeClient.ts}`, `apps/web/src/workers/cpDetectWorker.ts`
- `apps/web/src/components/{CpDetectImportModal.tsx, CpDetectGridSnapToggle.tsx, CpDetectGridLines.tsx, cpDetectCandidateFold.ts}`
- i18n (`dialogs:cpDetectImport.snapToGrid`, `gridSize`, `verdict.gridSnapRefused`, `verdict.gridSnapOutOfTime`), `docs/analytics.md` (`grid_snap` on `cp detect imported`)

## Checklist

- [x] Measure the snap on real detections and choose its semantics (judged, after the solve)
- [x] Grid reading and snap in the compiler, with tests
- [x] Shared coarsest-supported-lattice reading; partial-lattice proposal uses it
- [x] Judged `grid_snap` solve option, with grid multiples, with tests
- [x] Recognize report carries the grid and the candidate's snap
- [x] Dialog: toggle, grid lines, snapped candidate, verdict sentence, cached flips
- [x] Analytics property and docs
- [x] Translations for the eight locales
- [x] Verify on real box-pleated images in a browser
- [ ] Follow-up: set the editor's grid to the detected size when the import lands on a blank canvas
- [ ] Follow-up: the same judged snap for region solves in the document (Review & Fix)
