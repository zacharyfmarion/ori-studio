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
