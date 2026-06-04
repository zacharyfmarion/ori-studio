# Exact Solve Comparison

- Samples: 12
- Total seconds: 848.439
- Dense manifest: `/Users/zacharymarion/.codex/worktrees/cp-detect-browser-v1/tree-maker-rust/artifacts/cp-detect-correctness/dense-cache/smoke-1024-s3-browser-onnx/manifest.json`
- Git commit: `b10a252015025bb38ecdba1d25ca7f90cefab914`

| Implementation | Edge F1 | Border F1 | Assignment Acc | CAMV | Flat-folder solved | Degree-2 | Odd | Max Kawasaki |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| exact_solved | 0.8444 | 0.9588 | 0.9983 | 459 | 0/12 | 59 | 106 | 0.0330 |
| legacy | 0.8651 | 0.9588 | 0.9966 | 459 | 0/12 | 61 | 103 | 156.1668 |
| selected | 0.8650 | 0.9588 | 0.9974 | 459 | 0/12 | 59 | 106 | 156.1668 |
