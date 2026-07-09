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

## Running

One command starts the Rust API backend (`:8788`) and the vite frontend
(`:5176`); then open the vite URL:

```bash
scripts/cp-detect/run-inspector.sh
```

```text
http://127.0.0.1:5176
```

The frontend is served **live from source by vite** (HMR) — there is no prebuilt
`dist/` in the run path, so it can never go stale. `vite.config.ts` proxies
`/api` and `/assets` to the backend. (For a one-off static bundle — to deploy or
`vite preview` — run `npm --workspace @treemaker/cp-detect-architecture-inspector run build`;
`dist/` is gitignored and is never what the dev server serves.)

Extra args pass through to the backend, e.g. a different cached model run or a
longer solve budget:

```bash
scripts/cp-detect/run-inspector.sh \
  --dense-manifest artifacts/cp-detect-correctness/dense-cache/<pack>/manifest.json \
  --exact-solve-timeout-seconds 25
```

By default the backend opens the **promoted V5 BP+search225** native-cp-v1 dense
cache (real scraped origami CPs, 563 samples):

```text
artifacts/cp-detect-correctness/dense-cache/native-cp-v1-pytorch-mps-v5-bp-search225-step12000-20260708/manifest.json
```

Exact solve is capped at 10 seconds by default so degenerate topology does not
hang the inspector. Stage 6 also exposes the value in the UI / query string as
`exact_solve_timeout_seconds`; set a negative value only for intentionally
uncapped debugging.
