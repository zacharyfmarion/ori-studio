# CP Detector Benchmark ↔ Product Parity

## Purpose

`compare_exact_solve_benchmark` is supposed to measure the shipped product, but it does
not: it runs a *weaker* configuration than production (most importantly, no vertex
refiner). This makes the failure-attribution lever ranking
([cp-detect-failure-attribution-oracle-ablation.md](cp-detect-failure-attribution-oracle-ablation.md))
measure the dense head, not the product. Goal: enumerate every product↔benchmark
discrepancy and lay out the path to a product-faithful benchmark run.

## Inference reality (correcting a common misconception)

**There is no native-Rust model inference anywhere.** No `ort` / `tract` / `candle` /
onnxruntime dependency exists in any crate. What is in Rust is the *decode/compile* path
(`decode_dense_outputs`, junction-first, selection, exact solve). The model **forward
passes** run elsewhere:

- **Dense HRNet model:** product runs it in the browser via `onnxruntime-web` (JS); the
  benchmark reads a **PyTorch (MPS) precomputed cache** (`infer-native-cp-dense-cache.py`,
  `torch`). Rust never runs the dense model — it consumes cached logits.
- **Vertex refiner (V3):** product runs it in the browser via `onnxruntime-web`
  (`apps/web/src/lib/vertexRefinerInference.ts` + `vertexRefinerPipeline.ts`), then feeds
  refined vertices into the Rust decode through
  `decode_dense_outputs_with…_refined_vertices(refined_vertices: Option<&[…]>)`. The
  benchmark passes `None` and has zero refiner references.

So "run it through native Rust" is not the current architecture for either model — Rust is
the post-processor. Getting the product path into the benchmark therefore means
**precomputing the model outputs (dense logits + refined vertices) and feeding them in**,
exactly as the dense cache already does — not adding Rust inference.

## Discrepancy audit (product vs benchmark)

| Aspect | Product (browser worker) | Benchmark (current) | Faithful? | Close it with |
|---|---|---|---|---|
| **Junctions** | `vertex-refiner-v3` (refiner pipeline) | dense junction head only | **NO — biggest** | refined-vertices cache + `--refined-vertices` |
| **Dense model numerics** | browser `onnxruntime-web` | PyTorch MPS cache | **NO** (different numeric path; the native cache has no browser-onnx twin) | browser-onnx native dense cache |
| **Line evidence** | `source-image` (default) | default `model`; matrix overrides to source-image | default-only | flip default / `--product-path` preset |
| **Candidate source** | `junction-first-v1` | default `legacy`; matrix overrides to jf-v1 | default-only | flip default / preset |
| **Parity repair** | on (`SelectionOptions::default`) | on (None → default) | YES | — |
| **Decoder backend** | `legacy_v2_decoder` (legacy/line-arrangement path) | n/a on the junction-first path | YES (jf path) | confirm jf-v1 ignores it |
| **Exact-solve timeout** | product `DEFAULT_EXACT_SOLVE_TIMEOUT_SECONDS` | benchmark 3s | config-only (not topology) | match in preset |
| **Rectification** | rectifies uploaded photo | native renders are pre-rectified clean CPs | YES (for the native set) | — |

The two that change results are **junctions (refiner)** and **dense-model numerics**; the
rest are default/config mismatches the matrix already worked around.

## Path forward

### Phase 1 — refiner-faithful junctions (the lever that matters)
1. Run the existing refiner pipeline over all 563 native samples and cache refined
   vertices. `scripts/cp-detect/run-vertex-refiner-debug-pack.mjs` already does this
   (headless browser → `samples/<id>.json` with `merged_vertices`); add a small step (or
   `--out` post-process) to emit a compact `sample_id → vertices_px` cache.
2. Add `--refined-vertices <cache>` to the benchmark: load the cache, look up the sample,
   and feed the vertices into `generate_junction_first_with_vertex_pixels` — the **same
   code path `--oracle-vertices` uses**, with refined instead of GT vertices.
3. Re-run P0 vs refined vs GT(`--oracle-vertices`) per density. The refined point's
   position in `[P0, J]` is exactly how much of the junction lever the refiner captures —
   and makes the benchmark junction-faithful to product.

### Phase 2 — dense-model-numeric parity
The native cache is PyTorch; product is browser-onnx. Produce a **browser-onnx native
dense cache** (`run-browser-dense-cache.mjs` over the native pack) so the benchmark reads
the same numerics the product ships. Re-baseline on it. (The refiner crops in Phase 1
should run on the same rendered images, so their numerics already match product.)

### Phase 3 — config parity / one-switch product mode
Add a `--product-path` preset that sets: candidate-source `junction-first-v1`,
line-evidence `source-image`, refined-vertices from the cache, parity repair on, exact
timeout = product default. So a bare product-faithful run is one flag, and the benchmark
*default* no longer silently diverges from production.

### Later (optional) — true self-contained native Rust
Add a Rust ONNX runtime (`tract` or `ort`) and port both forward passes + the refiner
crop/proposal/merge pipeline to Rust. Removes the Python/browser precompute entirely. Big
lift, **no precedent** (the dense model isn't in Rust either) — only worth it if the
precompute-cache workflow becomes a bottleneck.

## Non-Goals
- Do not add Rust ONNX inference now (Phase 4 only if justified later).
- Do not change the product decode path; this is measurement parity only.
- Do not retrain models.

## Done Criteria
- `--refined-vertices` consumes a refined-vertex cache and feeds junction-first.
- A documented refined-vertex cache build step over the 563 native samples.
- P0 / refined / GT(J) comparison per density, with the refiner's lever-1 capture quantified.
- `--product-path` preset; benchmark default no longer diverges from production.
- (Phase 2) browser-onnx native dense cache + re-baseline, or a documented decision to defer.

## Checklist
- [ ] `--refined-vertices <cache>` flag + loader, fed via `generate_junction_first_with_vertex_pixels`.
- [ ] Refined-vertex cache builder over native-cp-v1 (extend run-vertex-refiner-debug-pack.mjs).
- [ ] Run P0 / refined / J matrix; record where the refiner lands per density.
- [ ] `--product-path` preset (jf-v1 + source-image + refined + parity + product timeout).
- [ ] Phase 2: browser-onnx native dense cache + re-baseline (or defer with rationale).
- [ ] Update the failure-attribution readout with product-faithful numbers.
