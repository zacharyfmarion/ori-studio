# Staged Recognize and Solve

Split detection into **recognize** and **solve**, and let the frontend decide
when the second one runs.

## Goal

Detection runs `solve_exact` inside the decode call today, always, before the
frontend sees anything. Three things follow, and all three are visible to the
user:

- **"Solve & Add" does not solve.** The solve already ran. It is also
  byte-identical to "Add as-is" — `addDetection` branches only on
  `mode === 'reviewAndFix'` (`CpDetectImportModal.tsx:329-341`), so both other
  modes add the same `detection.foldJson`. On an exactly-solved pattern the
  modal shows one button twice under two names, one of which promises an action
  that already happened. It should say **Add**.
- **Up to 25 s is spent solving topology that is visibly broken.** There is no
  product-side topology gate — the benchmark has one, the product does not — so
  a candidate the compiler could immediately tell us is unsolvable still pays
  the full cap. Measured: 123/140 hard solves hit it
  (`crease-topology-repair.md`).
- **The user has no way to solve after repairing.** The whole point of the
  repair flow, and it dead-ends (see "Two things that are already broken").

The wanted flow, frontend-controlled:

```
Recognize  ──►  topology issues?
                 │
                 ├── no ──►  "Solving…"  ──►  solved   ──► [Add]
                 │                        └─► failed   ──► repair path
                 │
                 └── yes ─►  [Review & Fix]  ──►  user repairs in the editor
                                              ──►  [Solve] on the region chip
                                              ──►  [Try again] / [Accept]
```

The user sees the recognized-but-unsolved creases while the solve runs, rather
than waiting on a single opaque call and being told afterwards what happened.

## Approach

### The Rust seam is two statements

Everything funnels into `legacy_candidate_exact_solve_from_generation`
(`crates/oristudio-cp-detect/src/decode.rs:538-726`). The solve is
**`:575-583`**; the whole rest of the function is assembly.

- `:543-574` is pre-solve and depends only on `generation` + `config`. It ends
  by serialising `ExactSolveInput` verbatim at `:568-574` — already there, for
  this feature.
- `:584+` reads `exact_solve` in exactly four places: the FOLD export (`:585`),
  `exact_moved_vertex_count` (`:610`), the report blob (`:659`), and the timing
  (`:583`).

**Extract `:543-574` into a private `recognize_from_generation(config,
generation, context) -> Recognized`, and have the solving tail consume its
output.** This is the only construction under which recognize and
recognize-then-solve *cannot* diverge, because the second is literally the first
plus `solve_exact`. Do this even if nothing else here ships.

Then gate the tail on **`recognize_only: bool` on `DecodeConfig`**
(`legacy_decode.rs:16-91`), which needs exactly **one branch, at `:575`**. The
config is already threaded verbatim through all five public entries and is
`Clone + Serialize + Deserialize` with `#[serde(default)]` throughout, so the
addition is wire-compatible with the inspector's serialised config and any
cached options JSON.

Alternatives weighed and rejected:

- *A separate public function family* — the five public entries × three private
  helpers exist only to thread evidence options into candidate generation. You
  would duplicate that fan-out or refactor it into one options struct first.
  That refactor is worth doing eventually; it should not block this.
- *A new wasm export alone* — not an alternative. The Rust side must still stop
  before the solve, so this is only the presentation of whichever option above
  you pick. An export that re-implemented generation and selection is precisely
  the divergence the shared-step extraction exists to prevent.
- **⚠ `exact_solve_timeout_seconds: 0.0` — do not.** It is documented as "zero
  times out immediately" (`legacy_decode.rs:83-86`) and would *almost* produce
  recognize-only output. It still pays `SolveModel::new` and returns
  `status: Failed` with timeout rejection reasons, so it **mislabels a candidate
  that was never attempted as one that failed** — which is exactly the
  distinction this plan exists to draw.

