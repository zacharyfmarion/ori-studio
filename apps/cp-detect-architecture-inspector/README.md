# CP Detection Architecture Inspector

Local debug UI for inspecting the crease-pattern detection/compiler pipeline.

Stage 1 is wired now:

- reads cached dense model tensors from the Rust backend
- runs compiler-native evidence extraction
- displays dense probability maps
- overlays line, junction, and boundary-contact primitives

Run the backend:

```bash
cargo run -p oristudio-cp-detect-inspector -- --port 8788 --exact-solve-timeout-seconds 10
```

By default the backend opens the clean-15 dense cache generated from the
promoted tess15 weighted V3 model:

```text
artifacts/cp-detect-correctness/dense-cache/clean-1024-s15-browser-onnx-v3-tess15-weighted-probe-20260619/manifest.json
```

Use `--dense-manifest artifacts/.../manifest.json` to inspect another cached
model run.

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
