# Crease-pattern recognition research

Started 2026-09-16 from `e042b18a`, on `codex/cp-recognition-research`.
The compact synthetic-only candidate is implemented as a local preview.
It substantially improves recognition but does not perfectly recover all complex
patterns. It has not replaced the published model.

- [Results and limitations](results.md): matched comparisons, runtime, remaining failures.
- [Chronological notebook](2026-09-16-log.md): decisions and negative results.
- [Candidate identity](candidate.json): checkpoint, ONNX, and training provenance.
- [Reproduction](../../scripts/cp-detect/research/README.md): commands and local artifacts.
- [Implementation plan](../../implementation-plans/cp-recognition-research.md).

## Research contract

- Target 3–5× fewer recognition errors, exact complex graphs, and roughly one
  minute in the browser. Report recognition and exact solving separately.
- Real patterns are evaluation-only: no training, distillation, or pseudo-label
  training on them. All new weights descend exclusively from generated geometry.
- The shipped model remains defined by `scripts/cp-detect/current-model.json`.
  `candidate.json` describes this unpublished research candidate only.
- Use the latest `curated_benchmark` and external `real_benchmark` folder.
  Preserve the curated/rendered distinction and count failures in denominators.
- Freeze inputs, metrics, and a geometry-grouped development/holdout split.
  This is an internal holdout: earlier product research used the whole corpus.
- Never weaken metric tolerances or remove hard cases to claim improvement.
  Keep private images, truth, and per-case artifacts outside Git.
- Keep cyan AUX as separate F geometry. Do not interpret it as valley folds or
  silently remove it from the imported document.

## Experiment register

| ID | Question | Outcome |
| --- | --- | --- |
| E000 | Fresh baseline and recent research audit | Complete; metrics and provenance frozen |
| E001 | Overlapping 2× sampling of the old network | Mixed; rejected blanket replacement |
| E002 | Model-free skeleton tracing and PCA | Poor graph recovery; rejected |
| E003 | Cache repeated scoring and candidate priorities | Adopted; unchanged graphs, runtime gain |
| E005 | Stride-one synthetic vertex/crease/AUX network | Feasible; corrected initial evaluation coordinate error |
| E006 | Compact model without the old network | Adopted; source-color M/V and separate AUX |
| E007 | Synthetic editor grids, wider strokes, resampling | Improved development results; final training initialization |
| E008 | Vectorize learned AUX into straight segments | Adopted in Rust/WASM; F survives recognition and solving |
| E009 | Full development set with adaptive resolution | Positive; revealed giant timeouts and dark-style failure |
| E010 | Dark-mode synthetic fine-tuning | Not selected; chroma-preserving normalization fixed observed failure |
| E011 | Cache local score contributions during parity repair | Adopted; exact score parity and large-case speedup |
| E012 | Direct pixel-evidence adapter and complete replay | Adopted; removed legacy-network dependency |
| E013 | Longer synthetic training, including dark styles | Step 9000 selected by synthetic validation |
| E014 | Remove old baseline's truth-size skip | Fair uncapped comparison; old Skytree still times out |
| E015 | Source chroma sampled across a band after selection | Adopted; better assignments without geometry changes |
| E016 | Bounded exact solve on development | 274 → 293 strictly recovered / 418 |
| E017 | Frozen holdout recognition and solving | 74 → 92 exact graphs; 2.39× fewer edge errors, below target |
| E018 | Change solver pixel scale after high-resolution inference | No lattice recovery; rejected |
| E019 | Project near-45°/22.5° edges before solving | Fast but inaccurate; rejected |
| E020 | Spatial index for intermediate-vertex rejection | All 558 graphs identical; Skytree browser 72.4 → 23.6 s |
| E021 | Truth substitution for error attribution | Diagnostic only; Hand has both prediction and decoding errors |
| E022 | Sampling at 3072/4096 | Rejected; large-case recognition worsened |
| E023 | Synthetic annotation fine-tuning | Rejected; development exact graphs 339 → 323 |
| E024 | Width24 model with annotation training | No checkpoint passed the clean-accuracy gate |
| E025 | Finer solver grid precision | Rejected; Dwarf still found no full lattice |
| E026 | Partial dominant grid | Fallback-only prototype: 293 → 308 development recoveries, zero regressions |
| E027 | Bounded, validated partial-grid fallback | Integrated: 293 → 307 development recoveries; Dwarf browser fully exact in 14.2 s |
| E028 | More clean-patch rehearsal after annotation learning | Rejected; no checkpoint met the clean-accuracy gate |
| E029 | Lower peak confidence threshold | Rejected; Hand/Dwarf worsen; higher threshold helps Frog but hurts Hand |
| E030 | Existing detector only after compact topology defects | 339 → 342 exact development graphs, one partial regression; retained as optional research, not default |
| E031 | Preserve detected sub-percent paper margins | Adopted; synthetic regression catches discarded crops; private diagnostic excluded from every dataset |
| E032 | Connected AUX references and source-supported continuity | Corrects isolated-segment design; shared vertices survive solving and import |

E004 was not assigned. Artifact directories retain experimental states; the
candidate pointer and results report identify the selected combination.

## Resource ledger

Only these RunPod resources belonged to this work. Both are deleted, with
results downloaded and verified first. No persistent volumes were created.

| Experiment | Pod ID | GPU | Price | Lifecycle (September 16 UTC) | Estimated GPU cost |
| --- | --- | --- | --- | --- | --- |
| E005 | `hcyegz5lbqgnbl` | Community RTX 3090 | $0.22/hour | 12:27–12:37 | About $0.04 |
| E013 | `ucn7edgq2158os` | Community RTX 4000 Ada, 20 GB | $0.20/hour | 13:30–13:46 | About $0.06 |

Estimates exclude any container storage charge. Unavailable GPU requests
created no resources. Another agent shares the account: never use, stop, or
delete anything except explicitly recorded resources owned by this experiment.
There are no active resources owned by this work.