wasm-side: each export builds `DecodeConfig` from positional args, but
wasm-bindgen maps a trailing `Option<bool>` to an omittable JS argument, so the
flag can go on `cp_detect_decode_dense_output_bundle_with_source_image_line_evidence`
(`detect-wasm/src/lib.rs:274`) alone — **the product uses exactly that one**,
because `DEFAULT_LINE_EVIDENCE_SOURCE = "source-image"` and `cpDetectWorker.ts`
branches on it first. Leave the other three untouched.

Name it deliberately in the PR: `DecodeConfig` is otherwise entirely thresholds
and radii, and `recognize_only` is the first *mode* on it.

### `DecodedFold` does not need splitting

`DecodedFold` is `{ fold_json, report }` (`legacy_decode.rs:221-225`), and
everything a recognize-only result must carry already has a home:

| needs to carry | home |
| --- | --- |
| candidate FOLD | `fold_json`, via `export_candidate_to_fold_document` |
| `ExactSolveInput` | already emitted at `decode.rs:574` → `:658` |
| `TopologyDiagnostics` | a new key in the `compiler_report` `json!` — `quality_report` is free-form `serde_json::Value`, so zero type change on either side |

The candidate export already **self-identifies**: `frame_title = "candidate
crease pattern"` and `cp_detector.source = "exact_solve_candidate"` rather than
`"exact_solve"` (`fold_export.rs:267,276`). That discriminator is the answer to
"a `DecodedFold` that looks identical but means something different", and the
frontend should read it rather than infer from the absence of a solve block.

`DecodedFold` derives `PartialEq` and `Deserialize`, and `decode.rs:1592`
(`assert_eq!(routed, direct)`) depends on `PartialEq` — keeping the type is
free, turning it into an enum is not.

**Fix while here:** `exact_solve_input` currently crosses the wasm boundary
**twice** — once in `report.quality_report` and once inside the `fold_json`
*string* (`decode.rs:694` → `:709`). At the measured sizes (39 K / 108 K /
252 K) that is up to ~0.5 MB per detection, duplicated. Emit it once.

### Two things that are already broken, which this plan must fix

These are not new work items invented here; they are gaps the last phase left,
and the staged flow cannot ship over them.

**1. `SolveRegionChip` is unreachable.** `CpRegionLayer` picks the chip with
`if (!solvable || !solve)` (`CpRegionLayer.tsx:93`), but `CreasePatternPanel`
mounts it as `<CpRegionLayer container={toolbarContainer} />`
(`CreasePatternPanel.tsx:3261`) — **no `solve` prop**. So the guard always
short-circuits and the Solve variant never renders. `engine/cpExactSolve.ts`
exists and its only references anywhere are two analytics event names. The
repair flow therefore has no way to solve at all.

Root cause worth recording: the Phase 1 workflow ran Model → Render → **Panel** →
Commands, so the panel was wired *before* the solve engine existed and there was
nothing to hand it. Each stage was individually complete and green; the seam
between two stages is what nobody owned.

**2. `exempt_vertex_ids` has no browser path.** `cp_detect_solve_exact` parses
plain `ExactSolveOptions` via `exact_solve_options_from_json`, which
**hard-errors on any unknown key** (`detect-wasm/src/lib.rs:431-437`). So Phase
0's `solve_exact_with_exemptions` and `ExactSolveOptionsWithExemptions` — the
mechanism that lets a hand-moved vertex survive the movement budget — are
unreachable. This is the gap that decides whether verb 8 works at all.

### One solve implementation, two entry points

The modal's auto-solve and the region chip's Solve must be the same code. It
belongs in a hook beside the concern (`cp-workspace/regions/`), with the modal
reaching it through the same seam — panels are composition sites, and neither
the modal nor the panel should own solve state.

`CpRegionSolveBinding` already defines the shape the chip wants
(`stateFor` / `onSolve` / `onAccept` / `onTryAgain`, `CpRegionLayer.tsx:12-20`).
The work is providing it, not designing it.

**Solves need run identity.** Two solves against one single-threaded worker
queue silently and the second looks hung. `withFoldInFlight`
(`creasePatternSlice.ts:1091-1116`) and the `oristudioCpFoldRuns` registry
(`types.ts:673-687`: `runId / kind / startedAt / cancellable / stopping`) are the
established primitive — copy that shape rather than inventing one.

