# Fold workspace research: working reports

These are the reports behind
[`../2026-10-08-fold-workspace.md`](../2026-10-08-fold-workspace.md) and
[`../../implementation-plans/fold-workspace.md`](../../implementation-plans/fold-workspace.md).
Each was written by one research or spike agent and is kept as it was written,
so that every citation in the plan and the research document points at
something a reader can open.

They are working notes, not edited documents. Where a report and the research
document disagree, the research document wins: it was corrected after an
adversarial review. The spikes the reports describe live in the gitignored
`artifacts/fold-spike/` of the worktree that ran them. They were throwaway code;
the numbers are recorded here.

| Round | File | What it covers |
|---|---|---|
| 1 — codebase | `r1-cp-folded-figure.md` | Oriedita-derived flat folded figure in `oristudio-cp`; seeding; tolerances |
| 1 — codebase | `r1-flatfold-and-fold-format.md` | Flat-Folder port, FOLD structures, multi-frame export |
| 1 — codebase | `r1-folding3d-sim-animation.md` | 3D folded states, simulator, animation options; the reverse-fold rigidity derivation |
| 1 — codebase | `r1-precrease-axioms.md` | O1–O7 in precrease / Oriedita / ReferenceFinder; step model; card rendering |
| 1 — codebase | `r1-web-workspace-shell.md` | Workspace touchpoints, persistence, engine pattern, canvas |
| 1 — codebase | `r1-diagram-integration.md` | Diagram (PR #436 at 31e1d6d84) data model; the `fold-step` link proposal |
| 1 — prior art | `r1-theory.md` | Axioms, simple folds (ADK 2017), layer-order validity, classical folds |
| 1 — prior art | `r1-software.md` | Beloch, Rabbit Ear, Eos, Miyazaki, ORIZU, OE3D, Orimath, … |
| 1 — prior art | `r1-state-representation.md` | Representation options, FOLD sequences, numerics |
| 2 — spike | `r2-spike-core.md` | Plain-fold rule, verified on 52,937 ops; numerics; performance |
| 2 — prior art | `r2-beloch.md` | Beloch deep-read; its fixtures verified by Flat-Folder |
| 2 — spike | `r2-spike-reverse-crimp-tuck.md` | Reverse folds, crimps, tucks: rule vs completion |
| 2 — spike | `r2-spike-squash-petal-rabbit.md` | Squash, petal, rabbit ear, swivel; preliminary and bird bases |
| 2 — spike | `r2-spike-sinks.md` | Open and closed sinks, unsink; the crease-pattern importer |
| 3 — reuse | `r3-reuse-solver.md` | Oriedita vs Flat-Folder on 2,752 Fold states |
| 3 — reuse | `r3-reuse-geometry-cp-io.md` | Shared geometry crate probe; kernel boundary; Import CP; marks; FOLD export |
| 3 — reuse | `r3-reuse-rendering-paper.md` | Paper settings flow; painting spike; canvas, picking, guides, animation |
| 3 — reuse | `r3-reuse-ui-design-system.md` | The design mapped to existing components; keyboard |
| 3 — reuse | `r3-reuse-steps-documents.md` | Step tree, document envelope, history, Diagram and References links |
