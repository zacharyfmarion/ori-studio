# CP Detection Architecture Inspector

Local debug UI for inspecting the crease-pattern detection/compiler pipeline.

Stage 1 is wired now:

- reads cached dense model tensors from the Rust backend
- runs compiler-native evidence extraction
- displays dense probability maps
- overlays line, junction, and boundary-contact primitives

Run the backend:

```bash
cargo run -p oristudio-cp-detect-inspector -- --port 8788
```

By default the backend opens the clean-15 dense cache generated from the
promoted dense-edge max700 V3 model:

```text
artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx-v3-dense-edges-max700-probe-20260618/manifest.json
```

Use `--dense-manifest artifacts/.../manifest.json` to inspect another cached
model run.

Run the UI:

```bash
npm --workspace @treemaker/cp-detect-architecture-inspector run dev
```

Open:

```text
http://127.0.0.1:5176
```