### Progress, honestly

**Stage boundaries need no new machinery.** `cpExactSolve.ts:87-116` already
splits the solve into two calls — stage 1 `{polish: false}`, stage 2
`{polish: true}` — so "Solving geometry" and "Refining to fold precision" are
two awaits, not a callback. Polish is 79–96% of the wall and runs only if stage
1 would be accepted, so failures still fail fast.

**Sub-stage progress does need a Rust seam**, and there is a worked precedent:
`bp_optimizer_solve_report_with_progress` (`oristudio-bp-wasm/src/lib.rs:681-711`)
takes a `js_sys::Function` and calls it synchronously from inside the blocking
solve, with `Comlink.proxy` on the main side (`oristudioBpRuntime.ts:149-155` —
the codebase's only proxy call site). The solver's checkpoints already exist
next to every `timeout_reached()` guard. Roughly 15 lines. **Not required for
v1** — two named stages plus a spinner is honest, and `movement_report.
elapsed_seconds` works under wasm since Phase 0.

⚠ **A real divergence to decide explicitly, not paper over.** Splitting the
solve gives each stage its own wall-clock deadline (`exact_solve.rs:207-234`),
so near the 25 s cap the two-call flow has up to **2× the budget** of today's
fused solve and can succeed where decode failed. That is a user-visible
behaviour change in the *good* direction, but it means the staged path and the
fused path are not equivalent. Either give the two stages a shared deadline, or
adopt the larger budget deliberately and say so.

**Decided: one shared budget, not two.** `timeoutSeconds` is the cap for the
*whole* solve; stage 1 is given the total and stage 2 is given what stage 1 left
(`remainingSolveBudget` in `engine/cpExactSolve.ts`). The larger budget was
rejected because it would silently invalidate the 25 s figure every measurement
in `crease-topology-repair.md` was taken against — the staged flow would then be
solving patterns the 307/563 baseline never reached, and the two paths would
disagree about what "timed out" means. Three cases, and the middle one is the
trap: no total means neither stage names a timeout and both inherit the solver's
default; a **negative** total disables the timeout and is passed through
unchanged, because subtracting from it would turn "run to completion" into
`0.0`, which means "time out immediately"; a non-negative total is spent down,
floored at zero. A stage's spend is the **larger** of `movement_report.
elapsed_seconds` and the wall clock here, so serialization, the comlink round
trip and the JSON parse cannot accumulate into an overrun across the two stages.

### Cancellation

Today there is none: `cpDetectCancelled` is declared at `analytics/events.ts:325`
and fired nowhere, and the modal's `close()` is gated `if (busy) return`, so a
running detection cannot be abandoned.

**Terminating the worker is not an option here.** It is measured-broken in this
codebase — `bp-optimizer-cancellation.md:29-38` records a promise still
`PENDING` 6 s after terminating a 2.6 s run, and that plan's checklist is
entirely unchecked. It would also discard the compiled ONNX session and the
43 MiB model, because the solve shares the detect worker's singleton.

Two workable shapes:

1. **A solve-only worker, spawned per run, terminated in a `finally`.** Cheap
   *because the solve needs nothing from the detect worker* — `solveExact`
   touches only `ensureWasmReady()`, never `loadOrt()`. Still requires fixing
   the orphaned-promise bug: settle first, then terminate.
2. **A cooperative `SharedArrayBuffer` flag, the fold model.**
   `lib/foldCancellation.ts` + `crates/oristudio-cp-wasm/src/cancel.rs` is a
   complete template, and the solver's checkpoints already exist
   (`exact_solve.rs:1147-1150`, `:1168-1172`). A cancel flag is one more
   disjunct on `timeout_reached()`. Degrades honestly when `crossOriginIsolated`
   is false, exactly as folds do.

**Unmeasured, and it decides between them:** `build_normal_equations` +
`solve_lm_step` is one sparse Cholesky per outer iteration and is *not* itself
checkpointed. On a 2,321-edge hard pattern that single step could exceed the
fold plan's ~100 ms responsiveness bar. Measure before promising a sub-second
cancel.

#### Measured, and it picked shape 1

**Method**, recorded because the instrumentation was temporary and was reverted:
a `#[track_caller]` tick inside `SolveModel::timeout_reached()` so every
checkpoint stamps an `Instant`, plus spans around `build_normal_equations`,
`solve_lm_step` (and inside it: triplet assembly, COO→CSC, symbolic Cholesky,
numeric Cholesky, triangular solve), `residuals_with_breakdown`, `analyze_graph`
and `SolveModel::new`. **The reported latency is the max gap between consecutive
ticks.** `ExactSolveOptions::default()` throughout (sparse backend, polish on),
release build, Apple M1 Max, single-threaded. Instrumentation overhead ~1-3% of
wall, so the gaps below read slightly high. Inputs: the committed fixtures under
`crates/oristudio-cp-compiler/tests/fixtures/exact_solve/`, plus 23 patterns
sampled across 150-2,906 spans from the native pack the 307/563 baseline was
measured on.

The worst gap between two of the solver's cancellation checkpoints is always one
`solve_lm_step` — specifically the inner-loop checkpoint (`exact_solve.rs:1168`)
to the outer-loop one (`:1147`) — and **94-97% of it is a single
`nalgebra-sparse` Cholesky factorization** at `:1098`, which does no
fill-reducing ordering (its own docs say so) and measures `L_nnz / n²` of
**0.36-0.44 at every size** against 0.50 for a fully dense lower triangle, so the
step is effectively O(n³). Fill ratio `L_nnz/A_nnz` grows 3.4x at n=66 to 40x at
n=2,239. Nothing else comes close: `build_normal_equations` never exceeded 22 ms,
`residuals_with_breakdown` 0.5 ms, `analyze_graph` 18.7 ms, the un-checkpointed
preamble 19.4 ms and postamble 4.8 ms. Every one of those already sits inside the
fold plan's discipline; the Cholesky alone does not.

Native max gap, by size, and the browser figure at 1.30x (measured, wasm vs
native on the same fixtures, tight across the range):

| | params | native gap | browser gap | vs 100 ms |
| --- | --- | --- | --- | --- |
| easy p50 | 256 | ~2 ms | ~2.6 ms | 38x under |
| medium p50 | 582 | ~18 ms | ~24 ms | 4x under |
| medium p90 | 896 | ~70 ms | ~90 ms | **1.1x — none** |
| hard p50 | 2 090 | ~0.5-2 s | ~0.7-2.9 s | 7-29x **over** |
| hard max | 4 680 | ~7.8 s | ~10 s | 100x **over** |

The bar is crossed at roughly **900-1,000 solver parameters (~450 spans)** in the
browser — inside the product's own range, and worst on exactly the runs a Stop
button exists for: the hard-bucket solves that burn the whole 25 s cap (123/140
of them). A flag that answers in microseconds on a 0.4 s solve and ten seconds
late on a 25 s one fails on its own use case, and closing that gap means
replacing the factorization (AMD/METIS ordering, or `faer`'s supernodal
Cholesky) — a solver-performance project, not a cancellation phase. Symbolic
reuse via `refactor` would not help: it is 2-8% of the wall but 2-5% of *the
gap* at the sizes that matter.

So: **shape 1, the per-run solve-only worker**. `terminate()` is immediate at
every size, and it needs no cross-origin isolation, so cancellation is available
on the deployed origin and inside the packaged Tauri shell — where the
`SharedArrayBuffer` flag would have shipped `cancellable: false`. The
orphaned-promise bug is fixed where the plan said: settle first, then terminate
(`engine/cpExactSolveSession.ts`).

Two numbers the measurement report left open, now measured in the browser
(dev server, Chrome, M1 Max):

- **Per-run spawn: ~12 ms** warm (24 ms on the first, cold module fetch), from
  `new Worker` to the first bridge answer — worker boot plus wasm instantiate.
  Against a solve that is 0.36 s at the easy median, ~3% at the very fastest end.
  It is cheap because the solve worker holds *only* the two bridge calls: it
  never touches `loadOrt()`, so no compiled ONNX session and no 43 MiB model is
  discarded by a cancel. The 2.48 MB `.wasm` asset is shared with the detect
  worker rather than duplicated.
- **Cancel latency, end to end**: `right_large_angel` (514 params) solves stage 1
  in 345 ms; stopped at 50 ms and at 200 ms, the in-flight promise settles as
  cancelled at 50 ms and 200 ms — not at 345 ms, and not never.

Three things to carry forward, because each of them is a way to misread the
table above:

- **Cost is not a clean function of `n`.** 748 spans / 1,955 params measured
  133 ms while 642 spans / 1,403 params measured 351 ms, because fill-in depends
  on the CP's graph structure and not only on its size. So any future "safe below
  N parameters" rule — a checkpoint-free fast path, a size gate on a progress
  bar — needs real margin, not the crossing point read off this table.
- **The wasm ratio was measured under Node's V8**, `--target nodejs`, not in a
  browser worker. Chrome is the same engine, so the browser column is sound
  there; **WebKit was not measured**, and the packaged desktop shell's WKWebView
  could differ. It does not change the decision — `terminate()` is bounded on
  every engine — but it would change any promise made about the *flag*.
- **It was ambiguous under exactly one reading, and only that one.** Had Phase C's
  cancel been scoped to the easy and medium buckets — which is where
  `crease-topology-repair.md` scopes hand repair — the flag clears the bar at both
  medians. But it would then have to publish `cancellable: false` above ~450
  spans, i.e. be absent on precisely the runs long enough to want to cancel. The
  flag is only competitive under a scope restriction the cancel feature itself
  argues against.

### A latent bug to fix on the way

`releaseCpDetectClient()` (`cpDetectRuntime.ts:37-41`) is called by nothing, and
`attachWorkerDiagnostics` is invoked at `:32` **without the `observe` callback**
that `engineHost.ts:153-163` uses. So unlike every other engine, the cp-detect
module never drops a dead client: after a worker crash, every subsequent
`getCpDetectClient()` returns the corpse and every call hangs forever rather
than throwing. `bp-optimizer-cancellation.md:117` already lists this as a latent
instance of the same defect.

## Affected Areas

- `crates/oristudio-cp-detect/src/decode.rs` — extract `recognize_from_generation`,
  gate the solve tail.
- `crates/oristudio-cp-detect/src/legacy_decode.rs` — `recognize_only` on
  `DecodeConfig`.
- `crates/oristudio-cp-detect-wasm/src/lib.rs` — the trailing flag on the one
  product export; an options shape that accepts `exempt_vertex_ids`.
- `apps/web/src/workers/cpDetectWorker.ts`, `store/workspaceStore/cpDetectRuntime.ts`
  — the recognize/solve split, run identity, dead-client handling.
- `apps/web/src/engine/cpExactSolve.ts` — the shared solve, finally reachable.
- `apps/web/src/workers/cpExactSolveWorker.ts`,
  `apps/web/src/engine/cpExactSolveSession.ts` — the per-run transport Stop
  terminates, and the settle-then-terminate rule that keeps a cancel from
  orphaning the in-flight promise.
- `apps/web/src/engine/cpExactSolveRuns.ts` — run identity, `cancellable`, and
  the stop-handle table.
- `apps/web/src/components/CpDetectImportModal.tsx` — the new stage machine and
  honest button labels.
- `apps/web/src/cp-workspace/regions/` — the solve binding hook.
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — pass it to
  `CpRegionLayer`.

## Checklist

### Phase A — the Rust split

- [x] Extract `recognize_from_generation` from `decode.rs:543-574` as a shared
      private step; the solving tail consumes its output. Do this first and
      alone, so the refactor is provably behaviour-preserving. *Its output is
      `RecognizedCandidate`, a type whose whole point is having exactly one
      constructor — so recognize-then-solve is literally recognize plus
      `solve_exact` rather than a second pipeline kept in agreement by
      convention.*
- [x] A parity test asserting recognize-then-solve is byte-identical to today's
      fused decode on a committed fixture. This is what forecloses divergence,
      and it should fail loudly if the two paths ever drift.
      (`recognize_then_solve_is_byte_identical_to_the_fused_decode` — the seam,
      the solve, and the exported geometry, all compared as canonicalized JSON
      bytes so key order cannot masquerade as content.)
- [x] `recognize_only` on `DecodeConfig`; one branch at `:570`. Emit
      `TopologyDiagnostics` into `compiler_report`, and the candidate FOLD via
      `export_candidate_to_fold_document`. *A recognize-only result reports the
      new `compiler_status` value `"recognized"` and **no** `exact_solve` block:
      the four existing values all claim a solve reached a verdict, and this one
      never started. It also reports no global verification, because verifying
      candidate coordinates would flag exactly the residuals the solve exists to
      remove.*
- [x] Stop emitting `exact_solve_input` twice across the bridge. *The report copy
      is the one that stays; the FOLD carries `exact_solve_input_location`
      pointing at it, so a reader does not conclude there wasn't a seam.
      Regression-guarded on both sides of the branch by
      `the_pre_solve_exact_solve_input_crosses_the_bridge_once`.*
- [x] Decide and document the deadline question: shared budget across the two
      stages, or an explicitly larger one. *Shared — see "Decided: one shared
      budget, not two" above. `remainingSolveBudget` is the rule, and its three
      cases (absent / negative / non-negative) are the part that is easy to get
      wrong.*
- [x] An options shape for `cp_detect_solve_exact` that accepts
      `exempt_vertex_ids` — `ExactSolveOptionsWithExemptions` is already
      `#[serde(flatten)]`, so the JSON is a superset; the blocker is
      `exact_solve_options_from_json` rejecting unknown keys. *Unknown keys are
      still rejected — that was worth keeping, since a misspelled option
      silently becoming a no-op is how a solve quietly stops honouring what the
      caller asked for. `exempt_vertex_ids` is now simply one more known key, and
      an id naming a vertex absent from the input is a hard error rather than a
      silently ignored exemption.*

### Phase B — the frontend flow

- [x] Worker + runtime: separate `recognize` and `solve` calls; run identity on
      the `withFoldInFlight` / `oristudioCpFoldRuns` model.
- [x] Fix the dead-client hang: pass `observe` to `attachWorkerDiagnostics` and
      actually call `releaseCpDetectClient`. The crash path calls it — one
      `loseClient` serves both, so a crash and a deliberate reset cannot behave
      differently. It stays out of surface teardown deliberately: it discards the
      compiled ONNX session over the 43 MiB model, so closing the import dialog
      must not call it.
- [x] Honour the published budget: `runCpExactSolve` gives stage 1
      `total_seconds` and stage 2 what stage 1 left, so the staged flow keeps the
      fused path's cap rather than 2x it. A negative total passes through
      unchanged — it disables the timeout, and `0.0` means "immediately".
- [x] Modal stage machine: `recognized → solving → solved | failed`, showing the
      unsolved creases while the solve runs. Buttons say what they do —
      **Add** after a successful solve, **Add as-is** only where the pattern is
      genuinely unsolved, **Review & Fix** whenever there is anything to repair
      (no site threshold — see `crease-topology-repair.md`). The gate on solving
      at all is `topology_diagnostics.combinatorial`: a flagged candidate is
      handed to the user, never to the solver. A timeout additionally offers
      **Add partial result** — the `attempted_moved_vertices` coordinates mapped
      onto the candidate through `cp_detector.vertex_original_ids`, which is the
      only place that partial solution exists.
- [x] One solve implementation in a hook beside `cp-workspace/regions/`, reached
      by both the modal and the chip. *Landed one level down from the wording:
      the shared implementation is `engine/cpExactSolve.runCpExactSolve`, which
      owns the stage split, the run registry and the budget rule.
      `useCpRegionSolve` is the region-scoped binding over it — it rebuilds an
      `ExactSolveInput` from a region's current document geometry — and the modal
      calls `runCpExactSolve` directly, because until the import lands there is
      no region and no document geometry to rebuild from. Both paths therefore
      run the same solve; only the input differs, which is the point.*
- [x] Pass the `CpRegionSolveBinding` from `CreasePatternPanel` into
      `CpRegionLayer`, making `SolveRegionChip` reachable. Add a test that fails
      if the prop is dropped — the current gap typechecks cleanly because the
      prop is optional. (`components/panels/regionWiring.test.tsx`.)
- [x] Verify `Crease Pattern ▸ Repair ▸ Exact Solve…` is wired end to end, or
      wire it. It was dead: the action dispatched
      `CP_EXACT_SOLVE_REQUEST_EVENT` and **nothing listened**.
      `useCpRegionSolve` is now the listener, resolving the target the way the
      capability is gated — one solvable pattern is unambiguous, more than one is
      disambiguated by the selected crease.
- [ ] **Deferred — expose the `ExactSolveInput` rebuild over the bridge.**
      Deferred because the export is a Rust API-surface change in
      `oristudio-cp-compiler` that nothing else in this plan needs, and shipping
      the frontend flow behind it would have held the whole staged path on it.
      A region solve therefore still runs on the *attachment*, so the user's
      repairs do not reach the solver — which is the whole point of the flow, and
      why this is the one item here that is a gap rather than a nicety.
      `fold_exactize::fold_to_exact_solve_input` already does exactly this
      (paper polygon by turn angle → similarity onto the unit square → map back
      into the input's frame) but it is **private, with no wasm export**, and
      `oristudio_cp_wasm::exactize_fold` is not a substitute: it fuses the solve,
      applies its own adoption gate, and reports no movement, no stages and no
      exemptions, so routing through it would be the second solve implementation
      this plan exists to prevent. `cp-workspace/regions/regionSolveGeometry.ts`
      stands in meanwhile — it places the answer under one stated hypothesis
      (unit square, shift and uniform scale) and **refuses rather than guesses**
      when the creases do not confirm it. It goes away with the export.

### Phase C — cancellation, measured first

- [x] Measure the un-checkpointed sparse Cholesky step on a hard pattern against
      the ~100 ms responsiveness bar. That number picks the mechanism. *It picked
      the worker; the table is under "Measured, and it picked shape 1" above.*
- [x] Implement whichever it picks — a per-run solve-only worker, or the fold's
      cooperative `SharedArrayBuffer` flag — and fire `cpDetectCancelled`, which
      has been declared and dead since it was written.
      *`workers/cpExactSolveWorker.ts` is the two-method worker;
      `engine/cpExactSolveSession.ts` owns spawn, settle-then-terminate, and
      `cpExactSolveCancellationAvailable`. `runCpExactSolve` opens the session
      and binds it to the run **before its first await**, so a run published as
      `cancellable` is reachable from the moment anything could press Stop, and
      disposes it in a `finally`.*
- [x] `cancellable` and `stopping` are now driven by the real transition:
      `requestCpExactSolveStop` marks the run, then invokes the bound stop, and
      the run's own `finally` clears it. The stop handles live in a side table in
      `cpExactSolveRuns.ts` rather than on the run records, for the reason
      `foldCancellation.ts` is separate from `oristudioCpFoldRuns`.
- [x] Both surfaces offer it: the modal's solving row and the region chip's
      solving state, each rendering the button **from the run's own
      `cancellable`** so a solve on a transport nothing can reach shows the wait
      and no button. The modal's `close()` gate is lifted for the one busy state
      that can now be interrupted — closing during a solve stops it, which is
      what "a running detection cannot be abandoned" was about.
- [x] A cancelled solve leaves the document untouched, and that is structural
      rather than a rollback: `runCpExactSolve` never writes, and both callers
      abandon before the point where they would.
- [ ] **Not done, and out of this phase's scope:** the un-checkpointed Cholesky
      is still un-checkpointed. Stop does not need it, but the 25 s *deadline*
      still cannot land inside one factorization, so a hard-bucket timeout still
      overruns its budget by up to that gap. Fixing it is a fill-reducing
      ordering or a different solver, and it belongs with the perf work in
      `exact-solve-perf-profile`.
