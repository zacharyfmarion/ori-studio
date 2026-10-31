# Pairwise spread occlusion and stable Pose presentation

## Goal

Keep known ordered layers in their correct order across their current screen
overlap, while retaining physical depth between unrelated layers. Restore
continuous auxiliary ink on Bodo step 147 and preserve view scale when spread
is toggled.

## Approach

Use the direct layer relationships from the flat model, including all pieces of
one flat-crease layer. Do not extend these relationships through transitive
rank comparisons. Known blockers mask whole projected faces. Global depth bands
remain a fast path only when every cross-band pair has a direct relationship.
Use the same policy for GPU drawing, vector fills/ink and picking; projected
cycles retain physical-depth fallback. Keep the established edge-owner-aware
line visibility rule so shared outlines are not dropped by fill clipping.
Skip provably hidden lines/intervals using direct blockers in acyclic orders.
Keep the height solver, its cache and file formats unchanged.

The previous experiment intersected two moving material-overlap footprints.
It was rejected after visual testing: it exposed buried faces outside those
footprints, even for known ordered pairs. That implementation is removed.
A corpus completion sweep alone does not validate visual correctness.

## Affected Areas

- Shared layer-spread visibility, vector geometry and capture.
- Projected auxiliary ink.
- Diagram Pose viewport framing and shared zoom.

## Checklist

- [x] Replace moving-footprint masks with direct pairwise ordering.
- [x] Cover shifted overlaps, unrelated pairs, flat creases, cycles, ink and back/perspective views.
- [x] Repair Bodo step 147 auxiliary line shortening at internal triangulation joints.
- [x] Preserve zoom and placement when toggling spread.
- [x] Benchmark the revised path on cached Cpoogle/Bodo cases.
- [x] Inspect live/settled supplied-case renders and run affected checks.
- [x] Update the existing draft PR without committing user files.

## Validation evidence

- 28 shared geometry tests; 36 focused web tests across 12 suites. Tests cover
  whole shifted overlap, unrelated faces with an absent intermediary, direct
  relationships through flat crease groups, both sides, perspective projection,
  cyclic fallback, shared outlines, aux shortening and DPR-aware framing.
- The 604 cached successful cases (426 Cpoogle Truth models and 178 Bodo scopes)
  all captured. The direct-blocker ink shortcuts matched the full pairwise
  visibility evaluation byte-for-byte in every case. This checks the shortcuts,
  not equivalence with the old global-rank rendering, which intentionally changes.
- Capture CPU only, at Amount 25% and reveal [0.8, 0.6], using two concurrent
  Node workers: Cpoogle median 51 ms, p95 691 ms; Bodo median 184 ms, p95 731 ms.
  Bodo 147/168/204 took 174/379/502 ms. Slowest Cpoogle capture was 6.99 s.
  These are single-run measurements excluding folding, solving, SVG writing,
  transport and the idle delay; they are not interaction-latency measurements.
- Chrome Canary: production Pose component on cached real tiger and Bodo
  147/168 inputs; live/settled switch and zoom/spread toggle. In-app Chromium:
  compared original, rejected and corrected fish captures and inspected Bodo
  147 at 100%/120%. The temporary harness and copied inputs were removed.
  This follow-up did not repeat full OSF import or a new solve of the corpus.
- Lint and typecheck passed. Normal production build (including WASM hooks and
  landing prerender) passed. No Rust/oracle/Tauri suite rerun:
  solver, upstream algorithms, file formats and native shell are unchanged.
- Saved document pictures remain snapshots until recaptured. No corpus files,
  generated WASM binaries or screenshots are committed.
