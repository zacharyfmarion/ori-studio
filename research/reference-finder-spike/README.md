# ReferenceFinder / precrease-planner spike (2026-09-05)

Evidence for `implementation-plans/reference-finder-integration.md`. Prototype code, not
product code — the Rust crate in that plan replaces all of it.

- `rf.mjs` — Node driver for MuTsunTsai's `ref.wasm` (worker-env shim, `instantiateWasm`,
  numeric stdin queue, JSON-line parsing). Expects the upstream clone at `./rf/`
  (`git clone --depth 1 https://github.com/MuTsunTsai/reference-finder rf`); set `RF_LIB` to
  point at another `src/lib`.
- `equiv.mjs` — fixed query set used to show a from-source emcc build returns identical
  solutions to the committed artifact.
- `spike-closure.mjs` — the closure + greedy-RF prototype. **Known defects, all documented in
  the plan:** greedy stuck handler (+50–100 % auxiliary creases, order-dependent), rounded-normal
  point-on-line index (misses ±45° lines), missing O4/O7 in-paper checks, approximate fallback
  that folds wrong lines, bbox `inPaper`. Its counts are upper bounds.
- `grid6.fold` — synthetic 1/6 grid (forces the 1/3 landmark).
- `cpoogle-sweep.jsonl` — one row per design for every fifth `.cp` of the external cpoogle
  corpus (112 designs), rank 6.
- `classify_off_lattice.py` — lattice-residual probe over the 12 designs the prototype could
  not plan exactly (angle family k·π/8; offsets on ℤ[√2]/2ᵏ); the source of the plan's 7/5
  off-lattice split. Needs the external corpus directory as its argument.
- `panel-fixtures/` — counterexample CPs built by the design panel (`g3d_x19`, `x13_x38`,
  `x13_diag_pair`, `g3d_x112`, `claim7-cand9`, `divergence-*`) with their optimal auxiliary
  counts recorded in the plan's testing section. These graduate to `tests/fixtures/precrease/`.
- `panel-probes/` — the panel's probe scripts (forward-first search, exhaustive IDDFS,
  order-dependence test, claim verifiers). Reference only.
