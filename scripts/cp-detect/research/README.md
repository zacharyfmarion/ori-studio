# CP recognition research tools

These tools support the [September 16 investigation](../../../research/cp-recognition/README.md).
Run commands from the product repository root. Real benchmark data is read
only by evaluation tools, never by the trainer. Generated packs, model weights,
private inputs, and reports belong in ignored `artifacts/cp-recognition/`.

## Environment and saved evidence

The evaluated local Python environment was the ML repository's `.venv`:
PyTorch 2.12.0, NumPy 2.2.6, SciPy 1.15.3, OpenCV 4.13.0, ONNX 1.16.2,
ONNX Runtime 1.23.2, plus Pillow. Training on RunPod used PyTorch 2.8.0+cu128.
The corpus runner currently uses macOS MPS for inference; CUDA is supported
by the trainer. Node/Playwright use the product's installed dependencies.

Verified checkpoints, synthetic pack/provenance, frozen protocols, and final
per-case evaluation outputs also live outside the disposable worktree:

```text
~/Documents/datasets/create-pattern-detector/research/2026-09-16-pixel-vertex/
```

Its `archive-manifest.json` records content hashes. Paths underneath it mirror
`artifacts/cp-recognition/`. Restore the required subdirectories there before
replaying commands. The external `real_benchmark/` folder must still be present
at the paths in the frozen inventory. No private files or weights are in Git.

## Preview the selected model

`research/cp-recognition/candidate.json` is the research identity; the shipped
model's `scripts/cp-detect/current-model.json` remains unchanged. Export verifies
the checkpoint SHA, synthetic-only declaration, exact ONNX SHA/size, and numerical
PyTorch/ONNX parity before creating a manifest.

```bash
python scripts/cp-detect/research/export_pixel_model.py --preview
npm --workspace @treemaker/web run build:oristudio-cp-detect-wasm
npm --workspace @treemaker/web run dev -- --host 127.0.0.1
```

Use the ML `.venv/bin/python` if these packages are not in the active environment.
`--checkpoint /path/to/best.pt` supports a restored checkpoint in another
location. `--preview` creates an ignored local registry override pointing to the
candidate. Remove `apps/web/public/models/registry.json` to return to the stable
local manifest. This command does not publish anything or alter production.

The current development preview is `http://127.0.0.1:5176`. The normal import
flow uses the local registry and will download the 1.55 MB candidate once.

## Evaluate the frozen candidate

Build the native adapters and existing strict evaluator:

```bash
env -u HTTPS_PROXY cargo build --release -p oristudio-cp-detect \
  --features native-inference --example recognition_probe --example solve_recognition
cargo build --release -p oristudio-cp-eval --example strict_diff
```

`frozen/final-protocol.json` records the first holdout evaluation's code.
`frozen/parity-protocol.json` records the same candidate after the E020 spatial
index; all 558 predictions match exactly. Use the latter with this source tree:

```bash
python scripts/cp-detect/research/run_corpus.py \
  --inventory artifacts/cp-recognition/frozen/inventory.json \
  --checkpoint artifacts/cp-recognition/E013-longer/runpod/training/best.pt \
  --protocol artifacts/cp-recognition/frozen/parity-protocol.json \
  --split development --jobs 4 --out artifacts/cp-recognition/replay-development
```

Repeat with `--split holdout` and a new output directory only to reproduce the
frozen result. Do not use that split to tune a new candidate and still call it
unseen. The runner refuses changed checkpoint, inventory, or inference-source
hashes. It uses detected vertex count to select resolution, attempts every
source, and only reads truth after predictions have been written.

`compare_corpus.py` scores old and new predictions with the same 4-pixel metric,
counting absent predictions as empty graphs. The uncapped baseline directory
supplies old-model runs previously skipped by the old harness:

```bash
python scripts/cp-detect/research/compare_corpus.py \
  --inventory artifacts/cp-recognition/frozen/inventory.json \
  --baseline artifacts/cp-recognition/E000-baseline \
  --uncapped-baseline artifacts/cp-recognition/E014-uncapped-baseline \
  --candidate artifacts/cp-recognition/E013-development \
  --split development --out artifacts/cp-recognition/replay-comparison
python scripts/cp-detect/research/run_solve_corpus.py \
  --inventory artifacts/cp-recognition/frozen/inventory.json \
  --corpus artifacts/cp-recognition/E013-development \
  --split development --jobs 4 --out artifacts/cp-recognition/replay-solved
```

Solve replay uses the latest harness policy: 25 seconds and lattice-only above
1,500 selected spans. It scores accepted exact recovery at 2 pixels. This is
different from the modal's unbounded solve, as described in the results report.
For baseline solve replay use `--baseline` and `--uncapped-baseline` instead
of `--corpus`. Holdout baseline additions are in `E017-uncapped-baseline`.

For a genuinely new corpus, `inventory.py --corpus PATH --out NEW_DIRECTORY`
creates a deterministic geometry-grouped split and refuses to overwrite one.
Declare and freeze a new protocol before inference; do not overwrite the
September protocol to make a changed experiment appear to reproduce it.

## Browser measurements

With Vite running, copy an evaluation image into an ignored artifact directory
inside this worktree, then run the actual application worker:

```bash
node scripts/cp-detect/research/run_browser_pixel_probe.mjs \
  http://127.0.0.1:5176 \
  apps/web/public/models/cp-detector-pixel-research/manifest.json \
  artifacts/cp-recognition/browser-input.png \
  artifacts/cp-recognition/browser-result.json worker
```

This includes automatic rectification, verified model installation, original-
source adaptive inference, Rust/WASM decoding, and AUX retention. It explicitly
selects WASM for a reproducible CPU-browser measurement. Output `totalMs`
includes recognition; it does not include the later exact solve. `tiles` mode
takes an ONNX path instead of a manifest and tests isolated tile inference.

## Synthetic training

`pack_synthetic.py` accepts only the generated ML `synthetic/` root, verifies
declared generator families, and groups equivalent rotated/reflected geometry
across training and validation. `pixel_vertex.py` requires the pack's provenance
sidecar; it never imports the real inventory or benchmark. Training includes
cyan AUX as positive AUX targets and excludes AUX intersections from physical
junction labels. Black/gray physical ink, background grids, and dark styles are
render augmentations. Unit checks are in `test_pixel_vertex.py`.

The selected checkpoint is E013 step 9000, initialized from the saved E007
checkpoint. Repeating the training stage is possible with the archived pack:

```bash
python scripts/cp-detect/research/pixel_vertex.py \
  --pack artifacts/cp-recognition/E005/synthetic-deduplicated.jsonl.gz \
  --init artifacts/cp-recognition/E007-grid-scale/best.pt \
  --out artifacts/cp-recognition/new-synthetic-training \
  --steps 10000 --batch 16 --size 192 --width 16 --workers 6 \
  --device cuda --eval-every 1000 --val-count 128 --lr 0.0002 --seed 391016
```

GPU/toolchain differences can change newly trained weights. Exact export
reproduction uses the saved selected checkpoint, not an assertion that every
retraining run will be bitwise identical. Both RunPod result archives retain
the training source/configuration and logs. Final E013 config records the
initialization and pack hashes, zero real training patterns, and selected heads.

No automatic RunPod provisioning or account cleanup is included. Another agent
shares the account. If further training is justified, record each newly created
pod ID, size the GPU to the job, retrieve and verify artifacts, and delete only
that explicitly owned pod immediately afterward.

## Rejected prototypes

`raster_graph.py`, `assignment_probe.py`, and `project_directions.py` preserve
investigations rather than product alternatives selected by truth. In
particular, direction projection can move vertices substantially and did not
solve the exact-folding problem. Do not silently apply it to imported geometry.
