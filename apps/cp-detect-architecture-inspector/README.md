# CP Detection Architecture Inspector

Local debug UI for inspecting the crease-pattern detection/compiler pipeline.

The default landing view is a virtualized grid of every rendered crease pattern
in the open dense-cache (the native-cp dataset by default). Click a thumbnail to
open the per-stage inspector for that sample, or use **Upload image** to run an
ad-hoc image through the pipeline.

The stages mirror the production decode path
(`oristudio_cp_detect::decode::decode_dense_outputs`):

- **Stage 1 — Dense evidence extraction:** cached dense tensors + compiler-native
  evidence (line/junction/boundary-contact primitives, probability maps).
- **Stage 2 — Candidate generation (junction-first-v1):** the production IR
  `candidate_graph` from `generate_candidate_graph` (the arrangement is kept for
  geometry context and the exactizability probes).
- **Stage 3 — Beam candidate selection (IR):** `select_candidate_graph_beam_from_ir`
  over the IR — the same exactizability-aware beam search production uses (this
  replaced the legacy arrangement selector).
- **Stage 4 — Local exactizability probes** over the beam-selected edges.
- **Stage 5 — Beam selection vs ground truth:** stage 4 plus the GT / legacy-graph
  comparison overlays.
- **Stage 5b — Candidate decision audit.**
- **Stage 6 — Full exact geometric solve** (`solve_exact`).

Run the backend:

```bash
cargo run -p oristudio-cp-detect-inspector -- --port 8788 --exact-solve-timeout-seconds 10
```

By default the backend opens the native-cp-v1 dense cache (real scraped origami
CPs, 563 samples) generated from the promoted tess15 weighted V3 model:

```text
artifacts/cp-detect-correctness/dense-cache/native-cp-v1-pytorch-mps-v3-tess15-weighted/manifest.json
```

Use `--dense-manifest artifacts/.../manifest.json` to inspect another cached
model run, e.g. the clean-15 synthetic set:

```text
artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx-v3-tess15-weighted-probe-20260619/manifest.json
```

Exact solve is capped at 10 seconds by default so degenerate topology does not
hang the inspector. Use `--exact-solve-timeout-seconds N` to change the backend
default. Stage 6 also exposes the same value in the UI and query string as
`exact_solve_timeout_seconds`; set a negative value only for intentionally
uncapped debugging.

Run the UI:

```bash
npm --workspace @treemaker/cp-detect-architecture-inspector run dev
```

Open:

```text
http://127.0.0.1:5176
```
