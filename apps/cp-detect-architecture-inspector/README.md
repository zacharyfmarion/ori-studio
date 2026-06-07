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

Run the UI:

```bash
npm --workspace @treemaker/cp-detect-architecture-inspector run dev
```

Open:

```text
http://127.0.0.1:5176
```
