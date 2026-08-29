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
- `apps/web/src/components/CpDetectImportModal.tsx` — the new stage machine and
  honest button labels.
- `apps/web/src/cp-workspace/regions/` — the solve binding hook.
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — pass it to
  `CpRegionLayer`.

## Checklist

### Phase A — the Rust split

- [ ] Extract `recognize_from_generation` from `decode.rs:543-574` as a shared
      private step; the solving tail consumes its output. Do this first and
      alone, so the refactor is provably behaviour-preserving.
- [ ] A parity test asserting recognize-then-solve is byte-identical to today's
      fused decode on a committed fixture. This is what forecloses divergence,
      and it should fail loudly if the two paths ever drift.
- [ ] `recognize_only` on `DecodeConfig`; one branch at `:575`. Emit
      `TopologyDiagnostics` into `compiler_report`, and the candidate FOLD via
      `export_candidate_to_fold_document`.
- [ ] Stop emitting `exact_solve_input` twice across the bridge.
- [ ] Decide and document the deadline question: shared budget across the two
      stages, or an explicitly larger one.
- [ ] An options shape for `cp_detect_solve_exact` that accepts
      `exempt_vertex_ids` — `ExactSolveOptionsWithExemptions` is already
      `#[serde(flatten)]`, so the JSON is a superset; the blocker is
      `exact_solve_options_from_json` rejecting unknown keys.

### Phase B — the frontend flow

- [ ] Worker + runtime: separate `recognize` and `solve` calls; run identity on
      the `withFoldInFlight` / `oristudioCpFoldRuns` model.
- [ ] Fix the dead-client hang: pass `observe` to `attachWorkerDiagnostics` and
      actually call `releaseCpDetectClient`.
- [ ] Modal stage machine: `recognized → solving → solved | failed`, showing the
      unsolved creases while the solve runs. Buttons say what they do —
      **Add** after a successful solve, **Add as-is** only where the pattern is
      genuinely unsolved, **Review & Fix** whenever there is anything to repair
      (no site threshold — see `crease-topology-repair.md`).
- [ ] One solve implementation in a hook beside `cp-workspace/regions/`, reached
      by both the modal and the chip.
- [ ] Pass the `CpRegionSolveBinding` from `CreasePatternPanel` into
      `CpRegionLayer`, making `SolveRegionChip` reachable. Add a test that fails
      if the prop is dropped — the current gap typechecks cleanly because the
      prop is optional.
- [ ] Verify `Crease Pattern ▸ Repair ▸ Exact Solve…` is wired end to end, or
      wire it.

### Phase C — cancellation, measured first

- [ ] Measure the un-checkpointed sparse Cholesky step on a hard pattern against
      the ~100 ms responsiveness bar. That number picks the mechanism.
- [ ] Implement whichever it picks — a per-run solve-only worker, or the fold's
      cooperative `SharedArrayBuffer` flag — and fire `cpDetectCancelled`, which
      has been declared and dead since it was written.
