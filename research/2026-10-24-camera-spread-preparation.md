# Default spread: full cpoogle preparation baseline

This baseline attempts all **484 cpoogle `truth.fold` models**, using first layer
solution / starting face 1, without changing or exactizing their inputs. It
measures initial geometry preparation, separately from folding and vector
capture. The production implementation is `fb5353ab196c4fe1496bcefcf514d086a9a71610`.

Hardware: Apple M1 Max, 10 logical CPUs, 64 GiB RAM, arm64 Darwin 25.6.0.
CPU runtime: Node v26.8.1; browser/GPU details are pinned in the numerical baseline. One model/trial at a time; no concurrent benchmark
jobs or builds. Each model has three independent cold-geometry-cache trials in
fresh processes, and three fresh-browser-worker trials. OS filesystem and HTTP
caches are not cleared. Numbers are hardware-specific observations, not a CI
latency promise.

## Results

All 484 folds and all **1,452 CPU preparation trials** succeeded, with no timeout
or preparation refusal. Every model's mesh/height/diagnostic hash matched across
its three trials. All **1,452 browser trials** also succeeded (484/484 models).

| Measured stage | Median | p95 | p99 | Worst |
| --- | ---: | ---: | ---: | ---: |
| CPU spread preparation | 92 ms | 948 ms | 3.40 s | 10.70 s |
| Folding only (one cold fold per model) | 45 ms | 1.03 s | 9.22 s | 21.07 s |
| Browser production-session preparation | 117 ms | 1.06 s | 3.60 s | 11.00 s |
| Browser worker startup → two-frame presentation | 142 ms | 1.13 s | 3.63 s | 11.08 s |

Percentiles use nearest rank over per-model trial medians. Folding has one
sample per model. Failures would be counted explicitly and excluded from timing
percentiles, never recorded as zero or silently omitted.

22 models require over one second of CPU preparation, 12 over two seconds, two
over five seconds, and one over ten seconds. This is a substantial long tail
that the typical model does not reveal.

## Where the time goes

Across the sum of per-model CPU medians, topology construction accounts for
18.4%, matrix/solve/probes 71.9%, paint plans 4.2%, and layer relations 4.8%.
The remaining small difference includes instrumentation and other lift work.
The existing solve diagnostic includes matrix compilation, height normalization
and probe evaluation; full `liftMs` also includes its final diagnostic counts.

The slowest CPU case is Rei Sueoka's anatomically precise cockroach:
**1,524 faces, 487,472 contact rows**, 10.70 s total, including 8.67 s in the
solve interval. Scutigera follows at 5.32 s, Hand 11-21-23 at 4.03 s, and Bodo's
Xenomorph at 3.85 s. Face count alone is insufficient: Kiyotaka's 448-face stag
beetle takes 3.40 s, while the 4,722-face Tokyo Skytree takes 2.77 s.

The browser adds a median 8.8 ms of worker startup. The first bitmap call costs
7.7 ms median / 12.1 ms p95; it is not an isolated GPU-completion timer. Browser
preparation is 11.00 s for the cockroach, 5.81 s for Scutigera, 4.35 s for Hand,
4.12 s for Xenomorph and 3.29 s for Tokyo Skytree.

The first optimization target is the lift's contact construction and repeated
matrix-vector products. The next dense-model target is layer-relation closure
(Tokyo Skytree spends 726 ms there). Preserve geometry/height hashes when an
optimization claims unchanged output, and retain the visibility regression
suite for deliberate geometric changes. No solver behavior was changed by this
benchmark work.

Folding is a separate bottleneck: the Eastern Dragon by 1proto spends 21.07 s
folding, while its spread preparation is roughly 0.4 s. Do not blame that wait
on the spread solver or add independently measured Node and browser timings
and label their sum an end-to-end UI measurement.

## Saved baseline and reproduction

- [Numerical observations](benchmarks/camera-spread/2026-10-24-cpoogle.json): every
  model's input/scene/mesh hashes, counts, all numerical trials, outcome, hardware
  and runtime provenance. It contains no corpus files, coordinates or geometry.
- [Harness instructions](../scripts/camera-spread/README.md#full-corpus-cold-preparation-baseline).
- Raw records, solved scenes, compiled benchmark bundles and the sortable local
  report live under ignored
  `artifacts/camera-spread/benchmarks/2026-10-24-cpoogle/`.
- Local report:
  `http://localhost:5282/src/generated/camera-spread/benchmarks/2026-10-24-cpoogle/index.html`.

CPU preparation excludes module import, file reading/decoding, worker transport,
GPU setup, first drawing and settled vector capture. The browser run uses the
actual production render session at 800 × 640 CSS pixels, DPR 2, Diagram 6%,
direction 247°, inclination 45°, rotation 0°. Worker startup, session preparation,
first bitmap and two-frame presentation are separately recorded. Browser
preparation excludes fetching/decoding/hashing the saved folded scene. First
bitmap and RAF timing are not hardware input-to-photon measurements.

The folding bridge is the existing rebuilt WASM; its binary hash is pinned.
No production, Rust, WASM or UI behavior changes were needed. Validation covers
harness reporting/privacy tests, a forced timeout, resume/deduplication,
geometry determinism, and the complete real-file runs. Product test suites and
native oracle builds were not rerun for these measurement-only scripts.
