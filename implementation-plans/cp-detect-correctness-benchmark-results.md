# CP Detector Correctness Benchmark Results

## 2026-05-26 Smoke Run

This is the first repeatable benchmark run comparing frozen Python PyTorch and
browser ONNX Runtime Web + WASM against the same rendered `.fold` ground truth.
It is a small smoke run, not a promotion run.

Artifacts:

```text
artifacts/cp-detect-correctness/packs/smoke-1024-s3
artifacts/cp-detect-correctness/runs/smoke-1024-s3/python
artifacts/cp-detect-correctness/runs/smoke-1024-s3/browser-fast
artifacts/cp-detect-correctness/reports/smoke-1024-s3
```

Configuration:

```text
image size: 1024
split: val
profiles: clean, line-style, v2-watermark, v2-dashed
samples per profile: 3
total samples: 12
Python checkpoint: runpod-v2-replay-correction-full-4000ada
browser model: runpod-v2-replay-correction-full-4000ada-explicit-bn
```

Aggregate metrics:

| implementation | vertex F1 | edge F1 | border F1 | assignment | structural |
| --- | ---: | ---: | ---: | ---: | ---: |
| Python PyTorch | 0.8946 | 0.7741 | 0.9027 | 0.9962 | 1.0000 |
| Browser ONNX/WASM | 0.8965 | 0.7683 | 0.8650 | 0.9742 | 1.0000 |

Browser minus Python:

| metric | delta |
| --- | ---: |
| vertex F1 | +0.0019 |
| edge F1 | -0.0058 |
| border F1 | -0.0376 |
| assignment accuracy | -0.0220 |
| structural validity rate | +0.0000 |

By profile:

| profile | Python edge F1 | Browser edge F1 | delta edge F1 | Python border F1 | Browser border F1 | delta border F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| clean | 0.8471 | 0.8487 | +0.0016 | 0.9357 | 0.9080 | -0.0277 |
| line-style | 0.7370 | 0.7156 | -0.0214 | 0.8655 | 0.8148 | -0.0507 |
| v2-dashed | 0.7244 | 0.7297 | +0.0053 | 0.8554 | 0.8221 | -0.0333 |
| v2-watermark | 0.7880 | 0.7792 | -0.0087 | 0.9529 | 0.9146 | -0.0383 |

Takeaways:

- The browser path is not broadly broken. It completed all 12 samples and
  structural validity stayed at 1.0.
- Edge F1 is close on this smoke set: browser is only 0.0058 below Python.
- The meaningful regression is border recall/F1. Browser border precision is
  essentially identical, but border recall is 0.0698 lower.
- Assignment accuracy also drops by 0.0220. That likely reflects ONNX head
  drift near the assignment decision boundary rather than a topology-port issue,
  because the decoder replay from Python logits already matched exactly.
- The worst sample was the line-style Rabbit Ear sample:
  `rabbit_ear_fold_program_v1-5wk0b-000109__line-style__000`, where browser edge
  F1 was 0.0502 lower and border F1 was 0.0926 lower.

Next benchmark step:

Run the iteration tier once the border/assignment differences have been
inspected on the contact sheet:

```text
profiles: clean, line-style, print-light, dark-mode, v2-text, v2-watermark,
v2-guide-grid, v2-dashed, v2-faint, v2-ambiguous-mv, v2-combined,
v2-dark-combined
samples per profile: 8
```
