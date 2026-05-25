# Browser CP Detector Assets

Phase 1 keeps the browser detector model artifact local and ignored. Put the
exported ONNX model here during development:

```text
apps/web/public/models/cp-detector-v2/model.onnx
apps/web/public/models/cp-detector-v2/manifest.json
```

The source checkpoint and Python oracle currently live in the
`create-pattern-detector` repository. The local model manifest should use the
schema in `apps/web/public/models/cp-detector-v2/manifest.example.json`.

Run the local asset checker before app testing:

```bash
node scripts/cp-detect/check-local-model-assets.mjs
```

Export the current V2 checkpoint from a local `create-pattern-detector` checkout:

```bash
python scripts/cp-detect/export-cpline-onnx.py \
  --detector-repo /path/to/create-pattern-detector
```

The exporter writes both `model.onnx` and `manifest.json`, validates the ONNX
graph, and records the model size plus SHA-256 digest in the manifest. The
browser feature requires these files; there is no mock or degraded fallback.

Then verify the local assets:

```bash
node scripts/cp-detect/check-local-model-assets.mjs
```

## Browser-vs-Oracle Benchmark

With the web dev server running and real local model assets installed, compare
the browser Rust/WASM detector against frozen Python oracle fixtures:

```bash
node scripts/cp-detect/benchmark-browser-vs-oracle.mjs \
  --url http://127.0.0.1:5175/ \
  --out artifacts/cp-detect-parity/browser-vs-python-baseline.json
```

The benchmark drives the actual browser upload/crop/detect flow with
Playwright, captures the emitted FOLD JSON, and writes graph-count plus
approximate vertex/edge/border matching metrics against the frozen Python
fixture output. The generated report lives under ignored `artifacts/` by
default.
