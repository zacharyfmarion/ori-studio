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

The checker does not export ONNX yet. It only verifies that the browser app has
the files it expects. ONNX export is part of the next implementation phase.
